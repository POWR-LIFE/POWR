import { TillBarcode } from '@/components/rewards/TillBarcode';
import {
  InStoreError,
  fetchInStoreInfo,
  fetchWalletEntry,
  inStoreVoucherStatus,
  openInStoreVoucher,
  swipeInStoreVoucher,
  type InStoreErrorCode,
  type InStoreInfo,
  type InStoreVoucher,
} from '@/lib/api/inStore';
import type { WalletEntry } from '@/lib/api/rewards';
import { tracked } from '@/lib/analytics';
import { quietFix, type QuietFix } from '@/lib/inStoreLocation';
import { codeStep, formatTypedCode, parseInStoreScan, voucherQrPayload, voucherTypedCode } from '@/shared/inStore';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The live in-store voucher, opened from the wallet's "Use in store".
 *
 * The member opens it at the till. It shows a QR and a 6-character code that
 * change every 10 seconds (derived locally from the voucher secret, see
 * shared/inStore.ts), a countdown, and the time ticking, so a screenshot
 * doesn't pass. Staff scan it on powr.life/scan, or swipe it here.
 * This screen polls and flips to Confirmed the moment the scan lands.
 *
 * Opening never uses the reward up: if the window runs out, "Open again".
 * Some shops ask for their counter stand first (requires_stand), which is
 * scanned right here. mode=barcode is the chain variant: the brand's own
 * code as a till barcode, full screen.
 */

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';
const MUTED = 'rgba(255,255,255,0.4)';
const GREEN = '#4ade80';
const BORDER = 'rgba(255,255,255,0.08)';
const CARD = 'rgba(40,40,40,0.85)';

type Phase = 'loading' | 'stand' | 'voucher' | 'swiped' | 'confirmed' | 'closed' | 'error' | 'barcode';

const ERROR_COPY: Record<InStoreErrorCode, { title: string; body: string }> = {
  ALREADY_USED: { title: 'Already used', body: 'This reward has been used. It’s in your wallet history.' },
  EXPIRED: { title: 'Reward expired', body: 'This reward passed its use-by date.' },
  NOT_ACTIVE: { title: 'Not available', body: 'This reward is no longer in your wallet.' },
  NOT_FOUND: { title: 'Not found', body: 'We couldn’t find this reward in your wallet.' },
  NOT_IN_STORE: { title: 'Not an in-store reward', body: 'This one isn’t set up for use in store any more. Use it from your wallet.' },
  NOT_SIGNED_IN: { title: 'Signed out', body: 'Sign in again to use your reward.' },
  STAND_REQUIRED: { title: 'Scan the stand', body: 'Scan the POWR stand on the counter.' },
  STAND_OTHER_SHOP: { title: 'Different shop', body: 'That stand belongs to a different shop.' },
  STAND_INVALID: { title: 'Stand not recognised', body: 'That stand has been replaced. Ask staff for the new one.' },
  CLOSED: { title: 'Voucher closed', body: 'Open it again when you’re at the till.' },
  UNKNOWN: { title: 'Couldn’t open the voucher', body: 'Check your connection and try again.' },
};

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const hms = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const initials = (label: string) =>
  label.split(/\s+/).map((p) => p.replace(/[^A-Za-z0-9\u00C0-\u024F]/g, '').charAt(0)).join('').slice(0, 2).toUpperCase() || 'P';

export default function InStoreScreen() {
  const { redemption, mode } = useLocalSearchParams<{ redemption: string; mode?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<InStoreErrorCode>('UNKNOWN');
  const [voucher, setVoucher] = useState<InStoreVoucher | null>(null);
  const [entry, setEntry] = useState<WalletEntry | null>(null);
  const [info, setInfo] = useState<InStoreInfo | null>(null);
  const [standHint, setStandHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offsetRef = useRef(0);
  const fixRef = useRef<QuietFix | null>(null);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/wallet');
  }, [router]);

  // The phone stays awake while the voucher is up: the member is holding it
  // out at the till, often longer than the auto-lock delay.
  useEffect(() => {
    activateKeepAwakeAsync('in-store-voucher').catch(() => {});
    return () => { Promise.resolve(deactivateKeepAwake('in-store-voucher')).catch(() => {}); };
  }, []);

  const applyVoucher = useCallback((v: InStoreVoucher) => {
    offsetRef.current = Date.parse(v.server_now) - Date.now();
    setVoucher(v);
    const next: Phase = v.status === 'confirmed' ? 'confirmed' : v.status === 'swiped' ? 'swiped' : v.closed ? 'closed' : 'voucher';
    setPhase((prev) => {
      if (prev !== next && (next === 'confirmed' || next === 'swiped')) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      }
      return next;
    });
  }, [queryClient]);

  const open = useCallback(async (stand?: { standCode: string; key: string }) => {
    setBusy(true);
    try {
      const f = fixRef.current;
      const v = await openInStoreVoucher(redemption, {
        lat: f?.lat, lng: f?.lng, accuracy: f?.accuracy, standCode: stand?.standCode, standKey: stand?.key,
      });
      setStandHint(null);
      applyVoucher(v);
    } catch (err) {
      const code = err instanceof InStoreError ? err.code : 'UNKNOWN';
      if (code === 'STAND_REQUIRED') {
        setPhase('stand');
      } else if (stand && (code === 'STAND_INVALID' || code === 'STAND_OTHER_SHOP')) {
        const named = err instanceof InStoreError && code === 'STAND_OTHER_SHOP' && err.rewardShop
          ? (err.standShop
            ? `That stand is for ${err.standShop}. This reward is for ${err.rewardShop}.`
            : `That stand isn’t one of ${err.rewardShop}’s. Look for the POWR stand on their counter.`)
          : null;
        setStandHint(named ?? ERROR_COPY[code].body);
        setPhase('stand');
      } else {
        setError(code);
        setPhase('error');
      }
    } finally {
      setBusy(false);
    }
  }, [redemption, applyVoucher]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const e = await fetchWalletEntry(redemption);
        if (!live) return;
        setEntry(e);
        if (e) {
          const map = await fetchInStoreInfo([e.reward_id]).catch(() => ({} as Record<string, InStoreInfo>));
          if (!live) return;
          setInfo(map[e.reward_id] ?? null);
        }
        if (mode === 'barcode') {
          setPhase(e ? 'barcode' : 'error');
          if (!e) setError('NOT_FOUND');
          return;
        }
        fixRef.current = await quietFix(5000);
        if (live) await open();
      } catch {
        if (live) { setError('UNKNOWN'); setPhase('error'); }
      }
    })();
    return () => { live = false; };
    // Once per mount: the screen is keyed by its redemption.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While the voucher is up, watch for the shop's scan (and our own expiry).
  useEffect(() => {
    if (phase !== 'voucher' || !voucher) return;
    const id = voucher.voucher_id;
    const t = setInterval(() => {
      inStoreVoucherStatus(id).then((v) => {
        if (v.status !== 'open' || v.closed) applyVoucher(v);
      }).catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, [phase, voucher, applyVoucher]);

  const swipe = useCallback(async () => {
    if (!voucher) return;
    setBusy(true);
    try {
      applyVoucher(await swipeInStoreVoucher(voucher.voucher_id));
    } catch (err) {
      const code = err instanceof InStoreError ? err.code : 'UNKNOWN';
      if (code === 'CLOSED') setPhase('closed');
      else { setError(code); setPhase('error'); }
    } finally {
      setBusy(false);
    }
  }, [voucher, applyVoucher]);

  const shopLine = [voucher?.brand_name ?? entry?.partner_name, voucher?.site_name].filter(Boolean).join(' · ');

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable onPress={close} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
          <Ionicons name="close" size={22} color={TEXT} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{shopLine || entry?.partner_name || ''}</Text>
        <View style={styles.closeBtn} />
      </View>

      {phase === 'loading' && (
        <View style={styles.centered}><ActivityIndicator color={GOLD} /><Text style={styles.dimText}>Opening your voucher…</Text></View>
      )}

      {phase === 'stand' && (
        <StandScanner
          brand={entry?.partner_name ?? null}
          hint={standHint}
          busy={busy}
          onStand={(standCode, key) => open({ standCode, key })}
          onHint={setStandHint}
        />
      )}

      {phase === 'voucher' && voucher && (
        <LiveVoucher voucher={voucher} offsetRef={offsetRef} busy={busy} onSwipe={swipe}
          onExpired={() => inStoreVoucherStatus(voucher.voucher_id).then(applyVoucher).catch(() => setPhase('closed'))} />
      )}

      {phase === 'swiped' && voucher && (
        <Outcome
          icon="checkmark"
          tone={GREEN}
          label="RECORDED"
          title={voucher.reward_title ?? entry?.reward_title ?? 'Reward'}
          body={`Staff swiped it at ${voucher.swiped_at ? hms(Date.parse(voucher.swiped_at)) : 'the till'}. Enjoy it.`}
          rows={[voucher.site_name ? ['SHOP', voucher.site_name] : null, ['CHECKED BY', 'Staff swipe']]}
          onDone={close}
        />
      )}

      {phase === 'confirmed' && voucher && (
        <Outcome
          icon="checkmark"
          tone={GREEN}
          label="CONFIRMED"
          title={voucher.reward_title ?? entry?.reward_title ?? 'Reward'}
          body={`${voucher.brand_name ?? 'The shop'} scanned your voucher.`}
          rows={[
            voucher.confirm_site_name ?? voucher.site_name ? ['SHOP', (voucher.confirm_site_name ?? voucher.site_name) as string] : null,
            voucher.confirmed_at ? ['TIME', hms(Date.parse(voucher.confirmed_at)).slice(0, 5)] : null,
            ['CHECKED BY', voucher.confirmed_by === 'manager' ? 'Manager scan' : 'Staff scan'],
          ]}
          onDone={close}
        />
      )}

      {phase === 'closed' && (
        <View style={styles.centeredPad}>
          <Ionicons name="time-outline" size={40} color={MUTED} />
          <Text style={styles.outcomeTitle}>Voucher closed</Text>
          <Text style={styles.outcomeBody}>Your reward is still in your wallet. Open it again when you’re at the till.</Text>
          <Pressable style={({ pressed }) => [styles.primaryBtn, styles.wide, pressed && { opacity: 0.85 }]} disabled={busy}
            onPress={tracked('in_store_reopen', () => open())}>
            {busy ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.primaryBtnText}>Open again</Text>}
          </Pressable>
          <Pressable onPress={close} style={styles.textBtn}><Text style={styles.textBtnText}>Not now</Text></Pressable>
        </View>
      )}

      {phase === 'error' && (
        <View style={styles.centeredPad}>
          <Ionicons name="alert-circle-outline" size={40} color={MUTED} />
          <Text style={styles.outcomeTitle}>{ERROR_COPY[error].title}</Text>
          <Text style={styles.outcomeBody}>{ERROR_COPY[error].body}</Text>
          {error === 'UNKNOWN' ? (
            <Pressable style={({ pressed }) => [styles.primaryBtn, styles.wide, pressed && { opacity: 0.85 }]} disabled={busy}
              onPress={() => { setPhase('loading'); void open(); }}>
              <Text style={styles.primaryBtnText}>Try again</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={close} style={styles.textBtn}><Text style={styles.textBtnText}>Back to wallet</Text></Pressable>
        </View>
      )}

      {phase === 'barcode' && entry && (
        <BarcodeView entry={entry} info={info} onDone={close} />
      )}
    </View>
  );
}

// ─── Live voucher ─────────────────────────────────────────────────────────────

function LiveVoucher({
  voucher,
  offsetRef,
  busy,
  onSwipe,
  onExpired,
}: {
  voucher: InStoreVoucher;
  offsetRef: React.MutableRefObject<number>;
  busy: boolean;
  onSwipe: () => void;
  onExpired: () => void;
}) {
  const [now, setNow] = useState(() => Date.now() + offsetRef.current);
  const expiredFired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offsetRef.current), 250);
    return () => clearInterval(t);
  }, [offsetRef]);

  const leftMs = Math.max(0, Date.parse(voucher.expires_at) - now);
  useEffect(() => {
    if (leftMs === 0 && !expiredFired.current) { expiredFired.current = true; onExpired(); }
  }, [leftMs, onExpired]);

  const stepSeconds = voucher.step_seconds || 10;
  const step = codeStep(now, stepSeconds);
  const payload = useMemo(() => voucherQrPayload(voucher.voucher_id, voucher.secret, step), [voucher, step]);
  const typed = useMemo(() => formatTypedCode(voucherTypedCode(voucher.secret, step)), [voucher.secret, step]);
  const qrIn = stepSeconds - (Math.floor(now / 1000) % stepSeconds);
  const leftS = Math.ceil(leftMs / 1000);
  const showQr = voucher.check === 'staff_scan';

  return (
    <ScrollView contentContainerStyle={styles.voucherScroll} bounces={false}>
      <Marquee />
      <View style={styles.voucherBody}>
        <View style={styles.memberRow}>
          <Pulse>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(voucher.member_label)}</Text></View>
          </Pulse>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.memberName} numberOfLines={1}>{voucher.member_label}</Text>
            {voucher.member_since ? <Text style={styles.memberMeta}>POWR MEMBER SINCE {voucher.member_since.toUpperCase()}</Text> : null}
          </View>
        </View>

        <Text style={styles.rewardTitle} numberOfLines={2}>{voucher.reward_title ?? 'Your reward'}</Text>

        {showQr ? (
          <View style={styles.qrWrap}>
            <View style={styles.qrCard} accessible accessibilityLabel={`Voucher code ${typed}`}>
              <QRCode value={payload} size={196} color="#0a0a0a" backgroundColor="#FFFFFF" />
            </View>
            <View style={styles.qrMeta}>
              <Text style={styles.metaLabel}>NEW CODE IN {qrIn}S</Text>
              <Text style={styles.typedCode}>{typed}</Text>
            </View>
          </View>
        ) : (
          <LiveClock now={now} />
        )}

        <View style={styles.timeRow}>
          <View style={styles.timeTile}>
            <Text style={styles.metaLabel}>TIME NOW</Text>
            <Text style={styles.timeValue}>{hms(now)}</Text>
          </View>
          <View style={styles.timeTile}>
            <Text style={styles.metaLabel}>CLOSES IN</Text>
            <Text style={[styles.timeValue, { color: GOLD }]}>{Math.floor(leftS / 60)}:{pad(leftS % 60)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.swipeArea}>
        <Text style={styles.swipeNote}>
          {showQr ? 'No scanner at the till? Staff can swipe instead.' : 'Staff: check the time is moving, then swipe.'}
        </Text>
        <SwipeToRedeem disabled={busy} onComplete={onSwipe} />
      </View>
    </ScrollView>
  );
}

function LiveClock({ now }: { now: number }) {
  const sheen = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(sheen, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [sheen]);
  return (
    <View style={styles.lookCard}>
      <Animated.View pointerEvents="none" style={[styles.sheen, {
        transform: [{ translateX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-160, 420] }) }, { skewX: '-18deg' }],
      }]} />
      <Text style={styles.metaLabel}>LIVE TIME · CHECK IT MOVES</Text>
      <Text style={styles.lookClock}>{hms(now)}</Text>
    </View>
  );
}

function Marquee() {
  const x = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!w) return;
    x.setValue(0);
    const loop = Animated.loop(Animated.timing(x, { toValue: -w, duration: w * 22, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [w, x]);
  const text = 'LIVE VOUCHER · POWR · LIVE VOUCHER · POWR · LIVE VOUCHER · POWR · ';
  return (
    <View style={styles.marquee} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={{ flexDirection: 'row', transform: [{ translateX: x }] }}>
        <Text style={styles.marqueeText} onLayout={(e) => setW(e.nativeEvent.layout.width)}>{text}</Text>
        <Text style={styles.marqueeText}>{text}</Text>
        <Text style={styles.marqueeText}>{text}</Text>
      </Animated.View>
    </View>
  );
}

function Pulse({ children }: { children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={styles.pulseBox}>
      <Animated.View style={[styles.pulseRing, {
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }],
      }]} />
      {children}
    </View>
  );
}

const KNOB = 48;

function SwipeToRedeem({ onComplete, disabled }: { onComplete: () => void; disabled: boolean }) {
  const [trackW, setTrackW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const nudge = useRef(new Animated.Value(0)).current;
  const max = Math.max(0, trackW - KNOB - 12);
  const done = useRef(false);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(nudge, { toValue: 8, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(nudge, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [nudge]);

  const finish = useCallback(() => {
    if (done.current || disabled) return;
    done.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onComplete();
  }, [onComplete, disabled]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: (_, g) => !disabled && Math.abs(g.dx) > 4,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => x.setValue(Math.max(0, Math.min(max, g.dx))),
    onPanResponderRelease: (_, g) => {
      if (max > 0 && g.dx >= max * 0.85) {
        Animated.timing(x, { toValue: max, duration: 120, useNativeDriver: true }).start(finish);
      } else {
        Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
      }
    },
  }), [disabled, max, x, finish]);

  return (
    <View
      style={[styles.swipeTrack, disabled && { opacity: 0.5 }]}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Staff: swipe to redeem"
      accessibilityHint="Double-tap to redeem this reward now"
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'activate') finish(); }}
    >
      <Text style={styles.swipeText}>STAFF: SWIPE TO REDEEM</Text>
      <Animated.View {...pan.panHandlers} style={[styles.swipeKnob, { transform: [{ translateX: Animated.add(x, nudge) }] }]}>
        <Ionicons name="arrow-forward" size={20} color="#0a0a0a" />
      </Animated.View>
    </View>
  );
}

// ─── Stand scanner ────────────────────────────────────────────────────────────

function StandScanner({
  brand,
  hint,
  busy,
  onStand,
  onHint,
}: {
  brand: string | null;
  hint: string | null;
  busy: boolean;
  onStand: (standCode: string, key: string) => void;
  onHint: (h: string | null) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const locked = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);
  useEffect(() => { if (!busy) locked.current = false; }, [busy, hint]);

  const onScan = useCallback(({ data }: { data: string }) => {
    if (locked.current || busy) return;
    const parsed = parseInStoreScan(data);
    if (parsed?.kind === 'stand') {
      locked.current = true;
      Haptics.selectionAsync().catch(() => {});
      onStand(parsed.standCode, parsed.key);
      return;
    }
    locked.current = true;
    onHint('That’s not a POWR stand. Look for the POWR QR on the counter.');
    setTimeout(() => { locked.current = false; }, 2200);
  }, [busy, onStand, onHint]);

  return (
    <ScrollView contentContainerStyle={styles.standScroll} bounces={false}>
      <Text style={styles.stepLabel}>STEP 1 OF 2</Text>
      <Text style={styles.standTitle}>
        <Text style={{ fontWeight: '200' }}>Scan the stand </Text>
        <Text style={{ fontWeight: '700', color: GOLD }}>at the till</Text>
      </Text>
      <Text style={styles.standBody}>{brand ? `${brand} asks for this` : 'The shop asks for this'}, so your voucher only opens inside the shop.</Text>

      <View style={styles.viewfinder}>
        {permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
        ) : permission && !permission.canAskAgain ? (
          <View style={styles.permBox}>
            <Text style={styles.dimText}>Camera access is off for POWR.</Text>
            <Pressable onPress={() => Linking.openSettings()} style={styles.ghostBtn}><Text style={styles.ghostBtnText}>Open settings</Text></Pressable>
          </View>
        ) : (
          <View style={styles.permBox}><ActivityIndicator color={GOLD} /></View>
        )}
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => <View key={c} style={[styles.corner, styles[`corner_${c}`]]} />)}
        {busy && <View style={styles.viewfinderBusy}><ActivityIndicator color={GOLD} /></View>}
      </View>

      {hint ? <Text style={styles.standHint}>{hint}</Text> : <Text style={styles.dimTextCenter}>Point at the QR on the counter.</Text>}
      <Text style={styles.dimTextCenter}>No stand on the counter? Ask a member of staff.</Text>
    </ScrollView>
  );
}

// ─── Outcomes ─────────────────────────────────────────────────────────────────

function Outcome({
  icon, tone, label, title, body, rows, onDone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  label: string;
  title: string;
  body: string;
  rows: ([string, string] | null)[];
  onDone: () => void;
}) {
  const pop = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, bounciness: 10 }).start();
  }, [pop]);
  const shown = rows.filter((r): r is [string, string] => !!r);
  return (
    <ScrollView contentContainerStyle={styles.outcomeScroll} bounces={false}>
      <Animated.View style={[styles.outcomeRing, { borderColor: tone, transform: [{ scale: pop }] }]}>
        <Ionicons name={icon} size={52} color={tone} />
      </Animated.View>
      <Text style={[styles.outcomeLabel, { color: tone }]}>{label}</Text>
      <Text style={styles.outcomeTitle}>{title}</Text>
      <Text style={styles.outcomeBody}>{body}</Text>
      {shown.length > 0 && (
        <View style={styles.rowsCard}>
          {shown.map(([k, v], i) => (
            <View key={k} style={[styles.row, i < shown.length - 1 && styles.rowDivider]}>
              <Text style={styles.metaLabel}>{k}</Text>
              <Text style={styles.rowValue}>{v}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={styles.dimTextCenter}>It’s in your wallet history now.</Text>
      <View style={{ flex: 1 }} />
      <Pressable style={({ pressed }) => [styles.primaryBtn, styles.wide, pressed && { opacity: 0.85 }]} onPress={onDone}>
        <Text style={styles.primaryBtnText}>Done</Text>
      </Pressable>
    </ScrollView>
  );
}

function BarcodeView({ entry, info, onDone }: { entry: WalletEntry; info: InStoreInfo | null; onDone: () => void }) {
  const { width } = useWindowDimensions();
  const expires = entry.expires_at
    ? new Date(entry.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  return (
    <ScrollView contentContainerStyle={styles.outcomeScroll} bounces={false}>
      <Text style={styles.stepLabel}>SHOW AT THE TILL</Text>
      <Text style={[styles.standTitle, { textAlign: 'center' }]}>
        <Text style={{ fontWeight: '200' }}>{entry.reward_title ?? 'Your reward'}</Text>
      </Text>
      {entry.partner_name ? <Text style={styles.outcomeBody}>Staff at {entry.partner_name} scan it like any other coupon.</Text> : null}
      <View style={{ marginTop: 20 }}>
        <TillBarcode code={entry.code} format={info?.barcode_format ?? 'code128'} width={width - 48} />
      </View>
      <View style={styles.brightRow}>
        <Ionicons name="sunny-outline" size={16} color={DIM} />
        <Text style={styles.dimText}>Turn your screen brightness up if the till can’t read it.</Text>
      </View>
      <View style={styles.rowsCard}>
        <View style={[styles.row, styles.rowDivider]}><Text style={styles.metaLabel}>USES</Text><Text style={styles.rowValue}>One</Text></View>
        <View style={styles.row}><Text style={styles.metaLabel}>USE BY</Text><Text style={styles.rowValue}>{expires ?? 'No expiry'}</Text></View>
      </View>
      <View style={{ flex: 1 }} />
      <Pressable style={({ pressed }) => [styles.ghostBtn, styles.wide, pressed && { opacity: 0.7 }]} onPress={onDone}>
        <Text style={styles.ghostBtnText}>Done</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '400', color: 'rgba(255,255,255,0.7)' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  centeredPad: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 28 },
  dimText: { fontSize: 13, fontWeight: '300', color: DIM },
  dimTextCenter: { fontSize: 12, fontWeight: '300', color: DIM, textAlign: 'center', marginTop: 12 },

  marquee: {
    height: 28, overflow: 'hidden', justifyContent: 'center',
    backgroundColor: 'rgba(232,210,0,0.08)', borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(232,210,0,0.2)',
  },
  // Natural width, never shrunk or ellipsised: the loop scrolls by one copy's width.
  marqueeText: { fontSize: 9, fontWeight: '600', letterSpacing: 3, color: GOLD, flexShrink: 0 },

  voucherScroll: { flexGrow: 1 },
  voucherBody: { paddingHorizontal: 24, paddingTop: 20, gap: 18 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pulseBox: { width: 56, height: 56 },
  pulseRing: { ...StyleSheet.absoluteFillObject, borderRadius: 28, borderWidth: 2, borderColor: GOLD },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700', color: '#0a0a0a', letterSpacing: 0.5 },
  memberName: { fontSize: 18, fontWeight: '300', color: TEXT },
  memberMeta: { fontSize: 9, fontWeight: '500', letterSpacing: 2, color: DIM },
  rewardTitle: { fontSize: 28, fontWeight: '200', letterSpacing: -0.5, lineHeight: 32, color: TEXT },

  qrWrap: { alignItems: 'center', gap: 12 },
  qrCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16 },
  qrMeta: { width: 228, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  metaLabel: { fontSize: 9, fontWeight: '500', letterSpacing: 1.8, color: DIM },
  typedCode: { fontSize: 16, fontWeight: '300', letterSpacing: 3, color: TEXT },

  lookCard: {
    overflow: 'hidden', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)',
    backgroundColor: 'rgba(232,210,0,0.05)', paddingVertical: 28, alignItems: 'center', gap: 6,
  },
  sheen: { position: 'absolute', top: -20, bottom: -20, left: 0, width: 120, backgroundColor: 'rgba(232,210,0,0.12)' },
  lookClock: { fontSize: 54, fontWeight: '100', letterSpacing: -2, color: GOLD, fontVariant: ['tabular-nums'] },

  timeRow: { flexDirection: 'row', gap: 12 },
  timeTile: { flex: 1, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, gap: 2 },
  timeValue: { fontSize: 24, fontWeight: '200', letterSpacing: -0.5, color: TEXT, fontVariant: ['tabular-nums'] },

  swipeArea: { marginTop: 'auto', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20, gap: 10 },
  swipeNote: { textAlign: 'center', fontSize: 12, fontWeight: '300', color: DIM },
  swipeTrack: {
    height: 60, borderRadius: 30, borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)',
    backgroundColor: 'rgba(232,210,0,0.06)', justifyContent: 'center',
  },
  swipeText: { textAlign: 'center', paddingLeft: 40, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: GOLD },
  swipeKnob: {
    position: 'absolute', left: 6, top: 5, width: KNOB, height: KNOB, borderRadius: KNOB / 2,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center',
  },

  standScroll: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 10 },
  stepLabel: { fontSize: 10, fontWeight: '500', letterSpacing: 2, color: GOLD, textAlign: 'left' },
  standTitle: { fontSize: 32, lineHeight: 36, letterSpacing: -0.5, color: TEXT },
  standBody: { fontSize: 13, fontWeight: '300', lineHeight: 20, color: DIM },
  standHint: { fontSize: 13, fontWeight: '400', color: '#f97316', textAlign: 'center', marginTop: 12 },
  viewfinder: {
    marginTop: 18, alignSelf: 'center', width: 300, height: 300, borderRadius: 24,
    backgroundColor: '#161616', overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  viewfinderBusy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  permBox: { alignItems: 'center', gap: 14, padding: 20 },
  corner: { position: 'absolute', width: 36, height: 36, borderColor: GOLD },
  corner_tl: { left: 22, top: 22, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 12 },
  corner_tr: { right: 22, top: 22, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 12 },
  corner_bl: { left: 22, bottom: 22, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 12 },
  corner_br: { right: 22, bottom: 22, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 12 },

  outcomeScroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 36, paddingBottom: 24, gap: 12 },
  outcomeRing: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, backgroundColor: 'rgba(74,222,128,0.08)', alignItems: 'center', justifyContent: 'center' },
  outcomeLabel: { marginTop: 10, fontSize: 10, fontWeight: '600', letterSpacing: 2.5 },
  outcomeTitle: { fontSize: 28, fontWeight: '200', letterSpacing: -0.5, color: TEXT, textAlign: 'center' },
  outcomeBody: { fontSize: 14, fontWeight: '300', lineHeight: 21, color: DIM, textAlign: 'center' },
  rowsCard: { alignSelf: 'stretch', marginTop: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, paddingHorizontal: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  rowValue: { fontSize: 14, fontWeight: '300', color: TEXT },
  brightRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },

  wide: { alignSelf: 'stretch' },
  primaryBtn: { height: 48, borderRadius: 24, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primaryBtnText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: '#0a0a0a', textTransform: 'uppercase' },
  ghostBtn: { height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, marginTop: 12 },
  ghostBtnText: { fontSize: 12, fontWeight: '500', letterSpacing: 1, color: TEXT, textTransform: 'uppercase' },
  textBtn: { paddingVertical: 12, paddingHorizontal: 16 },
  textBtnText: { fontSize: 12, fontWeight: '500', letterSpacing: 0.8, color: DIM, textTransform: 'uppercase' },
});

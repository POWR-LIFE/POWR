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
import { getFormatLocale } from '@/lib/i18n';
import { quietFix, type QuietFix } from '@/lib/inStoreLocation';
import { codeStep, formatTypedCode, parseInStoreScan, voucherQrPayload, voucherTypedCode } from '@/shared/inStore';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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

// Translation keys, resolved at render.
const ERROR_COPY: Record<InStoreErrorCode, { title: string; body: string }> = {
  ALREADY_USED: { title: 'inStore:errors.alreadyUsed.title', body: 'inStore:errors.alreadyUsed.body' },
  EXPIRED: { title: 'inStore:errors.expired.title', body: 'inStore:errors.expired.body' },
  NOT_ACTIVE: { title: 'inStore:errors.notActive.title', body: 'inStore:errors.notActive.body' },
  NOT_FOUND: { title: 'inStore:errors.notFound.title', body: 'inStore:errors.notFound.body' },
  NOT_IN_STORE: { title: 'inStore:errors.notInStore.title', body: 'inStore:errors.notInStore.body' },
  NOT_SIGNED_IN: { title: 'inStore:errors.notSignedIn.title', body: 'inStore:errors.notSignedIn.body' },
  STAND_REQUIRED: { title: 'inStore:errors.standRequired.title', body: 'inStore:errors.standRequired.body' },
  STAND_OTHER_SHOP: { title: 'inStore:errors.standOtherShop.title', body: 'inStore:errors.standOtherShop.body' },
  STAND_INVALID: { title: 'inStore:errors.standInvalid.title', body: 'inStore:errors.standInvalid.body' },
  CLOSED: { title: 'inStore:errors.closed.title', body: 'inStore:errors.closed.body' },
  UNKNOWN: { title: 'inStore:errors.unknown.title', body: 'inStore:errors.unknown.body' },
};

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const hms = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const initials = (label: string) =>
  label.split(/\s+/).map((p) => p.replace(/[^A-Za-z0-9\u00C0-\u024F]/g, '').charAt(0)).join('').slice(0, 2).toUpperCase() || 'P';

// The server's own English: member_label falls back to this, and member_since
// is Postgres to_char(…, 'Mon YYYY'), whose month names are always English.
const SERVER_MEMBER_FALLBACK = 'POWR member';
const SERVER_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 2025" as the server wrote it in English; other languages get their own month name. */
function memberSinceLabel(raw: string, language: string): string {
  const m = /^([A-Za-z]{3}) (\d{4})$/.exec(raw.trim());
  const month = m ? SERVER_MONTHS.indexOf(m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) : -1;
  if (language === 'en' || !m || month < 0) return raw;
  return new Date(Number(m[2]), month, 1).toLocaleDateString(getFormatLocale(), { month: 'short', year: 'numeric' });
}

export default function InStoreScreen() {
  const { redemption, mode } = useLocalSearchParams<{ redemption: string; mode?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

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
            ? t('inStore:stand.otherShopNamed', { standShop: err.standShop, rewardShop: err.rewardShop })
            : t('inStore:stand.notRewardShop', { shop: err.rewardShop }))
          : null;
        setStandHint(named ?? t(ERROR_COPY[code].body));
        setPhase('stand');
      } else {
        setError(code);
        setPhase('error');
      }
    } finally {
      setBusy(false);
    }
  }, [redemption, applyVoucher, t]);

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
    const timer = setInterval(() => {
      inStoreVoucherStatus(id).then((v) => {
        if (v.status !== 'open' || v.closed) applyVoucher(v);
      }).catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
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
        <Pressable onPress={close} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel={t('inStore:close')} hitSlop={8}>
          <Ionicons name="close" size={22} color={TEXT} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{shopLine || entry?.partner_name || ''}</Text>
        <View style={styles.closeBtn} />
      </View>

      {phase === 'loading' && (
        <View style={styles.centered}><ActivityIndicator color={GOLD} /><Text style={styles.dimText}>{t('inStore:loading')}</Text></View>
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
          label={t('inStore:outcome.recorded')}
          title={voucher.reward_title ?? entry?.reward_title ?? t('inStore:rewardFallback')}
          body={voucher.swiped_at
            ? t('inStore:outcome.swipedAt', { time: hms(Date.parse(voucher.swiped_at)) })
            : t('inStore:outcome.swipedAtTill')}
          rows={[
            voucher.site_name ? [t('inStore:outcome.shop'), voucher.site_name] : null,
            [t('inStore:outcome.checkedBy'), t('inStore:outcome.staffSwipe')],
          ]}
          onDone={close}
        />
      )}

      {phase === 'confirmed' && voucher && (
        <Outcome
          icon="checkmark"
          tone={GREEN}
          label={t('inStore:outcome.confirmed')}
          title={voucher.reward_title ?? entry?.reward_title ?? t('inStore:rewardFallback')}
          body={voucher.brand_name
            ? t('inStore:outcome.scanned', { shop: voucher.brand_name })
            : t('inStore:outcome.scannedNoName')}
          rows={[
            voucher.confirm_site_name ?? voucher.site_name ? [t('inStore:outcome.shop'), (voucher.confirm_site_name ?? voucher.site_name) as string] : null,
            voucher.confirmed_at ? [t('inStore:outcome.time'), hms(Date.parse(voucher.confirmed_at)).slice(0, 5)] : null,
            [t('inStore:outcome.checkedBy'), voucher.confirmed_by === 'manager' ? t('inStore:outcome.managerScan') : t('inStore:outcome.staffScan')],
          ]}
          onDone={close}
        />
      )}

      {phase === 'closed' && (
        <View style={styles.centeredPad}>
          <Ionicons name="time-outline" size={40} color={MUTED} />
          <Text style={styles.outcomeTitle}>{t('inStore:closed.title')}</Text>
          <Text style={styles.outcomeBody}>{t('inStore:closed.body')}</Text>
          <Pressable style={({ pressed }) => [styles.primaryBtn, styles.wide, pressed && { opacity: 0.85 }]} disabled={busy}
            onPress={tracked('in_store_reopen', () => open())}>
            {busy ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.primaryBtnText}>{t('inStore:closed.openAgain')}</Text>}
          </Pressable>
          <Pressable onPress={close} style={styles.textBtn}><Text style={styles.textBtnText}>{t('inStore:closed.notNow')}</Text></Pressable>
        </View>
      )}

      {phase === 'error' && (
        <View style={styles.centeredPad}>
          <Ionicons name="alert-circle-outline" size={40} color={MUTED} />
          <Text style={styles.outcomeTitle}>{t(ERROR_COPY[error].title)}</Text>
          <Text style={styles.outcomeBody}>{t(ERROR_COPY[error].body)}</Text>
          {error === 'UNKNOWN' ? (
            <Pressable style={({ pressed }) => [styles.primaryBtn, styles.wide, pressed && { opacity: 0.85 }]} disabled={busy}
              onPress={() => { setPhase('loading'); void open(); }}>
              <Text style={styles.primaryBtnText}>{t('inStore:errors.tryAgain')}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={close} style={styles.textBtn}><Text style={styles.textBtnText}>{t('inStore:errors.backToWallet')}</Text></Pressable>
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
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now() + offsetRef.current);
  const expiredFired = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offsetRef.current), 250);
    return () => clearInterval(timer);
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
  const memberName = voucher.member_label === SERVER_MEMBER_FALLBACK ? t('inStore:voucher.memberFallback') : voucher.member_label;

  return (
    <ScrollView contentContainerStyle={styles.voucherScroll} bounces={false}>
      <Marquee />
      <View style={styles.voucherBody}>
        <View style={styles.memberRow}>
          <Pulse>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(memberName)}</Text></View>
          </Pulse>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.memberName} numberOfLines={1}>{memberName}</Text>
            {voucher.member_since ? (
              <Text style={styles.memberMeta}>
                {t('inStore:voucher.memberSince', { since: memberSinceLabel(voucher.member_since, i18n.language).toUpperCase() })}
              </Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.rewardTitle} numberOfLines={2}>{voucher.reward_title ?? t('inStore:yourReward')}</Text>

        {showQr ? (
          <View style={styles.qrWrap}>
            <View style={styles.qrCard} accessible accessibilityLabel={t('inStore:voucher.codeA11y', { code: typed })}>
              <QRCode value={payload} size={196} color="#0a0a0a" backgroundColor="#FFFFFF" />
            </View>
            <View style={styles.qrMeta}>
              <Text style={styles.metaLabel}>{t('inStore:voucher.newCodeIn', { count: qrIn })}</Text>
              <Text style={styles.typedCode}>{typed}</Text>
            </View>
          </View>
        ) : (
          <LiveClock now={now} />
        )}

        <View style={styles.timeRow}>
          <View style={styles.timeTile}>
            <Text style={styles.metaLabel}>{t('inStore:voucher.timeNow')}</Text>
            <Text style={styles.timeValue}>{hms(now)}</Text>
          </View>
          <View style={styles.timeTile}>
            <Text style={styles.metaLabel}>{t('inStore:voucher.closesIn')}</Text>
            <Text style={[styles.timeValue, { color: GOLD }]}>{Math.floor(leftS / 60)}:{pad(leftS % 60)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.swipeArea}>
        <Text style={styles.swipeNote}>
          {showQr ? t('inStore:voucher.swipeNoteQr') : t('inStore:voucher.swipeNoteLook')}
        </Text>
        <SwipeToRedeem disabled={busy} onComplete={onSwipe} />
      </View>
    </ScrollView>
  );
}

function LiveClock({ now }: { now: number }) {
  const { t } = useTranslation();
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
      <Text style={styles.metaLabel}>{t('inStore:voucher.liveTime')}</Text>
      <Text style={styles.lookClock}>{hms(now)}</Text>
    </View>
  );
}

function Marquee() {
  const { t } = useTranslation();
  const x = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!w) return;
    x.setValue(0);
    const loop = Animated.loop(Animated.timing(x, { toValue: -w, duration: w * 22, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [w, x]);
  const text = t('inStore:voucher.marquee').repeat(3);
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
  const { t } = useTranslation();
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
      accessibilityLabel={t('inStore:voucher.swipeA11y')}
      accessibilityHint={t('inStore:voucher.swipeA11yHint')}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'activate') finish(); }}
    >
      <Text style={styles.swipeText}>{t('inStore:voucher.swipe')}</Text>
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
  const { t } = useTranslation();
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
    onHint(t('inStore:stand.notAStand'));
    setTimeout(() => { locked.current = false; }, 2200);
  }, [busy, onStand, onHint, t]);

  return (
    <ScrollView contentContainerStyle={styles.standScroll} bounces={false}>
      <Text style={styles.stepLabel}>{t('inStore:stand.step', { step: 1, total: 2 })}</Text>
      <Text style={styles.standTitle}>
        <Trans
          i18nKey="inStore:stand.title"
          components={{ light: <Text style={{ fontWeight: '200' }} />, gold: <Text style={{ fontWeight: '700', color: GOLD }} /> }}
        />
      </Text>
      <Text style={styles.standBody}>{brand ? t('inStore:stand.bodyBrand', { brand }) : t('inStore:stand.body')}</Text>

      <View style={styles.viewfinder}>
        {permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
        ) : permission && !permission.canAskAgain ? (
          <View style={styles.permBox}>
            <Text style={styles.dimText}>{t('inStore:stand.cameraOff')}</Text>
            <Pressable onPress={() => Linking.openSettings()} style={styles.ghostBtn}><Text style={styles.ghostBtnText}>{t('inStore:stand.openSettings')}</Text></Pressable>
          </View>
        ) : (
          <View style={styles.permBox}><ActivityIndicator color={GOLD} /></View>
        )}
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => <View key={c} style={[styles.corner, styles[`corner_${c}`]]} />)}
        {busy && <View style={styles.viewfinderBusy}><ActivityIndicator color={GOLD} /></View>}
      </View>

      {hint ? <Text style={styles.standHint}>{hint}</Text> : <Text style={styles.dimTextCenter}>{t('inStore:stand.point')}</Text>}
      <Text style={styles.dimTextCenter}>{t('inStore:stand.noStand')}</Text>
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
  const { t } = useTranslation();
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
      <Text style={styles.dimTextCenter}>{t('inStore:outcome.inHistory')}</Text>
      <View style={{ flex: 1 }} />
      <Pressable style={({ pressed }) => [styles.primaryBtn, styles.wide, pressed && { opacity: 0.85 }]} onPress={onDone}>
        <Text style={styles.primaryBtnText}>{t('inStore:done')}</Text>
      </Pressable>
    </ScrollView>
  );
}

function BarcodeView({ entry, info, onDone }: { entry: WalletEntry; info: InStoreInfo | null; onDone: () => void }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const expires = entry.expires_at
    ? new Date(entry.expires_at).toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  return (
    <ScrollView contentContainerStyle={styles.outcomeScroll} bounces={false}>
      <Text style={styles.stepLabel}>{t('inStore:barcode.showAtTill')}</Text>
      <Text style={[styles.standTitle, { textAlign: 'center' }]}>
        <Text style={{ fontWeight: '200' }}>{entry.reward_title ?? t('inStore:yourReward')}</Text>
      </Text>
      {entry.partner_name ? <Text style={styles.outcomeBody}>{t('inStore:barcode.staffAt', { shop: entry.partner_name })}</Text> : null}
      <View style={{ marginTop: 20 }}>
        <TillBarcode code={entry.code} format={info?.barcode_format ?? 'code128'} width={width - 48} />
      </View>
      <View style={styles.brightRow}>
        <Ionicons name="sunny-outline" size={16} color={DIM} />
        <Text style={styles.dimText}>{t('inStore:barcode.brightness')}</Text>
      </View>
      <View style={styles.rowsCard}>
        <View style={[styles.row, styles.rowDivider]}>
          <Text style={styles.metaLabel}>{t('inStore:barcode.uses')}</Text>
          <Text style={styles.rowValue}>{t('inStore:barcode.one')}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.metaLabel}>{t('inStore:barcode.useBy')}</Text>
          <Text style={styles.rowValue}>{expires ?? t('inStore:barcode.noExpiry')}</Text>
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <Pressable style={({ pressed }) => [styles.ghostBtn, styles.wide, pressed && { opacity: 0.7 }]} onPress={onDone}>
        <Text style={styles.ghostBtnText}>{t('inStore:done')}</Text>
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

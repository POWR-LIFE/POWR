import GeometricBackground from '@/components/GeometricBackground';
import { RewardShareCard } from '@/components/share/RewardShareCard';
import {
  fetchActiveWallet,
  fetchWalletHistory,
  WALLET_HISTORY_PAGE_SIZE,
  walletEntryStatus,
  type WalletEntry,
  type WalletStatus,
} from '@/lib/api/rewards';
import { tracked } from '@/lib/analytics';
import i18n, { getFormatLocale } from '@/lib/i18n';
import { SAVE_CARD_ENABLED, cardFilename, saveCardImage } from '@/lib/saveCard';
import { rewardHeroUri, rewardLogoUri } from '@/lib/storageImage';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

// ─── Design tokens (match redeem-modal / points-ledger) ───────────────────────

const GOLD   = '#E8D200';
const BG     = '#0d0d0d';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';
const GREEN  = '#4ade80';
const BORDER = 'rgba(255,255,255,0.08)';

// `label` is a translation key, resolved at render.
const STATUS_META: Record<WalletStatus, { label: string; color: string }> = {
  ready:   { label: 'rewards:wallet.status.ready',   color: GREEN },
  used:    { label: 'rewards:wallet.status.used',    color: DIM },
  expired: { label: 'rewards:wallet.status.expired', color: MUTED },
};

function formatExpiry(entry: WalletEntry, status: WalletStatus): string {
  if (status === 'used') return i18n.t('rewards:wallet.expiry.used');
  if (!entry.expires_at) return i18n.t('rewards:wallet.expiry.none');
  const d = new Date(entry.expires_at);
  const date = d.toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  return status === 'expired'
    ? i18n.t('rewards:wallet.expiry.expired', { date })
    : i18n.t('rewards:wallet.expiry.validUntil', { date });
}

/**
 * react-native-share bundles image + caption text in one Android intent, but it
 * is a native module that only exists in EAS builds — resolve it lazily so the
 * wallet still works in Expo Go and older builds.
 */
function getNativeShare(): { open: (options: object) => Promise<unknown> } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-share').default;
  } catch {
    return null;
  }
}

/** Share text with the code spelled out, so recipients can copy-paste it. */
function buildShareMessage(entry: WalletEntry): string {
  const title = entry.reward_title ?? i18n.t('rewards:wallet.rewardFallback');
  const label = entry.partner_name
    ? i18n.t('rewards:wallet.shareMessage.label', { title, partner: entry.partner_name })
    : title;
  const url = entry.checkout_url;
  if (entry.integration_type === 'AFFILIATE') {
    return url
      ? i18n.t('rewards:wallet.shareMessage.affiliateWithLink', { label, url })
      : i18n.t('rewards:wallet.shareMessage.affiliate', { label });
  }
  return url
    ? i18n.t('rewards:wallet.shareMessage.codeWithLink', { label, code: entry.code, url })
    : i18n.t('rewards:wallet.shareMessage.code', { label, code: entry.code });
}

/** Plain-text share, used as fallback when image capture/sharing fails. */
function shareAsText(entry: WalletEntry): Promise<unknown> {
  return Share.share({
    message: buildShareMessage(entry),
    ...(entry.checkout_url ? { url: entry.checkout_url } : {}),
  }).catch(() => {});
}

// ─── Wallet card ──────────────────────────────────────────────────────────────

function WalletCard({
  entry,
  onShare,
  onSave,
  shareBusy,
  saveBusy,
  saved,
}: {
  entry: WalletEntry;
  onShare: (entry: WalletEntry) => void;
  onSave: (entry: WalletEntry) => void;
  shareBusy: boolean;
  saveBusy: boolean;
  /** Flashes "Saved" for a beat after an Android write lands. */
  saved: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const status = walletEntryStatus(entry);
  const meta = STATUS_META[status];
  const isAffiliate = entry.integration_type === 'AFFILIATE';
  const inactive = status !== 'ready';
  const title = entry.reward_title ?? t('rewards:wallet.rewardFallback');
  const partner = entry.partner_name;

  const copy = useCallback(() => {
    Clipboard.setStringAsync(entry.code);
    Haptics.selectionAsync();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [entry.code]);

  const openCheckout = useCallback(() => {
    if (entry.checkout_url) Linking.openURL(entry.checkout_url);
  }, [entry.checkout_url]);

  // Resized CDN copies — the raw uploads are 1–5 MB each and made the list
  // crawl on cellular.
  const bgUri = rewardHeroUri(entry.reward_hero_image_url ?? entry.reward_image_url);
  const logoUri = rewardLogoUri(entry.reward_image_url);

  return (
    <View style={[styles.card, inactive && styles.cardInactive]}>
      {bgUri ? (
        <>
          <ExpoImage
            source={{ uri: bgUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <View style={styles.cardBgOverlay} />
        </>
      ) : null}
      <View style={styles.cardHeader}>
        <View style={styles.logoBox}>
          {logoUri ? (
            <ExpoImage source={{ uri: logoUri }} style={styles.logoImg} contentFit="contain" />
          ) : (
            <Text style={styles.logoFallback}>{title.slice(0, 2).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
          {partner ? <Text style={styles.cardPartner} numberOfLines={1}>{partner}</Text> : null}
        </View>
        <View style={[styles.statusChip, { borderColor: meta.color + '40', backgroundColor: meta.color + '14' }]}>
          <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
          <Text style={[styles.statusChipText, { color: meta.color }]}>{t(meta.label)}</Text>
        </View>
      </View>

      {isAffiliate ? (
        <View style={styles.affiliateBlock}>
          <Text style={styles.affiliateText}>{t('rewards:wallet.affiliate')}</Text>
        </View>
      ) : (
        <Pressable style={styles.codeBlock} onPress={inactive ? undefined : tracked('wallet_copy_code', copy)} disabled={inactive}>
          <Text style={styles.codeLabel}>{t('rewards:wallet.code')}</Text>
          <Text style={[styles.codeText, inactive && { color: DIM }]}>{entry.code}</Text>
          {!inactive && (
            <View style={styles.copyRow}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={12} color={copied ? GREEN : MUTED} />
              <Text style={[styles.copyLabel, copied && { color: GREEN }]}>
                {copied ? t('rewards:wallet.copied') : t('rewards:wallet.tapToCopy')}
              </Text>
            </View>
          )}
        </Pressable>
      )}

      <Text style={styles.expiry}>{formatExpiry(entry, status)}</Text>

      {!inactive && (
        <View style={styles.actions}>
          {entry.checkout_url && (
            <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]} onPress={tracked('wallet_open_checkout', openCheckout)}>
              <Ionicons name="open-outline" size={14} color="#0a0a0a" />
              <Text style={styles.primaryBtnText}>
                {partner ? t('rewards:wallet.useAt', { partner }) : t('rewards:wallet.use')}
              </Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
            onPress={tracked('wallet_share_reward', () => onShare(entry))}
            disabled={shareBusy || saveBusy}
          >
            {shareBusy ? (
              <ActivityIndicator size="small" color={DIM} />
            ) : (
              <>
                <Ionicons name="share-outline" size={14} color={DIM} />
                <Text style={styles.secondaryBtnText}>{t('rewards:wallet.share')}</Text>
              </>
            )}
          </Pressable>
          {/* Keep the card image itself — see lib/saveCard.ts (and why it's off). */}
          {SAVE_CARD_ENABLED && (
            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, styles.iconBtn, pressed && { opacity: 0.7 }]}
              onPress={tracked('wallet_save_reward', () => onSave(entry))}
              disabled={shareBusy || saveBusy}
              accessibilityRole="button"
              accessibilityLabel={saved ? t('rewards:wallet.saved') : t('rewards:wallet.saveImage')}
            >
              {saveBusy ? (
                <ActivityIndicator size="small" color={DIM} />
              ) : (
                <Ionicons name={saved ? 'checkmark' : 'download-outline'} size={15} color={saved ? GREEN : DIM} />
              )}
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

type WalletTab = 'active' | 'history';

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const [tab, setTab] = useState<WalletTab>('active');
  const [pendingShare, setPendingShare] = useState<WalletEntry | null>(null);
  const [pendingAction, setPendingAction] = useState<'share' | 'save'>('share');
  const [savedId, setSavedId] = useState<string | null>(null);
  const shareCardRef = useRef<View>(null);
  const shareReadyRef = useRef<(() => void) | null>(null);

  // Both tabs come from the shared query cache: repeat opens paint instantly
  // from cache and refresh in the background once stale. Neither query gates
  // the other — the visible tab renders as soon as its own data arrives.
  const activeQuery = useQuery({
    queryKey: ['wallet', 'active'],
    queryFn: fetchActiveWallet,
  });

  const historyQuery = useInfiniteQuery({
    queryKey: ['wallet', 'history'],
    queryFn: ({ pageParam }) => fetchWalletHistory(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < WALLET_HISTORY_PAGE_SIZE
        ? undefined
        : allPages.reduce((n, page) => n + page.length, 0),
  });

  const active = activeQuery.data ?? [];
  // Dedupe by id: a code expiring between pages shifts offsets slightly.
  const history = useMemo(() => {
    const seen = new Set<string>();
    const out: WalletEntry[] = [];
    for (const page of historyQuery.data?.pages ?? []) {
      for (const entry of page) {
        if (!seen.has(entry.id)) {
          seen.add(entry.id);
          out.push(entry);
        }
      }
    }
    return out;
  }, [historyQuery.data]);

  const visibleQuery = tab === 'active' ? activeQuery : historyQuery;
  const loading = visibleQuery.isPending;
  const error = visibleQuery.isError ? t('rewards:wallet.loadError') : null;
  const loadingMore = historyQuery.isFetchingNextPage;

  const loadMoreHistory = useCallback(() => {
    if (historyQuery.hasNextPage && !historyQuery.isFetchingNextPage) {
      void historyQuery.fetchNextPage();
    }
  }, [historyQuery]);

  const handleCardReady = useCallback(() => {
    shareReadyRef.current?.();
  }, []);

  /**
   * Mounts the off-screen card for `entry`, waits for its images (capped so a
   * stalled load can't hang the button), and returns the full-res PNG. Share
   * and Save both start here; the caller owns the cleanup in its `finally`.
   */
  const captureEntry = useCallback(async (entry: WalletEntry, action: 'share' | 'save'): Promise<string> => {
    setPendingAction(action);
    setPendingShare(entry);
    await new Promise<void>((resolve) => {
      shareReadyRef.current = resolve;
      setTimeout(resolve, 2500);
    });
    await new Promise((r) => setTimeout(r, 60)); // let the loaded images paint
    return captureRef(shareCardRef, {
      format: 'png',
      quality: 1,
      width: 1080,
      height: 1350,
      result: 'tmpfile',
    });
  }, []);

  const handleShare = useCallback(async (entry: WalletEntry) => {
    Haptics.selectionAsync();
    try {
      const uri = await captureEntry(entry, 'share');
      const message = buildShareMessage(entry);
      const nativeShare = Platform.OS === 'android' ? getNativeShare() : null;
      if (Platform.OS === 'ios') {
        // iOS share sheet carries the image and the copyable text together.
        await Share.share({ url: uri, message });
      } else if (nativeShare) {
        // Image with the message as its caption, in one intent.
        await nativeShare.open({ url: uri, type: 'image/png', message, failOnCancel: false });
      } else if (await Sharing.isAvailableAsync()) {
        // Builds without react-native-share can't bundle text with the image —
        // put the message on the clipboard so it can be pasted as the caption.
        await Clipboard.setStringAsync(message);
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: t('rewards:wallet.shareDialogTitle'),
          UTI: 'public.png',
        });
      } else {
        await shareAsText(entry);
      }
    } catch {
      await shareAsText(entry);
    } finally {
      shareReadyRef.current = null;
      setPendingShare(null);
    }
  }, [captureEntry, t]);

  /** Keep the card image — Android writes to the member's chosen folder, iOS goes via the sheet's Save Image. */
  const handleSave = useCallback(async (entry: WalletEntry) => {
    Haptics.selectionAsync();
    try {
      const uri = await captureEntry(entry, 'save');
      const result = await saveCardImage(uri, cardFilename(`reward-${entry.reward_title ?? 'card'}`));
      if (result === 'saved') {
        setSavedId(entry.id);
        setTimeout(() => setSavedId((cur) => (cur === entry.id ? null : cur)), 2000);
      }
    } catch {
      // capture/write failed — nothing to hand over, button simply returns to rest
    } finally {
      shareReadyRef.current = null;
      setPendingShare(null);
    }
  }, [captureEntry]);

  const entries = tab === 'active' ? active : history;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('rewards:wallet.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.tabBar}>
        {(['active', 'history'] as WalletTab[]).map((tabKey) => (
          <Pressable key={tabKey} style={[styles.tabBtn, tab === tabKey && styles.tabBtnActive]} onPress={() => setTab(tabKey)}>
            <Text style={[styles.tabLabel, tab === tabKey && styles.tabLabelActive]}>
              {tabKey === 'active'
                ? active.length
                  ? t('rewards:wallet.tabs.activeCount', { n: active.length })
                  : t('rewards:wallet.tabs.active')
                : t('rewards:wallet.tabs.history')}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={GOLD} /></View>
      ) : error ? (
        <View style={styles.centered}><Text style={styles.statusText}>{error}</Text></View>
      ) : (
        <FlatList
          key={tab}
          data={entries}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <WalletCard
              entry={item}
              onShare={handleShare}
              onSave={handleSave}
              shareBusy={pendingShare?.id === item.id && pendingAction === 'share'}
              saveBusy={pendingShare?.id === item.id && pendingAction === 'save'}
              saved={savedId === item.id}
            />
          )}
          style={styles.scroll}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 40 },
            entries.length === 0 && styles.listEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          onEndReached={tab === 'history' ? loadMoreHistory : undefined}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            tab === 'active' ? (
              <View style={styles.centered}>
                <Ionicons name="gift-outline" size={28} color={MUTED} />
                <Text style={styles.statusText}>{t('rewards:wallet.emptyActive')}</Text>
                <Pressable style={({ pressed }) => [styles.browseBtn, pressed && { opacity: 0.85 }]} onPress={() => router.back()}>
                  <Text style={styles.browseBtnText}>{t('rewards:wallet.browse')}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.centered}>
                <Text style={styles.statusText}>{t('rewards:wallet.emptyHistory')}</Text>
              </View>
            )
          }
          ListFooterComponent={
            tab === 'history' && loadingMore ? (
              <ActivityIndicator color={GOLD} style={styles.footerSpinner} />
            ) : null
          }
        />
      )}

      {/* Off-screen share card, mounted only while a share is being prepared */}
      {pendingShare && (
        <View style={styles.sharePrep} pointerEvents="none">
          <RewardShareCard ref={shareCardRef} entry={pendingShare} width={360} onReady={handleCardReady} />
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '400', letterSpacing: 0.5, color: TEXT },
  headerSpacer: { width: 36 },

  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 3,
  },
  tabBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  tabBtnActive: { borderColor: TEXT },
  tabLabel: { fontSize: 12, fontWeight: '600', color: MUTED },
  tabLabelActive: { color: TEXT },

  scroll: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 8 },
  listEmpty: { flexGrow: 1 },
  footerSpinner: { paddingVertical: 16 },

  card: {
    backgroundColor: 'rgba(40,40,40,0.6)',
    borderWidth: 1, borderColor: BORDER, borderRadius: 16,
    padding: 16, marginBottom: 12, gap: 12,
    overflow: 'hidden',
  },
  cardBgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  cardInactive: { opacity: 0.55 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoBox: {
    width: 44, height: 44, borderRadius: 11, overflow: 'hidden', flexShrink: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  logoImg: { width: '100%', height: '100%' },
  logoFallback: { fontSize: 14, fontWeight: '700', color: DIM, letterSpacing: 1 },
  cardHeaderText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '400', color: TEXT },
  cardPartner: { fontSize: 12, fontWeight: '300', color: DIM },
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 1, flexShrink: 0,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusChipText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },

  codeBlock: {
    backgroundColor: '#111', borderWidth: 1, borderColor: 'rgba(232,210,0,0.2)',
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 6,
  },
  codeLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 2, color: MUTED },
  codeText: { fontSize: 18, fontWeight: '200', letterSpacing: 2.5, color: TEXT },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  copyLabel: { fontSize: 11, fontWeight: '300', color: MUTED },

  affiliateBlock: {
    backgroundColor: '#111', borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, padding: 14, alignItems: 'center',
  },
  affiliateText: { fontSize: 12, fontWeight: '300', color: DIM, textAlign: 'center' },

  expiry: { fontSize: 11, fontWeight: '300', color: MUTED, textAlign: 'center' },

  actions: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: GOLD, borderRadius: 20, paddingVertical: 12,
  },
  primaryBtnText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: '#0a0a0a', textTransform: 'uppercase' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: BORDER, borderRadius: 20, paddingVertical: 12, paddingHorizontal: 18,
  },
  secondaryBtnText: { fontSize: 12, fontWeight: '400', letterSpacing: 0.5, color: DIM, textTransform: 'uppercase' },
  iconBtn: { paddingHorizontal: 13 },

  sharePrep: { position: 'absolute', top: 0, left: -9999, width: 360 },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 80 },
  statusText: { fontSize: 14, color: MUTED },
  browseBtn: { borderWidth: 1, borderColor: BORDER, borderRadius: 20, paddingVertical: 11, paddingHorizontal: 22 },
  browseBtnText: { fontSize: 12, fontWeight: '500', letterSpacing: 0.5, color: TEXT, textTransform: 'uppercase' },
});

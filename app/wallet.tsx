import GeometricBackground from '@/components/GeometricBackground';
import {
  fetchWallet,
  partitionWallet,
  walletEntryStatus,
  type WalletEntry,
  type WalletStatus,
} from '@/lib/api/rewards';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Design tokens (match redeem-modal / points-ledger) ───────────────────────

const GOLD   = '#E8D200';
const BG     = '#0d0d0d';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';
const GREEN  = '#4ade80';
const BORDER = 'rgba(255,255,255,0.08)';

const STATUS_META: Record<WalletStatus, { label: string; color: string }> = {
  ready:   { label: 'Ready',   color: GREEN },
  used:    { label: 'Used',    color: DIM },
  expired: { label: 'Expired', color: MUTED },
};

function formatExpiry(entry: WalletEntry, status: WalletStatus): string {
  if (status === 'used') return 'Already used';
  if (!entry.expires_at) return 'No expiry';
  const d = new Date(entry.expires_at);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return status === 'expired' ? `Expired ${date}` : `Valid until ${date}`;
}

// ─── Wallet card ──────────────────────────────────────────────────────────────

function WalletCard({ entry }: { entry: WalletEntry }) {
  const [copied, setCopied] = useState(false);
  const status = walletEntryStatus(entry);
  const meta = STATUS_META[status];
  const isAffiliate = entry.integration_type === 'AFFILIATE';
  const inactive = status !== 'ready';
  const title = entry.reward_title ?? 'Reward';
  const partner = entry.partner_name;

  const copy = useCallback(() => {
    Clipboard.setStringAsync(entry.code);
    Haptics.selectionAsync();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [entry.code]);

  const share = useCallback(() => {
    const label = partner ? `${title} at ${partner}` : title;
    Share.share({
      message: isAffiliate
        ? `Here's a ${label} reward from POWR${entry.checkout_url ? `: ${entry.checkout_url}` : ''}`
        : `Here's my ${label} code from POWR: ${entry.code}${entry.checkout_url ? `\n${entry.checkout_url}` : ''}`,
      ...(entry.checkout_url ? { url: entry.checkout_url } : {}),
    }).catch(() => {});
  }, [isAffiliate, title, partner, entry.code, entry.checkout_url]);

  const openCheckout = useCallback(() => {
    if (entry.checkout_url) Linking.openURL(entry.checkout_url);
  }, [entry.checkout_url]);

  return (
    <View style={[styles.card, inactive && styles.cardInactive]}>
      {(entry.reward_hero_image_url ?? entry.reward_image_url) ? (
        <>
          <ExpoImage
            source={{ uri: entry.reward_hero_image_url ?? entry.reward_image_url! }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <View style={styles.cardBgOverlay} />
        </>
      ) : null}
      <View style={styles.cardHeader}>
        <View style={styles.logoBox}>
          {entry.reward_image_url ? (
            <ExpoImage source={{ uri: entry.reward_image_url }} style={styles.logoImg} contentFit="contain" />
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
          <Text style={[styles.statusChipText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {isAffiliate ? (
        <View style={styles.affiliateBlock}>
          <Text style={styles.affiliateText}>Discount applied automatically at checkout.</Text>
        </View>
      ) : (
        <Pressable style={styles.codeBlock} onPress={inactive ? undefined : copy} disabled={inactive}>
          <Text style={styles.codeLabel}>CODE</Text>
          <Text style={[styles.codeText, inactive && { color: DIM }]}>{entry.code}</Text>
          {!inactive && (
            <View style={styles.copyRow}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={12} color={copied ? GREEN : MUTED} />
              <Text style={[styles.copyLabel, copied && { color: GREEN }]}>{copied ? 'Copied' : 'Tap to copy'}</Text>
            </View>
          )}
        </Pressable>
      )}

      <Text style={styles.expiry}>{formatExpiry(entry, status)}</Text>

      {!inactive && (
        <View style={styles.actions}>
          {entry.checkout_url && (
            <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]} onPress={openCheckout}>
              <Ionicons name="open-outline" size={14} color="#0a0a0a" />
              <Text style={styles.primaryBtnText}>Use{partner ? ` at ${partner}` : ''}</Text>
            </Pressable>
          )}
          <Pressable style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]} onPress={share}>
            <Ionicons name="share-outline" size={14} color={DIM} />
            <Text style={styles.secondaryBtnText}>Share</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [entries, setEntries] = useState<WalletEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await fetchWallet());
      setError(null);
    } catch {
      setError('Could not load your wallet.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const { ready, past } = partitionWallet(entries);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>Wallet</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={GOLD} /></View>
      ) : error ? (
        <View style={styles.centered}><Text style={styles.statusText}>{error}</Text></View>
      ) : entries.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="gift-outline" size={28} color={MUTED} />
          <Text style={styles.statusText}>No rewards yet.</Text>
          <Pressable style={({ pressed }) => [styles.browseBtn, pressed && { opacity: 0.85 }]} onPress={() => router.back()}>
            <Text style={styles.browseBtnText}>Browse rewards</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {ready.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Ready to use</Text>
              {ready.map((e) => <WalletCard key={e.id} entry={e} />)}
            </>
          )}
          {past.length > 0 && (
            <>
              <Text style={[styles.sectionHeader, { marginTop: ready.length ? 24 : 0 }]}>Past</Text>
              {past.map((e) => <WalletCard key={e.id} entry={e} />)}
            </>
          )}
        </ScrollView>
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

  scroll: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 8 },
  sectionHeader: {
    fontSize: 9, fontWeight: '600', letterSpacing: 2, color: MUTED,
    textTransform: 'uppercase', marginBottom: 12,
  },

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

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 80 },
  statusText: { fontSize: 14, color: MUTED },
  browseBtn: { borderWidth: 1, borderColor: BORDER, borderRadius: 20, paddingVertical: 11, paddingHorizontal: 22 },
  browseBtnText: { fontSize: 12, fontWeight: '500', letterSpacing: 0.5, color: TEXT, textTransform: 'uppercase' },
});

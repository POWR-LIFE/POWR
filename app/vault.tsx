import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { LEVELS } from '@/constants/levels';
import { fetchVaultContents, type VaultDeposit } from '@/lib/api/vault';
import { usePoints } from '@/hooks/usePoints';

// ─── Design tokens (match wallet / points-ledger) ─────────────────────────────

const BG     = '#0d0d0d';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';
const GOLD   = '#E8D200';
const GREEN  = '#4ade80';
const ORANGE = '#FF9944';
const BORDER = 'rgba(255,255,255,0.08)';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function unlockCopy(iso: string): string {
  const days = daysUntil(iso);
  if (days <= 0) return 'Unlocking…';
  if (days === 1) return 'Unlocks tomorrow';
  return `Unlocks in ${days} days`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function depositLabel(d: VaultDeposit): string {
  if (d.source === 'level_up' && d.level) {
    const def = LEVELS.find((l) => l.level === d.level);
    return def ? `Level ${d.level} — ${def.name}` : `Level ${d.level} bonus`;
  }
  return d.description ?? 'Bonus points';
}

function depositSub(d: VaultDeposit): string {
  return d.source === 'level_up' ? 'Level-up bonus' : 'Earned over the daily cap';
}

// ─── Rows ────────────────────────────────────────────────────────────────────

function DepositRow({ deposit }: { deposit: VaultDeposit }) {
  const released = deposit.released_at !== null;
  const isLevel = deposit.source === 'level_up';
  const accent = released ? DIM : isLevel ? GOLD : ORANGE;

  return (
    <View style={[styles.row, released && { opacity: 0.55 }]}>
      <View style={[styles.rowIcon, { backgroundColor: accent + '18' }]}>
        <Ionicons
          name={released ? 'lock-open' : isLevel ? 'trophy' : 'flash'}
          size={16}
          color={accent}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{depositLabel(deposit)}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {released
            ? `Unlocked ${formatDate(deposit.released_at!)} · ${depositSub(deposit)}`
            : `${unlockCopy(deposit.vests_at)} · ${depositSub(deposit)}`}
        </Text>
      </View>
      <Text style={[styles.rowAmount, { color: released ? GREEN : TEXT }]}>
        +{deposit.amount.toLocaleString()}
      </Text>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function VaultScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { vaultPending, vaultNextVestAt } = usePoints();

  const { data, isPending, isError } = useQuery({
    queryKey: ['vault', 'contents'],
    queryFn: fetchVaultContents,
  });

  const pending = data?.pending ?? [];
  const released = data?.released ?? [];

  const sections = [
    ...(pending.length > 0 ? [{ title: 'Vesting', data: pending }] : []),
    ...(released.length > 0 ? [{ title: 'Unlocked', data: released }] : []),
  ];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>Vault</Text>
        <View style={styles.headerSpacer} />
      </View>

      {isPending ? (
        <View style={styles.centered}><ActivityIndicator color={GOLD} /></View>
      ) : isError ? (
        <View style={styles.centered}><Text style={styles.statusText}>Could not load your Vault.</Text></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => <DepositRow deposit={item} />}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          style={styles.scroll}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View style={styles.heroCard}>
              <View style={styles.heroIconWrap}>
                <Ionicons name="lock-closed" size={18} color={GOLD} />
              </View>
              <Text style={styles.heroAmount}>{vaultPending.toLocaleString()}</Text>
              <Text style={styles.heroLabel}>POWR vesting</Text>
              {vaultNextVestAt && vaultPending > 0 && (
                <View style={styles.heroNextRow}>
                  <View style={styles.heroDot} />
                  <Text style={styles.heroNextText}>
                    Next unlock {formatDate(vaultNextVestAt)}
                  </Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="lock-open-outline" size={28} color={MUTED} />
              <Text style={styles.statusText}>Nothing vesting yet.</Text>
              <Text style={styles.emptyHint}>
                Level up or push past a daily cap and the bonus banks here.
              </Text>
            </View>
          }
          ListFooterComponent={
            <Text style={styles.footerNote}>
              Vault points are bonus POWR — level-up rewards and points earned over
              a daily cap. They count towards your level straight away and unlock
              into your spendable balance automatically.
            </Text>
          }
        />
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '400', letterSpacing: 0.5, color: TEXT },
  headerSpacer: { width: 36 },

  scroll: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 4, flexGrow: 1 },

  heroCard: {
    alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(40,40,40,0.6)',
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.2)', borderRadius: 16,
    paddingVertical: 24, marginBottom: 16,
  },
  heroIconWrap: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(232,210,0,0.12)', marginBottom: 6,
  },
  heroAmount: { fontSize: 40, fontWeight: '200', letterSpacing: 1, color: TEXT },
  heroLabel: { fontSize: 10, fontWeight: '500', letterSpacing: 2, color: MUTED, textTransform: 'uppercase' },
  heroNextRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  heroDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD },
  heroNextText: { fontSize: 12, fontWeight: '300', color: DIM },

  sectionHeader: {
    fontSize: 10, fontWeight: '600', letterSpacing: 2, color: MUTED,
    textTransform: 'uppercase', marginTop: 8, marginBottom: 10,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: BORDER, borderRadius: 14,
    backgroundColor: 'rgba(40,40,40,0.45)',
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  rowIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 13, fontWeight: '400', color: TEXT },
  rowSub: { fontSize: 11, fontWeight: '300', color: MUTED },
  rowAmount: { fontSize: 15, fontWeight: '300', letterSpacing: 0.5 },

  emptyWrap: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  emptyHint: { fontSize: 12, fontWeight: '300', color: MUTED, textAlign: 'center', paddingHorizontal: 40 },

  footerNote: {
    fontSize: 11, fontWeight: '300', color: MUTED, lineHeight: 17,
    textAlign: 'center', paddingHorizontal: 24, paddingTop: 18,
  },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 80 },
  statusText: { fontSize: 14, color: MUTED },
});

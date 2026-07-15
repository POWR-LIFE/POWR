import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityIcon } from '@/components/ActivityIcon';
import GeometricBackground from '@/components/GeometricBackground';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { typography } from '@/constants/tokens';
import {
  fetchPointsSummary,
  fetchTransactionHistory,
  type PointTransaction,
} from '@/lib/api/points';

// ─── Design tokens (match settings-screen) ───────────────────────────────────

const BG     = '#0d0d0d';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';
const GOLD   = '#E8D200';
const GREEN  = '#00CC66';
const RED    = '#ef4444';
const ORANGE = '#FF9944';

// ─── Type metadata ────────────────────────────────────────────────────────────

const TYPE_META: Record<PointTransaction['type'], { icon: string; color: string; fallbackLabel: string }> = {
  earn:       { icon: 'flash',           color: GREEN,  fallbackLabel: 'Activity' },
  bonus:      { icon: 'star',            color: GOLD,   fallbackLabel: 'Bonus' },
  streak:     { icon: 'flame',           color: ORANGE, fallbackLabel: 'Streak Bonus' },
  adjustment: { icon: 'swap-horizontal', color: DIM,    fallbackLabel: 'Adjustment' },
  redeem:     { icon: 'bag-handle',      color: RED,    fallbackLabel: 'Reward Redeemed' },
  penalty:    { icon: 'warning',         color: RED,    fallbackLabel: 'Penalty' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateKey(iso: string): string {
  return iso.slice(0, 10); // "YYYY-MM-DD"
}

function formatSectionTitle(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (target.getTime() === today.getTime()) return 'Today';
  if (target.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatAmount(amount: number): string {
  return `${amount > 0 ? '+' : ''}${Math.abs(amount).toLocaleString()}`;
}

type Section = { title: string; data: PointTransaction[] };

function groupByDate(transactions: PointTransaction[]): Section[] {
  const map = new Map<string, PointTransaction[]>();
  for (const tx of transactions) {
    const key = toDateKey(tx.created_at);
    const group = map.get(key);
    if (group) {
      group.push(tx);
    } else {
      map.set(key, [tx]);
    }
  }
  return Array.from(map.entries()).map(([key, data]) => ({
    title: formatSectionTitle(key),
    data,
  }));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ balance, totalEarned }: { balance: number; totalEarned: number }) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryItem}>
        <Text style={styles.summaryValue}>{balance.toLocaleString()}</Text>
        <Text style={styles.summaryLabel}>Balance</Text>
      </View>
      <View style={styles.summaryDivider} />
      <View style={styles.summaryItem}>
        <Text style={styles.summaryValue}>{totalEarned.toLocaleString()}</Text>
        <Text style={styles.summaryLabel}>Total Earned</Text>
      </View>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );
}

/** Together (shared-challenge) base + bonus rows — surfaced distinctly. */
function isTogether(tx: PointTransaction): boolean {
  return tx.source === 'shared_challenge' || tx.source === 'shared_challenge_bonus';
}

function TxIcon({ tx }: { tx: PointTransaction }) {
  if (isTogether(tx)) {
    return (
      <View style={[styles.txIcon, { backgroundColor: GOLD + '18' }]}>
        <Ionicons name="people" size={16} color={GOLD} />
      </View>
    );
  }
  const activityConfig = tx.activity_type ? ACTIVITIES[tx.activity_type as ActivityType] : null;
  if (activityConfig) {
    return (
      <View style={[styles.txIcon, { backgroundColor: activityConfig.colour + '18' }]}>
        <ActivityIcon activity={activityConfig} size={16} color={activityConfig.colour} active={false} />
      </View>
    );
  }
  const meta = TYPE_META[tx.type] ?? TYPE_META.adjustment;
  return (
    <View style={[styles.txIcon, { backgroundColor: meta.color + '18' }]}>
      <Ionicons name={meta.icon as any} size={16} color={meta.color} />
    </View>
  );
}

function txLabel(tx: PointTransaction): string {
  if (tx.activity_type) {
    const config = ACTIVITIES[tx.activity_type as ActivityType];
    return config?.label ?? tx.description ?? (TYPE_META[tx.type]?.fallbackLabel ?? 'Activity');
  }
  return tx.description ?? (TYPE_META[tx.type]?.fallbackLabel ?? 'Activity');
}

function TxBadges({ tx }: { tx: PointTransaction }) {
  const badges: { label: string; color: string; bg: string }[] = [];

  if (isTogether(tx)) {
    badges.push({ label: 'TOGETHER', color: GOLD, bg: GOLD + '22' });
  }

  if (tx.type === 'streak') {
    badges.push({ label: 'STREAK', color: ORANGE, bg: ORANGE + '22' });
  } else if (tx.type === 'bonus') {
    badges.push({ label: 'BONUS', color: GOLD, bg: GOLD + '22' });
  } else if (tx.type === 'earn') {
    const isUpgrade = tx.description?.toLowerCase().includes('upgrade');
    if (isUpgrade) {
      // upgrade-gym-tier writes "gym session upgrade (Xmin)" where X is the
      // admin-tunable threshold; fall back to the historical 40.
      const mins = tx.description?.match(/\((\d+)\s*min\)/i)?.[1] ?? '40';
      badges.push({ label: `+${mins} MIN`, color: '#6EC6FF', bg: '#6EC6FF22' });
    } else if (tx.multiplier > 1) {
      const label = `×${tx.multiplier % 1 === 0 ? tx.multiplier.toFixed(0) : tx.multiplier.toFixed(1)}`;
      badges.push({ label, color: ORANGE, bg: ORANGE + '22' });
    }
  } else if (tx.type === 'adjustment') {
    badges.push({ label: 'ADJ', color: DIM, bg: 'rgba(255,255,255,0.08)' });
  } else if (tx.type === 'penalty') {
    badges.push({ label: 'PENALTY', color: RED, bg: RED + '22' });
  }

  if (badges.length === 0) return null;
  return (
    <View style={styles.badgeRow}>
      {badges.map((b) => (
        <View key={b.label} style={[styles.badge, { backgroundColor: b.bg }]}>
          <Text style={[styles.badgeText, { color: b.color }]}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A row a member can re-share as a session card: it must trace back to an
 * actual session and represent points won, not spends, penalties, adjustments
 * or the 0-pt capped streak rows.
 */
function isShareable(tx: PointTransaction): boolean {
  return tx.session_id !== null && tx.amount > 0 && (tx.type === 'earn' || tx.type === 'bonus');
}

function TransactionRow({
  tx,
  isFirst,
  isLast,
  onShare,
}: {
  tx: PointTransaction;
  isFirst: boolean;
  isLast: boolean;
  onShare?: () => void;
}) {
  const isPositive = tx.amount > 0;

  return (
    <Pressable
      onPress={onShare}
      disabled={!onShare}
      style={({ pressed }) => [
        styles.txRow,
        isFirst && styles.txRowFirst,
        isLast && styles.txRowLast,
        !isLast && styles.txRowBorder,
        pressed && onShare && { opacity: 0.6 },
      ]}
    >
      <TxIcon tx={tx} />
      <View style={styles.txBody}>
        <View style={styles.txLabelRow}>
          <Text style={styles.txLabel} numberOfLines={1}>
            {txLabel(tx)}
          </Text>
          <TxBadges tx={tx} />
        </View>
        <Text style={styles.txTime}>{formatTime(tx.created_at)}</Text>
      </View>
      <View style={styles.txRight}>
        <Text style={[styles.txAmount, { color: isPositive ? GREEN : RED }]}>
          {formatAmount(tx.amount)}
        </Text>
        <Text style={styles.txUnit}>POWR</Text>
      </View>
      {onShare && (
        <Ionicons name="share-social-outline" size={14} color={MUTED} style={styles.txShareHint} />
      )}
    </Pressable>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function PointsLedgerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [balance, setBalance] = useState(0);
  const [totalEarned, setTotalEarned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [txs, summary] = await Promise.all([
          fetchTransactionHistory(),
          fetchPointsSummary(),
        ]);
        setTransactions(txs);
        setBalance(summary.balance);
        setTotalEarned(summary.totalEarned);
      } catch {
        setError('Could not load history.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sections = useMemo(() => groupByDate(transactions), [transactions]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>Points History</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={GOLD} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.statusText}>{error}</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(tx) => tx.id}
          renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
          renderItem={({ item, index, section }) => (
            <TransactionRow
              tx={item}
              isFirst={index === 0}
              isLast={index === section.data.length - 1}
              onShare={
                isShareable(item)
                  ? () =>
                      router.push({
                        pathname: '/share-stats',
                        params: { mode: 'check-in', sessionId: item.session_id!, historical: '1' },
                      })
                  : undefined
              }
            />
          )}
          ListHeaderComponent={
            <SummaryCard balance={balance} totalEarned={totalEarned} />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.statusText}>No transactions yet.</Text>
            </View>
          }
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '400',
    letterSpacing: 0.5,
    color: TEXT,
  },
  headerSpacer: { width: 36 },

  listContent: {
    paddingHorizontal: 12,
    paddingTop: 16,
  },

  // Summary
  summaryCard: {
    flexDirection: 'row',
    paddingVertical: 20,
    marginBottom: 8,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  summaryValue: {
    fontFamily: typography.stat.fontFamily,
    fontSize: 30,
    letterSpacing: -1,
    color: GOLD,
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: MUTED,
    textTransform: 'uppercase',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 4,
  },

  // Section header
  sectionHeader: {
    paddingHorizontal: 4,
    paddingTop: 16,
    paddingBottom: 6,
  },
  sectionHeaderText: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 2,
    color: MUTED,
    textTransform: 'uppercase',
  },

  // Transaction rows
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    paddingVertical: 13,
  },
  txRowFirst: {},
  txRowLast: {},
  txRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  txIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  txBody: {
    flex: 1,
    gap: 2,
  },
  txLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  txLabel: {
    fontSize: 14,
    fontWeight: '300',
    color: TEXT,
    flexShrink: 1,
  },
  txTime: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  badge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  txRight: {
    alignItems: 'flex-end',
    gap: 1,
  },
  txShareHint: {
    marginLeft: 2,
  },
  txAmount: {
    fontFamily: typography.stat.fontFamily,
    fontSize: 16,
    letterSpacing: -0.5,
  },
  txUnit: {
    fontFamily: typography.label.fontFamily,
    fontSize: 7,
    letterSpacing: 1.5,
    color: MUTED,
  },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  statusText: {
    fontSize: 14,
    color: MUTED,
  },
});

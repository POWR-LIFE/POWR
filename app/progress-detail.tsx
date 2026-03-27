import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import GeometricBackground from '@/components/GeometricBackground';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchRecentSessions, type ActivitySession } from '@/lib/api/activity';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

// ─── Category config ──────────────────────────────────────────────────────────

type CategoryKey = 'movement' | 'workouts' | 'sleep';

interface CategoryConfig {
  key: CategoryKey;
  label: string;
  colour: string;
  types: string[];    // activity_session.type values that belong here
  unit: string;
  statLabel: string;
}

const CATEGORY_CONFIG: Record<CategoryKey, CategoryConfig> = {
  movement: {
    key: 'movement',
    label: 'Movement',
    colour: '#4ade80',
    types: ['running', 'cycling', 'walking', 'sports', 'swimming'],
    unit: 'sessions',
    statLabel: 'Active days',
  },
  workouts: {
    key: 'workouts',
    label: 'Workouts',
    colour: GOLD,
    types: ['gym', 'hiit', 'yoga', 'pilates'],
    unit: 'sessions',
    statLabel: 'Sessions',
  },
  sleep: {
    key: 'sleep',
    label: 'Sleep',
    colour: '#818cf8',
    types: ['sleep'],
    unit: 'hrs avg',
    statLabel: 'Avg hours',
  },
};

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m`.replace(' 0m', '') : `${m}m`;
}

function formatDistance(m: number | null): string | null {
  if (!m || m === 0) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function sessionDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function sessionPoints(s: ActivitySession): number {
  return (s.point_transactions ?? []).reduce((sum, t) => sum + t.amount, 0);
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProgressDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { category } = useLocalSearchParams<{ category: CategoryKey }>();

  const config = CATEGORY_CONFIG[category ?? 'movement'] ?? CATEGORY_CONFIG.movement;

  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRecentSessions(20).then(all => {
      setSessions(all.filter(s => config.types.includes(s.type)));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [config]);

  // Build weekly bar data from sessions (last 7 Mon–Sun)
  const weekBars = buildWeekBars(sessions, config.types);
  const weekMax = Math.max(...weekBars, 1);

  // Stats
  const totalSessions = sessions.length;
  const totalPoints   = sessions.reduce((sum, s) => sum + sessionPoints(s), 0);
  const avgDuration   = sessions.length
    ? Math.round(sessions.reduce((sum, s) => sum + s.duration_sec, 0) / sessions.length / 60)
    : 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={[styles.headerDot, { backgroundColor: config.colour }]} />
          <Text style={styles.title}>{config.label}</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 88 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Weekly activity chart ────────────────────────────── */}
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>This week</Text>
          <View style={styles.barChart}>
            {weekBars.map((count, i) => {
              const isToday = i === TODAY_INDEX;
              const isFuture = i > TODAY_INDEX;
              const height = count > 0 ? Math.max((count / weekMax) * 72, 10) : 4;
              return (
                <View key={i} style={styles.barCol}>
                  <View
                    style={[
                      styles.bar,
                      { height },
                      count > 0 && { backgroundColor: config.colour },
                      isToday && count === 0 && styles.barToday,
                      isFuture && styles.barFuture,
                    ]}
                  />
                  <Text style={[styles.barLabel, isToday && { color: config.colour }]}>
                    {DAY_LABELS[i]}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Stats row ────────────────────────────────────────── */}
        <View style={styles.statsRow}>
          <StatBlock label="Sessions" value={String(totalSessions)} />
          <View style={styles.statDivider} />
          <StatBlock label="Avg duration" value={avgDuration ? `${avgDuration}m` : '—'} />
          <View style={styles.statDivider} />
          <StatBlock label="Points earned" value={totalPoints > 0 ? String(totalPoints) : '—'} gold />
        </View>

        {/* ── Recent sessions ──────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Recent</Text>

        {loading && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Loading…</Text>
          </View>
        )}

        {!loading && sessions.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No {config.label.toLowerCase()} sessions yet.</Text>
            <Text style={styles.emptyHint}>Get moving to start tracking here.</Text>
          </View>
        )}

        {!loading && sessions.map(session => (
          <SessionRow key={session.id} session={session} colour={config.colour} />
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Session row ──────────────────────────────────────────────────────────────

function SessionRow({ session, colour }: { session: ActivitySession; colour: string }) {
  const pts    = sessionPoints(session);
  const detail = formatDistance(session.distance_m) ?? formatDuration(session.duration_sec);
  const label  = session.type.charAt(0).toUpperCase() + session.type.slice(1);

  return (
    <View style={styles.sessionRow}>
      <View style={[styles.sessionTypeDot, { backgroundColor: colour }]} />
      <View style={styles.sessionInfo}>
        <Text style={styles.sessionType}>{label}</Text>
        <Text style={styles.sessionMeta}>{sessionDate(session.started_at)} · {detail}</Text>
      </View>
      {pts > 0 && <Text style={styles.sessionPts}>+{pts} pts</Text>}
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildWeekBars(sessions: ActivitySession[], types: string[]): number[] {
  const bars = [0, 0, 0, 0, 0, 0, 0];
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  for (const s of sessions) {
    if (!types.includes(s.type)) continue;
    const d = new Date(s.started_at);
    if (d < monday) continue;
    const idx = d.getDay() === 0 ? 6 : d.getDay() - 1;
    bars[idx]++;
  }
  return bars;
}

function StatBlock({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, gold && { color: GOLD }]}>{value}</Text>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
  },
  backBtn: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerDot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 18, fontWeight: '300', color: TEXT, letterSpacing: -0.2 },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 12, gap: 10, paddingTop: 4 },

  sectionLabel: {
    fontSize: 9, fontWeight: '500', letterSpacing: 2, color: MUTED,
    textTransform: 'uppercase', paddingHorizontal: 2, paddingTop: 4,
  },

  // Chart
  chartCard: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    borderRadius: 16, padding: 14,
  },
  chartTitle: { fontSize: 12, fontWeight: '300', color: DIM, marginBottom: 16 },
  barChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 96,
    gap: 6,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
    gap: 6,
  },
  bar: {
    width: '100%',
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  barToday: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  barFuture: { opacity: 0.3 },
  barLabel: {
    fontSize: 9, fontWeight: '400', color: MUTED,
  },

  // Stats
  statsRow: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center',
  },
  statBlock: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { fontSize: 20, fontWeight: '100', letterSpacing: -0.8, color: TEXT },
  statLabel: { fontSize: 8, fontWeight: '500', letterSpacing: 1.5, color: MUTED, textTransform: 'uppercase' },
  statDivider: { width: 1, height: 28, backgroundColor: BORDER },

  // Sessions
  sessionRow: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    borderRadius: 14, padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  sessionTypeDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  sessionInfo: { flex: 1, gap: 3 },
  sessionType: { fontSize: 14, fontWeight: '300', color: TEXT },
  sessionMeta: { fontSize: 11, fontWeight: '300', color: DIM },
  sessionPts: { fontSize: 12, fontWeight: '400', color: GOLD, flexShrink: 0 },

  // Empty state
  emptyState: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    borderRadius: 14, padding: 24, alignItems: 'center', gap: 6,
  },
  emptyText: { fontSize: 14, fontWeight: '300', color: DIM },
  emptyHint: { fontSize: 12, fontWeight: '300', color: MUTED },
});

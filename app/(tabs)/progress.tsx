import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { GeometricBackground } from '@/components/home/GeometricBackground';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProfileButton } from '@/components/ProfileButton';
import { useActivity } from '@/hooks/useActivity';
import { usePoints } from '@/hooks/usePoints';
import { JOURNEY_SECTIONS, resolveSections, allLessons } from '@/lib/journey';

// ─── Constants ────────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const GREEN   = '#4ade80';
const RED     = '#f87171';
const BG      = '#1E1E1E';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

const CATEGORIES = [
  { key: 'movement', label: 'Movement', colour: GREEN,     icon: 'walk'           },
  { key: 'workouts', label: 'Workouts', colour: GOLD,      icon: 'barbell-outline'},
  { key: 'sleep',    label: 'Sleep',    colour: '#818cf8', icon: 'moon-outline'   },
] as const;

const COMPLETED_IDS   = new Set([
  'l-001', 'l-002', 'l-003', 'l-004', 'l-005', 'l-006',
  'l-007', 'l-008', 'l-009', 'l-010', 'l-011', 'l-012',
]);
const SECTIONS        = resolveSections(JOURNEY_SECTIONS, COMPLETED_IDS);
const ALL_LESSONS     = allLessons(SECTIONS);
const COMPLETED_COUNT = ALL_LESSONS.filter(l => l.state === 'completed').length;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { weekActiveDays, weeklyMetrics } = useActivity();
  const { weeklyEarned } = usePoints();

  const activeDaysCount = weekActiveDays.filter(Boolean).length;
  const trendPct = 12; // Placeholder for now

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      <View style={styles.header}>
        <Text style={styles.title}>Progress</Text>
        <ProfileButton />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Weekly Visualiser ────────────────────────── */}
        <WeeklyVisualizer activeDays={weekActiveDays} />

        {/* ── Stats Grid ─────────────────────────────── */}
        <View style={styles.gridContainer}>
          <StatCard
            label="Gym Visits"
            value={String(weeklyMetrics.gymVisits)}
            icon="barbell"
            colour={GOLD}
          />
          <StatCard
            label="Sessions"
            value={String(weeklyMetrics.sessionCount)}
            icon="flash"
            colour={GREEN}
          />
          <StatCard
            label="Steps"
            value={weeklyMetrics.totalSteps >= 1000 ? `${(weeklyMetrics.totalSteps / 1000).toFixed(1)}k` : String(weeklyMetrics.totalSteps)}
            icon="footsteps"
            colour="#fb923c"
          />
          <StatCard
            label="POWR Earned"
            value={String(weeklyEarned)}
            icon="trophy"
            colour={GOLD}
            isGold
          />
        </View>

        {/* ── Insight Card ────────────────────────────── */}
        <InsightCard activeDaysCount={activeDaysCount} trendPct={trendPct} />

        {/* ── Category Breakdown ─────────────────────── */}
        <Text style={styles.sectionLabel}>DETAILED BREAKDOWN</Text>
        <View style={styles.categoryCard}>
          {CATEGORIES.map((cat, i) => (
            <CategoryRow
              key={cat.key}
              label={cat.label}
              value={
                cat.key === 'movement' ? `${weeklyMetrics.sessionCount} sessions this week` :
                cat.key === 'workouts' ? `${weeklyMetrics.gymVisits} visits logged` :
                '6.8h avg sleep'
              }
              colour={cat.colour}
              icon={cat.icon}
              isLast={i === CATEGORIES.length - 1}
              onPress={() => router.push({ pathname: '/progress-detail', params: { category: cat.key } })}
            />
          ))}
        </View>

        {/* ── Achievements teaser ────────────────────── */}
        <AchievementsTeaser
          completedCount={COMPLETED_COUNT}
          onPress={() => router.push({ pathname: '/(tabs)/league', params: { tab: 'journey' } })}
        />
      </ScrollView>
    </View>
  );
}

// ─── Weekly Visualizer ────────────────────────────────────────────────────────

function WeeklyVisualizer({ activeDays }: { activeDays: boolean[] }) {
  return (
    <View style={styles.visualizerCard}>
      <Text style={styles.visualizerLabel}>WEEKLY ACTIVITY</Text>
      <View style={styles.daysRow}>
        {DAY_LABELS.map((day, i) => {
          const isActive = activeDays[i];
          const isToday = i === TODAY_INDEX;
          return (
            <View key={i} style={styles.dayCol}>
              <View style={[
                styles.dayIndicator,
                isActive && styles.dayIndicatorActive,
                isToday && !isActive && styles.dayIndicatorToday
              ]}>
                {isActive && (
                  <LinearGradient
                    colors={[GOLD, '#B8A600']}
                    style={StyleSheet.absoluteFill}
                  />
                )}
                {isActive && <Ionicons name="checkmark" size={14} color="#000" />}
              </View>
              <Text style={[styles.dayText, isToday && { color: TEXT, fontWeight: '600' }]}>
                {day.charAt(0)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, colour, isGold }: { label: string; value: string; icon: string; colour: string; isGold?: boolean }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statHeader, { borderBottomColor: `${colour}20` }]}>
        <Ionicons name={icon as any} size={14} color={colour} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <View style={styles.statBody}>
        <Text style={[styles.statValue, isGold && { color: GOLD }]}>{value}</Text>
      </View>
    </View>
  );
}

// ─── Insight Card ─────────────────────────────────────────────────────────────

function InsightCard({ activeDaysCount, trendPct }: { activeDaysCount: number; trendPct: number }) {
  return (
    <LinearGradient
      colors={['rgba(232,210,0,0.12)', 'rgba(40,40,40,0.85)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.insightCard}
    >
      <View style={styles.insightHeader}>
        <Ionicons name="sparkles" size={16} color={GOLD} />
        <Text style={styles.insightTitle}>POWR INSIGHT</Text>
      </View>
      <Text style={styles.insightText}>
        {activeDaysCount >= 3 
          ? "You're building momentum. Your consistency is your edge—keep the streak alive."
          : "Every move counts. You're just a session away from hitting your weekly rhythm."}
      </Text>
      <View style={styles.insightTrendRow}>
        <Ionicons name="trending-up" size={12} color={GREEN} />
        <Text style={styles.insightTrendText}>+{trendPct}% vs last week</Text>
      </View>
    </LinearGradient>
  );
}

// ─── Category Row ─────────────────────────────────────────────────────────────

function CategoryRow({
  label, value, colour, icon, isLast, onPress,
}: {
  label: string; value: string; colour: string; icon: string; isLast: boolean; onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.catRow,
        !isLast && styles.catRowBorder,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.catIconWrap, { borderColor: `${colour}40`, backgroundColor: `${colour}14` }]}>
        <Ionicons name={icon as any} size={18} color={colour} />
      </View>
      <View style={styles.catTextBlock}>
        <Text style={styles.catLabel}>{label}</Text>
        <Text style={styles.catMeta}>{value}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={MUTED} />
    </Pressable>
  );
}

// ─── Achievements Teaser ──────────────────────────────────────────────────────

function AchievementsTeaser({
  completedCount, onPress,
}: {
  completedCount: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.achievementsTeaser, pressed && { opacity: 0.65 }]}
    >
      <Text style={styles.achievementsText}>
        Achievements · {completedCount} unlocked
      </Text>
      <Ionicons name="chevron-forward" size={14} color={MUTED} />
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: BG },
  header: {
    paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  title:   { fontSize: 32, fontWeight: '200', letterSpacing: -0.8, color: TEXT },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: 12, gap: 12, paddingTop: 4 },

  sectionLabel: {
    fontSize: 9, fontWeight: '600', letterSpacing: 1.5,
    color: MUTED, textTransform: 'uppercase', paddingHorizontal: 4, marginTop: 8,
  },

  // Weekly Visualizer
  visualizerCard: {
    padding: 16, borderRadius: 20,
    backgroundColor: CARD_BG,
    borderWidth: 1, borderColor: BORDER,
    gap: 16,
  },
  visualizerLabel: {
    fontSize: 9, fontWeight: '600', letterSpacing: 1.5, color: MUTED,
  },
  daysRow: {
    flexDirection: 'row', justifyContent: 'space-between',
  },
  dayCol: {
    alignItems: 'center', gap: 8,
  },
  dayIndicator: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  dayIndicatorActive: {
    borderColor: GOLD,
  },
  dayIndicatorToday: {
    borderColor: 'rgba(255,255,255,0.4)',
  },
  dayText: {
    fontSize: 10, fontWeight: '400', color: MUTED,
  },

  // Stats Grid
  gridContainer: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
  },
  statCard: {
    width: '48.5%', padding: 14, borderRadius: 18,
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    gap: 8,
  },
  statHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingBottom: 6, borderBottomWidth: 1,
  },
  statLabel: {
    fontSize: 10, fontWeight: '500', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  statBody: {
    paddingTop: 2,
  },
  statValue: {
    fontSize: 24, fontWeight: '200', color: TEXT, letterSpacing: -0.5,
  },

  // Insight Card
  insightCard: {
    padding: 16, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.2)',
    gap: 10,
  },
  insightHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  insightTitle: {
    fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 1,
  },
  insightText: {
    fontSize: 14, fontWeight: '300', color: TEXT, lineHeight: 20,
  },
  insightTrendRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  insightTrendText: {
    fontSize: 11, fontWeight: '400', color: GREEN,
  },

  // Category card
  categoryCard: {
    borderRadius: 20, backgroundColor: CARD_BG,
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
  },
  catRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 14,
  },
  catRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  catIconWrap: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, flexShrink: 0,
  },
  catTextBlock: { flex: 1, gap: 3 },
  catLabel:     { fontSize: 16, fontWeight: '300', color: TEXT },
  catMeta:      { fontSize: 12, fontWeight: '300', color: DIM },

  // Achievements teaser
  achievementsTeaser: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 8, marginTop: 4,
  },
  achievementsText: { fontSize: 13, fontWeight: '300', color: DIM },
});

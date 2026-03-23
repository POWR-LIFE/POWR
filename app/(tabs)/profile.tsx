import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#facc15';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';
const ORANGE  = '#f97316';

// ─── Mock data ────────────────────────────────────────────────────────────────

const USER = {
  initials:    'AJ',
  level:       2,
  levelName:   'Mover',
  totalPoints: 8_340,
  sessions:    47,
  bestStreak:  14,
  streak:      12,
};

const WEEK_BARS = [
  { day: 'M', fill: 0.9,  pts: 120 },
  { day: 'T', fill: 0.6,  pts: 80  },
  { day: 'W', fill: 1.0,  pts: 155 },
  { day: 'T', fill: 0.0,  pts: 0   },
  { day: 'F', fill: 0.75, pts: 100 },
  { day: 'S', fill: 0.5,  pts: 65  },
  { day: 'S', fill: 0.0,  pts: 0   },
];

const TODAY_IDX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

// Month-over-month totals (mock)
const MONTHLY_BARS = [
  { month: 'Oct', pts: 920  },
  { month: 'Nov', pts: 1340 },
  { month: 'Dec', pts: 870  },
  { month: 'Jan', pts: 1580 },
  { month: 'Feb', pts: 1220 },
  { month: 'Mar', pts: 670  }, // current
];
const MONTHLY_MAX = Math.max(...MONTHLY_BARS.map((b) => b.pts));

interface Achievement {
  id: string; icon: string; label: string; earned: boolean;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: '1', icon: '🔥', label: 'On Fire',   earned: true  },
  { id: '2', icon: '🏃', label: 'First Run', earned: true  },
  { id: '3', icon: '💪', label: 'Gym Rat',   earned: true  },
  { id: '4', icon: '🌊', label: 'Swimmer',   earned: false },
  { id: '5', icon: '⚡', label: 'Streak 30', earned: false },
  { id: '6', icon: '🏆', label: 'Elite',     earned: false },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* ── Header ──────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <Pressable
          style={styles.avatarBtn}
          onPress={() => router.push('/profile-screen')}
        >
          <Text style={styles.avatarText}>{USER.initials}</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Summary stats ────────────────────────────────── */}
        <View style={styles.statsRow}>
          <StatBlock value={USER.totalPoints.toLocaleString()} label="TOTAL POWR" gold />
          <View style={styles.statDivider} />
          <StatBlock value={String(USER.sessions)} label="SESSIONS" />
          <View style={styles.statDivider} />
          <StatBlock value={`${USER.bestStreak}d`} label="BEST STREAK" />
        </View>

        {/* ── This week ─────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.metaLabel}>THIS WEEK</Text>
          <View style={styles.weekBars}>
            {WEEK_BARS.map((bar, i) => {
              const isToday = i === TODAY_IDX;
              return (
                <View key={i} style={styles.barCol}>
                  <View style={styles.barTrack}>
                    {bar.fill > 0 && (
                      <View
                        style={[
                          styles.barFill,
                          { height: `${bar.fill * 100}%` as any },
                          isToday && styles.barFillToday,
                        ]}
                      />
                    )}
                  </View>
                  <Text style={[styles.barDay, isToday && styles.barDayToday]}>
                    {bar.day}
                  </Text>
                </View>
              );
            })}
          </View>
          <View style={styles.weekFooter}>
            <Text style={styles.weekFooterText}>5 active days</Text>
            <Text style={styles.weekFooterPts}>+520 pts this week</Text>
          </View>
        </View>

        {/* ── Streak ────────────────────────────────────────── */}
        <View style={[styles.card, styles.streakCard]}>
          <View style={styles.streakLeft}>
            <Text style={styles.metaLabel}>CURRENT STREAK</Text>
            <Text style={styles.streakNumber}>{USER.streak}</Text>
            <Text style={styles.streakUnit}>
              days · <Text style={styles.streakBonus}>2.5× points</Text>
            </Text>
          </View>
          <View style={styles.streakRight}>
            <View style={styles.fireBadge}>
              <View style={styles.fireDot} />
              <Text style={styles.fireText}>ON FIRE</Text>
            </View>
            <Text style={styles.streakBest}>Best: {USER.bestStreak}d</Text>
          </View>
        </View>

        {/* ── Monthly history ───────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.metaLabel}>MONTHLY HISTORY</Text>
            <Text style={styles.monthlyTotal}>
              {MONTHLY_BARS.reduce((s, b) => s + b.pts, 0).toLocaleString()} pts total
            </Text>
          </View>
          <View style={styles.monthlyBars}>
            {MONTHLY_BARS.map((bar, i) => {
              const isCurrent = i === MONTHLY_BARS.length - 1;
              const fill = bar.pts / MONTHLY_MAX;
              return (
                <View key={bar.month} style={styles.monthlyBarCol}>
                  <Text style={[styles.monthlyPts, isCurrent && { color: GOLD }]}>
                    {bar.pts >= 1000 ? `${(bar.pts / 1000).toFixed(1)}k` : bar.pts}
                  </Text>
                  <View style={styles.monthlyBarTrack}>
                    <View
                      style={[
                        styles.monthlyBarFill,
                        { height: `${fill * 100}%` as any },
                        isCurrent && styles.monthlyBarFillCurrent,
                      ]}
                    />
                  </View>
                  <Text style={[styles.monthlyLabel, isCurrent && { color: GOLD }]}>
                    {bar.month}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Achievements ──────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.metaLabel}>ACHIEVEMENTS</Text>
            <Pressable>
              <Text style={styles.seeAll}>See all →</Text>
            </Pressable>
          </View>
          <View style={styles.achievementsRow}>
            {ACHIEVEMENTS.map((a) => (
              <View key={a.id} style={[styles.badge, !a.earned && styles.badgeLocked]}>
                <Text style={[styles.badgeIcon, !a.earned && styles.badgeIconLocked]}>
                  {a.earned ? a.icon : '?'}
                </Text>
                <Text style={[styles.badgeLabel, !a.earned && styles.badgeLabelLocked]}>
                  {a.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Level progress ────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.metaLabel}>LEVEL PROGRESS</Text>
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeText}>
                LVL {USER.level} · {USER.levelName}
              </Text>
            </View>
          </View>

          <View style={styles.xpRow}>
            <Text style={styles.xpValue}>710</Text>
            <Text style={styles.xpSep}>/</Text>
            <Text style={styles.xpMax}>1,000 XP</Text>
          </View>

          <View style={styles.xpBarTrack}>
            <View style={[styles.xpBarFill, { width: '71%' }]} />
          </View>

          <Text style={styles.xpHint}>
            1 more gym visit → Level 3 · Builder
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatBlock({
  value,
  label,
  gold,
}: {
  value: string;
  label: string;
  gold?: boolean;
}) {
  return (
    <View style={styles.statBlock}>
      <Text style={[styles.statValue, gold && styles.statValueGold]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
    paddingTop: 12,
    paddingBottom: 6,
  },
  title: {
    fontSize: 32,
    fontWeight: '200',
    letterSpacing: -0.5,
    color: TEXT,
  },
  avatarBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0a0a0a',
  },

  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 12,
    gap: 8,
    paddingTop: 4,
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 2,
    color: MUTED,
    textTransform: 'uppercase',
  },

  // Stats row
  statsRow: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statBlock: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { fontSize: 22, fontWeight: '100', letterSpacing: -1, color: TEXT },
  statValueGold: { color: GOLD },
  statLabel: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: MUTED,
    textTransform: 'uppercase',
  },
  statDivider: { width: 1, height: 32, backgroundColor: BORDER },

  // Card
  card: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  seeAll: {
    fontSize: 11,
    fontWeight: '300',
    color: GOLD,
  },
  monthlyTotal: {
    fontSize: 11,
    fontWeight: '300',
    color: DIM,
  },

  // Week bars
  weekBars: { flexDirection: 'row', gap: 6, height: 72, alignItems: 'flex-end' },
  barCol: { flex: 1, alignItems: 'center', gap: 5, height: '100%', justifyContent: 'flex-end' },
  barTrack: {
    flex: 1,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  barFill: { width: '100%', backgroundColor: 'rgba(250,204,21,0.45)', borderRadius: 4 },
  barFillToday: { backgroundColor: GOLD },
  barDay: { fontSize: 9, fontWeight: '500', color: MUTED, textTransform: 'uppercase' },
  barDayToday: { color: GOLD },
  weekFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  weekFooterText: { fontSize: 11, fontWeight: '300', color: DIM },
  weekFooterPts: { fontSize: 11, fontWeight: '400', color: GOLD },

  // Streak card
  streakCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  streakLeft: { gap: 2 },
  streakNumber: { fontSize: 52, fontWeight: '100', letterSpacing: -2, color: GOLD, lineHeight: 54 },
  streakUnit: { fontSize: 11, fontWeight: '300', color: DIM },
  streakBonus: { color: GOLD, fontWeight: '400' },
  streakRight: { alignItems: 'flex-end', gap: 10 },
  fireBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  fireDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: ORANGE },
  fireText: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: TEXT,
    textTransform: 'uppercase',
  },
  streakBest: { fontSize: 11, fontWeight: '300', color: MUTED },

  // Monthly bars
  monthlyBars: {
    flexDirection: 'row',
    gap: 8,
    height: 90,
    alignItems: 'flex-end',
  },
  monthlyBarCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    height: '100%',
    justifyContent: 'flex-end',
  },
  monthlyPts: {
    fontSize: 8,
    fontWeight: '400',
    color: DIM,
  },
  monthlyBarTrack: {
    flex: 1,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  monthlyBarFill: {
    width: '100%',
    backgroundColor: 'rgba(250,204,21,0.30)',
    borderRadius: 4,
  },
  monthlyBarFillCurrent: {
    backgroundColor: GOLD,
  },
  monthlyLabel: {
    fontSize: 8,
    fontWeight: '500',
    color: MUTED,
    textTransform: 'uppercase',
  },

  // Achievements
  achievementsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  badge: {
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(250,204,21,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.20)',
    minWidth: 64,
  },
  badgeLocked: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: BORDER },
  badgeIcon: { fontSize: 22 },
  badgeIconLocked: { opacity: 0.2 },
  badgeLabel: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: GOLD,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  badgeLabelLocked: { color: MUTED },

  // Level progress
  levelBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: 'rgba(250,204,21,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.25)',
  },
  levelBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: GOLD,
    textTransform: 'uppercase',
  },
  xpRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  xpValue: {
    fontSize: 36,
    fontWeight: '100',
    letterSpacing: -1,
    color: GOLD,
    lineHeight: 38,
  },
  xpSep: {
    fontSize: 20,
    fontWeight: '200',
    color: MUTED,
  },
  xpMax: {
    fontSize: 14,
    fontWeight: '300',
    color: DIM,
  },
  xpBarTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  xpBarFill: {
    height: '100%',
    backgroundColor: GOLD,
    borderRadius: 2,
  },
  xpHint: {
    fontSize: 11,
    fontWeight: '300',
    color: DIM,
    marginTop: -4,
  },
});

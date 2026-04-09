import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState, useEffect } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RadialCarousel } from '@/components/home/RadialCarousel';
import { ProgressRadial } from '@/components/home/ProgressRadial';
import { GeometricBackground } from '@/components/home/GeometricBackground';
import { ProfileButton } from '@/components/ProfileButton';
import { useAuth } from '@/context/AuthContext';
import { useActivity } from '@/hooks/useActivity';
import { usePoints } from '@/hooks/usePoints';
import { useWalkingProgress } from '@/hooks/useWalkingProgress';
import { useHealthData } from '@/hooks/useHealthData';
import { JOURNEY_SECTIONS, resolveSections, allLessons } from '@/lib/journey';
import { getLevelInfo } from '@/constants/levels';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { fetchProfile } from '@/lib/api/user';
import { fetchWeeklySleepHours } from '@/lib/api/activity';

// ─── Constants ────────────────────────────────────────────────────────────────

const GOLD   = '#E8D200';
const GREEN  = '#4ade80';
const ORANGE = '#fb923c';
const INDIGO = '#818cf8';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

// Fallback when no real sleep data is available yet
const EMPTY_SLEEP_HRS = [0, 0, 0, 0, 0, 0, 0];

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
  const { user } = useAuth();
  const { weekActiveDays, weeklyMetrics, refresh: refreshActivity } = useActivity();
  const { totalEarned, weeklyEarned } = usePoints();
  const walking = useWalkingProgress();

  const [activePrefs, setActivePrefs] = useState<ActivityType[]>(['gym', 'running', 'walking']);
  const [sleepHrs, setSleepHrs] = useState<number[]>(EMPTY_SLEEP_HRS);
  const [sleepBedtimes, setSleepBedtimes] = useState<(string | null)[]>([null, null, null, null, null, null, null]);
  const health = useHealthData();

  // Fetch real sleep data from synced activity sessions
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const loadSleep = async () => {
      try {
        const { hours, bedtimes } = await fetchWeeklySleepHours();
        if (mounted) {
          setSleepHrs(hours);
          setSleepBedtimes(bedtimes);
        }

        // If last night has no data yet but health is authorized, try fetching directly
        const lastNightIdx = TODAY_INDEX === 0 ? 6 : TODAY_INDEX - 1;
        if (hours[TODAY_INDEX] === 0 && health.isAuthorized) {
          const lastNight = await health.getLastNightSleep();
          if (lastNight && mounted) {
            const updated = [...hours];
            updated[TODAY_INDEX] = lastNight.durationHours;
            setSleepHrs(updated);
            if (lastNight.startedAt) {
              const updatedBedtimes = [...bedtimes];
              updatedBedtimes[TODAY_INDEX] = lastNight.startedAt;
              setSleepBedtimes(updatedBedtimes);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching sleep data:', err);
      }
    };
    loadSleep();
    return () => { mounted = false; };
  }, [user, health.isAuthorized]);

  // Fetch and sync activity preferences
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const syncPrefs = async () => {
      try {
        const profile = await fetchProfile();
        if (profile?.activity_preferences && profile.activity_preferences.length > 0) {
          if (mounted) setActivePrefs(profile.activity_preferences as ActivityType[]);
        }
      } catch (err) {
        console.error('Error syncing preferences:', err);
      }
    };
    syncPrefs();
    return () => { mounted = false; };
  }, [user]);

  const activeDaysCount = weekActiveDays.filter(Boolean).length;
  const stepsF = weeklyMetrics.totalSteps >= 1000
    ? `${(weeklyMetrics.totalSteps / 1000).toFixed(1)}k`
    : String(weeklyMetrics.totalSteps);

  const [activeTab, setActiveTab] = useState<string>('walking');
  
  // Build dynamic radial data
  const radialData = activePrefs.map((type, idx) => {
    const config = ACTIVITIES[type];
    if (type === 'walking') {
      return {
        id: 'walking',
        pct: Math.min(weeklyMetrics.totalSteps / 10000, 1),
        value: stepsF,
        maxLabel: ' steps',
        subLabel: 'TODAY',
        gradientColors: [GREEN, '#10b981'],
        iconName: config.iconActive,
        iconLib: config.iconLib,
        ticks: DAY_LABELS.map((label, i) => ({
          label: label.slice(0, 2),
          active: weekActiveDays[i],
          isToday: i === TODAY_INDEX,
        })),
      };
    }

    const count = weeklyMetrics.perType[type] ?? 0;
    return {
      id: type,
      pct: Math.min(count / 5, 1),
      value: String(count),
      maxLabel: '/ 5',
      subLabel: `${config.labelShort.toUpperCase()} SESSIONS`,
      gradientColors: [config.colour, ORANGE],
      iconName: config.iconActive,
      iconLib: config.iconLib,
    };
  });

  // Append Sleep as a final passive radial
  const daysWithSleep = sleepHrs.filter(h => h > 0).length;
  const avgSleep = daysWithSleep > 0
    ? sleepHrs.reduce((s, v) => s + v, 0) / daysWithSleep
    : 0;
  radialData.push({
    id: 'sleep',
    pct: Math.min(avgSleep / 8, 1),
    value: avgSleep.toFixed(1),
    maxLabel: 'h',
    subLabel: 'AVG SLEEP',
    gradientColors: [INDIGO, '#6366f1'],
    iconName: 'moon',
    iconLib: 'ionicons',
  });

  const tabs = radialData.map(d => d.id);
  const activeIndex = tabs.indexOf(activeTab);

  const handleIndexChange = (index: number) => {
    setActiveTab(tabs[index]);
  };

  // Set initial tab once prefs load
  useEffect(() => {
    if (tabs.length > 0 && !tabs.includes(activeTab)) {
      setActiveTab(tabs[0]);
    }
  }, [tabs]);

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

        {/* ── Swipable Radials ───────────────────────────── */}
        <RadialCarousel 
          data={radialData} 
          activeIndex={activeIndex} 
          onChange={handleIndexChange} 
        />

        {/* ── Breakdown Tabs ─────────────────────────────── */}
        <BreakdownSection
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          tabs={radialData.map(d => ({ key: d.id, label: ACTIVITIES[d.id as ActivityType]?.labelShort.toUpperCase() || d.id.toUpperCase() }))}
          walking={walking}
          weeklyMetrics={weeklyMetrics}
          stepsF={stepsF}
          weekActiveDays={weekActiveDays}
          weeklyEarned={weeklyEarned}
          sleepHrs={sleepHrs}
          sleepBedtimes={sleepBedtimes}
        />

        {/* ── Weekly Summary ─────────────────────────────── */}
        <View style={styles.weeklySummary}>
          <Text style={styles.summaryLabel}>TOTAL EARNED THIS WEEK</Text>
          <View style={styles.summaryValueRow}>
            <Text style={styles.summaryValue}>{weeklyEarned}</Text>
            <Text style={styles.summaryUnit}>POWR</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}


// Removed WeeklyRing logic


type BreakdownTabItem = { key: string; label: string };

function BreakdownSection({
  activeTab, setActiveTab, tabs, walking, weeklyMetrics, stepsF, weekActiveDays, weeklyEarned, sleepHrs, sleepBedtimes,
}: {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  tabs: BreakdownTabItem[];
  walking: ReturnType<typeof useWalkingProgress>;
  weeklyMetrics: any;
  stepsF: string;
  weekActiveDays: boolean[];
  weeklyEarned: number;
  sleepHrs: number[];
  sleepBedtimes: (string | null)[];
}) {
  return (
    <View style={styles.breakdownCard}>
      <View style={styles.tabBar}>
        {tabs.map(({ key, label }) => {
          const isActive = activeTab === key;
          return (
            <Pressable key={key} style={styles.tabItem} onPress={() => setActiveTab(key)}>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{label}</Text>
              {isActive && <View style={styles.tabIndicator} />}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.tabContent}>
        {activeTab === 'walking' && (
          <MovementTab walking={walking} totalSteps={weeklyMetrics.totalSteps} stepsF={stepsF} weekActiveDays={weekActiveDays} />
        )}
        {activeTab !== 'walking' && activeTab !== 'sleep' && (
          <WorkoutsTab 
            type={activeTab as ActivityType}
            count={weeklyMetrics.perType[activeTab] ?? 0}
            weekActiveDays={weekActiveDays} 
            weeklyEarned={weeklyEarned} 
          />
        )}
        {activeTab === 'sleep' && <SleepTab sleepHrs={sleepHrs} sleepBedtimes={sleepBedtimes} />}
      </View>
    </View>
  );
}


// ─── Movement Tab ─────────────────────────────────────────────────────────────

function MovementTab({
  walking, totalSteps, stepsF, weekActiveDays,
}: {
  walking: ReturnType<typeof useWalkingProgress>;
  totalSteps: number;
  stepsF: string;
  weekActiveDays: boolean[];
}) {
  const todaySteps = walking.isAuthorized ? (walking.stepsToday ?? 0) : 0;
  const todayPct   = Math.min(todaySteps / 10000, 1);
  const weeklyPct  = Math.min(totalSteps / 70000, 1);
  const remaining  = Math.max(0, 10000 - todaySteps);

  return (
    <View style={styles.tabPanel}>
      {/* Primary metrics */}
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>TODAY</Text>
          <Text style={[styles.bigMetricVal, { color: GREEN }]}>
            {walking.isAuthorized && todaySteps > 0 ? todaySteps.toLocaleString() : '—'}
          </Text>
          <Text style={styles.bigMetricMax}>/ 10,000 steps</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(todayPct * 100)}%` as any, backgroundColor: GREEN }]} />
          </View>
        </View>
        <View style={styles.bigMetricDivider} />
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>THIS WEEK</Text>
          <Text style={[styles.bigMetricVal, { color: GREEN }]}>{stepsF}</Text>
          <Text style={styles.bigMetricMax}>/ 70k goal</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(weeklyPct * 100)}%` as any, backgroundColor: GREEN }]} />
          </View>
        </View>
      </View>

      <View style={styles.tabSep} />

      {/* Daily activity strip */}
      <Text style={styles.tabSubLabel}>DAILY ACTIVITY</Text>
      <View style={styles.dayStrip}>
        {DAY_LABELS.map((day, i) => {
          const active  = weekActiveDays[i];
          const isToday = i === TODAY_INDEX;
          return (
            <View key={i} style={styles.dayStripCol}>
              <View style={[
                styles.dayStripDot,
                active  && { backgroundColor: `${GREEN}20`, borderColor: GREEN },
                isToday && !active && { borderColor: 'rgba(255,255,255,0.5)' },
              ]}>
                {active
                  ? <Ionicons name="checkmark" size={10} color={GREEN} />
                  : isToday
                  ? <View style={styles.dayStripTodayDot} />
                  : null}
              </View>
              <Text style={[styles.dayStripLabel, isToday && { color: TEXT, fontWeight: '600' }]}>
                {day.charAt(0)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Insight */}
      <View style={styles.insightRow}>
        <Ionicons name={todaySteps > 5000 ? 'trending-up' : 'footsteps'} size={12} color={GREEN} />
        <Text style={styles.insightText}>
          {walking.isAuthorized
            ? todaySteps > 0
              ? `${remaining.toLocaleString()} steps to today's goal`
              : "Start moving to track today's steps"
            : 'Enable Health access to track steps'}
        </Text>
      </View>
    </View>
  );
}

// ─── Workouts Tab ─────────────────────────────────────────────────────────────

function WorkoutsTab({
  type, count, weekActiveDays, weeklyEarned,
}: {
  type: ActivityType;
  count: number;
  weekActiveDays: boolean[];
  weeklyEarned: number;
}) {
  const config = ACTIVITIES[type];
  const sessionPct = Math.min(count / 5, 1);

  return (
    <View style={styles.tabPanel}>
      {/* Primary metrics */}
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>{config.labelShort.toUpperCase()} SESSIONS</Text>
          <Text style={[styles.bigMetricVal, { color: config.colour }]}>{count}</Text>
          <Text style={styles.bigMetricMax}>/ 5 goal</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(sessionPct * 100)}%` as any, backgroundColor: config.colour }]} />
          </View>
        </View>
        <View style={styles.bigMetricDivider} />
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>XP REWARD</Text>
          <Text style={[styles.bigMetricVal, { color: GOLD }]}>{count * 15}</Text>
          <Text style={styles.bigMetricMax}>from this week</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(sessionPct * 100)}%` as any, backgroundColor: GOLD }]} />
          </View>
        </View>
      </View>

      <View style={styles.tabSep} />

      {/* Daily activity */}
      <Text style={styles.tabSubLabel}>ACTIVE DAYS</Text>
      <View style={styles.dayStrip}>
        {DAY_LABELS.map((day, i) => {
          const active  = weekActiveDays[i];
          const isToday = i === TODAY_INDEX;
          return (
            <View key={i} style={styles.dayStripCol}>
              <View style={[
                styles.dayStripDot,
                active  && { backgroundColor: `${config.colour}20`, borderColor: config.colour },
                isToday && !active && { borderColor: 'rgba(255,255,255,0.5)' },
              ]}>
                {active
                  ? <Ionicons name="checkmark" size={10} color={config.colour} />
                  : isToday
                  ? <View style={[styles.dayStripTodayDot, { backgroundColor: MUTED }]} />
                  : null}
              </View>
              <Text style={[styles.dayStripLabel, isToday && { color: TEXT, fontWeight: '600' }]}>
                {day.charAt(0)}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.tabSep} />

      {/* POWR earned */}
      <View style={styles.powrRow}>
        <View style={styles.powrLeft}>
          <Ionicons name="flash" size={14} color={GOLD} />
          <Text style={styles.powrLabel}>POWR EARNED</Text>
        </View>
        <Text style={styles.powrValue}>{count * 10} pts</Text>
      </View>

      {/* Insight */}
      <View style={styles.insightRow}>
        <Ionicons 
          name={config.iconLib === 'material-community' ? (config.iconActive as any) : (config.iconActive as any)} 
          size={12} 
          color={count >= 3 ? config.colour : MUTED} 
        />
        <Text style={[styles.insightText, count >= 3 && { color: DIM }]}>
          {count >= 4
            ? `Outstanding ${config.label.toLowerCase()} week.`
            : count >= 3
            ? 'Solid effort — keep going to hit your goal.'
            : `${5 - count} more sessions to hit your target.`}
        </Text>
      </View>
    </View>
  );
}

// ─── Sleep Tab ────────────────────────────────────────────────────────────────

const SLEEP_BAR_H = 56;

function SleepTab({ sleepHrs, sleepBedtimes }: { sleepHrs: number[]; sleepBedtimes: (string | null)[] }) {
  const daysWithSleep = sleepHrs.filter(h => h > 0).length;
  const avg = daysWithSleep > 0
    ? (sleepHrs.reduce((s, v) => s + v, 0) / daysWithSleep).toFixed(1)
    : '—';
  const avgNum = Number(avg) || 0;
  const avgPct = Math.min(avgNum / 8, 1);
  const hasData = daysWithSleep > 0;

  // Compute average bedtime from actual bedtime timestamps
  const avgBedtime = (() => {
    const validBedtimes = sleepBedtimes.filter((b): b is string => b !== null);
    if (validBedtimes.length === 0) return '—';
    const totalMinutes = validBedtimes.reduce((sum, bt) => {
      const d = new Date(bt);
      let mins = d.getHours() * 60 + d.getMinutes();
      // Treat times after midnight as next-day (add 24h for averaging)
      if (mins < 720) mins += 1440; // before noon = after midnight
      return sum + mins;
    }, 0);
    let avgMins = Math.round(totalMinutes / validBedtimes.length) % 1440;
    const h = Math.floor(avgMins / 60);
    const m = avgMins % 60;
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
  })();

  return (
    <View style={styles.tabPanel}>
      {/* Primary metrics */}
      <View style={styles.bigMetricRow}>
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>AVG / NIGHT</Text>
          <Text style={[styles.bigMetricVal, { color: INDIGO }]}>{hasData ? `${avg}h` : '—'}</Text>
          <Text style={styles.bigMetricMax}>/ 8h goal</Text>
          <View style={styles.metricBar}>
            <View style={[styles.metricBarFill, { width: `${Math.round(avgPct * 100)}%` as any, backgroundColor: INDIGO }]} />
          </View>
        </View>
        <View style={styles.bigMetricDivider} />
        <View style={styles.bigMetric}>
          <Text style={styles.bigMetricSup}>AVG BEDTIME</Text>
          <Text style={[styles.bigMetricVal, { color: INDIGO }]}>{avgBedtime}</Text>
          <Text style={styles.bigMetricMax}>goal: 10:30pm</Text>
          <View style={styles.metricBar}>
            {hasData ? (
              <View style={[styles.metricBarFill, { width: `${Math.round(Math.max(0, 1 - Math.abs(avgNum - 7.5) / 4) * 100)}%` as any, backgroundColor: INDIGO }]} />
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.tabSep} />

      {/* Per-day sleep bar chart */}
      <Text style={styles.tabSubLabel}>NIGHTLY SLEEP</Text>
      <View style={styles.sleepChart}>
        {sleepHrs.map((hrs, i) => {
          const isToday = i === TODAY_INDEX;
          const fillH   = hrs > 0 ? Math.round((hrs / 10) * SLEEP_BAR_H) : 0;
          return (
            <View key={i} style={styles.sleepBarCol}>
              <Text style={[styles.sleepBarHrs, isToday && { color: INDIGO }]}>
                {hrs > 0 ? (hrs % 1 === 0 ? `${hrs}h` : `${hrs.toFixed(1)}h`) : '—'}
              </Text>
              <View style={styles.sleepBarTrack}>
                {hrs > 0 && (
                  <View style={[
                    styles.sleepBarFill,
                    { height: fillH, backgroundColor: isToday ? INDIGO : `${INDIGO}60` },
                  ]} />
                )}
              </View>
              <Text style={[styles.sleepBarDay, isToday && { color: TEXT, fontWeight: '600' }]}>
                {DAY_LABELS[i].charAt(0)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Insight */}
      <View style={styles.insightRow}>
        <Ionicons name="moon-outline" size={12} color={INDIGO} />
        <Text style={[styles.insightText, { color: DIM }]}>
          {!hasData
            ? 'Connect a wearable to track your sleep automatically.'
            : avgNum >= 7.5
            ? 'Good recovery. Keep your sleep schedule consistent.'
            : `You're ${(8 - avgNum).toFixed(1)}h below target — aim for an earlier bedtime.`}
        </Text>
      </View>
    </View>
  );
}

// AchievementsTeaser Logic Removed

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:  { flex: 1 },
  header: {
    paddingHorizontal: 16, paddingVertical: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  title:   { fontSize: 28, fontWeight: '200', letterSpacing: -0.4, color: TEXT },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: 10, gap: 10, paddingTop: 2 },

  // Level Header Styles Removed
  breakdownCard: {
    overflow: 'hidden',
  },

  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  tabItem: {
    flex: 1, alignItems: 'center', paddingVertical: 13, position: 'relative',
  },
  tabLabel: {
    fontSize: 9, fontWeight: '500', letterSpacing: 1.5, color: MUTED,
  },
  tabLabelActive: { color: GOLD },
  tabIndicator: {
    position: 'absolute', bottom: -1, left: '20%', right: '20%',
    height: 1.5, backgroundColor: GOLD, borderRadius: 1,
  },
  tabContent: { padding: 20 },
  tabPanel:   { gap: 16 },

  // Big metric pair
  bigMetricRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bigMetric: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  bigMetricDivider: {
    width: 1, height: 72,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginHorizontal: 14,
    alignSelf: 'center',
  },
  bigMetricSup: {
    fontSize: 8, fontWeight: '500', letterSpacing: 1.5,
    color: MUTED, textTransform: 'uppercase', marginBottom: 2,
  },
  bigMetricVal: {
    fontSize: 44, fontWeight: '100', letterSpacing: -1.5, lineHeight: 46,
  },
  bigMetricMax: {
    fontSize: 10, fontWeight: '300', color: MUTED,
  },
  metricBar: {
    alignSelf: 'stretch', height: 2,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 1, overflow: 'hidden', marginTop: 6,
  },
  metricBarFill: { height: '100%', borderRadius: 1 },

  // Separator
  tabSep: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },

  // Sub-label
  tabSubLabel: {
    fontSize: 8, fontWeight: '500', letterSpacing: 1.5,
    color: MUTED, textTransform: 'uppercase',
  },

  // Day strip (activity dots)
  dayStrip: {
    flexDirection: 'row', justifyContent: 'space-between',
  },
  dayStripCol: { alignItems: 'center', gap: 6 },
  dayStripDot: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  dayStripTodayDot: {
    width: 5, height: 5, borderRadius: 3, backgroundColor: TEXT,
  },
  dayStripLabel: {
    fontSize: 9, fontWeight: '400', color: MUTED,
  },

  // POWR earned row (workouts tab)
  powrRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  powrLeft:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  powrLabel: { fontSize: 10, fontWeight: '500', letterSpacing: 1.2, color: MUTED, textTransform: 'uppercase' },
  powrValue: { fontSize: 16, fontWeight: '200', color: GOLD, letterSpacing: -0.5 },

  // Sleep chart
  sleepChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  sleepBarCol: {
    flex: 1, alignItems: 'center', gap: 4,
  },
  sleepBarHrs: {
    fontSize: 8, fontWeight: '400', color: MUTED,
  },
  sleepBarTrack: {
    width: '100%', height: SLEEP_BAR_H,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 4,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  sleepBarFill: {
    width: '100%', borderRadius: 4,
  },
  sleepBarDay: {
    fontSize: 9, fontWeight: '400', color: MUTED,
  },

  // Insight row
  insightRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  insightText: { fontSize: 12, fontWeight: '300', color: MUTED, flex: 1 },

  // ── Weekly Summary ──────────────────────────────────────────────────────────

  weeklySummary: {
    alignItems: 'center',
    paddingVertical: 50,
    gap: 12,
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.5,
    color: MUTED,
  },
  summaryValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  summaryValue: {
    fontSize: 54,
    fontWeight: '100',
    color: TEXT,
    letterSpacing: -1,
  },
  summaryUnit: {
    fontSize: 14,
    fontWeight: '400',
    color: GOLD,
    letterSpacing: 1,
    marginTop: 18,
  },
});

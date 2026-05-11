import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CombinedProgressRing, type TickOverlayData } from '@/components/home/CombinedProgressRing';
import { GeometricBackground } from '@/components/home/GeometricBackground';
import { RadialCarousel } from '@/components/home/RadialCarousel';
import { WeeklyActivityCircles, type WeeklyRingData } from '@/components/home/WeeklyActivityRings';
import { ProfileButton } from '@/components/ProfileButton';
import { MovementTab } from '@/components/progress/MovementTab';
import { SleepTab } from '@/components/progress/SleepTab';
import { WorkoutsTab } from '@/components/progress/WorkoutsTab';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { useAuth } from '@/context/AuthContext';
import { useActivity } from '@/hooks/useActivity';
import { useHealthData } from '@/hooks/useHealthData';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import { usePoints } from '@/hooks/usePoints';
import { useWalkingProgress } from '@/hooks/useWalkingProgress';
import { fetchMonthlyMetrics, fetchWeeklySleepHours, type MonthlyMetrics } from '@/lib/api/activity';
import { fetchProfile } from '@/lib/api/user';
import { getProvider, type HealthProviderId } from '@/lib/health/providers';

// ─── Constants ────────────────────────────────────────────────────────────────

const GOLD   = '#E8D200';
const GREEN  = '#4ade80';
const ORANGE = '#fb923c';
const INDIGO = '#818cf8';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';

const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
type Period = 'D' | 'W' | 'M';

// Fallback when no real sleep data is available yet
const EMPTY_SLEEP_HRS = [0, 0, 0, 0, 0, 0, 0];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProgressScreen() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { weekActiveDays, weeklyMetrics, refresh: refreshActivity } = useActivity();
  const { totalEarned, weeklyEarned } = usePoints();
  const walking = useWalkingProgress();

  const [activePrefs, setActivePrefs] = useState<ActivityType[]>(['gym', 'running', 'walking']);
  const [monthlyMetrics, setMonthlyMetrics] = useState<MonthlyMetrics>({ activeDays: 0, sessionCount: 0, totalSteps: 0, perType: {}, weekActiveDays: [0,0,0,0], activeDayTypes: {}, dayDetails: {} });
  const [sleepHrs, setSleepHrs] = useState<number[]>(EMPTY_SLEEP_HRS);
  const [sleepBedtimes, setSleepBedtimes] = useState<(string | null)[]>([null, null, null, null, null, null, null]);
  const health = useHealthData();
  const { activeId, refresh: refreshProviders } = useHealthProviders();
  const isNativeProvider = !activeId || activeId === 'apple-health' || activeId === 'health-connect';

  const loadMonthlyData = useCallback(async () => {
    try {
      const metrics = await fetchMonthlyMetrics();
      setMonthlyMetrics(metrics);
    } catch (e) {
      console.warn('[Progress] monthly data fetch failed:', e);
    }
  }, []);

  // Fetch real sleep data from synced activity sessions
  const loadSleep = useCallback(async () => {
    if (!user) return;
    try {
      const { hours, bedtimes } = await fetchWeeklySleepHours();
      setSleepHrs(hours);
      setSleepBedtimes(bedtimes);

      const noDbData = hours.every(h => h === 0);

      // For third-party providers, also check tokens directly to handle the race
      // condition where activeId state hasn't updated yet after an OAuth reconnect
      // (the tab stays mounted so useHealthProviders doesn't re-run on focus).
      let thirdPartyId: HealthProviderId | null = (!isNativeProvider && activeId) ? activeId : null;
      if (!thirdPartyId) {
        try {
          if (await getProvider('whoop').isConnected()) thirdPartyId = 'whoop';
        } catch {}
      }

      const canFetchLive = (isNativeProvider && health.isAuthorized) || !!thirdPartyId;
      if (!canFetchLive) return;

      if (noDbData && thirdPartyId) {
        // DB has no data yet (sync still running) — fetch the full week directly
        // from the provider so the chart isn't blank on first connect.
        try {
          const provider = getProvider(thirdPartyId);
          const weekHistory = await provider.getWeekHistory();
          const liveHours: number[] = [0, 0, 0, 0, 0, 0, 0];
          const liveBedtimes: (string | null)[] = [null, null, null, null, null, null, null];
          for (const day of weekHistory) {
            if (!day.sleep || day.sleep.durationHours < 1) continue;
            const d = new Date(day.date);
            const dow = d.getDay();
            const idx = dow === 0 ? 6 : dow - 1;
            liveHours[idx] = day.sleep.durationHours;
            if (day.sleep.startedAt) liveBedtimes[idx] = day.sleep.startedAt;
          }
          if (liveHours.some(h => h > 0)) {
            setSleepHrs(liveHours);
            setSleepBedtimes(liveBedtimes);
          }
        } catch (err) {
          console.error('[Progress] Live week sleep fetch failed:', err);
        }
      } else if (hours[TODAY_INDEX] === 0) {
        // DB has past-week data but today is missing — try live last-night fetch.
        let lastNight = null;
        if (isNativeProvider) {
          lastNight = await health.getLastNightSleep();
        } else if (thirdPartyId) {
          try {
            const provider = getProvider(thirdPartyId);
            lastNight = await provider.getLastNightSleep();
          } catch {}
        }
        if (lastNight) {
          setSleepHrs(prev => { const u = [...prev]; u[TODAY_INDEX] = lastNight!.durationHours; return u; });
          if (lastNight.startedAt) {
            setSleepBedtimes(prev => { const u = [...prev]; u[TODAY_INDEX] = lastNight!.startedAt; return u; });
          }
        }
      }
    } catch (err) {
      console.error('[Progress] Error fetching sleep data:', err);
    }
  }, [user, health.isAuthorized, health.getLastNightSleep, activeId, isNativeProvider]);

  // Run on mount/dep-change and whenever the screen comes into focus (handles
  // the case where the user connects WHOOP in settings then returns here).
  useEffect(() => { loadSleep(); loadMonthlyData(); }, [loadSleep, loadMonthlyData]);
  useFocusEffect(useCallback(() => {
    refreshProviders(); // ensure activeId is current after OAuth reconnect
    loadSleep();
    loadMonthlyData();
  }, [refreshProviders, loadSleep, loadMonthlyData]));

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

  // Build the three small weekly activity circles (same logic as home screen)
  const WEEKLY_SESSION_TARGET = 3;
  const WEEKLY_STEPS_TARGET = 50000;
  function buildWeeklyRing(type: ActivityType): WeeklyRingData {
    const config = ACTIVITIES[type] ?? ACTIVITIES.walking;
    if (type === 'walking') {
      const steps = weeklyMetrics.totalSteps;
      const pct = Math.min(steps / WEEKLY_STEPS_TARGET, 2);
      return { type, label: config.labelShort, icon: config.iconActive, iconLib: (config.iconLib ?? 'ionicons') as 'ionicons' | 'material-community', colour: GOLD, current: steps, target: WEEKLY_STEPS_TARGET, pct, overachieving: steps > WEEKLY_STEPS_TARGET };
    }
    const sessions = weeklyMetrics.perType[type] ?? 0;
    const pct = Math.min(sessions / WEEKLY_SESSION_TARGET, 2);
    return { type, label: config.labelShort, icon: config.iconActive, iconLib: (config.iconLib ?? 'ionicons') as 'ionicons' | 'material-community', colour: GOLD, current: sessions, target: WEEKLY_SESSION_TARGET, pct, overachieving: sessions > WEEKLY_SESSION_TARGET };
  }
  const weeklyRings = (activePrefs.slice(0, 3).map(buildWeeklyRing)) as [WeeklyRingData, WeeklyRingData, WeeklyRingData];

  // Tick overlay: when the user scrubs the monthly ring, show that day's data
  const [tickOverlay, setTickOverlay] = useState<TickOverlayData | null>(null);

  const handleTickActive = useCallback((data: TickOverlayData | null) => {
    setTickOverlay(data);
  }, []);

  // Derive what the three circles should display
  const displayRings: [WeeklyRingData, WeeklyRingData, WeeklyRingData] = (() => {
    if (!tickOverlay) return weeklyRings;
    const detail = monthlyMetrics.dayDetails?.[tickOverlay.dayNum];
    const types = tickOverlay.types;
    const baseTypes: ActivityType[] = types.length > 0
      ? (types.slice(0, 3) as ActivityType[])
      : (activePrefs.slice(0, 3) as ActivityType[]);
    const allFallbacks = [...activePrefs, 'walking', 'running', 'gym'] as ActivityType[];
    for (const fb of allFallbacks) {
      if (baseTypes.length >= 3) break;
      if (!baseTypes.includes(fb)) baseTypes.push(fb);
    }
    return baseTypes.slice(0, 3).map((type) => {
      const config = ACTIVITIES[type as keyof typeof ACTIVITIES] ?? ACTIVITIES.walking;
      const done = types.includes(type);
      if (type === 'walking' && detail?.totalSteps) {
        const steps = detail.totalSteps;
        return { type: type as ActivityType, label: config.labelShort, icon: config.iconActive, iconLib: (config.iconLib ?? 'ionicons') as 'ionicons' | 'material-community', colour: GOLD, current: steps, target: 10000, pct: Math.min(steps / 10000, 2), overachieving: steps > 10000 };
      }
      return { type: type as ActivityType, label: config.labelShort, icon: config.iconActive, iconLib: (config.iconLib ?? 'ionicons') as 'ionicons' | 'material-community', colour: GOLD, current: done ? 1 : 0, target: 1, pct: done ? 1 : 0, overachieving: false };
    }) as [WeeklyRingData, WeeklyRingData, WeeklyRingData];
  })();

  const tickDateLabel: string | null = tickOverlay ? (() => {
    const d = new Date(new Date().getFullYear(), new Date().getMonth(), tickOverlay.dayNum);
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
    const monthShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return `${monthShort} ${tickOverlay.dayNum} · ${dayName}`;
  })() : null;

  const [activeTab, setActiveTab] = useState<string>(tab || 'walking');
  const [period, setPeriod] = useState<Period>('M');

  // Sync activeTab when navigating back with a different tab param
  useEffect(() => {
    if (tab) setActiveTab(tab);
  }, [tab]);
  
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
        pointsValue: weeklyEarned,
        ticks: DAY_LABELS.map((label, i) => ({
          label: label.slice(0, 2),
          active: weekActiveDays[i],
          isToday: i === TODAY_INDEX,
        })),
      };
    }

    const count = weeklyMetrics.perType[type] ?? 0;
    const typeDays = weeklyMetrics.activeDaysPerType?.[type] ?? new Array(7).fill(false);
    return {
      id: type,
      pct: Math.min(count / 5, 1),
      value: String(count),
      maxLabel: '/ 5',
      subLabel: `${config.labelShort.toUpperCase()} SESSIONS`,
      gradientColors: [config.colour, ORANGE],
      iconName: config.iconActive,
      iconLib: config.iconLib,
      pointsValue: weeklyEarned,
      ticks: DAY_LABELS.map((label, i) => ({
        label: label.slice(0, 2),
        active: typeDays[i] ?? false,
        isToday: i === TODAY_INDEX,
      })),
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
    pointsValue: weeklyEarned,
    ticks: DAY_LABELS.map((label, i) => ({
      label: label.slice(0, 2),
      active: sleepHrs[i] > 0,
      isToday: i === TODAY_INDEX,
    })),
  });

  // Monthly ring derived values
  const daysElapsed = new Date().getDate();
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const MONTH_NAMES = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const currentMonthLabel = MONTH_NAMES[now.getMonth()];
  const weekCaps = [7, 7, 7, daysInMonth - 21] as const;
  const wad = monthlyMetrics.weekActiveDays ?? [0, 0, 0, 0];
  const weekElapsed = [
    Math.min(7, daysElapsed),
    Math.max(0, Math.min(7, daysElapsed - 7)),
    Math.max(0, Math.min(7, daysElapsed - 14)),
    Math.max(0, Math.min(weekCaps[3], daysElapsed - 21)),
  ] as const;
  const weekCompleted = weekElapsed.map((elapsed, i) => elapsed > 0 && wad[i] === elapsed);

  const tabs = radialData.map(d => d.id);
  const activeIndex = tabs.indexOf(activeTab);
  const [carouselIndex, setCarouselIndex] = useState(0);

  const handleIndexChange = (index: number) => {
    setCarouselIndex(index);
    setActiveTab(tabs[index]);
  };

  // Keep carousel in sync when activeTab changes from tab clicks or external navigation
  useEffect(() => {
    const idx = tabs.indexOf(activeTab);
    if (idx >= 0 && idx !== carouselIndex) {
      setCarouselIndex(idx);
    }
  }, [activeTab, tabs]);

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
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Weekly Activity Circles ─────────────────────── */}
        <Text style={styles.sectionLabelFirst}>{tickDateLabel ?? 'THIS WEEK'}</Text>
        <WeeklyActivityCircles
          rings={displayRings}
          onPressRing={tickOverlay ? undefined : (type) => setActiveTab(type)}
        />

        {/* ── Monthly Progress ───────────────────────────── */}
        <Text style={styles.sectionLabel}>MONTHLY PROGRESS</Text>
        <CombinedProgressRing
          activeDays={monthlyMetrics.activeDays}
          daysElapsed={daysElapsed}
          daysInMonth={daysInMonth}
          activeDayTypes={monthlyMetrics.activeDayTypes ?? {}}
          monthlyLabel={currentMonthLabel}
          onTickActive={handleTickActive}
          armMetrics={[
            { label: 'WEEK 1', value: `${wad[0]}/${weekElapsed[0]}`, completed: weekCompleted[0] },
            { label: 'WEEK 2', value: `${wad[1]}/${weekElapsed[1]}`, completed: weekCompleted[1] },
            { label: 'WEEK 3', value: `${wad[2]}/${weekElapsed[2]}`, completed: weekCompleted[2] },
            { label: 'WEEK 4', value: `${wad[3]}/${weekElapsed[3]}`, completed: weekCompleted[3] },
          ]}
        />

        {/* ── Breakdown Tabs ─────────────────────────────── */}
        <Text style={styles.sectionLabel}>THIS WEEK</Text>
        <BreakdownSection
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          period={period}
          onPeriodChange={setPeriod}
          tabs={radialData.map(d => ({ key: d.id, label: ACTIVITIES[d.id as ActivityType]?.labelShort.toUpperCase() || d.id.toUpperCase() }))}
          walking={walking}
          weeklyMetrics={weeklyMetrics}
          stepsF={stepsF}
          weekActiveDays={weekActiveDays}
          weeklyEarned={weeklyEarned}
          sleepHrs={sleepHrs}
          sleepBedtimes={sleepBedtimes}
        />

        {/* ── Activity Radials ───────────────────────────── */}
        <Text style={styles.sectionLabel}>ACTIVITY OVERVIEW</Text>
        <RadialCarousel
          data={radialData}
          activeIndex={carouselIndex}
          onChange={handleIndexChange}
        />

      </ScrollView>
    </View>
  );
}


// Removed WeeklyRing logic


type BreakdownTabItem = { key: string; label: string };

function BreakdownSection({
  activeTab, setActiveTab, period, onPeriodChange, tabs, walking, weeklyMetrics, stepsF, weekActiveDays, weeklyEarned, sleepHrs, sleepBedtimes,
}: {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  period: Period;
  onPeriodChange: (period: Period) => void;
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
          <MovementTab
            walking={walking}
            totalSteps={weeklyMetrics.totalSteps}
            stepsF={stepsF}
            weekActiveDays={weekActiveDays}
            period={period}
            onPeriodChange={onPeriodChange}
          />
        )}
        {activeTab !== 'walking' && activeTab !== 'sleep' && (
          <WorkoutsTab
            type={activeTab as ActivityType}
            count={weeklyMetrics.perType[activeTab] ?? 0}
            weekActiveDays={weeklyMetrics.activeDaysPerType[activeTab] ?? [false, false, false, false, false, false, false]}
            weeklyEarned={weeklyEarned}
            period={period}
            onPeriodChange={onPeriodChange}
          />
        )}
        {activeTab === 'sleep' && <SleepTab sleepHrs={sleepHrs} sleepBedtimes={sleepBedtimes} />}
      </View>
    </View>
  );
}


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
  tabContent: { padding: 20, minHeight: 480 },

  sectionLabelFirst: {
    paddingHorizontal: 14,
    paddingTop: 8,
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 2,
    color: '#F2F2F2',
  },
  sectionLabel: {
    paddingHorizontal: 14,
    paddingTop: 16,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.07)',
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 2,
    color: '#F2F2F2',
  },
});

import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GeometricBackground } from '@/components/home/GeometricBackground';
import { RadialCarousel } from '@/components/home/RadialCarousel';
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
import { fetchWeeklySleepHours } from '@/lib/api/activity';
import { fetchProfile } from '@/lib/api/user';
import { ALL_PROVIDER_META, getProvider, type HealthProviderId } from '@/lib/health/providers';

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
  const { weekActiveDays, weeklyMetrics } = useActivity();
  const { weeklyEarned } = usePoints();
  const walking = useWalkingProgress();

  const [activePrefs, setActivePrefs] = useState<ActivityType[]>(['gym', 'running', 'walking']);
  const [sleepHrs, setSleepHrs] = useState<number[]>(EMPTY_SLEEP_HRS);
  const [sleepBedtimes, setSleepBedtimes] = useState<(string | null)[]>([null, null, null, null, null, null, null]);
  const health = useHealthData();
  const { activeId, rows, refresh: refreshProviders } = useHealthProviders();
  const isNativeProvider = !activeId || activeId === 'apple-health' || activeId === 'health-connect';
  // Sleep is wearable-only: require the user to have explicitly connected a native health
  // platform (apple-health / health-connect) or a third-party provider with sleep support.
  // A null activeId means no wearable has been set up, so sleep should not be shown.
  const hasSleepTrackingConnected =
    ((activeId === 'apple-health' || activeId === 'health-connect') && health.isAuthorized) ||
    rows.some((row) => !!row.connection && row.meta.capabilities.includes('sleep')) ||
    (!!activeId && ALL_PROVIDER_META.some((meta) => meta.id === activeId && meta.capabilities.includes('sleep')));

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
  useEffect(() => { loadSleep(); }, [loadSleep]);
  useFocusEffect(useCallback(() => {
    refreshProviders(); // ensure activeId is current after OAuth reconnect
    loadSleep();
  }, [refreshProviders, loadSleep]));

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

  const stepsF = weeklyMetrics.totalSteps >= 1000
    ? `${(weeklyMetrics.totalSteps / 1000).toFixed(1)}k`
    : String(weeklyMetrics.totalSteps);

  const [activeTab, setActiveTab] = useState<string>(tab || '');
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
  if (hasSleepTrackingConnected) {
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
  }

  const tabs = radialData.map(d => d.id);
  const activeIndex = tabs.indexOf(activeTab);

  const handleIndexChange = (index: number) => {
    const nextTab = tabs[index];
    if (nextTab && nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  };

  // Set initial tab once prefs load
  useEffect(() => {
    if (tabs.length > 0 && !tabs.includes(activeTab)) {
      setActiveTab(tabs[0]);
    }
  }, [tabs, activeTab]);

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

        {/* ── Activity Radials ───────────────────────────── */}
        <Text style={styles.sectionLabelFirst}>ACTIVITY OVERVIEW</Text>
        <RadialCarousel
          data={radialData}
          activeIndex={activeIndex >= 0 ? activeIndex : 0}
          onChange={handleIndexChange}
        />

        {/* ── Breakdown Tabs ─────────────────────────────── */}
        <Text style={styles.sectionLabel}>THIS WEEK</Text>
        <BreakdownSection
          activeTab={activeTab}
          activeIndex={activeIndex >= 0 ? activeIndex : 0}
          onIndexChange={handleIndexChange}
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

      </ScrollView>
    </View>
  );
}


// Removed WeeklyRing logic


type BreakdownTabItem = { key: string; label: string };

function BreakdownSection({
  activeTab, activeIndex, onIndexChange, period, onPeriodChange, tabs, walking, weeklyMetrics, stepsF, weekActiveDays, weeklyEarned, sleepHrs, sleepBedtimes,
}: {
  activeTab: string;
  activeIndex: number;
  onIndexChange: (index: number) => void;
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
  const carouselRef = useRef<ScrollView>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const currentIndexRef = useRef(0);
  const isSyncingRef = useRef(false);

  useEffect(() => {
    if (!pageWidth) return;
    const index = Math.max(0, Math.min(tabs.length - 1, activeIndex));
    if (index === currentIndexRef.current) return;

    isSyncingRef.current = true;
    currentIndexRef.current = index;
    carouselRef.current?.scrollTo({ x: index * pageWidth, animated: false });
    requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  }, [activeIndex, pageWidth, tabs.length]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!pageWidth || isSyncingRef.current) return;
    const index = Math.max(0, Math.min(tabs.length - 1, Math.round(event.nativeEvent.contentOffset.x / pageWidth)));
    if (index === currentIndexRef.current) return;
    currentIndexRef.current = index;
    onIndexChange(index);
  }, [onIndexChange, pageWidth, tabs.length]);

  return (
    <View style={styles.breakdownCard}>
      <View style={styles.tabBar}>
        {tabs.map(({ key, label }) => {
          const isActive = activeTab === key;
          const index = tabs.findIndex(tab => tab.key === key);
          return (
            <Pressable key={key} style={styles.tabItem} onPress={() => onIndexChange(index)}>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{label}</Text>
              {isActive && <View style={styles.tabIndicator} />}
            </Pressable>
          );
        })}
      </View>

      <View
        style={styles.tabContentViewport}
        onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}
      >
        <ScrollView
          ref={carouselRef}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          {tabs.map(({ key }) => (
            <View key={key} style={[styles.tabContentPage, { width: pageWidth || undefined }]}>
              {key === 'walking' && (
                <MovementTab
                  walking={walking}
                  totalSteps={weeklyMetrics.totalSteps}
                  stepsF={stepsF}
                  weekActiveDays={weekActiveDays}
                  period={period}
                  onPeriodChange={onPeriodChange}
                />
              )}
              {key !== 'walking' && key !== 'sleep' && (
                <WorkoutsTab
                  type={key as ActivityType}
                  count={weeklyMetrics.perType[key] ?? 0}
                  weekActiveDays={weeklyMetrics.activeDaysPerType[key] ?? [false, false, false, false, false, false, false]}
                  weeklyEarned={weeklyEarned}
                  period={period}
                  onPeriodChange={onPeriodChange}
                />
              )}
              {key === 'sleep' && <SleepTab sleepHrs={sleepHrs} sleepBedtimes={sleepBedtimes} />}
            </View>
          ))}
        </ScrollView>
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
  tabContentViewport: {
    minHeight: 480,
  },
  tabContentPage: {
    padding: 20,
    minHeight: 480,
  },

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

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GeometricBackground } from '@/components/home/GeometricBackground';
import { RadialCarousel } from '@/components/home/RadialCarousel';
import { HeaderActions } from '@/components/HeaderActions';
import { MovementTab } from '@/components/progress/MovementTab';
import PointsBreakdownSheet from '@/components/progress/PointsBreakdownSheet';
import { SleepTab } from '@/components/progress/SleepTab';
import { WorkoutsTab } from '@/components/progress/WorkoutsTab';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { useAuth } from '@/context/AuthContext';
import { useActivity } from '@/hooks/useActivity';
import { useHealthData } from '@/hooks/useHealthData';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import { usePoints } from '@/hooks/usePoints';
import { bumpActivityRevision } from '@/lib/activityRevision';
import { useWalkingProgress } from '@/hooks/useWalkingProgress';
import { fetchWeeklySleepHours } from '@/lib/api/activity';
import { fetchProfile } from '@/lib/api/user';
import { orderedProgressActivities } from '@/lib/weeklyActivities';

// ─── Constants ────────────────────────────────────────────────────────────────

const GOLD   = '#E8D200';
const GREEN  = '#4ade80';
const ORANGE = '#fb923c';
const INDIGO = '#818cf8';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';

const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
/** Max breakdown tab labels visible at once — more tabs and the bar scrolls. */
const VISIBLE_TABS = 4;
type Period = 'D' | 'W' | 'M';

// Fallback when no real sleep data is available yet
const EMPTY_SLEEP_HRS = [0, 0, 0, 0, 0, 0, 0];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProgressScreen() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { weekActiveDays, weeklyMetrics, refresh: refreshActivity } = useActivity();
  const { refresh: refreshPoints } = usePoints();
  const walking = useWalkingProgress();
  const [refreshing, setRefreshing] = useState(false);

  const [activePrefs, setActivePrefs] = useState<ActivityType[]>(['gym', 'running', 'walking']);
  const [sleepHrs, setSleepHrs] = useState<number[]>(EMPTY_SLEEP_HRS);
  const [sleepBedtimes, setSleepBedtimes] = useState<(string | null)[]>([null, null, null, null, null, null, null]);
  const health = useHealthData();
  const { activeId, rows, refresh: refreshProviders } = useHealthProviders();
  const isNativeProvider = !activeId || activeId === 'apple-health' || activeId === 'health-connect';
  // Sleep needs a wearable that actually tracks it — a bare phone doesn't, so
  // for native providers (apple-health / health-connect, whose meta lists the
  // 'sleep' capability regardless) the proof is real sleep data this week
  // (only a watch/ring writing to the store produces it). Cloud wearables with
  // sleep support count as soon as they're connected, before data arrives.
  const hasSleepData = sleepHrs.some(h => h > 0);
  const hasSleepTrackingConnected =
    hasSleepData ||
    rows.some((row) => !!row.connection && !row.meta.native && row.meta.capabilities.includes('sleep'));

  // Fetch real sleep data from synced activity sessions
  const loadSleep = useCallback(async () => {
    if (!user) return;
    try {
      const { hours, bedtimes } = await fetchWeeklySleepHours();
      setSleepHrs(hours);
      setSleepBedtimes(bedtimes);

      // Live on-device fallback is only possible for native providers (Apple
      // Health / Health Connect). Terra-aggregated providers (Whoop, Oura,
      // Garmin, ...) deliver sleep server-side via terra-webhook, so their chart
      // is DB-first only — there's no on-device read to fall back to (their
      // provider data methods throw HealthProviderNotImplementedError by design).
      if (!isNativeProvider || !health.isAuthorized) return;

      // DB has past-week data but today is missing — try a live last-night fetch.
      if (hours[TODAY_INDEX] === 0) {
        const lastNight = await health.getLastNightSleep();
        if (lastNight) {
          setSleepHrs(prev => { const u = [...prev]; u[TODAY_INDEX] = lastNight.durationHours; return u; });
          if (lastNight.startedAt) {
            setSleepBedtimes(prev => { const u = [...prev]; u[TODAY_INDEX] = lastNight.startedAt!; return u; });
          }
        }
      }
    } catch (err) {
      console.error('[Progress] Error fetching sleep data:', err);
    }
  }, [user, health.isAuthorized, health.getLastNightSleep, isNativeProvider]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refreshActivity(),
        refreshPoints(),
        walking.refresh(),
        refreshProviders(),
        loadSleep(),
      ]);
      // None of the above reaches the breakdown charts — their D/W/M data is
      // component state in WorkoutsTab/MovementTab, so pulling to refresh
      // visibly reloaded the radials and left the heatmap untouched. Bumping the
      // revision resets their guards on the same signal a background earn uses.
      bumpActivityRevision();
    } finally {
      setRefreshing(false);
    }
  }, [refreshActivity, refreshPoints, walking.refresh, refreshProviders, loadSleep]);

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
  // Which activity's breakdown the radial's (i) opened, if any.
  const [radialInfoFor, setRadialInfoFor] = useState<ActivityType | null>(null);
  const [period, setPeriod] = useState<Period>('M');
  // Lookback offset for the breakdown views: 0 = current day/week/month,
  // -1 = previous, … Resets when the period granularity changes.
  const [lookback, setLookback] = useState(0);
  const handlePeriodChange = useCallback((p: Period) => {
    setPeriod(p);
    setLookback(0);
  }, []);

  // Sync activeTab when navigating back with a different tab param
  useEffect(() => {
    if (tab) setActiveTab(tab);
  }, [tab]);
  
  // Show the user's preferences plus any activity they actually did this week
  // — each gets its own radial and breakdown page. The tab bar scrolls (4
  // labels visible at a time) so multi-sport users lose nothing.
  const displayTypes = orderedProgressActivities(activePrefs, weeklyMetrics);

  // Build dynamic radial data
  const radialData = displayTypes.map((type) => {
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
        pointsValue: weeklyMetrics.pointsPerType['walking'] ?? 0,
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
      pointsValue: weeklyMetrics.pointsPerType[type] ?? 0,
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
      pointsValue: weeklyMetrics.pointsPerType['sleep'] ?? 0,
      ticks: DAY_LABELS.map((label, i) => ({
        label: label.slice(0, 2),
        active: sleepHrs[i] > 0,
        isToday: i === TODAY_INDEX,
      })),
    });
  }

  const tabs = radialData.map(d => d.id);
  const activeIndex = tabs.indexOf(activeTab);
  const radialActiveType = (tabs[activeIndex >= 0 ? activeIndex : 0] ?? 'gym') as ActivityType;

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
        <HeaderActions />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#E8D200"
            colors={['#E8D200']}
          />
        }
      >

        {/* ── Activity Radials ───────────────────────────── */}
        <Text style={styles.sectionLabelFirst}>ACTIVITY OVERVIEW</Text>
        <RadialCarousel
          data={radialData}
          activeIndex={activeIndex >= 0 ? activeIndex : 0}
          onChange={handleIndexChange}
          onPointsInfo={() => setRadialInfoFor(radialActiveType)}
        />

        {/* ── Breakdown Tabs ─────────────────────────────── */}
        <Text style={styles.sectionLabel}>BREAKDOWN</Text>
        <BreakdownSection
          activeTab={activeTab}
          activeIndex={activeIndex >= 0 ? activeIndex : 0}
          onIndexChange={handleIndexChange}
          period={period}
          onPeriodChange={handlePeriodChange}
          lookback={lookback}
          onLookbackChange={setLookback}
          tabs={radialData.map(d => ({ key: d.id, label: ACTIVITIES[d.id as ActivityType]?.labelShort.toUpperCase() || d.id.toUpperCase() }))}
          walking={walking}
          weeklyMetrics={weeklyMetrics}
          stepsF={stepsF}
          weekActiveDays={weekActiveDays}
          sleepHrs={sleepHrs}
          sleepBedtimes={sleepBedtimes}
        />

      </ScrollView>

      {/* The radial always shows the CURRENT WEEK (it reads weeklyMetrics and
          ignores the D/W/M stepper), so its breakdown must be week-scoped too
          or the sheet total wouldn't match the number that opened it. */}
      <PointsBreakdownSheet
        visible={radialInfoFor !== null}
        onClose={() => setRadialInfoFor(null)}
        type={radialInfoFor ?? 'gym'}
        period="W"
        offset={0}
      />
    </View>
  );
}


// Removed WeeklyRing logic


type BreakdownTabItem = { key: string; label: string };

function BreakdownSection({
  activeTab, activeIndex, onIndexChange, period, onPeriodChange, lookback, onLookbackChange, tabs, walking, weeklyMetrics, stepsF, weekActiveDays, sleepHrs, sleepBedtimes,
}: {
  activeTab: string;
  activeIndex: number;
  onIndexChange: (index: number) => void;
  period: Period;
  onPeriodChange: (period: Period) => void;
  lookback: number;
  onLookbackChange: (offset: number) => void;
  tabs: BreakdownTabItem[];
  walking: ReturnType<typeof useWalkingProgress>;
  weeklyMetrics: any;
  stepsF: string;
  weekActiveDays: boolean[];
  sleepHrs: number[];
  sleepBedtimes: (string | null)[];
}) {
  const carouselRef = useRef<ScrollView>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const currentIndexRef = useRef(0);
  const isSyncingRef = useRef(false);

  // Tab bar shows at most 4 labels at once; with more tabs it scrolls and
  // follows the active tab so the selection is always in view. Edge chevrons
  // appear only on the side(s) with more tabs off-screen.
  const tabBarRef = useRef<ScrollView>(null);
  const [barWidth, setBarWidth] = useState(0);
  const [tabScrollX, setTabScrollX] = useState(0);
  const tabsScroll = tabs.length > VISIBLE_TABS;
  const tabWidth = tabsScroll && barWidth ? barWidth / VISIBLE_TABS : undefined;
  const tabContentW = (tabWidth ?? 0) * tabs.length;
  const canScrollLeft  = tabsScroll && tabScrollX > 2;
  const canScrollRight = tabsScroll && barWidth > 0 && tabScrollX < tabContentW - barWidth - 2;

  useEffect(() => {
    if (!tabsScroll || !barWidth) return;
    const w = barWidth / VISIBLE_TABS;
    const maxX = tabs.length * w - barWidth;
    // Centre the active tab where possible, clamped to the strip's ends.
    const x = Math.max(0, Math.min(activeIndex * w - (barWidth - w) / 2, maxX));
    tabBarRef.current?.scrollTo({ x, animated: true });
  }, [activeIndex, barWidth, tabsScroll, tabs.length]);

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
      <View style={styles.tabBarWrap}>
        <ScrollView
          ref={tabBarRef}
          horizontal
          scrollEnabled={tabsScroll}
          showsHorizontalScrollIndicator={false}
          style={styles.tabBar}
          contentContainerStyle={styles.tabBarContent}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
          onScroll={(e) => setTabScrollX(e.nativeEvent.contentOffset.x)}
          scrollEventThrottle={32}
        >
          {tabs.map(({ key, label }) => {
            const isActive = activeTab === key;
            const index = tabs.findIndex(tab => tab.key === key);
            return (
              <Pressable
                key={key}
                style={[styles.tabItem, tabWidth ? { width: tabWidth } : styles.tabItemFlex]}
                onPress={() => onIndexChange(index)}
              >
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{label}</Text>
                {isActive && <View style={styles.tabIndicator} />}
              </Pressable>
            );
          })}
        </ScrollView>
        {canScrollLeft && (
          <View style={[styles.tabArrow, styles.tabArrowLeft]} pointerEvents="none">
            <Ionicons name="chevron-back" size={11} color="rgba(255,255,255,0.45)" />
          </View>
        )}
        {canScrollRight && (
          <View style={[styles.tabArrow, styles.tabArrowRight]} pointerEvents="none">
            <Ionicons name="chevron-forward" size={11} color="rgba(255,255,255,0.45)" />
          </View>
        )}
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
                  offset={lookback}
                  onOffsetChange={onLookbackChange}
                />
              )}
              {key !== 'walking' && key !== 'sleep' && (
                <WorkoutsTab
                  type={key as ActivityType}
                  count={weeklyMetrics.perType[key] ?? 0}
                  weekActiveDays={weeklyMetrics.activeDaysPerType[key] ?? [false, false, false, false, false, false, false]}
                  // Per-TYPE points for this week — not usePoints().weeklyEarned,
                  // which is the all-activity total and made every activity's
                  // POWR EARNED column read the same (inflated) number. The
                  // past-week branch inside WorkoutsTab was already type-scoped,
                  // so only the current week was wrong. Matches the radial above,
                  // which has always used pointsPerType.
                  weeklyEarned={weeklyMetrics.pointsPerType[key] ?? 0}
                  period={period}
                  onPeriodChange={onPeriodChange}
                  offset={lookback}
                  onOffsetChange={onLookbackChange}
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

  tabBarWrap: { position: 'relative' },
  tabBar: {
    flexGrow: 0,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  // Scroll-affordance chevrons — shown only on the side(s) with hidden tabs.
  tabArrow: {
    position: 'absolute', top: 0, bottom: 1,
    justifyContent: 'center', paddingHorizontal: 3,
  },
  tabArrowLeft:  { left: 0 },
  tabArrowRight: { right: 0 },
  // Lets ≤4 tabs spread across the full bar via tabItemFlex; with more tabs
  // each item takes a fixed quarter-width and the bar scrolls.
  tabBarContent: { flexGrow: 1 },
  tabItem: {
    alignItems: 'center', paddingVertical: 13, position: 'relative',
  },
  tabItemFlex: { flex: 1 },
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

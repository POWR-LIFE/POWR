import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
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
import { getProvider } from '@/lib/health/providers';

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
  const [sleepHrs, setSleepHrs] = useState<number[]>(EMPTY_SLEEP_HRS);
  const [sleepBedtimes, setSleepBedtimes] = useState<(string | null)[]>([null, null, null, null, null, null, null]);
  const health = useHealthData();
  const { activeId } = useHealthProviders();
  const isNativeProvider = !activeId || activeId === 'apple-health' || activeId === 'health-connect';

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

        // If last night has no data yet, try fetching directly from the active provider
        const lastNightIdx = TODAY_INDEX === 0 ? 6 : TODAY_INDEX - 1;
        const canFetchLive = isNativeProvider ? health.isAuthorized : !!activeId;
        if (hours[TODAY_INDEX] === 0 && canFetchLive) {
          let lastNight = null;
          if (isNativeProvider) {
            lastNight = await health.getLastNightSleep();
          } else {
            try {
              const provider = getProvider(activeId!);
              lastNight = await provider.getLastNightSleep();
            } catch {}
          }
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
  }, [user, health.isAuthorized, activeId]);

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

  const [activeTab, setActiveTab] = useState<string>(tab || 'walking');
  const [period, setPeriod] = useState<Period>('W');

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
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
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
  tabContent: { padding: 20 },


});

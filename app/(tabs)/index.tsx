import { Ionicons } from '@expo/vector-icons';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, LayoutChangeEvent, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import ReAnimated, {
    Extrapolate,
    interpolate,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChallengeCard } from '@/components/home/ChallengeCard';
import { CombinedProgressRing, type TickOverlayData } from '@/components/home/CombinedProgressRing';
import { GeometricBackground } from '@/components/home/GeometricBackground';
import { HealthConnectCard } from '@/components/home/HealthConnectCard';
import { StickyActivityIndicators } from '@/components/home/StickyActivityIndicators';
import { SleepProgressCard } from '@/components/home/SleepProgressCard';
import { StreakCard } from '@/components/home/StreakCard';
import { WalkingProgressCard } from '@/components/home/WalkingProgressCard';
import { WeeklyActivityBars, type WeeklyRingData } from '@/components/home/WeeklyActivityRings';
import { WeeklyActivityCircles } from '@/components/home/WeeklyActivityRings';
import { WelcomeNextCard } from '@/components/home/WelcomeNextCard';
import { ProfileButton } from '@/components/ProfileButton';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { useAuth } from '@/context/AuthContext';
import { useActiveGeofence } from '@/hooks/useActiveGeofence';
import { type SleepSession } from '@/hooks/useHealthData';
import { useActivity } from '@/hooks/useActivity';
import { useHealthData } from '@/hooks/useHealthData';
import { usePoints } from '@/hooks/usePoints';
import { useStreak } from '@/hooks/useStreak';
import { useWalkingProgress } from '@/hooks/useWalkingProgress';
import { fetchMonthlyMetrics, type MonthlyMetrics } from '@/lib/api/activity';
import { fetchMonthlyEarned } from '@/lib/api/points';
import { fetchFeaturedReward, type Reward } from '@/lib/api/rewards';
import { fetchProfile } from '@/lib/api/user';
import { computeExpiresIn, computeUrgency } from '@/shared/weeklyChallenges';
import { useWeeklyChallenge } from '@/hooks/useWeeklyChallenge';

const GOLD = '#E8D200';
const TEXT_PRIMARY = '#F2F2F2';
const TEXT_MUTED = 'rgba(255,255,255,0.25)';

const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;



function formatElapsed(entryTimestamp: number): string {
    const totalSec = Math.floor((Date.now() - entryTimestamp) / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins >= 60) {
        const hrs = Math.floor(mins / 60);
        const rem = mins % 60;
        return `${hrs}h ${rem}m`;
    }
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

// ─── Weekly Reward Teaser ─────────────────────────────────────────────────────

function getDiscountLabel(reward: Reward): string {
    if (reward.discount_type === 'percentage' && reward.discount_value != null)
        return `${reward.discount_value}% OFF`;
    if (reward.discount_type === 'fixed_amount' && reward.discount_value != null)
        return `£${reward.discount_value} OFF`;
    return reward.value_label ?? '';
}

function getDiscountParts(label: string): { amount: string; suffix: string } {
    const match = label.match(/^(.+?)\s*(OFF|off)$/);
    if (match) return { amount: match[1].trim(), suffix: 'OFF' };
    return { amount: label, suffix: '' };
}

function WeeklyRewardTeaser({ reward, balance }: { reward: Reward; balance: number }) {
    const pct = Math.min(balance / reward.powr_cost, 1);
    const remaining = Math.max(reward.powr_cost - balance, 0);
    const partnerName = (reward.partner?.name ?? reward.brand_name ?? '').toUpperCase();
    const discountLabel = getDiscountLabel(reward);
    const { amount: discountAmount, suffix: discountSuffix } = getDiscountParts(discountLabel);
    const imageUri = reward.hero_image_url ?? reward.image_url;

    return (
        <View style={rewardStyles.card}>
            {imageUri && (
                <MaskedView
                    style={rewardStyles.maskedImage}
                    maskElement={
                        <LinearGradient
                            colors={['rgba(0,0,0,0)', 'black']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            locations={[0.35, 0.92]}
                            style={StyleSheet.absoluteFillObject}
                        />
                    }
                >
                    <Image
                        source={{ uri: imageUri }}
                        style={StyleSheet.absoluteFillObject}
                        resizeMode="cover"
                    />
                </MaskedView>
            )}

            <View style={rewardStyles.content}>
                <View style={rewardStyles.topRow}>
                    <View style={rewardStyles.categoryBadge}>
                        <Text style={rewardStyles.categoryBadgeText}>{reward.category.toUpperCase()}</Text>
                    </View>
                    {discountLabel ? (
                        <View style={rewardStyles.discountBadge}>
                            <Text style={rewardStyles.discountBadgeText}>{discountAmount}</Text>
                            {discountSuffix ? <Text style={rewardStyles.discountBadgeOff}>{discountSuffix}</Text> : null}
                        </View>
                    ) : null}
                </View>

                {partnerName ? <Text style={rewardStyles.partnerLabel}>{partnerName}</Text> : null}
                <Text style={rewardStyles.name}>{reward.title}</Text>
                {reward.description ? <Text style={rewardStyles.discount}>{reward.description}</Text> : null}

                <View style={rewardStyles.progressRow}>
                    <View style={rewardStyles.track}>
                        <View style={[rewardStyles.fill, { width: `${Math.round(pct * 100)}%` as any }]} />
                    </View>
                    <Text style={rewardStyles.progressPts}>{balance}/{reward.powr_cost}</Text>
                </View>

                <Text style={rewardStyles.progressHint}>
                    {pct >= 1 ? 'Ready to claim!' : `${remaining} pts to unlock`}
                </Text>
            </View>
        </View>
    );
}

const rewardStyles = StyleSheet.create({
    card: {
        position: 'relative',
    },
    maskedImage: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        right: 0,
        width: '100%',
    },
    content: {
        padding: 14,
        gap: 6,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    categoryBadge: {
        backgroundColor: 'rgba(22,101,52,0.75)',
        borderWidth: 1,
        borderColor: 'rgba(34,197,94,0.5)',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    categoryBadgeText: {
        fontSize: 8,
        fontWeight: '700',
        letterSpacing: 1.5,
        color: '#86efac',
    },
    discountBadge: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(232,210,0,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.2)',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    discountBadgeText: {
        fontSize: 14,
        fontWeight: '300',
        color: GOLD,
        lineHeight: 16,
    },
    discountBadgeOff: {
        fontSize: 7,
        fontWeight: '600',
        letterSpacing: 1,
        color: GOLD,
        opacity: 0.7,
    },
    partnerLabel: {
        fontSize: 8,
        fontWeight: '600',
        letterSpacing: 1.5,
        color: 'rgba(255,255,255,0.25)',
    },
    name: {
        fontSize: 15,
        fontWeight: '300',
        color: TEXT_PRIMARY,
        letterSpacing: -0.2,
    },
    discount: {
        fontSize: 10,
        fontWeight: '300',
        color: 'rgba(255,255,255,0.4)',
        marginBottom: 4,
    },
    progressRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    track: {
        flex: 1,
        height: 2,
        backgroundColor: 'rgba(232,210,0,0.12)',
        borderRadius: 1,
        overflow: 'hidden',
    },
    fill: {
        height: '100%',
        backgroundColor: GOLD,
        borderRadius: 1,
    },
    progressPts: {
        fontSize: 9,
        fontWeight: '500',
        color: GOLD,
        flexShrink: 0,
    },
    progressHint: {
        fontSize: 10,
        fontWeight: '300',
        color: 'rgba(255,255,255,0.25)',
    },
});

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function HomeScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const { currentStreak, multiplier, refresh: refreshStreak } = useStreak();
    const { recentItems, weekActiveDays, weeklyMetrics, dailyMetrics, refresh: refreshActivity } = useActivity();
    const { balance, totalEarned, weeklyEarned, refresh: refreshPoints } = usePoints();
    const { activeGeofence, sessionCompleted, clearSessionCompleted } = useActiveGeofence();
    const walking = useWalkingProgress();
    const health = useHealthData();
    const refreshWalking = walking.refresh;

    const [sessionModalVisible, setSessionModalVisible] = useState(false);
    const [elapsedStr, setElapsedStr] = useState('0m 00s');
    const [activePrefs, setActivePrefs] = useState<ActivityType[]>(['gym', 'running', 'walking']);
    const [healthCardDismissed, setHealthCardDismissed] = useState(false);
    const [profileName, setProfileName] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const { challenge: weeklyChallenge, completion: challengeCompletion } = useWeeklyChallenge(activePrefs);
    const [monthlyMetrics, setMonthlyMetrics] = useState<MonthlyMetrics>({ activeDays: 0, sessionCount: 0, totalSteps: 0, perType: {}, weekActiveDays: [0,0,0,0], activeDayTypes: {}, dayDetails: {} });
    const [monthlyXP, setMonthlyXP] = useState(0);
    const [featuredReward, setFeaturedReward] = useState<Reward | null>(null);
    const [sleepData, setSleepData] = useState<SleepSession | null>(null);
    const [sleepLoading, setSleepLoading] = useState(false);

    // ─── Tick overlay (interactive ring ticks) ───────────────────────────────────
    const [tickOverlay, setTickOverlay] = useState<TickOverlayData | null>(null);

    const handleTickActive = useCallback((data: TickOverlayData | null) => {
        setTickOverlay(data);
    }, []);

    const loadMonthlyData = useCallback(async () => {
        try {
            const [metrics, xp] = await Promise.all([
                fetchMonthlyMetrics(),
                fetchMonthlyEarned(),
            ]);
            setMonthlyMetrics(metrics);
            setMonthlyXP(xp);
        } catch (e) {
            console.warn('[HomeScreen] monthly data fetch failed:', e);
        }
    }, []);

    const loadFeaturedReward = useCallback(async () => {
        try {
            setFeaturedReward(await fetchFeaturedReward());
        } catch (e) {
            console.warn('[HomeScreen] featured reward fetch failed:', e);
        }
    }, []);

    useEffect(() => { loadMonthlyData(); loadFeaturedReward(); }, [loadMonthlyData, loadFeaturedReward]);

    useEffect(() => {
        if (!health.isAuthorized) return;
        setSleepLoading(true);
        health.getLastNightSleep()
            .then(setSleepData)
            .catch(() => setSleepData(null))
            .finally(() => setSleepLoading(false));
    }, [health.isAuthorized]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            const tasks: (Promise<unknown> | void)[] = [
                refreshPoints(),
                refreshActivity(),
                refreshStreak(),
                refreshWalking(),
                loadMonthlyData(),
                loadFeaturedReward(),
            ];
            if (health.isAuthorized) {
                tasks.push(health.getLastNightSleep().then(setSleepData).catch(() => {}));
            }
            await Promise.all(tasks);
        } finally {
            setRefreshing(false);
        }
    }, [refreshActivity, refreshPoints, refreshStreak, refreshWalking, loadMonthlyData, loadFeaturedReward, health]);

    // New user detection: no points earned and no recent activity
    const isNewUser = totalEarned === 0 && recentItems.length === 0;
    // Show health nudge if health is available but not connected (and not dismissed)
    const showHealthNudge = health.isAvailable && !health.isAuthorized && !healthCardDismissed;

    // Derived session state — re-computed every second via elapsedStr re-renders
    const DWELL_MS = 20 * 60 * 1000;
    const elapsedMs = activeGeofence ? Date.now() - activeGeofence.entryTimestamp : 0;
    const dwellProgress = Math.min(elapsedMs / DWELL_MS, 1);
    const projectedPoints = elapsedMs >= 45 * 60 * 1000 ? 15 : 10;
    const minsRemaining = Math.max(0, Math.ceil((DWELL_MS - elapsedMs) / 60000));

    const rotateAnim = useRef(new Animated.Value(0)).current;

    // Stable boolean — avoids restarting animations on every poll (which returns a new object ref)
    const isSessionActive = activeGeofence != null;

    // FAB orbital rotation — only while a session is active
    useEffect(() => {
        if (isSessionActive) {
            const anim = Animated.loop(
                Animated.timing(rotateAnim, {
                    toValue:  1,
                    duration: 3000,
                    easing:   Easing.linear,
                    useNativeDriver: true,
                })
            );
            anim.start();
            return () => anim.stop();
        } else {
            rotateAnim.setValue(0);
        }
    }, [isSessionActive]);

    // Live elapsed counter
    useEffect(() => {
        if (!activeGeofence) {
            setElapsedStr('0m 00s');
            return;
        }
        setElapsedStr(formatElapsed(activeGeofence.entryTimestamp));
        const tick = setInterval(() => {
            setElapsedStr(formatElapsed(activeGeofence.entryTimestamp));
        }, 1000);
        return () => clearInterval(tick);
    }, [activeGeofence]);

    // React to a completed geofence session — refresh all profile data
    useEffect(() => {
        if (!sessionCompleted) return;
        refreshPoints();
        refreshActivity();
        refreshStreak();
        clearSessionCompleted();
    }, [sessionCompleted]);

    // Fetch and sync activity preferences from profile table (more reliable than just metadata)
    useEffect(() => {
        if (!user) return;
        
        let mounted = true;

        const syncPrefs = async () => {
            try {
                // 1. Initial set from metadata if available (fastest)
                const metaPrefs = user.user_metadata?.activity_preferences;
                if (metaPrefs && Array.isArray(metaPrefs) && metaPrefs.length > 0) {
                    if (mounted) setActivePrefs(metaPrefs);
                }

                // 2. Fetch from profiles table (source of truth)
                const profile = await fetchProfile();
                if (profile?.display_name && mounted) {
                    setProfileName(profile.display_name);
                }
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

    const rotateDeg = rotateAnim.interpolate({
        inputRange:  [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    const displayName = profileName ?? user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'Hey';
    const firstName = displayName.split(' ')[0];

    // Build weekly activity rings from user's preferences
    const WEEKLY_SESSION_TARGET = 3;
    const WEEKLY_STEPS_TARGET = 50000;

    function buildWeeklyRing(type: ActivityType): WeeklyRingData {
        const config = ACTIVITIES[type] ?? ACTIVITIES.walking;
        if (type === 'walking') {
            const steps = weeklyMetrics.totalSteps;
            const pct = Math.min(steps / WEEKLY_STEPS_TARGET, 2);
            return {
                type,
                label: config.labelShort,
                icon: config.iconActive,
                iconLib: (config.iconLib ?? 'ionicons') as 'ionicons' | 'material-community',
                colour: config.colour,
                current: steps,
                target: WEEKLY_STEPS_TARGET,
                pct,
                overachieving: steps > WEEKLY_STEPS_TARGET,
            };
        }
        const sessions = weeklyMetrics.perType[type] ?? 0;
        const pct = Math.min(sessions / WEEKLY_SESSION_TARGET, 2);
        return {
            type,
            label: config.labelShort,
            icon: config.iconActive,
            iconLib: (config.iconLib ?? 'ionicons') as 'ionicons' | 'material-community',
            colour: config.colour,
            current: sessions,
            target: WEEKLY_SESSION_TARGET,
            pct,
            overachieving: sessions > WEEKLY_SESSION_TARGET,
        };
    }

    function sortForHero(rings: WeeklyRingData[]): [WeeklyRingData, WeeklyRingData, WeeklyRingData] {
        const sorted = [...rings].sort((a, b) => {
            // Incomplete activities take priority for hero spot
            if (a.overachieving !== b.overachieving) return a.overachieving ? 1 : -1;
            // Highest progress = closest to goal = hero
            return b.pct - a.pct;
        });
        return sorted as [WeeklyRingData, WeeklyRingData, WeeklyRingData];
    }

    const weeklyRings = sortForHero(activePrefs.map(buildWeeklyRing));

    // When a tick is active, override the weekly circles to show that day's activities
    const displayRings: [WeeklyRingData, WeeklyRingData, WeeklyRingData] = (() => {
        if (!tickOverlay) return weeklyRings;
        const detail = monthlyMetrics.dayDetails[tickOverlay.dayNum];
        const types = tickOverlay.types;
        // Use the day's types if available, else fall back to the user's pref types (all zeroed)
        const baseTypes: ActivityType[] = types.length > 0
            ? (types.slice(0, 3) as ActivityType[])
            : (activePrefs.slice(0, 3) as ActivityType[]);
        // Pad to exactly 3 using prefs not already present, then any fallback
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
                const pct = Math.min(steps / 10000, 2);
                return {
                    type: type as ActivityType,
                    label: config.labelShort,
                    icon: config.iconActive,
                    iconLib: (config.iconLib ?? 'ionicons') as 'ionicons' | 'material-community',
                    colour: config.colour,
                    current: steps,
                    target: 10000,
                    pct,
                    overachieving: steps > 10000,
                };
            }
            return {
                type: type as ActivityType,
                label: config.labelShort,
                icon: config.iconActive,
                iconLib: (config.iconLib ?? 'ionicons') as 'ionicons' | 'material-community',
                colour: config.colour,
                current: done ? 1 : 0,
                target: 1,
                pct: done ? 1 : 0,
                overachieving: false,
            };
        }) as [WeeklyRingData, WeeklyRingData, WeeklyRingData];
    })();

    const tickDateLabel: string | null = tickOverlay ? (() => {
        const d = new Date(new Date().getFullYear(), new Date().getMonth(), tickOverlay.dayNum);
        const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
        const monthShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        return `${monthShort} ${tickOverlay.dayNum} · ${dayName}`;
    })() : null;

    // ── Scroll-based sticky indicators ──
    const scrollY = useSharedValue(0);
    const barsOffsetY = useSharedValue(0);
    const HEADER_HEIGHT = 56;

    const onReanimatedScroll = useAnimatedScrollHandler((event) => {
      scrollY.value = event.contentOffset.y;
    });

    const onBarsLayout = (e: LayoutChangeEvent) => {
      barsOffsetY.value = e.nativeEvent.layout.y;
      // Capture natural height the first time so we can lock it during tick scrubbing
      if (weeklyNaturalHeight === 0) setWeeklyNaturalHeight(e.nativeEvent.layout.height);
    };

    const [weeklyNaturalHeight, setWeeklyNaturalHeight] = useState(0);

    const STICKY_BAR_HEIGHT = 82; // circle (48) + gap (4) + icon (14) + padding (16)

    const stickyAnimatedStyle = useAnimatedStyle(() => {
      const threshold = barsOffsetY.value - HEADER_HEIGHT;
      const isSticky = barsOffsetY.value > 0 && scrollY.value > threshold;
      return {
        opacity: withTiming(isSticky ? 1 : 0, { duration: 200 }),
        transform: [{ translateY: withTiming(isSticky ? 0 : -STICKY_BAR_HEIGHT, { duration: 200 }) }],
      };
    });

    const scrollClipStyle = useAnimatedStyle(() => {
      const threshold = barsOffsetY.value - HEADER_HEIGHT;
      const isSticky = barsOffsetY.value > 0 && scrollY.value > threshold;
      return {
        paddingTop: withTiming(isSticky ? STICKY_BAR_HEIGHT : 0, { duration: 200 }),
      };
    });

    const barsAnimatedStyle = useAnimatedStyle(() => {
      const threshold = barsOffsetY.value - HEADER_HEIGHT;
      const distance = scrollY.value - threshold;
      const opacity = interpolate(distance, [0, 40], [1, 0], Extrapolate.CLAMP);
      return { opacity };
    });

    const daysElapsed = new Date().getDate(); // day of month (1-based)
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const MONTH_NAMES = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
    const currentMonthLabel = MONTH_NAMES[now.getMonth()];

    // Week quarter caps: days 1-7, 8-14, 15-21, 22-end
    const weekCaps = [7, 7, 7, daysInMonth - 21] as const;
    const wad = monthlyMetrics.weekActiveDays ?? [0, 0, 0, 0];

    // Days elapsed within each week quarter
    const weekElapsed = [
      Math.min(7, daysElapsed),
      Math.max(0, Math.min(7, daysElapsed - 7)),
      Math.max(0, Math.min(7, daysElapsed - 14)),
      Math.max(0, Math.min(weekCaps[3], daysElapsed - 21)),
    ] as const;

    // A week is "completed" when every elapsed day in it had activity
    const weekCompleted = weekElapsed.map((elapsed, i) => elapsed > 0 && wad[i] === elapsed);

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <GeometricBackground />
            <View style={styles.header}>
                <Text style={styles.greeting}>{firstName}</Text>
                <ProfileButton />
            </View>


            {/* Sticky activity indicators — transparent, floats over background */}
            <ReAnimated.View
                style={[{
                    position: 'absolute',
                    top: insets.top + HEADER_HEIGHT,
                    left: 0,
                    right: 0,
                    zIndex: 10,
                    paddingTop: 8,
                    paddingBottom: 8,
                    paddingHorizontal: 16,
                }, stickyAnimatedStyle]}
                pointerEvents="box-none"
            >
                <StickyActivityIndicators
                    rings={weeklyRings}
                    onPressRing={(type) => router.push({ pathname: '/(tabs)/progress', params: { tab: type } })}
                />
            </ReAnimated.View>

            {/* Clipping wrapper — adds padding when sticky is active so content can't overlap */}
            <ReAnimated.View style={[{ flex: 1, overflow: 'hidden' }, scrollClipStyle]}>
                <ReAnimated.ScrollView
                    style={styles.scroll}
                    contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
                    showsVerticalScrollIndicator={false}
                    onScroll={onReanimatedScroll}
                    scrollEventThrottle={16}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor="#E8D200"
                            colors={['#E8D200']}
                        />
                    }
                >
                {isNewUser && (
                    <WelcomeNextCard
                        healthConnected={health.isAuthorized}
                        hasActivity={recentItems.length > 0}
                        onConnectHealth={() => health.requestPermissions()}
                        onFindGym={() => router.push('/(tabs)/discover')}
                        onLogWorkout={() => router.push('/manual-log')}
                    />
                )}

                <StreakCard
                    streak={currentStreak}
                    multiplier={multiplier}
                    activeDays={weekActiveDays}
                    todayIndex={TODAY_INDEX}
                    sessionActive={isSessionActive}
                    sessionPartnerName={activeGeofence?.partnerName}
                    sessionElapsed={elapsedStr}
                    sessionProgress={dwellProgress}
                    sessionDwellMet={dwellProgress >= 1}
                    sessionProjectedPts={projectedPoints}
                    onShare={() => router.push({ pathname: '/share-stats', params: { mode: 'streak' } })}
                />

                <Text style={styles.sectionLabel}>CHALLENGE</Text>
                <ChallengeCard
                    title={weeklyChallenge.title}
                    description={weeklyChallenge.description}
                    bonus={weeklyChallenge.bonusLabel}
                    expiresIn={computeExpiresIn(weeklyChallenge.expiresAt) || weeklyChallenge.expiresIn}
                    urgency={computeUrgency(weeklyChallenge.expiresAt)}
                    imageUri={weeklyChallenge.imageUri}
                    imageOffsetY={weeklyChallenge.imageOffsetY}
                    hint={weeklyChallenge.hint}
                    powrRewardText={weeklyChallenge.powrRewardText}
                    completed={challengeCompletion ?? undefined}
                />

                <Text style={styles.sectionLabel}>{tickDateLabel ?? 'WEEKLY'}</Text>

                <ReAnimated.View
                    onLayout={onBarsLayout}
                    style={[
                        barsAnimatedStyle,
                        tickOverlay && weeklyNaturalHeight > 0 ? { height: weeklyNaturalHeight, overflow: 'hidden' } : undefined,
                    ]}
                >
                    <WeeklyActivityCircles
                        rings={displayRings}
                        onPressRing={tickOverlay ? undefined : (type) => router.push({ pathname: '/(tabs)/progress', params: { tab: type } })}
                    />
                </ReAnimated.View>

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

                {showHealthNudge && (
                    <>
                        <Text style={styles.sectionLabel}>CONNECT HEALTH</Text>
                        <HealthConnectCard
                            onConnect={() => health.requestPermissions()}
                            onDismiss={() => setHealthCardDismissed(true)}
                            requesting={health.requesting}
                        />
                    </>
                )}

                {walking.isAvailable && !showHealthNudge && (
                    <>
                        <Text style={styles.sectionLabel}>TODAY&apos;S STEPS</Text>
                        <WalkingProgressCard progress={walking} />
                    </>
                )}

                {health.isAuthorized && (
                    <>
                        <Text style={styles.sectionLabel}>LAST NIGHT&apos;S SLEEP</Text>
                        <SleepProgressCard sleep={sleepData} loading={sleepLoading} />
                    </>
                )}

                {featuredReward && (
                    <>
                        <Text style={styles.sectionLabel}>WEEKLY REWARD</Text>
                        <WeeklyRewardTeaser reward={featuredReward} balance={balance} />
                    </>
                )}

            </ReAnimated.ScrollView>
            </ReAnimated.View>

            {/* FAB — orbital ring only when a session is active */}
            {/*
            <View style={styles.fabContainer}>
                {activeGeofence && (
                    <Animated.View
                        style={[styles.fabOrbit, { transform: [{ rotate: rotateDeg }] }]}
                    >
                        <View style={styles.fabOrbitDot} />
                    </Animated.View>
                )}
                <Pressable
                    style={({ pressed }) => [
                        styles.fab,
                        pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] }
                    ]}
                    onPress={() => {
                        if (activeGeofence) {
                            setSessionModalVisible(true);
                        } else {
                            router.push('/manual-log');
                        }
                    }}
                >
                    <Ionicons name="add" size={32} color="#0a0a0a" />
                </Pressable>
            </View>
            */}

            {/* Session active modal */}
            <Modal
                visible={sessionModalVisible}
                animationType="slide"
                transparent
                onRequestClose={() => setSessionModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
                        <View style={styles.modalHandle} />

                        <View style={styles.modalHeaderRow}>
                            <View style={styles.modalActiveDot} />
                            <Text style={styles.modalTitle}>Auto-tracking active</Text>
                        </View>

                        {activeGeofence && (
                            <>
                                <Text style={styles.modalPartnerName}>
                                    {activeGeofence.partnerName}
                                </Text>
                                <View style={styles.modalSessionCard}>
                                    <View style={styles.modalSessionRow}>
                                        <Text style={styles.modalSessionKey}>Time in session</Text>
                                        <Text style={styles.modalSessionVal}>{elapsedStr}</Text>
                                    </View>
                                    <View style={styles.modalDwellTrack}>
                                        <View style={[styles.modalDwellFill, {
                                            width: `${Math.round(dwellProgress * 100)}%` as any,
                                        }]} />
                                    </View>
                                    <Text style={styles.modalDwellHint}>
                                        {dwellProgress >= 1
                                            ? `Auto-tracking will award ${projectedPoints} POWR on exit`
                                            : `${minsRemaining} min until points qualify`
                                        }
                                    </Text>
                                </View>
                            </>
                        )}

                        <Pressable
                            style={({ pressed }) => [styles.modalAction, pressed && { opacity: 0.8 }]}
                            onPress={() => {
                                setSessionModalVisible(false);
                                router.push('/manual-log');
                            }}
                        >
                            <Ionicons name="create-outline" size={18} color={GOLD} />
                            <View style={styles.modalActionText}>
                                <Text style={styles.modalActionLabel}>Manual log</Text>
                                <Text style={styles.modalActionNote}>
                                    Earns 80% of base points — manual log policy
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={TEXT_MUTED} />
                        </Pressable>

                        <Pressable
                            style={({ pressed }) => [styles.modalDismiss, pressed && { opacity: 0.8 }]}
                            onPress={() => setSessionModalVisible(false)}
                        >
                            <Text style={styles.modalDismissText}>Dismiss</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>
        </View>
    );
}



// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  greeting: {
    fontSize: 28,
    fontWeight: '200',
    letterSpacing: -0.4,
    color: TEXT_PRIMARY,
  },
  avatar: {
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
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 10,
    gap: 10,
    paddingTop: 2,
  },
  // FAB container: sized to the full orbit (76×76) so the orbiting dot is never clipped
  fabContainer: {
    position: 'absolute',
    bottom: 16,  // 24 - 8 so the 60px FAB visually stays at bottom:24
    right: 16,
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Orbit ring: fills the container exactly
  fabOrbit: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    borderColor: 'rgba(232,210,0,0.18)',
  },
  // 8×8 dot at 12 o'clock of the orbit ring
  fabOrbitDot: {
    position: 'absolute',
    top: 0,
    left: 34,  // (76 / 2) - (8 / 2) = 34
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GOLD,
  },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logLink: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: TEXT_MUTED,
    textTransform: 'uppercase',
  },
  logLinkAccent: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: GOLD,
    textTransform: 'uppercase',
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
    color: TEXT_PRIMARY,
    textTransform: 'uppercase',
  },

  // Modal session info card
  modalSessionCard: {
    backgroundColor: 'rgba(232,210,0,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.15)',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  modalSessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalSessionKey: {
    fontSize: 12,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.45)',
  },
  modalSessionVal: {
    fontSize: 12,
    fontWeight: '400',
    color: TEXT_PRIMARY,
  },
  modalDwellTrack: {
    height: 3,
    backgroundColor: 'rgba(232,210,0,0.15)',
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  modalDwellFill: {
    height: '100%',
    backgroundColor: GOLD,
    borderRadius: 1.5,
  },
  modalDwellHint: {
    fontSize: 11,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.4)',
  },
  // Session modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#121212',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 16,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 8,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalActiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GOLD,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '300',
    color: TEXT_PRIMARY,
    letterSpacing: -0.3,
  },
  modalPartnerName: {
    fontSize: 14,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.5)',
    marginTop: -8,
  },
  modalAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(40,40,40,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 14,
  },
  modalActionText: {
    flex: 1,
    gap: 3,
  },
  modalActionLabel: {
    fontSize: 14,
    fontWeight: '400',
    color: TEXT_PRIMARY,
  },
  modalActionNote: {
    fontSize: 11,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.35)',
  },
  modalDismiss: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  modalDismissText: {
    fontSize: 14,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.35)',
  },
});

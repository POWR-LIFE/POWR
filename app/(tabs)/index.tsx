import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PENDING_JOIN_KEY } from '@/lib/social/inviteLinks';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import ReAnimated, {
    Extrapolate,
    interpolate,
    runOnJS,
    useAnimatedReaction,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChallengeCard } from '@/components/home/ChallengeCard';
import { TogetherSection } from '@/components/home/TogetherSection';
import { UpdateBanner } from '@/components/home/UpdateBanner';
import { LiveEventCard } from '@/components/home/LiveEventCard';
import { RewardCard } from '@/components/home/RewardCard';
import { LevelProgressRow } from '@/components/home/LevelProgressRow';
import { LevelUpCelebration } from '@/components/LevelUpCelebration';
import { GeometricBackground } from '@/components/home/GeometricBackground';
import { StickyActivityIndicators } from '@/components/home/StickyActivityIndicators';
import { StreakCard } from '@/components/home/StreakCard';
import { StreakRescueModal } from '@/components/home/StreakRescueModal';
import { WeeklyActivityBars, type WeeklyRingData } from '@/components/home/WeeklyActivityRings';
import { WeeklyActivityCircles } from '@/components/home/WeeklyActivityRings';
import { HeaderActions } from '@/components/HeaderActions';
import { WearableChip } from '@/components/WearableChip';
import { HealthGapBanner } from '@/components/HealthGapBanner';
import { SetupHealthBanner } from '@/components/SetupHealthBanner';
import NotificationPrimeSheet from '@/components/NotificationPrimeSheet';
import LocationPrimeSheet from '@/components/LocationPrimeSheet';
import HealthPrimeSheet from '@/components/HealthPrimeSheet';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { useAuth } from '@/context/AuthContext';
import { useGeofenceContext } from '@/context/GeofenceContext';
import { getGymDwellMs, getGymUpgradeMinutes, getGymUpgradeMs } from '@/lib/gymDwellConfig';
import { useActiveGeofence } from '@/hooks/useActiveGeofence';
import { useActivity } from '@/hooks/useActivity';
import { useHealthData } from '@/hooks/useHealthData';
import { useLevelUp } from '@/hooks/useLevelUp';
import { usePoints } from '@/hooks/usePoints';
import { useStreak } from '@/hooks/useStreak';
import { rescueDayIndexFor, useStreakRescue } from '@/hooks/useStreakRescue';
import { fetchSmartFeaturedReward, type Reward } from '@/lib/api/rewards';
import { fetchProfile } from '@/lib/api/user';
import { applyDetectedActivitySwap, WEEKLY_SESSION_TARGET, WEEKLY_STEPS_TARGET } from '@/lib/weeklyActivities';
import { useWeeklyChallenges, type ChallengeCardData } from '@/hooks/useWeeklyChallenge';

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

const connectorStyles = StyleSheet.create({
    wrapper: {
        alignItems: 'center',
        marginVertical: -2,
    },
    line: {
        width: 1,
        height: 14,
        backgroundColor: '#2a2a2a',
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#2a2a2a',
        borderRadius: 100,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    pillUnlocked: {
        borderColor: 'rgba(232,210,0,0.45)',
        backgroundColor: 'rgba(232,210,0,0.08)',
    },
    pillIcon: {
        marginRight: 4,
    },
    pillText: {
        fontSize: 10,
        fontWeight: '500',
        color: '#555',
        letterSpacing: 0.3,
    },
    pillTextUnlocked: {
        color: GOLD,
        fontWeight: '600',
    },
});

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function HomeScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    // A challenge invite link tapped before sign-in parked its token
    // (join-challenge stashes it and routes to auth); now that a session
    // exists, redeem it straight back into the join flow — install → sign up →
    // land in the friend's challenge, without tapping the link twice.
    useEffect(() => {
        if (!user) return;
        (async () => {
            const t = await AsyncStorage.getItem(PENDING_JOIN_KEY).catch(() => null);
            if (!t) return;
            await AsyncStorage.removeItem(PENDING_JOIN_KEY).catch(() => {});
            router.push({ pathname: '/join-challenge', params: { token: t } });
        })();
    }, [user, router]);

    const { currentStreak, multiplier, refresh: refreshStreak } = useStreak();
    const { rescue, refresh: refreshRescue } = useStreakRescue();
    const [rescueReopenNonce, setRescueReopenNonce] = useState(0);

    // Mon–Sun index of the rescue's missed day, when it falls inside the
    // current week strip (an offer whose missed day is outside this week
    // simply doesn't highlight — the strip only shows this week).
    const rescueDayIndex = useMemo(
        () => (rescue?.state === 'offered' ? rescueDayIndexFor(rescue.missedDay, TODAY_INDEX) : null),
        [rescue],
    );
    const { recentItems, weekActiveDays, weeklyMetrics, dailyMetrics, refresh: refreshActivity } = useActivity();
    const { balance, totalEarned, weeklyEarned, refresh: refreshPoints } = usePoints();
    const { activeGeofence, sessionCompleted, clearSessionCompleted } = useActiveGeofence();
    const { pending: pendingLevelUp, ack: ackLevelUp, preview: previewLevelUp } = useLevelUp();
    const { partners } = useGeofenceContext();
    const [devMsg, setDevMsg] = useState<string | null>(null);

    const handleDevClaim = useCallback(async () => {
        setDevMsg('…running');
        try {
            const { data: { session: authSession } } = await supabase.auth.getSession();
            if (!authSession) { setDevMsg('✗ Not signed in'); return; }

            const p = partners[0];
            if (!p) { setDevMsg('✗ No partners loaded — wait and retry'); return; }

            // Insert session backdated 22 min so duration_sec qualifies for gym points
            const startedAt = new Date(Date.now() - 22 * 60 * 1000).toISOString();
            const endedAt = new Date().toISOString();
            let sessionId: string;
            const { data: sess, error: sessErr } = await supabase
                .from('activity_sessions')
                .insert({
                    user_id:      authSession.user.id,
                    type:         'gym',
                    started_at:   startedAt,
                    ended_at:     endedAt,
                    duration_sec: 22 * 60,
                    verification: 'geofence',
                    trust_score:  0.94,
                    partner_id:   p.dbId,
                })
                .select('id')
                .single();

            if (sessErr) {
                if (sessErr.code === '23505') {
                    // Already have a gym session today — find it and re-use it
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const { data: existing } = await supabase
                        .from('activity_sessions')
                        .select('id')
                        .eq('user_id', authSession.user.id)
                        .eq('type', 'gym')
                        .gte('started_at', today.toISOString())
                        .order('started_at', { ascending: false })
                        .limit(1)
                        .single();
                    if (!existing) { setDevMsg('✗ 23505 but no existing session found'); return; }
                    // Update duration so it qualifies and re-claim
                    await supabase.from('activity_sessions')
                        .update({ ended_at: endedAt, duration_sec: 22 * 60 })
                        .eq('id', existing.id);
                    sessionId = existing.id;
                } else {
                    setDevMsg(`✗ DB insert: ${sessErr.message} (${sessErr.code})`); return;
                }
            } else {
                if (!sess) { setDevMsg('✗ No session returned'); return; }
                sessionId = sess.id;
            }
            setDevMsg(`Session ${sessionId.slice(0, 8)}… claiming…`);

            const { data: claimData, error: claimErr } = await supabase.functions.invoke('claim-points', {
                body: { session_id: sessionId },
            });

            if (claimErr) {
                const body = await (claimErr as { context?: { json?: () => Promise<{ error?: string }> } })
                    ?.context?.json?.().catch(() => null);
                setDevMsg(`✗ Claim: ${body?.error ?? claimErr.message}`);
                return;
            }

            const earned = (claimData as { earned?: number; amount?: number } | null)?.earned
                ?? (claimData as { earned?: number; amount?: number } | null)?.amount
                ?? '?';
            setDevMsg(`✓ +${earned} pts  (session ${sessionId.slice(0, 8)}…)`);
            await refreshPoints();
        } catch (e) {
            setDevMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
        }
    }, [partners, refreshPoints]);
    const health = useHealthData();

    const [sessionModalVisible, setSessionModalVisible] = useState(false);
    // StreakRescueModal owns its own presentation, so it reports upward — the
    // Together celebration defers to it rather than racing it to the same
    // 700ms mark and losing one of the two <Modal>s on iOS.
    const [rescueVisible, setRescueVisible] = useState(false);
    const [elapsedStr, setElapsedStr] = useState('0m 00s');
    const [activePrefs, setActivePrefs] = useState<ActivityType[]>(['gym', 'running', 'walking']);
    const [profileName, setProfileName] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const { challenges: weeklyChallenges, newlyCompletedId } = useWeeklyChallenges();
    const [featuredReward, setFeaturedReward] = useState<Reward | null>(null);

    const loadFeaturedReward = useCallback(async () => {
        try {
            setFeaturedReward(await fetchSmartFeaturedReward(balance));
        } catch (e) {
            console.warn('[HomeScreen] featured reward fetch failed:', e);
        }
    }, [balance]);

    useEffect(() => { loadFeaturedReward(); }, [loadFeaturedReward]);

    // Completed challenges share their own card (the share control is hidden until then).
    const handleChallengeShare = useCallback((challenge: ChallengeCardData) => {
        router.push({
            pathname: '/share-stats',
            params: {
                mode: 'challenge',
                challenge: JSON.stringify({
                    challengeTitle: challenge.title,
                    challengeDescription: challenge.description,
                    categoryLabel: challenge.categoryLabel,
                    tier: challenge.tier,
                    points: challenge.points,
                    displayValue: challenge.displayValue,
                    displayGoal: challenge.displayGoal,
                    unit: challenge.unit,
                }),
            },
        });
    }, [router]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            const tasks: (Promise<unknown> | void)[] = [
                refreshPoints(),
                refreshActivity(),
                refreshStreak(),
                // Pull-to-refresh is what a user does when they expect the app
                // to have noticed something — a rescue they just completed is
                // top of that list.
                refreshRescue(),
                loadFeaturedReward(),
            ];
            await Promise.all(tasks);
        } finally {
            setRefreshing(false);
        }
    }, [refreshActivity, refreshPoints, refreshStreak, refreshRescue, loadFeaturedReward]);

    // New user detection: no points earned and no recent activity
    const isNewUser = totalEarned === 0 && recentItems.length === 0;

    // Derived session state — re-computed every second via elapsedStr re-renders.
    // Both gym timers are admin-tunable (system_config → min_gym_dwell_minutes /
    // gym_upgrade_minutes), cached at launch by refreshGymDwellMinutes; fall back
    // to 30 / 40 min.
    const DWELL_MS = getGymDwellMs();
    const UPGRADE_TIER_MS = getGymUpgradeMs();
    const upgradeTierMins = getGymUpgradeMinutes();
    const elapsedMs = activeGeofence ? Date.now() - activeGeofence.entryTimestamp : 0;
    const dwellProgress = Math.min(elapsedMs / DWELL_MS, 1);
    // Projected gym points — streak-adjusted and capped at the per-day gym cap so
    // the card matches what claim-points / upgrade-gym-tier actually award. The
    // old flat 15/20 ignored the streak multiplier (e.g. a 10-day streak is 3×),
    // so it under-showed. The cap assumes no gym points earned yet today (the
    // common first-visit case); a repeat same-day visit is daily-capped server-side.
    const GYM_DAILY_CAP = 30;
    const projBase = Math.min(Math.round(15 * multiplier), GYM_DAILY_CAP);
    const projUpgrade = Math.min(Math.round(20 * multiplier), GYM_DAILY_CAP);
    const atUpgradeTier = elapsedMs >= UPGRADE_TIER_MS;
    const projectedPoints = atUpgradeTier ? projUpgrade : projBase;
    const upgradeBonus = Math.max(0, projUpgrade - projBase); // extra unlocked by staying to the upgrade tier
    const sessionMaxTier = atUpgradeTier || upgradeBonus <= 0;
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

    function sortForHero(rings: WeeklyRingData[]): WeeklyRingData[] {
        return [...rings].sort((a, b) => {
            // Incomplete activities take priority for hero spot
            if (a.overachieving !== b.overachieving) return a.overachieving ? 1 : -1;
            // Highest progress = closest to goal = hero
            return b.pct - a.pct;
        });
    }

    const weeklyRings = sortForHero(activePrefs.map(buildWeeklyRing));

    // If health data detected an activity outside the user's 3 preferences, smart-
    // swap it into the ring with the least progress so we always show exactly 3.
    // The weakest preferred ring is displaced — points for it are still earned.
    // Shared with the progress screen so both surfaces show the same 3 activities.
    const { bonusType, displacedType } = applyDetectedActivitySwap(activePrefs, weeklyMetrics);
    const displayRings: WeeklyRingData[] = bonusType
        ? weeklyRings.map(r => r.type === displacedType
            ? { ...buildWeeklyRing(bonusType), isBonus: true }
            : r)
        : weeklyRings;

    // ── Scroll-based sticky indicators ──
    const scrollY = useSharedValue(0);
    const barsOffsetY = useSharedValue(0);
    const barsHeight = useSharedValue(0);
    const HEADER_HEIGHT = 56;

    // Mirror the sticky state onto JS so we can drop the overlay's touch
    // capture while it's hidden. When not sticky the bar is translated up
    // (-82) over the header, and an opacity:0 Pressable still swallows taps —
    // that invisible ring was eating the profile-avatar press. (index bug)
    const [stickyActive, setStickyActive] = useState(false);

    const onReanimatedScroll = useAnimatedScrollHandler((event) => {
      scrollY.value = event.contentOffset.y;
    });

    const onBarsLayout = (e: LayoutChangeEvent) => {
      barsOffsetY.value = e.nativeEvent.layout.y;
      if (barsHeight.value === 0) {
        barsHeight.value = e.nativeEvent.layout.height;
      }
    };

    const STICKY_BAR_HEIGHT = 82; // circle (48) + gap (4) + icon (14) + padding (16)

    useAnimatedReaction(
      () => barsOffsetY.value > 0 && scrollY.value > barsOffsetY.value - HEADER_HEIGHT,
      (isSticky, prev) => {
        if (isSticky !== prev) runOnJS(setStickyActive)(isSticky);
      }
    );

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
      const isSticky = barsOffsetY.value > 0 && scrollY.value > threshold;
      const opacity = interpolate(distance, [0, 40], [1, 0], Extrapolate.CLAMP);

            if (isSticky) {
                return {
                    opacity,
                    height: withTiming(0, { duration: 200 }),
                    overflow: 'hidden',
                };
            }

      return {
        opacity,
                height: barsHeight.value > 0 ? barsHeight.value : undefined,
                overflow: 'visible',
      };
    });

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <GeometricBackground />
            <View style={styles.header}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                    <Text style={styles.greeting}>{balance.toLocaleString()}</Text>
                    <Text style={styles.pointsLabel}>pts</Text>
                </View>
                <View style={styles.headerRight}>
                    {/* Renders null unless the viewer has a live wearable. Sits
                        left of the shared bell/avatar cluster so it reads as
                        status rather than another action. */}
                    <WearableChip />
                    <HeaderActions />
                </View>
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
                pointerEvents={stickyActive ? 'box-none' : 'none'}
            >
                <StickyActivityIndicators
                    rings={displayRings}
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
                <UpdateBanner />
                {__DEV__ && (
                    <View style={{ marginBottom: 12, borderWidth: 1, borderColor: '#ff0', borderRadius: 8, padding: 10, gap: 8 }}>
                        <Text style={{ color: '#ff0', fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>⚠ DEV TOOLS</Text>
                        {devMsg && <Text style={{ color: '#aaa', fontSize: 11 }}>{devMsg}</Text>}
                        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                            <Pressable
                                onPress={handleDevClaim}
                                style={{ backgroundColor: '#030', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}
                            >
                                <Text style={{ color: '#4f4', fontSize: 12, fontWeight: '600' }}>Claim Session</Text>
                            </Pressable>
                            <Pressable
                                onPress={async () => {
                                    await AsyncStorage.removeItem('@powr/active_geofence');
                                    await AsyncStorage.removeItem('@powr/session_completed');
                                    setDevMsg('Session state cleared — pull to refresh.');
                                    refreshPoints();
                                }}
                                style={{ backgroundColor: '#300', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}
                            >
                                <Text style={{ color: '#f55', fontSize: 12, fontWeight: '600' }}>Clear Session</Text>
                            </Pressable>
                            <Pressable
                                onPress={async () => {
                                    const raw = await AsyncStorage.getItem('@powr/active_geofence');
                                    if (!raw) { setDevMsg('No active session in storage.'); return; }
                                    setDevMsg(`Active: ${JSON.parse(raw).partnerName} | partnerId: ${JSON.parse(raw).partnerId}`);
                                }}
                                style={{ backgroundColor: '#222', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}
                            >
                                <Text style={{ color: '#aaa', fontSize: 12, fontWeight: '600' }}>Inspect Session</Text>
                            </Pressable>
                            <Pressable
                                onPress={async () => {
                                    await refreshPoints();
                                    setDevMsg(`Balance refreshed: ${balance} pts`);
                                }}
                                style={{ backgroundColor: '#222', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}
                            >
                                <Text style={{ color: '#aaa', fontSize: 12, fontWeight: '600' }}>Refresh Points</Text>
                            </Pressable>
                        </View>
                    </View>
                )}

                <HealthGapBanner />

                {/* Above the fold with HealthGapBanner and for the same reason:
                    both report that POWR is failing to earn for the user right
                    now. Inline, not a modal — the three prime sheets below
                    already queue behind one another. */}
                <SetupHealthBanner />

                <StreakRescueModal
                    rescue={rescue}
                    reopenNonce={rescueReopenNonce}
                    deferred={!!pendingLevelUp || sessionModalVisible}
                    onVisibleChange={setRescueVisible}
                />

                <StreakCard
                    rescueDayIndex={rescueDayIndex}
                    rescueDone={rescue?.state === 'offered' ? rescue.sessionsDone : 0}
                    rescueRequired={rescue?.state === 'offered' ? rescue.sessionsRequired : 0}
                    rescueExpiresAt={rescue?.state === 'offered' ? rescue.expiresAt : null}
                    onRescuePress={() => setRescueReopenNonce(n => n + 1)}
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
                    sessionUpgradeBonus={upgradeBonus}
                    sessionUpgradeMinutes={upgradeTierMins}
                    sessionMaxTier={sessionMaxTier}
                    onShare={() => router.push({ pathname: '/share-stats', params: { mode: 'streak' } })}
                />

                <ReAnimated.View
                    onLayout={onBarsLayout}
                    style={barsAnimatedStyle}
                >
                    <WeeklyActivityCircles
                        rings={displayRings}
                        onPressRing={(type) => router.push({ pathname: '/(tabs)/progress', params: { tab: type } })}
                    />
                </ReAnimated.View>

                <LevelProgressRow
                    totalEarned={totalEarned}
                    onPress={() => router.push('/achievements')}
                    onLongPress={previewLevelUp}
                />

                {/* Shared "together" challenges — the social hero band. Sits above
                    the steady weekly grid; collapses to a slim CTA when empty so
                    the weekly card reads as the hero for users with no friends yet. */}
                {user?.user_metadata?.together_enabled !== false && (
                    <TogetherSection
                        deferred={!!pendingLevelUp || sessionModalVisible || rescueVisible}
                    />
                )}

                {/* Upcoming live event — the registration sell. Renders nothing
                    unless there's an opt-in event the viewer can still join;
                    once registered the event lives on the League tab instead. */}
                <LiveEventCard />

                <ChallengeCard
                    onTogether={(c) => router.push({ pathname: '/challenges', params: { create: '1', category: c.category } })}
                    challenges={weeklyChallenges}
                    totalBalance={balance}
                    celebrateId={newlyCompletedId}
                    onShare={handleChallengeShare}
                />

                {featuredReward && (() => {
                    const rewardUnlocked = balance >= featuredReward.powr_cost;
                    const ptsToUnlock = Math.max(0, Math.ceil(featuredReward.powr_cost - balance));
                    return (
                        <>
                            <View style={connectorStyles.wrapper}>
                                <View style={connectorStyles.line} />
                                <View style={[connectorStyles.pill, rewardUnlocked && connectorStyles.pillUnlocked]}>
                                    {rewardUnlocked && (
                                        <Ionicons name="lock-open" size={10} color={GOLD} style={connectorStyles.pillIcon} />
                                    )}
                                    <Text style={[connectorStyles.pillText, rewardUnlocked && connectorStyles.pillTextUnlocked]}>
                                        {rewardUnlocked ? 'Ready to redeem' : `${ptsToUnlock} pts to unlock`}
                                    </Text>
                                </View>
                                <View style={connectorStyles.line} />
                            </View>
                            <Pressable
                                onPress={() => router.push('/(tabs)/rewards')}
                                style={({ pressed }) => [pressed && { opacity: 0.92 }]}
                            >
                                <RewardCard reward={featuredReward} balance={balance} challengeTitle={weeklyChallenges[0]?.title ?? 'this week’s challenge'} />
                            </Pressable>
                        </>
                    );
                })()}

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
                                            ? `${projectedPoints} POWR will be awarded automatically`
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

            {/* Primed notification re-ask — self-gating (permission off + ≥1
                session banked + pacing), so mounting is unconditional. */}
            <NotificationPrimeSheet />

            {/* Primed background-location re-ask — self-gating (on "While Using"
                + ≥1 session banked + pacing), and yields to the notification
                sheet so the two never stack. Fixes silent no-earning in pocket. */}
            <LocationPrimeSheet />

            {/* Primed health re-ask — self-gating (no health data flowing + ≥1
                session banked + pacing), and yields to both sheets above. Catches
                never-connected users AND dead OS grants ("connected" in our
                records, toggles off on the device — steps silently stopped). */}
            <HealthPrimeSheet />

            {/* Level-up moment — one-shot, surfaces when lifetime points cross
                a level boundary (useLevelUp persists the last celebrated level). */}
            {pendingLevelUp && (
                <LevelUpCelebration
                    fromLevel={pendingLevelUp.fromLevel}
                    toLevel={pendingLevelUp.toLevel}
                    fromXp={pendingLevelUp.fromXp}
                    totalEarned={totalEarned}
                    onDone={ackLevelUp}
                    onShare={() => {
                        ackLevelUp();
                        router.push({ pathname: '/share-stats', params: { mode: 'level-up' } });
                    }}
                    onChallenge={() => {
                        ackLevelUp();
                        router.push({ pathname: '/challenges', params: { create: '1' } });
                    }}
                />
            )}
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
  headerRight: {
    // 7, not 12, so the gaps look equal rather than measure equal. The glyph
    // buttons are 32-wide boxes around 22px icons (5px of dead space per side);
    // the avatar is a filled 36 with none. So HeaderActions' internal gap of 12
    // renders as 17px of optical space (12 + 5 + 0) between bell and avatar,
    // while 12 here would render as 22px (12 + 5 + 5) between the two glyphs.
    // 7 + 5 + 5 = 17 matches. Kept local to the home header so the other tabs'
    // bell/avatar spacing is untouched.
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  greeting: {
    fontSize: 28,
    fontWeight: '200',
    letterSpacing: -0.4,
    color: GOLD,
  },
  pointsLabel: {
    fontSize: 13,
    fontWeight: '400',
    color: GOLD,
    opacity: 0.7,
    letterSpacing: 0.5,
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

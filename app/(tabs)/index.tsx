import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Animated, Easing, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityFeed } from '@/components/home/ActivityFeed';
import { ChallengeCard } from '@/components/home/ChallengeCard';
import { StreakCard } from '@/components/home/StreakCard';
import { WalkingProgressCard } from '@/components/home/WalkingProgressCard';
import { useAuth } from '@/context/AuthContext';
import { useActivity } from '@/hooks/useActivity';
import { useActiveGeofence } from '@/hooks/useActiveGeofence';
import { usePoints } from '@/hooks/usePoints';
import { useStreak } from '@/hooks/useStreak';
import { useWalkingProgress } from '@/hooks/useWalkingProgress';
import { ProfileButton } from '@/components/ProfileButton';
import { getLevelInfo } from '@/constants/levels';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { WeekStatsBar } from '@/components/home/WeekStatsBar';
import { GeometricBackground } from '@/components/home/GeometricBackground';
import { CombinedProgressRing } from '@/components/home/CombinedProgressRing';
import { DailyActivityCard } from '@/components/home/DailyActivityCard';
import { fetchProfile } from '@/lib/api/user';

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

const TOTAL_REWARD_PTS = 100;
const EARNED_REWARD_PTS = 44;

function WeeklyRewardTeaser() {
    const pct = EARNED_REWARD_PTS / TOTAL_REWARD_PTS;
    const remaining = TOTAL_REWARD_PTS - EARNED_REWARD_PTS;

    return (
        <View style={rewardStyles.card}>
            {/* Full-card background image */}
            <Image
                source={{ uri: 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/reward-protein.png' }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
            />

            {/* Gradient: transparent at top → semi-opaque at bottom (only enough to pop the text) */}
            <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.85)']}
                locations={[0, 0.45, 0.85]}
                style={StyleSheet.absoluteFillObject}
            />

            {/* Category + distance pinned to top */}
            <View style={rewardStyles.topRow}>
                <View style={rewardStyles.categoryBadge}>
                    <Text style={rewardStyles.categoryBadgeText}>NUTRITION</Text>
                </View>
                <View style={rewardStyles.distanceBadge}>
                    <Ionicons name="location-sharp" size={9} color={GOLD} />
                    <Text style={rewardStyles.distanceText}>0.8 mi</Text>
                </View>
            </View>

            {/* Content pinned to bottom */}
            <View style={rewardStyles.content}>
                <View style={rewardStyles.contentTop}>
                    <View style={rewardStyles.contentLeft}>
                        <Text style={rewardStyles.partnerLabel}>BULK NUTRIENTS</Text>
                        <Text style={rewardStyles.name}>Bulk Whey Protein</Text>
                        <Text style={rewardStyles.discount}>20% off your next order</Text>
                    </View>
                    <View style={rewardStyles.discountBadge}>
                        <Text style={rewardStyles.discountBadgeText}>20%</Text>
                        <Text style={rewardStyles.discountBadgeOff}>OFF</Text>
                    </View>
                </View>

                <View style={rewardStyles.progressRow}>
                    <View style={rewardStyles.track}>
                        <View style={[rewardStyles.fill, { width: `${Math.round(pct * 100)}%` as any }]} />
                    </View>
                    <Text style={rewardStyles.progressPts}>{EARNED_REWARD_PTS}/{TOTAL_REWARD_PTS}</Text>
                </View>

                <View style={rewardStyles.footer}>
                    <Text style={rewardStyles.progressHint}>{remaining} pts to unlock</Text>
                    <Pressable style={({ pressed }) => [rewardStyles.redeemBtn, pressed && { opacity: 0.8 }]}>
                        <Text style={rewardStyles.redeemText}>CLAIM</Text>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

const rewardStyles = StyleSheet.create({
    card: {
        borderRadius: 16,
        overflow: 'hidden',
        height: 200,
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 10,
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
    distanceBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: 'rgba(0,0,0,0.4)',
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 3,
    },
    distanceText: {
        fontSize: 9,
        fontWeight: '400',
        color: 'rgba(255,255,255,0.7)',
    },
    content: {
        padding: 12,
        paddingTop: 0,
        gap: 8,
        justifyContent: 'flex-end',
        flex: 1,
    },
    contentTop: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8,
    },
    contentLeft: {
        flex: 1,
        gap: 1,
    },
    partnerLabel: {
        fontSize: 8,
        fontWeight: '600',
        letterSpacing: 1.5,
        color: 'rgba(255,255,255,0.25)',
    },
    name: {
        fontSize: 14,
        fontWeight: '300',
        color: TEXT_PRIMARY,
        letterSpacing: -0.2,
    },
    discount: {
        fontSize: 10,
        fontWeight: '300',
        color: 'rgba(255,255,255,0.4)',
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
        flexShrink: 0,
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
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    progressHint: {
        fontSize: 10,
        fontWeight: '300',
        color: 'rgba(255,255,255,0.25)',
    },
    redeemBtn: {
        backgroundColor: GOLD,
        borderRadius: 20,
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    redeemText: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1.5,
        color: '#0a0a0a',
    },
});

// ─── Bottom Tab Switcher ─────────────────────────────────────────────────────

type BottomTab = 'challenge' | 'rewards' | 'activity';

const BOTTOM_TABS: { key: BottomTab; label: string }[] = [
    { key: 'challenge', label: 'CHALLENGE' },
    { key: 'rewards',   label: 'REWARDS'   },
    { key: 'activity',  label: 'ACTIVITY'  },
];

function TabBar({ active, onChange }: { active: BottomTab; onChange: (t: BottomTab) => void }) {
    return (
        <View style={tabStyles.bar}>
            {BOTTOM_TABS.map(({ key, label }) => {
                const isActive = active === key;
                return (
                    <Pressable key={key} style={tabStyles.tab} onPress={() => onChange(key)}>
                        <Text style={[tabStyles.label, isActive && tabStyles.labelActive]}>
                            {label}
                        </Text>
                        {isActive && <View style={tabStyles.indicator} />}
                    </Pressable>
                );
            })}
        </View>
    );
}

const tabStyles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.07)',
        marginBottom: 8,
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 10,
        position: 'relative',
    },
    label: {
        fontSize: 9,
        fontWeight: '500',
        letterSpacing: 1.5,
        color: 'rgba(255,255,255,0.5)',
    },
    labelActive: {
        color: '#FFFFFF',
    },
    indicator: {
        position: 'absolute',
        bottom: -1,
        left: '20%',
        right: '20%',
        height: 1.5,
        backgroundColor: '#FFFFFF',
        borderRadius: 1,
    },
});

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function HomeScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const { currentStreak, multiplier, refresh: refreshStreak } = useStreak();
    const { recentItems, weekActiveDays, weeklyMetrics, refresh: refreshActivity } = useActivity();
    const { totalEarned, weeklyEarned, refresh: refreshPoints } = usePoints();
    const { activeGeofence, sessionCompleted, clearSessionCompleted } = useActiveGeofence();
    const walking = useWalkingProgress();

    const [sessionModalVisible, setSessionModalVisible] = useState(false);
    const [bottomTab, setBottomTab] = useState<BottomTab>('challenge');
    const [elapsedStr, setElapsedStr] = useState('0m 00s');
    const [activePrefs, setActivePrefs] = useState<ActivityType[]>(['gym', 'running', 'walking']);

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

    const displayName = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'Hey';
    const firstName = displayName.split(' ')[0];

    const levelResult = getLevelInfo(totalEarned);
    const { current: levelInfo, next: nextLevel, xpIntoLevel, xpForLevel } = levelResult;

    // Build level metrics from user's activity preferences
    const prefs = activePrefs;

    function buildMetric(type: ActivityType, idx: number) {
        const config = ACTIVITIES[type];
        // Walking uses step count instead of session count
        if (type === 'walking') {
            const steps = weeklyMetrics.totalSteps;
            return {
                label: 'Steps',
                icon: config.iconActive,
                iconLib: config.iconLib,
                value: steps >= 1000 ? `${(steps / 1000).toFixed(1)}k` : String(steps),
                max: '10k',
                pct: Math.min(steps / 10000, 1),
                colour: config.colour,
                gradId: `h-g${idx}`,
                gradStart: config.colour,
                gradEnd: config.colour,
            };
        }
        const count = weeklyMetrics.perType[type] ?? 0;
        const weeklyGoal = 5;
        return {
            label: config.labelShort,
            icon: config.iconActive,
            iconLib: config.iconLib,
            value: String(count),
            max: String(weeklyGoal),
            pct: Math.min(count / weeklyGoal, 1),
            colour: config.colour,
            gradId: `h-g${idx}`,
            gradStart: config.colour,
            gradEnd: config.colour,
        };
    }

    const levelMetrics: [any, any, any] = [
        buildMetric(prefs[0] ?? 'gym', 0),
        buildMetric(prefs[1] ?? 'running', 1),
        buildMetric(prefs[2] ?? 'walking', 2),
    ];

    const nextLevelHint = nextLevel
        ? `${nextLevel.xpMin - totalEarned} pts to ${nextLevel.name}`
        : 'Max level reached';

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <GeometricBackground />
            <View style={styles.header}>
                <Text style={styles.greeting}>{firstName}</Text>
                <ProfileButton />
            </View>


            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
                showsVerticalScrollIndicator={false}
            >
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
                />

                <Text style={styles.sectionLabel}>LEVEL PROGRESS</Text>

                <CombinedProgressRing
                    levelNumber={levelInfo.level}
                    levelName={levelInfo.name}
                    xp={xpIntoLevel}
                    xpMax={xpForLevel}
                    metrics={levelMetrics}
                    nextLevelHint={nextLevelHint}
                    currentLevel={levelInfo}
                />

{walking.isAvailable && (
                    <>
                        <Text style={styles.sectionLabel}>TODAY'S STEPS</Text>
                        <WalkingProgressCard progress={walking} />
                    </>
                )}

                <Text style={styles.sectionLabel}>THIS WEEK</Text>
                <View style={styles.bottomSection}>
                    <TabBar active={bottomTab} onChange={setBottomTab} />

                    {bottomTab === 'challenge' && (
                        <ChallengeCard
                            title="Early Bird"
                            description="Gym or run before 12pm — triple points + 150 XP"
                            bonus="3× BONUS"
                            expiresIn="4h 22m"
                            imageUri="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/run_landing_page.png"
                        />
                    )}

                    {bottomTab === 'rewards' && <WeeklyRewardTeaser />}

                    {bottomTab === 'activity' && (
                        <View style={{ gap: 8 }}>
                            <DailyActivityCard 
                                completed={weekActiveDays[TODAY_INDEX]} 
                            />
                            <ActivityFeed items={recentItems} />
                        </View>
                    )}
                </View>
            </ScrollView>

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
    gap: 8,
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
  bottomSection: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    minHeight: 200,
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
    paddingTop: 4,
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

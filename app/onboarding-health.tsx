import GeometricBackground from '@/components/GeometricBackground';
import HealthDataScene from '@/components/onboarding/HealthDataScene';
import { ONBOARDING_DOT_COUNT, dotIndexFor } from '@/lib/onboarding/flow';
import { androidHealthConnectStatus, useHealthData } from '@/hooks/useHealthData';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import { syncHistoricalHealthData, setOnboardingOwnsBackfill, type DaySyncResult } from '@/lib/api/onboardingSync';
import { getNativeProviderId } from '@/lib/health/providers';
import { recordHealthOnboardingDeclined } from '@/lib/healthPrompt';
import { awardBonus } from '@/lib/api/points';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const BORDER = 'rgba(255,255,255,0.08)';
const FONT_LIGHT = 'Outfit_300Light';
const FONT_REGULAR = 'Outfit_400Regular';
const FONT_MEDIUM = 'Outfit_500Medium';
const FONT_SEMIBOLD = 'Outfit_600SemiBold';
const FONT_BOLD = 'Outfit_700Bold';

interface HealthSource {
    id: string;
    name: string;
    color: string;
    /** This source uses the native health platform (HealthKit / Health Connect) */
    native?: boolean;
    /** Platforms this source appears on; omit = all */
    platforms?: ('ios' | 'android')[];
}

// Wearables moved to their own onboarding step (/onboarding-wearables) — this
// screen is now solely the phone-health baseline everyone should have.
const HEALTH_SOURCES: HealthSource[] = [
    { id: 'apple-health',    name: 'Apple Health',    color: '#FF3B30', native: true,  platforms: ['ios'] },
    { id: 'health-connect',  name: 'Health Connect',  color: '#4285F4', native: true,  platforms: ['android'] },
];

function getVisibleSources(): HealthSource[] {
    const os = Platform.OS as string;
    return HEALTH_SOURCES.filter(s => !s.platforms || s.platforms.includes(os as 'ios' | 'android'));
}

// The full logo map stays: the primary-source picker below lists ANY connected
// provider, including wearables connected on the earlier onboarding step.
const BASE = 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/partner-logos';
const BRAND_LOGOS: Record<string, string> = {
    'apple-health':  `${BASE}/apple.png`,
    'fitbit':        `${BASE}/fitbit.png`,
    'garmin':        `${BASE}/garmin.png`,
    'whoop':         `${BASE}/whoop.png`,
    'polar':         `${BASE}/polar-logo.svg`,
    'oura':          `${BASE}/oura_logo.png`,
    'huawei':        `${BASE}/huawei-Logo.png`,
    'strava':        `${BASE}/strava-logo.png`,
    'coros':         `${BASE}/coros-logo.png`,
    'withings':      `${BASE}/withings-logo.png`,
    'peloton':       `${BASE}/pelaton-logo.png`,
    'zepp':          `${BASE}/zepp-logo.png`,
    'technogym':     `${BASE}/technogym-logo.png`,
    'suunto':        `${BASE}/suunto-logo.png`,
    'wahoo':         `${BASE}/wahoo-logo.jpeg`,
    'zwift':         `${BASE}/zwift-logo.png`,
    'concept2':      `${BASE}/concept-two.png`,
    'ifit':          `${BASE}/ifit-logo.png`,
    'underarmour':   `${BASE}/under-armour-logo.png`,
    'samsung-health':`${BASE}/samsung-health-logo.png`,
};

function BrandIcon({ id, size = 24 }: { id: string; size?: number }) {
    const logoUrl = BRAND_LOGOS[id];
    if (logoUrl) {
        return (
            <Image
                source={{ uri: logoUrl }}
                style={{ width: size, height: size }}
                contentFit="contain"
            />
        );
    }
    if (id === 'health-connect') {
        return <MaterialCommunityIcons name="heart-pulse" size={22} color="#fff" />;
    }
    return <MaterialCommunityIcons name="watch-variant" size={20} color="#fff" />;
}

function StepDots({ current }: { current: number }) {
    return (
        <View style={dotStyles.row}>
            {Array.from({ length: ONBOARDING_DOT_COUNT }, (_, i) => i).map(i => (
                <View
                    key={i}
                    style={[dotStyles.dot, i === current ? dotStyles.dotActive : dotStyles.dotInactive]}
                />
            ))}
        </View>
    );
}

const dotStyles = StyleSheet.create({
    row: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 20, },
    dot: { height: 5, borderRadius: 3 },
    dotActive: { width: 20, backgroundColor: GOLD },
    dotInactive: { width: 5, backgroundColor: 'rgba(255,255,255,0.15)' },
});

// ── Day names for progress display ───────────────────────────────────────────

function getDayName(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long' });
}

function formatDaySummary(day: DaySyncResult): string {
    const parts: string[] = [];
    if (day.steps >= 1000) {
        parts.push(`${day.steps.toLocaleString()} steps`);
    }
    if (day.activities.length > 0) {
        parts.push(day.activities.join(', '));
    }
    if (day.sleepHours > 0) {
        parts.push(`${day.sleepHours}h sleep`);
    }
    if (parts.length === 0 && day.steps > 0) {
        parts.push(`${day.steps.toLocaleString()} steps`);
    }
    if (parts.length === 0) return 'No activity';
    // The week is paid, not just shown — say so per day.
    if (day.points > 0) parts.push(`+${day.points} POWR`);
    return parts.join(' · ');
}

// ── Sync progress row ────────────────────────────────────────────────────────

function SyncDayRow({ day, index }: { day: DaySyncResult; index: number }) {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(10)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 350, delay: index * 80, useNativeDriver: true }),
            Animated.timing(slideAnim, { toValue: 0, duration: 350, delay: index * 80, useNativeDriver: true }),
        ]).start();
    }, []);

    const hasData = day.sessionCount > 0 || day.steps >= 1000;
    const summary = formatDaySummary(day);

    return (
        <Animated.View style={[
            syncStyles.dayRow,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}>
            <View style={[syncStyles.dayDot, hasData && syncStyles.dayDotActive]} />
            <View style={syncStyles.dayInfo}>
                <Text style={syncStyles.dayName}>{getDayName(day.date)}</Text>
                <Text style={[syncStyles.daySummary, hasData && syncStyles.daySummaryActive]}>
                    {summary}
                </Text>
            </View>
            {hasData && (
                <Ionicons name="checkmark-circle" size={16} color={GOLD} />
            )}
        </Animated.View>
    );
}

const syncStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 24,
        paddingTop: 8,
        gap: 4,
    },
    syncingLabel: {
        color: 'rgba(255,255,255,0.35)',
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 2,
        textTransform: 'uppercase',
        marginBottom: 8,
        textAlign: 'center',
    },
    dayRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 6,
    },
    dayDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.12)',
    },
    dayDotActive: {
        backgroundColor: GOLD,
    },
    dayInfo: {
        flex: 1,
    },
    dayName: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 11,
        fontWeight: '500',
        letterSpacing: 0.5,
    },
    daySummary: {
        color: 'rgba(255,255,255,0.2)',
        fontSize: 10,
        fontWeight: '300',
        marginTop: 1,
    },
    daySummaryActive: {
        color: 'rgba(255,255,255,0.4)',
    },
    doneCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
        marginTop: 8,
    },
    doneText: {
        color: GOLD,
        fontSize: 12,
        fontWeight: '500',
        letterSpacing: 0.5,
    },
});

export default function OnboardingHealthScreen() {
    // This screen owns the history sync (it renders the per-day progress), so
    // the silent backfill stays out of the way. Released on the next step.
    useFocusEffect(useCallback(() => { setOnboardingOwnsBackfill(true); }, []));

    const router = useRouter();
    const insets = useSafeAreaInsets();
    const health = useHealthData();
    const providers = useHealthProviders();
    // Re-read provider state when this screen regains focus — the
    // /terra-callback route navigates back here after writing
    // `health_provider_connections`, and we need to reflect that.
    useFocusEffect(
        useCallback(() => { providers.refresh(); }, [providers.refresh]),
    );
    const visibleSources = getVisibleSources();
    const [stepsToday, setStepsToday] = useState<number | null>(null);

    // Sync state
    const [syncing, setSyncing] = useState(false);
    const [syncComplete, setSyncComplete] = useState(false);
    const [syncedDays, setSyncedDays] = useState<DaySyncResult[]>([]);
    const [syncResult, setSyncResult] = useState<{
        totalSessions: number;
        totalPoints: number;
        streakDays: number;
        activeDates: string[];
    } | null>(null);

    const headerFade = useRef(new Animated.Value(0)).current;
    const rowAnims = useRef(visibleSources.map(() => new Animated.Value(0))).current;
    const buttonFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.sequence([
            Animated.timing(headerFade, { toValue: 1, duration: 450, useNativeDriver: true }),
            Animated.stagger(
                70,
                rowAnims.map(anim =>
                    Animated.timing(anim, { toValue: 1, duration: 320, useNativeDriver: true })
                )
            ),
            Animated.timing(buttonFade, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]).start();
    }, []);

    // Once authorized, fetch today's steps as proof the connection works
    useEffect(() => {
        if (health.isAuthorized) {
            health.getStepsToday().then(setStepsToday);
        }
    }, [health.isAuthorized]);

    /** Returns true if a native source is connected via the health platform */
    function isNativeConnected(source: HealthSource): boolean {
        return !!source.native && health.isAuthorized;
    }

    async function handleConnect(source: HealthSource) {
        console.log('[Onboarding] handleConnect:', source.id,
            'isAvailable:', health.isAvailable,
            'isAuthorized:', health.isAuthorized,
            'requesting:', health.requesting);
        if (health.isAuthorized) return; // already connected
        // On Android, check Health Connect is actually installed first.
        if (Platform.OS === 'android' && source.id === 'health-connect') {
            const status = await androidHealthConnectStatus();
            // Expo Go can't load the native module at all — installing Health
            // Connect wouldn't help, so say what's actually wrong (dev-only).
            if (status === 'module_missing') {
                Alert.alert(
                    'Development build needed',
                    'Health Connect isn’t available in Expo Go — run a development build to test this.',
                );
                return;
            }
            if (status === 'needs_install' || status === 'unsupported') {
                setShowHealthConnectInstall(true);
                return;
            }
        }
        const result = await health.requestPermissions();
        console.log('[Onboarding] requestPermissions result:', result);
        // Persist the connection on the user profile so settings + sync see it.
        if (result) {
            const nativeId = getNativeProviderId();
            if (nativeId) {
                try { await providers.connect(nativeId); }
                catch (e) { console.warn('[Onboarding] persist provider failed:', e); }
            }
        }
    }

    // One-time +20 POWR for connecting phone health data. Idempotent server-side,
    // and effect-driven so the Samsung-sheet path (which authorises Health Connect
    // back on the wearables step) still earns it when this screen mounts connected.
    const healthBonusFired = useRef(false);
    useEffect(() => {
        if (health.isAuthorized && !healthBonusFired.current) {
            healthBonusFired.current = true;
            awardBonus('health_connection').catch(() => {});
        }
    }, [health.isAuthorized]);

    async function handleContinue() {
        // If health is connected and we haven't synced yet, trigger the sync
        if (health.isAuthorized && !syncComplete && !syncing) {
            setSyncing(true);
            try {
                console.log('[Onboarding] Starting historical health data sync...');
                const weekData = await health.getWeekHistory();
                console.log('[Onboarding] Got week history:', weekData.length, 'days');

                const result = await syncHistoricalHealthData(weekData, (day, idx) => {
                    setSyncedDays(prev => [...prev, day]);
                });

                setSyncResult(result);
                setSyncComplete(true);

                // Brief pause to let the user see the completed state
                await new Promise(resolve => setTimeout(resolve, 1200));

                // Navigate to notifications with sync results — they get forwarded to achievement
                router.push({
                    pathname: '/onboarding-notifications',
                    params: {
                        streakDays: String(result.streakDays),
                        totalSessions: String(result.totalSessions),
                        activeDays: String(result.activeDates.length),
                    },
                });
            } catch (err) {
                console.error('[Onboarding] Sync failed:', err);
                // On failure, still navigate — just without sync data
                router.push('/onboarding-notifications');
            } finally {
                setSyncing(false);
            }
            return;
        }

        // If already synced or no health connected, navigate directly
        if (syncResult) {
            router.push({
                pathname: '/onboarding-notifications',
                params: {
                    streakDays: String(syncResult.streakDays),
                    totalSessions: String(syncResult.totalSessions),
                    activeDays: String(syncResult.activeDates.length),
                },
            });
        } else {
            router.push('/onboarding-notifications');
        }
    }

    const [showHealthConnectInstall, setShowHealthConnectInstall] = useState(false);
    const [showPrimaryPicker, setShowPrimaryPicker] = useState(false);

    // The primary CTA is CONNECT until health access is granted — CONTINUE only
    // appears once connected. The quiet escape link is revealed only after a
    // connect attempt fails (denied / burned dialog / no native health layer —
    // the CTA marks the attempt either way), so nobody can dead-end here but
    // untouched users see no way to skip.
    const nativeSource = visibleSources[0] ?? null;
    const mustConnect = !!nativeSource && !health.isAuthorized;
    const [attemptedConnect, setAttemptedConnect] = useState(false);

    // A wearable connected on the earlier onboarding step changes the pitch:
    // the phone isn't a duplicate of the watch, it's the steps/baseline layer.
    const hasWearable = providers.rows.some(r => !!r.connection && !r.meta.native);

    // Smart default for primary: dedicated wearables first, then phone health.
    const PROVIDER_PRIORITY = ['fitbit', 'strava', 'whoop', 'oura', 'garmin', 'polar', 'coros', 'suunto', 'wahoo', 'huawei', 'zepp', 'withings', 'peloton', 'technogym', 'zwift', 'concept2', 'ifit', 'underarmour', 'apple-health', 'health-connect'] as const;
    const connectedRows = providers.rows.filter(r => !!r.connection);
    const needsPrimaryChoice = connectedRows.length >= 2;

    // When a 2nd provider connects and no active set yet, open picker.
    useEffect(() => {
        if (needsPrimaryChoice && !providers.activeId) setShowPrimaryPicker(true);
    }, [needsPrimaryChoice, providers.activeId]);

    const showSyncProgress = syncing || syncComplete;

    return (
        <View style={styles.container}>
            <GeometricBackground />
            {/* Ghost watermark */}
            <Image
                source={require('@/assets/images/powr_transparent.png')}
                style={styles.watermark}
                contentFit="contain"
            />

            {/* Back button */}
            <Pressable
                style={[styles.backButton, { top: insets.top + 14 }]}
                onPress={() => {
                    if (syncing) return; // don't navigate away during sync
                    if (router.canGoBack()) {
                        router.back();
                    } else {
                        router.replace('/onboarding-activities');
                    }
                }}
                hitSlop={24}
                disabled={syncing}
            >
                <Ionicons name="chevron-back" size={26} color={syncing ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.55)'} />
            </Pressable>

            {/* Header */}
            <Animated.View style={[styles.header, { paddingTop: insets.top + 72, opacity: headerFade }]}>
                <Text style={styles.eyebrow}>{showSyncProgress ? 'ALMOST THERE' : 'YOUR BASELINE'}</Text>
                <Text style={styles.headline}>
                    {showSyncProgress ? 'Pulling in ' : 'This is how POWR '}
                    <Text style={styles.headlineGold}>{showSyncProgress ? 'your history.' : 'counts your movement.'}</Text>
                </Text>
                {!showSyncProgress && (
                    <Text style={styles.subhead}>
                        {hasWearable
                            ? 'Your watch covers workouts — your phone covers steps. You need both to earn everything.'
                            : 'Steps, workouts and sleep flow in from your phone, so every move earns automatically.'}
                    </Text>
                )}
            </Animated.View>

            {/* Source list OR sync progress */}
            {showSyncProgress ? (
                <ScrollView
                    style={styles.list}
                    contentContainerStyle={syncStyles.container}
                    showsVerticalScrollIndicator={false}
                >
                    {syncing && syncedDays.length === 0 && (
                        <View style={syncStyles.doneCard}>
                            <ActivityIndicator size="small" color={GOLD} />
                            <Text style={syncStyles.syncingLabel}>READING HEALTH DATA...</Text>
                        </View>
                    )}
                    {syncedDays.map((day, i) => (
                        <SyncDayRow key={day.date} day={day} index={i} />
                    ))}
                    {syncComplete && syncResult && (
                        <View style={syncStyles.doneCard}>
                            <Ionicons name="checkmark-circle" size={18} color={GOLD} />
                            <Text style={syncStyles.doneText}>
                                {syncResult.totalSessions} sessions synced
                                {syncResult.totalPoints > 0 ? ` · +${syncResult.totalPoints} POWR` : ''}
                                {syncResult.streakDays > 0 ? ` · ${syncResult.streakDays}-day streak` : ''}
                            </Text>
                        </View>
                    )}
                </ScrollView>
            ) : (
                <ScrollView
                    style={styles.list}
                    contentContainerStyle={[styles.listContent, styles.listContentCentered]}
                    showsVerticalScrollIndicator={false}
                >
                    {nativeSource && (
                        <Animated.View
                            style={{
                                opacity: rowAnims[0] ?? 1,
                                transform: [{
                                    translateY: (rowAnims[0] ?? new Animated.Value(1)).interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [14, 0],
                                    }),
                                }],
                            }}
                        >
                            <HealthDataScene
                                platform={nativeSource.id as 'apple-health' | 'health-connect'}
                                stepsToday={stepsToday}
                                connected={isNativeConnected(nativeSource)}
                            />
                        </Animated.View>
                    )}
                </ScrollView>
            )}

            {/* Bottom */}
            <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 32, opacity: buttonFade }]}>
                <StepDots current={dotIndexFor('/onboarding-health')} />

                <Pressable
                    style={[styles.primaryButton, syncing && { opacity: 0.7 }]}
                    onPress={() => {
                        if (mustConnect && nativeSource) {
                            setAttemptedConnect(true);
                            handleConnect(nativeSource);
                        } else {
                            handleContinue();
                        }
                    }}
                    disabled={syncing || health.requesting}
                >
                    {syncing ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <ActivityIndicator size="small" color="#0a0a0a" />
                            <Text style={styles.primaryLabel}>SYNCING YOUR DATA…</Text>
                        </View>
                    ) : mustConnect ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <Text style={styles.primaryLabel}>
                                {health.requesting ? 'CONNECTING…' : `CONNECT ${Platform.OS === 'ios' ? 'APPLE HEALTH' : 'HEALTH CONNECT'}`}
                            </Text>
                            {!health.requesting && (
                                <View style={styles.bonusBadge}>
                                    <Text style={styles.bonusLabel}>+20 POWR</Text>
                                </View>
                            )}
                        </View>
                    ) : (
                        <Text style={styles.primaryLabel}>CONTINUE</Text>
                    )}
                </Pressable>

                {mustConnect && attemptedConnect && !health.requesting && !syncing && !syncComplete && (
                    <Pressable
                        style={styles.skipButton}
                        onPress={() => {
                            // Starts the HealthPrimeSheet cool-off so the Home
                            // re-ask doesn't pitch the same person twice in a day.
                            recordHealthOnboardingDeclined().catch(() => {});
                            router.push('/onboarding-notifications');
                        }}
                    >
                        <Text style={styles.skipLabel}>Continue without connecting</Text>
                    </Pressable>
                )}
            </Animated.View>

            {/* Health Connect install prompt (Android only) */}
            <Modal
                visible={showHealthConnectInstall}
                animationType="fade"
                transparent
                onRequestClose={() => setShowHealthConnectInstall(false)}
            >
                <View style={skipModalStyles.overlay}>
                    <View style={[skipModalStyles.sheet, { paddingBottom: insets.bottom + 24 }]}>
                        <View style={skipModalStyles.handle} />
                        <View style={skipModalStyles.iconRow}>
                            <View style={skipModalStyles.iconWrap}>
                                <MaterialCommunityIcons name="download" size={24} color={GOLD} />
                            </View>
                        </View>
                        <Text style={skipModalStyles.title}>Install Health Connect</Text>
                        <Text style={skipModalStyles.reassurance}>
                            Health Connect lets POWR read your phone&apos;s step &amp; activity data. It&apos;s a free Google app — install it and come back here to connect.
                        </Text>
                        <Pressable
                            style={({ pressed }) => [skipModalStyles.connectBtn, pressed && { opacity: 0.8 }]}
                            onPress={() => {
                                Linking.openURL('market://details?id=com.google.android.apps.healthdata')
                                    .catch(() => Linking.openURL('https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata'));
                                setShowHealthConnectInstall(false);
                            }}
                        >
                            <Text style={skipModalStyles.connectBtnText}>OPEN PLAY STORE</Text>
                        </Pressable>
                        <Pressable style={skipModalStyles.skipBtn} onPress={() => setShowHealthConnectInstall(false)}>
                            <Text style={skipModalStyles.skipBtnText}>Not now</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            {/* Primary source picker — shows when 2+ are connected */}
            <Modal
                visible={showPrimaryPicker}
                animationType="slide"
                transparent
                onRequestClose={() => setShowPrimaryPicker(false)}
            >
                <View style={skipModalStyles.overlay}>
                    <View style={[skipModalStyles.sheet, { paddingBottom: insets.bottom + 24 }]}>
                        <View style={skipModalStyles.handle} />
                        <Text style={skipModalStyles.title}>Pick your primary source</Text>
                        <Text style={skipModalStyles.reassurance}>
                            You&apos;ve connected more than one. Choose which POWR should use as the source of truth for points.
                        </Text>
                        <View style={{ gap: 8, marginVertical: 8 }}>
                            {connectedRows
                                .sort((a, b) => PROVIDER_PRIORITY.indexOf(a.meta.id as any) - PROVIDER_PRIORITY.indexOf(b.meta.id as any))
                                .map(row => (
                                    <Pressable
                                        key={row.meta.id}
                                        style={({ pressed }) => [
                                            {
                                                padding: 14,
                                                borderRadius: 12,
                                                borderWidth: 1,
                                                borderColor: row.isActive ? GOLD : BORDER,
                                                backgroundColor: row.isActive ? 'rgba(232,210,0,0.08)' : 'rgba(255,255,255,0.04)',
                                            },
                                            pressed && { opacity: 0.7 },
                                        ]}
                                        onPress={async () => {
                                            await providers.setActive(row.meta.id);
                                        }}
                                    >
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                            <View style={[
                                                styles.sourceIcon,
                                                BRAND_LOGOS[row.meta.id] && styles.sourceIconWhite,
                                                { width: 32, height: 32, borderRadius: 16 },
                                            ]}>
                                                <BrandIcon id={row.meta.id} />
                                            </View>
                                            <Text style={{ color: '#F2F2F2', fontSize: 14, fontWeight: '500', flex: 1 }}>
                                                {row.meta.name}
                                            </Text>
                                            {row.isActive && (
                                                <Ionicons name="checkmark-circle" size={20} color={GOLD} />
                                            )}
                                        </View>
                                    </Pressable>
                                ))}
                        </View>
                        <Pressable
                            style={({ pressed }) => [skipModalStyles.connectBtn, pressed && { opacity: 0.8 }]}
                            onPress={() => setShowPrimaryPicker(false)}
                        >
                            <Text style={skipModalStyles.connectBtnText}>DONE</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    backButton: {
        position: 'absolute',
        left: 16,
        zIndex: 20,
        padding: 4,
    },
    header: { paddingHorizontal: 24, marginBottom: 12 },
    eyebrow: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 10,
        fontFamily: FONT_MEDIUM,
        fontWeight: '500',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        marginBottom: 12,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 32,
        fontFamily: FONT_LIGHT,
        fontWeight: '200',
        letterSpacing: -1,
        lineHeight: 36,
        marginBottom: 8,
    },
    headlineGold: { color: GOLD, fontFamily: FONT_SEMIBOLD, fontWeight: '700' },
    subhead: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 13,
        fontFamily: FONT_LIGHT,
        fontWeight: '300',
        lineHeight: 18,
        marginBottom: 12,
    },
    bonusBadge: {
        backgroundColor: 'rgba(0,0,0,0.18)',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    bonusLabel: {
        color: '#0a0a0a',
        fontSize: 9,
        fontFamily: FONT_BOLD,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    list: { flex: 1 },
    listContent: { paddingHorizontal: 24, gap: 6, paddingBottom: 8 },
    // With a single hero card, the idle state is short — centre it in the space
    // between header and CTA instead of hugging the header. (Still a ScrollView
    // so cramped screens scroll; sync progress stays top-aligned.)
    listContentCentered: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingBottom: 32,
    },
    sourceIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.30)',
    },
    sourceIconWhite: {
        backgroundColor: '#FFFFFF',
        borderColor: 'rgba(255,255,255,0.2)',
    },
    watermark: {
        position: 'absolute',
        width: 340,
        height: 340,
        top: -60,
        right: -80,
        opacity: 0.03,
    },
    bottom: { paddingHorizontal: 24 },
    primaryButton: {
        height: 52,
        borderRadius: 26,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    primaryLabel: {
        color: '#0a0a0a',
        fontSize: 12,
        fontFamily: FONT_BOLD,
        fontWeight: '700',
        letterSpacing: 1.5,
    },
    skipButton: { alignItems: 'center', paddingVertical: 12 },
    skipLabel: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 12,
        fontFamily: FONT_LIGHT,
        fontWeight: '300',
        letterSpacing: 0.2,
    },
});

const skipModalStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: '#121212',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 24,
        paddingTop: 12,
        gap: 16,
    },
    handle: {
        width: 40,
        height: 4,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 8,
    },
    iconRow: {
        alignItems: 'center',
    },
    iconWrap: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(232,210,0,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.2)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: 22,
        fontWeight: '200',
        color: '#F2F2F2',
        letterSpacing: -0.5,
        textAlign: 'center',
    },
    reassurance: {
        fontSize: 12,
        fontWeight: '300',
        color: 'rgba(255,255,255,0.3)',
        textAlign: 'center',
        lineHeight: 18,
    },
    connectBtn: {
        height: 48,
        borderRadius: 24,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
    },
    connectBtnText: {
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5,
        color: '#0a0a0a',
    },
    skipBtn: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    skipBtnText: {
        fontSize: 13,
        fontWeight: '300',
        color: 'rgba(255,255,255,0.3)',
    },
});

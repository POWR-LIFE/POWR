import { FontAwesome5, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';
import { useHealthData } from '@/hooks/useHealthData';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import { getNativeProviderId } from '@/lib/health/providers';
import { syncHistoricalHealthData, type DaySyncResult } from '@/lib/api/onboardingSync';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';

interface HealthSource {
    id: string;
    name: string;
    color: string;
    /** This source uses the native health platform (HealthKit / Health Connect) */
    native?: boolean;
    /** Platforms this source appears on; omit = all */
    platforms?: ('ios' | 'android')[];
}

const HEALTH_SOURCES: HealthSource[] = [
    { id: 'apple-health',    name: 'Apple Health',    color: '#FF3B30', native: true,  platforms: ['ios'] },
    { id: 'health-connect',  name: 'Health Connect',  color: '#4285F4', native: true,  platforms: ['android'] },
    { id: 'samsung-health',  name: 'Samsung Health',  color: '#1428A0', platforms: ['android'] },
    { id: 'whoop',           name: 'Whoop',           color: '#44D62C' },
    { id: 'garmin',          name: 'Garmin',          color: '#007DC3' },
    { id: 'fitbit',          name: 'Fitbit',          color: '#00B0B9' },
];

function getVisibleSources(): HealthSource[] {
    const os = Platform.OS as string;
    return HEALTH_SOURCES.filter(s => !s.platforms || s.platforms.includes(os as 'ios' | 'android'));
}

function BrandIcon({ id }: { id: string }) {
    switch (id) {
        case 'apple-health':
            return <FontAwesome5 name="apple" size={21} color="#fff" />;
        case 'health-connect':
            return <MaterialCommunityIcons name="heart-pulse" size={22} color="#fff" />;
        case 'samsung-health':
            return <MaterialCommunityIcons name="cellphone" size={22} color="#fff" />;
        case 'whoop':
            return <MaterialCommunityIcons name="lightning-bolt" size={22} color="#fff" />;
        case 'garmin':
            return <MaterialCommunityIcons name="compass" size={22} color="#fff" />;
        case 'fitbit':
            return <MaterialCommunityIcons name="watch-variant" size={22} color="#fff" />;
        default:
            return null;
    }
}

function StepDots({ current }: { current: number }) {
    return (
        <View style={dotStyles.row}>
            {[0, 1, 2, 3, 4].map(i => (
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
    return parts.length > 0 ? parts.join(' · ') : 'No activity';
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
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const health = useHealthData();
    const providers = useHealthProviders();
    const visibleSources = getVisibleSources();
    const [stepsToday, setStepsToday] = useState<number | null>(null);

    // Sync state
    const [syncing, setSyncing] = useState(false);
    const [syncComplete, setSyncComplete] = useState(false);
    const [syncedDays, setSyncedDays] = useState<DaySyncResult[]>([]);
    const [syncResult, setSyncResult] = useState<{
        totalSessions: number;
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
            'native:', source.native,
            'isAvailable:', health.isAvailable,
            'isAuthorized:', health.isAuthorized,
            'requesting:', health.requesting);
        if (source.native) {
            if (health.isAuthorized) return; // already connected
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
        // Non-native sources (Whoop, Garmin, etc.) are not yet implemented
    }

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

                // Navigate with sync results
                router.push({
                    pathname: '/onboarding-achievement',
                    params: {
                        streakDays: String(result.streakDays),
                        totalSessions: String(result.totalSessions),
                        activeDays: String(result.activeDates.length),
                    },
                });
            } catch (err) {
                console.error('[Onboarding] Sync failed:', err);
                // On failure, still navigate — just without sync data
                router.push('/onboarding-achievement');
            } finally {
                setSyncing(false);
            }
            return;
        }

        // If already synced or no health connected, navigate directly
        if (syncResult) {
            router.push({
                pathname: '/onboarding-achievement',
                params: {
                    streakDays: String(syncResult.streakDays),
                    totalSessions: String(syncResult.totalSessions),
                    activeDays: String(syncResult.activeDates.length),
                },
            });
        } else {
            router.push('/onboarding-achievement');
        }
    }

    const [showSkipModal, setShowSkipModal] = useState(false);

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
                <Text style={styles.eyebrow}>CONNECT YOUR DATA</Text>
                <Text style={styles.headline}>
                    Connect your{'\n'}
                    <Text style={styles.headlineGold}>health data</Text>
                </Text>
                <Text style={styles.headerBody}>
                    {showSyncProgress
                        ? 'Pulling your last 7 days of activity…'
                        : 'Connect the apps you already use. Verified workouts earn 2× points.'
                    }
                </Text>
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
                                {syncResult.streakDays > 0 ? ` · ${syncResult.streakDays}-day streak` : ''}
                            </Text>
                        </View>
                    )}
                </ScrollView>
            ) : (
                <ScrollView
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                >
                    {visibleSources.map((source, i) => {
                        const isConnected = isNativeConnected(source);
                        const isComingSoon = !source.native;
                        return (
                            <Animated.View
                                key={source.id}
                                style={{
                                    opacity: rowAnims[i],
                                    transform: [{
                                        translateY: rowAnims[i].interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [14, 0],
                                        }),
                                    }],
                                }}
                            >
                                <Pressable
                                    style={[
                                        styles.sourceRow,
                                        isConnected && styles.sourceRowConnected,
                                        isComingSoon && styles.sourceRowDisabled,
                                    ]}
                                    onPress={() => handleConnect(source)}
                                    disabled={isComingSoon || health.requesting}
                                >
                                    {/* Brand icon */}
                                    <View style={[styles.sourceIcon, isComingSoon && { opacity: 0.4 }]}>
                                        <BrandIcon id={source.id} />
                                    </View>

                                    {/* Info */}
                                    <View style={styles.sourceInfo}>
                                        <View style={styles.sourceNameRow}>
                                            <Text style={[styles.sourceName, isComingSoon && { opacity: 0.4 }]}>
                                                {source.name}
                                            </Text>
                                            {isConnected && (
                                                <View style={styles.pointsBadge}>
                                                    <Text style={styles.pointsBadgeText}>2× PTS</Text>
                                                </View>
                                            )}
                                        </View>
                                        {isComingSoon && (
                                            <Text style={styles.comingSoonLabel}>Coming soon</Text>
                                        )}
                                        {source.native && !isConnected && (
                                            <Text style={styles.sourceHint}>
                                                {Platform.OS === 'android'
                                                    ? 'Connects your Pixel Watch & phone data'
                                                    : 'Connects your Apple Watch & phone data'}
                                            </Text>
                                        )}
                                        {source.native && isConnected && stepsToday !== null && (
                                            <Text style={styles.stepsLabel}>
                                                {stepsToday.toLocaleString()} steps today
                                            </Text>
                                        )}
                                    </View>

                                    {/* Connect / Connected / Coming Soon pill */}
                                    {isConnected ? (
                                        <View style={styles.connectedPill}>
                                            <MaterialCommunityIcons name="check" size={11} color="#FFFFFF" style={{ marginRight: 3 }} />
                                            <Text style={[styles.pillLabel, { color: '#FFFFFF' }]}>CONNECTED</Text>
                                        </View>
                                    ) : isComingSoon ? (
                                        <View style={styles.comingSoonPill}>
                                            <Text style={[styles.pillLabel, { color: 'rgba(255,255,255,0.2)' }]}>SOON</Text>
                                        </View>
                                    ) : (
                                        <View style={styles.connectPill}>
                                            <Text style={[styles.pillLabel, { color: '#FFFFFF' }]}>
                                                {health.requesting ? '...' : 'CONNECT'}
                                            </Text>
                                        </View>
                                    )}
                                </Pressable>
                            </Animated.View>
                        );
                    })}
                </ScrollView>
            )}

            {/* Bottom */}
            <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 32, opacity: buttonFade }]}>
                <StepDots current={3} />

                <Pressable
                    style={[styles.primaryButton, syncing && { opacity: 0.7 }]}
                    onPress={handleContinue}
                    disabled={syncing}
                >
                    {syncing ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <ActivityIndicator size="small" color="#0a0a0a" />
                            <Text style={styles.primaryLabel}>SYNCING YOUR DATA…</Text>
                        </View>
                    ) : (
                        <Text style={styles.primaryLabel}>CONTINUE</Text>
                    )}
                </Pressable>

                {!syncing && !syncComplete && (
                    <Pressable
                        style={styles.skipButton}
                        onPress={() => setShowSkipModal(true)}
                    >
                        <Text style={styles.skipLabel}>Skip — connect later in settings</Text>
                    </Pressable>
                )}
            </Animated.View>

            {/* Skip confirmation modal */}
            <Modal
                visible={showSkipModal}
                animationType="slide"
                transparent
                onRequestClose={() => setShowSkipModal(false)}
            >
                <View style={skipModalStyles.overlay}>
                    <View style={[skipModalStyles.sheet, { paddingBottom: insets.bottom + 24 }]}>
                        <View style={skipModalStyles.handle} />

                        <View style={skipModalStyles.iconRow}>
                            <View style={skipModalStyles.iconWrap}>
                                <Ionicons name="information-circle" size={24} color={GOLD} />
                            </View>
                        </View>

                        <Text style={skipModalStyles.title}>You'll miss out on</Text>

                        <View style={skipModalStyles.benefits}>
                            <View style={skipModalStyles.benefitRow}>
                                <Ionicons name="footsteps" size={16} color={GOLD} />
                                <View style={skipModalStyles.benefitInfo}>
                                    <Text style={skipModalStyles.benefitTitle}>Auto step tracking</Text>
                                    <Text style={skipModalStyles.benefitDesc}>Earn points passively just by walking</Text>
                                </View>
                            </View>
                            <View style={skipModalStyles.benefitRow}>
                                <Ionicons name="shield-checkmark" size={16} color={GOLD} />
                                <View style={skipModalStyles.benefitInfo}>
                                    <Text style={skipModalStyles.benefitTitle}>2× verified workout points</Text>
                                    <Text style={skipModalStyles.benefitDesc}>Health-verified sessions earn double</Text>
                                </View>
                            </View>
                            <View style={skipModalStyles.benefitRow}>
                                <Ionicons name="analytics" size={16} color={GOLD} />
                                <View style={skipModalStyles.benefitInfo}>
                                    <Text style={skipModalStyles.benefitTitle}>Sleep & recovery insights</Text>
                                    <Text style={skipModalStyles.benefitDesc}>Track your full wellness picture</Text>
                                </View>
                            </View>
                        </View>

                        <Text style={skipModalStyles.reassurance}>
                            You can still earn points through gym check-ins and manual logging. Connect health data anytime from Settings.
                        </Text>

                        <Pressable
                            style={({ pressed }) => [skipModalStyles.connectBtn, pressed && { opacity: 0.8 }]}
                            onPress={() => setShowSkipModal(false)}
                        >
                            <Text style={skipModalStyles.connectBtnText}>CONNECT NOW</Text>
                        </Pressable>

                        <Pressable
                            style={skipModalStyles.skipBtn}
                            onPress={() => {
                                setShowSkipModal(false);
                                router.push('/onboarding-achievement');
                            }}
                        >
                            <Text style={skipModalStyles.skipBtnText}>Continue without connecting</Text>
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
    header: { paddingHorizontal: 24, marginBottom: 20 },
    eyebrow: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        marginBottom: 12,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 40,
        fontWeight: '200',
        letterSpacing: -1,
        lineHeight: 46,
        marginBottom: 10,
    },
    headlineGold: { color: GOLD, fontWeight: '700' },
    headerBody: {
        color: 'rgba(255,255,255,0.38)',
        fontSize: 13,
        fontWeight: '300',
        lineHeight: 20,
    },
    list: { flex: 1 },
    listContent: { paddingHorizontal: 24, gap: 8, paddingBottom: 16 },
    sourceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 14,
        gap: 12,
    },
    sourceRowConnected: {
        borderColor: 'rgba(232,210,0,0.3)',
        backgroundColor: 'rgba(232,210,0,0.04)',
    },
    sourceRowDisabled: {
        opacity: 0.55,
    },
    sourceIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.30)',
    },
    watermark: {
        position: 'absolute',
        width: 340,
        height: 340,
        top: -60,
        right: -80,
        opacity: 0.03,
    },
    sourceInfo: { flex: 1 },
    sourceNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 2,
    },
    sourceName: {
        color: '#F2F2F2',
        fontSize: 14,
        fontWeight: '500',
    },
    sourceHint: {
        color: 'rgba(255,255,255,0.3)',
        fontSize: 11,
        fontWeight: '300',
        marginTop: 1,
    },
    stepsLabel: {
        color: GOLD,
        fontSize: 11,
        fontWeight: '500',
        marginTop: 2,
    },
    comingSoonLabel: {
        color: 'rgba(255,255,255,0.25)',
        fontSize: 10,
        fontWeight: '400',
        letterSpacing: 0.3,
        marginTop: 1,
    },
    pointsBadge: {
        backgroundColor: 'rgba(232,210,0,0.12)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.25)',
        borderRadius: 4,
        paddingHorizontal: 5,
        paddingVertical: 2,
    },
    pointsBadgeText: {
        color: GOLD,
        fontSize: 8,
        fontWeight: '700',
        letterSpacing: 0.8,
    },
    connectPill: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.8)',
    },
    comingSoonPill: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    connectedPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.8)',
        backgroundColor: 'transparent',
    },
    pillLabel: {
        fontSize: 9,
        fontWeight: '700',
        letterSpacing: 1.5,
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
        fontWeight: '700',
        letterSpacing: 1.5,
    },
    skipButton: { alignItems: 'center', paddingVertical: 12 },
    skipLabel: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 12,
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
    benefits: {
        gap: 14,
    },
    benefitRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingVertical: 2,
    },
    benefitInfo: {
        flex: 1,
        gap: 2,
    },
    benefitTitle: {
        fontSize: 14,
        fontWeight: '400',
        color: '#F2F2F2',
    },
    benefitDesc: {
        fontSize: 11,
        fontWeight: '300',
        color: 'rgba(255,255,255,0.4)',
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

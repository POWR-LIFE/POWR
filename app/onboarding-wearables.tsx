import GeometricBackground from '@/components/GeometricBackground';
import { ONBOARDING_DOT_COUNT, dotIndexFor } from '@/lib/onboarding/flow';
import { androidHealthConnectStatus, useHealthData } from '@/hooks/useHealthData';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import { getNativeProviderId, type HealthProviderId } from '@/lib/health/providers';
import { setOnboardingOwnsBackfill } from '@/lib/api/onboardingSync';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Dimensions, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const BORDER = 'rgba(255,255,255,0.08)';
const FONT_LIGHT = 'Outfit_300Light';
const FONT_MEDIUM = 'Outfit_500Medium';
const FONT_SEMIBOLD = 'Outfit_600SemiBold';
const FONT_BOLD = 'Outfit_700Bold';

const GRID_GAP = 8;
const GRID_PAD = 24;
const CARD_W = Math.floor((Dimensions.get('window').width - GRID_PAD * 2 - GRID_GAP * 2) / 3);

interface WearableSource {
    id: string;
    name: string;
    /** Platforms this source appears on; omit = all */
    platforms?: ('ios' | 'android')[];
}

// Cloud wearables via Terra (all connect through the same authenticateUser flow).
const WEARABLE_SOURCES: WearableSource[] = [
    { id: 'whoop',           name: 'Whoop' },
    { id: 'oura',            name: 'Oura' },
    { id: 'polar',           name: 'Polar' },
    { id: 'garmin',          name: 'Garmin' },
    { id: 'fitbit',          name: 'Fitbit' },
    { id: 'strava',          name: 'Strava' },
    { id: 'huawei',          name: 'Huawei Health' },
    { id: 'withings',        name: 'Withings' },
    { id: 'peloton',         name: 'Peloton' },
    { id: 'zepp',            name: 'Zepp' },
    { id: 'technogym',       name: 'Technogym' },
    { id: 'coros',           name: 'Coros' },
    { id: 'suunto',          name: 'Suunto' },
    { id: 'wahoo',           name: 'Wahoo' },
    { id: 'zwift',           name: 'Zwift' },
    { id: 'concept2',        name: 'Concept2' },
    { id: 'ifit',            name: 'iFit' },
    { id: 'underarmour',     name: 'Under Armour' },
    // Samsung Health is SDK-only on Terra (no direct OAuth) — shown alongside the
    // wearables for consistency, but tapping it routes through Health Connect via an
    // explainer sheet (see handleConnect). Android only.
    { id: 'samsung-health',  name: 'Samsung Health',  platforms: ['android'] },
];

function getVisibleSources(): WearableSource[] {
    const os = Platform.OS as string;
    return WEARABLE_SOURCES.filter(s => !s.platforms || s.platforms.includes(os as 'ios' | 'android'));
}

const BASE = 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/partner-logos';
const BRAND_LOGOS: Record<string, string> = {
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

export default function OnboardingWearablesScreen() {
    // Onboarding drives the 7-day history sync itself (with per-day progress on
    // the next step), so the silent late backfill stands down from here until
    // the notifications step releases it.
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

    const headerFade = useRef(new Animated.Value(0)).current;
    const cardAnims = useRef(visibleSources.map(() => new Animated.Value(0))).current;
    const buttonFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.sequence([
            Animated.timing(headerFade, { toValue: 1, duration: 450, useNativeDriver: true }),
            Animated.stagger(
                40,
                cardAnims.map(anim =>
                    Animated.timing(anim, { toValue: 1, duration: 320, useNativeDriver: true })
                )
            ),
            Animated.timing(buttonFade, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]).start();
    }, []);

    const [showHealthConnectInstall, setShowHealthConnectInstall] = useState(false);
    const [showSamsungSheet, setShowSamsungSheet] = useState(false);

    async function connectHealthConnect() {
        // Samsung path only — its data reaches POWR through Health Connect.
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
        const result = await health.requestPermissions();
        if (result) {
            const nativeId = getNativeProviderId();
            if (nativeId) {
                try { await providers.connect(nativeId); }
                catch (e) { console.warn('[Onboarding] persist provider failed:', e); }
            }
        }
    }

    async function handleConnect(source: WearableSource) {
        // Samsung Health has no direct OAuth (SDK-only on Terra) — it shares data via
        // Health Connect. Show the explainer sheet, which then connects Health Connect.
        if (source.id === 'samsung-health') {
            setShowSamsungSheet(true);
            return;
        }
        // All other sources are Terra-backed cloud wearables — connect opens the
        // provider's auth in a system browser and returns via /terra-callback
        // (which navigates back here and refreshes provider state on focus).
        try { await providers.connect(source.id as HealthProviderId); }
        catch (e) { console.warn(`[Onboarding] ${source.id} connect failed:`, e); }
    }

    const anyWearableConnected = providers.rows.some(r => !!r.connection && !r.meta.native)
        || (Platform.OS === 'android' && health.isAuthorized);

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
                    if (router.canGoBack()) {
                        router.back();
                    } else {
                        router.replace('/onboarding-permission-background');
                    }
                }}
                hitSlop={24}
            >
                <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
            </Pressable>

            {/* Header */}
            <Animated.View style={[styles.header, { paddingTop: insets.top + 72, opacity: headerFade }]}>
                <Text style={styles.eyebrow}>GOT A WEARABLE?</Text>
                <Text style={styles.headline}>
                    Your watch knows <Text style={styles.headlineGold}>everything.</Text>
                </Text>
                <View style={styles.bonusRow}>
                    <View style={styles.bonusPill}>
                        <Text style={styles.bonusPillText}>+20 POWR</Text>
                    </View>
                    <Text style={styles.bonusHint}>when you connect one</Text>
                </View>
            </Animated.View>

            {/* Wearable grid */}
            <ScrollView
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.wearableGrid}>
                    {visibleSources.map((source, i) => {
                        const providerRow = providers.rows.find(r => r.meta.id === source.id);
                        // Samsung Health routes through Health Connect, so it reads as
                        // connected whenever the native health platform is authorised.
                        const isConnected = !!providerRow?.connection
                            || (source.id === 'samsung-health' && health.isAuthorized);
                        return (
                            <Animated.View
                                key={source.id}
                                style={{
                                    opacity: cardAnims[i] ?? 1,
                                    transform: [{
                                        translateY: (cardAnims[i] ?? new Animated.Value(1)).interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [14, 0],
                                        }),
                                    }],
                                }}
                            >
                                <Pressable
                                    style={[styles.wearableCard, isConnected && styles.wearableCardConnected]}
                                    onPress={() => handleConnect(source)}
                                    disabled={health.requesting}
                                >
                                    <View style={[styles.cardLogoWrap, BRAND_LOGOS[source.id] && styles.cardLogoWrapWhite]}>
                                        <BrandIcon id={source.id} size={Math.round(CARD_W * 0.44)} />
                                    </View>
                                    <Text style={styles.cardName} numberOfLines={1}>{source.name}</Text>
                                    {isConnected && (
                                        <View style={styles.cardCheckBadge}>
                                            <MaterialCommunityIcons name="check" size={10} color="#fff" />
                                        </View>
                                    )}
                                </Pressable>
                            </Animated.View>
                        );
                    })}
                </View>
            </ScrollView>

            {/* Bottom */}
            <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 32, opacity: buttonFade }]}>
                <StepDots current={dotIndexFor('/onboarding-wearables')} />

                <Pressable
                    style={styles.primaryButton}
                    onPress={() => router.push('/onboarding-activities')}
                >
                    <Text style={styles.primaryLabel}>CONTINUE</Text>
                </Pressable>

                {!anyWearableConnected && (
                    <Pressable
                        style={styles.skipButton}
                        onPress={() => router.push('/onboarding-activities')}
                    >
                        <Text style={styles.skipLabel}>I don&apos;t have a wearable</Text>
                    </Pressable>
                )}
            </Animated.View>

            {/* Health Connect install prompt (Android only, Samsung path) */}
            <Modal
                visible={showHealthConnectInstall}
                animationType="fade"
                transparent
                onRequestClose={() => setShowHealthConnectInstall(false)}
            >
                <View style={sheetStyles.overlay}>
                    <View style={[sheetStyles.sheet, { paddingBottom: insets.bottom + 24 }]}>
                        <View style={sheetStyles.handle} />
                        <View style={sheetStyles.iconRow}>
                            <View style={sheetStyles.iconWrap}>
                                <MaterialCommunityIcons name="download" size={24} color={GOLD} />
                            </View>
                        </View>
                        <Text style={sheetStyles.title}>Install Health Connect</Text>
                        <Text style={sheetStyles.reassurance}>
                            Health Connect lets POWR read your phone&apos;s step &amp; activity data. It&apos;s a free Google app — install it and come back here to connect.
                        </Text>
                        <Pressable
                            style={({ pressed }) => [sheetStyles.connectBtn, pressed && { opacity: 0.8 }]}
                            onPress={() => {
                                Linking.openURL('market://details?id=com.google.android.apps.healthdata')
                                    .catch(() => Linking.openURL('https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata'));
                                setShowHealthConnectInstall(false);
                            }}
                        >
                            <Text style={sheetStyles.connectBtnText}>OPEN PLAY STORE</Text>
                        </Pressable>
                        <Pressable style={sheetStyles.skipBtn} onPress={() => setShowHealthConnectInstall(false)}>
                            <Text style={sheetStyles.skipBtnText}>Not now</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            {/* Samsung Health explainer (Android) — connects via Health Connect */}
            <Modal
                visible={showSamsungSheet}
                animationType="slide"
                transparent
                onRequestClose={() => setShowSamsungSheet(false)}
            >
                <View style={sheetStyles.overlay}>
                    <View style={[sheetStyles.sheet, { paddingBottom: insets.bottom + 24 }]}>
                        <View style={sheetStyles.handle} />
                        <View style={sheetStyles.iconRow}>
                            <View style={sheetStyles.iconWrap}>
                                <MaterialCommunityIcons name="heart-pulse" size={24} color={GOLD} />
                            </View>
                        </View>
                        <Text style={sheetStyles.title}>Connect Samsung Health</Text>
                        <Text style={sheetStyles.reassurance}>
                            Samsung Health shares your workouts, steps &amp; sleep through Health Connect. Two quick steps:
                        </Text>
                        <View style={sheetStyles.benefits}>
                            <View style={sheetStyles.benefitRow}>
                                <Ionicons name="link" size={16} color={GOLD} />
                                <View style={sheetStyles.benefitInfo}>
                                    <Text style={sheetStyles.benefitTitle}>1. Connect Health Connect</Text>
                                    <Text style={sheetStyles.benefitDesc}>POWR reads your data from Health Connect</Text>
                                </View>
                            </View>
                            <View style={sheetStyles.benefitRow}>
                                <Ionicons name="toggle" size={16} color={GOLD} />
                                <View style={sheetStyles.benefitInfo}>
                                    <Text style={sheetStyles.benefitTitle}>2. Turn on sharing in Samsung Health</Text>
                                    <Text style={sheetStyles.benefitDesc}>Samsung Health → Settings → Health Connect → allow</Text>
                                </View>
                            </View>
                        </View>
                        <Pressable
                            style={({ pressed }) => [sheetStyles.connectBtn, pressed && { opacity: 0.8 }]}
                            onPress={() => {
                                setShowSamsungSheet(false);
                                connectHealthConnect();
                            }}
                        >
                            <Text style={sheetStyles.connectBtnText}>CONNECT HEALTH CONNECT</Text>
                        </Pressable>
                        <Pressable
                            style={sheetStyles.skipBtn}
                            onPress={() => {
                                Linking.openURL('market://details?id=com.sec.android.app.shealth')
                                    .catch(() => Linking.openURL('https://play.google.com/store/apps/details?id=com.sec.android.app.shealth'));
                            }}
                        >
                            <Text style={sheetStyles.skipBtnText}>Open Samsung Health</Text>
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
    header: { paddingHorizontal: 24, marginBottom: 16 },
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
        marginBottom: 12,
    },
    headlineGold: { color: GOLD, fontFamily: FONT_SEMIBOLD, fontWeight: '700' },
    bonusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    bonusPill: {
        backgroundColor: 'rgba(232,210,0,0.12)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.3)',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    bonusPillText: {
        color: GOLD,
        fontSize: 9,
        fontFamily: FONT_BOLD,
        fontWeight: '700',
        letterSpacing: 0.8,
    },
    bonusHint: {
        color: 'rgba(255,255,255,0.35)',
        fontSize: 12,
        fontFamily: FONT_LIGHT,
        fontWeight: '300',
    },
    watermark: {
        position: 'absolute',
        width: 340,
        height: 340,
        top: -60,
        right: -80,
        opacity: 0.03,
    },
    list: { flex: 1 },
    listContent: { paddingHorizontal: 24, paddingBottom: 8 },
    wearableGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: GRID_GAP,
    },
    wearableCard: {
        width: CARD_W,
        paddingVertical: 14,
        alignItems: 'center',
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: 'transparent',
        borderRadius: 16,
        gap: 8,
    },
    wearableCardConnected: {
        borderColor: 'rgba(232,210,0,0.35)',
        backgroundColor: 'rgba(232,210,0,0.04)',
    },
    cardLogoWrap: {
        width: CARD_W * 0.56,
        height: CARD_W * 0.56,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.06)',
    },
    cardLogoWrapWhite: {
        backgroundColor: '#FFFFFF',
    },
    cardName: {
        color: 'rgba(255,255,255,0.65)',
        fontSize: 10,
        fontFamily: FONT_MEDIUM,
        fontWeight: '500',
        letterSpacing: 0.2,
        textAlign: 'center',
        paddingHorizontal: 4,
    },
    cardCheckBadge: {
        position: 'absolute',
        top: 7,
        right: 7,
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
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

const sheetStyles = StyleSheet.create({
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

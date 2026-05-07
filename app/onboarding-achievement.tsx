import { useAuth } from '@/context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import GeometricBackground from '@/components/GeometricBackground';

const GOLD = '#E8D200';
const BG = '#0d0d0d';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Ring geometry — 7 segments
const CONTAINER = 340;
const RING_R = 138;
const SW = 3;
const CX = CONTAINER / 2;
const CY = CONTAINER / 2;
const SEGMENTS = 7;
const GAP_DEG = 6; // visual gap between segments
const SEG_DEG = 360 / SEGMENTS - GAP_DEG;

function polar(r: number, deg: number) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arcPath(r: number, startDeg: number, endDeg: number) {
    const s = polar(r, startDeg);
    const e = polar(r, endDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

// Sparkle burst — 12 evenly spaced dots
const SPARKS = Array.from({ length: 12 }, (_, i) => (i * 360) / 12);

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
    row: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 20 },
    dot: { height: 5, borderRadius: 3 },
    dotActive: { width: 20, backgroundColor: GOLD },
    dotInactive: { width: 5, backgroundColor: 'rgba(255,255,255,0.15)' },
});

export default function OnboardingAchievementScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { markOnboardingComplete } = useAuth();
    const params = useLocalSearchParams<{ streakDays?: string; totalSessions?: string; activeDays?: string }>();

    // Parse sync results from route params (0 = skipped / no data)
    const streakDays = parseInt(params.streakDays ?? '0', 10) || 0;
    const totalSessions = parseInt(params.totalSessions ?? '0', 10) || 0;
    const activeDays = parseInt(params.activeDays ?? '0', 10) || 0;
    const hasSyncData = streakDays > 0 || totalSessions > 0;

    // Display values
    const displayStreak = hasSyncData ? streakDays : 1;
    // --- Animated values ---
    const glowIn        = useRef(new Animated.Value(0)).current;
    const ringScaleIn   = useRef(new Animated.Value(0.78)).current;
    const segmentOps    = useRef(Array.from({ length: SEGMENTS }, () => new Animated.Value(0))).current;
    const numberScale   = useRef(new Animated.Value(0)).current;
    const numberOpacity = useRef(new Animated.Value(0)).current;
    const contentOpacity = useRef(new Animated.Value(0)).current;
    const contentY      = useRef(new Animated.Value(30)).current;
    const bonusOpacity  = useRef(new Animated.Value(0)).current;
    const bonusY        = useRef(new Animated.Value(30)).current;
    const buttonOpacity = useRef(new Animated.Value(0)).current;
    const pulse         = useRef(new Animated.Value(1)).current;

    // Per-spark: opacity + radial translate progress
    const sparks = useRef(
        SPARKS.map(() => ({
            op: new Animated.Value(0),
            r:  new Animated.Value(0),
        }))
    ).current;

    const burstSparks = () => {
        Animated.parallel(
            sparks.flatMap((s) => [
                Animated.sequence([
                    Animated.timing(s.op, { toValue: 1, duration: 60, useNativeDriver: true }),
                    Animated.timing(s.op, { toValue: 0, duration: 500, useNativeDriver: true }),
                ]),
                Animated.timing(s.r, { toValue: 1, duration: 560, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            ])
        ).start();
    };

    useEffect(() => {
        Animated.sequence([
            // 1. Glow + ring scale in
            Animated.parallel([
                Animated.timing(glowIn, { toValue: 1, duration: 750, useNativeDriver: true }),
                Animated.timing(ringScaleIn, {
                    toValue: 1,
                    duration: 750,
                    easing: Easing.out(Easing.back(1.06)),
                    useNativeDriver: true,
                }),
            ]),
            // 2. Segments light up one by one, up to displayStreak
            Animated.stagger(
                140,
                segmentOps.slice(0, Math.min(displayStreak, SEGMENTS)).map((v) =>
                    Animated.timing(v, {
                        toValue: 1,
                        duration: 360,
                        easing: Easing.out(Easing.cubic),
                        useNativeDriver: true,
                    }),
                ),
            ),
        ]).start(() => {
            // Ring complete → sparks + number pop
            burstSparks();
            Animated.spring(numberScale, { toValue: 1, tension: 75, friction: 5, useNativeDriver: true }).start();
            Animated.timing(numberOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();

            // Headline slides up
            setTimeout(() => {
                Animated.parallel([
                    Animated.timing(contentOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
                    Animated.timing(contentY, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
                ]).start();
            }, 160);

            // Bonus card
            setTimeout(() => {
                Animated.parallel([
                    Animated.timing(bonusOpacity, { toValue: 1, duration: 460, useNativeDriver: true }),
                    Animated.timing(bonusY, { toValue: 0, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
                ]).start();
            }, 360);

            // Button + pulse loop
            setTimeout(() => {
                Animated.timing(buttonOpacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
                Animated.loop(
                    Animated.sequence([
                        Animated.timing(pulse, { toValue: 1.028, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                        Animated.timing(pulse, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                    ])
                ).start();
            }, 580);
        });
    }, []);

    return (
        <View style={styles.container}>
            <GeometricBackground />
            {/* Back button */}
            <Pressable
                style={[styles.backButton, { top: insets.top + 14 }]}
                onPress={() => {
                    if (router.canGoBack()) {
                        router.back();
                    } else {
                        router.replace('/onboarding-activities');
                    }
                }}
                hitSlop={24}
            >
                <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
            </Pressable>

            {/* Main content */}
            <View style={styles.center}>

                {/* ── Ring area ── */}
                <Animated.View style={{ transform: [{ scale: pulse }] }}>
                    <Animated.View
                        style={[styles.ringContainer, { transform: [{ scale: ringScaleIn }] }]}
                    >
                        {/* Layered glow — stacked circles faking a radial gradient */}
                        <Animated.View style={[
                            styles.glow, { width: 140, height: 140, borderRadius: 70, left: (CONTAINER - 140) / 2, top: (CONTAINER - 140) / 2 },
                            { opacity: glowIn.interpolate({ inputRange: [0, 1], outputRange: [0, 0.32] }) },
                        ]} />
                        <Animated.View style={[
                            styles.glow, { width: 220, height: 220, borderRadius: 110, left: (CONTAINER - 220) / 2, top: (CONTAINER - 220) / 2 },
                            { opacity: glowIn.interpolate({ inputRange: [0, 1], outputRange: [0, 0.14] }) },
                        ]} />
                        <Animated.View style={[
                            styles.glow, { width: 310, height: 310, borderRadius: 155, left: (CONTAINER - 310) / 2, top: (CONTAINER - 310) / 2 },
                            { opacity: glowIn.interpolate({ inputRange: [0, 1], outputRange: [0, 0.07] }) },
                        ]} />

                        {/* SVG segmented ring */}
                        <Svg width={CONTAINER} height={CONTAINER} style={StyleSheet.absoluteFillObject}>
                            {Array.from({ length: SEGMENTS }, (_, i) => {
                                const start = i * (360 / SEGMENTS) + GAP_DEG / 2;
                                const end = start + SEG_DEG;
                                const d = arcPath(RING_R, start, end);
                                return (
                                    <Path
                                        key={`track-${i}`}
                                        d={d}
                                        stroke="rgba(255,255,255,0.07)"
                                        strokeWidth={SW}
                                        strokeLinecap="round"
                                        fill="none"
                                    />
                                );
                            })}
                            {Array.from({ length: SEGMENTS }, (_, i) => {
                                const start = i * (360 / SEGMENTS) + GAP_DEG / 2;
                                const end = start + SEG_DEG;
                                const d = arcPath(RING_R, start, end);
                                return (
                                    <AnimatedPath
                                        key={`seg-${i}`}
                                        d={d}
                                        stroke={GOLD}
                                        strokeWidth={SW}
                                        strokeLinecap="round"
                                        fill="none"
                                        opacity={segmentOps[i]}
                                    />
                                );
                            })}
                        </Svg>

                        {/* Sparkle burst dots */}
                        {SPARKS.map((angle, i) => {
                            const rad = (angle * Math.PI) / 180;
                            const bx = CX + Math.cos(rad) * (RING_R + SW / 2 + 1);
                            const by = CY + Math.sin(rad) * (RING_R + SW / 2 + 1);
                            const sz = i % 3 === 0 ? 5 : 3;
                            const dist = i % 3 === 0 ? 32 : 22;
                            return (
                                <Animated.View
                                    key={i}
                                    style={{
                                        position: 'absolute',
                                        left: bx - sz / 2,
                                        top:  by - sz / 2,
                                        width: sz,
                                        height: sz,
                                        borderRadius: sz / 2,
                                        backgroundColor: GOLD,
                                        opacity: sparks[i].op,
                                        transform: [
                                            { translateX: sparks[i].r.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(rad) * dist] }) },
                                            { translateY: sparks[i].r.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(rad) * dist] }) },
                                            { scale: sparks[i].r.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0.4] }) },
                                        ],
                                    }}
                                />
                            );
                        })}

                        {/* Inner number + label */}
                        <View style={styles.ringInner}>
                            <Text style={styles.dayEyebrow}>DAY</Text>
                            <Animated.Text
                                style={[
                                    styles.dayNumber,
                                    {
                                        opacity: numberOpacity,
                                        transform: [{ scale: numberScale.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
                                    },
                                ]}
                            >
                                {displayStreak}
                            </Animated.Text>
                            <Text style={styles.daySub}>of 7</Text>
                        </View>
                    </Animated.View>
                </Animated.View>

                {/* ── Headline ── */}
                <Animated.View
                    style={[
                        styles.textBlock,
                        { opacity: contentOpacity, transform: [{ translateY: contentY }] },
                    ]}
                >
                    <Text style={styles.headline}>
                        {hasSyncData ? `You're already on a roll` : `The streak starts here`}
                    </Text>
                    <Text style={styles.body}>
                        {hasSyncData
                            ? `${activeDays} days already locked in.`
                            : `Every session from here builds something real.`
                        }
                    </Text>
                </Animated.View>

                {/* ── Earned today — inline ── */}
                <Animated.View
                    style={[
                        styles.bonusRow,
                        { opacity: bonusOpacity, transform: [{ translateY: bonusY }] },
                    ]}
                >
                    <View style={styles.bonusDot} />
                    <Text style={styles.bonusLabel}>Earned today</Text>
                    <Text style={styles.bonusAmount}>+20 POWR</Text>
                </Animated.View>
            </View>

            {/* ── CTA ── */}
            <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 28, opacity: buttonOpacity }]}>
                <StepDots current={4} />
                <Pressable
                    style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.86 }]}
                    onPress={async () => {
                        await markOnboardingComplete();
                        router.replace('/(tabs)');
                    }}
                >
                    <Text style={styles.primaryLabel}>SEE TOMORROW'S GOAL</Text>
                </Pressable>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BG,
    },
    backButton: {
        position: 'absolute',
        left: 16,
        zIndex: 20,
        padding: 4,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },

    // Ring
    ringContainer: {
        width: CONTAINER,
        height: CONTAINER,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
    },
    glow: {
        position: 'absolute',
        backgroundColor: GOLD,
    },
    ringInner: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    dayEyebrow: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 4,
        textTransform: 'uppercase',
        marginBottom: 6,
    },
    dayNumber: {
        color: '#FFFFFF',
        fontSize: 128,
        fontWeight: '100',
        lineHeight: 132,
        textAlign: 'center',
    },
    daySub: {
        color: 'rgba(255,255,255,0.32)',
        fontSize: 13,
        fontWeight: '300',
        letterSpacing: 0.3,
        marginTop: 4,
    },

    // Text block
    textBlock: {
        alignItems: 'center',
        marginTop: 48,
        marginBottom: 28,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 26,
        fontWeight: '300',
        letterSpacing: -0.4,
        textAlign: 'center',
        lineHeight: 32,
        marginBottom: 10,
    },
    body: {
        color: 'rgba(255,255,255,0.42)',
        fontSize: 14,
        fontWeight: '300',
        lineHeight: 20,
        letterSpacing: 0.1,
        textAlign: 'center',
    },

    // Inline earned row
    bonusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        paddingHorizontal: 18,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(232,210,0,0.28)',
        backgroundColor: 'rgba(232,210,0,0.04)',
    },
    bonusDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: GOLD,
        marginRight: 10,
    },
    bonusLabel: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 12,
        fontWeight: '400',
        letterSpacing: 0.2,
        marginRight: 10,
    },
    bonusAmount: {
        color: GOLD,
        fontSize: 13,
        fontWeight: '600',
        letterSpacing: 0.4,
    },

    // CTA
    bottom: {
        paddingHorizontal: 24,
    },
    primaryButton: {
        height: 52,
        borderRadius: 26,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryLabel: {
        color: '#0a0a0a',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5,
    },
});

import { useAuth } from '@/context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, G } from 'react-native-svg';
import GeometricBackground from '@/components/GeometricBackground';

const GOLD = '#E8D200';
const BG = '#0d0d0d';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

// Ring geometry
const CONTAINER = 300;
const RING_R = 104;
const SW = 3.5;
const CIRC = 2 * Math.PI * RING_R;
const CX = CONTAINER / 2;
const CY = CONTAINER / 2;

// Sparkle burst — 12 evenly spaced dots
const SPARKS = Array.from({ length: 12 }, (_, i) => (i * 360) / 12);

export default function OnboardingAchievementScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { markOnboardingComplete } = useAuth();

    // --- Animated values ---
    const glowIn        = useRef(new Animated.Value(0)).current;
    const ringScaleIn   = useRef(new Animated.Value(0.78)).current;
    const ringProgress  = useRef(new Animated.Value(0)).current;
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

    const strokeDashoffset = ringProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [CIRC, 0],
    });

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
            // 2. Ring draws to 1/7 (day 1 of a 7-day week)
            Animated.timing(ringProgress, {
                toValue: 1 / 7,
                duration: 1150,
                easing: Easing.inOut(Easing.cubic),
                useNativeDriver: false,
            }),
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
                onPress={() => router.back()}
                hitSlop={24}
            >
                <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
            </Pressable>

            {/* Main content */}
            <View style={styles.center}>

                {/* ── Ring area ── */}
                <Animated.View style={{ transform: [{ scale: pulse }], marginBottom: 44 }}>
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

                        {/* SVG rings */}
                        <Svg width={CONTAINER} height={CONTAINER} style={StyleSheet.absoluteFillObject}>
                            {/* 7 day tick marks */}
                            {Array.from({ length: 7 }, (_, i) => {
                                const angle = (i * (360 / 7) - 90) * (Math.PI / 180);
                                const x1 = CX + Math.cos(angle) * (RING_R + 14);
                                const y1 = CY + Math.sin(angle) * (RING_R + 14);
                                const x2 = CX + Math.cos(angle) * (RING_R + 24);
                                const y2 = CY + Math.sin(angle) * (RING_R + 24);
                                const isCompleted = i === 0 || i === 1;
                                return (
                                    <Line
                                        key={i}
                                        x1={x1} y1={y1}
                                        x2={x2} y2={y2}
                                        stroke={isCompleted ? 'rgba(232,210,0,0.55)' : 'rgba(255,255,255,0.15)'}
                                        strokeWidth={i === 0 ? 2 : 1.5}
                                        strokeLinecap="round"
                                    />
                                );
                            })}
                            {/* Inner subtle ring */}
                            <Circle
                                cx={CX} cy={CY}
                                r={RING_R - 22}
                                stroke="rgba(232,210,0,0.05)"
                                strokeWidth={1}
                                fill="none"
                            />
                            {/* Track */}
                            <Circle
                                cx={CX} cy={CY}
                                r={RING_R}
                                stroke="rgba(255,255,255,0.07)"
                                strokeWidth={SW}
                                fill="none"
                            />
                            {/* Progress arc */}
                            <AnimatedCircle
                                cx={CX} cy={CY}
                                r={RING_R}
                                stroke={GOLD}
                                strokeWidth={SW}
                                fill="none"
                                strokeLinecap="round"
                                strokeDasharray={`${CIRC}`}
                                strokeDashoffset={strokeDashoffset}
                                rotation="-90"
                                origin={`${CX}, ${CY}`}
                            />
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
                            <Animated.Text
                                style={[
                                    styles.dayNumber,
                                    {
                                        opacity: numberOpacity,
                                        transform: [{ scale: numberScale.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
                                    },
                                ]}
                            >
                                1
                            </Animated.Text>
                            <Text style={styles.dayLabel}>DAY 1 OF 7</Text>
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
                        The streak{'\n'}
                        <Text style={styles.headlineAccent}>starts here.</Text>
                    </Text>
                    <Text style={styles.body}>
                        Day 1 is locked in. Every session{'\n'}from here builds something real.
                    </Text>
                </Animated.View>

                {/* ── Welcome bonus card ── */}
                <Animated.View
                    style={[
                        styles.bonusCard,
                        { opacity: bonusOpacity, transform: [{ translateY: bonusY }] },
                    ]}
                >
                    {/* Gold accent bar across top */}
                    <View style={styles.bonusTopBar} />

                    <View style={styles.bonusContent}>
                        <View>
                            <Text style={styles.bonusEyebrow}>EARNED TODAY</Text>
                            <View style={styles.bonusAmountRow}>
                                <Text style={styles.bonusPlus}>+</Text>
                                <Text style={styles.bonusValue}>20</Text>
                                <View style={styles.bonusUnitWrap}>
                                    <Text style={styles.bonusUnit}>POWR</Text>
                                </View>
                            </View>
                        </View>
                        <View style={styles.bonusBadge}>
                            <Image
                                source={require('@/assets/images/powr_transparent.png')}
                                style={styles.bonusBadgeImage}
                            />
                        </View>
                    </View>
                </Animated.View>
            </View>

            {/* ── CTA ── */}
            <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 28, opacity: buttonOpacity }]}>
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
    },
    dayNumber: {
        color: '#F2F2F2',
        fontSize: 88,
        fontWeight: '100',
        letterSpacing: -3,
        lineHeight: 92,
    },
    dayLabel: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 9,
        fontWeight: '500',
        letterSpacing: 3.5,
        textTransform: 'uppercase',
        marginTop: 2,
    },

    // Text block
    textBlock: {
        alignItems: 'center',
        marginBottom: 20,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 44,
        fontWeight: '200',
        letterSpacing: -1.4,
        textAlign: 'center',
        lineHeight: 50,
        marginBottom: 14,
    },
    headlineAccent: {
        color: GOLD,
        fontWeight: '700',
    },
    body: {
        color: 'rgba(255,255,255,0.35)',
        fontSize: 14,
        fontWeight: '300',
        lineHeight: 22,
        textAlign: 'center',
    },

    // Bonus card
    bonusCard: {
        width: '100%',
        borderRadius: 16,
        backgroundColor: 'rgba(40,40,40,0.85)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
    },
    bonusTopBar: {
        height: 2,
        backgroundColor: GOLD,
        width: '100%',
    },
    bonusContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 18,
    },
    bonusEyebrow: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 9,
        fontWeight: '500',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        marginBottom: 6,
    },
    bonusAmountRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    bonusPlus: {
        color: GOLD,
        fontSize: 26,
        fontWeight: '300',
        marginRight: 1,
    },
    bonusValue: {
        color: GOLD,
        fontSize: 56,
        fontWeight: '100',
        letterSpacing: -2,
        lineHeight: 58,
    },
    bonusUnitWrap: {
        marginLeft: 6,
        marginBottom: 4,
        justifyContent: 'flex-end',
    },
    bonusUnit: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 11,
        fontWeight: '500',
        letterSpacing: 2,
        textTransform: 'uppercase',
    },
    bonusBadge: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: 'rgba(232,210,0,0.09)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.22)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    bonusBadgeImage: {
        width: 28,
        height: 28,
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

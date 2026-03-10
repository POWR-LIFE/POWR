import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { THEMES, useAppTheme } from '@/context/ThemeContext';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export default function OnboardingAchievementScreen() {
    const { theme } = useAppTheme();
    const activeColor = THEMES.find(t => t.name === theme)?.primary || '#CEFF00';
    const router = useRouter();
    const insets = useSafeAreaInsets();

    // Animations
    const ringProgress = useRef(new Animated.Value(0)).current;
    const contentFade = useRef(new Animated.Value(0)).current;
    const pointsFade = useRef(new Animated.Value(0)).current;
    const buttonFade = useRef(new Animated.Value(0)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;

    // Ring dimensions
    const ringSize = 160;
    const strokeWidth = 6;
    const radius = (ringSize - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    useEffect(() => {
        // Entrance sequence
        Animated.sequence([
            // Ring fills up
            Animated.timing(ringProgress, {
                toValue: 1,
                duration: 1200,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: false, // strokeDashoffset not supported by native driver
            }),
            // Content fades in
            Animated.timing(contentFade, {
                toValue: 1,
                duration: 500,
                useNativeDriver: true,
            }),
            // Points fade in
            Animated.timing(pointsFade, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
            }),
            // Button fades in
            Animated.timing(buttonFade, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
            }),
        ]).start();

        // Gentle pulse on the ring
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1.05,
                    duration: 2000,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 2000,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, [ringProgress, contentFade, pointsFade, buttonFade, pulseAnim]);

    const strokeDashoffset = ringProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [circumference, 0],
    });

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={['#0A0A0A', '#111111', '#0A0A0A']}
                locations={[0, 0.5, 1]}
                style={StyleSheet.absoluteFillObject}
            />

            {/* Top-left POWR icon */}
            <View style={[styles.logoContainer, { top: insets.top + 12 }]}>
                <Image
                    source={require('@/assets/images/powrlogotext.png')}
                    style={styles.logoIcon}
                    contentFit="contain"
                />
            </View>

            {/* Center content */}
            <View style={styles.centerContent}>
                {/* Streak ring */}
                <Animated.View style={{ transform: [{ scale: pulseAnim }], marginBottom: 40 }}>
                    <View style={[styles.ringContainer, { width: ringSize, height: ringSize }]}>
                        <Svg width={ringSize} height={ringSize} style={styles.ringSvg}>
                            {/* Background track */}
                            <Circle
                                cx={ringSize / 2}
                                cy={ringSize / 2}
                                r={radius}
                                stroke="rgba(255,255,255,0.08)"
                                strokeWidth={strokeWidth}
                                fill="none"
                            />
                            {/* Progress ring */}
                            <AnimatedCircle
                                cx={ringSize / 2}
                                cy={ringSize / 2}
                                r={radius}
                                stroke={activeColor}
                                strokeWidth={strokeWidth}
                                fill="none"
                                strokeLinecap="round"
                                strokeDasharray={`${circumference}`}
                                strokeDashoffset={strokeDashoffset}
                                rotation="-90"
                                origin={`${ringSize / 2}, ${ringSize / 2}`}
                            />
                        </Svg>
                        {/* Day number inside ring */}
                        <View style={styles.ringInner}>
                            <Text style={[styles.dayNumber, { color: activeColor }]}>1</Text>
                            <Text style={styles.dayLabel}>DAY</Text>
                        </View>
                    </View>
                </Animated.View>

                {/* Hero text */}
                <Animated.View style={{ opacity: contentFade, alignItems: 'center' }}>
                    <Text style={styles.headline}>Today counts.</Text>
                    <Text style={styles.subHeadline}>
                        Day 1 of your journey is active.
                    </Text>
                </Animated.View>

                {/* Points — secondary, smaller */}
                <Animated.View style={[styles.pointsContainer, { opacity: pointsFade }]}>
                    <Text style={styles.pointsText}>+20 POWR points earned today</Text>
                </Animated.View>
            </View>

            {/* Bottom CTA */}
            <View style={[styles.bottomContent, { paddingBottom: insets.bottom + 24 }]}>
                <Animated.View style={{ opacity: buttonFade, width: '100%' }}>
                    <Pressable
                        style={[styles.primaryButton, { backgroundColor: activeColor }]}
                        onPress={() => router.replace('/(tabs)')}
                    >
                        <Text style={styles.primaryButtonText}>See tomorrow's goal</Text>
                    </Pressable>
                </Animated.View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
    logoContainer: {
        position: 'absolute',
        left: 20,
        zIndex: 10,
    },
    logoIcon: {
        width: 100,
        height: 36,
    },
    centerContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    ringContainer: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    ringSvg: {
        position: 'absolute',
    },
    ringInner: {
        alignItems: 'center',
    },
    dayNumber: {
        fontSize: 52,
        fontWeight: '900',
        letterSpacing: -2,
    },
    dayLabel: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 14,
        fontWeight: '700',
        letterSpacing: 2,
        marginTop: -4,
    },
    headline: {
        color: '#FFFFFF',
        fontSize: 30,
        fontWeight: '800',
        textAlign: 'center',
        letterSpacing: -0.5,
    },
    subHeadline: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 18,
        fontWeight: '400',
        textAlign: 'center',
        marginTop: 8,
    },
    pointsContainer: {
        marginTop: 24,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    pointsText: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 14,
        fontWeight: '500',
    },
    bottomContent: {
        paddingHorizontal: 24,
    },
    primaryButton: {
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryButtonText: {
        color: '#000',
        fontSize: 16,
        fontWeight: '700',
    },
});

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { THEMES, useAppTheme } from '@/context/ThemeContext';

export default function OnboardingPermissionScreen() {
    const { theme } = useAppTheme();
    const activeColor = THEMES.find(t => t.name === theme)?.primary || '#CEFF00';
    const router = useRouter();
    const insets = useSafeAreaInsets();

    // Fade-in animations
    const iconFade = useRef(new Animated.Value(0)).current;
    const textFade = useRef(new Animated.Value(0)).current;
    const buttonFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.sequence([
            Animated.timing(iconFade, {
                toValue: 1,
                duration: 600,
                useNativeDriver: true,
            }),
            Animated.timing(textFade, {
                toValue: 1,
                duration: 600,
                useNativeDriver: true,
            }),
            Animated.timing(buttonFade, {
                toValue: 1,
                duration: 500,
                useNativeDriver: true,
            }),
        ]).start();
    }, [iconFade, textFade, buttonFade]);

    return (
        <View style={styles.container}>
            {/* Subtle gradient background */}
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
                {/* Activity icon / graphic */}
                <Animated.View style={[styles.iconCircle, { opacity: iconFade, borderColor: activeColor }]}>
                    <Text style={styles.iconEmoji}>🏃</Text>
                </Animated.View>

                {/* Main pitch text */}
                <Animated.View style={{ opacity: textFade }}>
                    <Text style={styles.headline}>
                        POWR tracks your movement automatically
                    </Text>
                    <Text style={styles.subtext}>
                        so you don't have to log workouts.
                    </Text>
                </Animated.View>
            </View>

            {/* Bottom CTA */}
            <View style={[styles.bottomContent, { paddingBottom: insets.bottom + 24 }]}>
                <Animated.View style={{ opacity: buttonFade, width: '100%' }}>
                    <Pressable
                        style={[styles.primaryButton, { backgroundColor: activeColor }]}
                        onPress={() => router.push('/onboarding-health')}
                    >
                        <Text style={styles.primaryButtonText}>Connect Health Data</Text>
                        <View style={[styles.bonusBadge, { backgroundColor: 'rgba(0,0,0,0.2)' }]}>
                            <Text style={styles.bonusText}>+20 POWR</Text>
                        </View>
                    </Pressable>

                    <Pressable
                        style={styles.skipButton}
                        onPress={() => router.push('/onboarding-account')}
                    >
                        <Text style={styles.skipText}>Skip for now</Text>
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
    iconCircle: {
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: 2,
        backgroundColor: 'rgba(255,255,255,0.05)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 40,
    },
    iconEmoji: {
        fontSize: 44,
    },
    headline: {
        color: '#FFFFFF',
        fontSize: 30,
        fontWeight: '800',
        textAlign: 'center',
        letterSpacing: -0.5,
        lineHeight: 38,
    },
    subtext: {
        color: 'rgba(255,255,255,0.55)',
        fontSize: 18,
        fontWeight: '400',
        textAlign: 'center',
        marginTop: 12,
        lineHeight: 26,
    },
    bottomContent: {
        paddingHorizontal: 24,
        alignItems: 'center',
    },
    primaryButton: {
        height: 56,
        borderRadius: 28,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },
    primaryButtonText: {
        color: '#000',
        fontSize: 16,
        fontWeight: '700',
    },
    bonusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    bonusText: {
        color: '#000',
        fontSize: 12,
        fontWeight: '800',
    },
    skipButton: {
        marginTop: 16,
        alignItems: 'center',
        paddingVertical: 8,
    },
    skipText: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 14,
        fontWeight: '500',
    },
});

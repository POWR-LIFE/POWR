import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MagicRings from '@/components/MagicRings';

const GOLD = '#facc15';
const BG = '#0d0d0d';

function StepDots({ current }: { current: number }) {
    return (
        <View style={dotStyles.row}>
            {[0, 1, 2].map(i => (
                <View
                    key={i}
                    style={[
                        dotStyles.dot,
                        i === current ? dotStyles.dotActive : dotStyles.dotInactive,
                    ]}
                />
            ))}
        </View>
    );
}

const dotStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: 6,
        justifyContent: 'center',
        marginBottom: 28,
    },
    dot: {
        height: 5,
        borderRadius: 3,
    },
    dotActive: {
        width: 20,
        backgroundColor: GOLD,
    },
    dotInactive: {
        width: 5,
        backgroundColor: 'rgba(255,255,255,0.15)',
    },
});

export default function OnboardingPermissionScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const contentFade = useRef(new Animated.Value(0)).current;
    const buttonsFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        // Let MagicRings animate in first, then reveal content
        Animated.sequence([
            Animated.delay(800),
            Animated.timing(contentFade, { toValue: 1, duration: 500, useNativeDriver: true }),
            Animated.timing(buttonsFade, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]).start();
    }, [contentFade, buttonsFade]);

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={[BG, '#0f0f0f', BG]}
                locations={[0, 0.5, 1]}
                style={StyleSheet.absoluteFillObject}
            />
            <MagicRings />

            {/* Logo */}
            <View style={[styles.logo, { top: insets.top + 18 }]}>
                <Image
                    source={require('@/assets/images/powrlogotext.png')}
                    style={styles.logoImage}
                    contentFit="contain"
                />
            </View>

            {/* Center content */}
            <View style={[styles.center, { paddingTop: insets.top + 60 }]}>
                <Animated.View style={[styles.textBlock, { opacity: contentFade }]}>
                    <Text style={styles.eyebrow}>PASSIVE TRACKING</Text>
                    <Text style={styles.headline}>
                        Earn while{'\n'}you{' '}
                        <Text style={styles.headlineGold}>move.</Text>
                    </Text>
                    <Text style={styles.body}>
                        You're already moving. POWR runs quietly in the background — no tapping start, no manual logs. Just move and earn.
                    </Text>
                </Animated.View>
            </View>

            {/* Bottom */}
            <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 32, opacity: buttonsFade }]}>
                <StepDots current={1} />

                <Pressable
                    style={styles.primaryButton}
                    onPress={() => router.push('/onboarding-health')}
                >
                    <Text style={styles.primaryLabel}>ALLOW LOCATION ACCESS</Text>
                    <View style={styles.bonusBadge}>
                        <Text style={styles.bonusLabel}>+20 POWR</Text>
                    </View>
                </Pressable>

                <Pressable
                    style={styles.skipButton}
                    onPress={() => router.push('/onboarding-health')}
                >
                    <Text style={styles.skipLabel}>Skip for now</Text>
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
    logo: {
        position: 'absolute',
        left: 20,
        zIndex: 10,
    },
    logoImage: {
        width: 100,
        height: 36,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    textBlock: {
        alignItems: 'center',
    },
    eyebrow: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        marginBottom: 14,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 42,
        fontWeight: '200',
        letterSpacing: -1,
        lineHeight: 48,
        textAlign: 'center',
        marginBottom: 16,
    },
    headlineGold: {
        color: GOLD,
        fontWeight: '700',
    },
    body: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 14,
        fontWeight: '300',
        lineHeight: 22,
        textAlign: 'center',
    },
    bottom: {
        paddingHorizontal: 24,
    },
    primaryButton: {
        height: 52,
        borderRadius: 26,
        backgroundColor: GOLD,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        marginBottom: 12,
    },
    primaryLabel: {
        color: '#0a0a0a',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5,
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
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    skipButton: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    skipLabel: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 13,
        fontWeight: '300',
        letterSpacing: 0.3,
    },
});

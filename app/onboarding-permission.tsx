import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MagicRings from '@/components/MagicRings';
import GeometricBackground from '@/components/GeometricBackground';
import { awardBonus } from '@/lib/api/points';

const GOLD = '#E8D200';
const BG = '#0d0d0d';

function StepDots({ current }: { current: number }) {
    return (
        <View style={dotStyles.row}>
            {[0, 1, 2, 3, 4].map(i => (
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
        marginBottom: 20,
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

const NEXT_SCREEN = '/onboarding-activities';

export default function OnboardingPermissionScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [requesting, setRequesting] = useState(false);

    const contentFade = useRef(new Animated.Value(0)).current;
    const buttonsFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        // Check if permission is already granted (e.g. reinstall or granted elsewhere)
        (async () => {
            const { status } = await Location.getForegroundPermissionsAsync();
            if (status === 'granted') {
                // Award bonus idempotently (server deduplicates) and advance
                awardBonus('location_permission').catch(() => {});
                router.replace(NEXT_SCREEN);
                return;
            }
            // Permission not yet granted — show the screen
            Animated.sequence([
                Animated.delay(800),
                Animated.timing(contentFade, { toValue: 1, duration: 500, useNativeDriver: true }),
                Animated.timing(buttonsFade, { toValue: 1, duration: 400, useNativeDriver: true }),
            ]).start();
        })();
    }, []);

    const handleAllowLocation = async () => {
        if (requesting) return;
        setRequesting(true);

        try {
            // This triggers the native OS permission dialog
            const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();

            if (fgStatus !== 'granted') {
                Alert.alert(
                    'Location Required',
                    'To earn while you move, POWR needs location access. You can also skip for now.',
                    [
                        { text: 'Cancel', style: 'cancel', onPress: () => setRequesting(false) },
                        { text: 'Skip', onPress: () => router.push(NEXT_SCREEN) }
                    ]
                );
                return;
            }

            // Request background location (optional, needed for passive tracking)
            try {
                await Location.requestBackgroundPermissionsAsync();
            } catch (e) {
                console.warn('Background permission request failed', e);
            }

            // Award the location permission bonus (fire-and-forget; idempotent on server)
            awardBonus('location_permission').catch((e) =>
                console.warn('Failed to award location bonus', e)
            );

            // Navigate to next screen
            router.push(NEXT_SCREEN);
        } catch (error) {
            console.error('Error requesting location permission:', error);
            router.push(NEXT_SCREEN);
        } finally {
            setRequesting(false);
        }
    };

    return (
        <View style={styles.container}>
            <GeometricBackground />
            <MagicRings />

            {/* Back button */}
            <Pressable
                style={[styles.backButton, { top: insets.top + 14 }]}
                onPress={() => {
                    if (router.canGoBack()) {
                        router.back();
                    } else {
                        router.replace('/onboarding-account');
                    }
                }}
                hitSlop={24}
            >
                <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
            </Pressable>

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
                    style={[styles.primaryButton, requesting && { opacity: 0.7 }]}
                    onPress={handleAllowLocation}
                    disabled={requesting}
                >
                    <Text style={styles.primaryLabel}>
                        {requesting ? 'REQUESTING...' : 'ALLOW LOCATION ACCESS'}
                    </Text>
                    {!requesting && (
                        <View style={styles.bonusBadge}>
                            <Text style={styles.bonusLabel}>+20 POWR</Text>
                        </View>
                    )}
                </Pressable>

                <Pressable
                    style={styles.skipButton}
                    onPress={() => router.push(NEXT_SCREEN)}
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

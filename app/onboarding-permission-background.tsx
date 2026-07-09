import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Animated, Linking, Platform, Pressable, StyleSheet, Text, View, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';
import PermissionPrimeScene from '@/components/onboarding/PermissionPrimeScene';
import { ONBOARDING_DOT_COUNT, dotIndexFor } from '@/lib/onboarding/flow';
import {
    hasPromptedBatteryOptimization,
    markBatteryOptimizationPrompted,
    requestBatteryOptimizationExemption,
} from '@/lib/batteryOptimization';
import { recordLocationOnboardingDeclined } from '@/lib/locationPrompt';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const FONT_LIGHT = 'Outfit_300Light';
const FONT_MEDIUM = 'Outfit_500Medium';
const FONT_SEMIBOLD = 'Outfit_600SemiBold';
const FONT_BOLD = 'Outfit_700Bold';

function StepDots({ current }: { current: number }) {
    return (
        <View style={dotStyles.row}>
            {Array.from({ length: ONBOARDING_DOT_COUNT }, (_, i) => i).map(i => (
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

const NEXT_SCREEN = '/onboarding-gym';

export default function OnboardingPermissionBackgroundScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [requesting, setRequesting] = useState(false);

    const contentFade = useRef(new Animated.Value(0)).current;
    const buttonsFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        (async () => {
            // Already granted (reinstall, resumed onboarding) — nothing to ask.
            const { status } = await Location.getBackgroundPermissionsAsync();
            if (status === 'granted') {
                router.replace(NEXT_SCREEN);
                return;
            }
            Animated.sequence([
                Animated.delay(400),
                Animated.timing(contentFade, { toValue: 1, duration: 500, useNativeDriver: true }),
                Animated.timing(buttonsFade, { toValue: 1, duration: 400, useNativeDriver: true }),
            ]).start();
        })();
    }, []);

    // Android: ask the user to exempt POWR from battery optimization so arrival
    // detection keeps working when the app is fully closed. One-time, gated
    // behind our own explainer. Navigation continues either way.
    const continueViaBatteryPrompt = async () => {
        if (Platform.OS === 'android' && !(await hasPromptedBatteryOptimization())) {
            await markBatteryOptimizationPrompted();
            Alert.alert(
                'Keep earning when POWR is closed',
                'To detect when you arrive at a gym while the app is closed, allow POWR to run without battery restrictions on the next screen.',
                [
                    { text: 'Not now', style: 'cancel', onPress: () => router.push(NEXT_SCREEN) },
                    {
                        text: 'Allow',
                        onPress: async () => {
                            await requestBatteryOptimizationExemption();
                            router.push(NEXT_SCREEN);
                        },
                    },
                ],
            );
            return;
        }
        router.push(NEXT_SCREEN);
    };

    const handleAllowBackground = async () => {
        if (requesting) return;
        setRequesting(true);

        try {
            // Android 11+ sends the user to the app's location settings page —
            // the exact screen the mock above is coaching them through.
            let bgGranted = false;
            try {
                const { status } = await Location.requestBackgroundPermissionsAsync();
                bgGranted = status === 'granted';
            } catch (e) {
                console.warn('Background permission request failed', e);
            }

            // iOS: if "Always" wasn't granted, guide the user to fix it in Settings.
            // Without "Always", iOS won't wake the app for geofence events when it's
            // killed — the "You're in" notification will never fire.
            if (Platform.OS === 'ios' && !bgGranted) {
                Alert.alert(
                    'Enable "Always" for gym check-ins',
                    'To detect gym arrivals when POWR is closed, set location to "Always" in Settings › Privacy & Security › Location Services › POWR.',
                    [
                        {
                            text: 'Later',
                            onPress: () => {
                                recordLocationOnboardingDeclined().catch(() => {});
                                router.push(NEXT_SCREEN);
                            },
                        },
                        {
                            text: 'Open Settings',
                            onPress: () => {
                                Linking.openSettings();
                                router.push(NEXT_SCREEN);
                            },
                        },
                    ],
                );
                return;
            }

            await continueViaBatteryPrompt();
        } catch (error) {
            console.error('Error requesting background location:', error);
            router.push(NEXT_SCREEN);
        } finally {
            setRequesting(false);
        }
    };

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
                        router.replace('/onboarding-permission');
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
                        No pressing start. POWR checks you in from your pocket — even when the app is closed. That only works on{' '}
                        <Text style={styles.bodyStrong}>
                            {Platform.OS === 'ios' ? '“Always”' : '“Allow all the time”'}
                        </Text>
                        .
                    </Text>

                    <View style={styles.mock}>
                        <PermissionPrimeScene kind="location-background" />
                    </View>
                </Animated.View>
            </View>

            {/* Bottom */}
            <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 32, opacity: buttonsFade }]}>
                <StepDots current={dotIndexFor('/onboarding-permission-background')} />

                <Pressable
                    style={[styles.primaryButton, requesting && { opacity: 0.7 }]}
                    onPress={handleAllowBackground}
                    disabled={requesting}
                >
                    <Text style={styles.primaryLabel}>
                        {requesting
                            ? 'REQUESTING...'
                            : Platform.OS === 'ios'
                              ? 'SET TO ALWAYS'
                              : 'ALLOW ALL THE TIME'}
                    </Text>
                </Pressable>

                <Pressable
                    style={styles.skipButton}
                    onPress={() => {
                        recordLocationOnboardingDeclined().catch(() => {});
                        router.push(NEXT_SCREEN);
                    }}
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
        alignSelf: 'stretch',
    },
    eyebrow: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 10,
        fontFamily: FONT_MEDIUM,
        fontWeight: '500',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        marginBottom: 14,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 38,
        fontFamily: FONT_LIGHT,
        fontWeight: '200',
        letterSpacing: -1,
        lineHeight: 44,
        textAlign: 'center',
        marginBottom: 14,
    },
    headlineGold: {
        color: GOLD,
        fontFamily: FONT_SEMIBOLD,
        fontWeight: '700',
    },
    body: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 14,
        fontFamily: FONT_LIGHT,
        fontWeight: '300',
        lineHeight: 22,
        textAlign: 'center',
        marginBottom: 26,
        paddingHorizontal: 8,
    },
    bodyStrong: {
        color: 'rgba(255,255,255,0.75)',
        fontFamily: FONT_MEDIUM,
        fontWeight: '500',
    },
    mock: {
        alignSelf: 'stretch',
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
        fontFamily: FONT_BOLD,
        fontWeight: '700',
        letterSpacing: 1.5,
    },
    skipButton: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    skipLabel: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 13,
        fontFamily: FONT_LIGHT,
        fontWeight: '300',
        letterSpacing: 0.3,
    },
});

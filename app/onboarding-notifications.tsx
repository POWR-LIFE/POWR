import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';
import PermissionPrimeScene from '@/components/onboarding/PermissionPrimeScene';
import { ONBOARDING_DOT_COUNT, dotIndexFor } from '@/lib/onboarding/flow';
import { useNotifications } from '@/context/NotificationsContext';
import { recordOnboardingDeclined } from '@/lib/notificationPrompt';

const GOLD = '#E8D200';
const BG = '#0d0d0d';

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

const NEXT_SCREEN = '/onboarding-achievement';

export default function OnboardingNotificationsScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { requestPermissions } = useNotifications();
    const [requesting, setRequesting] = useState(false);
    // 'denied' = the OS dialog is burned (Android 13 two-strike, or toggled
    // off in settings) — the CTA has to deep-link to system settings instead.
    const [mode, setMode] = useState<'ask' | 'denied'>('ask');

    // Health-sync results ride through this screen to the achievement finale.
    const params = useLocalSearchParams<{ streakDays?: string; totalSessions?: string; activeDays?: string }>();
    const nextParams = {
        ...(params.streakDays ? { streakDays: params.streakDays } : {}),
        ...(params.totalSessions ? { totalSessions: params.totalSessions } : {}),
        ...(params.activeDays ? { activeDays: params.activeDays } : {}),
    };

    const contentFade = useRef(new Animated.Value(0)).current;
    const buttonsFade = useRef(new Animated.Value(0)).current;

    const advance = (replace = false) => {
        const target = { pathname: NEXT_SCREEN, params: nextParams } as const;
        if (replace) router.replace(target);
        else router.push(target);
    };

    useEffect(() => {
        (async () => {
            // Already granted (reinstall, Android < 13) — register the token and
            // move on without showing an ask for something we already have.
            const perm = await Notifications.getPermissionsAsync();
            if (perm.status === 'granted') {
                requestPermissions().catch(() => {});
                advance(true);
                return;
            }
            if (perm.status === 'denied' && perm.canAskAgain === false) {
                setMode('denied');
            }
            Animated.sequence([
                Animated.delay(400),
                Animated.timing(contentFade, { toValue: 1, duration: 500, useNativeDriver: true }),
                Animated.timing(buttonsFade, { toValue: 1, duration: 400, useNativeDriver: true }),
            ]).start();
        })();
    }, []);

    // Denied mode sends the user to system settings; when they come back with
    // alerts on, register the token and move along.
    useEffect(() => {
        if (mode !== 'denied') return;
        const sub = AppState.addEventListener('change', async (next) => {
            if (next !== 'active') return;
            const perm = await Notifications.getPermissionsAsync();
            if (perm.status === 'granted') {
                requestPermissions().catch(() => {});
                advance(true);
            }
        });
        return () => sub.remove();
    }, [mode]);

    const handleEnable = async () => {
        if (requesting) return;
        if (mode === 'denied') {
            // The real dialog can't fire — the AppState listener above advances
            // once the user returns from settings with alerts enabled.
            Linking.openSettings();
            return;
        }
        setRequesting(true);
        try {
            // Fires the real OS dialog (previewed by the mock above) and, on
            // grant, registers this device's push token.
            const granted = await requestPermissions();
            // A deny starts the re-ask cool-off (NotificationPrimeSheet picks
            // this up at the first value moment).
            if (!granted) recordOnboardingDeclined().catch(() => {});
        } catch (error) {
            console.warn('Error requesting notification permission:', error);
        } finally {
            setRequesting(false);
            advance();
        }
    };

    const handleSkip = () => {
        recordOnboardingDeclined().catch(() => {});
        advance();
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
                        router.replace('/onboarding-activities');
                    }
                }}
                hitSlop={24}
            >
                <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
            </Pressable>

            {/* Center content */}
            <View style={[styles.center, { paddingTop: insets.top + 60 }]}>
                <Animated.View style={[styles.textBlock, { opacity: contentFade }]}>
                    <Text style={styles.eyebrow}>NOTIFICATIONS</Text>
                    <Text style={styles.headline}>
                        Know when{'\n'}you{' '}
                        <Text style={styles.headlineGold}>earn.</Text>
                    </Text>
                    <Text style={styles.body}>
                        A session lands, a streak’s at risk, a reward drops nearby — you’ll know the second it happens. Every alert is yours to switch off.
                    </Text>

                    <View style={styles.mock}>
                        <PermissionPrimeScene kind="notifications" />
                    </View>
                </Animated.View>
            </View>

            {/* Bottom */}
            <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 32, opacity: buttonsFade }]}>
                <StepDots current={dotIndexFor('/onboarding-notifications')} />

                <Pressable
                    style={[styles.primaryButton, requesting && { opacity: 0.7 }]}
                    onPress={handleEnable}
                    disabled={requesting}
                >
                    <Text style={styles.primaryLabel}>
                        {requesting
                            ? 'REQUESTING...'
                            : mode === 'denied'
                              ? 'OPEN SETTINGS'
                              : 'ENABLE ALERTS'}
                    </Text>
                </Pressable>

                <Pressable
                    style={styles.skipButton}
                    onPress={handleSkip}
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
        fontWeight: '500',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        marginBottom: 14,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 38,
        fontWeight: '200',
        letterSpacing: -1,
        lineHeight: 44,
        textAlign: 'center',
        marginBottom: 14,
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
        marginBottom: 26,
        paddingHorizontal: 8,
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
        fontWeight: '300',
        letterSpacing: 0.3,
    },
});

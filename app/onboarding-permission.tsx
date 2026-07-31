import GeometricBackground from '@/components/GeometricBackground';
import PermissionPrimeScene from '@/components/onboarding/PermissionPrimeScene';
import { awardBonus } from '@/lib/api/points';
import { ONBOARDING_DOT_COUNT, dotIndexFor } from '@/lib/onboarding/flow';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

// On grant we continue to the background-location priming page; skipping
// location entirely makes that page pointless, so skip jumps straight to gym.
const NEXT_SCREEN = '/onboarding-permission-background';
const SKIP_SCREEN = '/onboarding-gym';

export default function OnboardingPermissionScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [requesting, setRequesting] = useState(false);
    // 'denied' = the OS dialog is burned (denied with canAskAgain false) — the
    // CTA has to deep-link to system settings instead of re-firing the dialog.
    const [mode, setMode] = useState<'ask' | 'denied'>('ask');
    // The escape link stays hidden until an ask has actually failed — untouched
    // users see no way past this screen except the permission dialog.
    const [attempted, setAttempted] = useState(false);

    const contentFade = useRef(new Animated.Value(0)).current;
    const buttonsFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        // Check if permission is already granted (e.g. reinstall or granted elsewhere)
        (async () => {
            // Award the one-time signup bonus (idempotent — server deduplicates per user)
            awardBonus('signup').catch(() => {});

            const fg = await Location.getForegroundPermissionsAsync();
            if (fg.status === 'granted') {
                // Award bonus idempotently (server deduplicates) and advance —
                // straight past the background page if that's already granted too.
                awardBonus('location_permission').catch(() => {});
                const { status: bg } = await Location.getBackgroundPermissionsAsync();
                router.replace(bg === 'granted' ? SKIP_SCREEN : NEXT_SCREEN);
                return;
            }
            if (fg.status === 'denied' && fg.canAskAgain === false) {
                setMode('denied');
            }
            // Permission not yet granted — show the screen
            Animated.sequence([
                Animated.delay(800),
                Animated.timing(contentFade, { toValue: 1, duration: 500, useNativeDriver: true }),
                Animated.timing(buttonsFade, { toValue: 1, duration: 400, useNativeDriver: true }),
            ]).start();
        })();
    }, []);

    // Award the bonus (fire-and-forget; idempotent on server) and move to the
    // background-location priming page.
    const finishGrant = () => {
        awardBonus('location_permission').catch((e) =>
            console.warn('Failed to award location bonus', e)
        );
        router.push(NEXT_SCREEN);
    };

    // Denied mode sends the user to system settings; when they come back with
    // location granted, award the bonus and move along.
    useEffect(() => {
        if (mode !== 'denied') return;
        const sub = AppState.addEventListener('change', async (next) => {
            if (next !== 'active') return;
            const { status } = await Location.getForegroundPermissionsAsync();
            if (status === 'granted') finishGrant();
        });
        return () => sub.remove();
    }, [mode]);

    const handleAllowLocation = async () => {
        if (requesting) return;
        if (mode === 'denied') {
            // The real dialog can't fire — the AppState listener above advances
            // once the user returns from settings with location granted.
            Linking.openSettings();
            return;
        }
        setRequesting(true);

        try {
            // This triggers the native OS permission dialog — the same one the
            // mock above the button has been showing the user all along.
            const res = await Location.requestForegroundPermissionsAsync();

            if (res.status !== 'granted') {
                // Stay on the page — the escape link is visible now, and if the
                // dialog is burned the CTA flips to OPEN SETTINGS.
                setAttempted(true);
                if (res.canAskAgain === false) setMode('denied');
                return;
            }

            // Android 12+ lets users pick "Approximate" — useless against 25 m
            // gym geofences, so sessions would never verify. One nudge to fix it
            // before moving on.
            if (res.android?.accuracy === 'coarse') {
                Alert.alert(
                    'Turn on Precise location',
                    'POWR verifies you’re really at the gym — approximate location can’t do that. Choose “Precise” so your sessions count.',
                    [
                        {
                            text: 'Fix it',
                            onPress: async () => {
                                if (res.canAskAgain) {
                                    // Android re-shows the dialog with the
                                    // Precise/Approximate selector.
                                    await Location.requestForegroundPermissionsAsync().catch(() => {});
                                    finishGrant();
                                } else {
                                    // Stay on this page — CONTINUE re-checks
                                    // once they're back from settings.
                                    Linking.openSettings();
                                }
                            },
                        },
                        { text: 'Later', onPress: finishGrant },
                    ],
                );
                return;
            }

            finishGrant();
        } catch (error) {
            console.error('Error requesting location permission:', error);
            setAttempted(true);
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
                    <Text style={styles.eyebrow}>LOCATION</Text>
                    <Text style={styles.headline}>
                        Unlock the{'\n'}
                        <Text style={styles.headlineGold}>map.</Text>
                    </Text>
                    <Text style={styles.body}>
                        Partner gyms and automatic check-ins — it all starts with where you are.
                    </Text>

                    <View style={styles.mock}>
                        <PermissionPrimeScene kind="location-foreground" />
                    </View>
                </Animated.View>
            </View>

            {/* Bottom */}
            <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 32, opacity: buttonsFade }]}>
                <StepDots current={dotIndexFor('/onboarding-permission')} />

                <Pressable
                    style={[styles.primaryButton, requesting && { opacity: 0.7 }]}
                    onPress={handleAllowLocation}
                    disabled={requesting}
                >
                    <Text style={styles.primaryLabel}>
                        {requesting
                            ? 'REQUESTING...'
                            : mode === 'denied'
                              ? 'OPEN SETTINGS'
                              : Platform.OS === 'ios' ? 'ALLOW WHILE USING' : 'ALLOW LOCATION'}
                    </Text>
                    {!requesting && (
                        <View style={styles.bonusBadge}>
                            <Text style={styles.bonusLabel}>+20 POWR</Text>
                        </View>
                    )}
                </Pressable>

                {(attempted || mode === 'denied') && (
                    <Pressable
                        style={styles.skipButton}
                        onPress={() => router.push(SKIP_SCREEN)}
                    >
                        <Text style={styles.skipLabel}>Continue without location</Text>
                    </Pressable>
                )}
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
    bonusBadge: {
        backgroundColor: 'rgba(0,0,0,0.18)',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    bonusLabel: {
        color: '#0a0a0a',
        fontSize: 9,
        fontFamily: FONT_BOLD,
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
        fontFamily: FONT_LIGHT,
        fontWeight: '300',
        letterSpacing: 0.3,
    },
});

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useActiveGeofence } from '@/hooks/useActiveGeofence';
import {
    androidCheckAlreadyGranted,
    androidOpenHealthConnectSettings,
    useHealthData,
} from '@/hooks/useHealthData';
import { getStepsToday, syncWalkingNow } from '@/lib/health/walkingSync';
import { awardBonus } from '@/lib/api/points';
import {
    detectHealthPromptMode,
    getHealthPromptState,
    hasEverConnectedNative,
    hasRecentWalkingSession,
    recordHealthPromptDismissed,
    recordHealthPromptShown,
    shouldShowHealthPrompt,
    type HealthPromptMode,
} from '@/lib/healthPrompt';
import { getLocationPromptState, isWhileUsingOnly, shouldShowLocationPrompt } from '@/lib/locationPrompt';
import {
    getNotificationPromptState,
    hasAnyCompletedSession,
    shouldShowNotificationPrompt,
} from '@/lib/notificationPrompt';

const GOLD = '#E8D200';
const GREEN = '#4ade80';
const CARD_BG = '#141414';
const BORDER = '#222222';

/**
 * The primed health re-ask, shown on Home when NO health data is flowing:
 * either the user never connected a native source ('connect'), or our records
 * say they did but the OS grant is dead ('reconnect' — Health Connect toggles
 * off after a reinstall, Health sharing revoked). Steps are the app's passive
 * earning loop, so a dead pipe is a silent failure worth interrupting for.
 * Mirrors NotificationPrimeSheet (chrome, pacing, settings-return dance) and
 * decides its own visibility, so mounting it is a one-liner.
 *
 * Modes:
 *  - 'connect' / 'reconnect' — CTA fires the native permission flow (Health
 *    Connect grant screen / HealthKit sheet).
 *  - 'settings' — the request came back not-granted (burned dialog), so the CTA
 *    deep-links to the platform's health settings; the sheet closes itself when
 *    the user returns with data readable.
 */
export default function HealthPrimeSheet() {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const { activeGeofence } = useActiveGeofence();
    const health = useHealthData();

    const [mode, setMode] = useState<'hidden' | HealthPromptMode | 'settings'>('hidden');
    const [busy, setBusy] = useState(false);
    const evaluating = useRef(false);
    const modeRef = useRef(mode);
    modeRef.current = mode;

    const finishConnected = useCallback(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        // Same one-time bonus as the onboarding step — idempotent server-side, so
        // users who skipped onboarding still earn it when they connect from here.
        awardBonus('health_connection').catch(() => {});
        syncWalkingNow().catch(() => {});
        setMode('hidden');
    }, []);

    const evaluate = useCallback(async () => {
        if (evaluating.current || modeRef.current !== 'hidden') return;
        evaluating.current = true;
        try {
            if (!user?.id) return;
            if (Platform.OS === 'web') return;
            // A live gym session owns the screen — defer, another visit will come.
            if (activeGeofence) return;
            // No store to connect to (e.g. Health Connect not installed) — the
            // CTA would dead-end; onboarding's install flow is the path there.
            if (!health.isAvailable) return;

            // Fresh signals, not hook state: isAuthorized settles async after
            // mount, and a stale false here would flash the sheet at healthy
            // users. Steps readable is proof enough on both platforms; on
            // Android the grant list is directly checkable too.
            const steps = await getStepsToday().catch(() => 0);
            if (steps > 0) return;
            if (health.isAuthorized) return;
            if (Platform.OS === 'android' && (await androidCheckAlreadyGranted().catch(() => false))) return;

            const state = await getHealthPromptState();
            if (!shouldShowHealthPrompt(state, Date.now())) return;

            // The value moment: only ask users who have something to lose.
            if (!(await hasAnyCompletedSession(user.id))) return;

            // Yield to the notification and location sheets — they share this
            // mount, and stacked slide-up sheets is a bad look. Whoever's
            // pacing allows goes first; we'll catch the user on a later visit.
            const notifPerm = await Notifications.getPermissionsAsync().catch(() => null);
            if (notifPerm && notifPerm.status !== 'granted') {
                const notifState = await getNotificationPromptState();
                if (shouldShowNotificationPrompt(notifState, Date.now())) return;
            }
            const whileUsing = await isWhileUsingOnly().catch(() => null);
            if (whileUsing === true) {
                const locState = await getLocationPromptState();
                if (shouldShowLocationPrompt(locState, Date.now())) return;
            }

            const nextMode = detectHealthPromptMode({
                platform: Platform.OS as 'ios' | 'android',
                isAuthorized: health.isAuthorized,
                stepsToday: steps,
                hasRecentWalkingSession: await hasRecentWalkingSession(),
                everConnectedNative: await hasEverConnectedNative(),
            });
            if (!nextMode) return;

            recordHealthPromptShown().catch(() => {});
            setMode(nextMode);
        } finally {
            evaluating.current = false;
        }
    }, [user?.id, activeGeofence, health.isAvailable, health.isAuthorized]);

    useEffect(() => {
        evaluate();
    }, [evaluate]);

    // The hook's own auth restore can land after we showed the sheet — a late
    // "actually, the grant is fine" closes it without burning pacing state.
    useEffect(() => {
        if (health.isAuthorized && modeRef.current !== 'hidden') setMode('hidden');
    }, [health.isAuthorized]);

    // Settings mode sends the user out of the app; when they come back with the
    // store readable again, sync and get out of the way.
    useEffect(() => {
        const sub = AppState.addEventListener('change', async (next) => {
            if (next !== 'active' || modeRef.current === 'hidden') return;
            const grantedNow = Platform.OS === 'android'
                ? await androidCheckAlreadyGranted().catch(() => false)
                : (await getStepsToday().catch(() => 0)) > 0;
            if (grantedNow) finishConnected();
        });
        return () => sub.remove();
    }, [finishConnected]);

    const dismiss = () => {
        recordHealthPromptDismissed().catch(() => {});
        setMode('hidden');
    };

    const openHealthSettings = () => {
        if (Platform.OS === 'android') {
            try {
                androidOpenHealthConnectSettings();
            } catch {
                Linking.openSettings();
            }
        } else {
            // The Health app is where read-sharing lives on iOS; fall back to
            // the app's own settings page if the scheme ever stops resolving.
            Linking.openURL('x-apple-health://').catch(() => Linking.openSettings());
        }
    };

    const handleConnect = async () => {
        if (busy) return;
        setBusy(true);
        try {
            if (mode === 'settings') {
                // Sheet stays open — the AppState listener closes it on success.
                openHealthSettings();
                return;
            }
            const granted = await health.requestPermissions();
            if (granted) {
                finishConnected();
            } else {
                // The OS flow ran and access still isn't there (denied, or the
                // dialog is burned and nothing showed) — settings is the way in.
                setMode('settings');
            }
        } finally {
            setBusy(false);
        }
    };

    if (mode === 'hidden') return null;

    const platformName = Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect';
    const isReconnect = mode === 'reconnect';

    return (
        <Modal visible transparent animationType="slide" onRequestClose={dismiss}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
                <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
                    <View style={styles.handle} />

                    <Text style={styles.eyebrow}>STEP TRACKING</Text>
                    <Text style={styles.headline}>
                        {isReconnect ? (
                            <>
                                Your steps{'\n'}
                                <Text style={styles.headlineGold}>stopped counting.</Text>
                            </>
                        ) : mode === 'settings' ? (
                            <>
                                One switch{'\n'}
                                <Text style={styles.headlineGold}>from earning.</Text>
                            </>
                        ) : (
                            <>
                                Every step,{'\n'}
                                <Text style={styles.headlineGold}>banked.</Text>
                            </>
                        )}
                    </Text>
                    <Text style={styles.body}>
                        {isReconnect
                            ? `${platformName} is no longer sharing with POWR — its permissions can switch off after a reinstall or update. Your phone is still counting every step; POWR just can't see them. Reconnect and today's walking starts earning again.`
                            : mode === 'settings'
                                ? `POWR needs read access in ${platformName} to count your steps. Flip it on in ${Platform.OS === 'ios' ? 'the Health app' : 'Health Connect'} and this picks up right where you left off.`
                                : `Your phone already counts every step you take. Connect ${platformName} and they turn into POWR points automatically — no logging, no check-ins, just walking.`}
                    </Text>

                    {mode === 'settings' ? (
                        <Text style={styles.settingsPath}>
                            {Platform.OS === 'ios'
                                ? 'Health › Profile › Apps › POWR'
                                : 'Health Connect › App permissions › POWR'}
                        </Text>
                    ) : (
                        <View style={styles.tierMock}>
                            {([[4000, 2], [8000, 4], [10000, 5]] as const).map(([steps, pts]) => (
                                <View key={steps} style={styles.tierRow}>
                                    <Ionicons name="footsteps" size={13} color={GREEN} />
                                    <Text style={styles.tierSteps}>{steps.toLocaleString()} steps</Text>
                                    <View style={styles.tierTrack}>
                                        <View style={[styles.tierFill, { width: `${(steps / 10000) * 100}%` as const }]} />
                                    </View>
                                    <Text style={styles.tierPts}>+{pts} pts</Text>
                                </View>
                            ))}
                        </View>
                    )}

                    <Pressable
                        style={[styles.primaryButton, busy && { opacity: 0.7 }]}
                        onPress={handleConnect}
                        disabled={busy}
                    >
                        <Text style={styles.primaryLabel}>
                            {busy
                                ? 'REQUESTING...'
                                : mode === 'settings'
                                    ? 'OPEN HEALTH SETTINGS'
                                    : isReconnect
                                        ? 'RECONNECT'
                                        : `CONNECT ${platformName.toUpperCase()}`}
                        </Text>
                    </Pressable>

                    <Pressable style={styles.skipButton} onPress={dismiss}>
                        <Text style={styles.skipLabel}>Not now</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: CARD_BG,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: BORDER,
        paddingHorizontal: 24,
        paddingTop: 12,
        alignItems: 'center',
    },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.15)',
        marginBottom: 22,
    },
    eyebrow: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        marginBottom: 12,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 32,
        fontWeight: '200',
        letterSpacing: -0.8,
        lineHeight: 38,
        textAlign: 'center',
        marginBottom: 12,
    },
    headlineGold: {
        color: GOLD,
        fontWeight: '700',
    },
    body: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 13.5,
        fontWeight: '300',
        lineHeight: 21,
        textAlign: 'center',
        marginBottom: 20,
    },
    settingsPath: {
        color: 'rgba(255,255,255,0.55)',
        fontSize: 13,
        fontWeight: '500',
        letterSpacing: 0.3,
        marginBottom: 22,
    },
    tierMock: {
        alignSelf: 'stretch',
        gap: 10,
        marginBottom: 22,
        paddingHorizontal: 4,
    },
    tierRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    tierSteps: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 12,
        fontWeight: '400',
        width: 86,
    },
    tierTrack: {
        flex: 1,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
    },
    tierFill: {
        height: '100%',
        borderRadius: 2,
        backgroundColor: GREEN,
    },
    tierPts: {
        color: GOLD,
        fontSize: 12,
        fontWeight: '600',
        width: 44,
        textAlign: 'right',
    },
    primaryButton: {
        alignSelf: 'stretch',
        height: 52,
        borderRadius: 26,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
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

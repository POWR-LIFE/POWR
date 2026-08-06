import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PermissionPrimeScene from '@/components/onboarding/PermissionPrimeScene';
import { useAuth } from '@/context/AuthContext';
import { useActiveGeofence } from '@/hooks/useActiveGeofence';
import { reportLocationPermission } from '@/lib/locationPermission';
import {
    getLocationPromptState,
    hasReachedLocationValueMoment,
    isWhileUsingOnly,
    recordLocationPromptDismissed,
    recordLocationPromptShown,
    shouldShowLocationPrompt,
} from '@/lib/locationPrompt';
import {
    getNotificationPromptState,
    shouldShowNotificationPrompt,
} from '@/lib/notificationPrompt';

const GOLD = '#E8D200';
const CARD_BG = '#141414';
const BORDER = '#222222';

/**
 * The primed background-location re-ask, shown on Home at the value moment: the
 * user has shown they mean it (a banked session, or a return on a later day)
 * but is on "While Using", so POWR can't check them in from their pocket — the
 * whole passive-earning loop is silently off. Mirrors NotificationPrimeSheet
 * (same chrome, pacing shape and settings-return dance); reuses the onboarding
 * background scene so it reads as one continuous story.
 *
 * Two modes:
 *  - 'ask'    — the OS "Always/Allow all the time" upgrade is still reachable;
 *               CTA fires requestBackgroundPermissionsAsync (Android 11+ opens
 *               the settings radio list the mock coaches; iOS shows the alert).
 *  - 'settings' — iOS with the upgrade already declined, so the request no
 *               longer prompts; CTA deep-links to Settings and the sheet closes
 *               when the user returns on "Always".
 */
export default function LocationPrimeSheet() {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const { activeGeofence } = useActiveGeofence();

    const [mode, setMode] = useState<'hidden' | 'ask' | 'settings'>('hidden');
    const [busy, setBusy] = useState(false);
    const evaluating = useRef(false);
    const modeRef = useRef(mode);
    modeRef.current = mode;

    const finishGranted = useCallback(() => {
        if (user?.id) reportLocationPermission(user.id).catch(() => {});
        // Arm NOW. Granting permission used to arm nothing until the next
        // partner refresh (app launch / foreground return / 5-min tick), so a
        // user who granted here and pocketed the phone reached the gym with no
        // regions registered — field-proven 2026-08-06.
        // Dynamic import on purpose: GeofenceContext pulls the whole geofence
        // engine (task-manager, background-fetch, location) and a static import
        // would drag all of it into this component's tests.
        void import('@/context/GeofenceContext')
            .then(m => m.armAfterPermissionGrant())
            .catch(() => { /* the refresh path still covers it */ });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setMode('hidden');
    }, [user?.id]);

    const evaluate = useCallback(async () => {
        if (evaluating.current || modeRef.current !== 'hidden') return;
        evaluating.current = true;
        try {
            if (!user?.id) return;
            // A live gym session owns the screen — defer, another visit will come.
            if (activeGeofence) return;

            // Only the "While Using" silent-failure case is ours to fix.
            const whileUsing = await isWhileUsingOnly();
            if (whileUsing !== true) return;

            const state = await getLocationPromptState();
            if (!shouldShowLocationPrompt(state, Date.now())) return;

            // The value moment: they banked a session, or they simply came back
            // on a later day. Not "banked a session" alone any more — a While
            // Using user can be sessionless precisely BECAUSE they're on While
            // Using: no passive check-in, so no session row, so the gate stays
            // shut and they're never asked to fix the thing breaking them.
            // (Production: 3 of the 7 While Using users had no session at all.)
            if (!(await hasReachedLocationValueMoment(user.id))) return;

            // Yield to NotificationPrimeSheet — it shares this mount and value
            // moment, and two stacked slide-up sheets is a bad first impression.
            // If notifications are also off and its pacing lets it show, it wins
            // this visit; we'll catch the user on the next one.
            const notifPerm = await Notifications.getPermissionsAsync().catch(() => null);
            if (notifPerm && notifPerm.status !== 'granted') {
                const notifState = await getNotificationPromptState();
                if (shouldShowNotificationPrompt(notifState, Date.now())) return;
            }

            // On iOS the "Always" alert is one-shot: once declined it won't fire
            // again (canAskAgain false), so we must deep-link to Settings instead.
            // Android 11+ always routes the request through the settings page, so
            // 'ask' (which fires the request) is right there regardless.
            const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
            const iosBurned = Platform.OS === 'ios' && bg?.canAskAgain === false;

            recordLocationPromptShown().catch(() => {});
            setMode(iosBurned ? 'settings' : 'ask');
        } finally {
            evaluating.current = false;
        }
    }, [user?.id, activeGeofence]);

    useEffect(() => {
        evaluate();
    }, [evaluate]);

    // The request (Android) or the deep-link (iOS settings mode) both send the
    // user out; when they return on "Always", close and re-report the snapshot.
    useEffect(() => {
        const sub = AppState.addEventListener('change', async (next) => {
            if (next !== 'active' || modeRef.current === 'hidden') return;
            const upgraded = await isWhileUsingOnly();
            // isWhileUsingOnly returns false only when background is now granted.
            if (upgraded === false) finishGranted();
        });
        return () => sub.remove();
    }, [finishGranted]);

    const dismiss = () => {
        recordLocationPromptDismissed().catch(() => {});
        setMode('hidden');
    };

    const handleEnable = async () => {
        if (busy) return;
        setBusy(true);
        try {
            if (mode === 'settings') {
                // Sheet stays open — the AppState listener closes it on success.
                Linking.openSettings();
                return;
            }
            // Android 11+ opens the app's location settings page (the radio list
            // the mock coaches); iOS shows the "Always" alert. Either way, the
            // AppState listener catches a successful upgrade on return; here we
            // just handle the synchronous grant and a flat decline.
            let granted = false;
            try {
                const { status } = await Location.requestBackgroundPermissionsAsync();
                granted = status === 'granted';
            } catch {
                // Native request failed — leave the sheet; they can try later.
            }
            if (granted) {
                finishGranted();
            } else if (Platform.OS === 'ios') {
                // They saw the alert and didn't upgrade — offer Settings rather
                // than dead-end, matching the onboarding background page.
                setMode('settings');
            } else {
                // Android sent them to settings; the listener will catch a grant.
                // If they came back unchanged it's an answer — count it and close.
                const still = await isWhileUsingOnly();
                if (still === true) dismiss();
            }
        } finally {
            setBusy(false);
        }
    };

    if (mode === 'hidden') return null;

    const alwaysLabel = Platform.OS === 'ios' ? '“Always”' : '“Allow all the time”';

    return (
        <Modal visible transparent animationType="slide" onRequestClose={dismiss}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
                <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
                    <View style={styles.handle} />

                    <Text style={styles.eyebrow}>BACKGROUND LOCATION</Text>
                    <Text style={styles.headline}>
                        Earning while{'\n'}
                        <Text style={styles.headlineGold}>you sit still.</Text>
                    </Text>
                    <Text style={styles.body}>
                        {mode === 'ask'
                            ? `POWR can only check you in from your pocket on ${alwaysLabel}. Right now it’s set to “While Using”, so every trip to the gym with the app closed is earning you nothing.`
                            : `Set POWR’s location to ${alwaysLabel} in Settings and it’ll check you in automatically — even with the app closed.`}
                    </Text>

                    {mode === 'ask' ? (
                        <View style={styles.mock}>
                            <PermissionPrimeScene kind="location-background" />
                        </View>
                    ) : (
                        <Text style={styles.settingsPath}>
                            Settings › POWR › Location › Always
                        </Text>
                    )}

                    <Pressable
                        style={[styles.primaryButton, busy && { opacity: 0.7 }]}
                        onPress={handleEnable}
                        disabled={busy}
                    >
                        <Text style={styles.primaryLabel}>
                            {busy
                                ? 'REQUESTING...'
                                : mode === 'ask'
                                  ? Platform.OS === 'ios'
                                      ? 'SET TO ALWAYS'
                                      : 'ALLOW ALL THE TIME'
                                  : 'OPEN SETTINGS'}
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
    mock: {
        alignSelf: 'stretch',
        marginBottom: 22,
    },
    settingsPath: {
        color: 'rgba(255,255,255,0.55)',
        fontSize: 13,
        fontWeight: '500',
        letterSpacing: 0.3,
        marginBottom: 22,
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

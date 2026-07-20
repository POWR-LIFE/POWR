import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NotificationPreviewStack from '@/components/onboarding/NotificationPreviewStack';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationsContext';
import { useActiveGeofence } from '@/hooks/useActiveGeofence';
import {
    getNotificationPromptState,
    hasAnyCompletedSession,
    recordPromptDismissed,
    recordPromptShown,
    shouldShowNotificationPrompt,
} from '@/lib/notificationPrompt';

const GOLD = '#E8D200';
const CARD_BG = '#141414';
const BORDER = '#222222';

/**
 * The primed notification re-ask, shown on Home at the value moment: the user
 * has at least one completed session banked but notifications are off, so
 * payouts have been landing in silence. Decides its own visibility (permission
 * state + pacing from lib/notificationPrompt + not during a live gym session)
 * so mounting it is a one-liner.
 *
 * Two modes:
 *  - 'ask'    — the OS dialog is still available; CTA fires it (primed by the
 *               same branded notification preview used in onboarding).
 *  - 'denied' — the dialog is burned; CTA deep-links to system settings and
 *               the sheet auto-closes when the user returns with it enabled.
 */
export default function NotificationPrimeSheet() {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const { requestPermissions } = useNotifications();
    const { activeGeofence } = useActiveGeofence();

    const [mode, setMode] = useState<'hidden' | 'ask' | 'denied'>('hidden');
    const [busy, setBusy] = useState(false);
    const evaluating = useRef(false);
    const modeRef = useRef(mode);
    modeRef.current = mode;

    const evaluate = useCallback(async () => {
        if (evaluating.current || modeRef.current !== 'hidden') return;
        evaluating.current = true;
        try {
            if (!user?.id) return;
            // A live gym session owns the screen — defer, another visit will come.
            if (activeGeofence) return;

            const perm = await Notifications.getPermissionsAsync();
            if (perm.status === 'granted') return;

            const state = await getNotificationPromptState();
            if (!shouldShowNotificationPrompt(state, Date.now())) return;

            // The value moment: only ask users who have something to lose.
            if (!(await hasAnyCompletedSession(user.id))) return;

            recordPromptShown().catch(() => {});
            setMode(perm.status === 'undetermined' || perm.canAskAgain ? 'ask' : 'denied');
        } finally {
            evaluating.current = false;
        }
    }, [user?.id, activeGeofence]);

    useEffect(() => {
        evaluate();
    }, [evaluate]);

    // Denied mode sends the user to system settings; when they come back with
    // notifications enabled, register the token and get out of the way.
    useEffect(() => {
        const sub = AppState.addEventListener('change', async (next) => {
            if (next !== 'active' || modeRef.current !== 'denied') return;
            const perm = await Notifications.getPermissionsAsync();
            if (perm.status === 'granted') {
                requestPermissions().catch(() => {});
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                setMode('hidden');
            }
        });
        return () => sub.remove();
    }, [requestPermissions]);

    const dismiss = () => {
        recordPromptDismissed().catch(() => {});
        setMode('hidden');
    };

    const handleEnable = async () => {
        if (busy) return;
        setBusy(true);
        try {
            if (mode === 'denied') {
                // Sheet stays open — the AppState listener closes it on success.
                Linking.openSettings();
                return;
            }
            const granted = await requestPermissions();
            if (granted) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                setMode('hidden');
            } else {
                // They saw the real dialog and said no — that's an answer.
                recordPromptDismissed().catch(() => {});
                setMode('hidden');
            }
        } finally {
            setBusy(false);
        }
    };

    if (mode === 'hidden') return null;

    return (
        <Modal visible transparent animationType="slide" onRequestClose={dismiss}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
                <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
                    <View style={styles.handle} />

                    <Text style={styles.eyebrow}>NOTIFICATIONS</Text>
                    <Text style={styles.headline}>
                        Earning in{'\n'}
                        <Text style={styles.headlineGold}>silence.</Text>
                    </Text>
                    <Text style={styles.body}>
                        {mode === 'ask'
                            ? 'You’ve banked sessions with alerts off — every payout landed without a sound. Turn them on and know the second a session counts, a streak’s saved or a reward drops.'
                            : 'Notifications are switched off for POWR at the system level. Flip them on in Settings and never find out late again.'}
                    </Text>

                    {mode === 'ask' ? (
                        <View style={styles.mock}>
                            <NotificationPreviewStack />
                        </View>
                    ) : (
                        // openSettings lands on the app's own page on both
                        // platforms — the hint names the row to tap from there.
                        <Text style={styles.settingsPath}>
                            {Platform.OS === 'ios'
                                ? 'Settings › POWR › Notifications'
                                : 'App info › Notifications'}
                        </Text>
                    )}

                    <Pressable
                        style={[styles.primaryButton, busy && { opacity: 0.7 }]}
                        onPress={handleEnable}
                        disabled={busy}
                    >
                        <Text style={styles.primaryLabel}>
                            {busy ? 'REQUESTING...' : mode === 'ask' ? 'ENABLE ALERTS' : 'OPEN SETTINGS'}
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

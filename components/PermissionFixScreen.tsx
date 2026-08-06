import GeometricBackground from '@/components/GeometricBackground';
import type { PermissionMockKind } from '@/components/onboarding/PermissionPrimeMock';
import PermissionPrimeScene from '@/components/onboarding/PermissionPrimeScene';
import { useNotifications } from '@/context/NotificationsContext';
import { requestBatteryOptimizationExemption } from '@/lib/batteryOptimization';
import { openAppLocationSettings } from '@/lib/openAppSettings';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const FONT_LIGHT = 'Outfit_300Light';
const FONT_MEDIUM = 'Outfit_500Medium';
const FONT_SEMIBOLD = 'Outfit_600SemiBold';
const FONT_BOLD = 'Outfit_700Bold';

/**
 * The permission-fixing screen Settings opens instead of a bare OS alert.
 *
 * Deliberately the *same surface* as the onboarding permission pages — same
 * geometric backdrop, eyebrow, oversized headline, primed dialog mock and gold
 * CTA — because it's the same job: show the user the screen they're about to
 * land on and which option to pick. A user arriving from Settings is in the
 * worse position (the OS dialog is often burned and they have to hunt a row in
 * the system settings app), so they need at least as much coaching as a new
 * user gets, not less.
 *
 * Two routes, decided from live permission state when it opens — and, exactly
 * as onboarding does it, the two look the same. The mock stays put; only the
 * body copy and the CTA label change:
 *  - 'ask'      — the OS dialog can still fire, so the CTA triggers the real one.
 *  - 'settings' — the dialog is burned (or there never was one), so the CTA
 *                 deep-links out and the body names the row to tap on the way.
 *
 * Either way an AppState listener closes it the moment the underlying
 * permission actually flips, so returning from settings needs no extra tap.
 */

export type PermissionFixKind =
    | 'location'            // foreground location missing
    | 'location-precise'    // granted, but Android "Approximate"
    | 'location-background' // granted, but not Always / Allow all the time
    | 'location-ok'         // nothing to fix — how to change it later
    | 'battery'             // Android background activity
    | 'notifications';

type Route = 'ask' | 'settings';

const isIOS = Platform.OS === 'ios';
const ALWAYS = isIOS ? '“Always”' : '“Allow all the time”';

interface Spec {
    eyebrow: string;
    /** Headline split so the last words carry the gold, as on the onboarding pages. */
    headline: [string, string];
    /** `*text*` renders in the onboarding bodyStrong — used to name the row to tap. */
    body: string;
    cta: string;
    /** The onboarding scene to prime with — the same component those pages use. */
    scene: PermissionMockKind;
    /** Hide the dialog mock when nothing is actually about to pop. */
    dialog?: boolean;
}

/** Where the OS drops the user when we deep-link out, named so they can follow it. */
const APP_SETTINGS_PATH = isIOS ? 'Settings › POWR' : 'App info › Permissions';

function specFor(kind: PermissionFixKind, route: Route): Spec {
    switch (kind) {
        case 'location':
            return {
                eyebrow: 'LOCATION',
                headline: ['Unlock the\n', 'map.'],
                body:
                    route === 'ask'
                        ? 'Partner gyms and automatic check-ins — it all starts with where you are.'
                        : `Location is off for POWR, so sessions at partner gyms can’t be verified — and your phone won’t ask again. Turn it back on under *${APP_SETTINGS_PATH} › Location*.`,
                cta: route === 'ask' ? (isIOS ? 'ALLOW WHILE USING' : 'ALLOW LOCATION') : 'OPEN SETTINGS',
                scene: 'location-foreground',
            };

        case 'location-precise':
            // Always a settings trip — the OS won't re-prompt just to sharpen
            // accuracy. The foreground mock rings the Precise chip regardless.
            return {
                eyebrow: 'PRECISE LOCATION',
                headline: ['Close enough\nto ', 'count.'],
                body: `POWR checks you’re really at the gym, down to a few metres. Approximate location can’t do that, so sessions won’t count. Turn on *Precise* under *${APP_SETTINGS_PATH} › Location*.`,
                cta: 'OPEN SETTINGS',
                scene: 'location-foreground',
            };

        case 'location-background':
            return {
                eyebrow: 'PASSIVE TRACKING',
                headline: ['Earn while\nyou ', 'move.'],
                body:
                    route === 'ask'
                        ? `No pressing start. POWR checks you in from your pocket — even when the app is closed. That only works on *${ALWAYS}*.`
                        : `Location is on, but only while you’re in the app — so every gym trip with POWR closed earns nothing. Set it to *${ALWAYS}* under *${APP_SETTINGS_PATH} › Location*.`,
                cta:
                    route === 'ask'
                        ? isIOS ? 'SET TO ALWAYS' : 'ALLOW ALL THE TIME'
                        : 'OPEN SETTINGS',
                scene: 'location-background',
            };

        case 'location-ok':
            // Nothing is about to pop, so the hero runs without a dialog over it.
            return {
                eyebrow: 'LOCATION',
                headline: ['You’re all\n', 'set.'],
                body: 'POWR can see where you are and check you in automatically. Turn it off and you stop earning at geofenced venues and partner gyms.',
                cta: 'OPEN SETTINGS',
                scene: 'location-foreground',
                dialog: false,
            };

        case 'battery':
            return {
                eyebrow: 'BACKGROUND ACTIVITY',
                headline: ['Don’t let Android\n', 'sleep on it.'],
                body: 'POWR keeps a light watch running so it can spot gym arrivals with the app closed. Battery optimisation kills that watch without telling you.',
                cta: 'ALLOW UNRESTRICTED',
                scene: 'battery',
            };

        case 'notifications':
            return {
                eyebrow: 'NOTIFICATIONS',
                headline: ['Know when\nyou ', 'earn.'],
                body:
                    route === 'ask'
                        ? 'A session lands, a streak’s at risk, a reward drops nearby — you’ll know the second it happens. Every alert is yours to switch off.'
                        : `Alerts are off for POWR at the system level, so nothing below can reach you — and your phone won’t ask again. Turn them on under *${isIOS ? 'Settings › POWR' : 'App info'} › Notifications*.`,
                cta: route === 'ask' ? 'ENABLE ALERTS' : 'OPEN SETTINGS',
                scene: 'notifications',
            };
    }
}

/**
 * Splits `set it to *Always*` into plain/emphasised runs, the same way the
 * onboarding background page calls out the option that matters.
 */
function BodyText({ text }: { text: string }) {
    return (
        <Text style={styles.body}>
            {text.split('*').map((part, i) =>
                i % 2 === 1 ? <Text key={i} style={styles.bodyStrong}>{part}</Text> : part,
            )}
        </Text>
    );
}

/** True once the thing this screen exists to fix is actually fixed. */
async function isResolved(kind: PermissionFixKind): Promise<boolean> {
    switch (kind) {
        case 'location': {
            const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
            return fg?.status === 'granted';
        }
        case 'location-precise': {
            const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
            return fg?.status === 'granted' && fg.android?.accuracy === 'fine';
        }
        case 'location-background': {
            const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
            return bg?.status === 'granted';
        }
        case 'notifications': {
            const perm = await Notifications.getPermissionsAsync().catch(() => null);
            return perm?.status === 'granted';
        }
        // No API tells us the exemption was granted, and 'location-ok' has
        // nothing to resolve — both close on the user's own say-so.
        case 'battery':
        case 'location-ok':
            return false;
    }
}

export default function PermissionFixScreen({
    kind,
    onClose,
}: {
    kind: PermissionFixKind | null;
    onClose: () => void;
}) {
    const insets = useSafeAreaInsets();
    const { requestPermissions } = useNotifications();

    const [route, setRoute] = useState<Route | null>(null);
    const [busy, setBusy] = useState(false);
    const kindRef = useRef(kind);
    kindRef.current = kind;

    // Onboarding fades its content in; do the same so this reads as that screen
    // — but without onboarding's 800 ms hold, which would feel broken on a tap.
    const fade = useRef(new Animated.Value(0)).current;

    // Pick the route from live permission state each time this opens — the OS
    // dialog may have burned since the caller last looked.
    useEffect(() => {
        let cancelled = false;
        if (!kind) { setRoute(null); fade.setValue(0); return; }
        (async () => {
            let next: Route = 'settings';
            if (kind === 'location') {
                const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
                next = !fg || fg.status === 'undetermined' || fg.canAskAgain ? 'ask' : 'settings';
            } else if (kind === 'location-background') {
                // Android 11+ routes the request through its own settings page,
                // which is exactly the screen the mock coaches — so 'ask' is
                // right there even after a decline. Only iOS burns the alert.
                const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
                next = isIOS && bg?.canAskAgain === false ? 'settings' : 'ask';
            } else if (kind === 'notifications') {
                const perm = await Notifications.getPermissionsAsync().catch(() => null);
                next = !perm || perm.status === 'undetermined' || perm.canAskAgain ? 'ask' : 'settings';
            }
            if (cancelled) return;
            setRoute(next);
            Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true }).start();
        })();
        return () => { cancelled = true; };
    }, [kind, fade]);

    const finish = useCallback(() => {
        // Arm NOW — this is the convergence point for EVERY grant path,
        // including the one where the user flips the switch in system Settings
        // and returns (iOS restarts the app on that change, so nothing else
        // would arm until they happened to open it again).
        // Dynamic import on purpose: GeofenceContext pulls the whole geofence
        // engine (task-manager, background-fetch, location) and a static import
        // would drag all of it into this component's tests.
        void import('@/context/GeofenceContext')
            .then(m => m.armAfterPermissionGrant())
            .catch(() => { /* the refresh path still covers it */ });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onClose();
    }, [onClose]);

    // Every settings deep-link (and Android's background request) sends the user
    // out of the app. Close on their return the moment the grant actually landed.
    useEffect(() => {
        if (!kind) return;
        const sub = AppState.addEventListener('change', async (next) => {
            if (next !== 'active') return;
            const current = kindRef.current;
            if (!current) return;
            if (await isResolved(current)) finish();
        });
        return () => sub.remove();
    }, [kind, finish]);

    const handlePrimary = async () => {
        if (busy || !kind || !route) return;
        setBusy(true);
        try {
            if (route === 'settings') {
                if (kind === 'battery') {
                    // Resolves once the user is back from the dialog (or the app
                    // info page it falls through to). Android exposes no way to
                    // read the exemption, so there's nothing to re-check — get
                    // out of the way rather than leave them on a stale screen.
                    await requestBatteryOptimizationExemption();
                    onClose();
                    return;
                }
                // The rest stay open — the AppState listener closes them once
                // the grant actually lands, or the user backs out themselves.
                if (kind === 'notifications') await Linking.openSettings().catch(() => {});
                else await openAppLocationSettings();
                return;
            }

            if (kind === 'notifications') {
                // Goes through the context so a grant also registers the push token.
                if (await requestPermissions()) finish();
                else setRoute('settings');
                return;
            }

            if (kind === 'location') {
                const res = await Location.requestForegroundPermissionsAsync().catch(() => null);
                if (res?.status === 'granted') finish();
                else if (!res || res.canAskAgain === false) setRoute('settings');
                return;
            }

            if (kind === 'location-background') {
                const res = await Location.requestBackgroundPermissionsAsync().catch(() => null);
                if (res?.status === 'granted') finish();
                // iOS showed its one-shot alert and they declined — the only
                // lever left is settings. Android already sent them there, so
                // leave this open; the AppState listener catches a grant.
                else if (isIOS) setRoute('settings');
            }
        } finally {
            setBusy(false);
        }
    };

    if (!kind || !route) return null;

    const spec = specFor(kind, route);

    return (
        <Modal visible transparent={false} animationType="slide" onRequestClose={onClose}>
            <View style={styles.container}>
                <GeometricBackground />

                {/* Back out — the settings row is still there when they return */}
                <Pressable style={[styles.backButton, { top: insets.top + 14 }]} onPress={onClose} hitSlop={24}>
                    <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
                </Pressable>

                <View style={[styles.center, { paddingTop: insets.top + 60 }]}>
                    <Animated.View style={[styles.textBlock, { opacity: fade }]}>
                        <Text style={styles.eyebrow}>{spec.eyebrow}</Text>
                        <Text style={styles.headline}>
                            {spec.headline[0]}
                            <Text style={styles.headlineGold}>{spec.headline[1]}</Text>
                        </Text>
                        <BodyText text={spec.body} />

                        <View style={styles.mock}>
                            <PermissionPrimeScene kind={spec.scene} dialog={spec.dialog} />
                        </View>
                    </Animated.View>
                </View>

                <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 32, opacity: fade }]}>
                    <Pressable
                        style={[styles.primaryButton, busy && { opacity: 0.7 }]}
                        onPress={handlePrimary}
                        disabled={busy}
                    >
                        <Text style={styles.primaryLabel}>{busy ? 'REQUESTING...' : spec.cta}</Text>
                    </Pressable>

                    <Pressable style={styles.skipButton} onPress={onClose}>
                        <Text style={styles.skipLabel}>{kind === 'location-ok' ? 'Done' : 'Not now'}</Text>
                    </Pressable>
                </Animated.View>
            </View>
        </Modal>
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

import GeometricBackground from '@/components/GeometricBackground';
import type { PermissionMockKind } from '@/components/onboarding/PermissionPrimeMock';
import PermissionPrimeScene from '@/components/onboarding/PermissionPrimeScene';
import { useNotifications } from '@/context/NotificationsContext';
import { useGymRelevance } from '@/hooks/useGymRelevance';
import { requestBatteryOptimizationExemption } from '@/lib/batteryOptimization';
import { openAppLocationSettings } from '@/lib/openAppSettings';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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

interface Spec {
    /** Catalog keys throughout, resolved at render. */
    eyebrow: string;
    /** `<gold>` carries the last words, as on the onboarding pages. */
    headline: string;
    /** `<strong>` renders in the onboarding bodyStrong — used to name the row to tap. */
    body: string;
    /** Translated values for the body's {{placeholders}}. */
    values?: Record<string, string>;
    cta: string;
    /** The onboarding scene to prime with — the same component those pages use. */
    scene: PermissionMockKind;
    /** Hide the dialog mock when nothing is actually about to pop. */
    dialog?: boolean;
}

/** Copy branches on whether the gym is relevant to THIS user — a runner who
 *  never checks in shouldn't be told about "gym trips" (see useGymRelevance).
 *  The OS names in the values (where the OS drops the user when we deep-link
 *  out, the option to pick) come translated, since they follow the phone. */
function specFor(kind: PermissionFixKind, route: Route, t: TFunction, gymRelevant = true): Spec {
    const always = t(isIOS ? 'permissions:background.alwaysIos' : 'permissions:background.alwaysAndroid');
    const locationPath = t(isIOS ? 'permissions:fix.paths.locationIos' : 'permissions:fix.paths.locationAndroid');
    switch (kind) {
        case 'location':
            return {
                eyebrow: 'permissions:location.eyebrow',
                headline: 'permissions:location.headline',
                body:
                    route === 'ask'
                        ? gymRelevant ? 'permissions:location.bodyGym' : 'permissions:location.bodyVenue'
                        : gymRelevant ? 'permissions:location.offGym' : 'permissions:location.offVenue',
                values: { path: locationPath },
                cta:
                    route === 'ask'
                        ? isIOS ? 'permissions:location.cta.allowIos' : 'permissions:location.cta.allowAndroid'
                        : 'permissions:cta.openSettings',
                scene: 'location-foreground',
            };

        case 'location-precise':
            // Always a settings trip — the OS won't re-prompt just to sharpen
            // accuracy. The foreground mock rings the Precise chip regardless.
            return {
                eyebrow: 'permissions:precise.eyebrow',
                headline: 'permissions:precise.headline',
                body: gymRelevant ? 'permissions:precise.bodyGym' : 'permissions:precise.bodyVenue',
                values: { path: locationPath },
                cta: 'permissions:cta.openSettings',
                scene: 'location-foreground',
            };

        case 'location-background':
            return {
                eyebrow: 'permissions:background.eyebrow',
                headline: 'permissions:background.headline',
                body:
                    route === 'ask'
                        ? 'permissions:background.body'
                        : gymRelevant ? 'permissions:background.offGym' : 'permissions:background.offVenue',
                values: { always, path: locationPath },
                cta:
                    route === 'ask'
                        ? isIOS ? 'permissions:background.cta.allowIos' : 'permissions:background.cta.allowAndroid'
                        : 'permissions:cta.openSettings',
                scene: 'location-background',
            };

        case 'location-ok':
            // Nothing is about to pop, so the hero runs without a dialog over it.
            return {
                eyebrow: 'permissions:location.eyebrow',
                headline: 'permissions:locationOk.headline',
                body: gymRelevant ? 'permissions:locationOk.bodyGym' : 'permissions:locationOk.bodyVenue',
                cta: 'permissions:cta.openSettings',
                scene: 'location-foreground',
                dialog: false,
            };

        case 'battery':
            return {
                eyebrow: 'permissions:battery.eyebrow',
                headline: 'permissions:battery.headline',
                body: gymRelevant ? 'permissions:battery.bodyGym' : 'permissions:battery.bodyVenue',
                cta: 'permissions:battery.cta',
                scene: 'battery',
            };

        case 'notifications':
            return {
                eyebrow: 'permissions:notifications.eyebrow',
                headline: 'permissions:notifications.headline',
                body: route === 'ask' ? 'permissions:notifications.body' : 'permissions:notifications.off',
                values: {
                    path: t(isIOS ? 'permissions:fix.paths.notificationsIos' : 'permissions:fix.paths.notificationsAndroid'),
                },
                cta: route === 'ask' ? 'permissions:notifications.cta' : 'permissions:cta.openSettings',
                scene: 'notifications',
            };
    }
}

/**
 * Renders the body with its `<strong>` runs, the same way the onboarding
 * background page calls out the option that matters.
 */
function BodyText({ i18nKey, values }: { i18nKey: string; values?: Record<string, string> }) {
    return (
        <Text style={styles.body}>
            <Trans i18nKey={i18nKey} values={values} components={{ strong: <Text style={styles.bodyStrong} /> }} />
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
    // Hooks first — this component early-returns below.
    const gymRelevant = useGymRelevance();
    const insets = useSafeAreaInsets();
    const { t } = useTranslation();
    const { requestPermissions } = useNotifications();

    const [route, setRoute] = useState<Route | null>(null);
    const [busy, setBusy] = useState(false);
    const kindRef = useRef(kind);
    kindRef.current = kind;
    // Once-latch for finish(). The Android settings-return grant resolves the
    // awaited request in handlePrimary AND fires the AppState listener within
    // ~130 ms; both called finish(), so armAfterPermissionGrant ran twice and
    // the two arms raced startGeofencingAsync (field 2026-08-13 — the second
    // registration cancels the first's delivery PendingIntent). Synchronous
    // latch, set before any async work; re-opens with `kind` below.
    const finishedRef = useRef(false);

    // Onboarding fades its content in; do the same so this reads as that screen
    // — but without onboarding's 800 ms hold, which would feel broken on a tap.
    const fade = useRef(new Animated.Value(0)).current;

    // Pick the route from live permission state each time this opens — the OS
    // dialog may have burned since the caller last looked.
    useEffect(() => {
        let cancelled = false;
        finishedRef.current = false;
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
        if (finishedRef.current) return;
        finishedRef.current = true;
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
                // Not granted, and from here we cannot tell WHY. iOS burned its
                // one-shot alert; Android 11+ USUALLY routes to its own settings
                // page, but auto-denies with no UI at all when foreground is
                // missing. This used to be `else if (isIOS)`, which left Android
                // on a screen whose only button did nothing — confirmed on a
                // field device 2026-08-09, where the sole effect of pressing it
                // was to move perm_bg from 'undetermined' to 'denied'.
                //
                // So: always leave a route that works. It costs the Android
                // retry-in-place case nothing (the CTA becomes OPEN SETTINGS,
                // which lands on the same page the request would have opened)
                // and the AppState listener still closes us on a real grant.
                else setRoute('settings');
            }
        } finally {
            setBusy(false);
        }
    };

    if (!kind || !route) return null;

    const spec = specFor(kind, route, t, gymRelevant);

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
                        <Text style={styles.eyebrow}>{t(spec.eyebrow)}</Text>
                        <Text style={styles.headline}>
                            <Trans i18nKey={spec.headline} components={{ gold: <Text style={styles.headlineGold} /> }} />
                        </Text>
                        <BodyText i18nKey={spec.body} values={spec.values} />

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
                        <Text style={styles.primaryLabel}>{busy ? t('permissions:cta.requesting') : t(spec.cta)}</Text>
                    </Pressable>

                    <Pressable style={styles.skipButton} onPress={onClose}>
                        <Text style={styles.skipLabel}>
                            {kind === 'location-ok' ? t('permissions:fix.done') : t('permissions:fix.notNow')}
                        </Text>
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

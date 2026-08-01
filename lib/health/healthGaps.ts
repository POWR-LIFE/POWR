/**
 * Health-data gap detection + remediation.
 *
 * Cross-platform "are we actually getting your workouts?" check. Wearables can
 * feed POWR everything *except* the one thing that matters — the workout — when a
 * permission or third-party setting is off:
 *   • Android: POWR not granted Health Connect `ExerciseSession` read, OR the user
 *     hasn't enabled Activities in Garmin Connect → Health Connect.
 *   • iOS: "Workouts" read left off for POWR in Apple Health (the iOS run/cycle/swim
 *     inference in runInference.ts already covers Garmin's distance-only case, so
 *     this is the residual: a worn device is active but its workout isn't readable).
 *
 * The detector is pure (testable); the async gatherer feeds it real signals. We
 * bias hard against nagging: a banner only appears with positive evidence a
 * worn device did real work today (active energy above a walking baseline) that
 * we failed to capture — never on a phone-only user or a rest day.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';

import { androidRequestPermissions, androidOpenHealthConnectSettings } from '@/hooks/useHealthData';
import { wearableSilentCopy, type WearableFreshness } from '@/lib/health/wearableStatus';

export type HealthGapKind =
    | 'none'
    | 'wearable_silent'               // connected wearable has delivered nothing for days
    | 'android_exercise_permission'   // grant POWR Health Connect workout read (1 tap)
    | 'workouts_missing';             // worn device active but workout isn't coming through

export type HealthGapSignals = {
    platform: 'ios' | 'android' | 'web';
    /** Native health store connected & data flowing (don't nag the unconnected). */
    nativeConnected: boolean;
    /** Android only: is Health Connect ExerciseSession read granted? null = n/a/unknown. */
    androidExerciseGranted: boolean | null;
    /** A worn device wrote data today (vs phone-only). */
    wearablePresent: boolean;
    /** We already captured a workout/exercise session (incl. inferred cardio) today. */
    hadCapturedWorkoutToday: boolean;
    /** Active energy today (kcal) — proxy for "did real work", filters out rest days. */
    activeEnergyToday: number;
    /**
     * Server-confirmed freshness of the user's live Terra wearable
     * (lib/health/wearableStatus.ts). 'none' when they have no wearable.
     */
    wearableFreshness: WearableFreshness;
};

/** Active kcal above which we assume a genuine workout happened, not just walking. Tunable. */
export const WORKOUT_ENERGY_HINT = 400;

/**
 * Decide which (if any) gap to surface. Pure — all I/O happens in getHealthGap().
 * Order matters: the Android permission gap is the highest-precision signal, so it
 * wins over the softer energy-based heuristic.
 */
export function detectHealthGap(s: HealthGapSignals): HealthGapKind {
    // Checked before BOTH the web and nativeConnected gates, deliberately:
    //  • not web-gated, because unlike every other kind here this one is pure
    //    server state (terra_connections) rather than a native health API — it's
    //    equally true and equally actionable on web, and it keeps the loud path
    //    QA-verifiable on expo web.
    //  • not nativeConnected-gated, because a wearable user need not have the
    //    phone health store connected at all, and gating on it would hide the
    //    exact case we care most about.
    // Ranked first because it's server-confirmed fact (the connection has
    // delivered nothing) rather than inference from today's numbers — and
    // because five silent weeks beats a missing toggle.
    if (s.wearableFreshness === 'silent') return 'wearable_silent';

    if (s.platform === 'web' || !s.nativeConnected) return 'none';

    // Highest precision: we can literally read that the workout scope is ungranted.
    if (s.platform === 'android' && s.androidExerciseGranted === false) {
        return 'android_exercise_permission';
    }

    // Softer, positive-evidence heuristic (both platforms): a worn device did real
    // work today but no workout came through. Energy gate keeps rest days quiet.
    if (s.wearablePresent && !s.hadCapturedWorkoutToday && s.activeEnergyToday >= WORKOUT_ENERGY_HINT) {
        return 'workouts_missing';
    }

    return 'none';
}

// ── Remediation ───────────────────────────────────────────────────────────────

export type HealthGapCopy = { title: string; body: string; cta: string };

/** Extra detail the wearable copy needs; ignored by the other kinds. */
export type HealthGapContext = {
    providerName?: string | null;
    hoursSinceSync?: number | null;
};

export function gapCopy(kind: HealthGapKind, ctx: HealthGapContext = {}): HealthGapCopy | null {
    switch (kind) {
        case 'wearable_silent':
            return wearableSilentCopy(ctx.providerName ?? 'Your wearable', ctx.hoursSinceSync ?? null);
        case 'android_exercise_permission':
            return {
                title: 'Turn on workout tracking',
                body: 'POWR can see your steps but not your workouts. Allow workout access to earn points for runs, rides and more.',
                cta: 'Allow access',
            };
        case 'workouts_missing':
            return Platform.OS === 'android'
                ? {
                    title: 'Missing your workouts?',
                    body: 'Your wearable is logging activity, but workouts aren’t coming through. In Garmin Connect → Settings → Health Connect, turn on Activities.',
                    cta: 'Open Health Connect',
                }
                : {
                    title: 'Missing your workouts?',
                    body: 'Your wearable is logging activity, but POWR can’t see your workouts. Enable Workouts for POWR in Apple Health.',
                    cta: 'Open Health settings',
                };
        default:
            return null;
    }
}

/**
 * Act on a gap's CTA. Returns true if the user may have fixed it (caller should
 * re-check). For the Android permission case this triggers the actual grant dialog.
 */
export async function resolveHealthGap(kind: HealthGapKind): Promise<boolean> {
    try {
        // 'wearable_silent' is deliberately absent: its remedy is navigation to
        // /wearables, and this module stays router-free so it can be unit-tested
        // without a nav tree. HealthGapBanner routes that kind itself.
        if (kind === 'android_exercise_permission') {
            return await androidRequestPermissions();
        }
        if (kind === 'workouts_missing') {
            if (Platform.OS === 'android') {
                androidOpenHealthConnectSettings();
                return true;
            }
            // iOS: open the Health app if possible, else POWR's own settings (has a
            // Health section). Apple exposes no deep link to a specific app's toggles.
            await Linking.openURL('x-apple-health://').catch(() => Linking.openSettings());
            return true;
        }
    } catch (e) {
        console.warn('[healthGaps] resolve failed:', e);
    }
    return false;
}

// ── Per-day dismissal ─────────────────────────────────────────────────────────
// Dismissing hides the banner for the rest of the local day, then it may resurface
// if the gap is still real — enough to not nag, not so much that it's forgotten.

const DISMISS_KEY = '@powr/health_gap_dismissed';

function todayKey(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function isHealthGapDismissedToday(): Promise<boolean> {
    try {
        return (await AsyncStorage.getItem(DISMISS_KEY)) === todayKey();
    } catch {
        return false;
    }
}

export async function dismissHealthGapToday(): Promise<void> {
    try {
        await AsyncStorage.setItem(DISMISS_KEY, todayKey());
    } catch {
        /* non-fatal */
    }
}

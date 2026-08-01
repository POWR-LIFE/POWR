import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { useHealthData, androidExerciseSessionGranted } from '@/hooks/useHealthData';
import { getStepsToday, getStepSourcesToday } from '@/lib/health/walkingSync';
import { classifyProvenance } from '@/lib/health/dataSource';
import {
    detectHealthGap,
    gapCopy,
    resolveHealthGap,
    dismissHealthGapToday,
    isHealthGapDismissedToday,
    type HealthGapKind,
    type HealthGapCopy,
} from '@/lib/health/healthGaps';
import { getSessionUser, supabase } from '@/lib/supabase';
import { useWearableStatus } from '@/hooks/useWearableStatus';

/** A worn-device source wrote data today? (vs phone-only) */
async function wearablePresentToday(): Promise<boolean> {
    try {
        const sources = await getStepSourcesToday();
        return sources.some(p => classifyProvenance(p) === 'wearable');
    } catch {
        return false;
    }
}

/** Did we already capture a workout/exercise session (incl. inferred cardio) today? */
async function hadCapturedWorkoutToday(): Promise<boolean> {
    try {
        const user = await getSessionUser();
        if (!user) return false;
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const { data } = await supabase
            .from('activity_sessions')
            .select('type')
            .eq('user_id', user.id)
            .gte('started_at', start.toISOString());
        return (data ?? []).some(s => s.type !== 'walking' && s.type !== 'sleep');
    } catch {
        return false;
    }
}

/**
 * Detects whether POWR is missing the user's workouts (permission / third-party
 * setting) and exposes a one-tap fix. Powers the home-screen HealthGapBanner.
 * Re-checks on mount and whenever the app returns to the foreground (so the
 * banner clears itself right after the user fixes the setting).
 */
export function useHealthGap() {
    const health = useHealthData();
    const wearable = useWearableStatus();
    const [gap, setGap] = useState<HealthGapKind>('none');

    const check = useCallback(async () => {
        if (await isHealthGapDismissedToday()) { setGap('none'); return; }

        // Web short-circuit: the native probes below don't exist here, but the
        // wearable signal does (pure server state), so evaluate that alone
        // rather than bailing out entirely.
        if (Platform.OS === 'web') {
            setGap(detectHealthGap({
                platform: 'web',
                nativeConnected: false,
                androidExerciseGranted: null,
                wearablePresent: false,
                hadCapturedWorkoutToday: false,
                activeEnergyToday: 0,
                wearableFreshness: wearable.freshness,
            }));
            return;
        }

        const steps = await getStepsToday().catch(() => 0);
        const nativeConnected = steps > 0 || health.isAuthorized;
        // No early return on !nativeConnected any more: a wearable user may have
        // no phone health store connected, and detectHealthGap has to see the
        // wearable signal before it applies that gate.

        const [androidExerciseGranted, wearablePresent, captured, calories] = await Promise.all([
            Platform.OS === 'android' ? androidExerciseSessionGranted().catch(() => null) : Promise.resolve(null),
            wearablePresentToday(),
            hadCapturedWorkoutToday(),
            health.getCaloriesToday().catch(() => null),
        ]);

        setGap(detectHealthGap({
            platform: Platform.OS as 'ios' | 'android' | 'web',
            nativeConnected,
            androidExerciseGranted,
            wearablePresent,
            hadCapturedWorkoutToday: captured,
            activeEnergyToday: calories?.active ?? 0,
            wearableFreshness: wearable.freshness,
        }));
    }, [health.isAuthorized, health.getCaloriesToday, wearable.freshness]);

    useEffect(() => { check(); }, [check]);

    // Re-check when the app comes back to the foreground (e.g. after the user
    // returns from the permission dialog / Health settings).
    useEffect(() => {
        const sub = AppState.addEventListener('change', s => { if (s === 'active') check(); });
        return () => sub.remove();
    }, [check]);

    const copy: HealthGapCopy | null = gapCopy(gap, {
        providerName: wearable.providerName,
        hoursSinceSync: wearable.hoursSinceSync,
    });

    const resolve = useCallback(async () => {
        const maybeFixed = await resolveHealthGap(gap);
        if (maybeFixed) await check();
    }, [gap, check]);

    const dismiss = useCallback(async () => {
        await dismissHealthGapToday();
        setGap('none');
    }, []);

    return { gap, copy, hasGap: gap !== 'none', resolve, dismiss, recheck: check };
}

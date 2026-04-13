import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { getTodayHealthWalkingSession, stepTierPoints, nextStepThreshold } from '@/lib/api/activity';
import { getStepsToday, syncWalkingNow } from '@/lib/health/walkingSync';
import { useHealthData } from './useHealthData';

export type WalkingProgressState = {
    isAvailable: boolean;
    isAuthorized: boolean;
    /** Raw step count read from the health platform today */
    stepsToday: number;
    /** Points already logged in Supabase for today's walking session */
    pointsEarned: number;
    /** Points that will be earned when steps reach the next threshold (0 if already max) */
    pointsAtNext: number;
    /** Next step threshold to hit, or null if already at max (10k) */
    nextThreshold: number | null;
    /** Steps remaining to reach the next threshold */
    stepsToNext: number;
    loading: boolean;
    requestPermissions: () => Promise<boolean>;
    refresh: () => void;
};

export function useWalkingProgress(): WalkingProgressState {
    const health = useHealthData();
    const [stepsToday, setStepsToday] = useState(0);
    const [pointsEarned, setPointsEarned] = useState(0);
    const [loading, setLoading] = useState(true);
    const appState = useRef(AppState.currentState);

    const load = useCallback(async () => {
        if (!health.isAvailable) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            // Try reading steps first — Health Connect may work even if
            // our permission check returned false (race on init).
            const steps = await getStepsToday();
            if (steps > 0) {
                // Steps readable → sync to Supabase
                await syncWalkingNow();
                const session = await getTodayHealthWalkingSession();
                setStepsToday(steps);
                setPointsEarned(session?.points ?? 0);
            } else if (health.isAuthorized) {
                // Authorized but 0 steps — read the DB session anyway
                const session = await getTodayHealthWalkingSession();
                setStepsToday(0);
                setPointsEarned(session?.points ?? 0);
            }
        } catch (e) {
            console.warn('[WalkingProgress] sync failed:', e);
        } finally {
            setLoading(false);
        }
    }, [health.isAvailable, health.isAuthorized]);

    // Load on mount and when permissions change
    useEffect(() => { load(); }, [load]);

    // Re-sync whenever app comes back to foreground
    useEffect(() => {
        if (Platform.OS === 'web') return;
        const sub = AppState.addEventListener('change', (next) => {
            if (appState.current.match(/inactive|background/) && next === 'active') {
                load();
            }
            appState.current = next;
        });
        return () => sub.remove();
    }, [load]);

    const nextThr = nextStepThreshold(stepsToday);
    const stepsToNext = nextThr ? Math.max(0, nextThr - stepsToday) : 0;
    const pointsAtNext = nextThr ? stepTierPoints(nextThr) : 0;

    return {
        isAvailable: health.isAvailable,
        isAuthorized: health.isAuthorized,
        stepsToday,
        pointsEarned,
        pointsAtNext,
        nextThreshold: nextThr,
        stepsToNext,
        loading,
        requestPermissions: health.requestPermissions,
        refresh: load,
    };
}

/**
 * Walking auto-sync: reads today's steps from HealthKit / Health Connect
 * and keeps a single "health_sync" walking session in Supabase up to date.
 *
 * The background task fires opportunistically (~15 min intervals).
 * `syncWalkingNow()` can be called from the foreground at any time.
 */

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import {
    getTodayHealthWalkingSession,
    logHealthWalkingSession,
    updateHealthWalkingSession,
    stepTierPoints,
    updateStreakForToday,
    fetchTodayWalkingPoints,
    saveHealthSnapshot,
    WALKING_DAILY_CAP,
} from '@/lib/api/activity';

export const WALKING_SYNC_TASK = 'powr-walking-sync';

// ── Platform step readers ─────────────────────────────────────────────────────

async function getStepsTodayIOS(): Promise<number> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { default: AppleHealthKit } = require('react-native-health');
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        return new Promise<number>((resolve) => {
            AppleHealthKit.getStepCount(
                { startDate: midnight.toISOString() },
                (err: string, result: { value: number }) => resolve(err ? 0 : (result?.value ?? 0)),
            );
        });
    } catch {
        return 0;
    }
}

async function getStepsTodayAndroid(): Promise<number> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, readRecords } = require('react-native-health-connect');
        await initialize();
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const { records } = await readRecords('Steps', {
            timeRangeFilter: {
                operator: 'between',
                startTime: midnight.toISOString(),
                endTime: new Date().toISOString(),
            },
        });
        return (records as Array<{ count: number }>).reduce((sum, r) => sum + r.count, 0);
    } catch {
        return 0;
    }
}

export async function getStepsToday(): Promise<number> {
    if (Platform.OS === 'ios')     return getStepsTodayIOS();
    if (Platform.OS === 'android') return getStepsTodayAndroid();
    return 0;
}

// ── Core sync logic ───────────────────────────────────────────────────────────

/** Syncs today's step count to Supabase. Safe to call multiple times. */
export async function syncWalkingNow(): Promise<void> {
    const steps = await getStepsToday();
    if (steps === 0) return;

    const tierPoints = stepTierPoints(steps);

    // Enforce daily cap across all walking sources (health-sync + manual)
    const alreadyEarned = await fetchTodayWalkingPoints();
    const capRemaining = Math.max(0, WALKING_DAILY_CAP - alreadyEarned);

    const existing = await getTodayHealthWalkingSession();

    let sessionId: string;

    if (!existing) {
        // First sync of the day — cap the initial award
        const points = Math.min(tierPoints, capRemaining);
        sessionId = await logHealthWalkingSession(steps, points);
    } else {
        // Incremental: only award the tier improvement, capped to remaining
        const additional = Math.min(
            Math.max(0, tierPoints - existing.points),
            capRemaining,
        );
        await updateHealthWalkingSession(existing.id, steps, additional);
        sessionId = existing.id;
    }

    // Save health snapshot with current step count
    const source = Platform.OS === 'ios' ? 'healthkit' : 'health_connect' as const;
    await saveHealthSnapshot({
        sessionId,
        steps,
        activityType: 'walking',
        source,
    });

    // Mark today as an active streak day (idempotent)
    await updateStreakForToday();
}

// ── Background task ───────────────────────────────────────────────────────────

TaskManager.defineTask(WALKING_SYNC_TASK, async () => {
    try {
        await syncWalkingNow();
        return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch {
        return BackgroundFetch.BackgroundFetchResult.Failed;
    }
});

/** Registers the background walking sync task. Call once at app startup. */
export async function registerWalkingSync(): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
        const status = await BackgroundFetch.getStatusAsync();
        if (
            status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
            status === BackgroundFetch.BackgroundFetchStatus.Denied
        ) return;

        const registered = await TaskManager.isTaskRegisteredAsync(WALKING_SYNC_TASK);
        if (!registered) {
            await BackgroundFetch.registerTaskAsync(WALKING_SYNC_TASK, {
                minimumInterval: 15 * 60, // 15 minutes
                stopOnTerminate: false,
                startOnBoot: true,
            });
        }
    } catch {
        // Background fetch not available in this environment (e.g. simulator)
    }
}

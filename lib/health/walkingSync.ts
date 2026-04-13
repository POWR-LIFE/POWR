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
import {
    getNativeProviderId,
    getProvider,
    HealthProviderNotImplementedError,
    type HealthProviderId,
} from '@/lib/health/providers';
import { supabase } from '@/lib/supabase';

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

/** Format a Date as a local-time ISO-like string (no trailing Z) for Health Connect. */
function toLocalISOString(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

async function getStepsTodayAndroid(): Promise<number> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, readRecords } = require('react-native-health-connect');
        await initialize();
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const now = new Date();
        const startTime = midnight.toISOString();
        const endTime = now.toISOString();
        console.log(`[walkingSync] Reading steps from ${startTime} to ${endTime}`);
        const result = await readRecords('Steps', {
            timeRangeFilter: {
                operator: 'between',
                startTime,
                endTime,
            },
        });
        const records = result?.records ?? [];
        const total = (records as Array<{ count: number }>).reduce((sum, r) => sum + r.count, 0);
        console.log(`[walkingSync] Android steps today: ${total} (${records.length} records)`);
        return total;
    } catch (e) {
        console.warn('[walkingSync] Android getStepsToday failed:', e);
        return 0;
    }
}

export async function getStepsToday(): Promise<number> {
    if (Platform.OS === 'ios')     return getStepsTodayIOS();
    if (Platform.OS === 'android') return getStepsTodayAndroid();
    return 0;
}

/** Reads `profiles.active_health_provider`, falls back to the native provider for this OS. */
async function resolveActiveProviderId(): Promise<HealthProviderId | null> {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return getNativeProviderId();
        const { data } = await supabase
            .from('profiles')
            .select('active_health_provider')
            .eq('id', user.id)
            .single<{ active_health_provider: HealthProviderId | null }>();
        return data?.active_health_provider ?? getNativeProviderId();
    } catch {
        return getNativeProviderId();
    }
}

/** Snapshot source label written alongside each sync. */
function snapshotSourceFor(id: HealthProviderId | null): 'healthkit' | 'health_connect' | 'fitbit' | 'whoop' | 'garmin' {
    switch (id) {
        case 'apple-health':   return 'healthkit';
        case 'health-connect': return 'health_connect';
        case 'fitbit':         return 'fitbit';
        case 'whoop':          return 'whoop';
        case 'garmin':         return 'garmin';
        default:               return Platform.OS === 'ios' ? 'healthkit' : 'health_connect';
    }
}

// ── Core sync logic ───────────────────────────────────────────────────────────

/** Syncs today's step count to Supabase. Safe to call multiple times. */
export async function syncWalkingNow(): Promise<void> {
    const activeId = await resolveActiveProviderId();
    let steps = 0;
    if (activeId) {
        try {
            steps = await getProvider(activeId).getStepsToday();
        } catch (e) {
            if (e instanceof HealthProviderNotImplementedError) {
                console.log(`[walkingSync] active provider ${activeId} not implemented yet, falling back to native`);
                steps = await getStepsToday();
            } else {
                throw e;
            }
        }
    } else {
        steps = await getStepsToday();
    }
    console.log(`[walkingSync] syncWalkingNow: ${steps} steps from ${activeId ?? Platform.OS}`);
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
        const newId = await logHealthWalkingSession(steps, points);
        if (!newId) {
            // Constraint conflict — re-fetch the existing session and update it
            const refetched = await getTodayHealthWalkingSession();
            if (!refetched) return;
            await updateHealthWalkingSession(refetched.id, steps, 0);
            sessionId = refetched.id;
        } else {
            sessionId = newId;
        }
    } else {
        // Incremental: only award the tier improvement, capped to remaining
        const additional = Math.min(
            Math.max(0, tierPoints - existing.points),
            capRemaining,
        );
        await updateHealthWalkingSession(existing.id, steps, additional);
        sessionId = existing.id;
    }

    // Save health snapshot with current step count, tagged with the active provider.
    await saveHealthSnapshot({
        sessionId,
        steps,
        activityType: 'walking',
        source: snapshotSourceFor(activeId),
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

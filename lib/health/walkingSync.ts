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
    saveDailyStepWindows,
    WALKING_DAILY_CAP,
} from '@/lib/api/activity';
import {
    getNativeProviderId,
    getProvider,
    HealthProviderNotImplementedError,
    verificationForProvider,
    type HealthProviderId,
} from '@/lib/health/providers';
import { verificationFromProvenances, summarizeSources, type HealthDataProvenance } from '@/lib/health/dataSource';
import { getInferredRunWindowsToday } from '@/lib/health/runInference';
import { supabase } from '@/lib/supabase';

export const WALKING_SYNC_TASK = 'powr-walking-sync';

// ── Platform step readers ─────────────────────────────────────────────────────

async function getStepsTodayIOS(): Promise<number> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const HK = require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        // Cumulative-sum statistics query de-dupes overlapping samples across sources
        // the way Apple's Health app does, so the value we sync matches what the user sees.
        const res = await HK.queryStatisticsForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], {
            filter: { date: { startDate: midnight, endDate: new Date() } },
            unit: 'count',
        });
        return Math.round(res.sumQuantity?.quantity ?? 0);
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

// ── Step provenance (which app/device recorded today's steps) ─────────────────
// Read separately from the step *count* above: the count uses a de-duped
// statistics query (no per-source breakdown), so to learn the sources we read the
// raw samples. Used only to label walking sessions wearable-vs-phone — never for
// point math — so it's best-effort and returns [] on any failure.

async function getStepSourcesTodayIOS(): Promise<HealthDataProvenance[]> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const HK = require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const samples = await HK.queryQuantitySamples('HKQuantityTypeIdentifierStepCount', {
            filter: { date: { startDate: midnight, endDate: new Date() } },
            limit: 0, // non-positive = fetch all samples
            unit: 'count',
        });
        return samples.map(s => ({
            platform: 'ios' as const,
            sourceBundleId: s.sourceRevision?.source?.bundleIdentifier,
            sourceName: s.sourceRevision?.source?.name,
            deviceName: s.device?.name,
            deviceModel: s.device?.model,
            deviceHardware: s.device?.hardwareVersion,
            deviceManufacturer: s.device?.manufacturer,
        }));
    } catch {
        return [];
    }
}

async function getStepSourcesTodayAndroid(): Promise<HealthDataProvenance[]> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, readRecords } = require('react-native-health-connect');
        await initialize();
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const result = await readRecords('Steps', {
            timeRangeFilter: { operator: 'between', startTime: midnight.toISOString(), endTime: new Date().toISOString() },
        });
        const records = (result?.records ?? []) as Array<{ metadata?: { dataOrigin?: string; device?: { type?: number } } }>;
        return records.map(r => ({
            platform: 'android' as const,
            dataOrigin: r.metadata?.dataOrigin,
            deviceType: r.metadata?.device?.type,
        }));
    } catch {
        return [];
    }
}

/** Distinct provenance of today's step samples (native store only). */
export async function getStepSourcesToday(): Promise<HealthDataProvenance[]> {
    if (Platform.OS === 'ios')     return getStepSourcesTodayIOS();
    if (Platform.OS === 'android') return getStepSourcesTodayAndroid();
    return [];
}

// ── Windowed step readers (intraday challenges) ───────────────────────────────

async function getStepsInRangeIOS(start: Date, end: Date): Promise<number> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const HK = require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');
        const res = await HK.queryStatisticsForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], {
            filter: { date: { startDate: start, endDate: end } },
            unit: 'count',
        });
        return Math.round(res.sumQuantity?.quantity ?? 0);
    } catch {
        return 0;
    }
}

async function getStepsInRangeAndroid(start: Date, end: Date): Promise<number> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, readRecords } = require('react-native-health-connect');
        await initialize();
        const result = await readRecords('Steps', {
            timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
        });
        const records = result?.records ?? [];
        return (records as Array<{ count: number }>).reduce((sum, r) => sum + r.count, 0);
    } catch {
        return 0;
    }
}

function getStepsInRange(start: Date, end: Date): Promise<number> {
    if (start >= end) return Promise.resolve(0);
    if (Platform.OS === 'ios')     return getStepsInRangeIOS(start, end);
    if (Platform.OS === 'android') return getStepsInRangeAndroid(start, end);
    return Promise.resolve(0);
}

/** Local YYYY-MM-DD for `d`. */
function localDateKey(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function atLocalHour(base: Date, hour: number): Date {
    const d = new Date(base);
    d.setHours(hour, 0, 0, 0);
    return d;
}

/**
 * Reads today's intraday step windows from the native health store and upserts
 * them. Windows are capped at "now" so partial days report only elapsed steps.
 */
export async function syncStepWindowsNow(): Promise<void> {
    if (Platform.OS === 'web') return;
    const now = new Date();
    const before9am = await getStepsInRange(atLocalHour(now, 0), new Date(Math.min(+atLocalHour(now, 9), +now)));
    const midday = await getStepsInRange(
        new Date(Math.min(+atLocalHour(now, 12), +now)),
        new Date(Math.min(+atLocalHour(now, 14), +now)),
    );
    const evening = await getStepsInRange(new Date(Math.min(+atLocalHour(now, 18), +now)), now);

    if (before9am === 0 && midday === 0 && evening === 0) return;
    await saveDailyStepWindows({
        date: localDateKey(now),
        before9am,
        midday12to14: midday,
        after6pm: evening,
    });
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

// Single-flight guard: foreground (useWalkingProgress) and the ~15-min background
// task can both call syncWalkingNow. Without coordination, two concurrent runs each
// read the same stale today-points, both compute the same incremental award, and
// both insert — producing the duplicate point_transactions seen in prod (the
// sub-millisecond [2,2] / [3,3] rows). Coalescing concurrent callers onto one
// in-flight promise serialises the read-modify-write. NOTE: this only guards within
// a single JS context; the background task can run in a separate context, so it is
// not a substitute for a server-side atomic award (tracked as a follow-up).
let _walkingSyncInFlight: Promise<void> | null = null;

/** Syncs today's step count to Supabase. Safe to call multiple times. */
export function syncWalkingNow(): Promise<void> {
    if (_walkingSyncInFlight) {
        console.log('[walkingSync] sync already in flight — joining existing run.');
        return _walkingSyncInFlight;
    }
    _walkingSyncInFlight = _syncWalkingNowImpl().finally(() => { _walkingSyncInFlight = null; });
    return _walkingSyncInFlight;
}

async function _syncWalkingNowImpl(): Promise<void> {
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

    // Per-sample provenance — read once (native store only; OAuth providers carry
    // no inspectable source) and reused for both the verification label and the
    // admin "who's on what" snapshot detail.
    const baseVerification = verificationForProvider(activeId);
    const usedNativeStore = !activeId || activeId === 'apple-health' || activeId === 'health-connect';
    const stepSources = baseVerification !== 'wearable' && usedNativeStore
        ? await getStepSourcesToday().catch(() => [])
        : [];
    const verification = verificationFromProvenances(stepSources, baseVerification);
    const sourceDetail = summarizeSources(stepSources);

    // De-dup vs inferred runs: a Garmin/wearable run mirrors its distance into
    // Apple Health and its steps fold into the day's total above. useHealthSync
    // logs that as a separate run session, so excluding the run windows' steps
    // here stops the same effort being paid as walking *and* as a run. The
    // displayed step count (saved below) stays the full daily total; only the
    // point tier is computed on the non-run steps.
    let walkingSteps = steps;
    if (usedNativeStore && Platform.OS === 'ios') {
        const runWindows = await getInferredRunWindowsToday().catch(() => []);
        for (const w of runWindows) {
            walkingSteps -= await getStepsInRange(w.start, w.end);
        }
        walkingSteps = Math.max(0, walkingSteps);
    }

    const tierPoints = stepTierPoints(walkingSteps);

    // Enforce daily cap across all walking sources (health-sync + manual)
    const alreadyEarned = await fetchTodayWalkingPoints();
    const capRemaining = Math.max(0, WALKING_DAILY_CAP - alreadyEarned);

    const existing = await getTodayHealthWalkingSession();

    let sessionId: string;

    if (!existing) {
        // First sync of the day — cap the initial award
        const points = Math.min(tierPoints, capRemaining);
        const newId = await logHealthWalkingSession(steps, points, verification);
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
        sourceDetail,
    });

    // Mark today as an active streak day (idempotent)
    await updateStreakForToday();

    // Record intraday step windows for time-of-day walking challenges.
    await syncStepWindowsNow();
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

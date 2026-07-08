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
    verificationForProvider,
    type HealthProviderId,
} from '@/lib/health/providers';
import { verificationFromProvenances, summarizeSources, type HealthDataProvenance } from '@/lib/health/dataSource';
import { getInferredRunWindowsToday } from '@/lib/health/runInference';
import { getSessionUser, supabase } from '@/lib/supabase';

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
        const { initialize, aggregateRecord, readRecords } = require('react-native-health-connect');
        await initialize();
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const timeRangeFilter = {
            operator: 'between' as const,
            startTime: midnight.toISOString(),
            endTime: new Date().toISOString(),
        };
        // Health Connect's aggregate API de-dupes overlapping samples across apps
        // (phone pedometer + a wearable app mirroring the same steps) using the
        // OS priority order — summing raw records would double-count them.
        try {
            const agg = await aggregateRecord({ recordType: 'Steps', timeRangeFilter });
            if (typeof agg?.COUNT_TOTAL === 'number') {
                console.log(`[walkingSync] Android steps today (aggregate): ${agg.COUNT_TOTAL}`);
                return agg.COUNT_TOTAL;
            }
        } catch (e) {
            console.warn('[walkingSync] aggregateRecord failed, falling back to raw sum:', e);
        }
        const result = await readRecords('Steps', { timeRangeFilter });
        const records = result?.records ?? [];
        const total = (records as Array<{ count: number }>).reduce((sum, r) => sum + r.count, 0);
        console.log(`[walkingSync] Android steps today (raw sum): ${total} (${records.length} records)`);
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
        const { initialize, aggregateRecord, readRecords } = require('react-native-health-connect');
        await initialize();
        const timeRangeFilter = { operator: 'between' as const, startTime: start.toISOString(), endTime: end.toISOString() };
        // Aggregate de-dupes overlapping samples across apps (see getStepsTodayAndroid).
        try {
            const agg = await aggregateRecord({ recordType: 'Steps', timeRangeFilter });
            if (typeof agg?.COUNT_TOTAL === 'number') return agg.COUNT_TOTAL;
        } catch {
            // fall through to raw sum
        }
        const result = await readRecords('Steps', { timeRangeFilter });
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
        const user = await getSessionUser();
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

    // Walking is native-first: the phone's health store is the fastest source
    // (local read, no cloud round-trip) and wearable companion apps mirror
    // their step counts into HealthKit / Health Connect anyway. Terra's `daily`
    // webhook stays as a server-side top-up — handleDaily updates the same
    // per-day session and only awards the tier delta when the wearable reported
    // more steps than the phone saw.
    const steps = await getStepsToday();
    console.log(`[walkingSync] syncWalkingNow: ${steps} steps (native store, active=${activeId ?? Platform.OS})`);
    if (steps === 0) return;

    // Per-sample provenance — read once (native store only) and reused for both
    // the verification label and the admin "who's on what" snapshot detail.
    const baseVerification = verificationForProvider(activeId);
    const stepSources = baseVerification !== 'wearable'
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
    if (Platform.OS === 'ios') {
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

// ── Multi-day backfill ────────────────────────────────────────────────────────
// syncWalkingNow only ever reads *today* (midnight→now), so a day the app isn't
// opened on — and iOS background fetch is throttled hard, especially when the app
// is force-quit — never gets a walking session, even though the phone's pedometer
// keeps writing those steps to HealthKit / Health Connect forever. This catches
// those days up: for each recent day with no session yet, read that day's total
// from the native store and record it. Idempotent — the per-day unique index
// no-ops days already present (logHealthWalkingSession returns null on conflict).

// Run once per JS context: cheap to repeat (the unique index dedups), but no need
// to re-scan a week of history on every foreground. Reset on failure so a later
// trigger can retry.
let _backfilledThisSession = false;

/** Local midnight `i` days before today. */
function startOfDaysAgo(i: number): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    return d;
}

/**
 * Backfills walking sessions for the last `daysBack` days the app missed.
 * Best-effort and safe to call repeatedly. Phone-store read, so it covers the
 * phone-only users who have no wearable cloud push to top them up server-side.
 */
export async function backfillWalkingDays(daysBack = 7): Promise<void> {
    if (Platform.OS === 'web') return;
    if (_backfilledThisSession) return;
    _backfilledThisSession = true;
    try {
        const activeId = await resolveActiveProviderId();
        const verification = verificationForProvider(activeId);
        const source = snapshotSourceFor(activeId);

        for (let i = 1; i <= daysBack; i++) {
            const dayStart = startOfDaysAgo(i);
            const dayEnd = startOfDaysAgo(i - 1); // next local midnight

            const steps = await getStepsInRange(dayStart, dayEnd);
            if (steps <= 0) continue;

            // No run-window subtraction here: the affected population is phone-only
            // (a wearable cloud push would have topped these days up server-side),
            // so there are no inferred runs to double-pay against. Cap as usual.
            const points = Math.min(stepTierPoints(steps), WALKING_DAILY_CAP);
            const sessionId = await logHealthWalkingSession(
                steps, points, verification, dayStart.toISOString(), dayEnd.toISOString(),
            );
            if (!sessionId) continue; // day already recorded — unique index conflict

            await saveHealthSnapshot({ sessionId, steps, activityType: 'walking', source });
            console.log(`[walkingSync] backfilled ${localDateKey(dayStart)}: ${steps} steps → ${points} pts`);
        }
    } catch (e) {
        console.warn('[walkingSync] backfill failed:', e);
        _backfilledThisSession = false; // allow a retry on the next trigger
    }
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

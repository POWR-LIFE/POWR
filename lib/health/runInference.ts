/**
 * Activity inference from native health *metric* samples.
 *
 * Some wearables — notably Garmin — mirror their metrics (distance, heart rate,
 * active energy) into Apple Health but never write an `HKWorkout` object. POWR's
 * normal detection reads workouts only (`queryWorkoutSamples`), so those efforts
 * are invisible: the distance silently folds into the user's daily step/walking
 * total and no session is created.
 *
 * Since Garmin's API is closed to us, Apple Health is the only channel. This
 * module reconstructs the *distance-based* activities — running, cycling,
 * swimming — from the timestamped distance the wearable did write. Each of those
 * lives in its own HealthKit distance type, so the type is self-identifying, and
 * average pace separates e.g. a run from a brisk walk. We isolate wearable-sourced
 * samples (same provenance classifier as the rest of the app), stitch contiguous
 * ones into an effort, and pace-gate it.
 *
 * Deliberately NOT inferred here: gym / HIIT / sports / dance / yoga. With no
 * distance they're metric-identical to one another ("HR up, calories burned"),
 * so auto-typing them would be guesswork — unacceptable in a rewards context.
 * Gym stays geofence-verified; the rest stay manual.
 *
 * Caveats:
 *  - Heuristic, not a real workout — pace is the only run/walk discriminator, so
 *    gates are conservative (bias to misses; a false positive both pays a phantom
 *    session AND docks walking credit via the walkingSync de-dup).
 *  - iOS only. Garmin doesn't write to Android Health Connect at all.
 *  - Reliability depends on how granular the wearable's distance samples are —
 *    tune GROUP_GAP_MS / the per-activity gates against real data (Health →
 *    <distance type> → Show All Data).
 */

import { Platform } from 'react-native';

import type { ActivityType } from '@/constants/activities';
import { classifyProvenance, type HealthDataProvenance } from './dataSource';

export type InferredActivity = {
    type: ActivityType;          // 'running' | 'cycling' | 'swimming'
    startedAt: string;           // ISO
    endedAt: string;             // ISO
    durationMin: number;
    distanceM: number;
    avgSpeedKmh: number;
    /** Provenance of the effort (writing app/device) — for the verification label. */
    source?: HealthDataProvenance;
};

export type RawDistanceSample = { start: Date; end: Date; meters: number; prov: HealthDataProvenance };

type HKDistanceType =
    | 'HKQuantityTypeIdentifierDistanceWalkingRunning'
    | 'HKQuantityTypeIdentifierDistanceCycling'
    | 'HKQuantityTypeIdentifierDistanceSwimming';

/** Detection gate for one distance-based activity. */
export type ActivityGate = {
    type: ActivityType;
    hkDistanceType: HKDistanceType;
    minDistanceM: number;
    minDurationMin: number;
    minSpeedKmh: number;
    maxSpeedKmh: number;
};

// Merge distance samples less than this apart into a single effort.
const GROUP_GAP_MS = 5 * 60 * 1000;

// Conservative, tunable. Detection mins sit below the points minDuration in
// constants/activities (run 15 / cycle 20 / swim 15) on purpose: a sub-threshold
// effort still gets a (0-point) session so it counts toward streaks/active days,
// matching how the workout-sync path already behaves.
export const RUNNING_GATE: ActivityGate = {
    type: 'running',
    hkDistanceType: 'HKQuantityTypeIdentifierDistanceWalkingRunning',
    minDistanceM: 1500, minDurationMin: 6, minSpeedKmh: 8, maxSpeedKmh: 25,
};
export const CYCLING_GATE: ActivityGate = {
    type: 'cycling',
    hkDistanceType: 'HKQuantityTypeIdentifierDistanceCycling',
    minDistanceM: 3000, minDurationMin: 10, minSpeedKmh: 12, maxSpeedKmh: 60,
};
export const SWIMMING_GATE: ActivityGate = {
    type: 'swimming',
    hkDistanceType: 'HKQuantityTypeIdentifierDistanceSwimming',
    minDistanceM: 400, minDurationMin: 8, minSpeedKmh: 1.5, maxSpeedKmh: 8,
};

const DISTANCE_GATES: ActivityGate[] = [RUNNING_GATE, CYCLING_GATE, SWIMMING_GATE];

/** Build the provenance shape `dataSource` understands from a HealthKit sample. */
function iosProvenance(s: {
    sourceRevision?: { source?: { bundleIdentifier?: string; name?: string } };
    device?: { name?: string; model?: string; hardwareVersion?: string; manufacturer?: string };
}): HealthDataProvenance {
    return {
        platform: 'ios',
        sourceBundleId: s.sourceRevision?.source?.bundleIdentifier,
        sourceName: s.sourceRevision?.source?.name,
        deviceName: s.device?.name,
        deviceModel: s.device?.model,
        deviceHardware: s.device?.hardwareVersion,
        deviceManufacturer: s.device?.manufacturer,
    };
}

/** How many days back the week-backfill looks (matches sleep/getWeekHistory). */
export const INFERENCE_LOOKBACK_DAYS = 7;

async function getWearableDistanceSamplesIOS(hkType: HKDistanceType, start: Date, end: Date): Promise<RawDistanceSample[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const HK = require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');
    const samples = await HK.queryQuantitySamples(hkType, {
        filter: { date: { startDate: start, endDate: end } },
        limit: 0, // non-positive = all samples
        unit: 'm',
    });
    return samples.map(s => ({
        start: s.startDate,
        end: s.endDate,
        meters: s.quantity,
        prov: iosProvenance(s),
    }));
}

/** Stitch contiguous wearable-sourced distance samples into efforts and pace-gate them.
 *  Exported for unit testing — the native readers above can't run off-device. */
export function buildEfforts(samples: RawDistanceSample[], gate: ActivityGate): InferredActivity[] {
    // Only consider samples a worn device wrote (Garmin et al.). Phone-sourced
    // distance is excluded — we never infer an activity from the iPhone sensors.
    const wearable = samples
        .filter(s => s.meters > 0 && classifyProvenance(s.prov) === 'wearable')
        .sort((a, b) => +a.start - +b.start);

    type Group = { start: Date; end: Date; meters: number; prov: HealthDataProvenance };
    const groups: Group[] = [];
    for (const s of wearable) {
        const g = groups[groups.length - 1];
        if (g && +s.start - +g.end <= GROUP_GAP_MS) {
            g.end = new Date(Math.max(+g.end, +s.end));
            g.meters += s.meters;
        } else {
            groups.push({ start: s.start, end: new Date(s.end), meters: s.meters, prov: s.prov });
        }
    }

    const out: InferredActivity[] = [];
    for (const g of groups) {
        const durMs = +g.end - +g.start;
        if (durMs <= 0) continue;
        const durationMin = durMs / 60000;
        const avgSpeedKmh = (g.meters / 1000) / (durMs / 3600000);
        if (
            g.meters >= gate.minDistanceM &&
            durationMin >= gate.minDurationMin &&
            avgSpeedKmh >= gate.minSpeedKmh &&
            avgSpeedKmh <= gate.maxSpeedKmh
        ) {
            out.push({
                type: gate.type,
                startedAt: g.start.toISOString(),
                endedAt: g.end.toISOString(),
                durationMin: Math.round(durationMin),
                distanceM: Math.round(g.meters),
                avgSpeedKmh: Math.round(avgSpeedKmh * 10) / 10,
                source: g.prov,
            });
        }
    }
    return out;
}

/**
 * Distance-based activities (running, cycling, swimming) inferred from wearable
 * distance over [start, end] — used for the multi-day backfill so an effort that
 * reached Apple Health late (Garmin's delayed sync, or the app being closed across
 * midnight) still gets captured. Empty on Android/web and on any read failure.
 */
export async function getInferredActivitiesInRange(start: Date, end: Date): Promise<InferredActivity[]> {
    if (Platform.OS !== 'ios') return []; // Garmin doesn't write to Health Connect
    const out: InferredActivity[] = [];
    for (const gate of DISTANCE_GATES) {
        try {
            const samples = await getWearableDistanceSamplesIOS(gate.hkDistanceType, start, end);
            out.push(...buildEfforts(samples, gate));
        } catch (e) {
            console.warn(`[runInference] failed to infer ${gate.type}:`, e);
        }
    }
    return out;
}

function startOfTodayLocal(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function startOfLookback(): Date {
    const d = new Date();
    d.setDate(d.getDate() - (INFERENCE_LOOKBACK_DAYS - 1));
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Today's inferred activities. */
export function getInferredActivitiesToday(): Promise<InferredActivity[]> {
    return getInferredActivitiesInRange(startOfTodayLocal(), new Date());
}

/** Inferred activities across the lookback window (today + previous days). */
export function getInferredActivitiesForWeek(): Promise<InferredActivity[]> {
    return getInferredActivitiesInRange(startOfLookback(), new Date());
}

/**
 * Just the [start, end] windows of today's inferred RUNS. Used by walkingSync to
 * subtract those steps from the walking point tier so a run isn't paid twice.
 * (Cycling/swimming don't contribute to the step pool, so only runs need de-dup.)
 */
export async function getInferredRunWindowsToday(): Promise<{ start: Date; end: Date }[]> {
    if (Platform.OS !== 'ios') return [];
    try {
        const samples = await getWearableDistanceSamplesIOS(RUNNING_GATE.hkDistanceType, startOfTodayLocal(), new Date());
        return buildEfforts(samples, RUNNING_GATE).map(r => ({
            start: new Date(r.startedAt),
            end: new Date(r.endedAt),
        }));
    } catch {
        return [];
    }
}

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { classifyProvenance, type HealthDataProvenance } from '@/lib/health/dataSource';

function toLocalISO(d: Date): string {
    return d.toISOString();
}

export type VerifyResult = {
    verified: boolean;
    actualValue: number;
    detail: string;
};

export type HealthActivity = {
    type: string;
    startedAt: string;
    durationMin: number;
    distanceM?: number;
    steps?: number;
    hrAvg?: number;
    calories?: number;
    /** Which app/device wrote this sample — used to classify wearable vs phone. */
    source?: HealthDataProvenance;
    /** Provider-reported activity name before bucketing (e.g. "Strength Training"). */
    rawName?: string;
};

export type SleepSession = {
    startedAt: string;
    endedAt: string;
    durationHours: number;
    deepHours?: number;
    remHours?: number;
    lightHours?: number;
};

export type HeartRateSummary = {
    avg: number;
    max: number;
    resting: number;
};

export type CalorieSummary = {
    active: number;
    total: number;
};

/** A full day's health summary — all metrics for a single date. */
export type DayHealthSummary = {
    date: string;               // YYYY-MM-DD
    steps: number;
    activities: HealthActivity[];
    sleep: SleepSession | null;
    heartRate: HeartRateSummary | null;
    calories: CalorieSummary | null;
};

export type HealthDataHook = {
    isAvailable: boolean;
    isAuthorized: boolean;
    requesting: boolean;
    requestPermissions: () => Promise<boolean>;
    getStepsToday: () => Promise<number>;
    getActivitiesToday: () => Promise<HealthActivity[]>;
    getLastNightSleep: () => Promise<SleepSession | null>;
    getHeartRateToday: () => Promise<HeartRateSummary | null>;
    getCaloriesToday: () => Promise<CalorieSummary | null>;
    getWeekHistory: () => Promise<DayHealthSummary[]>;
    verifyWalking: (claimedSteps: number) => Promise<VerifyResult>;
    verifyWorkout: (activityType: string, durationMinutes: number) => Promise<VerifyResult>;
};

// ── Provenance builders (which app/device wrote a sample) ────────────────────

/** Build provenance from a HealthKit sample's sourceRevision + device. */
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

/** Build provenance from a Health Connect record's metadata. */
function androidProvenance(r: {
    metadata?: { dataOrigin?: string; device?: { type?: number } };
}): HealthDataProvenance {
    return {
        platform: 'android',
        dataOrigin: r.metadata?.dataOrigin,
        deviceType: r.metadata?.device?.type,
    };
}

// Sleep is wearable-only: only count sleep written by a worn device (Apple Watch,
// Garmin / Oura / etc.) — never the phone's own Sleep Schedule estimates or a
// non-wearable app. The phone-generated "asleep" samples HealthKit/Health Connect
// expose look identical to wearable sleep apart from their provenance, so we gate on
// that, mirroring the steps/activity classification (see lib/health/dataSource).
function isWearableIOSSample(s: Parameters<typeof iosProvenance>[0]): boolean {
    return classifyProvenance(iosProvenance(s)) === 'wearable';
}
function isWearableAndroidRecord(r: Parameters<typeof androidProvenance>[0]): boolean {
    return classifyProvenance(androidProvenance(r)) === 'wearable';
}

// ── iOS (HealthKit via @kingstinct/react-native-healthkit) ───────────────────

// Lazy import helper — avoids requiring the module on Android/web at module load time
function getHK() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');
}

const HK_READ_PERMISSIONS = [
    'HKQuantityTypeIdentifierStepCount',
    'HKQuantityTypeIdentifierDistanceWalkingRunning',
    // Cycling/swimming distance — read by the run/cycle/swim inference
    // (lib/health/runInference.ts). Without these, HealthKit returns empty for
    // those types and inferred rides/swims silently never appear.
    'HKQuantityTypeIdentifierDistanceCycling',
    'HKQuantityTypeIdentifierDistanceSwimming',
    'HKWorkoutTypeIdentifier',
    'HKCategoryTypeIdentifierSleepAnalysis',
    'HKQuantityTypeIdentifierHeartRate',
    'HKQuantityTypeIdentifierActiveEnergyBurned',
    'HKQuantityTypeIdentifierBasalEnergyBurned',
    'HKQuantityTypeIdentifierRestingHeartRate',
] as const;

export async function iosRequestPermissions(): Promise<boolean> {
    try {
        const HK = getHK();
        return await HK.requestAuthorization({ toRead: HK_READ_PERMISSIONS });
    } catch (e) {
        console.warn('Failed to initialize Apple HealthKit:', e);
        return false;
    }
}

async function iosGetStepsToday(): Promise<number> {
    try {
        const HK = getHK();
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        // Use a cumulative-sum statistics query, not a raw sample sum. HKStatisticsQuery
        // de-duplicates overlapping samples across sources (iPhone + any 3rd-party step
        // apps) exactly like Apple's Health app, so this matches what the user sees.
        const res = await HK.queryStatisticsForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], {
            filter: { date: { startDate: midnight, endDate: new Date() } },
            unit: 'count',
        });
        return Math.round(res.sumQuantity?.quantity ?? 0);
    } catch (e) {
        console.warn('Failed to read Apple HealthKit steps:', e);
        return 0;
    }
}

// Maps HKWorkoutActivityType numeric values to POWR activity type strings.
// Full enum: https://developer.apple.com/documentation/healthkit/hkworkoutactivitytype
const HK_WORKOUT_TYPE_MAP: Record<number, string> = {
    6:  'sports',          // basketball
    8:  'sports',          // boxing
    9:  'gym',             // climbing
    11: 'gym',             // crossTraining
    13: 'cycling',
    14: 'dance',           // dance
    16: 'gym',             // elliptical
    18: 'sports',          // fencing
    20: 'gym',             // functionalStrengthTraining
    22: 'sports',          // gymnastics
    23: 'sports',          // handball
    24: 'walking',         // hiking
    28: 'sports',          // martialArts
    29: 'yoga',            // mindAndBody
    30: 'hiit',            // mixedMetabolicCardioTraining
    34: 'sports',          // racquetball
    35: 'gym',             // rowing
    37: 'running',
    39: 'sports',          // skatingSports
    41: 'sports',          // soccer
    43: 'sports',          // squash
    44: 'gym',             // stairClimbing
    45: 'sports',          // surfingSports
    46: 'swimming',
    47: 'sports',          // tableTennis
    48: 'sports',          // tennis
    49: 'running',         // trackAndField
    50: 'gym',             // traditionalStrengthTraining
    51: 'sports',          // volleyball
    52: 'walking',
    53: 'swimming',        // waterFitness
    57: 'yoga',
    58: 'yoga',            // barre
    59: 'gym',             // coreTraining
    60: 'sports',          // crossCountrySkiing
    61: 'sports',          // downhillSkiing
    63: 'hiit',            // highIntensityIntervalTraining
    64: 'hiit',            // jumpRope
    65: 'hiit',            // kickboxing
    66: 'yoga',            // pilates
    67: 'sports',          // snowboarding
    68: 'gym',             // stairs
    69: 'gym',             // stepTraining
    72: 'yoga',            // taiChi
    73: 'hiit',            // mixedCardio
    74: 'cycling',         // handCycling
    77: 'dance',           // cardioDance (iOS 14+)
    78: 'dance',           // socialDance (iOS 14+)
    79: 'sports',          // pickleball (iOS 16+)
};

// Human-readable names for the same HKWorkoutActivityType ints, preserved on
// each activity as `rawName` so the bucketing above stays lossless downstream
// (stored in activity_sessions.raw_activity_name, shown as a feed subtitle).
const HK_WORKOUT_NAME_MAP: Record<number, string> = {
    6:  'Basketball',
    8:  'Boxing',
    9:  'Climbing',
    11: 'Cross Training',
    13: 'Cycling',
    14: 'Dance',
    16: 'Elliptical',
    18: 'Fencing',
    20: 'Functional Strength Training',
    22: 'Gymnastics',
    23: 'Handball',
    24: 'Hiking',
    28: 'Martial Arts',
    29: 'Mind & Body',
    30: 'Mixed Metabolic Cardio',
    34: 'Racquetball',
    35: 'Rowing',
    37: 'Running',
    39: 'Skating',
    41: 'Soccer',
    43: 'Squash',
    44: 'Stair Climbing',
    45: 'Surfing',
    46: 'Swimming',
    47: 'Table Tennis',
    48: 'Tennis',
    49: 'Track & Field',
    50: 'Strength Training',
    51: 'Volleyball',
    52: 'Walking',
    53: 'Water Fitness',
    57: 'Yoga',
    58: 'Barre',
    59: 'Core Training',
    60: 'Cross Country Skiing',
    61: 'Downhill Skiing',
    63: 'HIIT',
    64: 'Jump Rope',
    65: 'Kickboxing',
    66: 'Pilates',
    67: 'Snowboarding',
    68: 'Stairs',
    69: 'Step Training',
    72: 'Tai Chi',
    73: 'Mixed Cardio',
    74: 'Hand Cycling',
    77: 'Cardio Dance',
    78: 'Social Dance',
    79: 'Pickleball',
};

async function iosGetActivitiesToday(): Promise<HealthActivity[]> {
    try {
        const HK = getHK();
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const workouts = await HK.queryWorkoutSamples({
            filter: { date: { startDate: midnight, endDate: new Date() } },
            limit: -1,
        });
        return workouts.map(w => ({
            type: HK_WORKOUT_TYPE_MAP[w.workoutActivityType as number] ?? 'other',
            startedAt: w.startDate.toISOString(),
            durationMin: Math.round(w.duration.quantity / 60),
            distanceM: w.totalDistance ? Math.round(w.totalDistance.quantity) : undefined,
            source: iosProvenance(w),
            rawName: HK_WORKOUT_NAME_MAP[w.workoutActivityType as number],
        }));
    } catch (e) {
        console.warn('Failed to read Apple HealthKit workouts:', e);
        return [];
    }
}

// ── Sleep aggregation (overlap-safe) ─────────────────────────────────────────
// Sleep can be written by several sources for the same night (Apple Watch + a
// sleep app, or iPhone "in-bed" overlapping watch stages). Summing every sample
// naively double-counts the overlap and produces impossible nights (observed up
// to 15.2 h). We instead merge overlapping intervals into a union before summing,
// so each minute of sleep is counted once.

type SleepStage = 'deep' | 'rem' | 'light';
type StagedInterval = { start: number; end: number; stage: SleepStage };

/** Total length (ms) of the union of intervals — overlaps counted once. */
function mergeIntervalMs(intervals: { start: number; end: number }[]): number {
    if (intervals.length === 0) return 0;
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    let total = 0;
    let curStart = sorted[0].start;
    let curEnd = sorted[0].end;
    for (let i = 1; i < sorted.length; i++) {
        const { start, end } = sorted[i];
        if (start <= curEnd) {
            if (end > curEnd) curEnd = end;       // overlap → extend current run
        } else {
            total += curEnd - curStart;           // gap → close current run
            curStart = start;
            curEnd = end;
        }
    }
    return total + (curEnd - curStart);
}

/** Merged total + per-stage durations (ms) from stage-tagged sleep intervals. */
function summariseSleepStages(intervals: StagedInterval[]): {
    totalMs: number; deepMs: number; remMs: number; lightMs: number;
} {
    return {
        totalMs: mergeIntervalMs(intervals),
        deepMs:  mergeIntervalMs(intervals.filter(s => s.stage === 'deep')),
        remMs:   mergeIntervalMs(intervals.filter(s => s.stage === 'rem')),
        lightMs: mergeIntervalMs(intervals.filter(s => s.stage === 'light')),
    };
}

async function iosGetLastNightSleep(): Promise<SleepSession | null> {
    try {
        const HK = getHK();
        const start = new Date();
        start.setDate(start.getDate() - 1);
        start.setHours(18, 0, 0, 0);
        const samples = await HK.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
            filter: { date: { startDate: start, endDate: new Date() } },
            limit: -1,
        });
        // Filter to actual sleep values (not inBed=0 or awake=2), written by a worn
        // wearable — phone-generated Sleep Schedule estimates are excluded.
        const asleep = samples.filter(s => s.value !== 0 && s.value !== 2 && isWearableIOSSample(s));
        if (asleep.length === 0) return null;

        // Merge overlapping samples so multi-source nights aren't double-counted.
        const { totalMs, deepMs, remMs, lightMs } = summariseSleepStages(
            asleep.map(s => ({
                start: s.startDate.getTime(),
                end: s.endDate.getTime(),
                stage: s.value === 4 ? 'deep' : s.value === 5 ? 'rem' : 'light',
            })),
        );

        const earliest = asleep.reduce((min, s) => s.startDate < min ? s.startDate : min, asleep[0].startDate);
        const latest = asleep.reduce((max, s) => s.endDate > max ? s.endDate : max, asleep[0].endDate);
        return {
            startedAt: earliest.toISOString(),
            endedAt: latest.toISOString(),
            durationHours: Math.round((totalMs / 3600000) * 10) / 10,
            deepHours: Math.round((deepMs / 3600000) * 10) / 10,
            remHours: Math.round((remMs / 3600000) * 10) / 10,
            lightHours: Math.round((lightMs / 3600000) * 10) / 10,
        };
    } catch (e) {
        console.warn('Failed to read Apple HealthKit sleep:', e);
        return null;
    }
}

async function iosGetHeartRateToday(): Promise<HeartRateSummary | null> {
    try {
        const HK = getHK();
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const filter = { date: { startDate: midnight, endDate: new Date() } };
        const res = await HK.queryStatisticsForQuantity('HKQuantityTypeIdentifierHeartRate', ['discreteAverage', 'discreteMax'], {
            filter,
            unit: 'count/min',
        });
        const avg = res.averageQuantity?.quantity;
        const max = res.maximumQuantity?.quantity;
        if (avg === undefined && max === undefined) return null;

        // Resting HR is a distinct type — read today's most recent value.
        let resting = 0;
        try {
            const restRes = await HK.queryStatisticsForQuantity('HKQuantityTypeIdentifierRestingHeartRate', ['mostRecent'], {
                filter,
                unit: 'count/min',
            });
            resting = Math.round(restRes.mostRecentQuantity?.quantity ?? 0);
        } catch { /* resting HR not available */ }

        return {
            avg: Math.round(avg ?? 0),
            max: Math.round(max ?? 0),
            resting,
        };
    } catch {
        return null;
    }
}

async function iosGetCaloriesToday(): Promise<CalorieSummary | null> {
    try {
        const HK = getHK();
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const dateFilter = { date: { startDate: midnight, endDate: new Date() } };

        const activeRes = await HK.queryStatisticsForQuantity('HKQuantityTypeIdentifierActiveEnergyBurned', ['cumulativeSum'], {
            filter: dateFilter,
            unit: 'kcal',
        });
        const active = activeRes.sumQuantity?.quantity ?? 0;

        const basalRes = await HK.queryStatisticsForQuantity('HKQuantityTypeIdentifierBasalEnergyBurned', ['cumulativeSum'], {
            filter: dateFilter,
            unit: 'kcal',
        });
        const basal = basalRes.sumQuantity?.quantity ?? 0;

        if (active === 0 && basal === 0) return null;
        return { active: Math.round(active), total: Math.round(active + basal) };
    } catch {
        return null;
    }
}

// ── Android (Health Connect via react-native-health-connect) ─────────────────

export type HealthConnectStatus = 'available' | 'needs_install' | 'unsupported' | 'module_missing';

export async function androidHealthConnectStatus(): Promise<HealthConnectStatus> {
    // Expo Go has no health-connect native module — every call below throws
    // regardless of what's installed on the device, so don't misread that as
    // "Health Connect isn't installed" and send the user to the Play Store.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default;
    if (Constants?.executionEnvironment === 'storeClient') return 'module_missing';
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, getSdkStatus, SdkAvailabilityStatus } = require('react-native-health-connect');
        let initOk = false;
        try { initOk = await initialize(); } catch (e) { console.warn('[HC] initialize threw:', e); }
        const status = await getSdkStatus();
        console.log(`[HC] initialize=${initOk} status=${status} (available=${SdkAvailabilityStatus.SDK_AVAILABLE}, needsUpdate=${SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED}, unavailable=${SdkAvailabilityStatus.SDK_UNAVAILABLE})`);
        if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
        if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'needs_install';
        return 'unsupported';
    } catch (e) {
        console.warn('[HC] androidHealthConnectStatus failed:', e);
        return 'unsupported';
    }
}

export async function androidCheckAvailable(): Promise<boolean> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, getSdkStatus, SdkAvailabilityStatus } = require('react-native-health-connect');
        // initialize() must be called before any other Health Connect API
        await initialize();
        const status = await getSdkStatus();
        console.log('[HealthData] SDK status:', status, 'expected:', SdkAvailabilityStatus.SDK_AVAILABLE);
        return status === SdkAvailabilityStatus.SDK_AVAILABLE;
    } catch (e) {
        console.warn('[HealthData] androidCheckAvailable failed:', e);
        return false;
    }
}

/** Checks existing Health Connect grants without showing any UI. */
export async function androidCheckAlreadyGranted(): Promise<boolean> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, getGrantedPermissions } = require('react-native-health-connect');
        await initialize();
        const granted: Array<{ recordType: string; accessType: string }> = await getGrantedPermissions();
        console.log('[HealthData] Granted permissions:', JSON.stringify(granted));
        // Accept any Steps-related permission (format may vary by Health Connect version)
        return granted.some(p =>
            (p.recordType === 'Steps' || p.recordType === 'android.permission.health.READ_STEPS') &&
            (p.accessType === 'read' || !p.accessType)
        );
    } catch (e) {
        console.warn('[HealthData] androidCheckAlreadyGranted failed:', e);
        return false;
    }
}

/** Checks whether Health Connect ExerciseSession (workout) read is granted to POWR. */
export async function androidExerciseSessionGranted(): Promise<boolean> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, getGrantedPermissions } = require('react-native-health-connect');
        await initialize();
        const granted: Array<{ recordType: string; accessType: string }> = await getGrantedPermissions();
        return granted.some(p =>
            (p.recordType === 'ExerciseSession' || p.recordType === 'android.permission.health.READ_EXERCISE') &&
            (p.accessType === 'read' || !p.accessType)
        );
    } catch (e) {
        console.warn('[HealthData] androidExerciseSessionGranted failed:', e);
        return false;
    }
}

export async function androidRequestPermissions(): Promise<boolean> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, requestPermission } = require('react-native-health-connect');
        await initialize();
        console.log('[HealthData] Requesting Health Connect permissions...');
        const granted: unknown[] = await requestPermission([
            { accessType: 'read', recordType: 'Steps' },
            { accessType: 'read', recordType: 'ExerciseSession' },
            { accessType: 'read', recordType: 'SleepSession' },
            { accessType: 'read', recordType: 'HeartRate' },
            { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
            { accessType: 'read', recordType: 'TotalCaloriesBurned' },
            { accessType: 'read', recordType: 'RestingHeartRate' },
        ]);
        console.log('[HealthData] Permissions granted:', granted);
        return granted.length > 0;
    } catch (e) {
        console.warn('[HealthData] androidRequestPermissions failed:', e);
        return false;
    }
}

export function androidOpenHealthConnectSettings(): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { openHealthConnectSettings } = require('react-native-health-connect');
    openHealthConnectSettings();
}

async function androidGetStepsToday(): Promise<number> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readRecords } = require('react-native-health-connect');
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const now = new Date();
        const startTime = toLocalISO(midnight);
        const endTime = toLocalISO(now);
        console.log(`[HealthData] Reading steps from ${startTime} to ${endTime}`);
        const result = await readRecords('Steps', {
            timeRangeFilter: {
                operator: 'between',
                startTime,
                endTime,
            },
        });
        const records = result?.records ?? [];
        const total = (records as Array<{ count: number }>).reduce((sum, r) => sum + r.count, 0);
        console.log(`[HealthData] Android steps: ${total} (${records.length} records)`);
        return total;
    } catch (e) {
        console.warn('[HealthData] androidGetStepsToday failed:', e);
        return 0;
    }
}

// Health Connect ExerciseType numeric constants
// See: https://developer.android.com/reference/kotlin/androidx/health/connect/client/records/ExerciseSessionRecord
const HC_EXERCISE_TYPE: Record<number, string> = {
    2:  'dancing',         // EXERCISE_TYPE_DANCING
    8:  'biking',          // EXERCISE_TYPE_BIKING
    9:  'biking_stationary',
    11: 'boot_camp',
    14: 'calisthenics',
    29: 'elliptical',
    32: 'fencing',
    37: 'gym',             // EXERCISE_TYPE_STRENGTH_TRAINING → gym
    38: 'gymnastics',
    39: 'handball',
    43: 'hiit',            // EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING
    44: 'hiking',
    46: 'ice_skating',
    48: 'martial_arts',
    50: 'paddling',
    51: 'pilates',
    53: 'racquetball',
    55: 'rock_climbing',
    56: 'rowing',
    57: 'rowing_machine',
    58: 'running',         // EXERCISE_TYPE_RUNNING
    59: 'running_treadmill',
    62: 'skiing',
    64: 'snowboarding',
    67: 'soccer',
    70: 'squash',
    71: 'stair_climbing',
    74: 'swimming_open_water',
    75: 'swimming_pool',
    76: 'tennis',
    78: 'volleyball',
    79: 'walking',
    80: 'weightlifting',   // EXERCISE_TYPE_WEIGHTLIFTING → gym
    82: 'yoga',
};

function mapHCExerciseType(exerciseType: number): string {
    return HC_EXERCISE_TYPE[exerciseType] ?? `exercise_${exerciseType}`;
}

async function androidGetActivitiesToday(): Promise<HealthActivity[]> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readRecords } = require('react-native-health-connect');
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const { records } = await readRecords('ExerciseSession', {
            timeRangeFilter: {
                operator: 'between',
                startTime: toLocalISO(midnight),
                endTime: toLocalISO(new Date()),
            },
        });
        return (records as Array<{ startTime: string; endTime: string; exerciseType: number; metadata?: { dataOrigin?: string; device?: { type?: number } } }>).map(r => ({
            type: mapHCExerciseType(r.exerciseType),
            startedAt: r.startTime,
            durationMin: Math.round(
                (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000,
            ),
            source: androidProvenance(r),
            rawName: HC_EXERCISE_TYPE[r.exerciseType],
        }));
    } catch {
        return [];
    }
}

async function androidGetLastNightSleep(): Promise<SleepSession | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readRecords } = require('react-native-health-connect');
        // Look for sleep between yesterday 6pm and now
        const start = new Date();
        start.setDate(start.getDate() - 1);
        start.setHours(18, 0, 0, 0);
        const { records } = await readRecords('SleepSession', {
            timeRangeFilter: {
                operator: 'between',
                startTime: toLocalISO(start),
                endTime: toLocalISO(new Date()),
            },
        });
        const all = records as Array<{ startTime: string; endTime: string; metadata?: { dataOrigin?: string; device?: { type?: number } }; stages?: Array<{ stage: number; startTime: string; endTime: string }> }>;
        // Wearable-only: keep sleep written by a worn device, drop phone-sourced sleep.
        const sessions = all.filter(isWearableAndroidRecord);
        if (!sessions || sessions.length === 0) return null;

        // Build stage-tagged intervals, then merge overlaps so sleep written by
        // multiple sources for the same night isn't double-counted.
        // Health Connect stages: 1=AWAKE_IN_BED, 2=LIGHT, 3=DEEP, 4=REM, 5=OUT_OF_BED
        const intervals: StagedInterval[] = [];
        let earliest = sessions[0].startTime;
        let latest = sessions[0].endTime;

        for (const s of sessions) {
            if (s.startTime < earliest) earliest = s.startTime;
            if (s.endTime > latest) latest = s.endTime;

            if (s.stages && s.stages.length > 0) {
                for (const stage of s.stages) {
                    if (stage.stage === 2 || stage.stage === 3 || stage.stage === 4) {
                        intervals.push({
                            start: new Date(stage.startTime).getTime(),
                            end: new Date(stage.endTime).getTime(),
                            stage: stage.stage === 3 ? 'deep' : stage.stage === 4 ? 'rem' : 'light',
                        });
                    }
                }
            } else {
                // No stage data — treat the whole session as light sleep
                intervals.push({
                    start: new Date(s.startTime).getTime(),
                    end: new Date(s.endTime).getTime(),
                    stage: 'light',
                });
            }
        }

        const { totalMs, deepMs, remMs, lightMs } = summariseSleepStages(intervals);
        if (totalMs === 0) return null;

        return {
            startedAt: earliest,
            endedAt: latest,
            durationHours: Math.round((totalMs / 3600000) * 10) / 10,
            deepHours: Math.round((deepMs / 3600000) * 10) / 10,
            remHours: Math.round((remMs / 3600000) * 10) / 10,
            lightHours: Math.round((lightMs / 3600000) * 10) / 10,
        };
    } catch (e) {
        console.warn('[HealthData] androidGetLastNightSleep failed:', e);
        return null;
    }
}

async function androidGetHeartRateToday(): Promise<HeartRateSummary | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readRecords } = require('react-native-health-connect');
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const { records } = await readRecords('HeartRate', {
            timeRangeFilter: {
                operator: 'between',
                startTime: toLocalISO(midnight),
                endTime: toLocalISO(new Date()),
            },
        });
        const samples = records as Array<{ samples: Array<{ beatsPerMinute: number }> }>;
        const values: number[] = [];
        for (const r of samples) {
            for (const s of r.samples ?? []) values.push(s.beatsPerMinute);
        }
        if (values.length === 0) return null;
        const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
        const max = Math.max(...values);

        // Try resting HR
        let resting = 0;
        try {
            const { records: restRecords } = await readRecords('RestingHeartRate', {
                timeRangeFilter: {
                    operator: 'between',
                    startTime: toLocalISO(midnight),
                    endTime: toLocalISO(new Date()),
                },
            });
            const restSamples = restRecords as Array<{ beatsPerMinute: number }>;
            if (restSamples.length > 0) {
                resting = Math.round(restSamples.reduce((s, r) => s + r.beatsPerMinute, 0) / restSamples.length);
            }
        } catch { /* resting HR not available */ }

        return { avg, max, resting };
    } catch {
        return null;
    }
}

async function androidGetCaloriesToday(): Promise<CalorieSummary | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readRecords } = require('react-native-health-connect');
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const timeFilter = {
            timeRangeFilter: {
                operator: 'between',
                startTime: toLocalISO(midnight),
                endTime: toLocalISO(new Date()),
            },
        };

        const { records: activeRecords } = await readRecords('ActiveCaloriesBurned', timeFilter);
        const active = (activeRecords as Array<{ energy: { inKilocalories: number } }>)
            .reduce((s, r) => s + (r.energy?.inKilocalories ?? 0), 0);

        const { records: totalRecords } = await readRecords('TotalCaloriesBurned', timeFilter);
        const total = (totalRecords as Array<{ energy: { inKilocalories: number } }>)
            .reduce((s, r) => s + (r.energy?.inKilocalories ?? 0), 0);

        if (active === 0 && total === 0) return null;
        return { active: Math.round(active), total: Math.round(total) };
    } catch {
        return null;
    }
}

// ── Week history (7-day lookback) ─────────────────────────────────────────────

function dayRange(daysAgo: number): { start: Date; end: Date } {
    const start = new Date();
    start.setDate(start.getDate() - daysAgo);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

function formatDateKey(d: Date): string {
    // Use local calendar components, not toISOString() (UTC): the day ranges are
    // built in local time, so a UTC key would mis-attribute days for users ahead
    // of UTC (e.g. local midnight maps to the previous UTC date).
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function iosGetWeekHistory(): Promise<DayHealthSummary[]> {
    const results: DayHealthSummary[] = [];

    for (let i = 6; i >= 0; i--) {
        const { start, end } = dayRange(i);
        const dateKey = formatDateKey(start);
        const dateFilter = { date: { startDate: start, endDate: end } };

        // Steps (de-duped cumulative sum, matches Apple Health)
        let steps = 0;
        try {
            const HK = getHK();
            const res = await HK.queryStatisticsForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], {
                filter: dateFilter,
                unit: 'count',
            });
            steps = Math.round(res.sumQuantity?.quantity ?? 0);
        } catch { /* ignore */ }

        // Workouts
        let activities: HealthActivity[] = [];
        try {
            const HK = getHK();
            const workouts = await HK.queryWorkoutSamples({
                filter: { date: { startDate: start, endDate: end } },
                limit: -1,
            });
            activities = workouts.map(w => ({
                type: HK_WORKOUT_TYPE_MAP[w.workoutActivityType as number] ?? 'other',
                startedAt: w.startDate.toISOString(),
                durationMin: Math.round(w.duration.quantity / 60),
                distanceM: w.totalDistance ? Math.round(w.totalDistance.quantity) : undefined,
                source: iosProvenance(w),
                rawName: HK_WORKOUT_NAME_MAP[w.workoutActivityType as number],
            }));
        } catch { /* ignore */ }

        // Sleep (look from previous day 6pm to this day's end)
        let sleep: SleepSession | null = null;
        try {
            const HK = getHK();
            const sleepStart = new Date(start);
            sleepStart.setDate(sleepStart.getDate() - 1);
            sleepStart.setHours(18, 0, 0, 0);
            const samples = await HK.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
                filter: { date: { startDate: sleepStart, endDate: end } },
                limit: -1,
            });
            // Wearable-only: drop phone-generated sleep, keep worn-device samples.
            const asleep = samples.filter(s => s.value !== 0 && s.value !== 2 && isWearableIOSSample(s));
            if (asleep.length > 0) {
                // Merge overlapping samples so multi-source nights aren't double-counted.
                const { totalMs, deepMs, remMs, lightMs } = summariseSleepStages(
                    asleep.map(s => ({
                        start: s.startDate.getTime(),
                        end: s.endDate.getTime(),
                        stage: s.value === 4 ? 'deep' : s.value === 5 ? 'rem' : 'light',
                    })),
                );
                const earliest = asleep.reduce((min, s) => s.startDate < min ? s.startDate : min, asleep[0].startDate);
                const latest = asleep.reduce((max, s) => s.endDate > max ? s.endDate : max, asleep[0].endDate);
                sleep = {
                    startedAt: earliest.toISOString(),
                    endedAt: latest.toISOString(),
                    durationHours: Math.round((totalMs / 3600000) * 10) / 10,
                    deepHours: Math.round((deepMs / 3600000) * 10) / 10,
                    remHours: Math.round((remMs / 3600000) * 10) / 10,
                    lightHours: Math.round((lightMs / 3600000) * 10) / 10,
                };
            }
        } catch { /* ignore */ }

        // Heart rate (de-duped average/max)
        let heartRate: HeartRateSummary | null = null;
        try {
            const HK = getHK();
            const res = await HK.queryStatisticsForQuantity('HKQuantityTypeIdentifierHeartRate', ['discreteAverage', 'discreteMax'], {
                filter: dateFilter,
                unit: 'count/min',
            });
            const avg = res.averageQuantity?.quantity;
            const max = res.maximumQuantity?.quantity;
            if (avg !== undefined || max !== undefined) {
                heartRate = {
                    avg: Math.round(avg ?? 0),
                    max: Math.round(max ?? 0),
                    resting: 0,
                };
            }
        } catch { /* ignore */ }

        // Calories (de-duped cumulative sums)
        let calories: CalorieSummary | null = null;
        try {
            const HK = getHK();
            const activeRes = await HK.queryStatisticsForQuantity('HKQuantityTypeIdentifierActiveEnergyBurned', ['cumulativeSum'], {
                filter: dateFilter, unit: 'kcal',
            });
            const active = activeRes.sumQuantity?.quantity ?? 0;
            const basalRes = await HK.queryStatisticsForQuantity('HKQuantityTypeIdentifierBasalEnergyBurned', ['cumulativeSum'], {
                filter: dateFilter, unit: 'kcal',
            });
            const basal = basalRes.sumQuantity?.quantity ?? 0;
            if (active > 0 || basal > 0) {
                calories = { active: Math.round(active), total: Math.round(active + basal) };
            }
        } catch { /* ignore */ }

        results.push({ date: dateKey, steps, activities, sleep, heartRate, calories });
    }

    return results;
}

async function androidGetWeekHistory(): Promise<DayHealthSummary[]> {
    const results: DayHealthSummary[] = [];

    for (let i = 6; i >= 0; i--) {
        const { start, end } = dayRange(i);
        const dateKey = formatDateKey(start);
        const timeFilter = {
            timeRangeFilter: {
                operator: 'between',
                startTime: toLocalISO(start),
                endTime: toLocalISO(end),
            },
        };

        // Steps
        let steps = 0;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { readRecords } = require('react-native-health-connect');
            const { records } = await readRecords('Steps', timeFilter);
            steps = (records as Array<{ count: number }>).reduce((sum, r) => sum + r.count, 0);
        } catch { /* ignore */ }

        // Workouts
        let activities: HealthActivity[] = [];
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { readRecords } = require('react-native-health-connect');
            const { records } = await readRecords('ExerciseSession', timeFilter);
            activities = (records as Array<{ startTime: string; endTime: string; exerciseType: number; metadata?: { dataOrigin?: string; device?: { type?: number } } }>).map(r => ({
                type: mapHCExerciseType(r.exerciseType),
                startedAt: r.startTime,
                durationMin: Math.round((new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000),
                source: androidProvenance(r),
                rawName: HC_EXERCISE_TYPE[r.exerciseType],
            }));
        } catch { /* ignore */ }

        // Sleep (look from previous day 6pm)
        let sleep: SleepSession | null = null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { readRecords } = require('react-native-health-connect');
            const sleepStart = new Date(start);
            sleepStart.setDate(sleepStart.getDate() - 1);
            sleepStart.setHours(18, 0, 0, 0);
            const { records } = await readRecords('SleepSession', {
                timeRangeFilter: { operator: 'between', startTime: toLocalISO(sleepStart), endTime: toLocalISO(end) },
            });
            const allSleep = records as Array<{ startTime: string; endTime: string; metadata?: { dataOrigin?: string; device?: { type?: number } }; stages?: Array<{ stage: number; startTime: string; endTime: string }> }>;
            // Wearable-only: drop phone-sourced sleep, keep worn-device sessions.
            const sessions = allSleep.filter(isWearableAndroidRecord);
            if (sessions && sessions.length > 0) {
                // Stage-tagged intervals merged to remove multi-source overlap.
                const intervals: StagedInterval[] = [];
                let earliest = sessions[0].startTime, latest = sessions[0].endTime;
                for (const s of sessions) {
                    if (s.startTime < earliest) earliest = s.startTime;
                    if (s.endTime > latest) latest = s.endTime;
                    if (s.stages && s.stages.length > 0) {
                        for (const st of s.stages) {
                            if (st.stage === 2 || st.stage === 3 || st.stage === 4) {
                                intervals.push({
                                    start: new Date(st.startTime).getTime(),
                                    end: new Date(st.endTime).getTime(),
                                    stage: st.stage === 3 ? 'deep' : st.stage === 4 ? 'rem' : 'light',
                                });
                            }
                        }
                    } else {
                        intervals.push({
                            start: new Date(s.startTime).getTime(),
                            end: new Date(s.endTime).getTime(),
                            stage: 'light',
                        });
                    }
                }
                const { totalMs, deepMs, remMs, lightMs } = summariseSleepStages(intervals);
                if (totalMs > 0) {
                    sleep = {
                        startedAt: earliest, endedAt: latest,
                        durationHours: Math.round((totalMs / 3600000) * 10) / 10,
                        deepHours: Math.round((deepMs / 3600000) * 10) / 10,
                        remHours: Math.round((remMs / 3600000) * 10) / 10,
                        lightHours: Math.round((lightMs / 3600000) * 10) / 10,
                    };
                }
            }
        } catch { /* ignore */ }

        // Heart rate
        let heartRate: HeartRateSummary | null = null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { readRecords } = require('react-native-health-connect');
            const { records } = await readRecords('HeartRate', timeFilter);
            const values: number[] = [];
            for (const r of (records as Array<{ samples: Array<{ beatsPerMinute: number }> }>)) {
                for (const s of r.samples ?? []) values.push(s.beatsPerMinute);
            }
            if (values.length > 0) {
                heartRate = {
                    avg: Math.round(values.reduce((s, v) => s + v, 0) / values.length),
                    max: Math.max(...values),
                    resting: 0,
                };
            }
        } catch { /* ignore */ }

        // Calories
        let calories: CalorieSummary | null = null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { readRecords } = require('react-native-health-connect');
            const { records: ar } = await readRecords('ActiveCaloriesBurned', timeFilter);
            const active = (ar as Array<{ energy: { inKilocalories: number } }>).reduce((s, r) => s + (r.energy?.inKilocalories ?? 0), 0);
            const { records: tr } = await readRecords('TotalCaloriesBurned', timeFilter);
            const total = (tr as Array<{ energy: { inKilocalories: number } }>).reduce((s, r) => s + (r.energy?.inKilocalories ?? 0), 0);
            if (active > 0 || total > 0) {
                calories = { active: Math.round(active), total: Math.round(total) };
            }
        } catch { /* ignore */ }

        results.push({ date: dateKey, steps, activities, sleep, heartRate, calories });
    }

    return results;
}

// ── Unified hook ──────────────────────────────────────────────────────────────

const UNAVAILABLE: HealthDataHook = {
    isAvailable: false,
    isAuthorized: false,
    requesting: false,
    requestPermissions: async () => false,
    getStepsToday: async () => 0,
    getActivitiesToday: async () => [],
    getLastNightSleep: async () => null,
    getHeartRateToday: async () => null,
    getCaloriesToday: async () => null,
    getWeekHistory: async () => [],
    verifyWalking: async () => ({ verified: false, actualValue: 0, detail: 'Not available' }),
    verifyWorkout: async () => ({ verified: false, actualValue: 0, detail: 'Not available' }),
};

/**
 * Last 7 days of native health data, readable from plain modules (no React).
 *
 * The hook's `getWeekHistory` delegates here, as does the native provider —
 * the historical backfill runs outside any component, so it can't use a hook.
 */
export async function getWeekHistoryNow(): Promise<DayHealthSummary[]> {
    return Platform.OS === 'ios' ? await iosGetWeekHistory() : await androidGetWeekHistory();
}

export function useHealthData(): HealthDataHook {
    const isNative = Platform.OS === 'ios' || Platform.OS === 'android';
    const [isAvailable, setIsAvailable] = useState(false);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [requesting, setRequesting] = useState(false);

    useEffect(() => {
        if (!isNative) return;
        if (Platform.OS === 'android') {
            androidCheckAvailable().then(available => {
                setIsAvailable(available);
                if (available) {
                    // Restore auth silently — no UI shown if already granted
                    androidCheckAlreadyGranted().then(granted => {
                        if (granted) {
                            setIsAuthorized(true);
                        } else {
                            // Fallback: try reading steps directly — some Health Connect
                            // versions don't report permissions via getGrantedPermissions
                            androidGetStepsToday().then(steps => {
                                if (steps > 0) {
                                    console.log('[HealthData] Permission check failed but steps readable — marking authorized');
                                    setIsAuthorized(true);
                                }
                            }).catch(() => {});
                        }
                    });
                }
            });
        } else {
            setIsAvailable(true);
            // On iOS, initHealthKit is silent if permissions already granted.
            // This restores isAuthorized on every launch without any prompt.
            iosRequestPermissions().then(granted => {
                if (granted) setIsAuthorized(true);
            });
        }
    }, [isNative]);

    const requestPermissions = useCallback(async (): Promise<boolean> => {
        setRequesting(true);
        try {
            const granted = Platform.OS === 'ios'
                ? await iosRequestPermissions()
                : await androidRequestPermissions();
            setIsAuthorized(granted);
            return granted;
        } finally {
            setRequesting(false);
        }
    }, []);

    const getStepsToday = useCallback(async () => {
        return Platform.OS === 'ios' ? await iosGetStepsToday() : await androidGetStepsToday();
    }, []);

    const getActivitiesToday = useCallback(async () => {
        return Platform.OS === 'ios' ? await iosGetActivitiesToday() : await androidGetActivitiesToday();
    }, []);

    const getLastNightSleep = useCallback(async () => {
        return Platform.OS === 'ios' ? await iosGetLastNightSleep() : await androidGetLastNightSleep();
    }, []);

    const getHeartRateToday = useCallback(async () => {
        return Platform.OS === 'ios' ? await iosGetHeartRateToday() : await androidGetHeartRateToday();
    }, []);

    const getCaloriesToday = useCallback(async () => {
        return Platform.OS === 'ios' ? await iosGetCaloriesToday() : await androidGetCaloriesToday();
    }, []);

    const getWeekHistory = useCallback(async (): Promise<DayHealthSummary[]> => {
        return getWeekHistoryNow();
    }, []);

    /** Verify a walking session by comparing claimed steps to today's step count. */
    const verifyWalking = useCallback(async (claimedSteps: number): Promise<VerifyResult> => {
        const actual = await getStepsToday();
        const verified = actual >= Math.floor(claimedSteps * 0.85);
        return {
            verified,
            actualValue: actual,
            detail: verified
                ? `${actual.toLocaleString()} steps found today`
                : `Only ${actual.toLocaleString()} steps found`,
        };
    }, [getStepsToday]);

    /** Verify a workout session by looking for a matching duration in today's workouts. */
    const verifyWorkout = useCallback(async (_activityType: string, durationMinutes: number): Promise<VerifyResult> => {
        const workouts = await getActivitiesToday();
        const match = workouts.find(w => w.durationMin >= Math.floor(durationMinutes * 0.7));
        return {
            verified: !!match,
            actualValue: match?.durationMin ?? 0,
            detail: match
                ? `${match.durationMin} min workout found today`
                : `No matching workout found (looking for ~${durationMinutes} min)`,
        };
    }, [getActivitiesToday]);

    if (!isNative) return UNAVAILABLE;

    return { isAvailable, isAuthorized, requesting, requestPermissions, getStepsToday, getActivitiesToday, getLastNightSleep, getHeartRateToday, getCaloriesToday, getWeekHistory, verifyWalking, verifyWorkout };
}

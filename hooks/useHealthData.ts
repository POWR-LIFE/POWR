import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

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

// ── iOS (HealthKit via @kingstinct/react-native-healthkit) ───────────────────

// Lazy import helper — avoids requiring the module on Android/web at module load time
function getHK() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');
}

const HK_READ_PERMISSIONS = [
    'HKQuantityTypeIdentifierStepCount',
    'HKQuantityTypeIdentifierDistanceWalkingRunning',
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
        const samples = await HK.queryQuantitySamples('HKQuantityTypeIdentifierStepCount', {
            filter: { date: { startDate: midnight, endDate: new Date() } },
            unit: 'count',
            limit: -1,
        });
        return samples.reduce((sum, s) => sum + s.quantity, 0);
    } catch (e) {
        console.warn('Failed to read Apple HealthKit steps:', e);
        return 0;
    }
}

// Maps HKWorkoutActivityType numeric values to POWR activity type strings
const HK_WORKOUT_TYPE_MAP: Record<number, string> = {
    13: 'cycling',
    16: 'cycling',         // elliptical → cycling (closest cardio)
    20: 'gym',             // functionalStrengthTraining
    37: 'running',
    41: 'sports',          // soccer
    46: 'swimming',
    48: 'sports',          // tennis
    50: 'gym',             // traditionalStrengthTraining
    52: 'walking',
    57: 'yoga',
    63: 'hiit',            // highIntensityIntervalTraining
    66: 'yoga',            // pilates
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
        }));
    } catch (e) {
        console.warn('Failed to read Apple HealthKit workouts:', e);
        return [];
    }
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
        // Filter to actual sleep values (not inBed=0 or awake=2)
        const asleep = samples.filter(s => s.value !== 0 && s.value !== 2);
        if (asleep.length === 0) return null;

        let totalMs = 0, deepMs = 0, remMs = 0, lightMs = 0;
        for (const s of asleep) {
            const ms = s.endDate.getTime() - s.startDate.getTime();
            totalMs += ms;
            if (s.value === 4) deepMs += ms;       // asleepDeep
            else if (s.value === 5) remMs += ms;   // asleepREM
            else lightMs += ms;                     // asleepCore / asleepUnspecified
        }

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
        const samples = await HK.queryQuantitySamples('HKQuantityTypeIdentifierHeartRate', {
            filter: { date: { startDate: midnight, endDate: new Date() } },
            unit: 'count/min',
            limit: -1,
        });
        if (samples.length === 0) return null;
        const values = samples.map(s => s.quantity);
        return {
            avg: Math.round(values.reduce((a, v) => a + v, 0) / values.length),
            max: Math.max(...values),
            resting: 0,
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

        const activeSamples = await HK.queryQuantitySamples('HKQuantityTypeIdentifierActiveEnergyBurned', {
            filter: dateFilter,
            unit: 'kcal',
            limit: -1,
        });
        const active = activeSamples.reduce((s, r) => s + r.quantity, 0);

        const basalSamples = await HK.queryQuantitySamples('HKQuantityTypeIdentifierBasalEnergyBurned', {
            filter: dateFilter,
            unit: 'kcal',
            limit: -1,
        });
        const basal = basalSamples.reduce((s, r) => s + r.quantity, 0);

        if (active === 0 && basal === 0) return null;
        return { active: Math.round(active), total: Math.round(active + basal) };
    } catch {
        return null;
    }
}

// ── Android (Health Connect via react-native-health-connect) ─────────────────

export type HealthConnectStatus = 'available' | 'needs_install' | 'unsupported';

export async function androidHealthConnectStatus(): Promise<HealthConnectStatus> {
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

export async function androidRequestPermissions(): Promise<boolean> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, requestPermission } = require('react-native-health-connect');
        await initialize();
        console.log('[HealthData] Requesting Health Connect permissions...');
        const granted: unknown[] = await requestPermission([
            { accessType: 'read', recordType: 'Steps' },
            { accessType: 'read', recordType: 'Distance' },
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
        return (records as Array<{ startTime: string; endTime: string; exerciseType: number }>).map(r => ({
            type: mapHCExerciseType(r.exerciseType),
            startedAt: r.startTime,
            durationMin: Math.round(
                (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000,
            ),
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
        const sessions = records as Array<{ startTime: string; endTime: string; stages?: Array<{ stage: number; startTime: string; endTime: string }> }>;
        if (!sessions || sessions.length === 0) return null;

        // Sum total sleep time from stages (stages 1-5 are actual sleep, 0=unknown, 6=awake)
        let totalMs = 0;
        let deepMs = 0;
        let remMs = 0;
        let lightMs = 0;
        let earliest = sessions[0].startTime;
        let latest = sessions[0].endTime;

        for (const s of sessions) {
            if (s.startTime < earliest) earliest = s.startTime;
            if (s.endTime > latest) latest = s.endTime;

            if (s.stages && s.stages.length > 0) {
                // Health Connect stages: 1=AWAKE_IN_BED, 2=LIGHT, 3=DEEP, 4=REM, 5=OUT_OF_BED
                for (const stage of s.stages) {
                    const ms = new Date(stage.endTime).getTime() - new Date(stage.startTime).getTime();
                    if (stage.stage === 2) { lightMs += ms; totalMs += ms; }
                    else if (stage.stage === 3) { deepMs += ms; totalMs += ms; }
                    else if (stage.stage === 4) { remMs += ms; totalMs += ms; }
                }
            } else {
                // No stage data — use total session duration as light sleep
                const ms = new Date(s.endTime).getTime() - new Date(s.startTime).getTime();
                totalMs += ms;
                lightMs += ms;
            }
        }

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
    return d.toISOString().split('T')[0];
}

async function iosGetWeekHistory(): Promise<DayHealthSummary[]> {
    const results: DayHealthSummary[] = [];

    for (let i = 6; i >= 0; i--) {
        const { start, end } = dayRange(i);
        const dateKey = formatDateKey(start);
        const dateFilter = { date: { startDate: start, endDate: end } };

        // Steps
        let steps = 0;
        try {
            const HK = getHK();
            const samples = await HK.queryQuantitySamples('HKQuantityTypeIdentifierStepCount', {
                filter: dateFilter,
                unit: 'count',
                limit: -1,
            });
            steps = samples.reduce((sum, s) => sum + s.quantity, 0);
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
            const asleep = samples.filter(s => s.value !== 0 && s.value !== 2);
            if (asleep.length > 0) {
                let totalMs = 0, deepMs = 0, remMs = 0, lightMs = 0;
                for (const s of asleep) {
                    const ms = s.endDate.getTime() - s.startDate.getTime();
                    totalMs += ms;
                    if (s.value === 4) deepMs += ms;
                    else if (s.value === 5) remMs += ms;
                    else lightMs += ms;
                }
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

        // Heart rate
        let heartRate: HeartRateSummary | null = null;
        try {
            const HK = getHK();
            const samples = await HK.queryQuantitySamples('HKQuantityTypeIdentifierHeartRate', {
                filter: dateFilter,
                unit: 'count/min',
                limit: -1,
            });
            if (samples.length > 0) {
                const vals = samples.map(s => s.quantity);
                heartRate = {
                    avg: Math.round(vals.reduce((a, v) => a + v, 0) / vals.length),
                    max: Math.max(...vals),
                    resting: 0,
                };
            }
        } catch { /* ignore */ }

        // Calories
        let calories: CalorieSummary | null = null;
        try {
            const HK = getHK();
            const activeSamples = await HK.queryQuantitySamples('HKQuantityTypeIdentifierActiveEnergyBurned', {
                filter: dateFilter, unit: 'kcal', limit: -1,
            });
            const active = activeSamples.reduce((s, r) => s + r.quantity, 0);
            const basalSamples = await HK.queryQuantitySamples('HKQuantityTypeIdentifierBasalEnergyBurned', {
                filter: dateFilter, unit: 'kcal', limit: -1,
            });
            const basal = basalSamples.reduce((s, r) => s + r.quantity, 0);
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
            activities = (records as Array<{ startTime: string; endTime: string; exerciseType: number }>).map(r => ({
                type: mapHCExerciseType(r.exerciseType),
                startedAt: r.startTime,
                durationMin: Math.round((new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000),
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
            const sessions = records as Array<{ startTime: string; endTime: string; stages?: Array<{ stage: number; startTime: string; endTime: string }> }>;
            if (sessions && sessions.length > 0) {
                let totalMs = 0, deepMs = 0, remMs = 0, lightMs = 0;
                let earliest = sessions[0].startTime, latest = sessions[0].endTime;
                for (const s of sessions) {
                    if (s.startTime < earliest) earliest = s.startTime;
                    if (s.endTime > latest) latest = s.endTime;
                    if (s.stages && s.stages.length > 0) {
                        for (const st of s.stages) {
                            const ms = new Date(st.endTime).getTime() - new Date(st.startTime).getTime();
                            if (st.stage === 2) { lightMs += ms; totalMs += ms; }
                            else if (st.stage === 3) { deepMs += ms; totalMs += ms; }
                            else if (st.stage === 4) { remMs += ms; totalMs += ms; }
                        }
                    } else {
                        const ms = new Date(s.endTime).getTime() - new Date(s.startTime).getTime();
                        totalMs += ms; lightMs += ms;
                    }
                }
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
        return Platform.OS === 'ios' ? await iosGetWeekHistory() : await androidGetWeekHistory();
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

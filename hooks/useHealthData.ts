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

// ── iOS (HealthKit via react-native-health) ───────────────────────────────────

export async function iosRequestPermissions(): Promise<boolean> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { default: AppleHealthKit } = require('react-native-health');
        return new Promise((resolve) => {
            AppleHealthKit.initHealthKit(
                {
                    permissions: {
                        read: [
                            AppleHealthKit.Constants.Permissions.Steps,
                            AppleHealthKit.Constants.Permissions.DistanceWalkingRunning,
                            AppleHealthKit.Constants.Permissions.Workout,
                            AppleHealthKit.Constants.Permissions.SleepAnalysis,
                            AppleHealthKit.Constants.Permissions.HeartRate,
                            AppleHealthKit.Constants.Permissions.ActiveEnergyBurned,
                            AppleHealthKit.Constants.Permissions.BasalEnergyBurned,
                            AppleHealthKit.Constants.Permissions.RestingHeartRate,
                        ],
                        write: [],
                    },
                },
                (error: string) => resolve(!error),
            );
        });
    } catch (e) {
        console.warn('Failed to initialize Apple HealthKit:', e);
        return false;
    }
}

async function iosGetStepsToday(): Promise<number> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { default: AppleHealthKit } = require('react-native-health');
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        return new Promise((resolve) => {
            AppleHealthKit.getStepCount(
                { startDate: midnight.toISOString() },
                (err: string, result: { value: number }) => resolve(err ? 0 : result.value),
            );
        });
    } catch (e) {
        console.warn('Failed to read Apple HealthKit steps:', e);
        return 0;
    }
}

async function iosGetActivitiesToday(): Promise<HealthActivity[]> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { default: AppleHealthKit } = require('react-native-health');
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        return new Promise((resolve) => {
            AppleHealthKit.getSamples(
                {
                    startDate: midnight.toISOString(),
                    endDate: new Date().toISOString(),
                    type: 'Workout',
                },
                (err: string, results: Array<{ start: string; end: string; activityName: string; distance?: number }>) => {
                    if (err || !results) return resolve([]);
                    resolve(
                        results.map(r => ({
                            type: (r.activityName || 'other').toLowerCase(),
                            startedAt: r.start,
                            durationMin: Math.round(
                                (new Date(r.end).getTime() - new Date(r.start).getTime()) / 60000,
                            ),
                            distanceM: r.distance,
                        })),
                    );
                },
            );
        });
    } catch (e) {
        console.warn('Failed to read Apple HealthKit workouts:', e);
        return [];
    }
}

async function iosGetLastNightSleep(): Promise<SleepSession | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { default: AppleHealthKit } = require('react-native-health');
        // Look for sleep between yesterday 6pm and now
        const start = new Date();
        start.setDate(start.getDate() - 1);
        start.setHours(18, 0, 0, 0);
        return new Promise((resolve) => {
            AppleHealthKit.getSleepSamples(
                { startDate: start.toISOString(), endDate: new Date().toISOString() },
                (err: string, results: Array<{ startDate: string; endDate: string; value: string }>) => {
                    if (err || !results || results.length === 0) return resolve(null);
                    // Filter to ASLEEP samples (not INBED) and sum total sleep
                    const asleep = results.filter(r => r.value === 'ASLEEP' || r.value === 'ASLEEP_CORE' || r.value === 'ASLEEP_DEEP' || r.value === 'ASLEEP_REM');
                    if (asleep.length === 0) return resolve(null);

                    let totalMs = 0;
                    let deepMs = 0;
                    let remMs = 0;
                    let lightMs = 0;

                    for (const r of asleep) {
                        const ms = new Date(r.endDate).getTime() - new Date(r.startDate).getTime();
                        totalMs += ms;
                        if (r.value === 'ASLEEP_DEEP') deepMs += ms;
                        else if (r.value === 'ASLEEP_REM') remMs += ms;
                        else lightMs += ms; // ASLEEP + ASLEEP_CORE = light/unspecified
                    }

                    // Use the earliest start and latest end
                    const earliest = asleep.reduce((min, r) => r.startDate < min ? r.startDate : min, asleep[0].startDate);
                    const latest = asleep.reduce((max, r) => r.endDate > max ? r.endDate : max, asleep[0].endDate);
                    resolve({
                        startedAt: earliest,
                        endedAt: latest,
                        durationHours: Math.round((totalMs / 3600000) * 10) / 10,
                        deepHours: Math.round((deepMs / 3600000) * 10) / 10,
                        remHours: Math.round((remMs / 3600000) * 10) / 10,
                        lightHours: Math.round((lightMs / 3600000) * 10) / 10,
                    });
                },
            );
        });
    } catch (e) {
        console.warn('Failed to read Apple HealthKit sleep:', e);
        return null;
    }
}

async function iosGetHeartRateToday(): Promise<HeartRateSummary | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { default: AppleHealthKit } = require('react-native-health');
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        return new Promise((resolve) => {
            AppleHealthKit.getHeartRateSamples(
                { startDate: midnight.toISOString(), endDate: new Date().toISOString() },
                (err: string, results: Array<{ value: number }>) => {
                    if (err || !results || results.length === 0) return resolve(null);
                    const values = results.map(r => r.value);
                    const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
                    const max = Math.max(...values);
                    resolve({ avg, max, resting: 0 });
                },
            );
        });
    } catch {
        return null;
    }
}

async function iosGetCaloriesToday(): Promise<CalorieSummary | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { default: AppleHealthKit } = require('react-native-health');
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const opts = { startDate: midnight.toISOString(), endDate: new Date().toISOString() };

        const active = await new Promise<number>((resolve) => {
            AppleHealthKit.getActiveEnergyBurned(
                opts,
                (err: string, results: Array<{ value: number }>) => {
                    if (err || !results) return resolve(0);
                    resolve(results.reduce((s, r) => s + r.value, 0));
                },
            );
        });

        const basal = await new Promise<number>((resolve) => {
            AppleHealthKit.getBasalEnergyBurned(
                opts,
                (err: string, results: Array<{ value: number }>) => {
                    if (err || !results) return resolve(0);
                    resolve(results.reduce((s, r) => s + r.value, 0));
                },
            );
        });

        if (active === 0 && basal === 0) return null;
        return { active: Math.round(active), total: Math.round(active + basal) };
    } catch {
        return null;
    }
}

// ── Android (Health Connect via react-native-health-connect) ─────────────────

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

        // Steps
        let steps = 0;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { default: AHK } = require('react-native-health');
            steps = await new Promise<number>((resolve) => {
                AHK.getStepCount(
                    { startDate: start.toISOString(), endDate: end.toISOString() },
                    (err: string, r: { value: number }) => resolve(err ? 0 : r?.value ?? 0),
                );
            });
        } catch { /* ignore */ }

        // Workouts
        let activities: HealthActivity[] = [];
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { default: AHK } = require('react-native-health');
            activities = await new Promise<HealthActivity[]>((resolve) => {
                AHK.getSamples(
                    { startDate: start.toISOString(), endDate: end.toISOString(), type: 'Workout' },
                    (err: string, recs: Array<{ start: string; end: string; activityName: string; distance?: number }>) => {
                        if (err || !recs) return resolve([]);
                        resolve(recs.map(r => ({
                            type: (r.activityName || 'other').toLowerCase(),
                            startedAt: r.start,
                            durationMin: Math.round((new Date(r.end).getTime() - new Date(r.start).getTime()) / 60000),
                            distanceM: r.distance,
                        })));
                    },
                );
            });
        } catch { /* ignore */ }

        // Sleep (look from previous day 6pm to this day's end)
        let sleep: SleepSession | null = null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { default: AHK } = require('react-native-health');
            const sleepStart = new Date(start);
            sleepStart.setDate(sleepStart.getDate() - 1);
            sleepStart.setHours(18, 0, 0, 0);
            sleep = await new Promise<SleepSession | null>((resolve) => {
                AHK.getSleepSamples(
                    { startDate: sleepStart.toISOString(), endDate: end.toISOString() },
                    (err: string, recs: Array<{ startDate: string; endDate: string; value: string }>) => {
                        if (err || !recs || recs.length === 0) return resolve(null);
                        const asleep = recs.filter(r => r.value === 'ASLEEP' || r.value === 'ASLEEP_CORE' || r.value === 'ASLEEP_DEEP' || r.value === 'ASLEEP_REM');
                        if (asleep.length === 0) return resolve(null);
                        let totalMs = 0, deepMs = 0, remMs = 0, lightMs = 0;
                        for (const r of asleep) {
                            const ms = new Date(r.endDate).getTime() - new Date(r.startDate).getTime();
                            totalMs += ms;
                            if (r.value === 'ASLEEP_DEEP') deepMs += ms;
                            else if (r.value === 'ASLEEP_REM') remMs += ms;
                            else lightMs += ms;
                        }
                        const earliest = asleep.reduce((min, r) => r.startDate < min ? r.startDate : min, asleep[0].startDate);
                        const latest = asleep.reduce((max, r) => r.endDate > max ? r.endDate : max, asleep[0].endDate);
                        resolve({
                            startedAt: earliest,
                            endedAt: latest,
                            durationHours: Math.round((totalMs / 3600000) * 10) / 10,
                            deepHours: Math.round((deepMs / 3600000) * 10) / 10,
                            remHours: Math.round((remMs / 3600000) * 10) / 10,
                            lightHours: Math.round((lightMs / 3600000) * 10) / 10,
                        });
                    },
                );
            });
        } catch { /* ignore */ }

        // Heart rate
        let heartRate: HeartRateSummary | null = null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { default: AHK } = require('react-native-health');
            heartRate = await new Promise<HeartRateSummary | null>((resolve) => {
                AHK.getHeartRateSamples(
                    { startDate: start.toISOString(), endDate: end.toISOString() },
                    (err: string, recs: Array<{ value: number }>) => {
                        if (err || !recs || recs.length === 0) return resolve(null);
                        const vals = recs.map(r => r.value);
                        resolve({
                            avg: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length),
                            max: Math.max(...vals),
                            resting: 0,
                        });
                    },
                );
            });
        } catch { /* ignore */ }

        // Calories
        let calories: CalorieSummary | null = null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { default: AHK } = require('react-native-health');
            const opts = { startDate: start.toISOString(), endDate: end.toISOString() };
            const active = await new Promise<number>((resolve) => {
                AHK.getActiveEnergyBurned(opts, (err: string, r: Array<{ value: number }>) =>
                    resolve(err || !r ? 0 : r.reduce((s, x) => s + x.value, 0)));
            });
            const basal = await new Promise<number>((resolve) => {
                AHK.getBasalEnergyBurned(opts, (err: string, r: Array<{ value: number }>) =>
                    resolve(err || !r ? 0 : r.reduce((s, x) => s + x.value, 0)));
            });
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

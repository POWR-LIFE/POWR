import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

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
};

export type SleepSession = {
    startedAt: string;
    endedAt: string;
    durationHours: number;
};

export type HealthDataHook = {
    isAvailable: boolean;
    isAuthorized: boolean;
    requesting: boolean;
    requestPermissions: () => Promise<boolean>;
    getStepsToday: () => Promise<number>;
    getActivitiesToday: () => Promise<HealthActivity[]>;
    getLastNightSleep: () => Promise<SleepSession | null>;
    verifyWalking: (claimedSteps: number) => Promise<VerifyResult>;
    verifyWorkout: (activityType: string, durationMinutes: number) => Promise<VerifyResult>;
};

// ── iOS (HealthKit via react-native-health) ───────────────────────────────────

async function iosRequestPermissions(): Promise<boolean> {
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
                    const totalMs = asleep.reduce((sum, r) => {
                        return sum + (new Date(r.endDate).getTime() - new Date(r.startDate).getTime());
                    }, 0);
                    // Use the earliest start and latest end
                    const earliest = asleep.reduce((min, r) => r.startDate < min ? r.startDate : min, asleep[0].startDate);
                    const latest = asleep.reduce((max, r) => r.endDate > max ? r.endDate : max, asleep[0].endDate);
                    resolve({
                        startedAt: earliest,
                        endedAt: latest,
                        durationHours: Math.round((totalMs / 3600000) * 10) / 10,
                    });
                },
            );
        });
    } catch (e) {
        console.warn('Failed to read Apple HealthKit sleep:', e);
        return null;
    }
}

// ── Android (Health Connect via react-native-health-connect) ─────────────────

async function androidCheckAvailable(): Promise<boolean> {
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
async function androidCheckAlreadyGranted(): Promise<boolean> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, getGrantedPermissions } = require('react-native-health-connect');
        await initialize();
        const granted: Array<{ recordType: string; accessType: string }> = await getGrantedPermissions();
        return granted.some(p => p.recordType === 'Steps' && p.accessType === 'read');
    } catch {
        return false;
    }
}

async function androidRequestPermissions(): Promise<boolean> {
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
                startTime: midnight.toISOString(),
                endTime: new Date().toISOString(),
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
                startTime: start.toISOString(),
                endTime: new Date().toISOString(),
            },
        });
        const sessions = records as Array<{ startTime: string; endTime: string; stages?: Array<{ stage: number; startTime: string; endTime: string }> }>;
        if (!sessions || sessions.length === 0) return null;

        // Sum total sleep time from stages (stages 1-5 are actual sleep, 0=unknown, 6=awake)
        let totalMs = 0;
        let earliest = sessions[0].startTime;
        let latest = sessions[0].endTime;

        for (const s of sessions) {
            if (s.startTime < earliest) earliest = s.startTime;
            if (s.endTime > latest) latest = s.endTime;

            if (s.stages && s.stages.length > 0) {
                // Sum only sleeping stages (1=AWAKE_IN_BED, 2=LIGHT, 3=DEEP, 4=REM, 5=OUT_OF_BED)
                // Stages 2,3,4 are actual sleep
                for (const stage of s.stages) {
                    if (stage.stage >= 2 && stage.stage <= 4) {
                        totalMs += new Date(stage.endTime).getTime() - new Date(stage.startTime).getTime();
                    }
                }
            } else {
                // No stage data — use total session duration
                totalMs += new Date(s.endTime).getTime() - new Date(s.startTime).getTime();
            }
        }

        if (totalMs === 0) return null;

        return {
            startedAt: earliest,
            endedAt: latest,
            durationHours: Math.round((totalMs / 3600000) * 10) / 10,
        };
    } catch (e) {
        console.warn('[HealthData] androidGetLastNightSleep failed:', e);
        return null;
    }
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
                        if (granted) setIsAuthorized(true);
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

    return { isAvailable, isAuthorized, requesting, requestPermissions, getStepsToday, getActivitiesToday, getLastNightSleep, verifyWalking, verifyWorkout };
}

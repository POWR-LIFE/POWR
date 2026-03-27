import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

export type VerifyResult = {
    verified: boolean;
    actualValue: number;
    detail: string;
};

export type HealthDataHook = {
    isAvailable: boolean;
    isAuthorized: boolean;
    requesting: boolean;
    requestPermissions: () => Promise<boolean>;
    verifyWalking: (claimedSteps: number) => Promise<VerifyResult>;
    verifyWorkout: (activityType: string, durationMinutes: number) => Promise<VerifyResult>;
};

// ── iOS (HealthKit via react-native-health) ───────────────────────────────────

async function iosRequestPermissions(): Promise<boolean> {
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
                    ],
                    write: [],
                },
            },
            (error: string) => resolve(!error),
        );
    });
}

async function iosGetStepsToday(): Promise<number> {
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
}

async function iosGetWorkoutsToday(): Promise<Array<{ durationMin: number }>> {
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
            (err: string, results: Array<{ start: string; end: string }>) => {
                if (err || !results) return resolve([]);
                resolve(
                    results.map(r => ({
                        durationMin: Math.round(
                            (new Date(r.end).getTime() - new Date(r.start).getTime()) / 60000,
                        ),
                    })),
                );
            },
        );
    });
}

// ── Android (Health Connect via react-native-health-connect) ─────────────────

async function androidCheckAvailable(): Promise<boolean> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getSdkStatus, SdkAvailabilityStatus } = require('react-native-health-connect');
        const status = await getSdkStatus();
        return status === SdkAvailabilityStatus.SDK_AVAILABLE;
    } catch {
        return false;
    }
}

async function androidRequestPermissions(): Promise<boolean> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, requestPermission } = require('react-native-health-connect');
        await initialize();
        const granted: unknown[] = await requestPermission([
            { accessType: 'read', recordType: 'Steps' },
            { accessType: 'read', recordType: 'Distance' },
            { accessType: 'read', recordType: 'ExerciseSession' },
        ]);
        return granted.length > 0;
    } catch {
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

async function androidGetWorkoutsToday(): Promise<Array<{ durationMin: number }>> {
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
        return (records as Array<{ startTime: string; endTime: string }>).map(r => ({
            durationMin: Math.round(
                (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000,
            ),
        }));
    } catch {
        return [];
    }
}

// ── Unified hook ──────────────────────────────────────────────────────────────

const UNAVAILABLE: HealthDataHook = {
    isAvailable: false,
    isAuthorized: false,
    requesting: false,
    requestPermissions: async () => false,
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
            androidCheckAvailable().then(setIsAvailable);
        } else {
            setIsAvailable(true); // HealthKit is always present on iOS devices
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

    /** Verify a walking session by comparing claimed steps to today's step count. */
    const verifyWalking = useCallback(async (claimedSteps: number): Promise<VerifyResult> => {
        const actual = Platform.OS === 'ios'
            ? await iosGetStepsToday()
            : await androidGetStepsToday();
        const verified = actual >= Math.floor(claimedSteps * 0.85);
        return {
            verified,
            actualValue: actual,
            detail: verified
                ? `${actual.toLocaleString()} steps found today`
                : `Only ${actual.toLocaleString()} steps found`,
        };
    }, []);

    /** Verify a workout session by looking for a matching duration in today's workouts. */
    const verifyWorkout = useCallback(async (_activityType: string, durationMinutes: number): Promise<VerifyResult> => {
        const workouts = Platform.OS === 'ios'
            ? await iosGetWorkoutsToday()
            : await androidGetWorkoutsToday();
        const match = workouts.find(w => w.durationMin >= Math.floor(durationMinutes * 0.7));
        return {
            verified: !!match,
            actualValue: match?.durationMin ?? 0,
            detail: match
                ? `${match.durationMin} min workout found today`
                : `No matching workout found (looking for ~${durationMinutes} min)`,
        };
    }, []);

    if (!isNative) return UNAVAILABLE;

    return { isAvailable, isAuthorized, requesting, requestPermissions, verifyWalking, verifyWorkout };
}

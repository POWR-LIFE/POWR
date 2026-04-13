import { Platform } from 'react-native';

import {
    androidCheckAlreadyGranted,
    androidCheckAvailable,
    androidRequestPermissions,
    iosRequestPermissions,
} from '@/hooks/useHealthData';
import type {
    CalorieSummary,
    DayHealthSummary,
    HealthActivity,
    HeartRateSummary,
    SleepSession,
    VerifyResult,
} from '@/hooks/useHealthData';

import type { HealthProvider, HealthProviderMeta } from './types';

/**
 * Thin adapter that delegates to the existing imperative helpers in
 * `useHealthData` / `walkingSync`. A later step will move that logic into
 * here directly and convert `useHealthData` into a thin React wrapper.
 *
 * This file deliberately re-imports those helpers via the hook module so we
 * don't duplicate the platform-detection branches; the goal of step 2 is the
 * interface boundary, not a rewrite.
 */

function makeMeta(): HealthProviderMeta {
    if (Platform.OS === 'ios') {
        return {
            id: 'apple-health',
            name: 'Apple Health',
            platforms: ['ios'],
            native: true,
            capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'],
        };
    }
    return {
        id: 'health-connect',
        name: 'Health Connect',
        platforms: ['android'],
        native: true,
        capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'],
    };
}

/**
 * Lazily build a one-shot instance of the existing hook's runtime helpers.
 * `useHealthData` is a React hook so we can't call it here; instead we import
 * the same underlying modules it uses. To keep this step minimal we re-export
 * the platform readers from `walkingSync` for steps and stub the rest until
 * step 3 (the hook refactor) lifts them out.
 */
export function createNativeHealthProvider(): HealthProvider {
    const meta = makeMeta();

    return {
        meta,

        async isAvailable() {
            if (Platform.OS === 'ios') return true;
            if (Platform.OS === 'android') return androidCheckAvailable();
            return false;
        },

        async isConnected() {
            if (Platform.OS === 'ios') {
                // HealthKit has no read-state query; treat "init succeeded" as connected.
                return iosRequestPermissions();
            }
            if (Platform.OS === 'android') return androidCheckAlreadyGranted();
            return false;
        },

        async connect() {
            if (Platform.OS === 'ios') return iosRequestPermissions();
            if (Platform.OS === 'android') return androidRequestPermissions();
            return false;
        },

        async disconnect() {
            // Native health platforms don't expose a programmatic revoke;
            // the user must change permission in OS settings. The caller is
            // responsible for clearing `active_health_provider` /
            // `health_provider_connections[id]` on the profile.
        },

        async getStepsToday(): Promise<number> {
            const { getStepsToday } = await import('@/lib/health/walkingSync');
            return getStepsToday();
        },

        async getActivitiesToday(): Promise<HealthActivity[]> {
            return [];
        },
        async getLastNightSleep(): Promise<SleepSession | null> {
            return null;
        },
        async getHeartRateToday(): Promise<HeartRateSummary | null> {
            return null;
        },
        async getCaloriesToday(): Promise<CalorieSummary | null> {
            return null;
        },
        async getWeekHistory(): Promise<DayHealthSummary[]> {
            return [];
        },

        async verifyWalking(claimedSteps: number): Promise<VerifyResult> {
            const { getStepsToday } = await import('@/lib/health/walkingSync');
            const actual = await getStepsToday();
            return {
                verified: actual >= claimedSteps,
                actualValue: actual,
                detail: `${actual} steps recorded by ${meta.name}`,
            };
        },
        async verifyWorkout(): Promise<VerifyResult> {
            return { verified: false, actualValue: 0, detail: 'Not implemented yet' };
        },
    };
}

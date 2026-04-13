import type { HealthProvider, HealthProviderMeta } from './types';
import { HealthProviderNotImplementedError } from './types';

const META: HealthProviderMeta = {
    id: 'fitbit',
    name: 'Fitbit',
    native: false,
    capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'],
};

/**
 * Stub. The real implementation lands in PR 2 and will:
 *   - run an Expo AuthSession PKCE flow against Fitbit OAuth 2.0
 *   - exchange / refresh tokens via a Supabase edge function (client secret stays server-side)
 *   - persist tokens in SecureStore
 *   - call the Fitbit Web API for steps / sleep / activities / heart rate
 */
export function createFitbitProvider(): HealthProvider {
    const notImpl = (op: string) => {
        throw new HealthProviderNotImplementedError('fitbit', op);
    };

    return {
        meta: META,
        async isAvailable() { return true; },
        async isConnected() { return false; },
        async connect() { notImpl('connect'); return false; },
        async disconnect() { /* no-op until tokens exist */ },
        async getStepsToday() { notImpl('getStepsToday'); return 0; },
        async getActivitiesToday() { notImpl('getActivitiesToday'); return []; },
        async getLastNightSleep() { notImpl('getLastNightSleep'); return null; },
        async getHeartRateToday() { notImpl('getHeartRateToday'); return null; },
        async getCaloriesToday() { notImpl('getCaloriesToday'); return null; },
        async getWeekHistory() { notImpl('getWeekHistory'); return []; },
        async verifyWalking() { notImpl('verifyWalking'); return { verified: false, actualValue: 0, detail: '' }; },
        async verifyWorkout() { notImpl('verifyWorkout'); return { verified: false, actualValue: 0, detail: '' }; },
    };
}

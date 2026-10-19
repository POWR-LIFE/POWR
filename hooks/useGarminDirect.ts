import { useSyncExternalStore } from 'react';

import { isGarminDirectAvailable, subscribeGarminDirect } from '@/lib/health/garminDirect';

/**
 * Re-renders when the Garmin direct switch changes (lib/health/garminDirect),
 * so screens that check isPausedProvider('garmin') pick up a flip without a reload.
 */
export function useGarminDirect(): boolean {
    return useSyncExternalStore(subscribeGarminDirect, isGarminDirectAvailable, isGarminDirectAvailable);
}

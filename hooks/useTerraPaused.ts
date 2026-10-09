import { useSyncExternalStore } from 'react';

import { isTerraPaused, subscribeTerraPause } from '@/lib/health/terraPause';

/**
 * Re-renders when the Terra pause switch changes (lib/health/terraPause), so
 * screens that check isPausedProvider() pick up a flip without a reload.
 */
export function useTerraPaused(): boolean {
    return useSyncExternalStore(subscribeTerraPause, isTerraPaused, isTerraPaused);
}

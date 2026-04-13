import { Platform } from 'react-native';

import { createFitbitProvider } from './fitbitProvider';
import { createNativeHealthProvider } from './nativeProvider';
import type { HealthProvider, HealthProviderId, HealthProviderMeta } from './types';

export type { HealthProvider, HealthProviderId, HealthProviderMeta } from './types';
export { HealthProviderNotImplementedError } from './types';

/** All providers known to the app, in the order they should appear in UI. */
export const ALL_PROVIDER_META: HealthProviderMeta[] = [
    {
        id: 'apple-health',
        name: 'Apple Health',
        platforms: ['ios'],
        native: true,
        capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'],
    },
    {
        id: 'health-connect',
        name: 'Health Connect',
        platforms: ['android'],
        native: true,
        capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'],
    },
    {
        id: 'fitbit',
        name: 'Fitbit',
        native: false,
        capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'],
    },
    { id: 'whoop',  name: 'Whoop',  native: false, capabilities: ['sleep', 'heart-rate'] },
    { id: 'garmin', name: 'Garmin', native: false, capabilities: ['steps', 'activities', 'heart-rate'] },
];

/** Providers visible on the current platform. */
export function visibleProviders(): HealthProviderMeta[] {
    const os = Platform.OS as 'ios' | 'android' | 'web';
    return ALL_PROVIDER_META.filter(p => !p.platforms || p.platforms.includes(os));
}

/** Factory: returns a fresh provider instance for the given id. */
export function getProvider(id: HealthProviderId): HealthProvider {
    switch (id) {
        case 'apple-health':
        case 'health-connect':
            return createNativeHealthProvider();
        case 'fitbit':
            return createFitbitProvider();
        case 'whoop':
        case 'garmin':
            // Not yet stubbed — fall through to throw below.
            break;
    }
    throw new Error(`Unknown or unimplemented health provider: ${id}`);
}

/** The native provider for this OS, or null on web. */
export function getNativeProviderId(): HealthProviderId | null {
    if (Platform.OS === 'ios') return 'apple-health';
    if (Platform.OS === 'android') return 'health-connect';
    return null;
}

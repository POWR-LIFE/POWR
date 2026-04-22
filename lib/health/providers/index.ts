import { Platform } from 'react-native';

import type { ActivityType } from '@/constants/activities';
import { createFitbitProvider } from './fitbitProvider';
import { createNativeHealthProvider } from './nativeProvider';
import { createWhoopProvider } from './whoopProvider';
import type { HealthProvider, HealthProviderId, HealthProviderMeta } from './types';

export type { HealthProvider, HealthProviderId, HealthProviderMeta } from './types';
export { HealthProviderNotImplementedError, ProviderAuthExpiredError } from './types';

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
    { id: 'whoop',  name: 'Whoop',  native: false, capabilities: ['activities', 'sleep', 'heart-rate', 'calories'] },
    { id: 'garmin', name: 'Garmin', native: false, capabilities: ['steps', 'activities', 'heart-rate'] },
];

/**
 * Which activity types each provider can auto-detect. Activities not listed
 * fall back to manual logging in the UI. `gym` and `hiit` are absent from
 * every provider here because they're verified by geofence, not the wearable
 * — see `PHONE_ONLY_SUPPORT` below.
 */
export const PROVIDER_ACTIVITY_SUPPORT: Record<HealthProviderId, ActivityType[]> = {
    'apple-health':   ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'dance', 'sleep'],
    'health-connect': ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'dance', 'sleep'],
    'fitbit':         ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'dance', 'sleep'],
    'whoop':          ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'dance', 'sleep'],
    'garmin':         ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga'],
};

/** Activities that work with no wearable connected (GPS or geofence on the phone). */
export const PHONE_ONLY_SUPPORT: ActivityType[] = ['walking', 'running', 'cycling', 'gym', 'hiit'];

/** Activities that are always manual-only regardless of provider. */
export const ALWAYS_MANUAL: ActivityType[] = [];

/**
 * Compute the set of activities that can be auto-tracked given a list of
 * connected providers. `gym` and `hiit` are always included (geofence-verified
 * — independent of any wearable).
 */
export function supportedActivitiesFor(connectedIds: HealthProviderId[]): Set<ActivityType> {
    const out = new Set<ActivityType>(PHONE_ONLY_SUPPORT);
    for (const id of connectedIds) {
        for (const a of PROVIDER_ACTIVITY_SUPPORT[id] ?? []) out.add(a);
    }
    return out;
}

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
            return createWhoopProvider();
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

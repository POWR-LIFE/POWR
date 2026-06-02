import { Platform } from 'react-native';

import type { ActivityType } from '@/constants/activities';
import { createFitbitProvider } from './fitbitProvider';
import { createNativeHealthProvider } from './nativeProvider';
import { createSamsungHealthProvider } from './samsungHealthProvider';
import { createWhoopProvider } from './whoopProvider';
import type { HealthProvider, HealthProviderId, HealthProviderMeta } from './types';
import { HealthProviderNotImplementedError } from './types';

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
    { id: 'garmin', name: 'Garmin', native: false, capabilities: ['steps', 'activities', 'heart-rate'], hidden: true },
    {
        id: 'samsung-health',
        name: 'Samsung Health',
        platforms: ['android'],
        native: false,
        capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'],
        hidden: true,
    },
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
    'samsung-health': ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'dance', 'sleep'],
};

/** Activities that work with no wearable connected (GPS or geofence on the phone). */
export const PHONE_ONLY_SUPPORT: ActivityType[] = ['walking', 'running', 'cycling', 'gym', 'hiit'];

/**
 * Dedicated wearable providers whose data genuinely originates from a worn
 * device (band/watch). Native phone sources (Apple Health / Health Connect) and
 * phone-side aggregators (Samsung Health) report the phone's own motion sensors,
 * so a connection to them does NOT imply a wearable.
 */
export const WEARABLE_PROVIDERS: HealthProviderId[] = ['fitbit', 'whoop', 'garmin'];

/**
 * The verification source to stamp on a session synced from `id`. Returns
 * 'wearable' only for dedicated wearable providers; everything else (native
 * phone health, aggregators, no provider) is 'health'. Keeps the "wearable
 * verified" label honest — see migration 20260601000002.
 */
export function verificationForProvider(id: HealthProviderId | null): 'wearable' | 'health' {
    return id !== null && WEARABLE_PROVIDERS.includes(id) ? 'wearable' : 'health';
}

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

/** Providers visible on the current platform (excludes hidden ones). */
export function visibleProviders(): HealthProviderMeta[] {
    const os = Platform.OS as 'ios' | 'android' | 'web';
    return ALL_PROVIDER_META.filter(p => !p.hidden && (!p.platforms || p.platforms.includes(os)));
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
        case 'samsung-health':
            return createSamsungHealthProvider();
        case 'garmin':
            throw new HealthProviderNotImplementedError('garmin', 'connect');
    }
    throw new HealthProviderNotImplementedError(id, 'connect');
}

/** The native provider for this OS, or null on web. */
export function getNativeProviderId(): HealthProviderId | null {
    if (Platform.OS === 'ios') return 'apple-health';
    if (Platform.OS === 'android') return 'health-connect';
    return null;
}

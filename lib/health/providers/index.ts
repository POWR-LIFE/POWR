import { Platform } from 'react-native';

import type { ActivityType } from '@/constants/activities';
import { createNativeHealthProvider } from './nativeProvider';
import { createSamsungHealthProvider } from './samsungHealthProvider';
import { createTerraProvider } from './terraProvider';
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
        transport: 'native',
        capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'],
    },
    {
        id: 'health-connect',
        name: 'Health Connect',
        platforms: ['android'],
        native: true,
        transport: 'native',
        capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'],
    },
    // ── Cloud wearables via Terra (data arrives server-side via terra-webhook) ──
    { id: 'whoop',  name: 'Whoop',  native: false, transport: 'terra', capabilities: ['activities', 'sleep', 'heart-rate', 'calories'] },
    { id: 'oura',   name: 'Oura',   native: false, transport: 'terra', capabilities: ['steps', 'activities', 'sleep', 'heart-rate'] },
    { id: 'polar',  name: 'Polar',  native: false, transport: 'terra', capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'] },
    { id: 'garmin', name: 'Garmin', native: false, transport: 'terra', capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'] },
    { id: 'fitbit', name: 'Fitbit', native: false, transport: 'terra', capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'] },
    { id: 'strava', name: 'Strava', native: false, transport: 'terra', capabilities: ['activities', 'heart-rate'] },
    { id: 'huawei', name: 'Huawei Health', native: false, transport: 'terra', capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'] },
    { id: 'withings',  name: 'Withings',  native: false, transport: 'terra', capabilities: ['steps', 'activities', 'sleep', 'heart-rate'] },
    { id: 'peloton',   name: 'Peloton',   native: false, transport: 'terra', capabilities: ['activities', 'heart-rate', 'calories'] },
    { id: 'zepp',      name: 'Zepp',      native: false, transport: 'terra', capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'] },
    { id: 'technogym', name: 'Technogym', native: false, transport: 'terra', capabilities: ['activities', 'heart-rate', 'calories'] },
    { id: 'coros',     name: 'Coros',     native: false, transport: 'terra', capabilities: ['steps', 'activities', 'sleep', 'heart-rate', 'calories'] },
    { id: 'suunto',    name: 'Suunto',    native: false, transport: 'terra', capabilities: ['activities', 'sleep', 'heart-rate'] },
    { id: 'wahoo',     name: 'Wahoo',     native: false, transport: 'terra', capabilities: ['activities', 'heart-rate'] },
    { id: 'zwift',     name: 'Zwift',     native: false, transport: 'terra', capabilities: ['activities', 'heart-rate'] },
    { id: 'concept2',  name: 'Concept2',  native: false, transport: 'terra', capabilities: ['activities', 'heart-rate'] },
    { id: 'ifit',      name: 'iFit',      native: false, transport: 'terra', capabilities: ['activities', 'heart-rate', 'calories'] },
    { id: 'underarmour', name: 'Under Armour', native: false, transport: 'terra', capabilities: ['steps', 'activities', 'heart-rate'] },
    {
        id: 'samsung-health',
        name: 'Samsung Health',
        platforms: ['android'],
        native: false,
        transport: 'native',
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
    'strava':         ['running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga'],
    'whoop':          ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'dance', 'sleep'],
    'oura':           ['walking', 'running', 'cycling', 'swimming', 'sports', 'sleep'],
    'polar':          ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'sleep'],
    'garmin':         ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'sleep'],
    'huawei':         ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'dance', 'sleep'],
    'withings':       ['walking', 'running', 'cycling', 'swimming', 'sleep'],
    'peloton':        ['running', 'cycling', 'gym', 'hiit', 'yoga'],
    'zepp':           ['walking', 'running', 'cycling', 'swimming', 'gym', 'hiit', 'sports', 'yoga', 'sleep'],
    'technogym':      ['running', 'cycling', 'gym', 'hiit', 'sports'],
    'coros':          ['walking', 'running', 'cycling', 'swimming', 'sports', 'sleep'],
    'suunto':         ['walking', 'running', 'cycling', 'swimming', 'sports', 'sleep'],
    'wahoo':          ['running', 'cycling', 'sports'],
    'zwift':          ['running', 'cycling'],
    'concept2':       ['cycling', 'gym', 'hiit'],
    'ifit':           ['running', 'cycling', 'gym', 'hiit'],
    'underarmour':    ['walking', 'running', 'cycling'],
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
export const WEARABLE_PROVIDERS: HealthProviderId[] = ['fitbit', 'strava', 'whoop', 'garmin', 'polar', 'oura', 'huawei', 'withings', 'peloton', 'zepp', 'technogym', 'coros', 'suunto', 'wahoo', 'zwift', 'concept2', 'ifit', 'underarmour'];

/**
 * Providers whose data is delivered server-side by Terra (terra-webhook) rather
 * than pulled on-device. The client only drives their connect/disconnect flow;
 * it must NOT attempt a data pull for these. See useHealthSync.
 */
export function isTerraProvider(id: HealthProviderId | null): boolean {
    if (!id) return false;
    return ALL_PROVIDER_META.find(m => m.id === id)?.transport === 'terra';
}

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
        case 'samsung-health':
            return createSamsungHealthProvider();
        case 'whoop':
        case 'oura':
        case 'polar':
        case 'garmin':
        case 'fitbit':
        case 'strava':
        case 'huawei':
        case 'withings':
        case 'peloton':
        case 'zepp':
        case 'technogym':
        case 'coros':
        case 'suunto':
        case 'wahoo':
        case 'zwift':
        case 'concept2':
        case 'ifit':
        case 'underarmour': {
            const meta = ALL_PROVIDER_META.find(m => m.id === id)!;
            return createTerraProvider(meta);
        }
    }
    throw new HealthProviderNotImplementedError(id, 'connect');
}

/** The native provider for this OS, or null on web. */
export function getNativeProviderId(): HealthProviderId | null {
    if (Platform.OS === 'ios') return 'apple-health';
    if (Platform.OS === 'android') return 'health-connect';
    return null;
}

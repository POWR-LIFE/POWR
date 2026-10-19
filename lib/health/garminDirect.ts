/**
 * The Garmin direct rollout switch, app side — whether this user may connect
 * Garmin through POWR's own Garmin app (garmin-auth / garmin-webhook) rather
 * than syncing it through their phone. Decided on the server by
 * garmin_direct_available() from system_config 'garmin_direct' (migration
 * 20261019120000_garmin_direct): off, testers, or on.
 *
 * Unavailable, Garmin counts as paused (isPausedProvider in
 * lib/health/providers): its tile opens the "sync through your phone" sheet,
 * and a profile that still names Garmin is read from Apple Health / Health
 * Connect instead (effectiveProviderId). Nothing is written to the profile,
 * so switching it back restores the link.
 *
 * Same shape as lib/health/terraPause: in memory for the synchronous checks,
 * cached in AsyncStorage for cold and headless starts, refreshed from the
 * server by lib/health/garminDirectRemote. The default is unavailable — the
 * phone route always works.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = '@powr/garmin_direct';

let available = false;
let hydrated = false;
const listeners = new Set<() => void>();

/** Whether this user can use Garmin direct, as last known. Synchronous. */
export function isGarminDirectAvailable(): boolean {
    return available;
}

/** Records a new value: notifies subscribers and caches it for the next cold start. */
export function setGarminDirectAvailable(next: boolean): void {
    hydrated = true;
    if (next === available) return;
    available = next;
    AsyncStorage.setItem(CACHE_KEY, next ? '1' : '0').catch(() => {});
    listeners.forEach(fn => fn());
}

/** Loads the cached value once per JS context (headless tasks start fresh). */
export async function hydrateGarminDirect(): Promise<boolean> {
    if (hydrated) return available;
    try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (!hydrated && cached != null) {
            const next = cached === '1';
            if (next !== available) {
                available = next;
                listeners.forEach(fn => fn());
            }
        }
    } catch { /* storage unavailable — keep the default */ }
    hydrated = true;
    return available;
}

export function subscribeGarminDirect(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

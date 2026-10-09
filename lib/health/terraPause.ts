/**
 * The Terra pause switch, app side — system_config 'terra_paused', set by an
 * admin (migration 20261009120000_terra_pause_switch).
 *
 * While it is on, every Terra brand counts as paused (isPausedProvider in
 * lib/health/providers): its connect tile opens the "sync through your phone"
 * sheet, and a user whose profile still names it as the active source is read
 * from Apple Health / Health Connect instead (effectiveProviderId). Nothing is
 * written to anyone's profile, so turning the switch back off restores Terra
 * exactly as it was for everyone not yet disconnected. Garmin's own `paused`
 * flag in the provider list is separate and permanent until a release lifts it.
 *
 * The value lives in memory for the synchronous checks, is cached in
 * AsyncStorage so a cold or headless start keeps the last answer, and is
 * refreshed from the server by lib/health/terraPauseRemote. Any failure keeps
 * the last known value — Terra still running is the safe default.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = '@powr/terra_paused';

let paused = false;
let hydrated = false;
const listeners = new Set<() => void>();

/** Lenient read of system_config's text value — mirrors the edge functions' check. */
export function isPausedValue(value: unknown): boolean {
    return typeof value === 'string' && ['true', '1', 'on', 'yes'].includes(value.trim().toLowerCase());
}

/** Whether Terra is paused, as last known. Synchronous — safe in render and in filters. */
export function isTerraPaused(): boolean {
    return paused;
}

/** Records a new value: notifies subscribers and caches it for the next cold start. */
export function setTerraPaused(next: boolean): void {
    hydrated = true;
    if (next === paused) return;
    paused = next;
    AsyncStorage.setItem(CACHE_KEY, next ? '1' : '0').catch(() => {});
    listeners.forEach(fn => fn());
}

/**
 * Loads the cached value once per JS context — headless tasks run in a fresh
 * one and must not fall back to "not paused" just because no screen has
 * fetched yet. A no-op after the first load or any server read.
 */
export async function hydrateTerraPause(): Promise<boolean> {
    if (hydrated) return paused;
    try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (!hydrated && cached != null) {
            const next = cached === '1';
            if (next !== paused) {
                paused = next;
                listeners.forEach(fn => fn());
            }
        }
    } catch { /* storage unavailable — keep the default */ }
    hydrated = true;
    return paused;
}

export function subscribeTerraPause(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

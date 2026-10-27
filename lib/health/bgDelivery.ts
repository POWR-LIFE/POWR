/**
 * The health background-delivery switch, app side — system_config
 * 'health_bg_delivery' (migration 20261027180000_series_board_live_tick).
 *
 * While it is on (the default), the app asks HealthKit to wake it the moment
 * a workout or a night's sleep is written, and syncs straight away
 * (lib/health/healthKitObserver). Off stands that down without a release:
 * the next foreground read clears the registrations, and a cold start armed
 * from the cached value stays quiet too. Same shape as the Terra pause
 * (lib/health/terraPause): memory for synchronous checks, AsyncStorage for
 * cold and headless starts, the server read from the foreground hook.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

const CACHE_KEY = '@powr/health_bg_delivery';

let on = true;
let hydrated = false;

/** Lenient read of system_config's text value. Anything but an explicit off is on. */
export function isOnValue(value: unknown): boolean {
    if (typeof value !== 'string') return true;
    return !['false', '0', 'off', 'no'].includes(value.trim().toLowerCase());
}

/** Whether background delivery is wanted, as last known. Synchronous. */
export function isBgDeliveryOn(): boolean {
    return on;
}

export function setBgDeliveryOn(next: boolean): void {
    hydrated = true;
    if (next === on) return;
    on = next;
    AsyncStorage.setItem(CACHE_KEY, next ? '1' : '0').catch(() => {});
}

/** Loads the cached value once per JS context. A no-op after the first load or any server read. */
export async function hydrateBgDelivery(): Promise<boolean> {
    if (hydrated) return on;
    try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (!hydrated && cached != null) on = cached === '1';
    } catch { /* storage unavailable — keep the default */ }
    hydrated = true;
    return on;
}

/** Cached value first, then the server's. A failed read keeps the last known value. */
export async function refreshBgDelivery(): Promise<boolean> {
    await hydrateBgDelivery();
    try {
        const { data, error } = await supabase
            .from('system_config')
            .select('value')
            .eq('key', 'health_bg_delivery')
            .maybeSingle();
        if (!error && data) setBgDeliveryOn(isOnValue(data.value));
    } catch { /* offline — keep the last known value */ }
    return on;
}

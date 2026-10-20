/**
 * Reads the Garmin direct switch from the server — see lib/health/garminDirect.
 * Separate from it so the provider list can check the value without pulling
 * in the Supabase client.
 */

import { supabase } from '@/lib/supabase';

import { hydrateGarminDirect, isGarminDirectAvailable, setGarminDirectAvailable } from './garminDirect';

/** Cached value first, then the server's. A failed read keeps the last known value. */
export async function refreshGarminDirect(): Promise<boolean> {
    await hydrateGarminDirect();
    try {
        const { data, error } = await supabase.rpc('garmin_direct_available');
        if (!error && typeof data === 'boolean') setGarminDirectAvailable(data);
    } catch { /* offline — keep the last known value */ }
    return isGarminDirectAvailable();
}

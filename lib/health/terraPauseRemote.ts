/**
 * Reads the Terra pause switch from the server — see lib/health/terraPause.
 * Separate from it so the provider list can check the value without pulling
 * in the Supabase client.
 */

import { supabase } from '@/lib/supabase';

import { hydrateTerraPause, isPausedValue, isTerraPaused, setTerraPaused } from './terraPause';

/**
 * Cached value first, then the server's. A failed read keeps the last known
 * value rather than guessing either way.
 */
export async function refreshTerraPause(): Promise<boolean> {
    await hydrateTerraPause();
    try {
        const { data, error } = await supabase
            .from('system_config')
            .select('value')
            .eq('key', 'terra_paused')
            .maybeSingle();
        if (!error && data) setTerraPaused(isPausedValue(data.value));
    } catch { /* offline — keep the last known value */ }
    return isTerraPaused();
}

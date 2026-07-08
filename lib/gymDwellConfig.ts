import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

// Admin-tunable gym dwell threshold (system_config → min_gym_dwell_minutes):
// the minutes a user must stay inside a partner gym geofence before a check-in
// locks in the base gym point.
//
// The AUTHORITATIVE gate lives server-side in claim-points. The client reads the
// same value only so its dwell timer + home progress ring match what the server
// rewards (if the client fired the claim too early the server would reject it as
// too_short; too late and the ring would lie). On any failure everything falls
// back to the historical 30.
//
// Background/headless geofence code (context/GeofenceContext) runs in a separate
// JS context with no live network, so it must read a cached value synchronously.
// The foreground app calls refreshGymDwellMinutes() at launch to fetch + persist
// the latest; primeGymDwellMinutes() loads the last-persisted value into memory.

export const DEFAULT_GYM_DWELL_MIN = 30;
const CACHE_KEY = '@powr/min_gym_dwell_minutes';

// In-memory last-known value. Read synchronously by getGymDwellMinutes() so the
// geofence dwell constants can consume it without awaiting.
let cachedMinutes = DEFAULT_GYM_DWELL_MIN;

const parse = (raw: string | null | undefined): number | null => {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Synchronous last-known threshold in minutes. Defaults to 30 until primed. */
export function getGymDwellMinutes(): number {
  return cachedMinutes;
}

/** Same value in milliseconds — convenient for dwell timers. */
export function getGymDwellMs(): number {
  return cachedMinutes * 60 * 1000;
}

/** Load the last-persisted value from AsyncStorage into memory. Cheap; safe to
 *  call from a headless task startup so it has a value before the first fix. */
export async function primeGymDwellMinutes(): Promise<number> {
  try {
    const n = parse(await AsyncStorage.getItem(CACHE_KEY));
    if (n != null) cachedMinutes = n;
  } catch {
    /* keep default */
  }
  return cachedMinutes;
}

/** Fetch the current threshold from system_config, update memory + persist it.
 *  Call at app launch (foreground, has network). Falls back silently. */
export async function refreshGymDwellMinutes(): Promise<number> {
  try {
    const { data } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'min_gym_dwell_minutes')
      .maybeSingle();
    const n = parse(data?.value);
    if (n != null) {
      cachedMinutes = n;
      await AsyncStorage.setItem(CACHE_KEY, String(n));
    }
  } catch {
    /* keep last-known / default */
  }
  return cachedMinutes;
}

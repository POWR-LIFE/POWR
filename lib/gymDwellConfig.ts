import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

// Admin-tunable gym timers (system_config):
//  - min_gym_dwell_minutes: the minutes a user must stay inside a partner gym
//    geofence before a check-in locks in the base gym point.
//  - gym_upgrade_minutes: the minutes a session must reach to unlock the
//    upgrade tier (20 base pts vs 15) — drives the "stay Xm to unlock" copy.
//
// The AUTHORITATIVE gates live server-side in claim-points / upgrade-gym-tier.
// The client reads the same values only so its timers, home progress ring and
// upsell copy match what the server rewards (if the client fired a claim or
// upgrade too early the server would reject it; too late and the UI would lie).
// On any failure everything falls back to the historical 30 / 40.
//
// Background/headless geofence code (context/GeofenceContext) runs in a separate
// JS context with no live network, so it must read cached values synchronously.
// The foreground app calls refreshGymDwellMinutes() at launch to fetch + persist
// the latest; primeGymDwellMinutes() loads the last-persisted values into memory.

export const DEFAULT_GYM_DWELL_MIN = 30;
export const DEFAULT_GYM_UPGRADE_MIN = 40;
const CACHE_KEY = '@powr/min_gym_dwell_minutes';
const UPGRADE_CACHE_KEY = '@powr/gym_upgrade_minutes';

// In-memory last-known values. Read synchronously by the getters so the
// geofence dwell/upgrade constants can consume them without awaiting.
let cachedMinutes = DEFAULT_GYM_DWELL_MIN;
let cachedUpgradeMinutes = DEFAULT_GYM_UPGRADE_MIN;

const parse = (raw: string | null | undefined): number | null => {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Synchronous last-known dwell threshold in minutes. Defaults to 30 until primed. */
export function getGymDwellMinutes(): number {
  return cachedMinutes;
}

/** Same value in milliseconds — convenient for dwell timers. */
export function getGymDwellMs(): number {
  return cachedMinutes * 60 * 1000;
}

/** Synchronous last-known upgrade-tier threshold in minutes. Defaults to 40 until primed. */
export function getGymUpgradeMinutes(): number {
  return cachedUpgradeMinutes;
}

/** Same value in milliseconds — convenient for upgrade timers. */
export function getGymUpgradeMs(): number {
  return cachedUpgradeMinutes * 60 * 1000;
}

/** Load the last-persisted values from AsyncStorage into memory. Cheap; safe to
 *  call from a headless task startup so it has values before the first fix. */
export async function primeGymDwellMinutes(): Promise<number> {
  try {
    const [dwell, upgrade] = await AsyncStorage.multiGet([CACHE_KEY, UPGRADE_CACHE_KEY]);
    const d = parse(dwell?.[1]);
    if (d != null) cachedMinutes = d;
    const u = parse(upgrade?.[1]);
    if (u != null) cachedUpgradeMinutes = u;
  } catch {
    /* keep defaults */
  }
  return cachedMinutes;
}

/** Fetch the current thresholds from system_config, update memory + persist.
 *  Call at app launch (foreground, has network). Falls back silently. */
export async function refreshGymDwellMinutes(): Promise<number> {
  try {
    const { data } = await supabase
      .from('system_config')
      .select('key, value')
      .in('key', ['min_gym_dwell_minutes', 'gym_upgrade_minutes']);
    const pairs: [string, string][] = [];
    for (const row of data ?? []) {
      const n = parse(row.value);
      if (n == null) continue;
      if (row.key === 'min_gym_dwell_minutes') {
        cachedMinutes = n;
        pairs.push([CACHE_KEY, String(n)]);
      } else if (row.key === 'gym_upgrade_minutes') {
        cachedUpgradeMinutes = n;
        pairs.push([UPGRADE_CACHE_KEY, String(n)]);
      }
    }
    if (pairs.length > 0) await AsyncStorage.multiSet(pairs);
  } catch {
    /* keep last-known / defaults */
  }
  return cachedMinutes;
}

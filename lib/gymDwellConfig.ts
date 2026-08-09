import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

// Admin-tunable gym geofence settings (system_config):
//  - min_gym_dwell_minutes: the minutes a user must stay inside a partner gym
//    geofence before a check-in locks in the base gym point.
//  - gym_upgrade_minutes: the minutes a session must reach to unlock the
//    upgrade tier (20 base pts vs 15) — drives the "stay Xm to unlock" copy.
//  - location_close_mode: staged rollout for the location-off session close
//    ('off' | 'observe' | 'on'). Lives HERE rather than in its own module on
//    purpose — the three headless prime sites in GeofenceContext already call
//    primeGymDwellMinutes(), and a background context that reads a stale mode
//    is exactly the bug a second module would eventually introduce.
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
const CLOSE_MODE_CACHE_KEY = '@powr/location_close_mode';

/** Staged rollout for the location-off session close. See the migration
 *  20260809080000_location_close_mode.sql for the full rationale. */
export type LocationCloseMode = 'off' | 'observe' | 'on';

// 'observe' is the safe default in BOTH directions, which is why it is also the
// fallback for an unreadable or unrecognised value: a device that cannot reach
// system_config logs what it would have done and closes nothing, so a config
// outage can never start ending sessions — nor silence the telemetry we are
// staging this on.
export const DEFAULT_LOCATION_CLOSE_MODE: LocationCloseMode = 'observe';

// In-memory last-known values. Read synchronously by the getters so the
// geofence dwell/upgrade constants can consume them without awaiting.
let cachedMinutes = DEFAULT_GYM_DWELL_MIN;
let cachedUpgradeMinutes = DEFAULT_GYM_UPGRADE_MIN;
let cachedCloseMode: LocationCloseMode = DEFAULT_LOCATION_CLOSE_MODE;

const parse = (raw: string | null | undefined): number | null => {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const parseMode = (raw: string | null | undefined): LocationCloseMode | null => {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'off' || v === 'observe' || v === 'on' ? v : null;
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

/** Synchronous last-known rollout stage for the location-off session close.
 *  Defaults to 'observe' until primed — log the verdict, close nothing. */
export function getLocationCloseMode(): LocationCloseMode {
  return cachedCloseMode;
}

/** Load the last-persisted values from AsyncStorage into memory. Cheap; safe to
 *  call from a headless task startup so it has values before the first fix. */
export async function primeGymDwellMinutes(): Promise<number> {
  try {
    const [dwell, upgrade, mode] = await AsyncStorage.multiGet([
      CACHE_KEY, UPGRADE_CACHE_KEY, CLOSE_MODE_CACHE_KEY,
    ]);
    const d = parse(dwell?.[1]);
    if (d != null) cachedMinutes = d;
    const u = parse(upgrade?.[1]);
    if (u != null) cachedUpgradeMinutes = u;
    const m = parseMode(mode?.[1]);
    if (m != null) cachedCloseMode = m;
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
      .in('key', ['min_gym_dwell_minutes', 'gym_upgrade_minutes', 'location_close_mode']);
    const pairs: [string, string][] = [];
    for (const row of data ?? []) {
      if (row.key === 'location_close_mode') {
        // Persisted only when it PARSES, so a typo in the admin text box leaves
        // the last good value in place instead of pinning every device to the
        // 'observe' fallback until someone notices.
        const m = parseMode(row.value);
        if (m != null) {
          cachedCloseMode = m;
          pairs.push([CLOSE_MODE_CACHE_KEY, m]);
        }
        continue;
      }
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

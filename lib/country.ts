import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import * as Location from 'expo-location';

import { supabase } from '@/lib/supabase';

/**
 * Country, derived — never asked for.
 *
 * POWR knows nothing about where a member is, which makes every geo question
 * (which markets are we actually in, which rewards and events belong in front
 * of whom) a guess. Asking would cost an onboarding step for a fact we can
 * already reach two ways, neither of which adds a prompt:
 *
 *   1. THE DEVICE TIMEZONE — free, needs no permission, works for everyone
 *      including the users who deny location outright. Written to
 *      profiles.timezone, where a DB trigger looks it up against the IANA
 *      zone → ISO country table (migration 20260822090000). The client's whole
 *      job here is to make sure the timezone is actually on the row: today it
 *      is only written during push-token registration, so anyone who declined
 *      notifications has never reported one.
 *   2. A REVERSE-GEOCODE of the location fix the app already samples for
 *      accuracy telemetry. Higher confidence — where the phone physically is,
 *      not where its clock is set — but only on a granted permission.
 *
 * The server ranks the two (gps outranks timezone until it goes stale); this
 * module's only job is to report what it can see. Every path is best-effort
 * and silent: a country is a nice-to-have, and nothing here may ever delay or
 * break the auth flow it rides on.
 */

// iOS's CLGeocoder is aggressively rate-limited per app and Android's needs a
// network round trip, so the geocode is not something to run on every
// foreground. A country changes when someone gets on a plane; a week is far
// more often than that, and the timezone path below covers the gap anyway.
const GEOCODE_MIN_INTERVAL_MS = 7 * 24 * 60 * 60_000;
const GEOCODE_ATTEMPTED_KEY = 'powr:country:geocodedAt';

// A reverse-geocode that hasn't answered in this long has hit the rate limiter
// or is waiting on a dead network. Abandoning it is free — we simply keep the
// country we already had.
const GEOCODE_TIMEOUT_MS = 8_000;

/** Report the device's IANA timezone. No permission, no fix, no network wait. */
async function reportTimezone(userId: string): Promise<void> {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    // The DB trigger on profiles.timezone derives the country from this write,
    // so there is nothing else to send. Writing the same value again is a
    // no-op at the trigger (it only fires when the zone actually CHANGED).
    await supabase.from('profiles').update({ timezone: tz }).eq('id', userId);
  } catch {
    // Intl unavailable or the write failed — the next app open tries again.
  }
}

async function shouldGeocode(): Promise<boolean> {
  try {
    const last = await AsyncStorage.getItem(GEOCODE_ATTEMPTED_KEY);
    if (!last) return true;
    const at = Number(last);
    if (!Number.isFinite(at)) return true;
    return Date.now() - at > GEOCODE_MIN_INTERVAL_MS;
  } catch {
    return false; // can't read the throttle — don't risk hammering the geocoder
  }
}

/**
 * ISO country code for a coordinate, or null when the geocoder can't say.
 *
 * ⚠ null is "we couldn't tell", NEVER "no country" — offline, rate-limited and
 * mid-ocean all land here. The server treats a null as a no-op rather than a
 * clear, so a bad answer can't erase a good one.
 */
async function countryForFix(latitude: number, longitude: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const places = await Promise.race([
      Location.reverseGeocodeAsync({ latitude, longitude }),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), GEOCODE_TIMEOUT_MS); }),
    ]);
    const iso = places?.find(p => p.isoCountryCode)?.isoCountryCode;
    return iso && /^[A-Za-z]{2}$/.test(iso) ? iso.toUpperCase() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve and report this user's country from whatever signal is available.
 *
 * `fix` is the location sample the caller has ALREADY taken (see
 * reportLocationPermission) — this function never asks for one of its own, so
 * on a denied permission it costs one cheap profile write and nothing else.
 *
 * ⚠ FOREGROUND ONLY for the geocode. This rides the auth listener, which fires
 * on headless background wakes too, and a network round trip on a wake path is
 * exactly the thing that jams them (see project_background_auth_freshness).
 * The timezone half is safe anywhere and always runs.
 */
export async function reportUserCountry(
  userId: string,
  fix: { latitude: number; longitude: number } | null,
): Promise<void> {
  try {
    await reportTimezone(userId);

    if (!fix || AppState.currentState !== 'active') return;
    if (!(await shouldGeocode())) return;

    // Stamped BEFORE the attempt, not after: a geocoder that is failing (rate
    // limited, no network) must back off just as hard as one that succeeded,
    // or every app open retries it forever.
    await AsyncStorage.setItem(GEOCODE_ATTEMPTED_KEY, String(Date.now())).catch(() => {});

    const code = await countryForFix(fix.latitude, fix.longitude);
    if (!code) return;

    await supabase.rpc('record_user_country', { p_country_code: code, p_source: 'gps' });
  } catch {
    // Best-effort throughout — see the module note.
  }
}

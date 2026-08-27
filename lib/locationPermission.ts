import * as Location from 'expo-location';

import { supabase } from '@/lib/supabase';

export type LocationPermissionLevel = 'always' | 'while_using' | 'denied' | 'undetermined';

/**
 * Collapse the two-stage system permission into the one value that matters
 * for POWR: 'always' is the only state where background geofencing works.
 * Returns null when the check itself fails, so a transient native error is
 * never reported as "denied".
 */
async function getLocationPermissionLevel(): Promise<LocationPermissionLevel | null> {
  const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (!fg) return null;
  if (fg.status === 'undetermined') return 'undetermined';
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
  return bg?.status === 'granted' ? 'always' : 'while_using';
}

/** Why an in-progress gym session can no longer be verified. */
export type LocationLossReason =
  | 'services_disabled'      // system Location Services switched off device-wide
  | 'permission_denied'      // foreground grant revoked (or never determined)
  | 'permission_downgraded'; // dropped to "While Using" — geofencing is dead

/**
 * The one question an open gym session needs answered: can this device still
 * PROVE the user is at the gym? Returns the reason it cannot, or null while
 * location is still good enough.
 *
 * Every read fails CLOSED (null = "still fine"). A transient native error must
 * never end a real session — a session wrongly closed forfeits the rest of the
 * user's visit, while one wrongly kept is caught by the next check. Same
 * reasoning as getLocationPermissionLevel's null-on-failure contract above.
 *
 * ⚠ Deliberately does NOT consider reduced accuracy. iOS Precise Location off
 * coarsens fixes to 1-5 km, which genuinely defeats a 25 m fence — but accuracy
 * is sampled per-fix and wobbles, and killing a live session on one bad sample
 * is a worse trade than the drift it prevents. See REDUCED_ACCURACY_THRESHOLD_M.
 */
export async function detectLocationLoss(): Promise<LocationLossReason | null> {
  let servicesEnabled: boolean;
  try {
    servicesEnabled = await Location.hasServicesEnabledAsync();
  } catch {
    return null;
  }
  if (!servicesEnabled) return 'services_disabled';

  const level = await getLocationPermissionLevel();
  if (!level || level === 'always') return null;

  // ⚠ 'undetermined' IS NOT 'denied', and conflating them is a false-close.
  // A session cannot exist without a prior grant, so "never asked" reported
  // mid-session does not describe the user's settings — it describes a read
  // that did not answer (iOS can report .notDetermined before its location
  // manager has initialised, which is exactly when the cold-launch check
  // runs). Inconclusive, so it fails closed like every other bad read here.
  if (level === 'undetermined') return null;

  return level === 'while_using' ? 'permission_downgraded' : 'permission_denied';
}

// Accuracy radii (m) above this are treated as reduced/coarse for dedupe and
// admin display: iOS "Precise Location" off coarsens every fix to ~1-5 km,
// Android coarse-only to ~2 km, while even a poor genuine fix stays well
// under 500 m. The raw value is what gets stored.
export const REDUCED_ACCURACY_THRESHOLD_M = 500;

const ACCURACY_FIX_TIMEOUT_MS = 10_000;
const LAST_KNOWN_MAX_AGE_MS = 15 * 60_000;

/** One location sample: what it says about precision, and where it was. */
export type LocationSample = {
  /** Accuracy radius in metres, or null when the fix carried no usable value. */
  accuracyM: number | null;
  /** Coordinates, or null when no fix was obtained at all. */
  coords: { latitude: number; longitude: number } | null;
};

const EMPTY_SAMPLE: LocationSample = { accuracyM: null, coords: null };

/** The accuracy/coords a position object actually carries, normalised. */
function readSample(pos: Location.LocationObject | null): LocationSample {
  const acc = pos?.coords?.accuracy;
  const lat = pos?.coords?.latitude;
  const lng = pos?.coords?.longitude;
  return {
    accuracyM: typeof acc === 'number' && acc > 0 ? Math.round(acc) : null,
    coords:
      typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
        ? { latitude: lat, longitude: lng }
        : null,
  };
}

/**
 * One location fix, read for two unrelated purposes.
 *
 * ACCURACY is the load-bearing one: the permission response can't see iOS's
 * Precise Location toggle (expo's iOS details expose only `scope`), so a
 * coarsened fix is the ONLY signal that geofencing is silently dead despite an
 * 'always' grant. Prefers the cached last-known fix (instant, already coarsened
 * when precision is off), falling back to one bounded fresh fix.
 *
 * COORDS ride along for free, and are handed to the country derivation
 * (lib/country.ts). Deliberately a passenger, never a reason to take a fix:
 * the sampling rules below exist for the accuracy signal and must not be
 * loosened for the country one.
 */
async function sampleLocation(): Promise<LocationSample> {
  try {
    const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    const cached = readSample(lastKnown);
    if (cached.accuracyM !== null) return cached;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ACCURACY_FIX_TIMEOUT_MS); }),
      ]);
      // A fresh fix with no usable accuracy can still carry usable coords, and
      // the last-known one may have carried coords too — keep whichever we saw.
      const sample = readSample(fresh);
      return { accuracyM: sample.accuracyM, coords: sample.coords ?? cached.coords };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return EMPTY_SAMPLE;
  }
}

/** Bucket used only for in-process dedupe so jittering metres don't rewrite the row. */
function accuracyBucket(accuracyM: number | null): 'na' | 'ok' | 'reduced' {
  if (accuracyM == null) return 'na';
  return accuracyM > REDUCED_ACCURACY_THRESHOLD_M ? 'reduced' : 'ok';
}

let lastReported: string | null = null;

/**
 * Report the current location-permission snapshot to profiles so the admin
 * panel sees the real state (profiles.location_granted is a write-once
 * onboarding-bonus flag and goes stale the moment the user touches system
 * settings). Alongside the permission level we sample one fix's accuracy
 * radius — the only way to surface reduced-accuracy grants (see above).
 * Fire-and-forget telemetry: swallows every error, and dedupes within the
 * process so app-foreground re-checks don't rewrite the same value.
 *
 * Returns the coordinates of the fix it took, purely so the caller can derive
 * the user's country from a sample we were taking anyway (lib/country.ts).
 * Null whenever no fix was obtained — including on the dedupe early-return
 * path, which is not a failure, just nothing new to say.
 */
export async function reportLocationPermission(
  userId: string,
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const level = await getLocationPermissionLevel();
    if (!level) return null;
    // Only granted permissions can produce a fix; skip the sample otherwise.
    const granted = level === 'always' || level === 'while_using';
    const { accuracyM, coords } = granted ? await sampleLocation() : EMPTY_SAMPLE;
    const key = `${userId}:${level}:${accuracyBucket(accuracyM)}`;
    // The permission snapshot is unchanged, but the fix is still a fresh one —
    // hand it back so the country derivation isn't gated on a permission
    // transition that may never come again.
    if (key === lastReported) return coords;
    // Via the RPC, not a bare UPDATE on profiles: the same write now also appends
    // to location_permission_events when the level actually CHANGED, which is the
    // only way the server can ever see a user drop from 'always' — the column
    // alone is overwritten in place and the regression is lost.
    //
    // The accuracy rule (keep the last reading on a failed sample, null it on a
    // revoked permission) moved into the function so both halves stay consistent;
    // passing null here means "no sample", never "clear it".
    const { error } = await supabase.rpc('record_location_permission', {
      p_level: level,
      p_accuracy_m: accuracyM,
    });
    if (!error) lastReported = key;
    return coords;
  } catch {
    // Telemetry only — must never interfere with the auth flow it rides on.
    return null;
  }
}

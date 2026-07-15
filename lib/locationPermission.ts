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

// Accuracy radii (m) above this are treated as reduced/coarse for dedupe and
// admin display: iOS "Precise Location" off coarsens every fix to ~1-5 km,
// Android coarse-only to ~2 km, while even a poor genuine fix stays well
// under 500 m. The raw value is what gets stored.
export const REDUCED_ACCURACY_THRESHOLD_M = 500;

const ACCURACY_FIX_TIMEOUT_MS = 10_000;
const LAST_KNOWN_MAX_AGE_MS = 15 * 60_000;

/**
 * Accuracy radius (m) of a current location fix, or null when unavailable.
 * The permission response can't see iOS's Precise Location toggle (expo's
 * iOS details expose only `scope`), so a coarsened fix is the ONLY signal
 * that geofencing is silently dead despite an 'always' grant. Prefers the
 * cached last-known fix (instant, already coarsened when precision is off),
 * falling back to one bounded fresh fix.
 */
async function sampleLocationAccuracyM(): Promise<number | null> {
  try {
    const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    const cached = lastKnown?.coords?.accuracy;
    if (typeof cached === 'number' && cached > 0) return Math.round(cached);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ACCURACY_FIX_TIMEOUT_MS); }),
      ]);
      const acc = fresh?.coords?.accuracy;
      return typeof acc === 'number' && acc > 0 ? Math.round(acc) : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
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
 */
export async function reportLocationPermission(userId: string): Promise<void> {
  try {
    const level = await getLocationPermissionLevel();
    if (!level) return;
    // Only granted permissions can produce a fix; skip the sample otherwise.
    const granted = level === 'always' || level === 'while_using';
    const accuracyM = granted ? await sampleLocationAccuracyM() : null;
    const key = `${userId}:${level}:${accuracyBucket(accuracyM)}`;
    if (key === lastReported) return;
    const update: Record<string, unknown> = {
      location_permission: level,
      location_permission_checked_at: new Date().toISOString(),
    };
    // A failed sample on a granted permission keeps the previous reading (a
    // transient miss shouldn't erase real signal); a revoked permission nulls
    // it (any stored accuracy no longer describes anything current).
    if (accuracyM != null || !granted) update.location_accuracy_m = accuracyM;
    const { error } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', userId);
    if (!error) lastReported = key;
  } catch {
    // Telemetry only — must never interfere with the auth flow it rides on.
  }
}

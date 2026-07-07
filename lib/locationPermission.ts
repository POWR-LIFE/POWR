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

let lastReported: string | null = null;

/**
 * Report the current location-permission snapshot to profiles so the admin
 * panel sees the real state (profiles.location_granted is a write-once
 * onboarding-bonus flag and goes stale the moment the user touches system
 * settings). Fire-and-forget telemetry: swallows every error, and dedupes
 * within the process so app-foreground re-checks don't rewrite the same value.
 */
export async function reportLocationPermission(userId: string): Promise<void> {
  try {
    const level = await getLocationPermissionLevel();
    if (!level) return;
    const key = `${userId}:${level}`;
    if (key === lastReported) return;
    const { error } = await supabase
      .from('profiles')
      .update({
        location_permission: level,
        location_permission_checked_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (!error) lastReported = key;
  } catch {
    // Telemetry only — must never interfere with the auth flow it rides on.
  }
}

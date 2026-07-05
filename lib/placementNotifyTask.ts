// =============================================================
// Placement zone-entry push notifications (v1)
// =============================================================
// A background-fetch task that periodically checks whether a location reward
// applies where the user physically is, and — if so — fires a single local
// "reward nearby" notification for the most relevant one.
//
// DELIBERATELY SEPARATE from the 25 m points geofence (GeofenceContext): this
// never touches claim/points, uses only a coarse fix, and runs on its own
// background-fetch schedule so it can't destabilise the check-in engine.
//
// Cadence is the OS background-fetch interval (~15 min+), so this is "soon
// after entry", not instant — a dedicated placement geofence (v2) would make
// it instant but needs region clustering + is a bigger native change.
//
// Native only; a no-op in Expo Go / on web. Needs an EAS build to exercise.
// =============================================================

import * as BackgroundFetch from 'expo-background-fetch';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { resolveContextualPlacements, logPlacementEvent } from '@/lib/api/placements';
import { notifyNearbyOffer } from '@/lib/notifications';

export const PLACEMENT_NOTIFY_TASK = 'POWR_PLACEMENT_NOTIFY';

// Coarse is fine — placement zones are venue-scale, not the 25 m points fence.
const MAX_AGE_MS = 10 * 60 * 1000;
const REQUIRED_ACCURACY_M = 250;

async function runPlacementCheck(): Promise<boolean> {
  // Need at least foreground permission; background reads rely on a cached fix.
  const { status } = await Location.getForegroundPermissionsAsync().catch(
    () => ({ status: 'denied' as Location.PermissionStatus }),
  );
  if (status !== 'granted') return false;

  // A recent cached fix keeps this cheap and works without an active bg stream;
  // fall back to a fresh read (only succeeds with "Always" location).
  let pos = await Location.getLastKnownPositionAsync({ maxAge: MAX_AGE_MS, requiredAccuracy: REQUIRED_ACCURACY_M }).catch(() => null);
  if (!pos) pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
  if (!pos) return false;

  const { latitude, longitude } = pos.coords;

  // Resolver requires an authenticated session; silently bail if logged out.
  // getSession() reads the persisted session without a network round-trip.
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return false;

  const placements = await resolveContextualPlacements(latitude, longitude);
  if (placements.length === 0) return false;

  // Resolver already orders paid → priority → nearest, so [0] is the best pick.
  // One notification per wake — surface the single most relevant reward, never a burst.
  const top = placements[0];
  const { data: reward } = await supabase
    .from('rewards')
    .select('title, brand_name')
    .eq('id', top.reward_id)
    .maybeSingle();
  if (!reward?.title) return false;

  const fired = await notifyNearbyOffer({
    placementId: top.placement_id,
    rewardName: reward.title,
    brandName: reward.brand_name,
  });
  if (fired) {
    // 'notified' is its own funnel step — it does NOT feed the resolver's
    // 'surfaced' daily cap, so a push never suppresses the in-app hero swap.
    logPlacementEvent(top.placement_id, 'notified', { lat: latitude, lng: longitude });
  }
  return fired;
}

TaskManager.defineTask(PLACEMENT_NOTIFY_TASK, async () => {
  try {
    const fired = await runPlacementCheck();
    return fired
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/** Registers the placement-notify background task once. Call at app startup. */
export async function registerPlacementNotifyTask(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(PLACEMENT_NOTIFY_TASK);
    if (!registered) {
      await BackgroundFetch.registerTaskAsync(PLACEMENT_NOTIFY_TASK, {
        minimumInterval: 15 * 60, // seconds; OS treats this as a floor
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch { /* background fetch unavailable (e.g. simulator / Expo Go) */ }
}

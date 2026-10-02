// AsyncStorage mirror of the admin notification switches the PHONE enforces
// (notification_config.enabled, flipped from /admin/notifications).
//
// Most switches are enforced server-side at send-push-notification and never
// need to reach the device. These three do, because the phone puts them up
// itself:
//   check_in_reminder  the "You're in at {gym}" banner is a local notification
//                      scheduled by the headless geofence task
//   session_completed  on-device fallbacks for when the server push could not
//   session_upgraded   be sent (claim-points / upgrade-gym-tier push_delivered)
//
// The geofence task runs with no reliable network ("LOCAL UX FIRST, NETWORK
// LAST" in GeofenceContext), so the foreground refreshes this mirror (launch,
// sign-in, every return to the app) and the task reads it. A phone therefore
// picks up a flipped switch the next time the app is opened. Absent = on.
//
// Dependency-free on purpose, like lib/stepGoalPrefCache.ts: lib/api (the
// writer) and lib/notifications (the reader) must not pull each other's module
// graphs.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const ADMIN_SWITCHES_CACHE_KEY = '@powr/admin_notification_switches_off';

/** The rows the app may read (RLS policy "Authenticated can read app-honoured
 *  notification switches", 20261002120000). Adding one here without adding it
 *  to that policy reads nothing and leaves the switch inert on the phone. */
export const APP_HONOURED_SWITCHES = ['check_in_reminder', 'session_completed', 'session_upgraded'] as const;
export type AppHonouredSwitch = typeof APP_HONOURED_SWITCHES[number];

/** Replaces the mirror with the switches that are currently OFF. */
export function cacheAdminSwitchesOff(off: AppHonouredSwitch[]): void {
  AsyncStorage.setItem(ADMIN_SWITCHES_CACHE_KEY, JSON.stringify(off)).catch(() => {});
}

/** true only when the mirror explicitly lists the type as off. A missing or
 *  unreadable mirror never mutes anything. */
export async function isAdminSwitchedOff(type: AppHonouredSwitch): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(ADMIN_SWITCHES_CACHE_KEY);
    if (!raw) return false;
    const off = JSON.parse(raw);
    return Array.isArray(off) && off.includes(type);
  } catch {
    return false;
  }
}

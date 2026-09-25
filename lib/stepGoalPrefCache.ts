// AsyncStorage mirror of notification_preferences.step_goal_nudge.
//
// The evening step nudge (lib/stepGoalNotifyTask.ts) runs on the beacon wake,
// where the persisted access token is usually spent (Supabase tokens live one
// hour; most evenings the phone has been pocketed longer than that) and a
// background refresh is forbidden (it revokes the token family). Without a
// readable server preference the nudge would either fire past an OFF toggle
// or never fire at all, so the foreground keeps this mirror up to date on
// every preference read and write and the task honours it when the server
// is out of reach. Absent = on (the column's default).
//
// Dependency-free on purpose: lib/api/notifications (the writer) and the
// headless task (the reader) must not pull each other's module graphs.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const STEP_GOAL_PREF_CACHE_KEY = '@powr/pref_step_goal_nudge';

export function cacheStepGoalPref(enabled: boolean): void {
  AsyncStorage.setItem(STEP_GOAL_PREF_CACHE_KEY, enabled ? '1' : '0').catch(() => {});
}

/** true unless the mirror explicitly says off — never mutes on a storage error. */
export async function readCachedStepGoalPref(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STEP_GOAL_PREF_CACHE_KEY)) !== '0';
  } catch {
    return true;
  }
}

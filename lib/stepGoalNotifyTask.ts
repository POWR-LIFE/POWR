// Evening step-goal nudge for walkers — "3,200 steps to go" while the day can
// still be saved. Runs on the same expo-background-fetch cadence as the
// placement task (~15 min); all the actual gating lives in runStepGoalCheck:
//
//   • local evening window only (17:00–20:59) — early enough to act on,
//     late enough that the day's walking pattern is real
//   • only when the user is BETWEEN tiers with the next one plausibly in
//     reach (≤ 3,000 steps away) and has actually been moving (≥ 2,000 steps)
//     — below that it's unachievable-nagging, above ~95% they'll make it anyway
//   • DB preference step_goal_nudge (synced, unlike the old AsyncStorage-only
//     nearby pref) + the shared one-local-nudge-per-day budget + its own
//     once-per-day stamp
//
// For walking-only users this is their streak_at_risk equivalent; gym users
// in the same evening get the server streak push instead — the shared budget
// means they never get both.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { getNotificationPreferences } from '@/lib/api/notifications';
import { fetchTodayWalkingPoints, nextStepThreshold, stepTierPoints, WALKING_DAILY_CAP } from '@/lib/api/activity';
import { getStepsToday } from '@/lib/health/walkingSync';
import { notifyStepGoal } from '@/lib/notifications';
import { readBackgroundAuth } from '@/lib/backgroundRest';

export const STEP_GOAL_NOTIFY_TASK = 'POWR_STEP_GOAL_NOTIFY';

const FIRED_DAY_KEY = '@powr/step_goal_fired_day';
const WINDOW_START_HOUR = 17;
const WINDOW_END_HOUR = 21;   // exclusive
const MIN_STEPS_TODAY = 2000;
const MAX_STEPS_TO_NEXT = 3000;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function runStepGoalCheck(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const hour = new Date().getHours();
  if (hour < WINDOW_START_HOUR || hour >= WINDOW_END_HOUR) return false;

  try {
    if ((await AsyncStorage.getItem(FIRED_DAY_KEY)) === todayKey()) return false;
  } catch { /* fall through */ }

  // Storage read, never getSession(): headless task — entering the auth
  // client's lock here jams behind a wedged wake and can itself trigger a
  // background lazy refresh (the family-revocation class). A spent token skips
  // tonight's nudge rather than gambling the token family on it.
  const userId = (await readBackgroundAuth())?.userId;
  if (!userId) return false;

  try {
    const prefs = await getNotificationPreferences(userId);
    if (prefs.step_goal_nudge === false) return false;
  } catch { /* prefs unreadable — default on */ }

  let steps = 0;
  try {
    steps = await getStepsToday();
  } catch {
    return false; // no health read available (permission not granted etc.)
  }
  if (steps < MIN_STEPS_TODAY) return false;

  const next = nextStepThreshold(steps);
  if (!next) return false; // already at the top tier
  const stepsToNext = next - steps;
  if (stepsToNext <= 0 || stepsToNext > MAX_STEPS_TO_NEXT) return false;

  // Nothing to promise if today's walking points are already capped.
  try {
    const banked = await fetchTodayWalkingPoints();
    if (banked >= WALKING_DAILY_CAP) return false;
    const bonus = Math.min(stepTierPoints(next), WALKING_DAILY_CAP) - banked;
    if (bonus <= 0) return false;

    const fired = await notifyStepGoal({ stepsToNext, bonusPoints: bonus });
    if (fired) await AsyncStorage.setItem(FIRED_DAY_KEY, todayKey()).catch(() => {});
    return fired;
  } catch {
    return false;
  }
}

TaskManager.defineTask(STEP_GOAL_NOTIFY_TASK, async () => {
  try {
    const fired = await runStepGoalCheck();
    return fired
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerStepGoalNotifyTask(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(STEP_GOAL_NOTIFY_TASK);
    if (registered) return;
    await BackgroundFetch.registerTaskAsync(STEP_GOAL_NOTIFY_TASK, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch (err) {
    console.warn('[stepGoalNotifyTask] registration failed:', err);
  }
}

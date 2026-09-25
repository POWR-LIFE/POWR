// Evening step-goal nudge for walkers — "3,200 steps to go" while the day can
// still be saved. All the gating lives in runStepGoalCheck:
//
//   • local evening window only (17:00–20:59) — early enough to act on,
//     late enough that the day's walking pattern is real
//   • only when the user is BETWEEN tiers with the next one plausibly in
//     reach (≤ 3,000 steps away) and has actually been moving (≥ 2,000 steps)
//     — below that it's unachievable-nagging, above ~95% they'll make it anyway
//   • DB preference step_goal_nudge (mirrored to AsyncStorage for wakes whose
//     token is spent) + the shared one-local-nudge-per-day budget + its own
//     once-per-day stamp + one health read per 20 minutes
//
// For walking-only users this is their streak_at_risk equivalent. The server's
// nudge budget cannot see a local notification, so the two pools are NOT one:
// this nudge defers on its own when it can see the user is tonight's
// streak_at_risk candidate (a live streak, nothing logged today — the server
// push wins the day's slot, as the dispatcher's design says). When the server
// is unreadable it fires; a rare second nudge beats a muted walker.
//
// HOW IT ACTUALLY RUNS (2026-09-25). Three entry points, one gate:
//   1. The beacon's fence_refresh wake (lib/backgroundNotificationTask.ts),
//      LAST in the self-heal chain, right after the wake walking sync. This is
//      the trigger that fires in the field. expo-background-fetch has never
//      delivered a run on either platform (apps-closed field test 2026-08-08),
//      and this task sat on it alone for two months — which is why nobody
//      received one.
//   2. The app going to the background inside the window
//      (hooks/useWalkingProgress.ts): the user just looked, the count is
//      fresh, a lock-screen nudge lands a moment later.
//   3. The BackgroundFetch task below, kept registered as a free extra chance.
//
// NO AUTH-CLIENT CALLS ON THIS PATH. The preference and today's banked points
// are read over raw fetch with the persisted token (lib/backgroundRest); the
// supabase client's auth lock is the headless freeze class
// (lib/backgroundRest.ts header). Loading the client module is fine — the
// headless entry already does — entering its lock with a call is not. When the token is spent — most evenings —
// the nudge still fires: the preference comes from the AsyncStorage mirror and
// the promised points fall back to the tier ladder itself
// (tier(next) − tier(now)), which can only under-promise.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { defineTask } from '@/lib/taskFinishGuard';
import { Platform } from 'react-native';

import { nextStepThreshold, stepTierPoints, WALKING_DAILY_CAP } from '@/lib/api/activity';
import { getStepsToday } from '@/lib/health/walkingSync';
import { notifyStepGoal } from '@/lib/notifications';
import { bgSelect, readBackgroundAuth, type BackgroundAuth } from '@/lib/backgroundRest';
import { cacheStepGoalPref, readCachedStepGoalPref } from '@/lib/stepGoalPrefCache';

export const STEP_GOAL_NOTIFY_TASK = 'POWR_STEP_GOAL_NOTIFY';

export const STEP_GOAL_FIRED_DAY_KEY = '@powr/step_goal_fired_day';
export const STEP_GOAL_CHECKED_AT_KEY = '@powr/step_goal_checked_at';
const CHECK_MIN_GAP_MS = 20 * 60 * 1000;
const WINDOW_START_HOUR = 17;
const WINDOW_END_HOUR = 21;   // exclusive
const MIN_STEPS_TODAY = 2000;
const MAX_STEPS_TO_NEXT = 3000;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayMidnightIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

interface StepGoalPrefs {
  stepGoal: boolean;
  /** null = unknown (server unreadable); the defer below then does not apply. */
  streakAtRisk: boolean | null;
}

/** Server preferences when the token allows, the mirror otherwise. No row = on. */
async function readPrefs(auth: BackgroundAuth | null): Promise<StepGoalPrefs> {
  if (auth) {
    try {
      const { data } = await bgSelect<{ step_goal_nudge: boolean | null; streak_at_risk: boolean | null }>(
        'notification_preferences',
        `select=step_goal_nudge,streak_at_risk&user_id=eq.${auth.userId}&limit=1`,
        auth,
      );
      if (data) {
        const stepGoal = data[0]?.step_goal_nudge !== false;
        cacheStepGoalPref(stepGoal);
        return { stepGoal, streakAtRisk: data[0]?.streak_at_risk !== false };
      }
    } catch { /* fall through to the mirror */ }
  }
  return { stepGoal: await readCachedStepGoalPref(), streakAtRisk: null };
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Is this user tonight's streak_at_risk candidate — non-manual activity on
 *  each of the last `min_streak` local days ending yesterday, nothing yet
 *  today? Mirrors nudge_dispatch_candidates + send-push's min-streak floor
 *  (sessions only; a rescue bridge day inside the window is the one known
 *  divergence, and it errs towards firing). Unreadable = not a candidate. */
async function isStreakAtRiskCandidateTonight(auth: BackgroundAuth): Promise<boolean> {
  try {
    let minStreak = 3;
    const { data: cfg } = await bgSelect<{ value: string | null }>(
      'system_config', 'select=value&key=eq.streak_at_risk_min_streak&limit=1', auth,
    );
    const parsed = Number.parseInt(String(cfg?.[0]?.value ?? ''), 10);
    if (Number.isFinite(parsed) && parsed > 0) minStreak = parsed;

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - minStreak);
    const { data: sessions } = await bgSelect<{ started_at: string }>(
      'activity_sessions',
      `select=started_at&user_id=eq.${auth.userId}&verification=neq.manual`
        + `&started_at=gte.${encodeURIComponent(since.toISOString())}&limit=500`,
      auth,
    );
    if (!sessions) return false;
    const days = new Set(sessions.map(s => localDayKey(new Date(s.started_at))));
    const cursor = new Date();
    if (days.has(localDayKey(cursor))) return false;     // logged today — no streak push tonight
    for (let i = 1; i <= minStreak; i++) {
      cursor.setDate(cursor.getDate() - 1);
      if (!days.has(localDayKey(cursor))) return false;  // streak too short for the push
    }
    return true;
  } catch {
    return false;
  }
}

/** Today's walking points already awarded, scoped by the session's started_at
 *  (a backfilled past day inserts with created_at = now). null = unreadable. */
async function bankedWalkingPointsToday(auth: BackgroundAuth | null): Promise<number | null> {
  if (!auth) return null;
  try {
    const { data } = await bgSelect<{ point_transactions: { amount: number; type: string }[] | null }>(
      'activity_sessions',
      `select=point_transactions(amount,type)&user_id=eq.${auth.userId}&type=eq.walking`
        + `&started_at=gte.${encodeURIComponent(todayMidnightIso())}`,
      auth,
    );
    if (!data) return null;
    return data
      .flatMap(s => s.point_transactions ?? [])
      .filter(t => t.type === 'earn')
      .reduce((sum, t) => sum + t.amount, 0);
  } catch {
    return null;
  }
}

export async function runStepGoalCheck(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const hour = new Date().getHours();
  if (hour < WINDOW_START_HOUR || hour >= WINDOW_END_HOUR) return false;

  try {
    if ((await AsyncStorage.getItem(STEP_GOAL_FIRED_DAY_KEY)) === todayKey()) return false;
  } catch { /* fall through */ }

  // The wake arrives every ~5-6 minutes; one health read per 20 is plenty for
  // a nudge that fires once a day. Stamped BEFORE the read (walking-sync
  // convention) so a hanging read can't leave the gate open for every
  // subsequent wake to pile into.
  try {
    const last = Number((await AsyncStorage.getItem(STEP_GOAL_CHECKED_AT_KEY)) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < CHECK_MIN_GAP_MS) return false;
    await AsyncStorage.setItem(STEP_GOAL_CHECKED_AT_KEY, String(Date.now()));
  } catch { /* fall through */ }

  // Storage read, never getSession(): entering the auth client's lock on a
  // wake jams behind a wedged runtime and a background refresh revokes the
  // token family. null (spent/missing) degrades the reads below; it does not
  // skip the nudge — that gate alone muted every phone pocketed for an hour.
  const auth = await readBackgroundAuth();

  const prefs = await readPrefs(auth);
  if (!prefs.stepGoal) return false;

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

  // Tonight's streak_at_risk push wins the day's one nudge slot when it can
  // fire (header). Only decidable with a live token; otherwise fire.
  if (auth && prefs.streakAtRisk !== false && await isStreakAtRiskCandidateTonight(auth)) return false;

  // Nothing to promise if today's walking points are already capped. With the
  // server unreadable, assume the current tier is banked: the promise becomes
  // tier(next) − tier(now), the smallest amount reaching the tier can pay.
  try {
    const banked = (await bankedWalkingPointsToday(auth)) ?? stepTierPoints(steps);
    if (banked >= WALKING_DAILY_CAP) return false;
    const bonus = Math.min(stepTierPoints(next), WALKING_DAILY_CAP) - banked;
    if (bonus <= 0) return false;

    const fired = await notifyStepGoal({ stepsToNext, bonusPoints: bonus });
    if (fired) await AsyncStorage.setItem(STEP_GOAL_FIRED_DAY_KEY, todayKey()).catch(() => {});
    return fired;
  } catch {
    return false;
  }
}

/** Wake-path entry: never rejects — a nudge is never worth a wake. */
export async function runStepGoalCheckFromWake(): Promise<void> {
  try {
    await runStepGoalCheck();
  } catch (err) {
    console.warn('[stepGoalNotifyTask] wake check failed (non-fatal):', err);
  }
}

defineTask(STEP_GOAL_NOTIFY_TASK, async () => {
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

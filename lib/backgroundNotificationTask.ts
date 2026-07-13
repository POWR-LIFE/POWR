// Background notification task — the piece that lets the server WAKE this device.
//
// A stationary phone gets no location callbacks (Android setSmallestDisplacement /
// iOS distanceFilter both suppress them until you move), so the dwell machine can
// never wake itself while the user stands still in a gym. That is why the 30-min
// claim and 40-min bonus only ever landed when the app was next opened.
//
// So the server holds the timers and sends a SILENT, data-only push at each
// threshold. This task is what receives it with the app backgrounded or swiped away.
// It hands straight to runVisitCheck, which takes a fresh GPS fix and decides — the
// server never credits on its own.
//
// Registration is idempotent and safe to call on every launch.
//
// PLATFORM LIMITS (not bugs — Apple/Google policy):
//  • iOS force-quit (swiped from the app switcher): background pushes are NOT
//    delivered to a user-terminated app. Region monitoring still relaunches us on
//    EXIT, so the claim lands then — i.e. exactly today's behaviour, never worse.
//  • iOS throttles background pushes; one per threshold is well within budget.
//  • Android force-stop (from Settings) blocks everything until the app is opened.

import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

export const BACKGROUND_NOTIFICATION_TASK = 'POWR_BACKGROUND_NOTIFICATION';

interface VisitCheckData {
  type?: string;
  stage?: 'dwell' | 'upgrade';
  visit_id?: string;
}

/** Digs the data payload out of the platform-specific notification shapes. */
function extractData(raw: unknown): VisitCheckData {
  const body = raw as {
    data?: VisitCheckData;                                   // Android (FCM data-only)
    notification?: { data?: VisitCheckData; request?: { content?: { data?: VisitCheckData } } };
    request?: { content?: { data?: VisitCheckData } };       // iOS (UNNotification)
    body?: VisitCheckData;
  } | null;

  return (
    body?.data ??
    body?.body ??
    body?.notification?.data ??
    body?.notification?.request?.content?.data ??
    body?.request?.content?.data ??
    {}
  ) as VisitCheckData;
}

TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[BackgroundNotification] task error:', error);
    return;
  }
  try {
    const payload = extractData(data);
    if (payload?.type !== 'gym_visit_check') return; // not ours — ignore quietly

    const stage = payload.stage === 'upgrade' ? 'upgrade' : 'dwell';
    console.log(`[BackgroundNotification] Visit check (${stage}) — verifying presence.`);

    // Imported lazily: this task is registered at module load in a headless context,
    // and GeofenceContext pulls in the whole geofence engine.
    const { runVisitCheck } = await import('@/context/GeofenceContext');
    await runVisitCheck(stage);
  } catch (err) {
    console.warn('[BackgroundNotification] visit check failed:', err);
  }
});

/** Registers the task so data-only pushes are delivered while backgrounded/closed.
 *  Safe to call repeatedly. */
export async function registerBackgroundNotificationTask(): Promise<void> {
  try {
    const already = await TaskManager.isTaskRegisteredAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => false);
    if (already) return;
    await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
    console.log('[BackgroundNotification] task registered.');
  } catch (err) {
    // Unsupported in Expo Go — the geofence engine's own paths still work there.
    console.warn('[BackgroundNotification] registration failed:', err);
  }
}

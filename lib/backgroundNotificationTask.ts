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

/** REBINDS the task so data-only pushes are delivered while backgrounded/closed.
 *
 *  unregister → register, never register alone: registration persists natively,
 *  and a bare registerTaskAsync no-ops when the name is already registered —
 *  which keeps delivery wired to whatever JS context registered it FIRST. When
 *  the context changes under the same process (an OTA restart-prompt reload via
 *  Updates.reloadAsync, or a headless-born process — fg-service/location restart
 *  — whose UI context mounts later), that first context is dead and every wake
 *  is dropped in silence: the OS hands us the FCM broadcast, the task never
 *  runs. Proven live 2026-07-17: batterystats showed all 7 beacon wakes
 *  dispatched to the app in ~2 s, zero JS reaction, for a session that was alive
 *  the whole time; a cold start healed it, foregrounding alone did NOT.
 *  (Re-registering on boot alone — the 2026-07-15 fix — was not enough.)
 *
 *  The unregister may reject when nothing was registered yet — ignore it and
 *  register anyway. Call this on every UI mount AND every return-to-foreground:
 *  those are the earliest moments a live context can steal the binding back. */
export async function registerBackgroundNotificationTask(): Promise<void> {
  try {
    await Notifications.unregisterTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => {});
    await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
    console.log('[BackgroundNotification] task registered.');
  } catch (err) {
    // Unsupported in Expo Go — the geofence engine's own paths still work there.
    console.warn('[BackgroundNotification] registration failed:', err);
  }
}

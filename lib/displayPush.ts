// Client half of the direct-FCM visible push (2026-08-09).
//
// The server used to hand every user-facing push to Expo, which submits it to
// FCM on our behalf. On 2026-08-09 that cost an Android device ~25 minutes on a
// "Session complete" banner while FCM-direct wakes to the same handset in the
// same radio outage landed in under a second — two of them queued LATER and
// flushed the instant the link returned. The server now submits Android visible
// pushes itself, data-only at HIGH priority: the exact transport that measured a
// 0.4 s median over 38 wakes that day. See supabase/functions/_shared/
// visiblePush.ts for the full evidence and for why an FCM `notification` block
// was rejected.
//
// Data-only means nothing displays unless we display it. That is this file.
//
// TWO THINGS IT BUYS BACK, both of which a GMS-rendered banner would have lost:
//  • The tap routes. `data.route` reaches getRouteFromNotification exactly as it
//    does for every other notification, because this IS a local notification by
//    the time the OS sees it.
//  • delivered_at. We are the code that presented the banner, so we can say so —
//    the first display receipt this system has ever had. push_send_log's
//    'accepted' has never meant more than "the platform took it", which is
//    precisely the boundary the 08-09 incident lived on.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase';

/** The payload marker the server sets on a direct visible push. Kept here so the
 *  matcher in backgroundNotificationTask and the presenter can never drift. */
export const DISPLAY_NOTIFICATION_TYPE = 'display_notification';

/** FCM v1 requires every data value to be a string, so everything arrives as one.
 *
 *  ⚠ EVERY FIELD IS `n_`-PREFIXED. expo-notifications reads notification content
 *  straight out of the FCM data payload — `data.title` becomes the banner title
 *  and `data.body` is run through `JSONObject(...)` — and
 *  FirebaseMessagingDelegate posts that banner BEFORE handing us the message, so
 *  nothing on the JS side can suppress it. Unprefixed keys therefore produced a
 *  second, body-less "Session recorded" banner on the first field run
 *  (2026-08-09). Reserved names to keep clear of: title, message, body, sound,
 *  vibrate, sticky, color, autoDismiss, categoryId, subtitle, badge.
 *  `type` stays unprefixed — extractData matches on it and it is not reserved. */
export interface DisplayPushPayload {
  type?: string;
  n_log_id?: string;
  n_type?: string;
  n_title?: string;
  n_body?: string;
  n_channel?: string;
  n_sound?: string;
  n_route?: string;
  /** The original server-side `data` object, JSON-encoded. */
  n_data?: string;
}

const SEEN_KEY = 'powr_display_push_seen_v1';
const SEEN_LIMIT = 30;

/** FCM re-delivers on its own schedule and the foreground listener and the
 *  headless task can both see the same message during an app transition. A
 *  duplicate banner is the specific failure this codebase has already shipped
 *  once — gym-visit-beacon's ANNOUNCE pass, deleted 2026-08-07, told users about
 *  a check-in twice. Dedupe on the server's per-send id, which is unique per
 *  send and stable across re-deliveries of that send.
 *
 *  Fails OPEN: if storage is unreadable we show the notification. Missing a
 *  banner is worse than the small chance of repeating one. */
async function claimFirstDelivery(logId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    if (Array.isArray(seen) && seen.includes(logId)) return false;
    const next = [logId, ...(Array.isArray(seen) ? seen : [])].slice(0, SEEN_LIMIT);
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch { /* fail open — see docstring */ }
  return true;
}

/** Tell the server the banner was displayed.
 *
 *  ⚠ FIRE-AND-FORGET, AND NEVER AWAITED BY THE CALLER. This runs on a wake path,
 *  and the rule there was learned by losing three days to it: awaiting telemetry
 *  killed the entire wake chain on 2026-08-03, because a Doze-frozen request
 *  reaches the server and the client promise simply never settles. Raw fetch on
 *  the anon key for the same reason the visit RPCs use one — any path through
 *  the auth machinery can freeze a backgrounded process outright.
 *
 *  A lost stamp is expected and costs nothing: delivered_at proves display when
 *  present and proves nothing when absent, and the migration says so at length. */
export function markPushDisplayed(logId: string): void {
  try {
    void fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_push_displayed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ p_log_id: logId }),
    }).catch(() => { /* telemetry must never cost a notification */ });
  } catch { /* ditto */ }
}

/** True when this payload is a server-sent visible push awaiting local render. */
export function isDisplayPush(payload: unknown): payload is DisplayPushPayload {
  return !!payload
    && typeof payload === 'object'
    && (payload as DisplayPushPayload).type === DISPLAY_NOTIFICATION_TYPE;
}

/** Present a direct visible push as a local notification, then stamp delivery.
 *
 *  Returns true when a banner was scheduled. Safe to call from a headless
 *  context: local notifications from a headless Android task are confirmed
 *  working (field 2026-08-07 — a Pixel swiped away from recents displayed the
 *  client's banner from a headless check-in, which is what disproved the old
 *  "the schedule call silently no-ops without a UI context" belief and got the
 *  server's duplicate ANNOUNCE pass deleted). */
export async function presentDisplayPush(payload: DisplayPushPayload): Promise<boolean> {
  // ⚠ READS BOTH SHAPES, AND MUST KEEP DOING SO UNTIL EVERY BUNDLE PREDATING THE
  // n_ RENAME IS GONE (2026-08-09).
  //
  // The rename is a wire-format break in BOTH directions, and there is no deploy
  // order that avoids it:
  //   • server first — an old bundle reads `title`, finds nothing, shows NOTHING.
  //   • OTA first    — a new bundle reads `n_title` against an old server that
  //                    still sends `title`, finds nothing, shows NOTHING.
  // Either way Android loses its notification entirely, which is strictly worse
  // than the duplicate this rename exists to remove. Accepting both shapes makes
  // every intermediate state safe, and the legacy branch costs one `??`.
  //
  // While a legacy-shaped push is in flight the phantom banner still appears —
  // that is unavoidable, it is posted by the library before we are consulted.
  // The duplicate stops the moment the server sends n_ keys.
  const pick = (next: unknown, legacy: unknown): string =>
    typeof next === 'string' ? next : (typeof legacy === 'string' ? legacy : '');
  const legacy = payload as Record<string, unknown>;

  const title = pick(payload.n_title, legacy.title);
  const body = pick(payload.n_body, legacy.body);
  if (!title && !body) return false;

  const logId = pick(payload.n_log_id, legacy.log_id);
  if (logId && !(await claimFirstDelivery(logId))) return false;

  // The server's original data object, so the tap handler reads the same shape
  // it would have read off an Expo-routed push. The type key restores what the
  // rest of the app switches on (NotificationsContext's points-refresh gate, the
  // activity feed, getRouteFromNotification's siblings).
  let data: Record<string, unknown> = {};
  const rawData = pick(payload.n_data, legacy.data);
  try {
    if (rawData) data = JSON.parse(rawData);
  } catch { /* a malformed data blob must not cost the user the banner */ }
  const notifType = pick(payload.n_type, legacy.notif_type);
  const route = pick(payload.n_route, legacy.route);
  if (notifType && !data.type) data.type = notifType;
  if (route && !data.route) data.route = route;

  // ⚠ THE CHANNEL MUST EXIST BEFORE WE SCHEDULE, AND ONLY THE UI USED TO MAKE IT.
  //
  // ensureAndroidChannels() was called from app/_layout.tsx alone — the UI root.
  // Every banner on this path is scheduled from a HEADLESS task, which on a device
  // whose UI has not mounted since install/update targets a channel that does not
  // exist. Android then accepts the schedule call and drops the notification, so
  // scheduleNotificationAsync resolves, markPushDisplayed stamps delivered_at, and
  // the user sees nothing — telemetry that says "delivered" for a banner that was
  // never posted.
  //
  // Field 2026-08-10: three Android pushes (12:19:04, 12:29:06, 12:54:02) all
  // stamped delivered_at and none appeared, and "General" was absent from the
  // device's notification panel entirely. Creating a channel that already exists
  // is a no-op, so this is cheap and idempotent.
  if (Platform.OS === 'android') {
    try {
      const { ensureAndroidChannels } = await import('@/lib/notifications');
      await ensureAndroidChannels();
    } catch { /* never let channel setup cost the banner */ }
  }

  try {
    await Notifications.scheduleNotificationAsync({
      // Stable per send: if the OS somehow delivers the same message twice past
      // the dedupe above, it replaces the banner instead of stacking a second.
      ...(logId ? { identifier: `powr-push-${logId}` } : {}),
      content: {
        title,
        body,
        data,
        ...(pick(payload.n_sound, legacy.sound) === '0' ? {} : { sound: 'default' as const }),
      },
      // ⚠ THE CHANNEL RIDES ON THE TRIGGER, NOT THE CONTENT (2026-08-11).
      // ArgumentsNotificationContentBuilder reads only title/subtitle/body/data/
      // sound/vibrate/priority/badge/color/autoDismiss/categoryIdentifier/sticky
      // from the content dict — a `channelId` there is silently dropped, and a
      // null trigger makes ExpoNotificationBuilder fall back to the auto-created
      // "Miscellaneous" channel. Every banner this file ever presented landed
      // there, one importance step below the HIGH channel it named. A
      // channel-aware trigger still presents immediately (ExpoSchedulingDelegate
      // routes it through the same receive() as a null trigger).
      trigger: Platform.OS === 'android'
        ? { channelId: pick(payload.n_channel, legacy.channel_id) || 'powr_default_v2' }
        : null,
    });
  } catch (err) {
    console.warn('[DisplayPush] present failed:', err);
    return false;
  }

  if (logId) markPushDisplayed(logId);
  return true;
}

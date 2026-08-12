// @ts-nocheck — Deno runtime, not Node.
// Direct FCM v1 delivery for ANDROID **visible** pushes, with an Expo fallback.
//
// ── WHY THIS EXISTS (field evidence 2026-08-09) ────────────────────────────
//
// Until now every user-facing push went through Expo on both platforms, while
// every silent wake went direct (FCM v1 on Android, APNs on iOS). That split
// was never a policy — fcmV1.ts says so in its own first line, "Direct FCM v1
// sender for ANDROID silent wakes". Wakes were provably broken in July and got
// fixed; visible pushes mostly worked, so nobody moved them.
//
// On 2026-08-09 a `gym_session_complete` push to powrcto was accepted by Expo
// at 11:27:01.628 with a clean receipt at 11:27:04.781, and reached the tray
// roughly 25 minutes later. The Expo hop was NOT the delay — a receipt of `ok`
// means FCM already had the message, so that leg cost 3.15 s. The handset had a
// genuine radio outage from ~11:27 to 11:35:03, which is the tempting
// explanation and the wrong one. Here is what settles it:
//
//   fence_refresh 11:28:02 (FCM-direct, HIGH) → delivered 11:35:03  (421.3 s)
//   fence_refresh 11:33:02 (FCM-direct, HIGH) → delivered 11:35:03  (121.0 s)
//   gym_session_complete 11:27:01 (Expo)      → delivered ~11:52    (~25 min)
//
// The link came back at 11:35:03 and FCM flushed both held direct messages
// instantly. The Expo-routed message — queued at FCM a full 61 s EARLIER than
// the first of them — was not flushed, and waited out roughly another Doze
// maintenance window. Same device, same outage, same FCM: the only variable is
// how the message was submitted. Across that whole day the direct path's median
// delivery was 0.4 s over 38 wakes, with that one outage the sole exception.
//
// Whether Expo downgraded our `priority: 'high'` or whether a GMS-rendered
// notification message is simply treated differently in Doze is not observable
// from our side, and does not change the remedy: submit it ourselves, HIGH, on
// our own channel. This is also a reproduction rather than a discovery — the
// 2026-07-14 matrix in project_android_silent_push_undelivered already recorded
// "priority-high 'Session recorded' receipt ok, never displayed".
//
// ── WHY DATA-ONLY, AND NOT AN FCM `notification` BLOCK ─────────────────────
//
// A `notification` block would have GMS render the banner, needing no OTA. It
// was rejected: per Firebase's delivery table — cited by expo-notifications'
// own FirebaseMessagingDelegate.onMessageReceived — a notification message
// delivered to a BACKGROUNDED app goes straight to the system tray and
// `onMessageReceived` is never called. expo-notifications would therefore never
// see it, which costs both things that matter: the tap would open the launcher
// instead of routing to `data.route`, and no listener could ever confirm the
// notification was displayed.
//
// So we send data-only at HIGH priority — byte-identical in transport to the
// wake that measures 0.4 s on this handset — and the client presents it. That
// keeps tap routing, puts the banner on our own HIGH-importance channel, and
// buys the first real delivery receipt this system has ever had (delivered_at).
// It does mean the render depends on JS running; headless local notifications
// are confirmed working on Android (field 2026-08-07, a Pixel swiped away from
// recents displayed the client's local banner from a headless check-in).
//
// ── WHY THERE IS NO AUTOMATIC EXPO RE-SEND ─────────────────────────────────
//
// The obvious next step — "if delivered_at is still null after N minutes, send
// it again via Expo" — is deliberately NOT here. gym-visit-beacon's ANNOUNCE
// pass did exactly that shape and was deleted on 2026-08-07 because its de-dupe
// depended on the client winning a race to mark the row; on precisely the
// headless case it existed to rescue, the mark was guaranteed not to land and
// the duplicate was guaranteed to fire. The user got two banners. The fallback
// here is server-side and deterministic instead: we fall back to Expo only when
// the direct send itself did not happen (no credentials, no device token, or
// FCM refused the message). delivered_at is observability, never a retry
// trigger — see the migration for why a null there proves nothing.

// ── STAGED, AND OFF BY DEFAULT ─────────────────────────────────────────────
//
// ⚠ THE DEPLOY ORDER IS LOAD-BEARING, WHICH IS WHY THERE IS A FLAG. A data-only
// push is rendered by the CLIENT. Ship this server change to a device whose
// bundle predates lib/displayPush.ts and extractData returns {}, the task exits
// at its type guard, and the user gets NOTHING — a strictly worse outcome than
// the 25-minute banner this exists to fix, and one that would land on every
// Android user at once.
//
// So the transport is read from system_config at send time, defaulting to the
// old path. Publish the OTA first, confirm it landed, then flip the key:
//
//   update system_config set value = 'fcm_direct' where key = 'visible_push_transport';
//
// Rollback is the same statement with 'expo', with no deploy. This mirrors how
// location_close_mode was staged on 'observe' for the same reason: a change
// whose safety depends on what is running on the handset should not go live at
// the moment the server learns about it.

import { deliverExpoMessages, PushLogContext } from './expoPush.ts';
import { sendFcmDataMessage } from './fcmV1.ts';

const TRANSPORT_KEY = 'visible_push_transport';

/** Read the transport flag from system_config.
 *
 *  Intentionally NOT cached at module scope: a flag flip should take effect
 *  immediately without waiting for a cold start, and the query cost is tiny.
 */
async function directEnabled(admin): Promise<boolean> {
  try {
    const { data } = await admin
      .from('system_config')
      .select('value')
      .eq('key', TRANSPORT_KEY)
      .maybeSingle();
    return String(data?.value ?? 'expo').trim().toLowerCase() === 'fcm_direct';
  } catch (err) {
    // Unreadable config must never mean "try the new thing".
    console.error('[visiblePush] transport read failed — staying on Expo', err);
    return false;
  }
}

/** Matches the app's CHANNEL_DEFAULT in lib/notifications.ts, created at
 *  AndroidImportance.HIGH. Defaulted here rather than left to the caller: the
 *  08-09 push omitted channelId entirely, which lands a notification on Expo's
 *  auto-created "Default" channel (importance DEFAULT — tray entry, no heads-up
 *  banner). A visible push should never be able to lose its channel by
 *  omission. */
const DEFAULT_CHANNEL = 'powr_default_v2';

/** FCM requires an explicit TTL. 4 weeks is FCM's own maximum and default, and
 *  matches the Expo path's treatment of durable types (session_completed and
 *  friends deliberately carry no ttl so they always arrive, however delayed). */
const DEFAULT_TTL_SEC = 28 * 24 * 60 * 60;

export interface PushTokenRow {
  expo_push_token: string | null;
  device_token?: string | null;
  platform?: string | null;
}

/** The content of one user-facing push, WITHOUT a `to` — this module fans it
 *  out across the user's devices and picks a transport per device. Mirrors the
 *  ExpoMessage shape in send-push-notification so callers can hand theirs over
 *  unchanged. */
export interface VisiblePushContent {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  ttl?: number;
}

export interface VisibleDeliverResult {
  direct: number;  // displayed-push messages FCM accepted directly
  queued: number;  // tickets Expo accepted on the fallback path
  failed: number;  // rejected by FCM (and not retried) or by Expo
  pruned: number;  // Expo tokens deleted by the ticket-level pass
}

/** Deliver one user-facing push to every device on `tokens`.
 *
 *  Android rows carrying a device_token go direct via FCM v1 (data-only, HIGH);
 *  everything else — iOS, Android rows with no device_token, and any row whose
 *  direct send could not be attempted or was refused — goes to Expo exactly as
 *  before. Rollback is the same switch as every other direct path: unset
 *  FCM_SERVICE_ACCOUNT and every row falls back to Expo.
 *
 *  Never throws: a delivery problem must not take down the caller. */
export async function deliverVisiblePush(
  admin,
  tokens: PushTokenRow[],
  content: VisiblePushContent,
  log: PushLogContext,
): Promise<VisibleDeliverResult> {
  const result: VisibleDeliverResult = { direct: 0, queued: 0, failed: 0, pruned: 0 };
  if (!tokens || tokens.length === 0) return result;

  const useDirect = await directEnabled(admin);
  const viaExpo: PushTokenRow[] = [];

  for (const row of tokens) {
    const isAndroid = (row.platform ?? '').toLowerCase() === 'android';
    if (!useDirect || !isAndroid || !row.device_token) {
      viaExpo.push(row);
      continue;
    }

    // The log row id is minted BEFORE the send so it can ride in the payload —
    // that is what lets the device stamp delivered_at against this exact send.
    const logId = crypto.randomUUID();
    const dataPayload = buildDisplayPayload(logId, log.type, content);
    const outcome = await sendFcmDataMessage(
      row.device_token,
      dataPayload,
      content.ttl ?? DEFAULT_TTL_SEC,
    );

    if (outcome.unavailable) {
      // No FCM credentials — the documented rollback. Old path, unchanged
      // behaviour, and no log row here because the Expo path writes its own.
      viaExpo.push(row);
      continue;
    }

    if (outcome.unregistered) {
      // Clear ONLY device_token, never the row: it also carries the Expo token,
      // and UNREGISTERED can be a token/environment mismatch rather than a dead
      // device. Expo's own receipt pruning stays the authority on removing rows.
      // Same rule as gym-visit-beacon's wake path.
      await admin.from('user_push_tokens')
        .update({ device_token: null })
        .eq('device_token', row.device_token)
        .then(({ error }) => { if (error) console.error('[visiblePush] device_token clear failed', error); });
    }

    if (outcome.ok) {
      result.direct++;
    } else {
      // FCM refused it, so nothing was delivered and a duplicate is impossible.
      // A user-facing push is worth the second attempt.
      result.failed++;
      viaExpo.push(row);
    }

    // Per-send forensics, same shape the Expo path writes. `accepted` here means
    // FCM took the message — one hop stronger than an Expo ticket, and still not
    // proof of display. delivered_at is the only column that proves that.
    await admin.from('push_send_log').insert({
      id: logId,
      user_id: log.userId,
      type: log.type,
      title: content.title,
      body: content.body,
      expo_push_token: row.expo_push_token ?? null,
      transport: 'fcm_direct',
      status: outcome.ok ? 'accepted' : 'rejected',
      ticket_id: outcome.messageName ?? null,
      error: outcome.ok ? null : (outcome.error ?? null),
      // The exact FCM data map, so the beacon's redelivery pass can resend an
      // accepted-but-never-drawn banner verbatim (2026-08-12 — a push arriving
      // mid app-state transition reached neither the headless task nor the
      // foreground listener; the user saw nothing and nothing retried). The
      // client's per-logId first-delivery claim makes a redelivery that races a
      // late display receipt harmless.
      payload: dataPayload,
      // The token the send actually used — expo_push_token above is the Expo
      // sibling, which a redelivery over raw FCM cannot address.
      device_token: row.device_token,
    }).then(({ error }) => { if (error) console.error('[visiblePush] direct log insert failed', error); });
  }

  if (viaExpo.length > 0) {
    const messages = viaExpo
      .filter((row) => !!row.expo_push_token)
      .map((row) => ({
        to: row.expo_push_token,
        title: content.title,
        body: content.body,
        ...(content.data ? { data: content.data } : {}),
        ...(content.sound ? { sound: content.sound } : {}),
        ...(content.badge != null ? { badge: content.badge } : {}),
        channelId: content.channelId ?? DEFAULT_CHANNEL,
        priority: content.priority ?? 'high',
        ...(content.ttl != null ? { ttl: content.ttl } : {}),
      }));
    if (messages.length > 0) {
      const expo = await deliverExpoMessages(admin, messages, log);
      result.queued += expo.queued;
      result.failed += expo.failed;
      result.pruned += expo.pruned;
    }
  }

  return result;
}

/** FCM v1 requires every `data` value to be a string. Keys land at `raw.data`
 *  verbatim on a direct send (no Expo envelope), which is exactly the shape
 *  extractData already matches on Android — so no JSON mirror is needed here,
 *  unlike the wake payload which has to survive Expo's iOS envelope.
 *
 *  ⚠ EVERY FIELD IS `n_`-PREFIXED, AND THAT IS NOT COSMETIC (field 2026-08-09).
 *
 *  expo-notifications reads notification content out of the FCM DATA payload,
 *  not just out of an FCM `notification` block. RemoteNotificationContent.kt:
 *
 *      override val title = remoteMessage.notification?.title ?: notificationData.title
 *      override val text  = remoteMessage.notification?.body  ?: notificationData.message
 *
 *  ...where notificationData wraps remoteMessage.data. And
 *  FirebaseMessagingDelegate.onMessageReceived calls NotificationsService.receive()
 *  UNCONDITIONALLY, before it runs the task-manager tasks — so the library posts
 *  its own banner from our data keys and THEN hands us the message to render.
 *  setNotificationHandler cannot stop it: that governs foreground presentation
 *  only, and this is the background path.
 *
 *  Shipping `title`/`body`/`sound` unprefixed therefore produced TWO banners on
 *  the first field run: a title-only, body-less one from the library (because it
 *  reads `data.title` for the title but `data.message` — which we did not send —
 *  for the text), followed by our correct one. Worse, `data.body` is parsed as
 *  JSON by NotificationData.body, and ours is prose.
 *
 *  The reserved set as of expo-notifications 0.32.x is: title, message, body,
 *  sound, vibrate, sticky, color, autoDismiss, categoryId, subtitle, badge.
 *  `type` is NOT reserved and must stay unprefixed — extractData matches on it. */
export function buildDisplayPayload(
  logId: string,
  type: string,
  content: VisiblePushContent,
): Record<string, string> {
  const route = typeof content.data?.route === 'string' ? content.data.route : '';
  return {
    type: 'display_notification',
    n_log_id: logId,
    n_type: type,
    n_title: content.title,
    n_body: content.body,
    n_channel: content.channelId ?? DEFAULT_CHANNEL,
    n_sound: content.sound === 'default' ? '1' : '0',
    ...(route ? { n_route: route } : {}),
    // The caller's own data object, round-tripped so the client can hand the
    // identical payload to the tap handler that already reads `route` from it.
    n_data: JSON.stringify(content.data ?? {}),
  };
}

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getGymUpgradeMinutes } from '@/lib/gymDwellConfig';
const CHANNEL_DEFAULT = 'powr_default_v2';
const CHANNEL_STREAK = 'powr_streak_v2';
const CHANNEL_REWARDS = 'powr_rewards_v2';

// ---------------------------------------------------------------------------
// Notification type catalogue
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'streak_at_risk'
  | 'weekly_challenge_expiry'
  | 'reward_unlocked'
  | 'check_in_reminder'
  | 'points_milestone'
  | 'inactivity_nudge'
  | 'session_completed'
  | 'sleep_target_met'
  | 'nearby_offer'
  | 'step_goal_nudge'
  | 'wearable_session_recorded'
  | 'session_mark';

export interface PointsMilestoneOptions {
  pointsToUnlock?: number;
  rewardName?: string;
}

export interface NotificationPayload {
  type: NotificationType;
  /** Deep-link route, e.g. '/(tabs)/rewards' */
  route?: string;
  [key: string]: unknown;
}

// NOTE: Do NOT install @react-native-firebase/messaging alongside
// expo-notifications. Both register a com.google.firebase.MESSAGING_EVENT
// service on Android and only one receives each message; RNFB's won, handed
// every Expo push (data-only FCM) to a no-op background handler, and silently
// dropped it — remote pushes never displayed on standalone builds from
// 2026-05-05 (926596c) until its removal on 2026-07-11. Expo pushes need
// expo-notifications' own service to display. See
// project_session_notification_incident_20260707.

// ---------------------------------------------------------------------------
// Foreground display handler — show banner even when app is open
// ---------------------------------------------------------------------------

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ---------------------------------------------------------------------------
// Android channel setup
// ---------------------------------------------------------------------------

export async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(CHANNEL_DEFAULT, {
    name: 'General',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#facc15',
  });

  await Notifications.setNotificationChannelAsync(CHANNEL_STREAK, {
    name: 'Streak Alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 400, 200, 400],
    lightColor: '#facc15',
  });

  await Notifications.setNotificationChannelAsync(CHANNEL_REWARDS, {
    name: 'Rewards',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#facc15',
  });
}

// ---------------------------------------------------------------------------
// Permission + token registration
// ---------------------------------------------------------------------------

export interface PushRegistration {
  expoPushToken: string;
  /** Raw FCM (Android) or APNs (iOS) device token */
  deviceToken: string | null;
  platform: 'ios' | 'android';
}

export async function requestPermissionsAndGetToken(
  opts: { promptIfNeeded?: boolean } = {},
): Promise<PushRegistration | null> {
  const { promptIfNeeded = true } = opts;

  if (!Device.isDevice) {
    // Simulators cannot receive push notifications
    return null;
  }

  await ensureAndroidChannels();

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    // Callers that only want to refresh an existing registration (e.g. the
    // automatic sign-in path while the user is still mid-onboarding) must not
    // ambush the user with the OS dialog — that ask belongs to the primed
    // onboarding-notifications screen.
    if (!promptIfNeeded) return null;

    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const tokenData = await Notifications.getExpoPushTokenAsync({
    // projectId is read from app.json automatically via Constants.expoConfig
  });

  // Raw native token (FCM on Android, APNs on iOS) for the direct-delivery
  // fallback path. expo-notifications reads it natively — no Firebase SDK.
  const deviceToken: string | null = await Notifications.getDevicePushTokenAsync().then(
    (t) => t.data as string,
    () => null,
  );

  return {
    expoPushToken: tokenData.data,
    deviceToken,
    platform: Platform.OS as 'ios' | 'android',
  };
}

// ---------------------------------------------------------------------------
// Local notification scheduling helpers
// ---------------------------------------------------------------------------

/** Cancel all scheduled notifications of a given type (matched by identifier prefix). */
export async function cancelNotificationsOfType(type: NotificationType) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const toCancel = scheduled.filter((n) => n.identifier.startsWith(`powr-${type}`));
  await Promise.all(toCancel.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

// ---------------------------------------------------------------------------
// Streak at risk — fire at 21:00 if user hasn't logged activity today
// ---------------------------------------------------------------------------

export async function scheduleStreakAtRiskWarning(currentStreak: number) {
  await cancelNotificationsOfType('streak_at_risk');

  const now = new Date();
  const fireAt = new Date(now);
  fireAt.setHours(21, 0, 0, 0);

  // If it's already past 21:00, don't schedule (too late for today)
  if (now >= fireAt) return;

  await Notifications.scheduleNotificationAsync({
    identifier: `powr-streak_at_risk-${Date.now()}`,
    content: {
      title: `Your ${currentStreak}-day streak is at risk 🔥`,
      body: "Log any activity before midnight to keep it alive.",
      data: { type: 'streak_at_risk', route: '/(tabs)/index' } satisfies NotificationPayload,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: CHANNEL_STREAK }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
    },
  });
}

export async function cancelStreakWarning() {
  await cancelNotificationsOfType('streak_at_risk');
}

// ---------------------------------------------------------------------------
// Weekly challenge expiry — 24 hours before deadline
// ---------------------------------------------------------------------------

export async function scheduleWeeklyChallengeExpiryWarning(
  challengeName: string,
  expiresAt: Date,
) {
  await cancelNotificationsOfType('weekly_challenge_expiry');

  const fireAt = new Date(expiresAt.getTime() - 24 * 60 * 60 * 1000);
  if (fireAt <= new Date()) return;

  await Notifications.scheduleNotificationAsync({
    identifier: `powr-weekly_challenge_expiry-${expiresAt.getTime()}`,
    content: {
      title: "Last day ⏳",
      body: `"${challengeName}" expires in 24 hours. Don't miss your bonus POWR points.`,
      data: {
        type: 'weekly_challenge_expiry',
        route: '/(tabs)/index',
      } satisfies NotificationPayload,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: CHANNEL_DEFAULT }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Reward unlocked — immediate local push (also fired server-side for reliability)
// ---------------------------------------------------------------------------

export async function notifyRewardUnlocked(rewardName: string, rewardId: string) {
  await Notifications.scheduleNotificationAsync({
    identifier: `powr-reward_unlocked-${rewardId}`,
    content: {
      title: "New reward unlocked 🎁",
      body: `You've unlocked "${rewardName}". Redeem it before it expires.`,
      data: {
        type: 'reward_unlocked',
        route: '/(tabs)/rewards',
        rewardId,
      } satisfies NotificationPayload,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: CHANNEL_REWARDS }),
    },
    trigger: null, // immediate
  });
}

// ---------------------------------------------------------------------------
// Check-in reminder preference cache
// The entry notification fires from the geofence background task, which runs
// outside React and can't read NotificationsContext. We mirror the user's
// check_in_reminder toggle into AsyncStorage so that code can respect it.
// ---------------------------------------------------------------------------

const CHECK_IN_PREF_KEY = '@powr/pref_check_in_reminder';

export async function cacheCheckInReminderPreference(enabled: boolean) {
  await AsyncStorage.setItem(CHECK_IN_PREF_KEY, enabled ? '1' : '0');
}

// Defaults to enabled when nothing has been cached yet, so the notification
// always fires unless the user has explicitly turned it off.
async function isCheckInReminderEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CHECK_IN_PREF_KEY)) !== '0';
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Check-in reminder — fired from GeofenceContext when entering a gym zone
// ---------------------------------------------------------------------------

// Suppress repeat check-in notifications for the same location within this
// window. The geofence ENTER event, the "already inside" check on app open,
// and the periodic foreground scan can all fire for the same visit; without a
// cooldown, reopening the app at a gym re-notifies on every launch.
const CHECK_IN_COOLDOWN_MS = 30 * 60 * 1000;
const CHECK_IN_LAST_FIRED_PREFIX = '@powr/check_in_last_fired/';

/** Returns whether the banner was scheduled OR suppressed by cooldown.
 *  true = treat as "user already told locally" (no server copy); false = suppressed (pref off / no permission).
 *  Throws if scheduling fails (caller should fall back to server announce on Android). */
export async function notifyCheckInAvailable(partnerName: string, locationId: string): Promise<boolean> {
  if (!(await isCheckInReminderEnabled())) return false;

  const permissions = await Notifications.getPermissionsAsync().catch(() => null);
  const allowed = permissions?.granted
    || permissions?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!allowed) return false;

  const cooldownKey = `${CHECK_IN_LAST_FIRED_PREFIX}${locationId}`;
  try {
    const lastFiredRaw = await AsyncStorage.getItem(cooldownKey);
    if (lastFiredRaw) {
      const lastFired = parseInt(lastFiredRaw, 10);
      // Within cooldown = the user has already been told recently. Report true
      // so the caller doesn't trigger a server push the cooldown exists to
      // prevent.
      if (Number.isFinite(lastFired) && Date.now() - lastFired < CHECK_IN_COOLDOWN_MS) return true;
    }
  } catch { /* non-fatal — fall through and notify */ }

  await Notifications.scheduleNotificationAsync({
    identifier: `powr-check_in_reminder-${locationId}`,
    content: {
      title: 'POWR',
      body: "You're in. Every minute counts.",
      data: {
        type: 'check_in_reminder',
        route: '/(tabs)/index',
        locationId,
        partnerName,
      } satisfies NotificationPayload,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: CHANNEL_DEFAULT }),
    },
    trigger: null, // immediate
  });
  // Stamp only after scheduling succeeds; otherwise a transient local-notification
  // failure would suppress the next legitimate entry alert for 30 minutes.
  await AsyncStorage.setItem(cooldownKey, String(Date.now())).catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Session mark notifications — iOS swiped-away only.
//
// Apple never delivers background pushes to a force-quit app, so the beacon's
// at-the-mark wakes (and therefore the server's "Session recorded" push) cannot
// reach a swiped-away iPhone mid-session. But iOS DOES deliver SCHEDULED local
// notifications regardless of app state (field-proven 2026-08-05: a force-quit
// relaunch displayed the check-in banner). So at check-in — a moment we are
// provably awake — we pre-schedule the 30/40-minute banners for the times the
// thresholds will pass. Honesty is kept by the region-EXIT relaunch (also
// proven 2026-08-05), which cancels any mark the user left before reaching.
// The points themselves still settle through the usual claim paths; these
// banners announce the outcome at the moment it becomes true.
//
// Android never schedules these: its background pushes are reliable and carry
// the real points/streak copy.
// ---------------------------------------------------------------------------

const SESSION_MARK_ID_PREFIX = 'powr-session_mark-';

export async function scheduleSessionMarkNotifications(opts: {
  visitId: string;
  partnerName: string;
  entryTimestampMs: number;
  dwellMinutes: number;
  upgradeMinutes: number;
}): Promise<void> {
  if (Platform.OS !== 'ios') return;

  const permissions = await Notifications.getPermissionsAsync().catch(() => null);
  const allowed = permissions?.granted
    || permissions?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!allowed) return;

  const marks = [
    {
      suffix: 'dwell',
      minutes: opts.dwellMinutes,
      title: 'Session recorded 🔥',
      // Mirrors the server push's shape ("Session recorded 🔥 · POWR · +15 pts")
      // minus the numbers a pre-claim banner cannot know — points settle when
      // the session wraps.
      body: `${opts.partnerName} · ${opts.dwellMinutes} min session banked`,
    },
    {
      suffix: 'upgrade',
      minutes: opts.upgradeMinutes,
      title: 'Bonus unlocked 🔓',
      body: `${opts.partnerName} · ${opts.upgradeMinutes}+ min session`,
    },
  ];

  for (const mark of marks) {
    const fireAt = new Date(opts.entryTimestampMs + mark.minutes * 60_000);
    // Finite-check as well as past-check: a NaN date reaches expo-notifications'
    // native Swift conversion as a NaN interval, which traps UNCATCHABLY on iOS
    // (2026-08-05 crash-hunt finding). NaN can only come from corrupted
    // entryTimestampMs/config, but a corrupt banner must never cost the process.
    if (!Number.isFinite(fireAt.getTime()) || fireAt <= new Date()) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${SESSION_MARK_ID_PREFIX}${mark.suffix}-${opts.visitId}`,
        content: {
          title: mark.title,
          body: mark.body,
          data: {
            type: 'session_mark',
            route: '/(tabs)/index',
            visitId: opts.visitId,
            mark: mark.suffix,
          } satisfies NotificationPayload,
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireAt,
        },
      });
    } catch (err) {
      // LOUD by policy: a silent catch on this exact API hid the Android
      // check-in gap for three weeks (2026-07-14 → 2026-08-05).
      console.warn(`[Notifications] session mark (${mark.suffix}) failed to schedule:`, err);
    }
  }
}

/** Cancels pending session marks the user did not stay long enough to earn.
 *  'all' when they left before the dwell threshold; 'upgrade_only' when they
 *  left between the two. Marks already delivered are untouched. */
export async function cancelSessionMarkNotifications(
  visitId: string,
  which: 'all' | 'upgrade_only',
): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const suffixes = which === 'all' ? ['dwell', 'upgrade'] : ['upgrade'];
  for (const suffix of suffixes) {
    await Notifications
      .cancelScheduledNotificationAsync(`${SESSION_MARK_ID_PREFIX}${suffix}-${visitId}`)
      .catch(() => { /* never scheduled on this runtime — nothing to cancel */ });
  }
}

// ---------------------------------------------------------------------------
// Nearby offer — fired from the placement background task when a location
// reward applies where the user physically is. Independent of the gym
// check-in reminder above and of the 25 m points geofence.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Client-side nudge budget
// ---------------------------------------------------------------------------
// The server enforces "one nudge-class push per user per local day" via
// push_send_log at the send-push chokepoint; locally-scheduled nudges
// (nearby_offer, the within-reach milestone, step_goal_nudge) never pass
// through it, so they share THIS pool instead — one local nudge per calendar
// day, whichever fires first. The ONLY same-day re-consume allowed is
// points_milestone re-claiming its own slot: within-reach cancels + reschedules
// itself to stay fresh, and that refresh replaces the pending nudge rather
// than adding one. Every other type gets no same-type exception — a second
// nearby_offer for a different placement is a second nudge, and it's denied.

const CLIENT_NUDGE_BUDGET_KEY = '@powr/client_nudge_budget';
const RESCHEDULABLE_NUDGE: NotificationType = 'points_milestone';

function localDayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function consumeClientNudgeBudget(type: NotificationType): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(CLIENT_NUDGE_BUDGET_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as { day?: string; type?: string };
      if (prev?.day === localDayKey()) {
        return prev.type === type && type === RESCHEDULABLE_NUDGE;
      }
    }
    await AsyncStorage.setItem(CLIENT_NUDGE_BUDGET_KEY, JSON.stringify({ day: localDayKey(), type }));
    return true;
  } catch {
    return true; // budget plumbing must never mute notifications outright
  }
}

const NEARBY_OFFER_PREF_KEY = '@powr/pref_nearby_offer';
// Don't re-notify about the same placement within this window (a wake happens
// ~every 15 min; without this the user would be pinged repeatedly in one visit).
const NEARBY_OFFER_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const NEARBY_OFFER_LAST_FIRED_PREFIX = '@powr/nearby_offer_last_fired/';

export async function cacheNearbyOfferPreference(enabled: boolean) {
  await AsyncStorage.setItem(NEARBY_OFFER_PREF_KEY, enabled ? '1' : '0');
}

export async function isNearbyOfferEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(NEARBY_OFFER_PREF_KEY)) !== '0';
  } catch {
    return true;
  }
}

/**
 * Present a "reward nearby" notification. Returns true if it actually fired
 * (so the caller can log the 'notified' funnel event only when shown). No-ops
 * when the pref is off or the placement is still within its cooldown.
 */
export async function notifyNearbyOffer(opts: {
  placementId: string;
  rewardName: string;
  brandName?: string | null;
}): Promise<boolean> {
  if (!(await isNearbyOfferEnabled())) return false;

  // OS-level permission: without it the schedule call shows nothing, and the
  // caller would log a 'notified' funnel event for a push nobody ever saw.
  const perms = await Notifications.getPermissionsAsync().catch(() => null);
  const allowed = perms?.granted
    || perms?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!allowed) return false;

  const cooldownKey = `${NEARBY_OFFER_LAST_FIRED_PREFIX}${opts.placementId}`;
  try {
    const lastFiredRaw = await AsyncStorage.getItem(cooldownKey);
    if (lastFiredRaw) {
      const lastFired = parseInt(lastFiredRaw, 10);
      if (Number.isFinite(lastFired) && Date.now() - lastFired < NEARBY_OFFER_COOLDOWN_MS) return false;
    }
  } catch { /* non-fatal — fall through and notify */ }

  // Shares the one-local-nudge-per-day pool with within-reach + step goal.
  if (!(await consumeClientNudgeBudget('nearby_offer'))) return false;

  const title = opts.brandName ? `${opts.brandName} is nearby` : 'A reward is nearby';
  await Notifications.scheduleNotificationAsync({
    identifier: `powr-nearby_offer-${opts.placementId}`,
    content: {
      title,
      body: `${opts.rewardName} is boosted where you are right now — open to redeem.`,
      data: {
        type: 'nearby_offer',
        route: '/(tabs)/rewards',
        placementId: opts.placementId,
      } satisfies NotificationPayload,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: CHANNEL_DEFAULT }),
    },
    trigger: null, // immediate
  });
  // Stamp the cooldown only after a successful schedule so a failed attempt
  // doesn't mute the placement for 6 h without any push having been shown.
  await AsyncStorage.setItem(cooldownKey, String(Date.now())).catch(() => {});
  return true;
}

export async function notifySessionCompleted(
  partnerName: string,
  sessionId: string,
  earned?: number,
  currentStreak?: number,
) {
  const hasEarned = earned !== undefined && earned > 0;
  const title = hasEarned ? `+${earned!.toLocaleString()} pts earned! 🔥` : 'Session complete 🔥';

  const name = partnerName.trim();
  let body: string;
  if (name && currentStreak && currentStreak > 0) {
    body = `${name} · Day ${currentStreak} streak`;
  } else if (name) {
    body = name;
  } else if (currentStreak && currentStreak > 0) {
    body = `Day ${currentStreak} streak`;
  } else {
    body = 'Your session counted.';
  }

  await Notifications.scheduleNotificationAsync({
    identifier: `powr-session_completed-${sessionId}`,
    content: {
      title,
      body,
      data: {
        type: 'session_completed',
        route: `/share-stats?mode=check-in&sessionId=${sessionId}`,
        sessionId,
        partnerName,
      } satisfies NotificationPayload,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: CHANNEL_REWARDS }),
    },
    trigger: null, // immediate
  });
}

// On-device fallback for the upgrade-tier bonus. Mirrors the server
// `session_upgraded` copy exactly so it's indistinguishable from the push. Fired
// by the geofence client only when the server reports it couldn't deliver.
// The threshold is admin-tunable (system_config → gym_upgrade_minutes).
export async function notifySessionUpgraded(
  partnerName: string,
  sessionId: string,
  earned?: number,
) {
  const name = partnerName.trim();
  const pts = Math.max(0, Math.round(earned ?? 0));
  const parts: string[] = [];
  if (name) parts.push(name);
  if (pts > 0) parts.push(`+${pts.toLocaleString()} pts`);
  parts.push(`${getGymUpgradeMinutes()}-min bonus`);

  await Notifications.scheduleNotificationAsync({
    identifier: `powr-session_upgraded-${sessionId}`,
    content: {
      title: 'Bonus unlocked 🔓',
      body: parts.join(' · '),
      data: {
        type: 'session_completed',
        route: `/share-stats?mode=check-in&sessionId=${sessionId}`,
        sessionId,
        partnerName,
      } satisfies NotificationPayload,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: CHANNEL_REWARDS }),
    },
    trigger: null, // immediate
  });
}

// ---------------------------------------------------------------------------
// Points milestone — sent server-side; this helper fires locally as fallback
// ---------------------------------------------------------------------------

export async function notifyPointsMilestone(points: number, options?: PointsMilestoneOptions) {
  const pointsToUnlock = Math.max(0, Math.ceil(options?.pointsToUnlock ?? 0));
  const rewardName = options?.rewardName?.trim();
  const hasWithinReach = pointsToUnlock > 0;

  const title = hasWithinReach ? 'Reward within reach' : `${points.toLocaleString()} POWR points`;
  const body = hasWithinReach
    ? `You're close. ${pointsToUnlock.toLocaleString()} pts to unlock your ${rewardName || 'next'} reward.`
    : 'All earned. Check your rewards — something new might be waiting.';

  await Notifications.scheduleNotificationAsync({
    identifier: `powr-points_milestone-${points}`,
    content: {
      title,
      body,
      data: {
        type: 'points_milestone',
        route: '/(tabs)/rewards',
        points,
        pointsToUnlock: hasWithinReach ? pointsToUnlock : undefined,
        rewardName,
      } satisfies NotificationPayload,
      sound: 'default',
    },
    trigger: null,
  });
}

// ---------------------------------------------------------------------------
// Reward within reach — spaced out, not fired back-to-back with the session
// push. Scheduled locally ~2.5h after a qualifying claim so it lands as its own
// re-engagement moment, and clamped to daytime so it never buzzes overnight.
// ---------------------------------------------------------------------------

const WITHIN_REACH_DELAY_MS = 2.5 * 60 * 60 * 1000; // ~2.5h after the session
const WITHIN_REACH_DAY_START = 8;  // earliest acceptable hour (08:00)
const WITHIN_REACH_DAY_END = 21;   // latest acceptable hour (21:00)
// Epoch-ms of the most recently scheduled within-reach fire time. Used to cap
// the nudge to once per calendar day regardless of how many sessions are claimed.
const WITHIN_REACH_FIRED_KEY = '@powr/within_reach_fire_at';

/** Fire time ~2.5h out, pulled into the 08:00–21:00 daytime window so the nudge
 *  never arrives overnight (defers to 09:00 the next morning if it would). */
function withinReachFireDate(): Date {
  const fireAt = new Date(Date.now() + WITHIN_REACH_DELAY_MS);
  const hour = fireAt.getHours();
  if (hour >= WITHIN_REACH_DAY_END) {
    fireAt.setDate(fireAt.getDate() + 1);
    fireAt.setHours(9, 0, 0, 0);
  } else if (hour < WITHIN_REACH_DAY_START) {
    fireAt.setHours(9, 0, 0, 0);
  }
  return fireAt;
}

function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * Schedule (or refresh) the spaced-out "Reward within reach" nudge from the
 * latest claim's within-reach state (the single highest-value reward the user
 * is >=85% toward — resolved server-side), or pass `null` to clear it.
 *
 * Capped at **once per calendar day**: if a nudge has already been delivered
 * today, later claims won't queue another. While today's nudge is still pending,
 * a new claim cancels and reschedules it (deferring ~2.5h and refreshing the
 * numbers), so only one is ever queued and it never double-buzzes in a day.
 */
export async function scheduleRewardWithinReach(
  data: { points_to_unlock: number; reward_name: string } | null,
) {
  const now = Date.now();

  // Once-per-day cap: if the last scheduled nudge already fired earlier today,
  // leave it alone — don't queue a second one for the same day.
  try {
    const raw = await AsyncStorage.getItem(WITHIN_REACH_FIRED_KEY);
    const lastFireAt = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(lastFireAt) && lastFireAt <= now && isSameLocalDay(lastFireAt, now)) {
      return;
    }
  } catch { /* non-fatal — fall through and (re)schedule */ }

  // Clear any still-pending nudge before re-evaluating.
  await cancelNotificationsOfType('points_milestone');
  if (!data) return; // no longer within reach (unlocked / moved out of range)

  const pointsToUnlock = Math.max(0, Math.ceil(data.points_to_unlock));
  if (pointsToUnlock <= 0) return; // already unlocked — nothing to nudge
  const rewardName = data.reward_name?.trim();

  // Shares the one-local-nudge-per-day pool (same-type re-consume is allowed,
  // so the cancel-and-reschedule freshness path above keeps working).
  if (!(await consumeClientNudgeBudget('points_milestone'))) return;

  const fireDate = withinReachFireDate();
  try {
    await AsyncStorage.setItem(WITHIN_REACH_FIRED_KEY, String(fireDate.getTime()));
  } catch { /* non-fatal */ }

  await Notifications.scheduleNotificationAsync({
    identifier: 'powr-points_milestone-within-reach',
    content: {
      title: 'Reward within reach',
      body: `You're close. ${pointsToUnlock.toLocaleString()} pts to unlock your ${rewardName || 'next'} reward.`,
      data: {
        type: 'points_milestone',
        route: '/(tabs)/rewards',
        pointsToUnlock,
        rewardName,
      } satisfies NotificationPayload,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: CHANNEL_REWARDS }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireDate,
    },
  });
}

// ---------------------------------------------------------------------------
// Inactivity nudge — scheduled after 3 days without a login/activity event
// ---------------------------------------------------------------------------

export async function scheduleInactivityNudge(daysInactive: number) {
  await cancelNotificationsOfType('inactivity_nudge');

  const messages: Record<number, { title: string; body: string }> = {
    3: {
      title: "We miss you 👋",
      body: "It's been 3 days. Even a short walk earns POWR points.",
    },
    7: {
      title: "Your streak is waiting to be rebuilt 🔄",
      body: "7 days away — jump back in and start earning again.",
    },
  };

  const msg = messages[daysInactive] ?? {
    title: "Ready to get back on track?",
    body: "Log any activity today and start your next streak.",
  };

  const fireAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

  await Notifications.scheduleNotificationAsync({
    identifier: `powr-inactivity_nudge-${daysInactive}`,
    content: {
      ...msg,
      data: { type: 'inactivity_nudge', route: '/(tabs)/index' } satisfies NotificationPayload,
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Sleep target reached — fired immediately after a wearable sleep sync
// ---------------------------------------------------------------------------

export async function notifySleepTargetMet(hours: number, points: number) {
  await Notifications.scheduleNotificationAsync({
    identifier: `powr-sleep_target_met-${Date.now()}`,
    content: {
      title: "Sleep goal reached 🌙",
      body: `${hours.toFixed(1)}h of sleep earned you ${points} POWR point${points !== 1 ? 's' : ''}.`,
      data: { type: 'sleep_target_met', route: '/(tabs)/index' } satisfies NotificationPayload,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: CHANNEL_DEFAULT }),
    },
    trigger: null, // immediate
  });
}

// ---------------------------------------------------------------------------
// Step-goal nudge — the walkers' evening push (see lib/stepGoalNotifyTask.ts)
// ---------------------------------------------------------------------------
// For a walking-only user this IS their streak-at-risk moment: the day is
// about to end unearned. Fired locally because only the device knows the live
// step count. Budget + once-per-day + window logic live in the task; this
// helper just presents.

export async function notifyStepGoal(opts: {
  stepsToNext: number;
  bonusPoints: number;
}): Promise<boolean> {
  const perms = await Notifications.getPermissionsAsync().catch(() => null);
  const allowed = perms?.granted
    || perms?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!allowed) return false;

  if (!(await consumeClientNudgeBudget('step_goal_nudge'))) return false;

  const steps = Math.max(1, Math.round(opts.stepsToNext));
  const pts = Math.max(1, Math.round(opts.bonusPoints));
  // ~110 steps/min is a comfortable walking cadence — frame the ask as time.
  const mins = Math.max(5, Math.round(steps / 110 / 5) * 5);

  await Notifications.scheduleNotificationAsync({
    identifier: 'powr-step_goal_nudge',
    content: {
      title: `${steps.toLocaleString()} steps to go 🚶`,
      body: `A ${mins}-minute walk locks in +${pts} POWR before midnight.`,
      data: { type: 'step_goal_nudge', route: '/(tabs)/index' } satisfies NotificationPayload,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: CHANNEL_DEFAULT }),
    },
    trigger: null, // immediate
  });
  return true;
}

// ---------------------------------------------------------------------------
// Badge management
// ---------------------------------------------------------------------------

export async function setBadgeCount(count: number) {
  await Notifications.setBadgeCountAsync(count);
}

export async function clearBadge() {
  await Notifications.setBadgeCountAsync(0);
}

// ---------------------------------------------------------------------------
// Notification response routing helper
// ---------------------------------------------------------------------------

export function getRouteFromNotification(
  response: Notifications.NotificationResponse,
): string | null {
  const data = response.notification.request.content.data as NotificationPayload | undefined;
  const rawRoute = typeof data?.route === 'string' ? data.route.trim() : '';
  if (!rawRoute) return null;

  // Support both in-app route strings (`/(tabs)/index`) and full deep links.
  if (rawRoute.startsWith('/')) return rawRoute;

  // Deep link: powr://host?query or powr://host/path?query.
  // Parse by string slicing — new URL() throws on custom schemes in Hermes.
  if (rawRoute.startsWith('powr://')) {
    const withoutScheme = rawRoute.slice('powr://'.length);
    if (!withoutScheme || withoutScheme === '/') return '/';

    const queryIdx = withoutScheme.indexOf('?');
    const slashIdx = withoutScheme.indexOf('/');
    let hostEnd: number;
    if (slashIdx >= 0 && queryIdx >= 0) hostEnd = Math.min(slashIdx, queryIdx);
    else if (slashIdx >= 0) hostEnd = slashIdx;
    else if (queryIdx >= 0) hostEnd = queryIdx;
    else hostEnd = withoutScheme.length;

    const host = withoutScheme.slice(0, hostEnd);
    const rest = withoutScheme.slice(hostEnd); // '' | '?...' | '/path?...'
    if (!host) return '/';

    return `/${host}${rest}`;
  }

  return null;
}

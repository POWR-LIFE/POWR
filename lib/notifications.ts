import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Notification type catalogue
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'daily_reminder'
  | 'streak_at_risk'
  | 'weekly_challenge_expiry'
  | 'reward_unlocked'
  | 'check_in_reminder'
  | 'points_milestone'
  | 'inactivity_nudge';

export interface NotificationPayload {
  type: NotificationType;
  /** Deep-link route, e.g. '/(tabs)/rewards' */
  route?: string;
  [key: string]: unknown;
}

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

async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('default', {
    name: 'General',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#facc15',
  });

  await Notifications.setNotificationChannelAsync('streak', {
    name: 'Streak Alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 400, 200, 400],
    lightColor: '#facc15',
  });

  await Notifications.setNotificationChannelAsync('rewards', {
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

export async function requestPermissionsAndGetToken(): Promise<PushRegistration | null> {
  if (!Device.isDevice) {
    // Simulators cannot receive push notifications
    return null;
  }

  await ensureAndroidChannels();

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
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

  const deviceToken = await Notifications.getDevicePushTokenAsync().then(
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
// Daily reminder
// ---------------------------------------------------------------------------

export async function scheduleDailyReminder(hour = 8, minute = 0) {
  await cancelNotificationsOfType('daily_reminder');

  await Notifications.scheduleNotificationAsync({
    identifier: 'powr-daily_reminder',
    content: {
      title: "Time to move 💪",
      body: "Every step earns POWR. Log your activity and keep the streak alive.",
      data: { type: 'daily_reminder', route: '/(tabs)/index' } satisfies NotificationPayload,
      sound: 'default',
      categoryIdentifier: 'daily_reminder',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      repeats: true,
      hour,
      minute,
    },
  });
}

export async function cancelDailyReminder() {
  await cancelNotificationsOfType('daily_reminder');
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
      ...(Platform.OS === 'android' && { channelId: 'streak' }),
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
      title: "Challenge ending soon ⏰",
      body: `"${challengeName}" expires in 24 hours. Don't miss your bonus POWR points.`,
      data: {
        type: 'weekly_challenge_expiry',
        route: '/(tabs)/progress',
      } satisfies NotificationPayload,
      sound: 'default',
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
      ...(Platform.OS === 'android' && { channelId: 'rewards' }),
    },
    trigger: null, // immediate
  });
}

// ---------------------------------------------------------------------------
// Check-in reminder — fired from GeofenceContext when entering a gym zone
// ---------------------------------------------------------------------------

export async function notifyCheckInAvailable(partnerName: string, locationId: string) {
  await Notifications.scheduleNotificationAsync({
    identifier: `powr-check_in_reminder-${locationId}`,
    content: {
      title: `You're at ${partnerName} 📍`,
      body: "Tap to check in and earn POWR points for your visit.",
      data: {
        type: 'check_in_reminder',
        route: '/(tabs)/index',
        locationId,
      } satisfies NotificationPayload,
      sound: 'default',
    },
    trigger: null, // immediate
  });
}

// ---------------------------------------------------------------------------
// Points milestone — sent server-side; this helper fires locally as fallback
// ---------------------------------------------------------------------------

export async function notifyPointsMilestone(points: number) {
  await Notifications.scheduleNotificationAsync({
    identifier: `powr-points_milestone-${points}`,
    content: {
      title: `${points.toLocaleString()} POWR points 🏆`,
      body: "You're crushing it. Check your rewards — something new might be waiting.",
      data: {
        type: 'points_milestone',
        route: '/(tabs)/rewards',
        points,
      } satisfies NotificationPayload,
      sound: 'default',
    },
    trigger: null,
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
  return data?.route ?? null;
}

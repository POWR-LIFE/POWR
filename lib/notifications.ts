import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, NativeModules } from 'react-native';
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
  | 'sleep_target_met';

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

// ---------------------------------------------------------------------------
// Firebase background message handler
// Must be registered outside of any React component (module-level)
// ---------------------------------------------------------------------------

if ((Platform.OS === 'android' || Platform.OS === 'ios') && NativeModules.RNFBAppModule) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const messaging = require('@react-native-firebase/messaging').default;
  messaging().setBackgroundMessageHandler(async (_remoteMessage: unknown) => {
    // Background FCM messages are handled silently by the system.
  });
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

  // Get the raw FCM token via Firebase Messaging (Android) or fallback
  let deviceToken: string | null = null;
  if (Platform.OS === 'android' && NativeModules.RNFBAppModule) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const messaging = require('@react-native-firebase/messaging').default;
      await messaging().registerDeviceForRemoteMessages();
      deviceToken = await messaging().getToken();
    } catch {
      // Fallback: try expo's device push token
      deviceToken = await Notifications.getDevicePushTokenAsync().then(
        (t) => t.data as string,
        () => null,
      );
    }
  } else {
    deviceToken = await Notifications.getDevicePushTokenAsync().then(
      (t) => t.data as string,
      () => null,
    );
  }

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
      title: "Challenge ending soon ⏰",
      body: `"${challengeName}" expires in 24 hours. Don't miss your bonus POWR points.`,
      data: {
        type: 'weekly_challenge_expiry',
        route: '/(tabs)/progress',
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
// Check-in reminder — fired from GeofenceContext when entering a gym zone
// ---------------------------------------------------------------------------

export async function notifyCheckInAvailable(partnerName: string, locationId: string) {
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
}

// ---------------------------------------------------------------------------
// Gym exit safety-net — scheduled with a short DATE trigger so it survives
// a background-task kill. Cancelled and replaced with notifySessionCompleted
// if the session is successfully claimed within the execution window.
// ---------------------------------------------------------------------------

export async function notifyGymExited(partnerName: string) {
  const name = partnerName.trim();
  await Notifications.scheduleNotificationAsync({
    identifier: `powr-session_completed-exit`,
    content: {
      title: 'Session recorded 🔥',
      body: name ? `${name} · Calculating your points…` : 'Calculating your points…',
      data: {
        type: 'session_completed',
        route: '/(tabs)/index',
      } satisfies NotificationPayload,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: CHANNEL_REWARDS }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      // 8-second delay: long enough for recordDwellSession to cancel this before
      // delivery if network is fast; short enough to be useful if the task dies.
      date: new Date(Date.now() + 8_000),
    },
  });
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
    : "You're crushing it. Check your rewards — something new might be waiting.";

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

  if (rawRoute.startsWith('powr://')) {
    try {
      const url = new URL(rawRoute);
      const path = url.pathname?.trim();
      if (!path || path === '/') return '/';
      return path.startsWith('/') ? path : `/${path}`;
    } catch {
      return '/';
    }
  }

  return null;
}

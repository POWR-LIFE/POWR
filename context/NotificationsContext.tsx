import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { AppState, AppStateStatus } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import {
  requestPermissionsAndGetToken,
  scheduleStreakAtRiskWarning,
  cancelStreakWarning,
  scheduleWeeklyChallengeExpiryWarning,
  notifyRewardUnlocked,
  notifyCheckInAvailable,
  notifyPointsMilestone,
  scheduleInactivityNudge,
  clearBadge,
  getRouteFromNotification,
  type PointsMilestoneOptions,
  type NotificationType,
} from '@/lib/notifications';
import {
  upsertPushToken,
  removePushToken,
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
  DEFAULT_PREFERENCES,
} from '@/lib/api/notifications';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface NotificationsContextValue {
  /** Whether the user has granted notification permission */
  permissionGranted: boolean;
  /** Current Expo push token for this device */
  expoPushToken: string | null;
  preferences: NotificationPreferences;
  updatePreferences: (prefs: Partial<NotificationPreferences>) => Promise<void>;
  /** Manually re-request permissions (e.g. from Settings screen) */
  requestPermissions: () => Promise<boolean>;
  // Convenience scheduling wrappers that respect preferences
  scheduleStreakWarning: (currentStreak: number) => Promise<void>;
  scheduleWeeklyChallenge: (name: string, expiresAt: Date) => Promise<void>;
  sendRewardUnlocked: (rewardName: string, rewardId: string) => Promise<void>;
  sendCheckInAvailable: (partnerName: string, locationId: string) => Promise<void>;
  sendPointsMilestone: (points: number, options?: PointsMilestoneOptions) => Promise<void>;
  sendInactivityNudge: (daysInactive: number) => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [permissionGranted, setPermissionGranted] = useState(false);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);

  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const coldStartHandled = useRef(false);

  // -------------------------------------------------------------------------
  // Register device for push when user signs in
  // -------------------------------------------------------------------------

  const registerForPush = useCallback(async (userId: string) => {
    try {
      const registration = await requestPermissionsAndGetToken();
      if (!registration) {
        setPermissionGranted(false);
        return;
      }

      setPermissionGranted(true);
      setExpoPushToken(registration.expoPushToken);

      await upsertPushToken(
        userId,
        registration.expoPushToken,
        registration.deviceToken,
        registration.platform,
      );
    } catch (err) {
      console.warn('[Notifications] Failed to register push token:', err);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Load preferences
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!user?.id) return;

    registerForPush(user.id);

    getNotificationPreferences(user.id)
      .then((prefs) => setPreferences(prefs))
      .catch((err) => console.warn('[Notifications] Failed to load preferences:', err));
  }, [user?.id, registerForPush]);

  // -------------------------------------------------------------------------
  // Clean up token on sign-out
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (user?.id || !expoPushToken) return;

    // User just signed out — we can't call removePushToken without userId,
    // so we just clear local state. The DB row stays until next sign-in
    // updates it, or the edge function handles missing users gracefully.
    setExpoPushToken(null);
    setPermissionGranted(false);
    setPreferences(DEFAULT_PREFERENCES);
  }, [user?.id, expoPushToken]);

  // -------------------------------------------------------------------------
  // Notification listeners
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Foreground notification received
    notificationListener.current = Notifications.addNotificationReceivedListener(() => {
      // Could increment an in-app badge counter here if needed
    });

    // User tapped a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const route = getRouteFromNotification(response);
        if (route) {
          router.push(route as Parameters<typeof router.push>[0]);
        }
        clearBadge();
      },
    );

    // Clear badge when app comes to foreground
    const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        clearBadge();
      }
      appState.current = nextState;
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
      appStateSub.remove();
    };
  }, [router]);

  // Handle notification that launched the app from a killed state (cold start).
  // addNotificationResponseReceivedListener does not fire for cold starts on iOS;
  // getLastNotificationResponseAsync is the only way to get that response.
  useEffect(() => {
    if (authLoading || !user?.id || coldStartHandled.current) return;
    coldStartHandled.current = true;

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const route = getRouteFromNotification(response);
      if (route) {
        router.push(route as Parameters<typeof router.push>[0]);
      }
    });
  }, [authLoading, user?.id, router]);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    await registerForPush(user.id);
    return permissionGranted;
  }, [user?.id, registerForPush, permissionGranted]);

  const updatePreferences = useCallback(
    async (partial: Partial<NotificationPreferences>) => {
      if (!user?.id) return;
      setPreferences((prev) => ({ ...prev, ...partial }));
      await updateNotificationPreferences(user.id, partial);
    },
    [user?.id],
  );

  const scheduleStreakWarning = useCallback(
    async (currentStreak: number) => {
      if (!preferences.streak_at_risk || !permissionGranted) return;
      await scheduleStreakAtRiskWarning(currentStreak);
    },
    [preferences.streak_at_risk, permissionGranted],
  );

  const scheduleWeeklyChallenge = useCallback(
    async (name: string, expiresAt: Date) => {
      if (!preferences.weekly_challenge_expiry || !permissionGranted) return;
      await scheduleWeeklyChallengeExpiryWarning(name, expiresAt);
    },
    [preferences.weekly_challenge_expiry, permissionGranted],
  );

  const sendRewardUnlocked = useCallback(
    async (rewardName: string, rewardId: string) => {
      if (!preferences.reward_unlocked || !permissionGranted) return;
      await notifyRewardUnlocked(rewardName, rewardId);
    },
    [preferences.reward_unlocked, permissionGranted],
  );

  const sendCheckInAvailable = useCallback(
    async (partnerName: string, locationId: string) => {
      if (!preferences.check_in_reminder || !permissionGranted) return;
      await notifyCheckInAvailable(partnerName, locationId);
    },
    [preferences.check_in_reminder, permissionGranted],
  );

  const sendPointsMilestone = useCallback(
    async (points: number, options?: PointsMilestoneOptions) => {
      if (!preferences.points_milestone || !permissionGranted) return;
      await notifyPointsMilestone(points, options);
    },
    [preferences.points_milestone, permissionGranted],
  );

  const sendInactivityNudge = useCallback(
    async (daysInactive: number) => {
      if (!preferences.inactivity_nudge || !permissionGranted) return;
      await scheduleInactivityNudge(daysInactive);
    },
    [preferences.inactivity_nudge, permissionGranted],
  );

  const value: NotificationsContextValue = {
    permissionGranted,
    expoPushToken,
    preferences,
    updatePreferences,
    requestPermissions,
    scheduleStreakWarning,
    scheduleWeeklyChallenge,
    sendRewardUnlocked,
    sendCheckInAvailable,
    sendPointsMilestone,
    sendInactivityNudge,
  };

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}

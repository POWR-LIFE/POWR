import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  cacheCheckInReminderPreference,
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
  fetchPendingActionCounts,
  type NotificationPreferences,
  type PendingActionCounts,
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
  /** Items awaiting the user's response — incoming friend requests + challenge invites. */
  pendingActions: PendingActionCounts;
  /** Re-fetch the pending-action counts (e.g. after acting on a request). */
  refreshPendingActions: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

// Identifier of the last notification response we navigated for. Persisted so a
// stale cold-start response (getLastNotificationResponseAsync returns the most
// recent tap even on a normal launch) isn't acted on more than once.
const LAST_HANDLED_NOTIF_KEY = '@powr/last_handled_notification_id';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [permissionGranted, setPermissionGranted] = useState(false);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [pendingActions, setPendingActions] = useState<PendingActionCounts>({
    friendRequests: 0,
    challengeInvites: 0,
    total: 0,
  });

  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const coldStartHandled = useRef(false);
  const handledResponseIds = useRef<Set<string>>(new Set());

  // -------------------------------------------------------------------------
  // Shared notification-tap handler (foreground listener + cold start)
  // -------------------------------------------------------------------------

  const handleNotificationResponse = useCallback(
    async (response: Notifications.NotificationResponse, fromColdStart: boolean) => {
      const id = response.notification.request.identifier;

      // Guard against acting on the same response twice within this session — on
      // Android both the listener and the cold-start path can see the launch tap.
      // Add to the set synchronously, before any await, so the second caller bails.
      if (id) {
        if (handledResponseIds.current.has(id)) return;
        handledResponseIds.current.add(id);
      }

      // getLastNotificationResponseAsync() returns the most recent tap even on a
      // normal cold start, which would re-navigate to a stale screen days later.
      // Skip if we already acted on this exact notification in a previous session.
      if (fromColdStart && id) {
        try {
          const lastHandled = await AsyncStorage.getItem(LAST_HANDLED_NOTIF_KEY);
          if (lastHandled === id) return;
        } catch {
          // storage unavailable — fall through and handle the tap
        }
      }

      if (id) {
        AsyncStorage.setItem(LAST_HANDLED_NOTIF_KEY, id).catch(() => { /* non-fatal */ });
      }

      const route = getRouteFromNotification(response);
      if (route) {
        router.push(route as Parameters<typeof router.push>[0]);
      }
      clearBadge();
    },
    [router],
  );

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
      .then((prefs) => {
        setPreferences(prefs);
        cacheCheckInReminderPreference(prefs.check_in_reminder);
      })
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
  // In-app pending-action badge (friend requests + challenge invites)
  // -------------------------------------------------------------------------

  const refreshPendingActions = useCallback(async () => {
    if (!user?.id) {
      setPendingActions({ friendRequests: 0, challengeInvites: 0, total: 0 });
      return;
    }
    setPendingActions(await fetchPendingActionCounts());
  }, [user?.id]);

  // Pull once on sign-in (and zero out on sign-out). Foreground + per-screen
  // focus refreshes are wired below / in ProfileButton.
  useEffect(() => {
    refreshPendingActions();
  }, [refreshPendingActions]);

  // -------------------------------------------------------------------------
  // Notification listeners
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Foreground notification received — a friend request / challenge invite may
    // have just landed, so re-pull the in-app counts that drive the avatar badge.
    notificationListener.current = Notifications.addNotificationReceivedListener(() => {
      refreshPendingActions();
    });

    // User tapped a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        handleNotificationResponse(response, false);
      },
    );

    // Clear the OS badge — and refresh in-app counts — when app comes to foreground
    const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        clearBadge();
        refreshPendingActions();
      }
      appState.current = nextState;
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
      appStateSub.remove();
    };
  }, [handleNotificationResponse, refreshPendingActions]);

  // Handle notification that launched the app from a killed state (cold start).
  // addNotificationResponseReceivedListener does not fire for cold starts on iOS;
  // getLastNotificationResponseAsync is the only way to get that response.
  useEffect(() => {
    if (authLoading || !user?.id || coldStartHandled.current) return;
    coldStartHandled.current = true;

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      handleNotificationResponse(response, true);
    });
  }, [authLoading, user?.id, handleNotificationResponse]);

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
      if (partial.check_in_reminder !== undefined) {
        await cacheCheckInReminderPreference(partial.check_in_reminder);
      }
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
    pendingActions,
    refreshPendingActions,
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

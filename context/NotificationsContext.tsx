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
import { AppState, AppStateStatus, Platform } from 'react-native';
import { useAuth } from '@/context/AuthContext';
// STATIC, side-effecting import — do NOT make this lazy. The module's top-level
// TaskManager.defineTask() is what gives the wake-up push somewhere to land, and
// TaskManager resolves a task by name against whatever the BUNDLE defined at load.
// Behind a dynamic import inside the effect below, it was only ever defined in a
// mounted, logged-in app — so a background/headless bundle load had no handler and
// FCM dropped every silent wake (Sony/Android 12 field capture, 2026-07-13).
import { registerBackgroundNotificationTask } from '@/lib/backgroundNotificationTask';
import { reportHandled } from '@/lib/crashHandler';
import { isExpoGoClient } from '@/lib/device';
import { emitPointsChanged } from '@/lib/pointsEvents';
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
import { isDisplayPush, presentDisplayPush } from '@/lib/displayPush';
import { supabase } from '@/lib/supabase';
import {
  upsertPushToken,
  removePushToken,
  getNotificationPreferences,
  updateNotificationPreferences,
  fetchPendingActionCounts,
  fetchUnreadActivityCount,
  markAllActivityRead,
  type NotificationPreferences,
  type PendingActionCounts,
  DEFAULT_PREFERENCES,
} from '@/lib/api/notifications';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

/**
 * Why a push-registration attempt ended.
 *
 * It used to answer `boolean`, which flattened "nothing to do, this device is
 * already registered" into the same value as "every push to this device now
 * dies, including the silent wakes the gym beacon rides on". One value per path
 * so a caller — and the log line beside it — can tell those apart.
 */
export type PushRegistrationOutcome =
  /** Token fetched and stored (or already stored, byte for byte). */
  | 'registered'
  /** OS permission is absent and this call was not allowed to ask for it. */
  | 'not_granted'
  /** Permission is fine (granted, or iOS provisional) but no token came back. */
  | 'no_token'
  /** Expo Go: its token is deliberately removed rather than registered. */
  | 'skipped_expo_go'
  /** A concurrent registration owns the fetch; this call did nothing. */
  | 'in_progress'
  /** Build configuration: getExpoPushTokenAsync found no EAS projectId. */
  | 'no_project_id'
  /** Threw. Recorded through reportHandled — no longer only a console line. */
  | 'failed';

interface NotificationsContextValue {
  /** Whether the user has granted notification permission */
  permissionGranted: boolean;
  /** Current Expo push token for this device */
  expoPushToken: string | null;
  preferences: NotificationPreferences;
  updatePreferences: (prefs: Partial<NotificationPreferences>) => Promise<void>;
  /** Manually re-request permissions (e.g. from Settings screen) */
  requestPermissions: () => Promise<boolean>;
  /**
   * This install HAD push and lost it: notification permission is off while a
   * token row still exists server-side for this user (see registerForPush).
   * True for the remainder of the session it was detected in, and raised at
   * most ONCE per install — the signal for Home's NotificationPrimeSheet to
   * open even when its own re-ask pacing would hold it back, because every
   * push to this device is currently dying in silence.
   */
  pushRecoveryPrimePending: boolean;
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
  /** Unread count for the in-app "Recent" activity feed. */
  unreadActivity: number;
  /** Re-fetch the unread activity count. */
  refreshActivity: () => Promise<void>;
  /** Mark the whole activity feed read and zero the unread count locally. */
  markActivityRead: () => Promise<void>;
  /**
   * Combined header-bell badge count: items awaiting a response (friend requests
   * + challenge invites) plus unread activity-feed items.
   */
  bellCount: number;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

// Identifier of the last notification response we navigated for. Persisted so a
// stale cold-start response (getLastNotificationResponseAsync returns the most
// recent tap even on a normal launch) isn't acted on more than once.
const LAST_HANDLED_NOTIF_KEY = '@powr/last_handled_notification_id';

// Stamped the one time an install is caught having LOST push (permission off,
// token row still on the server). Never cleared: that is what caps the recovery
// ask at once per install so it can't become a nag. An uninstall wipes
// AsyncStorage — and an uninstall is exactly the event that earns a fresh ask.
const PUSH_RECOVERY_PRIMED_KEY = '@powr/push_recovery_primed';

/**
 * "Permission is off, BUT the server still holds a push-token row for this
 * user" = this install had push and lost it.
 *
 * The reinstall path is the known cause: uninstalling resets notification
 * permission, so the automatic (promptIfNeeded:false) registration bails before
 * the upsert while the row survives holding a rotated-away APNs/FCM token.
 * Field-caught pre-test 2026-08-13 on iOS — the row stayed frozen on the dead
 * token until notifications were re-enabled by hand, and it would have killed
 * every background wake that morning. It is also the likeliest explanation for
 * the 38-of-70 profiles with no usable token (push_daily_stats backfill, same
 * day: 435 sends skipped `no_tokens` across 10 types, nothing surfaced).
 *
 * Bounded: a head count of the caller's own rows (RLS), skipped entirely once
 * the key above exists, and fired at most once per app session by the ref in
 * the provider — so a permanently-denied user costs nothing per foreground.
 */
async function detectLostPushRegistration(userId: string): Promise<boolean> {
  try {
    if (await AsyncStorage.getItem(PUSH_RECOVERY_PRIMED_KEY)) return false;

    const { count, error } = await supabase
      .from('user_push_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error || !count) return false; // no row = never had push; not a regression

    // Stamp BEFORE the sheet is surfaced, not after it is answered: whatever
    // the user does with it, this install has now had its one ask.
    await AsyncStorage.setItem(PUSH_RECOVERY_PRIMED_KEY, new Date().toISOString());
    console.warn(
      '[Notifications] Push permission lost while a token row still exists — every push to this device is dropping. Priming recovery once for this install.',
    );
    return true;
  } catch {
    // Storage or network unavailable — no stamp written, so the next launch
    // gets to look again. Silence here only delays the ask, it can't nag.
    return false;
  }
}

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
  const [unreadActivity, setUnreadActivity] = useState(0);
  const [pushRecoveryPrimePending, setPushRecoveryPrimePending] = useState(false);

  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const coldStartHandled = useRef(false);
  const handledResponseIds = useRef<Set<string>>(new Set());
  const registeringPush = useRef(false);
  // The lost-registration check costs one head count, and the foreground
  // re-check calls registerForPush on every single foreground while there is no
  // token — which is precisely the state being diagnosed. Once per session.
  const lostRegistrationChecked = useRef(false);
  const lastRegistration = useRef<{
    userId: string;
    expoPushToken: string;
    deviceToken: string | null;
  } | null>(null);


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

  const registerForPush = useCallback(
    async (
      userId: string,
      opts?: { promptIfNeeded?: boolean },
    ): Promise<PushRegistrationOutcome> => {
      // Fetching the token below fires addPushTokenListener on Android (it emits
      // on every fetch, not just rotations), whose handler calls back into this
      // function — without the guard that's an infinite upsert loop hammering
      // the API several times a second.
      if (registeringPush.current) return 'in_progress';
      registeringPush.current = true;
      try {
        // Automatic callers (sign-in effect, token-rotation listener, foreground
        // re-check) NEVER show the OS dialog — iOS grants exactly one shot at it,
        // so it must only fire from a primed surface the user deliberately tapped
        // (onboarding notifications page, NotificationPrimeSheet, settings).
        // Automatic calls silently refresh tokens for already-granted users.
        // Expo Go is only a development client. Remove its own prior token so
        // test sessions never receive production pushes alongside the installed app.
        if (isExpoGoClient()) {
          const registration = await requestPermissionsAndGetToken({ promptIfNeeded: false });
          if (registration) await removePushToken(userId, registration.expoPushToken);
          setExpoPushToken(null);
          setPermissionGranted(false);
          return 'skipped_expo_go';
        }

        const registration = await requestPermissionsAndGetToken({
          promptIfNeeded: opts?.promptIfNeeded ?? false,
        });
        if (!registration) {
          setPermissionGranted(false);

          // THE SILENT BAIL. Returning here is correct — iOS grants exactly one
          // shot at the dialog and an automatic call must never spend it — but
          // it said nothing, and that silence is a product bug: an uninstall
          // resets notification permission, so a returning user lands here
          // every launch while their surviving token row holds a rotated-away
          // value, and EVERY push (session_completed, streak, the beacon's
          // silent wake) dies unremarked. See detectLostPushRegistration.
          //
          // Two very different shapes arrive here, so name which one it was
          // instead of reporting one undifferentiated failure. The predicate is
          // `granted || iOS provisional` — the same one lib/notifications.ts
          // uses before every local notification (notifyCheckInAvailable,
          // notifyNearbyOffer, notifyStepGoal) — because on iOS provisional
          // authorization getPermissionsAsync reports status 'undetermined'
          // with granted false, and a bare !granted would file every quietly-
          // subscribed iOS install as a permission regression and ask them to
          // re-enable notifications they already have.
          const permissions = await Notifications.getPermissionsAsync().catch(() => null);
          const allowed = permissions?.granted
            || permissions?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
          if (allowed) {
            // Permission is not the problem (provisional install, simulator, or
            // a token fetch that came back empty) — nothing to prime and
            // nothing to heal, but it is still a device that cannot be reached.
            // permissionGranted stays false: it gates the local-scheduling
            // helpers below, and whether a provisional install should schedule
            // locals is a separate decision from making this bail visible.
            console.warn(
              '[Notifications] Notifications are permitted but no push token was returned — this device cannot receive pushes.',
            );
            return 'no_token';
          }

          // Web has no push install to lose (same reason the cold-start effect
          // below opts out) — don't spend a query proving it.
          if (Platform.OS !== 'web' && !lostRegistrationChecked.current) {
            lostRegistrationChecked.current = true;
            // Deliberately not awaited: the re-entrancy guard above is held
            // until this function returns, and a token rotation arriving during
            // an extra round trip would be dropped as 'in_progress'.
            void detectLostPushRegistration(userId).then((lost) => {
              if (lost) setPushRecoveryPrimePending(true);
            });
          }
          return 'not_granted';
        }

        setPermissionGranted(true);
        setExpoPushToken(registration.expoPushToken);

        const prev = lastRegistration.current;
        if (
          prev &&
          prev.userId === userId &&
          prev.expoPushToken === registration.expoPushToken &&
          prev.deviceToken === registration.deviceToken
        ) {
          return 'registered'; // already registered exactly this — skip the redundant writes
        }

        await upsertPushToken(
          userId,
          registration.expoPushToken,
          registration.deviceToken,
          registration.platform,
        );
        lastRegistration.current = {
          userId,
          expoPushToken: registration.expoPushToken,
          deviceToken: registration.deviceToken,
        };
        return 'registered';
      } catch (err) {
        // A throw here leaves the user with no deliverable token and used to
        // leave nothing behind but a console line no device ever ships — the
        // same invisibility that let 38 of 70 profiles reach 2026-08-13 with no
        // token at all. reportHandled spools to app_errors and never awaits, so
        // it is safe on the paths that reach this from a wake.
        console.warn('[Notifications] Failed to register push token:', err);
        reportHandled(err, {
          where: 'registerForPush',
          promptIfNeeded: opts?.promptIfNeeded ?? false,
        });
        // A missing EAS projectId is a build fault, not a flake: it throws for
        // every user on that build, forever, and reads exactly like a dropped
        // request unless it is named apart from one.
        const message = err instanceof Error ? err.message : String(err);
        return /projectid/i.test(message) ? 'no_project_id' : 'failed';
      } finally {
        registeringPush.current = false;
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Load preferences
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!user?.id) return;

    registerForPush(user.id);

    // Lets the gym-visit beacon's SILENT push wake us while backgrounded/closed —
    // a stationary phone gets no location callbacks, so the server has to knock.
    registerBackgroundNotificationTask()
      .catch((err) => console.warn('[Notifications] Background task registration failed:', err));

    getNotificationPreferences(user.id)
      .then((prefs) => {
        setPreferences(prefs);
        cacheCheckInReminderPreference(prefs.check_in_reminder);
      })
      .catch((err) => console.warn('[Notifications] Failed to load preferences:', err));
  }, [user?.id, registerForPush]);

  // The background task does NOT run when the app is in the foreground — the
  // received-listener gets the push instead. Handle the beacon's presence check
  // here too, or an open app would silently ignore it.
  useEffect(() => {
    if (!user?.id) return;

    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification?.request?.content?.data as
        { type?: string; stage?: 'dwell' | 'upgrade' } | undefined;
      if (data?.type !== 'gym_visit_check') return;

      const stage = data.stage === 'upgrade' ? 'upgrade' : 'dwell';
      import('@/context/GeofenceContext')
        .then(({ runVisitCheck }) => runVisitCheck(stage))
        .catch((err) => console.warn('[Notifications] Foreground visit check failed:', err));
    });

    return () => sub.remove();
  }, [user?.id]);

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
  // Keep the registered push token alive
  // -------------------------------------------------------------------------
  // Two failure modes leave a user with NO deliverable token — every server
  // push (session_completed, session_upgraded, reward_unlocked, within-reach,
  // broadcasts) then silently drops:
  //   1. The OS rotates the APNs/FCM token (OS update, restore, reinstall,
  //      periodic refresh) while the user stays signed in. The old Expo token
  //      is pruned as DeviceNotRegistered on the next send, but nothing had
  //      re-registered the new one — so the row is simply gone until a cold
  //      start happens to re-run registration.
  //   2. The initial sign-in registration failed (offline / transient) and,
  //      because it only runs on user?.id change, never retried.
  // addPushTokenListener closes (1): re-fetch the fresh Expo token and upsert it
  // the instant the native token rotates. The foreground re-check closes (2):
  // if we still have no token when the app comes forward, try again.
  useEffect(() => {
    if (!user?.id) return;
    const uid = user.id;

    const tokenSub = Notifications.addPushTokenListener((token) => {
      // Fires for every native token *fetch* (including our own inside
      // registerForPush), not only real rotations. Only re-register when the
      // token actually differs from the one we last stored.
      const data = typeof token?.data === 'string' ? token.data : null;
      if (registeringPush.current) return;
      if (data && data === lastRegistration.current?.deviceToken) return;
      registerForPush(uid);
    });

    const appSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      if (!expoPushToken) registerForPush(uid);
      // Rebind the silent-wake task on every foreground. The native binding dies
      // when the JS context changes under the process (OTA reload, headless-born
      // start) and a dead binding drops every server wake until the next cold
      // start — foregrounding is the earliest moment this context can take it
      // back (field-proven 2026-07-17).
      registerBackgroundNotificationTask()
        .catch((err) => console.warn('[Notifications] Background task rebind failed:', err));
    });

    return () => {
      tokenSub.remove();
      appSub.remove();
    };
  }, [user?.id, expoPushToken, registerForPush]);

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

  const refreshActivity = useCallback(async () => {
    if (!user?.id) {
      setUnreadActivity(0);
      return;
    }
    setUnreadActivity(await fetchUnreadActivityCount());
  }, [user?.id]);

  const markActivityRead = useCallback(async () => {
    setUnreadActivity(0); // optimistic — the screen opened, badge should clear now
    if (!user?.id) return;
    await markAllActivityRead();
  }, [user?.id]);

  // Pull once on sign-in (and zero out on sign-out). Foreground + per-screen
  // focus refreshes are wired below / in ProfileButton.
  useEffect(() => {
    refreshPendingActions();
    refreshActivity();
  }, [refreshPendingActions, refreshActivity]);

  // -------------------------------------------------------------------------
  // Notification listeners
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Foreground notification received — a friend request / challenge invite or a
    // feed-worthy event may have just landed, so re-pull both badge sources.
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      // A direct visible push (2026-08-09) arrives data-only and undisplayed —
      // the background task does not run while the app is open, so the
      // foreground render belongs here. presentDisplayPush is idempotent per
      // send, so the local notification it schedules re-entering this listener
      // is harmless; the refreshes below are idempotent too.
      const raw = notification?.request?.content?.data as Record<string, unknown> | undefined;
      if (isDisplayPush(raw)) void presentDisplayPush(raw);

      refreshPendingActions();
      refreshActivity();

      // A points/level-affecting push means the ['points'] cache is now stale;
      // nudge usePoints so the home "X pts to next level" readout can't lag the
      // notification. Gated to those types so friend-request/invite pushes don't
      // trigger a needless refetch.
      //
      // Reads notif_type first: on a direct visible push the outer `type` is the
      // transport marker, and the type the app actually switches on rides
      // alongside it.
      const data = raw as { type?: string; notif_type?: string } | undefined;
      const type = data?.notif_type ?? data?.type;
      const mayAffectPoints = type === 'level_up'
        || type === 'reward_unlocked'
        || type === 'points_milestone'
        || type === 'session_completed'
        || type === 'session_upgraded'
        || type === 'wearable_session_recorded';
      if (mayAffectPoints) emitPointsChanged();
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
        refreshActivity();
      }
      appState.current = nextState;
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
      appStateSub.remove();
    };
  }, [handleNotificationResponse, refreshPendingActions, refreshActivity]);

  // Handle notification that launched the app from a killed state (cold start).
  // addNotificationResponseReceivedListener does not fire for cold starts on iOS;
  // getLastNotificationResponseAsync is the only way to get that response.
  useEffect(() => {
    // Not implemented on web (expo start --web) — calling it throws and takes
    // the whole tree down; there is no push cold-start on web anyway.
    if (Platform.OS === 'web') return;
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
    // Deliberate user action (onboarding screen / settings) — always allowed to
    // show the OS dialog. Returns the fresh result, not the pre-request state.
    // Callers (NotificationPrimeSheet, onboarding) only ever branch on "did the
    // user end up reachable", so the outcome collapses to that here; anything
    // that needs the reason has registerForPush's own return value.
    const outcome = await registerForPush(user.id, { promptIfNeeded: true });
    if (outcome === 'registered') {
      // The recovery ask is answered — stop pointing the sheet at it.
      setPushRecoveryPrimePending(false);
    }
    return outcome === 'registered';
  }, [user?.id, registerForPush]);

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
    pushRecoveryPrimePending,
    scheduleStreakWarning,
    scheduleWeeklyChallenge,
    sendRewardUnlocked,
    sendCheckInAvailable,
    sendPointsMilestone,
    sendInactivityNudge,
    pendingActions,
    refreshPendingActions,
    unreadActivity,
    refreshActivity,
    markActivityRead,
    bellCount: pendingActions.total + unreadActivity,
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

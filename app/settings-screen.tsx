import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useState } from 'react';
import { Image } from 'expo-image';
import GeometricBackground from '@/components/GeometricBackground';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { HealthProviderId } from '@/lib/health/providers/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as SecureStore from 'expo-secure-store';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationsContext';
import { androidOpenHealthConnectSettings, useHealthData } from '@/hooks/useHealthData';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import { HealthProviderNotImplementedError } from '@/lib/health/providers';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { getSessionUser, supabase } from '@/lib/supabase';
import { getNotificationPreferences, updateNotificationPreferences } from '@/lib/api/notifications';
import { cacheNearbyOfferPreference, isNearbyOfferEnabled } from '@/lib/notifications';
import { requestBatteryOptimizationExemption } from '@/lib/batteryOptimization';
import { openStorePage, runningVersion } from '@/lib/appUpdate';
import { getAppVersion } from '@/lib/device';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';
const RED     = '#ef4444';

// Real version + build + OTA update id (short), so support conversations match
// what the admin panel shows. Module-level: it can only change via a reload.
const { appVersion, appBuild, otaUpdateId } = getAppVersion();
const appVersionLabel = `POWR · v${appVersion ?? '?'}${appBuild ? ` (${appBuild})` : ''}${
  otaUpdateId ? ` · ${otaUpdateId.slice(0, 8)}` : ''
}`;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut, user, updateUserMetadata } = useAuth();
  const { requestPermissions } = useNotifications();

  const [isAdmin, setIsAdmin] = React.useState(false);
  const health = useHealthData();
  const providers = useHealthProviders();

  // Provider state can change out-of-band — e.g. the /terra-callback route (and
  // Terra's auth webhook) write `health_provider_connections` after this screen
  // has already mounted. Re-read on focus so the UI always reflects the profile
  // truth and we never show "Connected" when the connection actually failed.
  useFocusEffect(
    useCallback(() => { providers.refresh(); }, [providers.refresh]),
  );
  const [locationStatus, setLocationStatus] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
  // Background ("Always" / "Allow all the time") location + OS notification permission.
  // Closed-app gym detection silently fails without background location, so we surface it.
  const [bgLocationGranted, setBgLocationGranted] = useState<boolean | null>(null);
  // Android 12+ "Approximate" grants can't verify 25 m gym geofences — surfaced
  // as their own broken state. null = unknown / iOS (no API to detect there).
  const [preciseGranted, setPreciseGranted] = useState<boolean | null>(null);
  // OS notification permission. 'undetermined' = never asked (the app hasn't even
  // registered, so iOS shows no Notifications row in its settings — tapping the
  // banner must fire the OS dialog, not deep-link to a page with nothing to fix).
  // 'denied' = user said no earlier → deep-link to Settings. null = still loading.
  const [notifStatus, setNotifStatus] = useState<'granted' | 'denied' | 'undetermined' | null>(null);
  const notifGranted = notifStatus === null ? null : notifStatus === 'granted';

  React.useEffect(() => {
    (async () => {
      const { supabase, getSessionUser } = await import('@/lib/supabase');
      const user = await getSessionUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      if (data?.is_admin) setIsAdmin(true);
    })();
  }, []);

  // Check location + notification permission status. Re-checked on focus so it
  // updates after the user returns from the system settings app.
  const refreshPermissionStatuses = useCallback(async () => {
    const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
    if (fg) {
      setLocationStatus(fg.status === 'granted' ? 'granted' : fg.status === 'denied' ? 'denied' : 'undetermined');
      setPreciseGranted(fg.android ? fg.android.accuracy === 'fine' : null);
    }
    const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (bg) setBgLocationGranted(bg.status === 'granted');
    const notif = await Notifications.getPermissionsAsync().catch(() => null);
    if (notif) {
      setNotifStatus(
        notif.status === 'granted' ? 'granted'
          : notif.status === 'denied' ? 'denied'
            : 'undetermined',
      );
    }
  }, []);

  useFocusEffect(
    useCallback(() => { refreshPermissionStatuses(); }, [refreshPermissionStatuses]),
  );

  // Banner tap when notifications are off. If we've never asked ('undetermined')
  // the app hasn't registered — fire the OS dialog (which also registers the push
  // token, so a Notifications row finally appears in iOS settings). If the user
  // already denied it, the OS won't show the dialog again, so send them to
  // Settings with an explanation rather than a page that has nothing to toggle.
  const handleEnableNotifications = useCallback(async () => {
    if (notifStatus === 'undetermined') {
      const granted = await requestPermissions();
      if (!granted) {
        // They dismissed/denied the dialog — the permission is now 'denied', so
        // the only remaining path is the system settings app.
        Alert.alert(
          'Notifications off',
          'To get gym check-ins and reward alerts, turn on Notifications for POWR in Settings.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
      refreshPermissionStatuses();
    } else {
      // 'denied' — iOS won't re-prompt, so Settings is the only lever.
      Linking.openSettings();
    }
  }, [notifStatus, requestPermissions, refreshPermissionStatuses]);

  // Activity preferences (saved in user_metadata, edited on dedicated screen).
  // Prefer the concrete catalog picks ("Padel, Boxing"); legacy bucket-only
  // users fall back to bucket short labels.
  const savedPrefs: ActivityType[] = user?.user_metadata?.activity_preferences ?? ['gym', 'running', 'walking'];
  const savedSelections: { label: string }[] | undefined = user?.user_metadata?.activity_selections;
  const activityFocusValue = Array.isArray(savedSelections) && savedSelections.length > 0
    ? ['Gym', ...savedSelections.map(s => s.label)].join(', ')
    : savedPrefs.map(t => ACTIVITIES[t]?.labelShort ?? t).join(', ');

  // Notification & privacy prefs — initialise from saved user_metadata
  const meta = user?.user_metadata ?? {};
  const [notifWorkouts,   setNotifWorkouts]   = useState(true);
  const [notifRewards,    setNotifRewards]    = useState(true);
  const [notifFriends,    setNotifFriends]    = useState(meta.notif_friends ?? true);
  const [notifNews,       setNotifNews]       = useState(true);
  const [notifNearby,     setNotifNearby]     = useState(true);
  const [notifWearable,   setNotifWearable]   = useState(true);
  const [notifStreak,     setNotifStreak]     = useState(true);
  const [notifLevelUp,    setNotifLevelUp]    = useState(true);
  const [notifDailyNudge, setNotifDailyNudge] = useState(true);
  const [emailWeekly,     setEmailWeekly]     = useState(true);
  const [shareActivity,   setShareActivity]   = useState(meta.share_activity ?? true);
  const [togetherEnabled, setTogetherEnabled] = useState(meta.together_enabled ?? true);
  useEffect(() => {
    if (!user?.id) return;
    getNotificationPreferences(user.id).then(prefs => {
      setNotifWorkouts(prefs.check_in_reminder);
      setNotifRewards(prefs.reward_unlocked);
      setNotifNews(prefs.announcements);
      setEmailWeekly(prefs.email_weekly_summary);
      // The "Friend activity" switch fronts all the together push types.
      setNotifFriends(prefs.challenge_invite);
      setNotifWearable(prefs.wearable_session);
      // Grouped switches initialise from the AND of every pref they front, so
      // a mixed state (e.g. streak_at_risk off but streak_rescue on, set
      // outside this screen) reads OFF — and flipping it ON re-enables the
      // whole group, which is the predictable direction to be wrong in.
      setNotifStreak(prefs.streak_at_risk && prefs.streak_rescue);
      setNotifLevelUp(prefs.level_up);
      setNotifDailyNudge(prefs.daily_reminder && prefs.step_goal_nudge && prefs.inactivity_nudge);
      // nearby_offer is now DB-backed; mirror to the local cache the
      // background task reads offline.
      setNotifNearby(prefs.nearby_offer);
      cacheNearbyOfferPreference(prefs.nearby_offer);
    });
  }, [user?.id]);

  // Persist a single metadata key when a toggle changes
  const persistMeta = async (key: string, value: boolean) => {
    await updateUserMetadata({ [key]: value });
  };

  // Delete account — confirmation then deletes via edge function or signs out
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all associated data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Call a Supabase edge function or RPC to delete user data
              const { error } = await supabase.rpc('delete_user_account');
              if (error) {
                // If no RPC exists yet, just sign out and inform the user
                Alert.alert(
                  'Contact Support',
                  'Please email support to complete account deletion. You will now be signed out.',
                );
                await signOut();
                return;
              }
              await signOut();
            } catch {
              Alert.alert(
                'Contact Support',
                'Please email support to complete account deletion. You will now be signed out.',
              );
              await signOut();
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      {/* ── Header ──────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Account ──────────────────────────────────────── */}
        <SectionLabel label="Account" />
        <View style={styles.card}>
          <RowLink
            icon="person-outline"
            label="Edit Profile"
            onPress={() => router.push('/edit-profile')}
          />
          <RowLink
            icon="mail-outline"
            label="Email"
            value={user?.email}
            onPress={() => router.push('/change-email')}
          />
          <RowLink
            icon="lock-closed-outline"
            label="Change Password"
            onPress={() => router.push('/change-password')}
            isLast
          />
        </View>

        {/* ── Points ───────────────────────────────────────── */}
        <SectionLabel label="Points" />
        <View style={styles.card}>
          <RowLink
            icon="add-circle-outline"
            label="Log Activity Manually"
            onPress={() => router.push('/manual-log')}
          />
          <RowLink
            icon="receipt-outline"
            label="Points History"
            onPress={() => router.push('/points-ledger')}
            isLast
          />
        </View>

        {/* ── Activity Focus ─────────────────────────────────── */}
        <SectionLabel label="Activity Focus" />
        <View style={styles.card}>
          <RowLink
            icon="fitness-outline"
            label="Activity Focus"
            value={activityFocusValue}
            onPress={() => router.push('/activity-preferences')}
            isLast
          />
        </View>

        {/* ── Health data sources ───────────────────────────── */}
        <SectionLabel label="On your phone" />
        <Text style={styles.sectionHint}>Steps and workouts your phone tracks. Garmin and Samsung devices sync automatically.</Text>
        <HealthSourceCard
          rows={providers.rows.filter(r => r.meta.native)}
          providers={providers}
        />

        <SectionLabel label="Wearables" />
        <Text style={styles.sectionHint}>Richer data — sleep, heart rate, verified workouts.</Text>
        <View style={styles.card}>
          {(() => {
            const active = providers.rows.find(r => !r.meta.native && !!r.connection);
            return (
              <RowLink
                icon="watch-outline"
                label="Connected Device"
                value={active ? active.meta.name : 'None connected'}
                valueColor={active ? '#4ade80' : undefined}
                onPress={() => router.push('/wearables')}
                isLast
              />
            );
          })()}
        </View>
        {false && (
        <View style={styles.card}>
          {providers.rows.map((row, idx) => {
            const isLast = idx === providers.rows.length - 1;
            const connected = !!row.connection;
            const busy = providers.busyId === row.meta.id;
            const value = busy
              ? '…'
              : row.isActive
                ? 'Active'
                : connected
                  ? 'Connected'
                  : 'Not connected';
            const valueColor = row.isActive ? GOLD : connected ? '#4ade80' : undefined;
            return (
              <RowLink
                key={row.meta.id}
                icon="fitness-outline"
                label={row.meta.name}
                value={value}
                valueColor={valueColor}
                isLast={isLast}
                onPress={() => {
                  if (busy) return;
                  if (!connected) {
                    // Try to connect.
                    (async () => {
                      try {
                        const result = await providers.connect(row.meta.id);
                        if (result === 'failed' && row.meta.native) {
                          Alert.alert(
                            `${row.meta.name} not connected`,
                            'Permission was not granted. You can enable it in Health Connect settings.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Open Health Connect',
                                onPress: () => Platform.OS === 'android'
                                  ? androidOpenHealthConnectSettings()
                                  : Linking.openSettings(),
                              },
                            ],
                          );
                        }
                      } catch (e) {
                        if (e instanceof HealthProviderNotImplementedError) {
                          Alert.alert(`${row.meta.name} coming soon`, 'This integration is not available yet.');
                        } else {
                          Alert.alert('Connection failed', String((e as Error).message ?? e));
                        }
                      }
                    })();
                    return;
                  }
                  // Already connected — show actions.
                  const actions: { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }[] = [];
                  if (!row.isActive) {
                    actions.push({
                      text: 'Set as active source',
                      onPress: () => { providers.setActive(row.meta.id); },
                    });
                  }
                  actions.push({
                    text: 'Disconnect',
                    style: 'destructive',
                    onPress: () => {
                      Alert.alert(
                        `Disconnect ${row.meta.name}?`,
                        row.meta.native
                          ? 'POWR will stop reading from this source. To fully revoke access, also turn off permission in your phone settings.'
                          : 'POWR will stop reading from this source and clear stored credentials.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Disconnect', style: 'destructive', onPress: () => { providers.disconnect(row.meta.id); } },
                        ],
                      );
                    },
                  });
                  actions.push({ text: 'Cancel', style: 'cancel' });
                  Alert.alert(row.meta.name, row.isActive ? 'This is your active source.' : undefined, actions);
                }}
              />
            );
          })}
        </View>
        )}

        {/* ── Other connections ─────────────────────────────── */}
        <SectionLabel label="Connections" />
        <View style={styles.card}>
          {/* Location services for gym check-in */}
          <RowLink
            icon="location-outline"
            label="Location Services"
            value={
              locationStatus === 'granted' && preciseGranted === false
                ? 'Approximate'
                : locationStatus === 'granted' && bgLocationGranted === false
                  ? 'Limited'
                  : locationStatus === 'granted'
                    ? 'Enabled'
                    : locationStatus === 'denied'
                      ? 'Denied'
                      : 'Not set up'
            }
            valueColor={
              locationStatus === 'granted' && (bgLocationGranted === false || preciseGranted === false)
                ? RED
                : locationStatus === 'granted'
                  ? '#4ade80'
                  : locationStatus === 'denied'
                    ? RED
                    : undefined
            }
            onPress={async () => {
              if (locationStatus === 'granted' && preciseGranted === false) {
                Alert.alert(
                  'Turn on Precise location',
                  'POWR verifies you\'re really at the gym — approximate location can\'t do that, so sessions won\'t count. In settings, turn on "Use precise location" for POWR.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Open Settings', onPress: () => Linking.openSettings() },
                  ],
                );
              } else if (locationStatus === 'granted' && bgLocationGranted === false) {
                Alert.alert(
                  Platform.OS === 'ios' ? 'Enable "Always" Location' : 'Enable "Allow all the time"',
                  Platform.OS === 'ios'
                    ? 'POWR can\'t detect gym arrivals when the app is closed unless location is set to "Always". Go to Settings › Privacy & Security › Location Services › POWR, then select "Always".'
                    : 'POWR can\'t detect gym arrivals when the app is closed unless location is set to "Allow all the time".',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Open Settings', onPress: () => Linking.openSettings() },
                  ],
                );
              } else if (locationStatus === 'granted') {
                Alert.alert(
                  'Disable Location?',
                  'Without location access you won\'t be able to earn points at geofenced venues and partner gyms.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Open Settings', onPress: () => Linking.openSettings() },
                  ],
                );
              } else if (locationStatus === 'denied') {
                Linking.openSettings();
              } else {
                const { status } = await Location.requestForegroundPermissionsAsync();
                setLocationStatus(status === 'granted' ? 'granted' : 'denied');
              }
            }}
            isLast={Platform.OS !== 'android'}
          />
          {Platform.OS === 'android' && (
            <RowLink
              icon="battery-charging-outline"
              label="Background activity"
              sublabel="Detect gym arrivals while POWR is closed"
              onPress={() => {
                Alert.alert(
                  'Background activity',
                  "To detect gym arrivals while POWR is closed, allow it to run without battery restrictions. You'll be taken to the system battery settings.",
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Open Settings', onPress: () => { requestBatteryOptimizationExemption(); } },
                  ],
                );
              }}
              isLast
            />
          )}
        </View>
        {!providers.activeId && (
          <Text style={styles.sectionHint}>
            Connect a health source to verify workouts and earn points from walking &amp; sleep.
          </Text>
        )}
        {locationStatus !== 'granted' && (
          <Text style={styles.sectionHint}>
            Location is required to earn points at geofenced venues and partner gyms.
          </Text>
        )}

        {/* ── Notifications ─────────────────────────────────── */}
        <SectionLabel label="Notifications" />
        {notifGranted === false && (
          <Pressable onPress={handleEnableNotifications} style={styles.notifWarnBanner}>
            <Ionicons name="notifications-off-outline" size={18} color={RED} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.notifWarnText}>
                Notifications are off, so gym check-ins and reward alerts won’t reach you. The
                switches below have no effect until you turn them on.
              </Text>
              <Text style={styles.notifWarnCta}>
                {notifStatus === 'undetermined' ? 'Turn on notifications' : 'Open Settings'} ›
              </Text>
            </View>
          </Pressable>
        )}
        <View style={[styles.card, notifGranted === false && styles.cardDisabled]} pointerEvents={notifGranted === false ? 'none' : 'auto'}>
          <RowToggle
            icon="barbell-outline"
            label="Workout reminders"
            value={notifWorkouts}
            onValueChange={(v) => {
              setNotifWorkouts(v);
              if (user?.id) updateNotificationPreferences(user.id, { check_in_reminder: v });
            }}
          />
          <RowToggle
            icon="gift-outline"
            label="Reward alerts"
            value={notifRewards}
            onValueChange={(v) => {
              setNotifRewards(v);
              if (user?.id) updateNotificationPreferences(user.id, { reward_unlocked: v, points_milestone: v });
            }}
          />
          <RowToggle
            icon="watch-outline"
            label="Workout sync"
            sublabel="When a wearable workout lands and earns POWR"
            value={notifWearable}
            onValueChange={(v) => {
              setNotifWearable(v);
              if (user?.id) updateNotificationPreferences(user.id, { wearable_session: v });
            }}
          />
          <RowToggle
            icon="flame-outline"
            label="Streak alerts"
            sublabel="Evening warning when your streak's at risk, and rescue offers"
            value={notifStreak}
            onValueChange={(v) => {
              setNotifStreak(v);
              if (user?.id) updateNotificationPreferences(user.id, { streak_at_risk: v, streak_rescue: v });
            }}
          />
          <RowToggle
            icon="trophy-outline"
            label="Level ups"
            value={notifLevelUp}
            onValueChange={(v) => {
              setNotifLevelUp(v);
              if (user?.id) updateNotificationPreferences(user.id, { level_up: v });
            }}
          />
          <RowToggle
            icon="walk-outline"
            label="Daily nudges"
            sublabel="Step-goal reminders and the odd get-moving prompt — never more than one a day"
            value={notifDailyNudge}
            onValueChange={(v) => {
              setNotifDailyNudge(v);
              if (user?.id) updateNotificationPreferences(user.id, {
                daily_reminder: v, step_goal_nudge: v, inactivity_nudge: v,
              });
            }}
          />
          <RowToggle
            icon="location-outline"
            label="Nearby rewards"
            sublabel="A nudge when a reward is boosted where you are"
            value={notifNearby}
            onValueChange={(v) => {
              setNotifNearby(v);
              cacheNearbyOfferPreference(v);
              if (user?.id) updateNotificationPreferences(user.id, { nearby_offer: v });
            }}
          />
          <RowToggle
            icon="people-outline"
            label="Friend activity"
            sublabel="Friend requests and shared-challenge updates"
            value={notifFriends}
            onValueChange={(v) => {
              setNotifFriends(v);
              if (user?.id) updateNotificationPreferences(user.id, {
                friend_request: v, friend_accepted: v, challenge_invite: v, challenge_accepted: v,
                challenge_started: v, challenge_friend_finished: v, challenge_pool_milestone: v,
                challenge_completed: v, challenge_expiring: v, challenge_ended: v,
              });
            }}
          />
          <RowToggle
            icon="megaphone-outline"
            label="Product news"
            sublabel="Occasional announcements about new features and rewards"
            value={notifNews}
            onValueChange={(v) => {
              setNotifNews(v);
              if (user?.id) updateNotificationPreferences(user.id, { announcements: v });
            }}
            isLast
          />
        </View>

        {/* ── Email ─────────────────────────────────────────── */}
        <SectionLabel label="Email" />
        <View style={styles.card}>
          <RowToggle
            icon="mail-outline"
            label="Weekly summary"
            sublabel="Your week's points, workouts and rank, every Monday"
            value={emailWeekly}
            onValueChange={(v) => {
              setEmailWeekly(v);
              if (user?.id) updateNotificationPreferences(user.id, { email_weekly_summary: v });
            }}
            isLast
          />
        </View>

        {/* ── Social ────────────────────────────────────────── */}
        <SectionLabel label="Social" />
        <View style={styles.card}>
          <RowToggle
            icon="people-outline"
            label="Together challenges"
            sublabel="Take on challenges with friends from your home screen"
            value={togetherEnabled}
            onValueChange={(v) => { setTogetherEnabled(v); persistMeta('together_enabled', v); }}
            isLast
          />
        </View>

        {/* ── Privacy ───────────────────────────────────────── */}
        <SectionLabel label="Privacy" />
        <View style={styles.card}>
          <RowToggle
            icon="eye-outline"
            label="Share activity"
            sublabel="Friends can see your workouts"
            value={shareActivity}
            onValueChange={(v) => { setShareActivity(v); persistMeta('share_activity', v); }}
            isLast
          />
        </View>

        {/* ── Admin ─────────────────────────────────────────── */}
        {isAdmin && (
          <>
            <SectionLabel label="Admin" />
            <View style={styles.card}>
              <RowLink
                icon="storefront-outline"
                label="Manage Partners"
                onPress={() => router.push('/admin-partners')}
              />
              <RowLink
                icon="person-add-outline"
                label="Athlete Applications"
                onPress={() => router.push('/admin-athletes')}
              />
              <RowLink
                icon="flag-outline"
                label="Manage Challenges"
                onPress={() => router.push('/admin-challenges')}
                isLast
              />
            </View>
          </>
        )}

        {/* ── Support ───────────────────────────────────────── */}
        <SectionLabel label="Support" />
        <View style={styles.card}>
          <RowLink
            icon="options-outline"
            label="Permissions & Setup"
            sublabel="Fix location, notifications & health access"
            onPress={() => router.push('/permissions-help')}
          />
          <RowLink
            icon="arrow-up-circle-outline"
            label="Check for updates"
            sublabel={`You're on v${runningVersion() ?? '?'}`}
            onPress={() => openStorePage()}
          />
          <RowLink
            icon="help-circle-outline"
            label="Help Centre"
            onPress={() => router.push('/help-centre')}
          />
          <RowLink
            icon="document-text-outline"
            label="Terms of Service"
            onPress={() => router.push('/terms-of-service')}
          />
          <RowLink
            icon="shield-outline"
            label="Privacy Policy"
            onPress={() => router.push('/privacy-policy')}
            isLast
          />
        </View>

        {/* ── App info ──────────────────────────────────────── */}
        <View style={styles.appInfo}>
          <Text style={styles.appVersion}>{appVersionLabel}</Text>
        </View>

        {/* ── Danger zone ───────────────────────────────────── */}
        <View style={styles.card}>
          <Pressable
            style={({ pressed }) => [styles.dangerRow, pressed && { opacity: 0.7 }]}
            onPress={signOut}
          >
            <Ionicons name="log-out-outline" size={18} color={RED} />
            <Text style={styles.dangerLabel}>Sign out</Text>
          </Pressable>
          <View style={styles.rowDivider} />
          <Pressable
            style={({ pressed }) => [styles.dangerRow, pressed && { opacity: 0.7 }]}
            onPress={handleDeleteAccount}
          >
            <Ionicons name="trash-outline" size={18} color={RED} />
            <Text style={[styles.dangerLabel, styles.dangerLabelDim]}>
              Delete account
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>
  );
}

const _BASE = 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/partner-logos';
const BRAND_LOGOS: Partial<Record<HealthProviderId, string>> = {
  'apple-health':   `${_BASE}/apple.png`,
  'fitbit':         `${_BASE}/fitbit.png`,
  'garmin':         `${_BASE}/garmin.png`,
  'whoop':          `${_BASE}/whoop.png`,
  'polar':          `${_BASE}/polar-logo.svg`,
  'oura':           `${_BASE}/oura_logo.png`,
  'huawei':         `${_BASE}/huawei-Logo.png`,
  'strava':         `${_BASE}/strava-logo.png`,
  'withings':       `${_BASE}/withings-logo.png`,
  'peloton':        `${_BASE}/pelaton-logo.png`,
  'zepp':           `${_BASE}/zepp-logo.png`,
  'technogym':      `${_BASE}/technogym-logo.png`,
  'coros':          `${_BASE}/coros-logo.png`,
  'suunto':         `${_BASE}/suunto-logo.png`,
  'wahoo':          `${_BASE}/wahoo-logo.jpeg`,
  'zwift':          `${_BASE}/zwift-logo.png`,
  'concept2':       `${_BASE}/concept-two.png`,
  'ifit':           `${_BASE}/ifit-logo.png`,
  'underarmour':    `${_BASE}/under-armour-logo.png`,
  'samsung-health': `${_BASE}/samsung-health-logo.png`,
};

const providerLogoStyles = StyleSheet.create({
  wrap:    { backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  blue:    { backgroundColor: '#4285F4' },
  samsung: { backgroundColor: '#1428A0' },
  oura:    { backgroundColor: '#0b0b0b' },
  huawei:  { backgroundColor: '#CF0A2C' },
  withings:  { backgroundColor: '#00B0A0' },
  peloton:   { backgroundColor: '#E0002D' },
  zepp:      { backgroundColor: '#FF6D00' },
  technogym: { backgroundColor: '#E2001A' },
  coros:     { backgroundColor: '#232323' },
  suunto:    { backgroundColor: '#1B1B1B' },
  wahoo:     { backgroundColor: '#0096D6' },
  zwift:     { backgroundColor: '#FC6719' },
  concept2:  { backgroundColor: '#002D62' },
  ifit:      { backgroundColor: '#00B14F' },
  underarmour: { backgroundColor: '#1D1D1D' },
  strava:    { backgroundColor: '#FC4C02' },
  neutral: { backgroundColor: '#2b2b2b' },
});

function ProviderLogo({ id, size = 22 }: { id: HealthProviderId; size?: number }) {
  const logoUrl = BRAND_LOGOS[id];
  if (logoUrl) {
    return (
      <View style={[providerLogoStyles.wrap, { width: size, height: size, borderRadius: size * 0.25 }]}>
        <Image source={{ uri: logoUrl }} style={{ width: size * 0.75, height: size * 0.75 }} contentFit="contain" />
      </View>
    );
  }
  switch (id) {
    case 'health-connect':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.blue, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="heart-pulse" size={size * 0.65} color="#fff" />
        </View>
      );
    case 'samsung-health':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.samsung, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="heart" size={size * 0.65} color="#fff" />
        </View>
      );
    case 'oura':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.oura, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="ring" size={size * 0.6} color="#fff" />
        </View>
      );
    case 'huawei':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.huawei, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="watch-variant" size={size * 0.62} color="#fff" />
        </View>
      );
    case 'withings':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.withings, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="scale-bathroom" size={size * 0.62} color="#fff" />
        </View>
      );
    case 'peloton':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.peloton, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="bike" size={size * 0.65} color="#fff" />
        </View>
      );
    case 'zepp':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.zepp, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="watch-variant" size={size * 0.62} color="#fff" />
        </View>
      );
    case 'technogym':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.technogym, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="dumbbell" size={size * 0.6} color="#fff" />
        </View>
      );
    case 'coros':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.coros, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="run" size={size * 0.62} color="#fff" />
        </View>
      );
    case 'suunto':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.suunto, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="watch-variant" size={size * 0.62} color="#fff" />
        </View>
      );
    case 'wahoo':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.wahoo, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="bike" size={size * 0.65} color="#fff" />
        </View>
      );
    case 'zwift':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.zwift, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="bike" size={size * 0.65} color="#fff" />
        </View>
      );
    case 'concept2':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.concept2, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="rowing" size={size * 0.62} color="#fff" />
        </View>
      );
    case 'ifit':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.ifit, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="run" size={size * 0.62} color="#fff" />
        </View>
      );
    case 'underarmour':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.underarmour, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="run" size={size * 0.62} color="#fff" />
        </View>
      );
    case 'strava':
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.strava, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="run" size={size * 0.62} color="#fff" />
        </View>
      );
    default:
      return (
        <View style={[providerLogoStyles.wrap, providerLogoStyles.neutral, { width: size, height: size, borderRadius: size * 0.25 }]}>
          <MaterialCommunityIcons name="heart-pulse" size={size * 0.62} color="#fff" />
        </View>
      );
  }
}

interface RowLinkProps {
  icon?: string;
  logoElement?: React.ReactNode;
  label: string;
  sublabel?: string;
  value?: string;
  valueColor?: string;
  onPress: () => void;
  isLast?: boolean;
}

function RowLink({ icon, logoElement, label, sublabel, value, valueColor, onPress, isLast }: RowLinkProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        !isLast && styles.rowBorder,
        pressed && { opacity: 0.7 },
      ]}
      onPress={onPress}
    >
      {logoElement ?? (icon ? <Ionicons name={icon as any} size={18} color={DIM} style={styles.rowIcon} /> : null)}
      <View style={styles.rowTextBlock}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sublabel ? <Text style={styles.rowSublabel}>{sublabel}</Text> : null}
      </View>
      {value ? (
        <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>
          {value}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={14} color={MUTED} />
    </Pressable>
  );
}

interface RowToggleProps {
  icon: string;
  label: string;
  sublabel?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  isLast?: boolean;
}

function HealthSourceCard({
  rows,
  providers,
}: {
  rows: ReturnType<typeof useHealthProviders>['rows'];
  providers: ReturnType<typeof useHealthProviders>;
}) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.card}>
      {rows.map((row, idx) => {
        const isLast = idx === rows.length - 1;
        const connected = !!row.connection;
        const busy = providers.busyId === row.meta.id;
        const value = busy
          ? '…'
          : row.isActive
            ? 'Primary'
            : connected
              ? 'Connected'
              : 'Not connected';
        const valueColor = row.isActive ? GOLD : connected ? '#4ade80' : undefined;
        return (
          <RowLink
            key={row.meta.id}
            logoElement={<ProviderLogo id={row.meta.id} size={22} />}
            label={row.meta.name}
            sublabel={row.meta.id === 'health-connect' ? 'Pixel Watch, Galaxy Watch & more' : undefined}
            value={value}
            valueColor={valueColor}
            isLast={isLast}
            onPress={() => {
              if (busy) return;
              if (!connected) {
                (async () => {
                  try {
                    // Tell OAuth callbacks to return here instead of onboarding
                    await SecureStore.setItemAsync('oauth.returnTo', 'settings');
                    const result = await providers.connect(row.meta.id);
                    if (result === 'failed' && row.meta.native) {
                      Alert.alert(
                        `${row.meta.name} not connected`,
                        'Permission was not granted. You can enable it in Health Connect settings.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Open Health Connect',
                            onPress: () => Platform.OS === 'android'
                              ? androidOpenHealthConnectSettings()
                              : Linking.openSettings(),
                          },
                        ],
                      );
                    } else if (result === 'failed') {
                      Alert.alert(
                        `${row.meta.name} not connected`,
                        'We could not start the connection. Please try again.',
                      );
                    }
                    // 'pending' → OAuth handoff; the /<provider>-callback route
                    // writes the profile. Focus-refresh picks it up on return.
                  } catch (e) {
                    if (e instanceof HealthProviderNotImplementedError) {
                      Alert.alert(`${row.meta.name} coming soon`, 'This integration is not available yet.');
                    } else {
                      Alert.alert('Connection failed', String((e as Error).message ?? e));
                    }
                  }
                })();
                return;
              }
              const actions: { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }[] = [];
              if (!row.isActive) {
                actions.push({
                  text: 'Set as primary source',
                  onPress: () => { providers.setActive(row.meta.id); },
                });
              }
              actions.push({
                text: 'Disconnect',
                style: 'destructive',
                onPress: () => {
                  Alert.alert(
                    `Disconnect ${row.meta.name}?`,
                    row.meta.native
                      ? 'POWR will stop reading from this source. To fully revoke access, also turn off permission in your phone settings.'
                      : 'POWR will stop reading from this source and clear stored credentials.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Disconnect', style: 'destructive', onPress: () => { providers.disconnect(row.meta.id); } },
                    ],
                  );
                },
              });
              actions.push({ text: 'Cancel', style: 'cancel' });
              Alert.alert(row.meta.name, row.isActive ? 'This is your primary source.' : undefined, actions);
            }}
          />
        );
      })}
    </View>
  );
}

function RowToggle({ icon, label, sublabel, value, onValueChange, isLast }: RowToggleProps) {
  return (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      <Ionicons name={icon as any} size={18} color={DIM} style={styles.rowIcon} />
      <View style={styles.rowTextBlock}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sublabel ? (
          <Text style={styles.rowSublabel}>{sublabel}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: 'rgba(255,255,255,0.10)', true: 'rgba(232,210,0,0.4)' }}
        thumbColor={value ? GOLD : 'rgba(255,255,255,0.5)'}
        ios_backgroundColor="rgba(255,255,255,0.10)"
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '400',
    letterSpacing: 0.5,
    color: TEXT,
  },
  headerSpacer: {
    width: 36,
  },

  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 12,
    gap: 6,
    paddingTop: 8,
  },

  sectionLabel: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 2,
    color: MUTED,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    paddingTop: 10,
    paddingBottom: 4,
  },

  sectionHint: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
    paddingHorizontal: 4,
    marginBottom: 4,
    marginTop: -2,
  },
  activityBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  wearableTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  wearableTagText: {
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: MUTED,
  },
  lockedPill: {
    backgroundColor: 'rgba(232,210,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.2)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  lockedPillText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: GOLD,
  },

  // Card
  card: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  // When the OS notification gate is shut, the toggles are inert — dim the whole
  // card so it reads as disabled rather than a live control that does nothing.
  cardDisabled: {
    opacity: 0.4,
  },

  // Notifications-off warning banner (tappable)
  notifWarnBanner: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  notifWarnText: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
    color: RED,
  },
  notifWarnCta: {
    fontSize: 12,
    fontWeight: '700',
    color: RED,
    marginTop: 6,
  },

  // Row shared
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  rowIcon: {
    flexShrink: 0,
  },
  rowTextBlock: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '300',
    color: TEXT,
  },
  rowSublabel: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
  },
  rowValue: {
    fontSize: 12,
    fontWeight: '300',
    color: DIM,
    marginRight: 4,
  },

  // App info
  appInfo: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  appVersion: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
    letterSpacing: 0.5,
  },

  // Danger
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  dangerLabel: {
    fontSize: 14,
    fontWeight: '300',
    color: RED,
  },
  dangerLabelDim: {
    opacity: 0.6,
  },
});

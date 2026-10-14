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
import { Trans, useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as SecureStore from 'expo-secure-store';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import PermissionFixScreen, { type PermissionFixKind } from '@/components/PermissionFixScreen';
import { useAuth } from '@/context/AuthContext';
import { useGymRelevance } from '@/hooks/useGymRelevance';
import { useOpenChallengeBoard } from '@/hooks/useOpenChallengeBoard';
import { androidOpenHealthConnectSettings, useHealthData } from '@/hooks/useHealthData';
import { useHealthProviders } from '@/hooks/useHealthProviders';
import { HealthProviderNotImplementedError } from '@/lib/health/providers';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { selectionLabel } from '@/constants/activityCatalog';
import { getSessionUser, supabase } from '@/lib/supabase';
import { getNotificationPreferences, updateNotificationPreferences } from '@/lib/api/notifications';
import { cacheNearbyOfferPreference, isNearbyOfferEnabled } from '@/lib/notifications';
import { openStorePage, runningVersion } from '@/lib/appUpdate';
import { getAppVersion } from '@/lib/device';
import { setTranslationPreview, useLanguageSettings } from '@/lib/i18n';
import { useDistancePreference } from '@/lib/units';
import { LANGUAGE_NAMES } from '@/shared/i18n';
import { formatMemberId } from '@/shared/memberId';
import { getGymSharing, setGymSharing, setGymVisitSharing, type GymSharing } from '@/lib/api/gymSharing';
import { fetchProfile, updateLeaderboardVisibility } from '@/lib/api/user';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';
const RED     = '#ef4444';
const AMBER   = '#fbbf24';
const GREEN   = '#4ade80';

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
  const gymRelevant = useGymRelevance();
  const { t } = useTranslation();
  const languages = useLanguageSettings();
  const distancePreference = useDistancePreference();

  const toggleTranslationPreview = useCallback(() => {
    const on = !languages.preview;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setTranslationPreview(on);
    Alert.alert(
      t(on ? 'settings:language.previewOn.title' : 'settings:language.previewOff.title'),
      t(on ? 'settings:language.previewOn.body' : 'settings:language.previewOff.body'),
      [{ text: t('common:actions.ok') }],
    );
  }, [languages.preview, t]);

  const [isAdmin, setIsAdmin] = React.useState(false);
  // Granted a creator profile (admin links their app account in creator_users).
  // RLS lets a member read only their own link row, so a hit means "you".
  const [isCreator, setIsCreator] = React.useState(false);
  // The member's POWR ID (= profiles.referral_code, see shared/memberId). It is
  // the one string they can read to staff at an event or to support and be
  // found by — the admin user search, event roster and Live Ops all match it.
  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberIdCopied, setMemberIdCopied] = useState(false);
  // Late invite-code entry. The row only exists for someone who could still
  // use it — never referred and inside the grace window — or as a static
  // "Invited by" receipt once they have been. process_referral enforces the
  // window; this is presentation. Re-read on focus so applying a code on the
  // invite screen flips the row on the way back.
  const [referralState, setReferralState] = useState<
    { referred: boolean; eligible: boolean; days_left?: number; referrer_name?: string } | null
  >(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const { data } = await supabase.rpc('referral_entry_state');
          if (alive && data) setReferralState(data as any);
        } catch { /* leave the row hidden */ }
      })();
      return () => { alive = false; };
    }, []),
  );
  // Which permission the priming screen is currently coaching, if any. Every
  // permission row opens it instead of an OS alert — same layout, scenes and
  // copy as onboarding, so the user is shown the screen they're about to land on.
  const [permissionFix, setPermissionFix] = useState<PermissionFixKind | null>(null);
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
        .select('is_admin, referral_code')
        .eq('id', user.id)
        .single();
      if (data?.is_admin) setIsAdmin(true);
      if (data?.referral_code) setMemberId(data.referral_code);
      const { data: creatorLink } = await supabase
        .from('creator_users')
        .select('creator_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (creatorLink?.creator_id) setIsCreator(true);
    })();
  }, []);

  // The in-app affiliate home (code, share, numbers, next reward); it hands
  // off to the web portal already signed in for the desk work.
  const openAffiliate = useCallback(() => { router.push('/affiliate'); }, [router]);

  // Copies the STORED form (no gap) — that's what the signup invite field,
  // the friend-code scanner and every admin lookup accept.
  const copyMemberId = useCallback(async () => {
    if (!memberId) return;
    await Clipboard.setStringAsync(memberId);
    Haptics.selectionAsync();
    setMemberIdCopied(true);
    setTimeout(() => setMemberIdCopied(false), 2000);
  }, [memberId]);

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

  // Closing the priming screen re-reads the statuses, so a grant made from it (or
  // from the settings trip it kicked off) lands on the rows immediately.
  const closePermissionFix = useCallback(() => {
    setPermissionFix(null);
    refreshPermissionStatuses();
  }, [refreshPermissionStatuses]);

  // Activity preferences (saved in user_metadata, edited on dedicated screen).
  // Prefer the concrete catalog picks ("Padel, Boxing"); legacy bucket-only
  // users fall back to bucket short labels. Stored labels are English, so
  // each pick is named through the catalog in the language on screen.
  const savedPrefs: ActivityType[] = user?.user_metadata?.activity_preferences ?? ['gym', 'running', 'walking'];
  const savedSelections = user?.user_metadata?.activity_selections;
  const selectionLabels = Array.isArray(savedSelections)
    ? savedSelections
        .filter((s: any) => typeof s?.label === 'string' && s.label.length > 0)
        .map((s: any) => selectionLabel(s))
    : [];
  const activityFocusValue = selectionLabels.length > 0
    ? selectionLabels.join(', ')
    : savedPrefs.map(type => ACTIVITIES[type]?.labelShort ?? type).join(', ');

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
  // "Share with <gym>": the member's opt-in for their gym's portal to see
  // their activity by name. Off unless switched on; only offered when their
  // gym has a portal. Re-read on focus: picking a new gym elsewhere resets it.
  const [gymSharing, setGymSharingState] = useState<GymSharing | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getGymSharing().then((s) => { if (alive) setGymSharingState(s); });
      return () => { alive = false; };
    }, []),
  );
  const toggleGymSharing = async (on: boolean) => {
    const before = gymSharing;
    setGymSharingState((s) => (s ? { ...s, sharing: on } : s));
    try {
      setGymSharingState(await setGymSharing(on));
    } catch (e: any) {
      setGymSharingState(before);
      Alert.alert(t('settings:main.changeFailed.title'), e?.message ?? t('settings:main.changeFailed.body'));
    }
  };
  const showGymSharing = !!(gymSharing?.portal && gymSharing.gym_name);
  // "Let gyms see my visits": on unless switched off, for every gym the member
  // trains at, so it's offered whether or not they've picked a gym.
  const showVisitSharing = typeof gymSharing?.visits === 'boolean';
  const toggleVisitSharing = async (on: boolean) => {
    const before = gymSharing;
    setGymSharingState((s) => (s ? { ...s, visits: on } : s));
    try {
      setGymSharingState(await setGymVisitSharing(on));
    } catch (e: any) {
      setGymSharingState(before);
      Alert.alert(t('settings:main.changeFailed.title'), e?.message ?? t('settings:main.changeFailed.body'));
    }
  };
  // "Show me on gym boards": profiles.show_on_leaderboard. Every gym board
  // and screen, the Gym League and a gym portal's top ten join on it, so off
  // means no gym shows this member by name. Read on focus; null until known.
  const [showOnBoards, setShowOnBoards] = useState<boolean | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      fetchProfile().then((p) => { if (alive && p) setShowOnBoards(p.show_on_leaderboard !== false); });
      return () => { alive = false; };
    }, []),
  );
  const toggleShowOnBoards = async (on: boolean) => {
    const before = showOnBoards;
    setShowOnBoards(on);
    const { error } = await updateLeaderboardVisibility(on);
    if (error) {
      setShowOnBoards(before);
      Alert.alert(t('settings:main.changeFailed.title'), error);
    }
  };
  const [togetherEnabled, setTogetherEnabled] = useState(meta.together_enabled ?? true);
  // Open-board opt-in lives on profiles (the board RPC filters on it), not in
  // user_metadata — a SQL-side filter can't read auth metadata.
  const { optedIn: openToStrangers, setOptedIn: setOpenToStrangers } = useOpenChallengeBoard();
  // Board pushes are a separate consent from the board itself: "show me the
  // board" and "buzz my phone when a stranger posts" are different asks.
  const [notifBoardPosts, setNotifBoardPosts] = useState(meta.notif_board_posts ?? true);
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
      t('settings:main.deleteAlert.title'),
      t('settings:main.deleteAlert.body'),
      [
        { text: t('common:actions.cancel'), style: 'cancel' },
        {
          text: t('settings:main.deleteAlert.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Call a Supabase edge function or RPC to delete user data
              const { error } = await supabase.rpc('delete_user_account');
              if (error) {
                // If no RPC exists yet, just sign out and inform the user
                Alert.alert(
                  t('settings:main.deleteAlert.supportTitle'),
                  t('settings:main.deleteAlert.supportBody'),
                );
                await signOut();
                return;
              }
              await signOut();
            } catch {
              Alert.alert(
                t('settings:main.deleteAlert.supportTitle'),
                t('settings:main.deleteAlert.supportBody'),
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
        <Text style={styles.headerTitle}>{t('settings:main.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Account ──────────────────────────────────────── */}
        <SectionLabel label={t('settings:main.section.account')} />
        <View style={styles.card}>
          <RowLink
            icon="person-outline"
            label={t('settings:main.account.editProfile')}
            onPress={() => router.push('/edit-profile')}
          />
          <RowLink
            icon="mail-outline"
            label={t('settings:main.account.email')}
            value={user?.email}
            onPress={() => router.push('/change-email')}
          />
          <RowLink
            icon="lock-closed-outline"
            label={t('settings:main.account.changePassword')}
            onPress={() => router.push('/change-password')}
            isLast={!memberId}
          />
          {memberId ? (
            <RowLink
              icon="id-card-outline"
              label="POWR ID"
              sublabel={t('settings:main.account.powrIdHint')}
              value={memberIdCopied ? t('settings:main.account.copied') : formatMemberId(memberId)}
              valueColor={memberIdCopied ? GREEN : undefined}
              trailingIcon={memberIdCopied ? 'checkmark' : 'copy-outline'}
              onPress={copyMemberId}
              isLast={!referralState?.referred && !referralState?.eligible}
            />
          ) : null}
          {referralState?.referred ? (
            <RowLink
              icon="gift-outline"
              label={t('settings:main.account.invitedBy')}
              sublabel={t('settings:main.account.invitedByHint')}
              value={referralState.referrer_name}
              trailingIcon="checkmark"
              onPress={() => router.push('/invite-code')}
              isLast
            />
          ) : referralState?.eligible ? (
            <RowLink
              icon="gift-outline"
              label={t('settings:main.account.haveInviteCode')}
              sublabel={
                referralState.days_left && referralState.days_left > 1
                  ? t('settings:main.account.inviteDaysLeft', { days: referralState.days_left })
                  : t('settings:main.account.inviteLastDay')
              }
              onPress={() => router.push('/invite-code')}
              isLast
            />
          ) : null}
        </View>

        {/* ── Language ─────────────────────────────────────── */}
        {/* Only once there's a choice to make: while English is the only
            finished language, the row appears just for translators. */}
        {languages.available.length > 1 && (
          <>
            <SectionLabel label={t('settings:language.section')} />
            <View style={styles.card}>
              <RowLink
                icon="language-outline"
                label={t('settings:language.title')}
                value={LANGUAGE_NAMES[languages.language] ?? languages.language}
                onPress={() => router.push('/language')}
                isLast
              />
            </View>
          </>
        )}

        {/* ── Units ────────────────────────────────────────── */}
        <SectionLabel label={t('settings:units.section')} />
        <View style={styles.card}>
          <RowLink
            icon="speedometer-outline"
            label={t('settings:units.title')}
            value={
              distancePreference === 'mi'
                ? t('settings:units.miles')
                : distancePreference === 'km'
                  ? t('settings:units.kilometres')
                  : t('settings:units.auto')
            }
            onPress={() => router.push('/distance-units')}
            isLast
          />
        </View>

        {/* ── Creator ──────────────────────────────────────── */}
        {isCreator && (
          <>
            <SectionLabel label={t('settings:main.section.affiliate')} />
            <View style={styles.card}>
              <RowLink
                icon="sparkles-outline"
                label={t('settings:main.affiliate.row')}
                sublabel={t('settings:main.affiliate.hint')}
                onPress={openAffiliate}
                isLast
              />
            </View>
          </>
        )}

        {/* ── Points ───────────────────────────────────────── */}
        <SectionLabel label={t('settings:main.section.points')} />
        <View style={styles.card}>
          <RowLink
            icon="add-circle-outline"
            label={t('settings:main.points.logManually')}
            onPress={() => router.push('/manual-log')}
          />
          <RowLink
            icon="receipt-outline"
            label={t('settings:main.points.history')}
            onPress={() => router.push('/points-ledger')}
            isLast
          />
        </View>

        {/* ── Activity Focus ─────────────────────────────────── */}
        <SectionLabel label={t('settings:main.section.activityFocus')} />
        <View style={styles.card}>
          <RowLink
            icon="fitness-outline"
            label={t('settings:main.activityFocus')}
            value={activityFocusValue}
            onPress={() => router.push('/activity-preferences')}
            isLast
          />
        </View>

        {/* ── Health data sources ───────────────────────────── */}
        <SectionLabel label={t('settings:main.section.onYourPhone')} />
        <Text style={styles.sectionHint}>{t('settings:main.health.phoneHint')}</Text>
        <HealthSourceCard
          rows={providers.rows.filter(r => r.meta.native)}
          providers={providers}
        />

        <SectionLabel label={t('settings:main.section.wearables')} />
        <Text style={styles.sectionHint}>{t('settings:main.health.wearablesHint')}</Text>
        <View style={styles.card}>
          {(() => {
            const active = providers.rows.find(r => !r.meta.native && !!r.connection);
            return (
              <RowLink
                icon="watch-outline"
                label={t('settings:main.health.connectedDevice')}
                value={active ? active.meta.name : t('settings:main.health.noneConnected')}
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
        <SectionLabel label={t('settings:main.section.connections')} />
        <View style={styles.card}>
          {/* Location is TWO separate grants and the app needs both: the
              foreground one verifies you're at the gym, the background one is
              what lets that happen with POWR closed. They were one row, which
              hid a missing "Always" behind the word "Limited" — so each grant
              now gets its own row and its own status. */}
          <RowLink
            icon="location-outline"
            label={t('settings:main.connections.location')}
            sublabel={gymRelevant ? t('settings:main.connections.locationHintGyms') : t('settings:main.connections.locationHintVenues')}
            value={
              locationStatus !== 'granted'
                ? (locationStatus === 'denied' ? t('settings:main.connections.status.denied') : t('settings:main.connections.status.notSetUp'))
                : preciseGranted === false
                  ? t('settings:main.connections.status.approximate')
                  : t('settings:main.connections.status.enabled')
            }
            valueColor={
              locationStatus !== 'granted'
                ? (locationStatus === 'denied' ? RED : undefined)
                : preciseGranted === false
                  ? AMBER
                  : GREEN
            }
            onPress={() => {
              setPermissionFix(
                locationStatus !== 'granted'
                  ? 'location'
                  // Approximate accuracy silently voids every session, so it's
                  // the gap worth coaching before anything else.
                  : preciseGranted === false
                    ? 'location-precise'
                    : 'location-ok',
              );
            }}
          />
          <RowLink
            icon="navigate-outline"
            label={t('settings:main.connections.background')}
            sublabel={t('settings:main.connections.backgroundHint')}
            value={
              bgLocationGranted
                ? (Platform.OS === 'ios' ? t('settings:main.connections.status.always') : t('settings:main.connections.status.allTheTime'))
                : locationStatus === 'granted'
                  ? t('settings:main.connections.status.whileUsing')
                  : t('settings:main.connections.status.off')
            }
            valueColor={bgLocationGranted ? GREEN : locationStatus === 'granted' ? AMBER : RED}
            // The OS won't grant background before foreground, so an ungranted
            // foreground sends them there first rather than to a dead request.
            onPress={() => setPermissionFix(locationStatus === 'granted' ? 'location-background' : 'location')}
            isLast={Platform.OS !== 'android'}
          />
          {Platform.OS === 'android' && (
            <RowLink
              icon="battery-charging-outline"
              label={t('settings:main.connections.battery')}
              sublabel={t('settings:main.connections.batteryHint')}
              onPress={() => setPermissionFix('battery')}
              isLast
            />
          )}
        </View>
        {!providers.activeId && (
          <Text style={styles.sectionHint}>
            {t('settings:main.health.connectHint')}
          </Text>
        )}
        {locationStatus !== 'granted' ? (
          <Text style={styles.sectionHint}>
            {gymRelevant ? t('settings:main.connections.locationRequiredGyms') : t('settings:main.connections.locationRequiredVenues')}
          </Text>
        ) : bgLocationGranted === false ? (
          <Text style={styles.sectionHint}>
            {t('settings:main.connections.backgroundMissing')}
          </Text>
        ) : null}

        {/* ── Notifications ─────────────────────────────────── */}
        <SectionLabel label={t('settings:main.section.notifications')} />
        {notifGranted === false && (
          <Pressable onPress={() => setPermissionFix('notifications')} style={styles.notifWarnBanner}>
            <Ionicons name="notifications-off-outline" size={18} color={GOLD} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              {/* Only the headline and the action carry the accent — an all-red
                  block reads as one undifferentiated wall and hides the ask. */}
              <Text style={styles.notifWarnText}>
                <Trans
                  i18nKey="settings:main.notifications.offBanner"
                  components={{ strong: <Text style={styles.notifWarnStrong} /> }}
                />
              </Text>
              <Text style={styles.notifWarnCta}>
                {notifStatus === 'undetermined' ? t('settings:main.notifications.turnOn') : t('settings:main.notifications.showMeHow')} ›
              </Text>
            </View>
          </Pressable>
        )}
        <View style={[styles.card, notifGranted === false && styles.cardDisabled]} pointerEvents={notifGranted === false ? 'none' : 'auto'}>
          <RowToggle
            icon="barbell-outline"
            label={t('settings:main.notifications.gymCheckIn')}
            value={notifWorkouts}
            onValueChange={(v) => {
              setNotifWorkouts(v);
              if (user?.id) updateNotificationPreferences(user.id, { check_in_reminder: v });
            }}
          />
          <RowToggle
            icon="gift-outline"
            label={t('settings:main.notifications.rewards')}
            value={notifRewards}
            onValueChange={(v) => {
              setNotifRewards(v);
              if (user?.id) updateNotificationPreferences(user.id, { reward_unlocked: v, points_milestone: v });
            }}
          />
          <RowToggle
            icon="watch-outline"
            label={t('settings:main.notifications.workoutSync')}
            sublabel={t('settings:main.notifications.workoutSyncHint')}
            value={notifWearable}
            onValueChange={(v) => {
              setNotifWearable(v);
              if (user?.id) updateNotificationPreferences(user.id, { wearable_session: v });
            }}
          />
          <RowToggle
            icon="flame-outline"
            label={t('settings:main.notifications.streak')}
            sublabel={t('settings:main.notifications.streakHint')}
            value={notifStreak}
            onValueChange={(v) => {
              setNotifStreak(v);
              if (user?.id) updateNotificationPreferences(user.id, { streak_at_risk: v, streak_rescue: v });
            }}
          />
          <RowToggle
            icon="trophy-outline"
            label={t('settings:main.notifications.levelUp')}
            value={notifLevelUp}
            onValueChange={(v) => {
              setNotifLevelUp(v);
              if (user?.id) updateNotificationPreferences(user.id, { level_up: v });
            }}
          />
          <RowToggle
            icon="walk-outline"
            label={t('settings:main.notifications.dailyNudges')}
            sublabel={t('settings:main.notifications.dailyNudgesHint')}
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
            label={t('settings:main.notifications.nearby')}
            sublabel={t('settings:main.notifications.nearbyHint')}
            value={notifNearby}
            onValueChange={(v) => {
              setNotifNearby(v);
              cacheNearbyOfferPreference(v);
              if (user?.id) updateNotificationPreferences(user.id, { nearby_offer: v });
            }}
          />
          <RowToggle
            icon="people-outline"
            label={t('settings:main.notifications.friends')}
            sublabel={t('settings:main.notifications.friendsHint')}
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
            label={t('settings:main.notifications.news')}
            sublabel={t('settings:main.notifications.newsHint')}
            value={notifNews}
            onValueChange={(v) => {
              setNotifNews(v);
              if (user?.id) updateNotificationPreferences(user.id, { announcements: v });
            }}
            isLast
          />
        </View>

        {/* ── Email ─────────────────────────────────────────── */}
        <SectionLabel label={t('settings:main.section.email')} />
        <View style={styles.card}>
          <RowToggle
            icon="mail-outline"
            label={t('settings:main.email.weekly')}
            sublabel={t('settings:main.email.weeklyHint')}
            value={emailWeekly}
            onValueChange={(v) => {
              setEmailWeekly(v);
              if (user?.id) updateNotificationPreferences(user.id, { email_weekly_summary: v });
            }}
            isLast
          />
        </View>

        {/* ── Social ────────────────────────────────────────── */}
        <SectionLabel label={t('settings:main.section.social')} />
        <View style={styles.card}>
          <RowToggle
            icon="people-outline"
            label={t('settings:main.social.together')}
            sublabel={t('settings:main.social.togetherHint')}
            value={togetherEnabled}
            onValueChange={(v) => { setTogetherEnabled(v); persistMeta('together_enabled', v); }}
          />
          {/* Opt-in, off by default. It governs being SURFACED to non-friends —
              not what they could read: profiles carry a public select policy, so
              a name and avatar were never private. What this decides is whether
              you are placed in front of strangers, and whether you see them. */}
          <RowToggle
            icon="megaphone-outline"
            label={t('settings:main.social.openBoard')}
            sublabel={t('settings:main.social.openBoardHint')}
            value={openToStrangers}
            onValueChange={setOpenToStrangers}
            isLast={!openToStrangers}
          />
          {/* Only while the board is on — a toggle for a feature you haven't
              enabled is clutter, and with the board off these never fire
              anyway (the fan-out filters on open_to_strangers). */}
          {openToStrangers && (
            <RowToggle
              icon="notifications-outline"
              label={t('settings:main.social.boardAlerts')}
              sublabel={t('settings:main.social.boardAlertsHint')}
              value={notifBoardPosts}
              onValueChange={(v) => {
                setNotifBoardPosts(v);
                // Mirrored into user_metadata like every other switch here, so
                // the row shows the real state when Settings is reopened.
                persistMeta('notif_board_posts', v);
                if (user?.id) updateNotificationPreferences(user.id, { challenge_open_posted: v });
              }}
              isLast
            />
          )}
        </View>

        {/* ── Privacy ───────────────────────────────────────── */}
        <SectionLabel label={t('settings:main.section.privacy')} />
        <View style={styles.card}>
          <RowToggle
            icon="eye-outline"
            label={t('settings:main.privacy.shareActivity')}
            sublabel={t('settings:main.privacy.shareActivityHint')}
            value={shareActivity}
            onValueChange={(v) => { setShareActivity(v); persistMeta('share_activity', v); }}
            isLast={showOnBoards === null && !showVisitSharing && !showGymSharing}
          />
          {showOnBoards !== null && (
            <RowToggle
              icon="tv-outline"
              label={t('settings:main.privacy.gymBoards')}
              sublabel={t('settings:main.privacy.gymBoardsHint')}
              value={showOnBoards}
              onValueChange={toggleShowOnBoards}
              isLast={!showVisitSharing && !showGymSharing}
            />
          )}
          {showVisitSharing && (
            <RowToggle
              icon="walk-outline"
              label={t('settings:main.privacy.gymVisits')}
              sublabel={t('settings:main.privacy.gymVisitsHint')}
              value={gymSharing!.visits!}
              onValueChange={toggleVisitSharing}
              isLast={!showGymSharing}
            />
          )}
          {showGymSharing && (
            <RowToggle
              icon="business-outline"
              label={t('settings:main.privacy.shareWithGym', { gym: gymSharing!.gym_name })}
              sublabel={t('settings:main.privacy.shareWithGymHint')}
              value={gymSharing!.sharing}
              onValueChange={toggleGymSharing}
              isLast
            />
          )}
        </View>

        {/* ── Admin ─────────────────────────────────────────── */}
        {isAdmin && (
          <>
            <SectionLabel label={t('settings:main.section.admin')} />
            <View style={styles.card}>
              <RowLink
                icon="storefront-outline"
                label={t('settings:main.admin.partners')}
                onPress={() => router.push('/admin-partners')}
              />
              <RowLink
                icon="person-add-outline"
                label={t('settings:main.admin.athletes')}
                onPress={() => router.push('/admin-athletes')}
              />
              <RowLink
                icon="flag-outline"
                label={t('settings:main.admin.challenges')}
                onPress={() => router.push('/admin-challenges')}
                isLast
              />
            </View>
          </>
        )}

        {/* ── Support ───────────────────────────────────────── */}
        <SectionLabel label={t('settings:main.section.support')} />
        <View style={styles.card}>
          <RowLink
            icon="options-outline"
            label={t('settings:main.support.permissions')}
            sublabel={t('settings:main.support.permissionsHint')}
            onPress={() => router.push('/permissions-help')}
          />
          <RowLink
            icon="arrow-up-circle-outline"
            label={t('settings:main.support.updates')}
            sublabel={t('settings:main.support.updatesHint', { version: runningVersion() ?? '?' })}
            onPress={() => openStorePage()}
          />
          <RowLink
            icon="help-circle-outline"
            label={t('settings:main.support.helpCentre')}
            onPress={() => router.push('/help-centre')}
          />
          <RowLink
            icon="document-text-outline"
            label={t('settings:main.support.terms')}
            onPress={() => router.push('/terms-of-service')}
          />
          <RowLink
            icon="shield-outline"
            label={t('settings:main.support.privacy')}
            onPress={() => router.push('/privacy-policy')}
            isLast
          />
        </View>

        {/* ── App info ──────────────────────────────────────── */}
        <View style={styles.appInfo}>
          {/* Long-press = translation preview, for whoever is reviewing a
              draft language on a real phone. Harmless for anyone who finds
              it: it only adds unfinished languages to Settings › Language. */}
          <Pressable onLongPress={toggleTranslationPreview} delayLongPress={800}>
            <Text style={styles.appVersion}>{appVersionLabel}</Text>
          </Pressable>
        </View>

        {/* ── Danger zone ───────────────────────────────────── */}
        <View style={styles.card}>
          <Pressable
            style={({ pressed }) => [styles.dangerRow, pressed && { opacity: 0.7 }]}
            onPress={signOut}
          >
            <Ionicons name="log-out-outline" size={18} color={RED} />
            <Text style={styles.dangerLabel}>{t('settings:main.signOut')}</Text>
          </Pressable>
          <View style={styles.rowDivider} />
          <Pressable
            style={({ pressed }) => [styles.dangerRow, pressed && { opacity: 0.7 }]}
            onPress={handleDeleteAccount}
          >
            <Ionicons name="trash-outline" size={18} color={RED} />
            <Text style={[styles.dangerLabel, styles.dangerLabelDim]}>
              {t('settings:main.deleteAccount')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <PermissionFixScreen kind={permissionFix} onClose={closePermissionFix} />
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
  /** Replaces the chevron — for rows that act in place (copy) rather than navigate. */
  trailingIcon?: string;
}

function RowLink({ icon, logoElement, label, sublabel, value, valueColor, onPress, isLast, trailingIcon }: RowLinkProps) {
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
      <Ionicons name={(trailingIcon ?? 'chevron-forward') as any} size={14} color={MUTED} />
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
  const { t } = useTranslation();
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
            ? t('settings:providers.status.primary')
            : connected
              ? t('settings:providers.status.connected')
              : t('settings:providers.status.notConnected');
        const valueColor = row.isActive ? GOLD : connected ? '#4ade80' : undefined;
        return (
          <RowLink
            key={row.meta.id}
            logoElement={<ProviderLogo id={row.meta.id} size={22} />}
            label={row.meta.name}
            sublabel={row.meta.id === 'health-connect' ? t('settings:providers.healthConnectHint') : undefined}
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
                        t('settings:providers.notConnected', { name: row.meta.name }),
                        t('settings:providers.permissionNotGranted'),
                        [
                          { text: t('common:actions.cancel'), style: 'cancel' },
                          {
                            text: t('settings:providers.openHealthConnect'),
                            onPress: () => Platform.OS === 'android'
                              ? androidOpenHealthConnectSettings()
                              : Linking.openSettings(),
                          },
                        ],
                      );
                    } else if (result === 'failed') {
                      Alert.alert(
                        t('settings:providers.notConnected', { name: row.meta.name }),
                        t('settings:providers.couldNotStart'),
                      );
                    }
                    // 'pending' → OAuth handoff; the /<provider>-callback route
                    // writes the profile. Focus-refresh picks it up on return.
                  } catch (e) {
                    if (e instanceof HealthProviderNotImplementedError) {
                      Alert.alert(t('settings:providers.comingSoon', { name: row.meta.name }), t('settings:providers.notAvailable'));
                    } else {
                      Alert.alert(t('settings:providers.connectionFailed'), String((e as Error).message ?? e));
                    }
                  }
                })();
                return;
              }
              const actions: { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }[] = [];
              if (!row.isActive) {
                actions.push({
                  text: t('settings:providers.setPrimary'),
                  onPress: () => { providers.setActive(row.meta.id); },
                });
              }
              actions.push({
                text: t('settings:providers.disconnect'),
                style: 'destructive',
                onPress: () => {
                  Alert.alert(
                    t('settings:providers.disconnectTitle', { name: row.meta.name }),
                    row.meta.native
                      ? t('settings:providers.disconnectNative')
                      : t('settings:providers.disconnectCloud'),
                    [
                      { text: t('common:actions.cancel'), style: 'cancel' },
                      { text: t('settings:providers.disconnect'), style: 'destructive', onPress: () => { providers.disconnect(row.meta.id); } },
                    ],
                  );
                },
              });
              actions.push({ text: t('common:actions.cancel'), style: 'cancel' });
              Alert.alert(row.meta.name, row.isActive ? t('settings:providers.isPrimary') : undefined, actions);
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
    backgroundColor: 'rgba(232,210,0,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.22)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  notifWarnText: {
    fontSize: 12,
    fontWeight: '300',
    lineHeight: 17,
    color: 'rgba(255,255,255,0.5)',
  },
  notifWarnStrong: {
    fontWeight: '600',
    color: GOLD,
  },
  notifWarnCta: {
    fontSize: 12,
    fontWeight: '700',
    color: GOLD,
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

import { ActivityIcon } from '@/components/ActivityIcon';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { useHealthData } from '@/hooks/useHealthData';
import { ACTIVITIES, ACTIVITY_LIST, type ActivityType } from '@/constants/activities';
import { updateActivityPreferences } from '@/lib/api/user';
import { supabase } from '@/lib/supabase';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';
const RED     = '#ef4444';

// ─── Screen ───────────────────────────────────────────────────────────────────

const MAX_ACTIVITIES = 3;

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut, user, updateUserMetadata } = useAuth();

  const [isAdmin, setIsAdmin] = React.useState(false);
  const health = useHealthData();
  const [locationStatus, setLocationStatus] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');

  React.useEffect(() => {
    (async () => {
      const { supabase } = await import('@/lib/supabase');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      if (data?.is_admin) setIsAdmin(true);
    })();
  }, []);

  // Check location permission status
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      setLocationStatus(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined');
    });
  }, []);

  // Activity preferences
  const savedPrefs: ActivityType[] = user?.user_metadata?.activity_preferences ?? ['gym', 'running', 'walking'];
  const [activityPrefs, setActivityPrefs] = useState<Set<ActivityType>>(new Set(savedPrefs));

  const toggleActivityPref = async (type: ActivityType) => {
    if (type === 'gym') return;
    const next = new Set(activityPrefs);
    if (next.has(type)) {
      next.delete(type);
    } else if (next.size < MAX_ACTIVITIES) {
      next.add(type);
    } else {
      return; // at max
    }
    setActivityPrefs(next);
    await updateActivityPreferences(Array.from(next));
  };

  // Notification & privacy prefs — initialise from saved user_metadata
  const meta = user?.user_metadata ?? {};
  const [notifWorkouts,  setNotifWorkouts]  = useState(meta.notif_workouts ?? true);
  const [notifChallenges, setNotifChallenges] = useState(meta.notif_challenges ?? true);
  const [notifRewards,   setNotifRewards]   = useState(meta.notif_rewards ?? false);
  const [notifFriends,   setNotifFriends]   = useState(meta.notif_friends ?? true);
  const [shareActivity,  setShareActivity]  = useState(meta.share_activity ?? true);
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(meta.show_on_leaderboard ?? true);

  // Persist a single metadata key when a toggle changes
  const persistMeta = async (key: string, value: boolean) => {
    await updateUserMetadata({ [key]: value });
  };

  // Change password — sends a password reset email (works cross-platform)
  const handleChangePassword = async () => {
    const email = user?.email;
    if (!email) {
      Alert.alert('Error', 'No email associated with this account.');
      return;
    }
    Alert.alert(
      'Change Password',
      `We'll send a password reset link to ${email}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Reset Email',
          onPress: async () => {
            const { error } = await supabase.auth.resetPasswordForEmail(email);
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              Alert.alert('Email Sent', 'Check your inbox for a password reset link.');
            }
          },
        },
      ]
    );
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
            onPress={() => router.push('/edit-profile')}
          />
          <RowLink
            icon="lock-closed-outline"
            label="Change Password"
            onPress={handleChangePassword}
          />
          <RowLink
            icon="card-outline"
            label="Subscription"
            value="Free"
            onPress={() => {}}
            isLast
          />
        </View>

        {/* ── Activity Focus ─────────────────────────────────── */}
        <SectionLabel label="Activity Focus" />
        <Text style={styles.sectionHint}>
          Gym is always tracked. Pick 2 more activities.
        </Text>
        <View style={styles.card}>
          {[ACTIVITIES.gym, ...ACTIVITY_LIST.filter(a => a.type !== 'gym')].map((activity, idx, arr) => {
            const isGym = activity.type === 'gym';
            const isActive = activityPrefs.has(activity.type);
            const isLast = idx === arr.length - 1;
            const needsWearable = activity.verification === 'wearable';
            return (
              <View key={activity.type} style={[styles.row, !isLast && styles.rowBorder]}>
                <ActivityIcon
                  activity={activity}
                  size={18}
                  color={isActive ? activity.colour : DIM}
                  active={isActive}
                  style={styles.rowIcon}
                />
                <View style={styles.rowTextBlock}>
                  <Text style={styles.rowLabel}>{activity.label}</Text>
                  <View style={styles.activityBadgeRow}>
                    <Text style={styles.rowSublabel}>{activity.dailyCap} pts/day</Text>
                    {needsWearable && (
                      <View style={styles.wearableTag}>
                        <Ionicons name="watch-outline" size={9} color={MUTED} />
                        <Text style={styles.wearableTagText}>Wearable</Text>
                      </View>
                    )}
                  </View>
                </View>
                {isGym ? (
                  <View style={styles.lockedPill}>
                    <Text style={styles.lockedPillText}>CORE</Text>
                  </View>
                ) : (
                  <Switch
                    value={isActive}
                    onValueChange={() => toggleActivityPref(activity.type)}
                    trackColor={{ false: 'rgba(255,255,255,0.10)', true: 'rgba(232,210,0,0.4)' }}
                    thumbColor={isActive ? GOLD : 'rgba(255,255,255,0.5)'}
                    ios_backgroundColor="rgba(255,255,255,0.10)"
                    disabled={!isActive && activityPrefs.size >= MAX_ACTIVITIES}
                  />
                )}
              </View>
            );
          })}
        </View>

        {/* ── Connections ───────────────────────────────────── */}
        <SectionLabel label="Connections" />
        <View style={styles.card}>
          {/* Health data source — platform-specific */}
          <RowLink
            icon="fitness-outline"
            label={Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect'}
            value={
              !health.isAvailable
                ? 'Not available'
                : health.isAuthorized
                  ? 'Connected'
                  : 'Not connected'
            }
            valueColor={health.isAuthorized ? '#4ade80' : undefined}
            onPress={async () => {
              if (!health.isAvailable) {
                Linking.openSettings();
                return;
              }
              if (!health.isAuthorized) {
                await health.requestPermissions();
              }
            }}
          />
          {/* Location services for gym check-in */}
          <RowLink
            icon="location-outline"
            label="Location Services"
            value={
              locationStatus === 'granted'
                ? 'Enabled'
                : locationStatus === 'denied'
                  ? 'Denied'
                  : 'Not set up'
            }
            valueColor={locationStatus === 'granted' ? '#4ade80' : locationStatus === 'denied' ? RED : undefined}
            onPress={async () => {
              if (locationStatus === 'denied') {
                Linking.openSettings();
              } else if (locationStatus === 'undetermined') {
                const { status } = await Location.requestForegroundPermissionsAsync();
                setLocationStatus(status === 'granted' ? 'granted' : 'denied');
              }
            }}
          />
          {/* Supabase backend */}
          <RowLink
            icon="cloud-outline"
            label="POWR Cloud"
            value={user ? 'Synced' : 'Offline'}
            valueColor={user ? '#4ade80' : undefined}
            onPress={() => {}}
            isLast
          />
        </View>
        {!health.isAuthorized && health.isAvailable && (
          <Text style={styles.sectionHint}>
            Connect {Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect'} to verify workouts and earn points from walking &amp; sleep.
          </Text>
        )}
        {locationStatus !== 'granted' && (
          <Text style={styles.sectionHint}>
            Location is needed for automatic gym check-ins at partner venues.
          </Text>
        )}

        {/* ── Notifications ─────────────────────────────────── */}
        <SectionLabel label="Notifications" />
        <View style={styles.card}>
          <RowToggle
            icon="barbell-outline"
            label="Workout reminders"
            value={notifWorkouts}
            onValueChange={(v) => { setNotifWorkouts(v); persistMeta('notif_workouts', v); }}
          />
          <RowToggle
            icon="trophy-outline"
            label="New challenges"
            value={notifChallenges}
            onValueChange={(v) => { setNotifChallenges(v); persistMeta('notif_challenges', v); }}
          />
          <RowToggle
            icon="gift-outline"
            label="Reward alerts"
            value={notifRewards}
            onValueChange={(v) => { setNotifRewards(v); persistMeta('notif_rewards', v); }}
          />
          <RowToggle
            icon="people-outline"
            label="Friend activity"
            value={notifFriends}
            onValueChange={(v) => { setNotifFriends(v); persistMeta('notif_friends', v); }}
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
          />
          <RowToggle
            icon="podium-outline"
            label="Show on leaderboard"
            value={showOnLeaderboard}
            onValueChange={(v) => { setShowOnLeaderboard(v); persistMeta('show_on_leaderboard', v); }}
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
                isLast
              />
            </View>
          </>
        )}

        {/* ── Support ───────────────────────────────────────── */}
        <SectionLabel label="Support" />
        <View style={styles.card}>
          <RowLink
            icon="help-circle-outline"
            label="Help Centre"
            onPress={() => {}}
          />
          <RowLink
            icon="document-text-outline"
            label="Terms of Service"
            onPress={() => {}}
          />
          <RowLink
            icon="shield-outline"
            label="Privacy Policy"
            onPress={() => {}}
            isLast
          />
        </View>

        {/* ── App info ──────────────────────────────────────── */}
        <View style={styles.appInfo}>
          <Text style={styles.appVersion}>POWR · Version 1.0.0</Text>
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

interface RowLinkProps {
  icon: string;
  label: string;
  value?: string;
  valueColor?: string;
  onPress: () => void;
  isLast?: boolean;
}

function RowLink({ icon, label, value, valueColor, onPress, isLast }: RowLinkProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        !isLast && styles.rowBorder,
        pressed && { opacity: 0.7 },
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon as any} size={18} color={DIM} style={styles.rowIcon} />
      <Text style={styles.rowLabel}>{label}</Text>
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

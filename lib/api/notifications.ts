import { supabase } from '@/lib/supabase';
import type { NotificationType } from '@/lib/notifications';

// ---------------------------------------------------------------------------
// Push token registration
// ---------------------------------------------------------------------------

export async function upsertPushToken(
  userId: string,
  expoPushToken: string,
  deviceToken: string | null,
  platform: 'ios' | 'android',
) {
  const { error } = await supabase.from('user_push_tokens').upsert(
    {
      user_id: userId,
      expo_push_token: expoPushToken,
      device_token: deviceToken,
      platform,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,expo_push_token' },
  );

  if (error) throw error;
}

export async function removePushToken(userId: string, expoPushToken: string) {
  const { error } = await supabase
    .from('user_push_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('expo_push_token', expoPushToken);

  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

export interface NotificationPreferences {
  streak_at_risk: boolean;
  weekly_challenge_expiry: boolean;
  reward_unlocked: boolean;
  check_in_reminder: boolean;
  points_milestone: boolean;
  inactivity_nudge: boolean;
  sleep_target_met: boolean;
  /** Product announcements broadcast from the admin panel (App Store 4.5.4 opt-out). */
  announcements: boolean;
  /** Email: Monday weekly summary recap. */
  email_weekly_summary: boolean;
  // Together (shared challenges + friend graph).
  friend_request: boolean;
  friend_accepted: boolean;
  challenge_invite: boolean;
  challenge_accepted: boolean;
  challenge_started: boolean;
  challenge_friend_finished: boolean;
  challenge_pool_milestone: boolean;
  challenge_completed: boolean;
  challenge_expiring: boolean;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  streak_at_risk: true,
  weekly_challenge_expiry: true,
  reward_unlocked: true,
  check_in_reminder: true,
  points_milestone: true,
  inactivity_nudge: true,
  sleep_target_met: true,
  announcements: true,
  email_weekly_summary: true,
  friend_request: true,
  friend_accepted: true,
  challenge_invite: true,
  challenge_accepted: true,
  challenge_started: true,
  challenge_friend_finished: true,
  challenge_pool_milestone: true,
  challenge_completed: true,
  challenge_expiring: true,
};

export async function getNotificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return DEFAULT_PREFERENCES;

  return {
    streak_at_risk: data.streak_at_risk ?? true,
    weekly_challenge_expiry: data.weekly_challenge_expiry ?? true,
    reward_unlocked: data.reward_unlocked ?? true,
    check_in_reminder: data.check_in_reminder ?? true,
    points_milestone: data.points_milestone ?? true,
    inactivity_nudge: data.inactivity_nudge ?? true,
    sleep_target_met: data.sleep_target_met ?? true,
    announcements: data.announcements ?? true,
    email_weekly_summary: data.email_weekly_summary ?? true,
    friend_request: data.friend_request ?? true,
    friend_accepted: data.friend_accepted ?? true,
    challenge_invite: data.challenge_invite ?? true,
    challenge_accepted: data.challenge_accepted ?? true,
    challenge_started: data.challenge_started ?? true,
    challenge_friend_finished: data.challenge_friend_finished ?? true,
    challenge_pool_milestone: data.challenge_pool_milestone ?? true,
    challenge_completed: data.challenge_completed ?? true,
    challenge_expiring: data.challenge_expiring ?? true,
  };
}

export async function updateNotificationPreferences(
  userId: string,
  prefs: Partial<NotificationPreferences>,
) {
  const { error } = await supabase.from('notification_preferences').upsert(
    { user_id: userId, ...prefs, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );

  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Server-side notification trigger (calls Edge Function)
// ---------------------------------------------------------------------------

export async function triggerServerNotification(
  targetUserId: string,
  type: NotificationType,
  payload?: Record<string, unknown>,
) {
  const { error } = await supabase.functions.invoke('send-push-notification', {
    body: { target_user_id: targetUserId, type, payload },
  });

  if (error) throw error;
}

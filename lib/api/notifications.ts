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
  daily_reminder: boolean;
  daily_reminder_hour: number;
  daily_reminder_minute: number;
  streak_at_risk: boolean;
  weekly_challenge_expiry: boolean;
  reward_unlocked: boolean;
  check_in_reminder: boolean;
  points_milestone: boolean;
  inactivity_nudge: boolean;
  sleep_target_met: boolean;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  daily_reminder: true,
  daily_reminder_hour: 8,
  daily_reminder_minute: 0,
  streak_at_risk: true,
  weekly_challenge_expiry: true,
  reward_unlocked: true,
  check_in_reminder: true,
  points_milestone: true,
  inactivity_nudge: true,
  sleep_target_met: true,
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
    daily_reminder: data.daily_reminder ?? true,
    daily_reminder_hour: data.daily_reminder_hour ?? 8,
    daily_reminder_minute: data.daily_reminder_minute ?? 0,
    streak_at_risk: data.streak_at_risk ?? true,
    weekly_challenge_expiry: data.weekly_challenge_expiry ?? true,
    reward_unlocked: data.reward_unlocked ?? true,
    check_in_reminder: data.check_in_reminder ?? true,
    points_milestone: data.points_milestone ?? true,
    inactivity_nudge: data.inactivity_nudge ?? true,
    sleep_target_met: data.sleep_target_met ?? true,
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

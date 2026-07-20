import { getAppVersion } from '@/lib/device';
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
  // Piggyback version telemetry on the launch-time token upsert so the admin
  // panel can see what build each device runs (updated_at = last seen on it).
  const { appVersion, appBuild, otaUpdateId, otaChannel } = getAppVersion();

  const { error } = await supabase.from('user_push_tokens').upsert(
    {
      user_id: userId,
      expo_push_token: expoPushToken,
      device_token: deviceToken,
      platform,
      app_version: appVersion,
      app_build: appBuild,
      ota_update_id: otaUpdateId,
      ota_channel: otaChannel,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,expo_push_token' },
  );

  if (error) throw error;

  // Record the device's IANA timezone so scheduled broadcasts can deliver at
  // the right local time per user. Best-effort — never block token registration.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) await supabase.from('profiles').update({ timezone: tz }).eq('id', userId);
  } catch {
    // Intl unavailable or update failed — falls back to the default zone bucket.
  }
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

// ---------------------------------------------------------------------------
// In-app "needs your attention" counts (avatar badge)
// ---------------------------------------------------------------------------

export interface PendingActionCounts {
  friendRequests: number;
  challengeInvites: number;
  total: number;
}

/**
 * One round trip for everything awaiting the user's response — incoming friend
 * requests + unanswered shared-challenge invites. Backed by the
 * get_pending_action_counts RPC (SECURITY DEFINER). Never throws; returns zeros
 * on failure so a badge fetch can't break a screen.
 */
export async function fetchPendingActionCounts(): Promise<PendingActionCounts> {
  const { data, error } = await supabase.rpc('get_pending_action_counts');
  if (error) {
    console.warn('[notifications] pending-action counts failed:', error.message);
    return { friendRequests: 0, challengeInvites: 0, total: 0 };
  }
  const row = Array.isArray(data) ? data[0] : data;
  const friendRequests = Number(row?.friend_requests ?? 0);
  const challengeInvites = Number(row?.challenge_invites ?? 0);
  return { friendRequests, challengeInvites, total: friendRequests + challengeInvites };
}

// ---------------------------------------------------------------------------
// In-app activity feed ("Recent" tab) — durable history of notification-worthy
// moments (shared-challenge outcomes, friend-accepted, reward unlocks, points
// milestones, recorded sessions, sleep goals, announcements). Written by the
// service-role edge functions; read here via RLS (own rows only).
// ---------------------------------------------------------------------------

export type ActivityCategory = 'social' | 'rewards' | 'activity' | 'system';

export interface ActivityItem {
  id: string;
  type: string;
  category: ActivityCategory;
  title: string;
  body: string;
  route: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

/** Newest-first page of the signed-in user's activity feed. Never throws. */
export async function fetchActivityFeed(limit = 50): Promise<ActivityItem[]> {
  const { data, error } = await supabase
    .from('user_activity')
    .select('id, type, category, title, body, route, data, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[notifications] activity feed failed:', error.message);
    return [];
  }

  return (data ?? []).map((r): ActivityItem => ({
    id: r.id,
    type: r.type,
    category: (r.category ?? 'system') as ActivityCategory,
    title: r.title,
    body: r.body,
    route: r.route ?? null,
    data: (r.data ?? {}) as Record<string, unknown>,
    readAt: r.read_at ?? null,
    createdAt: r.created_at,
  }));
}

/** Unread-count for the header bell badge. Returns 0 on failure. */
export async function fetchUnreadActivityCount(): Promise<number> {
  const { data, error } = await supabase.rpc('get_unread_activity_count');
  if (error) {
    console.warn('[notifications] unread activity count failed:', error.message);
    return 0;
  }
  return Number(data ?? 0);
}

/** Mark the whole feed read in one round trip. Returns rows flipped (0 on failure). */
export async function markAllActivityRead(): Promise<number> {
  const { data, error } = await supabase.rpc('mark_all_activity_read');
  if (error) {
    console.warn('[notifications] mark-all-read failed:', error.message);
    return 0;
  }
  return Number(data ?? 0);
}

/**
 * Remove one of the caller's activity rows (swipe-to-delete on the "Recent"
 * tab). Chained `.select()` so we can tell an actual delete from an RLS no-op
 * (returns false, not a throw, if nothing was removed) — lets the caller roll
 * back its optimistic UI. Never throws.
 */
export async function deleteActivityItem(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_activity')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) {
    console.warn('[notifications] delete activity item failed:', error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

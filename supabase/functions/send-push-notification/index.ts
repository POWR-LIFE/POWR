// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
import { createClient } from '@supabase/supabase-js';
import { deliverExpoMessages } from '../_shared/expoPush.ts';

type NotificationType =
  | 'daily_reminder'
  | 'streak_at_risk'
  | 'weekly_challenge_expiry'
  | 'reward_unlocked'
  | 'check_in_reminder'
  | 'points_milestone'
  | 'inactivity_nudge'
  | 'sleep_target_met'
  | 'session_completed'
  | 'session_upgraded'
  // Shared ("together") challenges + friend graph (scope §4/§6a).
  | 'friend_request'
  | 'friend_accepted'
  | 'challenge_invite'
  | 'challenge_accepted'
  | 'challenge_started'
  | 'challenge_friend_finished'
  | 'challenge_pool_milestone'
  | 'challenge_completed'
  | 'challenge_expiring';

// The together feature has a master opt-out (user_metadata.together_enabled).
// These types are suppressed entirely when a user has turned it off.
const TOGETHER_TYPES: NotificationType[] = [
  'friend_request', 'friend_accepted', 'challenge_invite', 'challenge_accepted',
  'challenge_started', 'challenge_friend_finished', 'challenge_pool_milestone',
  'challenge_completed', 'challenge_expiring',
];

// Types that should NOT land in the in-app "Recent" feed. The two live-actionable
// types already have a home in the "Needs you" section (driven off their source
// tables), and the rest are transient "do something now" nudges with no lasting
// record value. Everything else is logged — new event types appear by default.
const FEED_EXCLUDED: Set<NotificationType> = new Set([
  'friend_request', 'challenge_invite',
  'daily_reminder', 'inactivity_nudge', 'check_in_reminder',
  'streak_at_risk', 'weekly_challenge_expiry',
]);

// Coarse bucket the client renders an icon/accent from.
function categoryFor(type: NotificationType): 'social' | 'rewards' | 'activity' | 'system' {
  switch (type) {
    case 'friend_request':
    case 'friend_accepted':
    case 'challenge_invite':
    case 'challenge_accepted':
    case 'challenge_started':
    case 'challenge_friend_finished':
    case 'challenge_pool_milestone':
    case 'challenge_completed':
    case 'challenge_expiring':
      return 'social';
    case 'reward_unlocked':
    case 'points_milestone':
      return 'rewards';
    case 'session_completed':
    case 'session_upgraded':
    case 'sleep_target_met':
      return 'activity';
    default:
      return 'system';
  }
}

interface RequestBody {
  target_user_id: string;
  type: NotificationType;
  payload?: Record<string, unknown>;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  ttl?: number; // seconds — Expo maps to apns-expiration / FCM ttl
}

// Time-to-live (seconds) for types that become noise if delivered late. Expo
// hands this to APNs (apns-expiration) / FCM (ttl), so the platform drops an
// still-undelivered push past the window instead of buzzing hours later — a
// "You're in. Every minute counts." that lands after the user has gone home is
// worse than nothing. Durable, still-relevant types (session_completed,
// reward_unlocked, points_milestone, and the social/challenge set) omit it so
// they always arrive, however delayed.
const TTL_SECONDS: Partial<Record<NotificationType, number>> = {
  check_in_reminder:       15 * 60,      // only useful while still in the gym
  streak_at_risk:          6 * 60 * 60,  // must land before midnight
  weekly_challenge_expiry: 12 * 60 * 60,
  daily_reminder:          6 * 60 * 60,
  inactivity_nudge:        12 * 60 * 60,
};

function formatSessionCompletedBody(
  partnerName?: string | null,
  currentStreak?: number | null,
  earned?: number | null,
): string {
  const name = partnerName?.trim();
  const streak = Number(currentStreak ?? 0);
  const pts = Math.max(0, Math.round(Number(earned ?? 0)));

  // Fold the points earned into the body so the single "Session recorded"
  // notification carries everything — no separate "+X pts" push needed.
  const parts: string[] = [];
  if (name) parts.push(name);
  if (pts > 0) parts.push(`+${pts.toLocaleString()} pts`);
  if (streak > 0) parts.push(`Day ${streak} streak`);

  return parts.length > 0 ? parts.join(' · ') : 'Your session counted.';
}

// ---------------------------------------------------------------------------
// Notification copy per type
// ---------------------------------------------------------------------------

function buildMessage(
  type: NotificationType,
  payload: Record<string, unknown>,
  token: string,
): ExpoMessage {
  const base: Omit<ExpoMessage, 'to'> = (() => {
    switch (type) {
      case 'daily_reminder':
        return {
          title: "Time to move 💪",
          body: "Every step earns POWR. Log your activity and keep the streak alive.",
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };

      case 'streak_at_risk': {
        const streak = (payload.current_streak as number) ?? 0;
        return {
          title: `Your ${streak}-day streak is at risk 🔥`,
          body: "Log any activity before midnight to keep it alive.",
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_streak_v2',
          priority: 'high',
        };
      }

      case 'weekly_challenge_expiry': {
        const name = (payload.challenge_name as string) ?? 'Weekly Challenge';
        return {
          title: "Challenge ending soon ⏰",
          body: `"${name}" expires in 24 hours. Don't miss your bonus POWR points.`,
          data: { type, route: '/(tabs)/progress' },
          sound: 'default',
        };
      }

      case 'reward_unlocked': {
        const rewardName = (payload.reward_name as string) ?? 'a reward';
        return {
          title: "New reward unlocked 🎁",
          body: `You've unlocked "${rewardName}". Redeem it before it expires.`,
          data: { type, route: '/(tabs)/rewards', reward_id: payload.reward_id },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }

      case 'check_in_reminder': {
        return {
          title: 'POWR',
          body: "You're in. Every minute counts.",
          data: { type, route: '/(tabs)/index', location_id: payload.location_id },
          sound: 'default',
        };
      }

      case 'points_milestone': {
        const points = (payload.points as number) ?? 0;
        const rawPointsToUnlock =
          (payload.points_to_unlock as number | undefined) ??
          (payload.pointsToUnlock as number | undefined);
        const pointsToUnlock = Math.max(0, Math.ceil(rawPointsToUnlock ?? 0));
        const rewardName =
          ((payload.reward_name as string | undefined) ??
            (payload.rewardName as string | undefined) ??
            '')
            .trim();
        const hasWithinReach = pointsToUnlock > 0;

        return {
          title: hasWithinReach ? 'Reward within reach' : `${points.toLocaleString()} POWR points 🏆`,
          body: hasWithinReach
            ? `You're close. ${pointsToUnlock.toLocaleString()} pts to unlock your ${rewardName || 'next'} reward.`
            : "You're crushing it. Check your rewards — something new might be waiting.",
          data: {
            type,
            route: '/(tabs)/rewards',
            points,
            points_to_unlock: hasWithinReach ? pointsToUnlock : undefined,
            reward_name: rewardName || undefined,
          },
          sound: 'default',
        };
      }

      case 'inactivity_nudge': {
        const days = (payload.days_inactive as number) ?? 3;
        const titles: Record<number, string> = {
          3: "We miss you 👋",
          7: "Your streak is waiting to be rebuilt 🔄",
        };
        const bodies: Record<number, string> = {
          3: "It's been 3 days. Even a short walk earns POWR points.",
          7: "7 days away — jump back in and start earning again.",
        };
        return {
          title: titles[days] ?? "Ready to get back on track?",
          body: bodies[days] ?? "Log any activity today and start your next streak.",
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
        };
      }

      case 'sleep_target_met': {
        const hours = (payload.hours as number) ?? 0;
        const points = (payload.points as number) ?? 0;
        return {
          title: "Sleep goal reached 🌙",
          body: `${hours.toFixed(1)}h of sleep earned you ${points} POWR point${points !== 1 ? 's' : ''}.`,
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'session_completed': {
        const sessionId = (payload.session_id as string) ?? '';
        const earned = Math.max(0, Math.round(Number(payload.earned ?? payload.points ?? 0)));
        const partnerName = payload.partner_name as string | undefined;
        const currentStreak = payload.current_streak as number | undefined;

        return {
          title: earned > 0 ? 'Session recorded 🔥' : 'Session complete 🔥',
          body: formatSessionCompletedBody(partnerName, currentStreak, earned),
          data: {
            type,
            route: `/share-stats?mode=check-in&sessionId=${sessionId}`,
            session_id: sessionId,
            earned: earned > 0 ? earned : undefined,
            partner_name: partnerName,
            current_streak: currentStreak,
          },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }

      case 'session_upgraded': {
        // The 40-min tier bonus, credited by upgrade-gym-tier AFTER the initial
        // claim already pushed "Session recorded". `earned` is the delta (the
        // extra points for staying to 40 min), carried explicitly because the
        // session now has multiple 'earn' rows on the ledger.
        const sessionId = (payload.session_id as string) ?? '';
        const earned = Math.max(0, Math.round(Number(payload.earned ?? 0)));
        const partnerName = (payload.partner_name as string | undefined)?.trim();

        const parts: string[] = [];
        if (partnerName) parts.push(partnerName);
        if (earned > 0) parts.push(`+${earned.toLocaleString()} pts`);
        parts.push('40-min bonus');

        return {
          title: 'Bonus unlocked 🔓',
          body: parts.join(' · '),
          data: {
            type,
            route: `/share-stats?mode=check-in&sessionId=${sessionId}`,
            session_id: sessionId,
            earned: earned > 0 ? earned : undefined,
            partner_name: partnerName,
          },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }

      // ── Friend graph ──────────────────────────────────────────────────────
      case 'friend_request': {
        const name = (payload.from_name as string) || 'Someone';
        return {
          title: 'New friend request 👋',
          body: `${name} wants to team up on POWR.`,
          data: { type, route: '/friends', from_user_id: payload.from_user_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }

      case 'friend_accepted': {
        const name = (payload.from_name as string) || 'Your friend';
        return {
          title: "You're connected 🤝",
          body: `${name} accepted your friend request. Take on a challenge together.`,
          data: { type, route: '/friends', from_user_id: payload.from_user_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      // ── Shared challenges ─────────────────────────────────────────────────
      case 'challenge_invite': {
        const name = (payload.from_name as string) || 'A friend';
        const title = (payload.title as string) || 'a challenge';
        return {
          title: `${name} invited you 🤜🤛`,
          body: `Take on "${title}" together — tap to join.`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }

      case 'challenge_accepted': {
        const name = (payload.from_name as string) || 'A friend';
        const title = (payload.title as string) || 'your challenge';
        const accepted = Math.max(0, Math.round(Number(payload.accepted_count ?? 0)));
        const total = Math.max(0, Math.round(Number(payload.total_count ?? 0)));
        const tail = accepted > 0 && total > 0 ? ` — ${accepted} of ${total} in so far.` : '';
        return {
          title: `${name} is in 🤜🤛`,
          body: `${name} accepted "${title}".${tail}`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'challenge_started': {
        const title = (payload.title as string) || 'Your challenge';
        return {
          title: 'Challenge on 🔥',
          body: `"${title}" has started — everyone's in. Get your part done.`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }

      case 'challenge_friend_finished': {
        const name = (payload.from_name as string) || 'A friend';
        const title = (payload.title as string) || 'your challenge';
        return {
          title: `${name} finished their part 💪`,
          body: `They're done with "${title}". Finish yours to lock in the group bonus.`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'challenge_pool_milestone': {
        const title = (payload.title as string) || 'your challenge';
        const pct = Number(payload.pct ?? 50);
        const remaining = Math.max(0, Number(payload.remaining ?? 0));
        const unit = ((payload.unit as string) || '').trim();
        const remainStr = `${remaining.toLocaleString()}${unit ? ` ${unit}` : ''}`.trim();
        const nearlyThere = pct >= 80;
        return {
          title: nearlyThere ? 'Almost there 🔥' : 'Halfway there 🏁',
          body: nearlyThere
            ? `Your group's nearly cracked "${title}" — just ${remainStr} left in the pool.`
            : `Your group's hit ${pct}% of "${title}" — ${remainStr} to go together.`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
        };
      }

      case 'challenge_completed': {
        const title = (payload.title as string) || 'Your challenge';
        const total = Math.max(0, Math.round(Number(payload.total ?? payload.base ?? 0)));
        const bonus = Math.max(0, Math.round(Number(payload.bonus ?? 0)));
        const bonusText = bonus > 0 ? ` (incl. +${bonus} together bonus)` : '';
        return {
          title: 'Challenge complete 🎉',
          body: `"${title}" done — +${total.toLocaleString()} POWR${bonusText}.`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_rewards_v2',
          priority: 'high',
        };
      }

      case 'challenge_expiring': {
        const title = (payload.title as string) || 'Your challenge';
        const hours = Math.max(1, Math.round(Number(payload.hours_left ?? 6)));
        return {
          title: 'Challenge ending soon ⏰',
          body: `"${title}" ends in ${hours}h — finish your part to earn the group bonus.`,
          data: { type, route: `/shared-challenge?id=${payload.challenge_id}`, challenge_id: payload.challenge_id },
          sound: 'default',
          channelId: 'powr_default_v2',
          priority: 'high',
        };
      }
    }
  })();

  const ttl = TTL_SECONDS[type];
  return { to: token, ...base, ...(ttl != null ? { ttl } : {}) };
}

// Apply admin-level copy overrides (from notification_config) to a built message.
// Overrides are static strings — dynamic payload values are not injected.
function applyNotifOverrides(
  msg: ExpoMessage,
  config: { title_override?: string | null; body_override?: string | null } | null,
): ExpoMessage {
  if (!config) return msg;
  return {
    ...msg,
    ...(config.title_override ? { title: config.title_override } : {}),
    ...(config.body_override  ? { body:  config.body_override  } : {}),
  };
}

// Consecutive distinct activity days ending today or yesterday, computed
// straight from activity_sessions — the same basis the app's streak display
// uses. We do NOT read user_streaks.current_streak: it's mutated by an
// increment-based updater in claim-points that an out-of-order claim (e.g. a
// backdated session) can transiently corrupt, and a push fires at claim time —
// exactly when that value is most likely stale — so the number self-heals
// seconds later but the notification already went out wrong. Recompute it.
async function streakFromSessions(supabase: any, userId: string): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const { data: sessions } = await supabase
    .from('activity_sessions')
    .select('started_at')
    .eq('user_id', userId)
    .neq('verification', 'manual')
    .gte('started_at', since.toISOString())
    .order('started_at', { ascending: false });

  const uniqueDays = [...new Set(
    (sessions ?? []).map((s: { started_at: string }) => s.started_at.slice(0, 10)),
  )].sort().reverse();

  const todayStr = new Date().toISOString().slice(0, 10);
  const yd = new Date();
  yd.setDate(yd.getDate() - 1);
  const yesterdayStr = yd.toISOString().slice(0, 10);

  if (uniqueDays.length === 0 || (uniqueDays[0] !== todayStr && uniqueDays[0] !== yesterdayStr)) {
    return 0;
  }

  let streak = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    const a = new Date(uniqueDays[i - 1]).getTime();
    const b = new Date(uniqueDays[i]).getTime();
    if (a - b === 86400000) streak++;
    else break;
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const body: RequestBody = await req.json();
    const { target_user_id, type, payload: rawPayload = {} } = body;
    let payload = rawPayload;

    if (!target_user_id || !type) {
      return new Response(JSON.stringify({ error: 'target_user_id and type are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Check admin-level notification config (global kill-switch + copy overrides).
    // Fetched once here; overrides are applied to every message built below.
    const { data: notifConfig } = await supabase
      .from('notification_config')
      .select('enabled, title_override, body_override')
      .eq('type', type)
      .maybeSingle();

    if (notifConfig?.enabled === false) {
      return new Response(JSON.stringify({ skipped: true, reason: 'admin_disabled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check notification preferences. session_upgraded (the 40-min tier bonus)
    // has no toggle of its own — it rides the session_completed preference so a
    // user who muted session pushes doesn't get the upgrade one either.
    const prefColumn: NotificationType =
      type === 'session_upgraded' ? 'session_completed' : type;
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select(prefColumn)
      .eq('user_id', target_user_id)
      .maybeSingle();

    if (prefs && prefs[prefColumn] === false) {
      return new Response(JSON.stringify({ skipped: true, reason: 'user_preference' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Master opt-out: a user who turned the Together feature off in settings
    // (user_metadata.together_enabled === false) receives none of its pushes.
    if (TOGETHER_TYPES.includes(type)) {
      const { data: u } = await supabase.auth.admin.getUserById(target_user_id);
      if (u?.user?.user_metadata?.together_enabled === false) {
        return new Response(JSON.stringify({ skipped: true, reason: 'together_disabled' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // For streak_at_risk: compute the streak directly from sessions so the
    // notification always reflects the same value the app shows, regardless of
    // whether user_streaks is stale.
    if (type === 'streak_at_risk') {
      const computedStreak = await streakFromSessions(supabase, target_user_id);

      if (computedStreak === 0) {
        return new Response(JSON.stringify({ skipped: true, reason: 'no_active_streak' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      payload = { ...payload, current_streak: computedStreak };
    }

    // For points_milestone: derive a dynamic "within reach" payload from the
    // next active reward when callers only send current points.
    if (type === 'points_milestone') {
      const points = Number(payload.points ?? 0);
      const hasExplicitRemaining =
        payload.points_to_unlock !== undefined || payload.pointsToUnlock !== undefined;
      const hasExplicitRewardName =
        payload.reward_name !== undefined || payload.rewardName !== undefined;

      if (!hasExplicitRemaining || !hasExplicitRewardName) {
        const { data: nextReward, error: rewardError } = await supabase
          .from('rewards')
          .select('title, powr_cost')
          .eq('active', true)
          .gt('powr_cost', points)
          .order('powr_cost', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!rewardError && nextReward?.powr_cost) {
          const rewardCost = Number(nextReward.powr_cost);
          const remaining = Math.max(0, Math.ceil(rewardCost - points));
          const atOrAboveWithinReachThreshold = points >= rewardCost * 0.8;

          payload = {
            ...payload,
            points,
            points_to_unlock: atOrAboveWithinReachThreshold ? remaining : undefined,
            reward_name: atOrAboveWithinReachThreshold ? nextReward.title : undefined,
          };
        } else {
          payload = { ...payload, points };
        }
      }
    }

    if (type === 'session_completed' || type === 'session_upgraded') {
      const sessionId = String(payload.session_id ?? '').trim();

      if (sessionId) {
        const { data: session } = await supabase
          .from('activity_sessions')
          .select('user_id, partner_id')
          .eq('id', sessionId)
          .maybeSingle();

        if (session) {
          payload = { ...payload, user_id: session.user_id };

          if (session.partner_id) {
            const { data: partner } = await supabase
              .from('partners')
              .select('name')
              .eq('id', session.partner_id)
              .maybeSingle();

            if (partner?.name) {
              payload = { ...payload, partner_name: partner.name };
            }
          }

          const computedStreak = await streakFromSessions(supabase, session.user_id);
          if (computedStreak > 0) {
            payload = { ...payload, current_streak: computedStreak };
          }

          // Only session_completed re-derives `earned` from the ledger — it has a
          // single 'earn' row at that point. session_upgraded carries its delta
          // explicitly (the session already has 2+ 'earn' rows, so a single-row
          // lookup here would be ambiguous).
          if (type === 'session_completed') {
            const { data: txn } = await supabase
              .from('point_transactions')
              .select('amount')
              .eq('session_id', sessionId)
              .eq('type', 'earn')
              .maybeSingle();

            if (txn?.amount !== undefined && txn.amount !== null) {
              payload = { ...payload, earned: txn.amount };
            }
          }
        }
      }
    }

    // Persist an in-app activity-feed row before touching push tokens, so the
    // moment has a durable home even when no device push can land (permission
    // denied / no registered token). Reuses the exact push copy so the feed item
    // reads identically. Best-effort: a feed-write failure must never break the
    // push path.
    if (!FEED_EXCLUDED.has(type)) {
      try {
        const rawSample = buildMessage(type, payload, '');
        const sample = applyNotifOverrides(rawSample, notifConfig);
        const route =
          typeof sample.data?.route === 'string' ? sample.data.route : null;
        await supabase.from('user_activity').insert({
          user_id: target_user_id,
          type,
          category: categoryFor(type),
          title: sample.title,
          body: sample.body,
          route,
          data: sample.data ?? {},
        });
      } catch (feedErr) {
        console.warn('[send-push-notification] activity-feed write failed:', feedErr);
      }
    }

    // Fetch push tokens for the target user
    const { data: tokens, error: tokenError } = await supabase
      .from('user_push_tokens')
      .select('expo_push_token')
      .eq('user_id', target_user_id);

    if (tokenError) throw tokenError;
    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no_tokens' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build and send messages for every registered device. deliverExpoMessages
    // reads the Expo tickets and prunes any DeviceNotRegistered token inline, then
    // confirms delivery via a background receipt poll (EdgeRuntime.waitUntil) so a
    // reinstalled/upgraded device's dead token is cleaned up instead of silently
    // swallowing every future push. Same single inline Expo round-trip as before —
    // no added latency for callers that await this (e.g. claim-points).
    const messages: ExpoMessage[] = tokens.map(({ expo_push_token }) =>
      applyNotifOverrides(buildMessage(type, payload, expo_push_token), notifConfig),
    );

    const result = await deliverExpoMessages(supabase, messages);

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-push-notification]', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

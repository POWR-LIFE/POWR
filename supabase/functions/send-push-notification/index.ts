// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
import { createClient } from '@supabase/supabase-js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type NotificationType =
  | 'daily_reminder'
  | 'streak_at_risk'
  | 'weekly_challenge_expiry'
  | 'reward_unlocked'
  | 'check_in_reminder'
  | 'points_milestone'
  | 'inactivity_nudge'
  | 'sleep_target_met'
  | 'session_completed';

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
}

function formatSessionCompletedBody(partnerName?: string | null, currentStreak?: number | null): string {
  const name = partnerName?.trim();
  const streak = Number(currentStreak ?? 0);

  if (name && streak > 0) {
    return `${name} · Day ${streak} streak`;
  }

  if (name) {
    return name;
  }

  if (streak > 0) {
    return `Day ${streak} streak`;
  }

  return 'Your session counted.';
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
          title: earned > 0 ? `+${earned.toLocaleString()} pts earned! 🔥` : 'Session complete 🔥',
          body: formatSessionCompletedBody(partnerName, currentStreak),
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
    }
  })();

  return { to: token, ...base };
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

    // Check notification preferences
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select(type)
      .eq('user_id', target_user_id)
      .maybeSingle();

    if (prefs && prefs[type] === false) {
      return new Response(JSON.stringify({ skipped: true, reason: 'user_preference' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // For streak_at_risk: compute the streak directly from sessions so the
    // notification always reflects the same value the app shows, regardless of
    // whether user_streaks is stale.
    if (type === 'streak_at_risk') {
      const since = new Date();
      since.setDate(since.getDate() - 90);

      const { data: sessions } = await supabase
        .from('activity_sessions')
        .select('started_at')
        .eq('user_id', target_user_id)
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

      let computedStreak = 0;
      if (uniqueDays.length > 0 && (uniqueDays[0] === todayStr || uniqueDays[0] === yesterdayStr)) {
        computedStreak = 1;
        for (let i = 1; i < uniqueDays.length; i++) {
          const a = new Date(uniqueDays[i - 1]).getTime();
          const b = new Date(uniqueDays[i]).getTime();
          if (a - b === 86400000) {
            computedStreak++;
          } else {
            break;
          }
        }
      }

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

    if (type === 'session_completed') {
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

          const { data: streak } = await supabase
            .from('user_streaks')
            .select('current_streak')
            .eq('user_id', session.user_id)
            .maybeSingle();

          if (streak?.current_streak !== undefined && streak.current_streak !== null) {
            payload = { ...payload, current_streak: streak.current_streak };
          }

          // Fetch actual points earned for this session from the ledger
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

    // Build and send messages for every registered device
    const messages: ExpoMessage[] = tokens.map(({ expo_push_token }) =>
      buildMessage(type, payload, expo_push_token),
    );

    const expoResponse = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const result = await expoResponse.json();

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

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
  | 'inactivity_nudge';

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
        };

      case 'streak_at_risk': {
        const streak = (payload.current_streak as number) ?? 0;
        return {
          title: `Your ${streak}-day streak is at risk 🔥`,
          body: "Log any activity before midnight to keep it alive.",
          data: { type, route: '/(tabs)/index' },
          sound: 'default',
          channelId: 'streak',
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
          channelId: 'rewards',
          priority: 'high',
        };
      }

      case 'check_in_reminder': {
        const partner = (payload.partner_name as string) ?? 'a partner gym';
        return {
          title: `You're at ${partner} 📍`,
          body: "Tap to check in and earn POWR points for your visit.",
          data: { type, route: '/(tabs)/index', location_id: payload.location_id },
          sound: 'default',
        };
      }

      case 'points_milestone': {
        const points = (payload.points as number) ?? 0;
        return {
          title: `${points.toLocaleString()} POWR points 🏆`,
          body: "You're crushing it. Check your rewards — something new might be waiting.",
          data: { type, route: '/(tabs)/rewards', points },
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
    const { target_user_id, type, payload = {} } = body;

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

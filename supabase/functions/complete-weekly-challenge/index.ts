// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
import { createClient } from '@supabase/supabase-js';

type ActivityType = 'walking' | 'running' | 'cycling' | 'swimming' | 'gym' | 'hiit' | 'sports' | 'yoga' | 'dance' | 'sleep';

interface CompleteRequest {
  challenge_id: string;
  session_id: string;
  utc_offset_minutes: number; // client's offset from UTC, e.g. BST = 60, EST = -300
}

// Base points table — mirrors claim-points and manual-log.
// Used to calculate the 2× bonus (making total = 3× base).
function calcBasePoints(type: ActivityType, durationSec: number, steps: number, distanceM: number): number {
  const mins = Math.floor(durationSec / 60);
  const dist = distanceM ?? 0;

  switch (type) {
    case 'walking':
      if (steps >= 10000) return 5;
      if (steps >= 8000)  return 4;
      if (steps >= 6000)  return 3;
      if (steps >= 4000)  return 2;
      return 0;
    case 'running':
      if (dist >= 10000 || mins >= 60) return 10;
      if (dist >= 5000  || mins >= 30) return 8;
      if (dist >= 3000  || mins >= 20) return 6;
      if (dist >= 2000  || mins >= 15) return 5;
      return 0;
    case 'cycling':
      if (dist >= 50000 || mins >= 90) return 10;
      if (dist >= 25000 || mins >= 60) return 8;
      if (dist >= 12000 || mins >= 30) return 6;
      if (dist >= 6000  || mins >= 20) return 4;
      return 0;
    case 'swimming':
      if (dist >= 2000 || mins >= 60) return 10;
      if (dist >= 1000 || mins >= 40) return 9;
      if (dist >= 500  || mins >= 20) return 7;
      if (mins >= 15)  return 5;
      return 0;
    case 'gym':
      if (mins >= 45) return 15;
      if (mins >= 20) return 10;
      return 0;
    case 'hiit':
      if (mins >= 45) return 10;
      if (mins >= 30) return 9;
      if (mins >= 20) return 7;
      return 0;
    case 'sports':
      if (mins >= 90) return 10;
      if (mins >= 60) return 8;
      if (mins >= 30) return 6;
      return 0;
    case 'yoga':
      if (mins >= 60) return 6;
      if (mins >= 45) return 5;
      if (mins >= 30) return 4;
      if (mins >= 20) return 3;
      return 0;
    case 'dance':
      if (mins >= 60) return 8;
      if (mins >= 45) return 7;
      if (mins >= 30) return 6;
      if (mins >= 20) return 4;
      return 0;
    default:
      return 0;
  }
}

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

/** Returns the Monday of the ISO week containing the given date, as UTC midnight. */
function getWeekStartUTC(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // 1=Mon … 7=Sun
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: CompleteRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { challenge_id, session_id, utc_offset_minutes } = body;
  if (!challenge_id || !session_id || utc_offset_minutes === undefined) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  // 1. Fetch the session — verify it belongs to this user
  const { data: session, error: sessionError } = await supabase
    .from('activity_sessions')
    .select('id, user_id, type, started_at, ended_at, duration_sec, distance_m, steps, verification')
    .eq('id', session_id)
    .eq('user_id', user.id)
    .single();

  if (sessionError || !session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
  }

  // Manual sessions are not eligible for weekly challenge bonuses — they have no
  // sensor-backed verification so awarding a 3× multiplier would be abusable.
  if (session.verification === 'manual') {
    return new Response(
      JSON.stringify({ error: 'Manual sessions are not eligible for weekly challenge bonuses. Connect a health provider to qualify.' }),
      { status: 422 },
    );
  }

  // 2. Check the session started before 12:00 PM in the user's local time
  const sessionUTC = new Date(session.started_at);
  const localMs = sessionUTC.getTime() + utc_offset_minutes * 60 * 1000;
  const localDate = new Date(localMs);
  const localHour = localDate.getUTCHours(); // UTC hours of the offset-adjusted time = local hour

  if (localHour >= 12) {
    return new Response(
      JSON.stringify({ error: 'Session did not start before 12pm local time' }),
      { status: 422 },
    );
  }

  // 3. Check session is within this challenge's week (Mon–Sun of the session's local date)
  const weekStart = getWeekStartUTC(localDate);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (localDate < weekStart || localDate >= weekEnd) {
    return new Response(JSON.stringify({ error: 'Session is outside the current challenge week' }), { status: 422 });
  }

  const challengeWeek = getISOWeek(localDate);

  // 4. Idempotency — check not already completed this week
  const { data: existing } = await supabase
    .from('user_challenge_completions')
    .select('id, points_awarded')
    .eq('user_id', user.id)
    .eq('challenge_id', challenge_id)
    .eq('challenge_week', challengeWeek)
    .maybeSingle();

  if (existing) {
    return new Response(
      JSON.stringify({ ok: true, already_completed: true, points_awarded: existing.points_awarded }),
      { status: 200 },
    );
  }

  // 5. Calculate the 2× bonus (session already earned 1×, total becomes 3×)
  const base = calcBasePoints(
    session.type as ActivityType,
    session.duration_sec ?? 0,
    session.steps ?? 0,
    session.distance_m ?? 0,
  );
  const bonusPoints = base * 2; // 2× extra on top of the 1× already recorded

  // 6. Award bonus as type='earn' so it counts toward XP/level progression
  if (bonusPoints > 0) {
    const { error: ptError } = await supabase
      .from('point_transactions')
      .insert({
        user_id: user.id,
        session_id: session.id,
        amount: bonusPoints,
        type: 'earn',
        source: 'weekly_challenge',
        description: `Early Bird challenge bonus (3× ${session.type})`,
      });

    if (ptError) {
      console.error('Failed to insert bonus transaction:', ptError);
      return new Response(JSON.stringify({ error: 'Failed to award bonus' }), { status: 500 });
    }
  }

  // 7. Record the completion
  const { error: completionError } = await supabase
    .from('user_challenge_completions')
    .insert({
      user_id: user.id,
      challenge_id,
      challenge_week: challengeWeek,
      session_id: session.id,
      activity_type: session.type,
      points_awarded: bonusPoints,
    });

  if (completionError) {
    // Unique violation means a race completed it simultaneously — still a success
    if (completionError.code === '23505') {
      return new Response(
        JSON.stringify({ ok: true, already_completed: true, points_awarded: bonusPoints }),
        { status: 200 },
      );
    }
    console.error('Failed to record completion:', completionError);
    return new Response(JSON.stringify({ error: 'Failed to record completion' }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ ok: true, already_completed: false, points_awarded: bonusPoints, activity_type: session.type }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

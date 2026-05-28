// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
import { createClient } from '@supabase/supabase-js';
import {
  buildContext,
  evaluateChallenge,
  getChallengeById,
  getISOWeek,
  getLocalMondayAsUTC,
} from '../_shared/challenges.ts';

interface CompleteRequest {
  challenge_id: string;
  utc_offset_minutes: number; // client offset from UTC, e.g. BST=60, EST=-300
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

  const { challenge_id, utc_offset_minutes } = body;
  if (!challenge_id || utc_offset_minutes === undefined) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  // 1. Resolve the challenge from the catalog (server-side, authoritative).
  const challenge = getChallengeById(challenge_id);
  if (!challenge) {
    return new Response(JSON.stringify({ error: 'Unknown challenge' }), { status: 404 });
  }
  if (challenge.supported === false) {
    return new Response(JSON.stringify({ error: 'Challenge not currently supported' }), { status: 422 });
  }

  // 2. Determine the user's current local week + its Monday start.
  const localNow = new Date(Date.now() + utc_offset_minutes * 60 * 1000);
  const challengeWeek = getISOWeek(localNow);
  const weekStart = getLocalMondayAsUTC(utc_offset_minutes);

  // 3. Idempotency — already completed this week?
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

  // 4. Load this week's sessions (sensor-backed only is enforced by the evaluator).
  const { data: sessions, error: sessErr } = await supabase
    .from('activity_sessions')
    .select('type, started_at, duration_sec, distance_m, steps, verification')
    .eq('user_id', user.id)
    .gte('started_at', weekStart)
    .order('started_at', { ascending: true });

  if (sessErr) {
    return new Response(JSON.stringify({ error: 'Failed to load sessions' }), { status: 500 });
  }

  // 5. Load step windows (only needed for intraday challenges; harmless otherwise).
  let stepWindows: any[] = [];
  if (challenge.rule.kind === 'step_window') {
    const weekStartDate = weekStart.slice(0, 10);
    const { data: windows } = await supabase
      .from('daily_step_windows')
      .select('date, before_9am, midday_12_14, after_6pm')
      .eq('user_id', user.id)
      .gte('date', weekStartDate);
    stepWindows = windows ?? [];
  }

  // 6. Re-evaluate the rule server-side. Never trust the client.
  const ctx = buildContext(sessions ?? [], utc_offset_minutes, stepWindows);
  const { met } = evaluateChallenge(challenge.rule, ctx);
  if (!met) {
    return new Response(JSON.stringify({ ok: false, completed: false }), { status: 200 });
  }

  // 7. Award the challenge's fixed points (type 'earn' → counts toward XP/level).
  const points = challenge.points;
  const { error: ptError } = await supabase
    .from('point_transactions')
    .insert({
      user_id: user.id,
      amount: points,
      type: 'earn',
      source: 'weekly_challenge',
      description: `Weekly challenge: ${challenge.title} (+${points})`,
    });
  if (ptError) {
    console.error('Failed to insert challenge points:', ptError);
    return new Response(JSON.stringify({ error: 'Failed to award points' }), { status: 500 });
  }

  // 8. Record the completion (idempotent on the unique constraint).
  const { error: completionError } = await supabase
    .from('user_challenge_completions')
    .insert({
      user_id: user.id,
      challenge_id,
      challenge_week: challengeWeek,
      activity_type: challenge.category,
      points_awarded: points,
    });

  if (completionError) {
    if (completionError.code === '23505') {
      return new Response(
        JSON.stringify({ ok: true, already_completed: true, points_awarded: points }),
        { status: 200 },
      );
    }
    console.error('Failed to record completion:', completionError);
    return new Response(JSON.stringify({ error: 'Failed to record completion' }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ ok: true, completed: true, already_completed: false, points_awarded: points, challenge_id }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

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
  target?: 'current' | 'previous'; // which week to evaluate; defaults to current
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

  // 2. Determine which week to evaluate. 'previous' enables a grace re-check so a
  //    user who met a challenge but never opened the app before the Monday
  //    rollover can still be awarded on their next visit. Only current/previous
  //    are accepted — never an arbitrary client-supplied week.
  const target = body.target === 'previous' ? 'previous' : 'current';
  const shiftMs = target === 'previous' ? 7 * 24 * 60 * 60 * 1000 : 0;
  const localNow = new Date(Date.now() + utc_offset_minutes * 60 * 1000 - shiftMs);
  const challengeWeek = getISOWeek(localNow);
  const weekStart = getLocalMondayAsUTC(utc_offset_minutes, Date.now() - shiftMs);
  // For the previous week, bound the upper end at this week's Monday so current
  // sessions don't leak into the evaluation.
  const weekEnd = target === 'previous' ? getLocalMondayAsUTC(utc_offset_minutes) : null;

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

  // 4. Load the target week's sessions (sensor-backed only is enforced by the evaluator).
  let sessionQuery = supabase
    .from('activity_sessions')
    .select('type, started_at, duration_sec, distance_m, steps, verification')
    .eq('user_id', user.id)
    .gte('started_at', weekStart);
  if (weekEnd) sessionQuery = sessionQuery.lt('started_at', weekEnd);
  const { data: sessions, error: sessErr } = await sessionQuery.order('started_at', { ascending: true });

  if (sessErr) {
    return new Response(JSON.stringify({ error: 'Failed to load sessions' }), { status: 500 });
  }

  // 5. Load step windows (only needed for intraday challenges; harmless otherwise).
  let stepWindows: any[] = [];
  if (challenge.rule.kind === 'step_window') {
    let windowQuery = supabase
      .from('daily_step_windows')
      .select('date, before_9am, midday_12_14, after_6pm')
      .eq('user_id', user.id)
      .gte('date', weekStart.slice(0, 10));
    if (weekEnd) windowQuery = windowQuery.lt('date', weekEnd.slice(0, 10));
    const { data: windows } = await windowQuery;
    stepWindows = windows ?? [];
  }

  // 6. Re-evaluate the rule server-side. Never trust the client.
  const ctx = buildContext(sessions ?? [], utc_offset_minutes, stepWindows);
  const { met } = evaluateChallenge(challenge.rule, ctx);
  if (!met) {
    return new Response(JSON.stringify({ ok: false, completed: false }), { status: 200 });
  }

  const points = challenge.points;

  // 7. Record the completion FIRST. The unique (user, challenge, week) constraint
  //    is the authoritative guard against concurrent double-awards: whichever
  //    writer loses the race (a second device, or a remount mid-flight) gets a
  //    23505 here and returns before ever reaching the points insert. Awarding
  //    points first — as this used to — let both racers insert points and only
  //    blocked the second completion, leaking a duplicate point transaction.
  const { data: completion, error: completionError } = await supabase
    .from('user_challenge_completions')
    .insert({
      user_id: user.id,
      challenge_id,
      challenge_week: challengeWeek,
      activity_type: challenge.category,
      points_awarded: points,
    })
    .select('id')
    .single();

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

  // 8. Award the challenge's fixed points (type 'earn' → counts toward XP/level).
  //    If this fails, compensate by removing the completion we just wrote so a
  //    later retry can re-award, rather than marking the user complete with no
  //    points (the safe failure direction).
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
    console.error('Failed to insert challenge points, rolling back completion:', ptError);
    await supabase.from('user_challenge_completions').delete().eq('id', completion.id);
    return new Response(JSON.stringify({ error: 'Failed to award points' }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ ok: true, completed: true, already_completed: false, points_awarded: points, challenge_id }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

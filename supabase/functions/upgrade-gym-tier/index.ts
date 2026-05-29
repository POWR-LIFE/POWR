// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
import { createClient } from '@supabase/supabase-js';

function gymStreakBonus(streak: number, base: number): number {
  if (streak >= 10) return Math.floor(base * 3.0) - base;
  if (streak >= 7)  return Math.floor(base * 2.0) - base;
  if (streak >= 5)  return Math.floor(base * 1.5) - base;
  if (streak >= 3)  return Math.floor(base * 1.2) - base;
  return 0;
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
  );

  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const { data: { user }, error: authError } = await userClient.auth.getUser(jwt);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { session_id: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  if (!body.session_id) {
    return new Response(JSON.stringify({ error: 'session_id required' }), { status: 400 });
  }

  // Dev test accounts bypass daily cap
  const DEV_TEST_EMAILS = new Set((Deno.env.get('DEV_TEST_EMAILS') ?? 'jamiemasonwright@gmail.com').split(',').map(e => e.trim()));
  const isDevTestUser = DEV_TEST_EMAILS.has(user.email ?? '');

  // Fetch session — must be gym type, belong to this user
  const { data: session, error: sessionError } = await supabase
    .from('activity_sessions')
    .select('id, user_id, type, started_at, duration_sec')
    .eq('id', body.session_id)
    .eq('user_id', user.id)
    .eq('type', 'gym')
    .single();

  if (sessionError || !session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
  }

  // Update session to actual elapsed time
  const now = new Date();
  const actualDurationSec = Math.round((now.getTime() - new Date(session.started_at).getTime()) / 1000);
  const actualMins = Math.floor(actualDurationSec / 60);

  if (actualMins < 45) {
    // DEV override: if DEV_MIN_UPGRADE_SEC is set, allow upgrades at a lower threshold
    const devMinUpgradeSec = parseInt(Deno.env.get('DEV_MIN_UPGRADE_SEC') ?? '0', 10);
    if (devMinUpgradeSec <= 0 || actualDurationSec < devMinUpgradeSec) {
      return new Response(JSON.stringify({ error: 'Session has not reached the 45-min tier' }), { status: 422 });
    }
    console.log(`[DEV] Allowing tier upgrade for short session (${actualDurationSec}s >= ${devMinUpgradeSec}s dev threshold)`);
  }

  await supabase
    .from('activity_sessions')
    .update({ ended_at: now.toISOString(), duration_sec: actualDurationSec })
    .eq('id', session.id);

  // Calculate target earnings at 45-min tier including streak multiplier
  const targetBase = 15;
  const { data: streak } = await supabase
    .from('user_streaks')
    .select('current_streak')
    .eq('user_id', user.id)
    .single();

  const currentStreak = streak?.current_streak ?? 0;
  const targetTotal = targetBase + gymStreakBonus(currentStreak, targetBase);

  // Sum what was already earned (earn type only — includes baked-in streak bonus from original claim)
  const { data: existing } = await supabase
    .from('point_transactions')
    .select('amount')
    .eq('session_id', session.id)
    .eq('type', 'earn');

  const alreadyEarned = (existing ?? []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
  const delta = targetTotal - alreadyEarned;

  if (delta <= 0) {
    return new Response(JSON.stringify({ ok: true, delta: 0, message: 'Already at max tier' }), { status: 200 });
  }

  // Check daily cap (30 for gym)
  const sessionDay = session.started_at.split('T')[0];
  const { data: todaySessions } = await supabase
    .from('activity_sessions')
    .select('id')
    .eq('user_id', user.id)
    .eq('type', 'gym')
    .gte('started_at', `${sessionDay}T00:00:00Z`)
    .lte('started_at', `${sessionDay}T23:59:59Z`);

  const todaySessionIds = (todaySessions ?? []).map((s: { id: string }) => s.id);
  let todayTotal = 0;
  if (todaySessionIds.length > 0) {
    const { data: todayTx } = await supabase
      .from('point_transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('type', 'earn')
      .in('session_id', todaySessionIds);
    todayTotal = (todayTx ?? []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
  }

  const remaining = 30 - todayTotal;
  if (!isDevTestUser && remaining <= 0) {
    return new Response(JSON.stringify({ error: 'Daily cap reached' }), { status: 422 });
  }

  const finalDelta = Math.min(delta, isDevTestUser ? delta : remaining);

  const { data: tx, error: txError } = await supabase
    .from('point_transactions')
    .insert({
      user_id: user.id,
      session_id: session.id,
      amount: finalDelta,
      type: 'earn',
      description: 'gym session upgrade (45min)',
      multiplier: 1.0,
    })
    .select()
    .single();

  if (txError) {
    // 23505 = unique violation on (session_id, description) — a concurrent upgrade
    // already inserted the 'gym session upgrade (45min)' row. The delta check above
    // is not atomic, so two simultaneous calls can both compute a positive delta;
    // the DB index is the backstop. Treat the loser as a no-op success.
    if ((txError as { code?: string }).code === '23505') {
      return new Response(JSON.stringify({ ok: true, delta: 0, message: 'Upgrade already recorded' }), { status: 200 });
    }
    console.error('[upgrade-gym-tier] Transaction insert failed:', txError);
    return new Response(JSON.stringify({ error: 'Failed to record upgrade' }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ ok: true, delta: finalDelta, transaction_id: tx.id }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

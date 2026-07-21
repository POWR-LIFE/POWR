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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Parse body before auth — the relay leg carries user_id in it.
  let body: { session_id: string; user_id?: string; visit_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  if (!body.session_id) {
    return new Response(JSON.stringify({ error: 'session_id required' }), { status: 400 });
  }

  // Two auth legs, mirroring claim-points: the app's user JWT (verified in-code),
  // or relay_gym_upgrade's resolve-token + explicit user_id — the background
  // path, where a client functions.invoke never arrives but REST does
  // (2026-07-14). Session ownership below re-verifies against the same user_id.
  const relayToken = req.headers.get('x-resolve-token');
  const viaRelay = relayToken != null;
  let user: { id: string; email?: string };
  if (viaRelay) {
    const { data: valid } = await supabase.rpc('verify_resolve_token', { p_token: relayToken });
    if (valid !== true || !body.user_id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    const { data: got, error: adminError } = await supabase.auth.admin.getUserById(body.user_id);
    if (adminError || !got?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    user = got.user;
  } else {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401 });
    }
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user: jwtUser }, error: authError } = await userClient.auth.getUser(jwt);
    if (authError || !jwtUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    user = jwtUser;
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

  // A relayed upgrade can't rely on the client to mark the visit (the device may
  // be frozen in Doze) — record it on the beacon here so upgrade nudges stop.
  // Mirrors mark_gym_visit_progress; the upgraded_at guard keeps it idempotent
  // against the client's own later mark. Called on every ok outcome, matching the
  // client contract (markGymVisitProgress fires on any successful upgrade call).
  const markVisitUpgraded = async () => {
    if (!viaRelay || !body.visit_id) return;
    try {
      const nowIso = new Date().toISOString();
      const { data: marked } = await supabase
        .from('gym_visits')
        .update({ status: 'upgraded', upgraded_at: nowIso, last_confirmed_at: nowIso })
        .eq('id', body.visit_id)
        .eq('user_id', user.id)
        .is('upgraded_at', null)
        .select('id');
      if ((marked ?? []).length > 0) {
        await supabase.from('gym_visit_events').insert({
          visit_id: body.visit_id, user_id: user.id, event: 'upgraded',
          detail: { session_id: session.id, via: 'relay' },
        });
      }
    } catch (visitErr) {
      console.warn('[upgrade-gym-tier] relay visit mark failed:', visitErr);
    }
  };

  // Loose sanity backstop on a recorded gym dwell — keep in sync with GeofenceContext.
  // A 40-min upgrade firing late (app reopened hours later, or a delayed EXIT)
  // must not overwrite duration_sec with an impossible entry→now wall-clock.
  // 12 h covers all-day events; the client reconciles the true length against GPS
  // presence + the health store. The 40-min tier GATE below still uses real
  // entry→now elapsed (anti-abuse), independent of this display backstop.
  const MAX_GYM_SESSION_SEC = 12 * 60 * 60; // 12 h backstop

  // Update session to actual elapsed time (capped)
  const now = new Date();
  const startedMs = new Date(session.started_at).getTime();
  const actualDurationSec = Math.min(
    Math.round((now.getTime() - startedMs) / 1000),
    MAX_GYM_SESSION_SEC,
  );
  const actualMins = Math.floor(actualDurationSec / 60);

  // Admin-tunable upgrade-tier threshold (system_config → gym_upgrade_minutes,
  // default 40). Keep in sync with claim-points calcBasePoints — this is the
  // authoritative gate; the client timer/copy read the same row.
  let upgradeMin = 40;
  {
    const { data: cfg } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'gym_upgrade_minutes')
      .maybeSingle();
    const parsed = parseInt(cfg?.value ?? '', 10);
    if (Number.isFinite(parsed) && parsed > 0) upgradeMin = parsed;
  }

  if (actualMins < upgradeMin) {
    // DEV-TEST-ONLY override: when DEV_MIN_UPGRADE_SEC is set, a dev-test account can
    // upgrade to the upgrade tier at a lower threshold (test without a real full
    // dwell). Gated on isDevTestUser so a real user can NEVER upgrade early even if
    // the env var is left set in production — the env var alone is not enough.
    const devMinUpgradeSec = parseInt(Deno.env.get('DEV_MIN_UPGRADE_SEC') ?? '0', 10);
    if (!isDevTestUser || devMinUpgradeSec <= 0 || actualDurationSec < devMinUpgradeSec) {
      return new Response(JSON.stringify({ error: `Session has not reached the ${upgradeMin}-min tier` }), { status: 422 });
    }
    console.log(`[DEV] Allowing tier upgrade for short session (${actualDurationSec}s >= ${devMinUpgradeSec}s dev threshold)`);
  }

  // Derive ended_at from the capped duration so the row stays internally consistent
  // (started_at + duration). When uncapped this equals `now`, as before.
  const endedAt = new Date(startedMs + actualDurationSec * 1000);
  await supabase
    .from('activity_sessions')
    .update({ ended_at: endedAt.toISOString(), duration_sec: actualDurationSec })
    .eq('id', session.id);

  // Calculate target earnings at the upgrade tier including streak multiplier
  const targetBase = 20;
  const { data: streak } = await supabase
    .from('user_streaks')
    .select('current_streak')
    .eq('user_id', user.id)
    .single();

  const currentStreak = streak?.current_streak ?? 0;
  const targetTotal = targetBase + gymStreakBonus(currentStreak, targetBase);

  // Sum what was already earned for this session — BOTH rows. claim-points
  // splits the award into a base 'earn' row and a separate 'streak' row;
  // counting only 'earn' here re-paid the streak share inside the upgrade
  // delta, a third copy of the same bonus.
  const { data: existing } = await supabase
    .from('point_transactions')
    .select('amount')
    .eq('session_id', session.id)
    .in('type', ['earn', 'streak']);

  const alreadyEarned = (existing ?? []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
  const delta = targetTotal - alreadyEarned;

  if (delta <= 0) {
    await markVisitUpgraded();
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
      // Streak rows spend the same daily cap as earn rows — same rule as
      // claim-points' own headroom check.
      .in('type', ['earn', 'streak'])
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
      // The "(Xmin)" suffix is parsed by the ledger's "+X MIN" badge, and the
      // (session_id, description) unique index dedupes concurrent upgrades —
      // the threshold rarely changes mid-session, so the string stays stable.
      description: `gym session upgrade (${upgradeMin}min)`,
      multiplier: 1.0,
    })
    .select()
    .single();

  if (txError) {
    // 23505 = unique violation on (session_id, description) — a concurrent upgrade
    // already inserted the 'gym session upgrade (Xmin)' row. The delta check above
    // is not atomic, so two simultaneous calls can both compute a positive delta;
    // the DB index is the backstop. Treat the loser as a no-op success.
    if ((txError as { code?: string }).code === '23505') {
      await markVisitUpgraded();
      return new Response(JSON.stringify({ ok: true, delta: 0, message: 'Upgrade already recorded' }), { status: 200 });
    }
    console.error('[upgrade-gym-tier] Transaction insert failed:', txError);
    return new Response(JSON.stringify({ error: 'Failed to record upgrade' }), { status: 500 });
  }

  await markVisitUpgraded();

  // Push the 40-min tier bonus. Until now this path was silent — only the
  // initial claim (claim-points) notified — so the "stay 40m to unlock +X"
  // promise in the app was never confirmed. Best-effort: a notification failure
  // must never fail an upgrade whose points are saved. We read the delivery
  // outcome so the client can fire an on-device fallback when the server
  // genuinely couldn't land it (mirrors the claim-points contract).
  let pushDelivered = true;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        target_user_id: user.id,
        type: 'session_upgraded',
        payload: { session_id: session.id, earned: finalDelta, upgrade_minutes: upgradeMin },
      }),
    });
    const pushBody = await pushRes.json().catch(() => null);
    if (pushBody) {
      pushDelivered = pushBody.skipped
        ? pushBody.reason !== 'no_tokens'
        : Number(pushBody?.result?.queued ?? 0) > 0;
    }
  } catch (notifErr) {
    pushDelivered = false;
    console.warn('[upgrade-gym-tier] session_upgraded notification failed:', notifErr);
  }

  return new Response(
    JSON.stringify({ ok: true, delta: finalDelta, transaction_id: tx.id, earned: finalDelta, push_delivered: pushDelivered }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

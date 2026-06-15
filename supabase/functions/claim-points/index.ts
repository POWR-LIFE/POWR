// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type ActivityType = 'walking' | 'running' | 'cycling' | 'swimming' | 'gym' | 'hiit' | 'sports' | 'yoga' | 'dance' | 'sleep';

interface ClaimRequest {
  session_id: string;
}

interface ActivitySession {
  id: string;
  user_id: string;
  type: ActivityType;
  duration_sec: number;
  distance_m: number | null;
  steps: number | null;
  hr_avg: number | null;
  hr_zone_pct: number | null;
  verification: string;
  trust_score: number;
  flagged: boolean;
  device_id: string | null;
  started_at: string;
}

interface UserStreak {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_activity_date: string | null;
  freeze_tokens: number;
}

// ─────────────────────────────────────────────
// Point calculation tables (mirrors POWR_Points_Logic.md)
// ─────────────────────────────────────────────

const DAILY_CAPS: Record<ActivityType, number> = {
  walking:  5,
  running:  10,
  cycling:  10,
  swimming: 10,
  gym:      30,
  hiit:     10,
  sports:   10,
  yoga:     6,
  dance:    8,
  sleep:    5,
};

function calcBasePoints(session: ActivitySession): number {
  const mins = Math.floor(session.duration_sec / 60);
  const dist = session.distance_m ?? 0;
  const steps = session.steps ?? 0;

  switch (session.type) {
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
      if (dist >= 2000 || mins >= 40) return 9;
      if (dist >= 1000 || mins >= 20) return 7;
      if (dist >= 500  || mins >= 15) return 5;
      return 0;

    case 'gym':
      if (mins >= 40) return 20;
      if (mins >= 30) return 15;
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
      if (mins >= 20) return 5;
      return 0;

    case 'sleep': {
      // Sleep is measured by duration_sec (total sleep time)
      const hours = mins / 60;
      if (hours >= 8) return 5;
      if (hours >= 7) return 4;
      if (hours >= 6) return 3;
      if (hours >= 5) return 2;
      if (hours >= 4) return 1;
      return 0;
    }

    default:
      return 0;
  }
}

function calcStreakBonus(type: ActivityType, streak: number, base: number): number {
  // Gym uses multipliers, not flat bonuses
  if (type === 'gym') {
    if (streak >= 10) return Math.floor(base * 3.0) - base;
    if (streak >= 7)  return Math.floor(base * 2.0) - base;
    if (streak >= 5)  return Math.floor(base * 1.5) - base;
    if (streak >= 3)  return Math.floor(base * 1.2) - base;
    return 0;
  }

  // No streak bonus for walking or sleep
  if (type === 'walking' || type === 'sleep') return 0;

  // Flat bonuses for running, cycling, swimming, hiit, yoga, dance
  const flatTypes: ActivityType[] = ['running', 'cycling', 'swimming', 'hiit', 'yoga', 'dance'];
  if (!flatTypes.includes(type)) return 0;

  if (streak >= 7 && ['running', 'cycling', 'swimming'].includes(type)) {
    return Math.floor(base * 1.5) - base;
  }
  if (streak >= 5) return 2;
  if (streak >= 3) return 1;
  return 0;
}

function updateStreakDay(streak: UserStreak, sessionDate: string): Partial<UserStreak> {
  const today = sessionDate.split('T')[0];
  const last = streak.last_activity_date;

  if (last === today) {
    // Already counted today — no change
    return {};
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split('T')[0];

  if (last === yStr) {
    // Consecutive day
    const newStreak = streak.current_streak + 1;
    return {
      current_streak: newStreak,
      longest_streak: Math.max(newStreak, streak.longest_streak),
      last_activity_date: today,
    };
  }

  // Streak broken
  return {
    current_streak: 1,
    last_activity_date: today,
  };
}

/**
 * Source-of-truth priority is geofence (0.94) > wearable (0.85) > manual (0.55).
 * When a geofence gym check-in is claimed, it's the authoritative record for that
 * time at the gym — remove any overlapping wearable/manual session of the same
 * type and reverse its points so we never double-count or let a lower-trust entry
 * stand alongside the check-in. Mirrors admin-review-session's reject: append a
 * compensating penalty (the ledger is append-only) then delete the session (FK is
 * ON DELETE SET NULL, so points are summed before deletion).
 */
async function supersedeLowerTrust(supabase, winner: ActivitySession): Promise<void> {
  const startMs = new Date(winner.started_at).getTime();
  const endMs = startMs + (winner.duration_sec ?? 0) * 1000;
  const windowStart = new Date(startMs - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(endMs + 24 * 60 * 60 * 1000).toISOString();

  const { data: lower } = await supabase
    .from('activity_sessions')
    .select('id, started_at, ended_at, duration_sec')
    .eq('user_id', winner.user_id)
    .eq('type', winner.type)
    .in('verification', ['wearable', 'manual'])
    .lt('trust_score', winner.trust_score)
    .gte('started_at', windowStart)
    .lte('started_at', windowEnd)
    .neq('id', winner.id);

  for (const s of lower ?? []) {
    const sStart = new Date(s.started_at).getTime();
    const sEnd = s.ended_at
      ? new Date(s.ended_at).getTime()
      : sStart + (s.duration_sec ?? 0) * 1000;
    if (!(startMs < sEnd && endMs > sStart)) continue; // no overlap

    const { data: earns } = await supabase
      .from('point_transactions')
      .select('amount')
      .eq('session_id', s.id)
      .eq('type', 'earn');
    const reversed = (earns ?? []).reduce((sum: number, t: { amount: number }) => sum + (t.amount ?? 0), 0);
    if (reversed > 0) {
      await supabase.from('point_transactions').insert({
        user_id: winner.user_id, amount: -reversed, type: 'penalty', multiplier: 1.0,
        description: `Superseded ${winner.type} by geofence check-in`,
      });
    }
    await supabase.from('activity_sessions').delete().eq('id', s.id);
    console.log(`[claim-points] superseded ${winner.type} ${s.started_at} (−${reversed} pts) — geofence check-in outranks`);
  }
}

// ─────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  // 1. Validate JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Verify the user's JWT
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  );
  
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const { data: { user }, error: authError } = await userClient.auth.getUser(jwt);
  
  if (authError || !user) {
    console.error('Auth error:', authError);
    return new Response(JSON.stringify({ error: 'Unauthorized', details: authError?.message }), { status: 401 });
  }

  // 2. Parse request body
  let body: ClaimRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  if (!body.session_id) {
    return new Response(JSON.stringify({ error: 'session_id required' }), { status: 400 });
  }

  // 3. Fetch the session — must belong to this user
  const { data: session, error: sessionError } = await supabase
    .from('activity_sessions')
    .select('*')
    .eq('id', body.session_id)
    .eq('user_id', user.id)
    .single<ActivitySession>();

  if (sessionError || !session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
  }

  // Dev test accounts bypass per-day limits so repeated testing is possible
  const DEV_TEST_EMAILS = new Set((Deno.env.get('DEV_TEST_EMAILS') ?? 'jamiemasonwright@gmail.com').split(',').map(e => e.trim()));
  const isDevTestUser = DEV_TEST_EMAILS.has(user.email ?? '');

  // 4. Check session hasn't already been claimed
  const { count: existingClaims } = await supabase
    .from('point_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', body.session_id);

  if ((existingClaims ?? 0) > 0) {
    return new Response(JSON.stringify({ error: 'Session already claimed' }), { status: 409 });
  }

  // 5. Trust score gate — manual logs below threshold flagged automatically
  const MIN_TRUST = 0.5;
  if (session.trust_score < MIN_TRUST) {
    return new Response(JSON.stringify({ error: 'Trust score too low' }), { status: 422 });
  }

  // 5b. Source-of-truth priority: a geofence check-in supersedes any overlapping
  // lower-trust (wearable/manual) session of the same type — remove them + reverse
  // their points before we score this one, so the check-in is the sole record.
  if (session.verification === 'geofence') {
    await supersedeLowerTrust(supabase, session);
  }

  // 6. Anti-abuse: rate limit — max 3 claims per hour (skipped for dev test accounts)
  if (!isDevTestUser) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentClaims } = await supabase
    .from('point_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('type', 'earn')
    .gte('created_at', oneHourAgo);

  if ((recentClaims ?? 0) >= 3) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 });
  }
  }

  // 7. Anti-abuse: duplicate detection — same activity type same day
  const sessionDay = session.started_at.split('T')[0];
  const { count: dupeCount } = await supabase
    .from('point_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('type', 'earn')
    .not('session_id', 'is', null)
    .gte('created_at', `${sessionDay}T00:00:00Z`)
    .lte('created_at', `${sessionDay}T23:59:59Z`);

  // Allow walking & sleep multiple times but flag same typed session for others
  if (session.type !== 'walking' && session.type !== 'sleep' && (dupeCount ?? 0) > 0) {
    const { count: typedDupe } = await supabase
      .from('activity_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('type', session.type)
      .gte('started_at', `${sessionDay}T00:00:00Z`)
      .lte('started_at', `${sessionDay}T23:59:59Z`)
      .neq('id', session.id);

    if ((typedDupe ?? 0) > 0) {
      // Flag but don't block — let the claim go through as a flagged transaction
      await supabase
        .from('activity_sessions')
        .update({ flagged: true, flag_reason: 'duplicate' })
        .eq('id', session.id);
    }
  }

  // 7b. Device-anomaly check — flag if 3+ distinct devices in the past 7 days
  if (session.device_id) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentDevices } = await supabase
      .from('activity_sessions')
      .select('device_id')
      .eq('user_id', user.id)
      .not('device_id', 'is', null)
      .gte('started_at', sevenDaysAgo);

    const uniqueDevices = new Set((recentDevices ?? []).map((r: { device_id: string }) => r.device_id));
    if (uniqueDevices.size >= 3) {
      // Flag the session but allow the claim — this is a soft signal for review
      await supabase
        .from('activity_sessions')
        .update({ flagged: true, flag_reason: 'multi_device' })
        .eq('id', session.id);
    }
  }

  // 8. Calculate points
  let base = calcBasePoints(session);

  // ⚠️ DEV MODE: if DEV_MIN_DWELL_SEC is set, geofence-verified gym sessions meeting
  // that lower threshold qualify for base points (mirrors client-side MIN_DWELL_MS override).
  // Remove/unset DEV_MIN_DWELL_SEC before going to production.
  const devMinDwellSec = parseInt(Deno.env.get('DEV_MIN_DWELL_SEC') ?? '0', 10);
  if (base === 0 && devMinDwellSec > 0 && session.verification === 'geofence' && session.type === 'gym') {
    if (session.duration_sec >= devMinDwellSec) {
      base = 15; // minimum qualifying gym tier
      console.log(`[DEV] Awarded base gym points for short session (${session.duration_sec}s >= ${devMinDwellSec}s dev threshold)`);
    }
  }

  if (base === 0) {
    return new Response(JSON.stringify({ error: 'Session does not meet eligibility minimum' }), { status: 422 });
  }

  // Manual log penalty: 80% of tier, rounded down, no streak credit
  const isManual = session.verification === 'manual';
  if (isManual) {
    base = Math.floor(base * 0.8);
  }

  // Fetch streak for multiplier
  const { data: streak } = await supabase
    .from('user_streaks')
    .select('*')
    .eq('user_id', user.id)
    .single<UserStreak>();

  let streakBonus = 0;
  if (!isManual && streak) {
    streakBonus = calcStreakBonus(session.type, streak.current_streak, base);
  }

  // Check daily cap
  const cap = DAILY_CAPS[session.type as ActivityType];
  const earned = Math.min(base + streakBonus, cap);

  // 9. Check how much already earned today for THIS activity type specifically.
  // point_transactions has no type column, so we resolve it via the session join.
  const { data: todaySessions } = await supabase
    .from('activity_sessions')
    .select('id')
    .eq('user_id', user.id)
    .eq('type', session.type)
    .gte('started_at', `${sessionDay}T00:00:00Z`)
    .lte('started_at', `${sessionDay}T23:59:59Z`);

  const todaySessionIds = (todaySessions ?? []).map((s: { id: string }) => s.id);

  let todayTotal = 0;
  if (todaySessionIds.length > 0) {
    const { data: todayEarned } = await supabase
      .from('point_transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('type', 'earn')
      .in('session_id', todaySessionIds);
    todayTotal = (todayEarned ?? []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
  }

  const remaining = cap - todayTotal;

  if (!isDevTestUser && remaining <= 0) {
    return new Response(JSON.stringify({ error: 'Daily cap reached', cap }), { status: 422 });
  }

  const finalAmount = Math.min(earned, isDevTestUser ? cap : remaining);

  // 10. Insert point transaction (service role — bypasses RLS)
  const { data: tx, error: txError } = await supabase
    .from('point_transactions')
    .insert({
      user_id: user.id,
      session_id: session.id,
      amount: finalAmount,
      type: 'earn',
      description: `${session.type} session`,
      multiplier: streakBonus > 0 ? (base + streakBonus) / base : 1.0,
    })
    .select()
    .single();

  if (txError) {
    // 23505 = unique violation on (session_id, description) — a concurrent claim
    // for this same session already inserted the base row. The step-4 count check
    // is not atomic, so two simultaneous invocations can both pass it; the DB
    // index is the real backstop. Treat the loser of the race as already-claimed
    // rather than a 500 so the client's recordDwellSession surfaces completion
    // (the "Session already claimed" branch) instead of retrying.
    if ((txError as { code?: string }).code === '23505') {
      return new Response(JSON.stringify({ error: 'Session already claimed' }), { status: 409 });
    }
    console.error('Transaction insert failed:', txError);
    return new Response(JSON.stringify({ error: 'Failed to record transaction' }), { status: 500 });
  }

  // 11. Update streak (skip for manual logs)
  if (!isManual && streak) {
    const streakUpdate = updateStreakDay(streak, session.started_at);
    if (Object.keys(streakUpdate).length > 0) {
      await supabase
        .from('user_streaks')
        .update(streakUpdate)
        .eq('user_id', user.id);
    }

    // Insert streak bonus transaction if applicable
    if (streakBonus > 0) {
      await supabase.from('point_transactions').insert({
        user_id: user.id,
        session_id: session.id,
        amount: Math.min(streakBonus, remaining - finalAmount),
        type: 'streak',
        description: `${streak.current_streak}-day streak bonus`,
        multiplier: 1.0,
      });
    }
  }

  // 12. Session completed push — server-side for reliability (fires regardless of app/background state)
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        target_user_id: user.id,
        type: 'session_completed',
        payload: { session_id: session.id, earned: finalAmount },
      }),
    });
  } catch (notifErr) {
    console.warn('[claim-points] session_completed notification failed:', notifErr);
  }

  // 13. "Reward within reach" — returned (not pushed) so the client can schedule
  //     it as a spaced-out, daytime-clamped, once-per-day local notification
  //     instead of firing it back-to-back with the session push. To avoid
  //     nagging about every reward the user is near, we pick the single
  //     HIGHEST-VALUE still-locked reward they're at >=85% of: a user 85% to a
  //     big reward is already past 100% of the small ones, so the cheapest-first
  //     logic would point at a less aspirational target.
  const WITHIN_REACH_PCT = 0.85;
  let withinReach: { points_to_unlock: number; reward_name: string } | null = null;
  try {
    // Sum all earn/streak transactions to get current balance
    const { data: allTx } = await supabase
      .from('point_transactions')
      .select('amount')
      .eq('user_id', user.id)
      .in('type', ['earn', 'streak']);

    const newBalance = (allTx ?? []).reduce((s, t) => s + (t.amount ?? 0), 0);

    // Highest-cost active reward still locked (cost > balance) but within 85%
    // reach (cost <= balance / 0.85). Order by cost DESC → the biggest one near.
    const maxReachableCost = newBalance / WITHIN_REACH_PCT;
    const { data: target } = await supabase
      .from('rewards')
      .select('title, powr_cost')
      .eq('active', true)
      .gt('powr_cost', newBalance)
      .lte('powr_cost', maxReachableCost)
      .order('powr_cost', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (target) {
      // Respect the user's points_milestone preference — the client schedule
      // bypasses send-push-notification's server-side preference gate.
      const { data: pref } = await supabase
        .from('notification_preferences')
        .select('points_milestone')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!pref || pref.points_milestone !== false) {
        withinReach = {
          points_to_unlock: Math.ceil(target.powr_cost - newBalance),
          reward_name: target.title,
        };
      }
    }
  } catch (notifErr) {
    // Non-fatal — points were already saved successfully
    console.warn('[claim-points] within-reach computation failed:', notifErr);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      earned: finalAmount,
      streak_bonus: streakBonus,
      base,
      transaction_id: tx.id,
      within_reach: withinReach,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

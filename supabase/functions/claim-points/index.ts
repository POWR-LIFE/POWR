// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
import { createClient } from '@supabase/supabase-js';
import { geofenceSupersedes } from '../_shared/sessionPriority.ts';
import { streakFromSessions } from '../_shared/streak.ts';

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

// The STRENGTH LANE — gym and HIIT/classes score identically (product decision
// 2026-08-05). A user who trains hard shouldn't be paid less because their
// wearable, or the studio they went to, labelled it a class instead of a gym
// session. Same base tiers, same streak multipliers, same daily cap. Keep the
// three in step: DAILY_CAPS below, calcBasePoints, calcStreakBonus. Mirrored by
// enforce_point_award_cap (DB), app/manual-log.tsx and constants/activities.ts.
const STRENGTH_TYPES: ActivityType[] = ['gym', 'hiit'];

/** HIIT's own entry gate. Deliberately NOT the tunable gym dwell: a 20-min class
 *  is a real session and must keep earning, so the strength lane's floor is the
 *  lower of the two while everything above it is identical. */
const HIIT_MIN_MINUTES = 20;

const DAILY_CAPS: Record<ActivityType, number> = {
  walking:  5,
  running:  10,
  cycling:  10,
  swimming: 10,
  gym:      30,
  hiit:     30,
  sports:   10,
  yoga:     6,
  dance:    8,
  sleep:    5,
};

// gymDwellMin is the admin-tunable minutes required to lock in a base gym
// check-in point (system_config → min_gym_dwell_minutes, default 30).
// gymUpgradeMin is the admin-tunable upgrade-tier threshold (system_config →
// gym_upgrade_minutes, default 40) — keep in sync with upgrade-gym-tier.
function calcBasePoints(session: ActivitySession, gymDwellMin = 30, gymUpgradeMin = 40): number {
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
      // Upgrade tier only applies once the (tunable) entry gate is met, so
      // raising the dwell threshold above it can't be bypassed by the upgrade tier.
      if (mins >= gymUpgradeMin && mins >= gymDwellMin) return 20;
      if (mins >= gymDwellMin) return 15;
      return 0;

    case 'hiit':
      // Strength lane: the same 15/20 gym pays, off HIIT's own 20-min entry gate
      // (see STRENGTH_TYPES). The upgrade rung is the shared admin-tunable one so
      // a retune moves both together.
      if (mins >= gymUpgradeMin && mins >= HIIT_MIN_MINUTES) return 20;
      if (mins >= HIIT_MIN_MINUTES) return 15;
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
  // The strength lane (gym + HIIT) uses multipliers, not flat bonuses.
  if (STRENGTH_TYPES.includes(type)) {
    if (streak >= 10) return Math.floor(base * 3.0) - base;
    if (streak >= 7)  return Math.floor(base * 2.0) - base;
    if (streak >= 5)  return Math.floor(base * 1.5) - base;
    if (streak >= 3)  return Math.floor(base * 1.2) - base;
    return 0;
  }

  // No streak bonus for walking or sleep
  if (type === 'walking' || type === 'sleep') return 0;

  // Flat bonuses for running, cycling, swimming, yoga, dance
  const flatTypes: ActivityType[] = ['running', 'cycling', 'swimming', 'yoga', 'dance'];
  if (!flatTypes.includes(type)) return 0;

  if (streak >= 7 && ['running', 'cycling', 'swimming'].includes(type)) {
    return Math.floor(base * 1.5) - base;
  }
  if (streak >= 5) return 2;
  if (streak >= 3) return 1;
  return 0;
}

// Streak recompute now lives in ../_shared/streak.ts — single copy shared with
// send-push-notification, bridge-day aware for streak rescues. The session
// being claimed already exists in the table, so the recompute INCLUDES today.

/**
 * Source-of-truth priority is geofence (0.94) > wearable/health (0.85) > manual
 * (0.55). When a geofence gym check-in is claimed, it's the authoritative record
 * for that time at the gym — remove ANY overlapping lower-trust (wearable/health/
 * manual) workout and reverse its points so we never double-count or let a
 * lower-trust entry stand alongside the check-in. Type-agnostic on purpose: the same gym visit can be
 * logged by a wearable as cycling (stationary bike), hiit (a class), sports, yoga,
 * etc. — it's the same time at the gym, so it defers to the check-in regardless of
 * how the device classified it. This mirrors terra-webhook's overlapsGeofenceGym
 * (the reverse arrival order). Daily categories are excluded: `walking` (its
 * session spans the whole day) and `sleep` are independent of a gym visit and must
 * never be superseded by one. Mirrors admin-review-session's reject: append a
 * compensating penalty (the ledger is append-only) then delete the session (FK is
 * ON DELETE SET NULL, so points are summed before deletion).
 */
async function supersedeLowerTrust(supabase, winner: ActivitySession): Promise<void> {
  const startMs = new Date(winner.started_at).getTime();
  const endMs = startMs + (winner.duration_sec ?? 0) * 1000;
  // Bound the scan by day (±1d) for index use; the exact rule (overlap + trust +
  // type exclusion) is applied per-row by geofenceSupersedes so the predicate is
  // the single source of truth shared with the unit tests.
  const windowStart = new Date(startMs - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(endMs + 24 * 60 * 60 * 1000).toISOString();

  const { data: lower } = await supabase
    .from('activity_sessions')
    .select('id, type, verification, trust_score, started_at, ended_at, duration_sec')
    .eq('user_id', winner.user_id)
    .not('type', 'in', '("walking","sleep")')
    .in('verification', ['wearable', 'health', 'manual'])
    .lt('trust_score', winner.trust_score)
    .gte('started_at', windowStart)
    .lte('started_at', windowEnd)
    .neq('id', winner.id);

  for (const s of lower ?? []) {
    if (!geofenceSupersedes(winner, s)) continue; // not the same time at the gym

    const { data: earns } = await supabase
      .from('point_transactions')
      .select('amount')
      .eq('session_id', s.id)
      .eq('type', 'earn');
    const reversed = (earns ?? []).reduce((sum: number, t: { amount: number }) => sum + (t.amount ?? 0), 0);
    if (reversed > 0) {
      await supabase.from('point_transactions').insert({
        user_id: winner.user_id, amount: -reversed, type: 'penalty', multiplier: 1.0,
        description: `Superseded ${s.type} by geofence check-in`,
      });
    }
    await supabase.from('activity_sessions').delete().eq('id', s.id);
    console.log(`[claim-points] superseded ${s.type} ${s.started_at} (−${reversed} pts) — geofence check-in outranks`);
  }
}

// ─────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. Parse request body (before auth — the relay leg carries user_id in it)
  let body: ClaimRequest & { user_id?: string; visit_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  if (!body.session_id) {
    return new Response(JSON.stringify({ error: 'session_id required' }), { status: 400 });
  }

  // 2. Authenticate — two legs:
  //    (a) the app calls with the user's JWT (verified in-code);
  //    (b) relay_gym_claim (SECURITY DEFINER RPC → pg_net) calls with the shared
  //        resolve token + an explicit user_id — the background path. A client
  //        functions.invoke never arrives from a backgrounded Android app while
  //        its REST calls do (six field captures 2026-07-14), so the claim rides
  //        the REST path to the RPC and pg_net brings it here server-to-server.
  //        The RPC has already verified the session belongs to that user; the
  //        session ownership check below re-verifies against the same user_id.
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
      console.error('Relay auth error:', adminError);
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
      Deno.env.get('SUPABASE_ANON_KEY')!
    );
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user: jwtUser }, error: authError } = await userClient.auth.getUser(jwt);
    if (authError || !jwtUser) {
      // Detail stays in the server log only — an unauthenticated caller has no
      // business reading why the token failed.
      console.error('Auth error:', authError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    user = jwtUser;
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
  // lower-trust (wearable/health/manual) session — remove them + reverse their
  // points before we score this one, so the check-in is the sole record.
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
  // Admin-tunable gym thresholds (system_config → min_gym_dwell_minutes /
  // gym_upgrade_minutes). Read via the service client (bypasses RLS); these are
  // the authoritative gates. Fall back to the historical 30/40 on any failure.
  let gymDwellMin = 30;
  let gymUpgradeMin = 40;
  let vaultVestDays = 60;
  let vaultCapOverflowEnabled = true;
  {
    const { data: cfg } = await supabase
      .from('system_config')
      .select('key, value')
      .in('key', ['min_gym_dwell_minutes', 'gym_upgrade_minutes', 'vault_vest_days', 'vault_cap_overflow_enabled']);
    for (const row of cfg ?? []) {
      if (row.key === 'vault_cap_overflow_enabled') {
        vaultCapOverflowEnabled = String(row.value ?? '').trim().toLowerCase() !== 'false';
        continue;
      }
      const parsed = parseInt(row.value ?? '', 10);
      if (!Number.isFinite(parsed) || parsed <= 0) continue;
      if (row.key === 'min_gym_dwell_minutes') gymDwellMin = parsed;
      if (row.key === 'gym_upgrade_minutes') gymUpgradeMin = parsed;
      if (row.key === 'vault_vest_days') vaultVestDays = parsed;
    }
  }
  let base = calcBasePoints(session, gymDwellMin, gymUpgradeMin);

  // DEV-TEST-ONLY: when DEV_MIN_DWELL_SEC is set, a geofence gym session meeting
  // that lower threshold qualifies for base points so we can test check-ins without
  // a real 30-min dwell. Gated on isDevTestUser so it can NEVER award points to a
  // real user even if the env var is left set in production — the env var alone is
  // not enough. (Real prod requirement stays the 30-min calcBasePoints tier.)
  const devMinDwellSec = parseInt(Deno.env.get('DEV_MIN_DWELL_SEC') ?? '0', 10);
  if (base === 0 && isDevTestUser && devMinDwellSec > 0 && session.verification === 'geofence' && session.type === 'gym') {
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

  // Fetch the streak row (kept for longest_streak + freeze_tokens).
  const { data: streak } = await supabase
    .from('user_streaks')
    .select('*')
    .eq('user_id', user.id)
    .single<UserStreak>();

  // True current streak, recomputed from activity_sessions (includes today's
  // session, which already exists) rather than the stored/increment-based value
  // that a backdated or out-of-order claim could leave wrong. This is the same
  // basis the app's card + send-push use, so the multiplier awarded here matches
  // the projected points the user was shown.
  let currentStreak = streak?.current_streak ?? 0;
  let streakBonus = 0;
  if (!isManual) {
    currentStreak = await streakFromSessions(supabase, user.id);
    if (streak) {
      streakBonus = calcStreakBonus(session.type, currentStreak, base);
    }
  }

  // Check daily cap. The cap applies to the session's TOTAL award — base plus
  // streak — so "already earned today" must count BOTH row types below: the
  // bonus lives in its own 'streak' row so the ledger can show it, and summing
  // only 'earn' rows here let streak rows ride past the cap uncounted.
  const cap = DAILY_CAPS[session.type as ActivityType];

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
      .in('type', ['earn', 'streak'])
      .in('session_id', todaySessionIds);
    todayTotal = (todayEarned ?? []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
  }

  const remaining = cap - todayTotal;

  if (!isDevTestUser && remaining <= 0) {
    return new Response(JSON.stringify({ error: 'Daily cap reached', cap }), { status: 422 });
  }

  // ⚠ The earn row is BASE ONLY. It used to carry min(base + streakBonus, cap)
  // while step 11 wrote the streak bonus AGAIN as its own row clamped only to
  // the cap headroom — so any session with headroom left paid the bonus twice
  // (gym ×1.2: an 18-pt earn row plus a 3-pt streak row for an intended 18).
  // One value, one row: base here, the whole bonus in the streak row, and the
  // daily cap enforced across the pair.
  const baseCredited = Math.min(base, isDevTestUser ? cap : remaining);

  // 10. Insert point transaction (service role — bypasses RLS)
  const { data: tx, error: txError } = await supabase
    .from('point_transactions')
    .insert({
      user_id: user.id,
      session_id: session.id,
      amount: baseCredited,
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

  // 11. Persist the recomputed streak (skip for manual logs)
  let streakCredited = 0;
  if (!isManual && streak) {
    await supabase
      .from('user_streaks')
      .update({
        current_streak: currentStreak,
        longest_streak: Math.max(currentStreak, streak.longest_streak ?? 0),
        last_activity_date: sessionDay,
      })
      .eq('user_id', user.id);

    // The streak row carries the WHOLE bonus (the earn row above is base only),
    // clamped to the headroom the base row left. Guard on the clamped amount —
    // when the base row alone fills the daily cap this would otherwise write a
    // 0-pt STREAK row that renders red in the ledger. Dev test users are
    // cap-exempt on this leg just as they are on the base one.
    const streakAmount = isDevTestUser
      ? streakBonus
      : Math.min(streakBonus, Math.max(0, remaining - baseCredited));
    if (streakAmount > 0) {
      const { error: streakErr } = await supabase.from('point_transactions').insert({
        user_id: user.id,
        session_id: session.id,
        amount: streakAmount,
        type: 'streak',
        description: `${currentStreak}-day streak bonus`,
        multiplier: 1.0,
      });
      // A failed insert must not count as credited — leaving streakCredited at
      // 0 hands the un-paid bonus to the overflow calc below, which vaults it
      // instead of letting it silently vanish.
      if (streakErr) {
        console.warn('[claim-points] streak insert failed:', streakErr);
      } else {
        streakCredited = streakAmount;
      }
    }
  }

  // 11a. Vault the merit the daily cap clamped away. Only BONUS value ever
  // lands here (base is always credited first, so overflow is the streak
  // multiplier / cap clamp remainder) — it counts toward level immediately via
  // vault_deposits but only becomes spendable when it vests. Manual logs are
  // excluded: they're the penalised, un-verified path and vaulting their
  // overflow would soften the manual cap. Best-effort — a vault failure must
  // never fail a claim that already credited.
  const overflow = isManual || !vaultCapOverflowEnabled
    ? 0
    : Math.max(0, base + streakBonus - baseCredited - streakCredited);
  let vaulted = 0;
  if (overflow > 0) {
    const { error: vaultErr } = await supabase.from('vault_deposits').insert({
      user_id: user.id,
      session_id: session.id,
      amount: overflow,
      source: 'cap_overflow',
      description: streakBonus > 0
        ? `${currentStreak}-day streak · ${session.type} over the daily cap`
        : `${session.type} over the daily cap`,
      vests_at: new Date(Date.now() + vaultVestDays * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (vaultErr) {
      console.warn('[claim-points] vault deposit failed:', vaultErr);
    } else {
      vaulted = overflow;
    }
  }

  // 11b. ANY successful claim must mark the beacon's visit — not just the relay
  // path. The client's own mark_gym_visit_progress round-trip is the least
  // reliable call in the chain: it runs after the claim, in whatever remains of
  // a background execution window (field 2026-08-03: a direct claim landed at
  // t+31 min while its visit stayed 'open' and collected dwell nudges for
  // another hour). Direct claims don't carry a visit_id, so fall back to the
  // caller's open visit at the session's partner. The status='open' guard keeps
  // it idempotent against the client's own later mark.
  if (body.visit_id || session.partner_id) {
    try {
      const nowIso = new Date().toISOString();
      let mark = supabase
        .from('gym_visits')
        .update({ status: 'claimed', claimed_session_id: session.id, claimed_at: nowIso, last_confirmed_at: nowIso })
        .eq('user_id', user.id)
        .eq('status', 'open');
      mark = body.visit_id ? mark.eq('id', body.visit_id) : mark.eq('partner_id', session.partner_id);
      const { data: marked } = await mark.select('id');
      for (const row of marked ?? []) {
        await supabase.from('gym_visit_events').insert({
          visit_id: row.id, user_id: user.id, event: 'claimed',
          detail: { session_id: session.id, via: viaRelay ? 'relay' : 'direct' },
        });
      }
    } catch (visitErr) {
      console.warn('[claim-points] visit mark failed:', visitErr);
    }
  }

  // 11c. The background-exit class: points that settle AT or AFTER the exit
  // reach here after closeGymVisit already moved the visit out of 'open' —
  // the status='open' stamp above misses it, claimed_session_id stays null,
  // and the beacon's "Session complete" pass (keyed on claimed_session_id)
  // never fires for exactly the sessions that settle on the way out (iOS
  // force-quit exit-claims chief among them; 2026-08-06 audit gap #3). Stamp
  // the ended, still-unclaimed visit WITHOUT touching its exit status —
  // idempotency rides claimed_session_id IS NULL. Bounded to visits ended in
  // the last 6h so a partner-fallback stamp can never resurrect ancient
  // history into the complete-push window.
  if (session.verification === 'geofence' && (body.visit_id || session.partner_id)) {
    try {
      const nowIso = new Date().toISOString();
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      let lateMark = supabase
        .from('gym_visits')
        .update({ claimed_session_id: session.id, claimed_at: nowIso })
        .eq('user_id', user.id)
        .neq('status', 'open')
        .is('claimed_session_id', null)
        .not('ended_at', 'is', null)
        .gte('ended_at', sixHoursAgo);
      lateMark = body.visit_id ? lateMark.eq('id', body.visit_id) : lateMark.eq('partner_id', session.partner_id);
      const { data: lateMarked } = await lateMark.select('id');
      for (const row of lateMarked ?? []) {
        await supabase.from('gym_visit_events').insert({
          visit_id: row.id, user_id: user.id, event: 'claimed',
          detail: { session_id: session.id, via: viaRelay ? 'relay' : 'direct', late_stamp: true },
        });
      }
    } catch (visitErr) {
      console.warn('[claim-points] late visit mark failed:', visitErr);
    }
  }

  // 12. Session completed push — server-side for reliability (fires regardless of app/background state).
  //     We read the delivery outcome so the client can fire an on-device fallback
  //     ONLY when the server genuinely couldn't land it (no live token / send
  //     failed). push_delivered stays true when the user opted out, so the
  //     fallback never overrides a mute or double-notifies.
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
        type: 'session_completed',
        payload: { session_id: session.id, earned: baseCredited + streakCredited },
      }),
    });
    const pushBody = await pushRes.json().catch(() => null);
    if (pushBody) {
      // skipped:no_tokens → nothing landed (fire local); skipped:user_preference
      // → intentionally suppressed (respect it, no local). Otherwise delivered iff
      // Expo queued at least one ticket.
      pushDelivered = pushBody.skipped
        ? pushBody.reason !== 'no_tokens'
        : Number(pushBody?.result?.queued ?? 0) > 0;
    }
  } catch (notifErr) {
    // Couldn't even reach send-push — the client should fire its local fallback.
    pushDelivered = false;
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
      .select('id, title, powr_cost')
      .eq('active', true)
      .gt('powr_cost', newBalance)
      .lte('powr_cost', maxReachableCost)
      .order('powr_cost', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (target) {
      // Remember which reward we're steering the user toward, so the
      // reward_unlocked push (ledger trigger) finishes the SAME story when
      // several rewards unlock in one balance jump. Persisted regardless of
      // the nudge preference below — it names the unlock, it never pushes.
      await supabase.from('user_reward_targets').upsert({
        user_id: user.id,
        reward_id: target.id,
        reward_name: target.title,
        powr_cost: target.powr_cost,
        named_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
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
      // Total actually credited this claim (base row + streak row). The two
      // are separate ledger rows now, but callers read one number.
      earned: baseCredited + streakCredited,
      streak_bonus: streakBonus,
      vaulted,
      base,
      transaction_id: tx.id,
      within_reach: withinReach,
      push_delivered: pushDelivered,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

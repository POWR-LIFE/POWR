// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
import { createClient } from '@supabase/supabase-js';
import { recordedGymDurationSec, MAX_GYM_SESSION_SEC } from '../_shared/gymDuration.ts';

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
        // Never resurrect a visit that has already ended. Without this, a late
        // relay flips a closed/abandoned row back to 'upgraded' — 10 rows now carry
        // 'upgraded' with ended_at set, which is part of why `status` stopped
        // meaning anything. A finished visit needs no upgrade nudges stopped.
        .is('ended_at', null)
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

  const now = new Date();
  const startedMs = new Date(session.started_at).getTime();

  // The visit carries the two facts this function needs and the session row does
  // not: when the device last PROVED presence, and whether the visit is over.
  // Read once, before markVisitUpgraded() can stamp last_confirmed_at = now().
  let presenceSec: number | null = null;
  let visitEndSec: number | null = null;
  {
    let visitQuery = supabase
      .from('gym_visits')
      .select('last_confirmed_at, last_proven_at, ended_at')
      .eq('user_id', user.id)
      // nullsFirst:false — a DESC order puts NULLs first in Postgres, which would
      // pick an unconfirmed duplicate over the row that actually has evidence.
      .order('last_confirmed_at', { ascending: false, nullsFirst: false })
      .limit(1);
    visitQuery = body.visit_id
      ? visitQuery.eq('id', body.visit_id)
      : visitQuery.eq('claimed_session_id', session.id);
    const { data: visit, error: visitError } = await visitQuery.maybeSingle();
    if (visitError) {
      console.error('[upgrade-gym-tier] gym_visits lookup failed:', visitError);
      return new Response(JSON.stringify({ error: 'Failed to verify visit state' }), { status: 500 });
    }
    // last_proven_at first: same meaning, one writer, and it only moves on a fix
    // that would pass fixCreditsPresence. last_confirmed_at is the fallback for
    // rows written before that column existed (2026-08-10) — it is the weaker
    // evidence, which is exactly why recordedGymDurationSec takes the MIN of
    // everything rather than a priority order.
    const provenAt = visit?.last_proven_at ?? visit?.last_confirmed_at;
    if (provenAt) {
      const sec = Math.round((new Date(provenAt).getTime() - startedMs) / 1000);
      if (sec > 0) presenceSec = sec;
    }
    if (visit?.ended_at) {
      const sec = Math.round((new Date(visit.ended_at).getTime() - startedMs) / 1000);
      if (sec > 0) visitEndSec = sec;
    }
  }

  // ELIGIBILITY input — "did they stay past the tier?".
  //
  // While the visit is LIVE that question is open, so entry→now is the honest
  // answer and the behaviour is unchanged. Once the visit has ENDED the answer is
  // known and fixed, and entry→now is simply wrong: it keeps growing forever, so
  // a 32-minute visit would eventually cross the 40-minute gate on its own. That
  // is the phantom upgrade the single-shot retry design was protecting against,
  // and it is why gym-visit-beacon could not retry the bonus after the exit.
  // Bounding the gate by the visit's real length is what makes that retry safe
  // (see the companion change in gym-visit-beacon dueVisits).
  //
  // Deliberately NOT bounded by session.duration_sec: this function overwrites
  // that column a few lines below, so gating on it would be circular — and it can
  // legitimately be short (the too_short row written mid-session).
  const elapsedSec = Math.min(
    Math.round((now.getTime() - startedMs) / 1000),
    visitEndSec ?? Number.MAX_SAFE_INTEGER,
    MAX_GYM_SESSION_SEC,
  );
  const actualMins = Math.floor(elapsedSec / 60);

  // Admin-tunable upgrade-tier threshold (system_config → gym_upgrade_minutes,
  // default 40). Keep in sync with claim-points calcBasePoints — this is the
  // authoritative gate; the client timer/copy read the same row. Vault config is
  // read alongside: the cap-clamped share of the upgrade banks into the Vault
  // (same model as claim-points 11a) instead of silently evaporating.
  let upgradeMin = 40;
  let vaultVestDays = 60;
  let vaultCapOverflowEnabled = true;
  {
    const { data: cfg } = await supabase
      .from('system_config')
      .select('key, value')
      .in('key', ['gym_upgrade_minutes', 'vault_vest_days', 'vault_cap_overflow_enabled']);
    for (const row of cfg ?? []) {
      if (row.key === 'vault_cap_overflow_enabled') {
        vaultCapOverflowEnabled = String(row.value ?? '').trim().toLowerCase() !== 'false';
        continue;
      }
      const parsed = parseInt(row.value ?? '', 10);
      if (!Number.isFinite(parsed) || parsed <= 0) continue;
      if (row.key === 'gym_upgrade_minutes') upgradeMin = parsed;
      if (row.key === 'vault_vest_days') vaultVestDays = parsed;
    }
  }

  // ── What we STORE is not what we GATE on. See _shared/gymDuration.ts for the
  // rule and why it takes the weakest bound. presenceSec was read above, before
  // markVisitUpgraded() could stamp last_confirmed_at = now().
  const recordedSec = recordedGymDurationSec({
    elapsedSec,
    presenceSec,
    recordedSec: session.duration_sec,
    upgradeMin,
  });

  if (actualMins < upgradeMin) {
    // DEV-TEST-ONLY override: when DEV_MIN_UPGRADE_SEC is set, a dev-test account can
    // upgrade to the upgrade tier at a lower threshold (test without a real full
    // dwell). Gated on isDevTestUser so a real user can NEVER upgrade early even if
    // the env var is left set in production — the env var alone is not enough.
    const devMinUpgradeSec = parseInt(Deno.env.get('DEV_MIN_UPGRADE_SEC') ?? '0', 10);
    if (!isDevTestUser || devMinUpgradeSec <= 0 || elapsedSec < devMinUpgradeSec) {
      return new Response(JSON.stringify({ error: `Session has not reached the ${upgradeMin}-min tier` }), { status: 422 });
    }
    console.log(`[DEV] Allowing tier upgrade for short session (${elapsedSec}s >= ${devMinUpgradeSec}s dev threshold)`);
  }

  // Derive ended_at from the recorded duration so the row stays internally
  // consistent (started_at + duration). GROWS-ONLY, like the exit close's
  // greatest() guard (20260808095300): recordedSec is an estimate, and on a
  // post-close replay its tier floor can come in BELOW the exit close's real
  // length — field 2026-08-11, a replayed upgrade mark rewrote a closed 3276 s
  // session back to 2400 s and dragged ended_at with it (#345). The duration_sec
  // filter repeats the guard inside the UPDATE so a close that grew the row
  // after our read can't be shrunk either; equality is skipped for free.
  if (recordedSec > (session.duration_sec ?? 0)) {
    const endedAt = new Date(startedMs + recordedSec * 1000);
    await supabase
      .from('activity_sessions')
      .update({ ended_at: endedAt.toISOString(), duration_sec: recordedSec })
      .eq('id', session.id)
      .or(`duration_sec.is.null,duration_sec.lt.${recordedSec}`);
    console.log(
      `[upgrade-gym-tier] duration ${session.duration_sec}s → ${recordedSec}s ` +
      `(elapsed ${elapsedSec}s, presence ${presenceSec ?? 'none'})`,
    );
  }

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

  // …and what was already BANKED for it. claim-points vaults the cap-clamped
  // share of the initial award (11a); leaving those deposits out of the delta
  // would pay that same merit a second time here — the vault-flavoured cousin
  // of the "third copy of the streak bonus" bug the earn/streak sum above fixed.
  const { data: existingVault } = await supabase
    .from('vault_deposits')
    .select('amount')
    .eq('session_id', session.id);

  const alreadyEarned = (existing ?? []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
  const alreadyVaulted = (existingVault ?? []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
  const delta = targetTotal - alreadyEarned - alreadyVaulted;

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

  // The daily cap gates SPENDABLE credit only. The clamped share of the upgrade
  // is real, location-proven merit and banks into the Vault (mirrors claim-points
  // 11a) — before this, a capped user's upgrade 422'd here and the delta silently
  // evaporated, which for a 3× streak was most of the tier's value. FIELD-CAUGHT
  // 2026-07-30: an 83-min iOS session claimed at the 15 tier mid-session had its
  // relayed exit upgrade (delta 15) dropped at this line with "Daily cap reached".
  const headroom = isDevTestUser ? delta : Math.max(0, 30 - todayTotal);
  const finalDelta = Math.min(delta, headroom);
  const vaultAmount = isDevTestUser || !vaultCapOverflowEnabled ? 0 : delta - finalDelta;

  if (finalDelta <= 0 && vaultAmount <= 0) {
    // Vault switched off and no headroom — the pre-vault behaviour, unchanged.
    return new Response(JSON.stringify({ error: 'Daily cap reached' }), { status: 422 });
  }

  let txId: string | null = null;
  if (finalDelta > 0) {
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
      // the DB index is the backstop. Treat the loser as a no-op success — the
      // winner also owns the vault leg, so the loser must not fall through to it.
      if ((txError as { code?: string }).code === '23505') {
        await markVisitUpgraded();
        return new Response(JSON.stringify({ ok: true, delta: 0, message: 'Upgrade already recorded' }), { status: 200 });
      }
      console.error('[upgrade-gym-tier] Transaction insert failed:', txError);
      return new Response(JSON.stringify({ error: 'Failed to record upgrade' }), { status: 500 });
    }
    txId = tx.id;
  }

  // Bank the clamped share. Its own (session_id, description) arbiter
  // (vault_deposits_session_desc_uidx) makes the vault-only path — which has no
  // earn-row arbiter to lose — idempotent too: 23505 = already banked, no-op.
  // Best-effort beyond that: a vault failure must never fail an upgrade whose
  // spendable share is already saved (claim-points' stance).
  let vaulted = 0;
  let vestsAt: string | null = null;
  if (vaultAmount > 0) {
    vestsAt = new Date(Date.now() + vaultVestDays * 24 * 60 * 60 * 1000).toISOString();
    const { error: vaultErr } = await supabase.from('vault_deposits').insert({
      user_id: user.id,
      session_id: session.id,
      amount: vaultAmount,
      source: 'cap_overflow',
      description: `gym session upgrade (${upgradeMin}min) · over the daily cap`,
      vests_at: vestsAt,
    });
    if (vaultErr) {
      if ((vaultErr as { code?: string }).code !== '23505') {
        console.warn('[upgrade-gym-tier] vault deposit failed:', vaultErr);
      }
    } else {
      vaulted = vaultAmount;
    }
  }

  await markVisitUpgraded();

  if (finalDelta <= 0) {
    // Vault-only outcome. This used to return here in silence, on the reasoning
    // that "nothing spendable changed" — but the user did the full 40 minutes
    // either way, and the only difference they could observe was whether their
    // phone said anything. Field 2026-08-08: two phones, same session, one
    // announced "Bonus unlocked 🔓" and the other said nothing at all, because
    // this one was over the cap. The tester's first read was that the upgrade
    // had failed. It hadn't — it was banked, along with 385 POWR across 21
    // earlier deposits nobody had ever been told about.
    //
    // A capped award and a broken one must not look identical. Announce the
    // deposit; the Vault rollout gate in send-push-notification still decides
    // whether a user with no Vault surface should hear about it, which is the
    // correct place for that call to live.
    //
    // Best-effort, exactly like the spendable push below: a notification
    // failure must never fail an upgrade whose points are already banked.
    if (vaulted > 0) {
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
            type: 'vault_banked',
            payload: {
              session_id: session.id,
              points: vaulted,
              reason: `${upgradeMin}-min bonus`,
              vests_at: vestsAt,
            },
          }),
        });
      } catch (notifErr) {
        console.warn('[upgrade-gym-tier] vault_banked notification failed:', notifErr);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, delta: 0, vaulted, message: 'Upgrade banked to vault (daily cap reached)' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

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
      // Counts BOTH transports — see the same guard in claim-points. An Android
      // visible push now reports `direct`, not `queued`, and reading queued alone
      // would make the client fire notifySessionUpgraded on top of the server's
      // banner (2026-08-09).
      const accepted = Number(pushBody?.result?.queued ?? 0)
        + Number(pushBody?.result?.direct ?? 0);
      pushDelivered = pushBody.skipped
        ? pushBody.reason !== 'no_tokens'
        : accepted > 0;
    }
  } catch (notifErr) {
    pushDelivered = false;
    console.warn('[upgrade-gym-tier] session_upgraded notification failed:', notifErr);
  }

  return new Response(
    JSON.stringify({ ok: true, delta: finalDelta, vaulted, transaction_id: txId, earned: finalDelta, push_delivered: pushDelivered }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Streak-rescue sweep (pg_cron, hourly). Token-gated by the shared
// x-resolve-token cron secret.
//
// Three duties per run:
//   1. EXPIRE overdue offers (and backstop-complete any whose requirement was
//      actually met — the session trigger normally does this, but a rescue
//      whose final session arrived before the offer existed has no later
//      insert to recount it).
//   2. OFFER rescues: streak_rescue_candidates() returns users in their local
//      09:00–10:00 window who were active the day before yesterday, silent
//      yesterday, and outside the cooldown. For each we walk their sessions
//      to size the run that ENDED at day-before-yesterday (their lost
//      streak); if it clears the min-streak floor we insert the 'offered' row
//      and fire the streak_lost push (rescue terms in the copy).
//
// Knobs (all admin-editable in /admin/config): streak_rescue_enabled,
// _window_hours, _sessions_required, _min_streak, _cooldown_days.

import { createClient } from '@supabase/supabase-js';

// Local calendar day of an instant in an IANA zone, as YYYY-MM-DD.
function localDay(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// UTC instant of local midnight today in tz (see _shared/nudgeBudget.ts).
function localDayStartUtc(tz: string): Date {
  try {
    const ymd = localDay(new Date(), tz);
    const guess = new Date(`${ymd}T00:00:00Z`);
    const tzMs = new Date(guess.toLocaleString('en-US', { timeZone: tz })).getTime();
    const utcMs = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
    return new Date(guess.getTime() - (tzMs - utcMs));
  } catch {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}

// Length of the consecutive-day run ending at endDay (inclusive), given the
// set of the user's active local days.
function runLengthEndingAt(days: Set<string>, endDay: string): number {
  let len = 0;
  const cursor = new Date(`${endDay}T12:00:00Z`); // noon dodges DST edges
  while (days.has(cursor.toISOString().slice(0, 10))) {
    len++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return len;
}

function intFromConfig(rows: Array<{ key: string; value: string }>, key: string, fallback: number): number {
  const raw = rows.find((r) => r.key === key)?.value ?? '';
  const n = parseInt(String(raw).replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

Deno.serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const token = req.headers.get('x-resolve-token') ?? '';
  const { data: valid } = await admin.rpc('verify_resolve_token', { p_token: token });
  if (valid !== true) return new Response('forbidden', { status: 403 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const stats = { expired: 0, backstopCompleted: 0, candidates: 0, offered: 0, belowMin: 0 };

  // ── 1. Expire / backstop-complete overdue offers ───────────────────────────
  const { data: overdue } = await admin
    .from('streak_rescues')
    .select('id, user_id, lost_streak, sessions_required, count_from')
    .eq('status', 'offered')
    .lte('expires_at', new Date().toISOString());

  for (const r of overdue ?? []) {
    const { count } = await admin
      .from('activity_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', r.user_id)
      .neq('verification', 'manual')
      .gte('started_at', r.count_from);
    const done = count ?? 0;

    if (done >= r.sessions_required) {
      const { data: won } = await admin
        .from('streak_rescues')
        .update({ status: 'completed', sessions_done: done, completed_at: new Date().toISOString() })
        .eq('id', r.id)
        .eq('status', 'offered')
        .select('id');
      if (won?.length) {
        stats.backstopCompleted++;
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
            body: JSON.stringify({
              target_user_id: r.user_id,
              type: 'streak_rescued',
              payload: { lost_streak: r.lost_streak },
            }),
          });
        } catch { /* best-effort */ }
      }
    } else {
      await admin
        .from('streak_rescues')
        .update({ status: 'expired', sessions_done: done })
        .eq('id', r.id)
        .eq('status', 'offered');
      stats.expired++;
    }
  }

  // ── 2. Offer new rescues ───────────────────────────────────────────────────
  const { data: configRows } = await admin
    .from('system_config')
    .select('key, value')
    .in('key', [
      'streak_rescue_enabled', 'streak_rescue_window_hours',
      'streak_rescue_sessions_required', 'streak_rescue_min_streak',
    ]);
  const cfg = configRows ?? [];
  const enabled = (cfg.find((r) => r.key === 'streak_rescue_enabled')?.value ?? 'true') === 'true';
  const windowHours = intFromConfig(cfg, 'streak_rescue_window_hours', 48);
  const sessionsRequired = intFromConfig(cfg, 'streak_rescue_sessions_required', 2);
  const minStreak = intFromConfig(cfg, 'streak_rescue_min_streak', 3);

  if (enabled) {
    const { data: candidates, error } = await admin.rpc('streak_rescue_candidates');
    if (error) console.error('[streak-rescue-sweep] candidates rpc failed', error);
    stats.candidates = (candidates ?? []).length;

    for (const c of candidates ?? []) {
      // Size the lost streak: local active days over the last 90d, run ending
      // at the day before yesterday (c.missed_day is yesterday-local).
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const { data: sessions } = await admin
        .from('activity_sessions')
        .select('started_at')
        .eq('user_id', c.user_id)
        .neq('verification', 'manual')
        .gte('started_at', since.toISOString());

      const days = new Set<string>(
        (sessions ?? []).map((s: { started_at: string }) => localDay(new Date(s.started_at), c.tz)),
      );
      const endDay = new Date(`${c.missed_day}T12:00:00Z`);
      endDay.setUTCDate(endDay.getUTCDate() - 1);
      const lostStreak = runLengthEndingAt(days, endDay.toISOString().slice(0, 10));

      if (lostStreak < minStreak) {
        stats.belowMin++;
        continue;
      }

      const { data: offer, error: offerErr } = await admin
        .from('streak_rescues')
        .insert({
          user_id: c.user_id,
          lost_streak: lostStreak,
          missed_day: c.missed_day,
          sessions_required: sessionsRequired,
          expires_at: new Date(Date.now() + windowHours * 3600_000).toISOString(),
          count_from: localDayStartUtc(c.tz).toISOString(),
        })
        .select('id')
        .single();
      // Unique partial index (one 'offered' per user) makes overlapping cron
      // runs idempotent — the loser just skips.
      if (offerErr || !offer) continue;

      stats.offered++;
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({
            target_user_id: c.user_id,
            type: 'streak_lost',
            payload: {
              lost_streak: lostStreak,
              sessions_required: sessionsRequired,
              window_hours: windowHours,
            },
          }),
        });
      } catch (err) {
        console.warn('[streak-rescue-sweep] offer push failed:', err);
      }
    }
  }

  console.log('[streak-rescue-sweep]', JSON.stringify(stats));
  return new Response(JSON.stringify({ ok: true, ...stats }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

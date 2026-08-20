// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Daily-nudge dispatcher (pg_cron, */15). Token-gated by the shared
// x-resolve-token cron secret (dispatch-scheduled-broadcasts pattern).
//
// Two nudges, one dispatcher:
//   streak_at_risk — users whose last active day is exactly yesterday-local,
//     pinged in their local 20:00–20:15 window so the warning lands with
//     hours (not minutes) left before their midnight.
//   daily_reminder — the long-declared type that never had a sender: users
//     who set a reminder time in Settings, pinged in the matching local
//     15-min window, only on days they haven't logged anything yet.
//
// Candidate selection is one SQL pass (nudge_dispatch_candidates — all the
// timezone math lives there). This function stays deliberately dumb: it just
// forwards each candidate to send-push-notification, which owns EVERY gate —
// admin kill-switch, the shared nudge budget (one nudge-class push per user
// per local day), user preference, streak recompute + min-streak floor, and
// push_send_log forensics. Duplicate cron overlap is therefore harmless: the
// second attempt logs a budget skip instead of double-pushing.
//
// Phase 2 — weekly-BOARD nudges (weekly_nudge_candidates):
//   challenge_within_reach — Mon–Sat 18:00 local, a challenge is ≥60% done.
//   weekly_challenge_expiry — Sunday 17:00 local, last-day save for ≥50%.
// The SQL pass only picks WHO and WHEN; how close they are is answered here
// with the same rule engine the app and complete-weekly-challenge use, so a
// nudge can never disagree with the board. The highest-fraction incomplete
// challenge is by definition the board's top visible slot (momentum ranking),
// so the push always names something the user can see on Home.

import { createClient } from '@supabase/supabase-js';
import {
  buildContext,
  categoryOf,
  evaluateChallenge,
  getISOWeek,
  getLocalMondayAsUTC,
  getPersonalizedChallengesForWeek,
  parseChallengeCatalog,
} from '../_shared/challenges.ts';
import { shouldSendRegressionNotice, REGRESSION_GRACE_MS } from '../_shared/locationRegression.ts';

const CONCURRENCY = 10;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

/** Human progress readout per rule shape — mirrors the client card's units. */
function progressText(rule: any, category: string, progress: number, target: number): string {
  switch (rule.kind) {
    case 'weekly_sum':
    case 'weekend_sum':
      if (rule.metric === 'steps') return `${progress.toLocaleString()}/${target.toLocaleString()} steps`;
      return `${Math.round(progress / 1000)}/${Math.round(target / 1000)} km`;
    case 'daily_metric_days':
    case 'distinct_days':
    case 'spaced_days':
    case 'step_window':
      return `${progress}/${target} days`;
    case 'distinct_categories':
      return `${progress}/${target} categories`;
    default: {
      const noun = category === 'gym' ? 'check-ins'
        : category === 'running' ? 'runs'
        : category === 'cycling' ? 'rides'
        : 'sessions';
      return `${progress}/${target} ${noun}`;
    }
  }
}

Deno.serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const token = req.headers.get('x-resolve-token') ?? '';
  const { data: valid } = await admin.rpc('verify_resolve_token', { p_token: token });
  if (valid !== true) return new Response('forbidden', { status: 403 });

  const { data: candidates, error } = await admin.rpc('nudge_dispatch_candidates');
  if (error) {
    console.error('[dispatch-daily-nudges] candidates rpc failed', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const stats: Record<string, number> = { candidates: (candidates ?? []).length, sent: 0, skipped: 0, failed: 0 };
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const queue = [...(candidates ?? [])];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (cursor < queue.length) {
      const c = queue[cursor++];
      if (!c) break;
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ target_user_id: c.user_id, type: c.kind, payload: {} }),
        });
        const body = await res.json().catch(() => null);
        if (body?.skipped) stats.skipped++;
        else if (res.ok) stats.sent++;
        else stats.failed++;
      } catch (err) {
        stats.failed++;
        console.warn(`[dispatch-daily-nudges] ${c.kind} → ${c.user_id} failed:`, err);
      }
    }
  });
  await Promise.all(workers);

  // ── Phase 2: weekly-board nudges ──────────────────────────────────────────
  const { data: wkCandidates, error: wkErr } = await admin.rpc('weekly_nudge_candidates');
  if (wkErr) {
    console.error('[dispatch-daily-nudges] weekly candidates rpc failed', wkErr);
  }
  stats.wk_candidates = (wkCandidates ?? []).length;
  stats.wk_sent = 0; stats.wk_skipped = 0; stats.wk_no_target = 0;

  if ((wkCandidates ?? []).length > 0) {
    // Catalog + per-week overrides, fetched once per tick (shared by everyone;
    // the week itself is derived per-user from their tz offset).
    let catalog = parseChallengeCatalog(null);
    let weekOverrides: Record<string, Record<string, string>> = {};
    try {
      const { data: cat } = await admin.from('system_config').select('value').eq('key', 'weekly_challenges').maybeSingle();
      if (cat?.value) catalog = parseChallengeCatalog(cat.value);
      const { data: ov } = await admin.from('system_config').select('value').eq('key', 'challenge_week_overrides').maybeSingle();
      if (ov?.value) weekOverrides = typeof ov.value === 'string' ? JSON.parse(ov.value) : ov.value;
    } catch { /* bundled catalog, no overrides */ }

    for (const c of wkCandidates ?? []) {
      try {
        const offm = Number(c.tz_offset_minutes) || 0;
        const challengeWeek = getISOWeek(new Date(Date.now() + offm * 60000));
        const weekStart = getLocalMondayAsUTC(offm);

        const [{ data: sessions }, { data: completions }, { data: prof }] = await Promise.all([
          admin.from('activity_sessions')
            .select('type, started_at, duration_sec, distance_m, steps, verification')
            .eq('user_id', c.user_id).gte('started_at', weekStart),
          admin.from('user_challenge_completions')
            .select('challenge_id')
            .eq('user_id', c.user_id).eq('challenge_week', challengeWeek),
          admin.from('profiles')
            .select('activity_preferences')
            .eq('id', c.user_id).maybeSingle(),
        ]);
        const completedIds = new Set((completions ?? []).map((r) => r.challenge_id));

        // Same relevance rule as the client board (useWeeklyChallenge):
        // onboarding buckets ∪ categories logged this week — nudging a goal
        // the user's board doesn't show would read as broken.
        const relevant = new Set<string>(
          Array.isArray(prof?.activity_preferences) ? prof.activity_preferences : [],
        );
        for (const s of sessions ?? []) {
          if (s.verification === 'manual') continue;
          const cat = categoryOf(s.type);
          if (cat) relevant.add(cat);
        }
        let active = getPersonalizedChallengesForWeek(challengeWeek, [...relevant], catalog);
        const ov = weekOverrides?.[challengeWeek];
        if (ov) {
          active = active.map((ch) => {
            const ovId = ov[ch.category];
            const found = ovId ? catalog.find((x) => x.id === ovId) : null;
            return found ?? ch;
          });
          active = active.filter((ch, i) => active.findIndex((x) => x.id === ch.id) === i);
        }

        let stepWindows: any[] = [];
        if (active.some((ch) => !completedIds.has(ch.id) && ch.rule.kind === 'step_window')) {
          const { data: windows } = await admin.from('daily_step_windows')
            .select('date, before_9am, midday_12_14, after_6pm')
            .eq('user_id', c.user_id).gte('date', weekStart.slice(0, 10));
          stepWindows = windows ?? [];
        }

        const ctx = buildContext(sessions ?? [], offm, stepWindows);
        // Highest-fraction incomplete challenge over the floor. `met` ones are
        // excluded — the award is pending and the in-app celebration owns that
        // moment; a "you're close" about a finished thing reads as broken.
        const floor = c.kind === 'challenge_within_reach' ? 0.6 : 0.5;
        let best: { ch: any; progress: number; target: number; fraction: number } | null = null;
        for (const ch of active) {
          if (completedIds.has(ch.id)) continue;
          const { progress, target, met } = evaluateChallenge(ch.rule, ctx);
          if (met || !(target > 0)) continue;
          const fraction = progress / target;
          if (fraction >= floor && fraction < 1 && (!best || fraction > best.fraction)) {
            best = { ch, progress, target, fraction };
          }
        }
        if (!best) { stats.wk_no_target++; continue; }

        // Once per challenge per week: the nudge budget only knows days, so a
        // 70%-stuck challenge would otherwise re-nudge every evening. The body
        // template quotes the title, which makes the send log the dedup index.
        if (c.kind === 'challenge_within_reach') {
          const titlePattern = `%"${escapeLike(best.ch.title)}"%`;
          const { data: prior } = await admin.from('push_send_log')
            .select('id')
            .eq('user_id', c.user_id)
            .eq('type', 'challenge_within_reach')
            .neq('status', 'skipped')
            .gte('created_at', weekStart)
            .like('body', titlePattern)
            .limit(1);
          if ((prior ?? []).length > 0) { stats.wk_skipped++; continue; }
        }

        const res = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({
            target_user_id: c.user_id,
            type: c.kind,
            payload: {
              challenge_id: best.ch.id,
              challenge_name: best.ch.title,
              progress_text: progressText(best.ch.rule, best.ch.category, best.progress, best.target),
              points: best.ch.points,
            },
          }),
        });
        const body = await res.json().catch(() => null);
        if (body?.skipped) stats.wk_skipped++;
        else if (res.ok) stats.wk_sent++;
        else stats.failed++;
      } catch (err) {
        stats.failed++;
        console.warn(`[dispatch-daily-nudges] weekly ${c.kind} → ${c.user_id} failed:`, err);
      }
    }
  }

  // ── Phase 3: location-permission regression notices ───────────────────────
  // always → denied/while_using is recorded server-side (2026-08-09) but had no
  // consumer that could REACH the user: every in-app recovery surface requires
  // opening the app, and this cohort has stopped opening it (field 2026-08-15:
  // 'always' lost mid-visit, zero visits in the five days after, live push
  // token the whole time). One push per regression, EVER — any push_send_log
  // row newer than the regression (sent or skipped) closes it, so a no_tokens
  // skip can't spam the log every 15 minutes and a re-grant + fresh loss
  // re-arms naturally. All eligibility rules live in
  // _shared/locationRegression.ts; this pass stays deliberately dumb.
  stats.loc_candidates = 0; stats.loc_sent = 0; stats.loc_skipped = 0;
  try {
    const nowMs = Date.now();
    const { data: regressions, error: regErr } = await admin
      .from('location_permission_regressions')
      .select('user_id, level, created_at')
      .lt('created_at', new Date(nowMs - REGRESSION_GRACE_MS).toISOString())
      .order('created_at', { ascending: false });
    if (regErr) throw regErr;

    // Latest regression per user — the view is append-only history.
    const latest = new Map<string, { level: string; created_at: string }>();
    for (const r of regressions ?? []) {
      if (!latest.has(r.user_id)) latest.set(r.user_id, r);
    }

    if (latest.size > 0) {
      const userIds = [...latest.keys()];
      const [{ data: profs, error: profErr }, { data: priorLogs, error: logErr }] = await Promise.all([
        admin.from('profiles')
          .select('id, location_permission, timezone')
          .in('id', userIds),
        admin.from('push_send_log')
          .select('user_id, created_at')
          .eq('type', 'location_permission_lost')
          .in('user_id', userIds),
      ]);
      if (profErr) throw profErr;
      if (logErr) throw logErr;
      const profById = new Map((profs ?? []).map((p) => [p.id, p]));
      const lastAttempt = new Map<string, number>();
      for (const l of priorLogs ?? []) {
        const t = Date.parse(l.created_at);
        if (Number.isFinite(t) && t > (lastAttempt.get(l.user_id) ?? 0)) lastAttempt.set(l.user_id, t);
      }

      for (const [userId, reg] of latest) {
        const prof = profById.get(userId);
        let localHour: number;
        try {
          // Most of the base is UK; an unset/garbage timezone falls back to
          // London rather than UTC-midnight surprises.
          localHour = Number(new Intl.DateTimeFormat('en-GB', {
            hour: 'numeric', hour12: false, timeZone: prof?.timezone || 'Europe/London',
          }).format(new Date(nowMs)));
        } catch {
          localHour = new Date(nowMs).getUTCHours();
        }

        if (!shouldSendRegressionNotice({
          regressionLevel: reg.level,
          regressionAtMs: Date.parse(reg.created_at),
          currentLevel: prof?.location_permission ?? null,
          lastAttemptAtMs: lastAttempt.get(userId) ?? null,
          localHour,
          nowMs,
        })) continue;

        stats.loc_candidates++;
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
            body: JSON.stringify({
              target_user_id: userId,
              type: 'location_permission_lost',
              payload: { level: reg.level },
            }),
          });
          const body = await res.json().catch(() => null);
          if (body?.skipped) stats.loc_skipped++;
          else if (res.ok) stats.loc_sent++;
          else stats.failed++;
        } catch (err) {
          stats.failed++;
          console.warn(`[dispatch-daily-nudges] location_permission_lost → ${userId} failed:`, err);
        }
      }
    }
  } catch (locErr) {
    // Best-effort: a broken regression pass must never take down the streak /
    // reminder / weekly nudges that share this dispatcher.
    console.warn('[dispatch-daily-nudges] location-regression pass failed:', locErr);
  }

  console.log('[dispatch-daily-nudges]', JSON.stringify(stats));
  return new Response(JSON.stringify({ ok: true, ...stats }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

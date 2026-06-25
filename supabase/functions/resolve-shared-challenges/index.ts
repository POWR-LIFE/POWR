// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// The shared-challenge heartbeat (pg_cron, ~every 15 min). Token-gated by the
// x-resolve-token shared secret (lives only in the cron job + SHARED_RESOLVE_TOKEN
// secret), so it's safe to expose without user auth. Four jobs:
//   1. Forming past its accept window → start (≥2 in) or cancel.
//   2. Active challenges → evaluate not-yet-finished participants (the backstop
//      so app-closed users still complete + award their base).
//   3. Ended & unsettled → SETTLE: compute the group bonus from the final
//      co-completer count, award it to each finisher, complete the challenge.
//   4. Ending soon → one-shot "finish your part" nudge to those not done.
import { createClient } from '@supabase/supabase-js';
import { evaluateParticipant } from '../_shared/sharedChallengeEval.ts';
import { evaluatePooledChallenge } from '../_shared/sharedChallengePooled.ts';
import { tryStartForming } from '../_shared/sharedChallengeLifecycle.ts';
import { groupBonus } from '../_shared/sharedChallenges.ts';
import { notifyPush } from '../_shared/notify.ts';

const EXPIRING_THRESHOLD_MS = 6 * 3_600_000; // nudge when <6h remain

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Token-gated (no user JWT — invoked by pg_cron). The expected value lives in
  // Vault, so it's never in source; verify_resolve_token compares against it.
  const token = req.headers.get('x-resolve-token') ?? '';
  const { data: valid } = await supabase.rpc('verify_resolve_token', { p_token: token });
  if (valid !== true) return new Response('forbidden', { status: 403 });
  const nowIso = new Date().toISOString();
  const stats = { started: 0, cancelled: 0, awarded: 0, settled: 0, nudged: 0 };

  // ── 1. Forming challenges whose accept window has elapsed ──────────────────
  const { data: stale } = await supabase
    .from('shared_challenges')
    .select('id')
    .eq('status', 'forming')
    .lte('accept_by', nowIso);
  for (const c of stale ?? []) {
    const outcome = await tryStartForming(supabase, c.id);
    if (outcome === 'started') stats.started++;
    else if (outcome === 'cancelled') stats.cancelled++;
  }

  // ── 2–4. Active challenges ─────────────────────────────────────────────────
  const { data: active } = await supabase
    .from('shared_challenges')
    .select('id, kind, rule, template, base_points, status, starts_at, ends_at, settled_at, utc_offset_minutes, bonus_per_head, bonus_max, expiring_notified, pool_milestone_notified')
    .eq('status', 'active');

  for (const ch of active ?? []) {
    // ── Pooled challenges: one group evaluation (sum vs target). Completes
    //    itself on reaching target; expires if the clock runs out first. ──────
    if (ch.kind === 'pooled') {
      const r = await evaluatePooledChallenge(supabase, ch);
      if (r.newlyCompleted) stats.settled++;
      const endedP = ch.ends_at && Date.parse(ch.ends_at) <= Date.now();
      if (!r.completed && endedP && !ch.settled_at) {
        await supabase.from('shared_challenges')
          .update({ status: 'expired', settled_at: nowIso })
          .eq('id', ch.id).is('settled_at', null);
      } else if (!r.completed && !endedP && ch.ends_at && !ch.expiring_notified) {
        const remaining = Date.parse(ch.ends_at) - Date.now();
        if (remaining > 0 && remaining <= EXPIRING_THRESHOLD_MS) {
          const { data: laggers } = await supabase
            .from('shared_challenge_participants')
            .select('user_id')
            .eq('challenge_id', ch.id)
            .not('state', 'in', '(declined,left)');
          for (const p of laggers ?? []) {
            await notifyPush(p.user_id, 'challenge_expiring', {
              challenge_id: ch.id, title: ch.template?.title ?? 'your challenge',
              hours_left: Math.max(1, Math.round(remaining / 3_600_000)),
            });
            stats.nudged++;
          }
          await supabase.from('shared_challenges').update({ expiring_notified: true }).eq('id', ch.id);
        }
      }
      continue;
    }

    // 2. Backstop evaluation for everyone still in but not yet finished.
    const { data: parts } = await supabase
      .from('shared_challenge_participants')
      .select('user_id, state, completed')
      .eq('challenge_id', ch.id)
      .eq('state', 'accepted')
      .eq('completed', false);
    for (const p of parts ?? []) {
      const r = await evaluateParticipant(supabase, ch, p.user_id, ch.utc_offset_minutes ?? 0);
      if (r.newlyCompleted) stats.awarded++;
    }

    const ended = ch.ends_at && Date.parse(ch.ends_at) <= Date.now();

    // 3. Settle ended challenges (bonus + complete).
    if (ended && !ch.settled_at) {
      // Claim the settlement so a second tick can't double-pay.
      const { data: claim } = await supabase
        .from('shared_challenges')
        .update({ status: 'completed', settled_at: nowIso })
        .eq('id', ch.id)
        .is('settled_at', null)
        .select('id')
        .maybeSingle();
      if (!claim) continue; // someone else settled it

      const { data: finishers } = await supabase
        .from('shared_challenge_participants')
        .select('user_id, bonus_awarded')
        .eq('challenge_id', ch.id)
        .eq('completed', true);
      const completerCount = finishers?.length ?? 0;

      // Nobody finished their part → the challenge flopped. Mark it expired
      // (not completed) so it reads correctly and skips the celebration window.
      if (completerCount === 0) {
        await supabase.from('shared_challenges').update({ status: 'expired' }).eq('id', ch.id);
        stats.settled++;
        continue;
      }

      for (const f of finishers ?? []) {
        const coCompleters = completerCount - 1; // everyone else who finished
        const bonus = groupBonus(coCompleters, { perHead: ch.bonus_per_head, maxBonus: ch.bonus_max });
        if (bonus > 0 && (f.bonus_awarded ?? 0) === 0) {
          const { error: ptErr } = await supabase.from('point_transactions').insert({
            user_id: f.user_id,
            amount: bonus,
            type: 'earn',
            source: 'shared_challenge_bonus',
            description: `Together bonus: ${ch.template?.title ?? 'Challenge'} (+${bonus} · ${coCompleters} friend${coCompleters === 1 ? '' : 's'})`,
          });
          if (!ptErr) {
            await supabase.from('shared_challenge_participants')
              .update({ bonus_awarded: bonus })
              .eq('challenge_id', ch.id).eq('user_id', f.user_id);
          }
        }
        // Closing push: base + bonus = total.
        await notifyPush(f.user_id, 'challenge_completed', {
          challenge_id: ch.id,
          title: ch.template?.title ?? 'your challenge',
          base: ch.base_points,
          bonus,
          total: ch.base_points + bonus,
          co_completers: coCompleters,
        });
      }
      stats.settled++;
      continue;
    }

    // 4. Ending soon → one-shot nudge to those who haven't finished.
    if (!ended && ch.ends_at && !ch.expiring_notified) {
      const remaining = Date.parse(ch.ends_at) - Date.now();
      if (remaining > 0 && remaining <= EXPIRING_THRESHOLD_MS) {
        const { data: laggers } = await supabase
          .from('shared_challenge_participants')
          .select('user_id')
          .eq('challenge_id', ch.id)
          .eq('state', 'accepted')
          .eq('completed', false);
        for (const p of laggers ?? []) {
          await notifyPush(p.user_id, 'challenge_expiring', {
            challenge_id: ch.id,
            title: ch.template?.title ?? 'your challenge',
            hours_left: Math.max(1, Math.round(remaining / 3_600_000)),
          });
          stats.nudged++;
        }
        await supabase.from('shared_challenges').update({ expiring_notified: true }).eq('id', ch.id);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, ...stats }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

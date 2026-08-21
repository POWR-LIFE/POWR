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

  // ── 1. Forming challenges: start any with ≥2 in; cancel dead ones at the
  //      accept deadline. Sweeping ALL forming rows (not just deadline-elapsed)
  //      backstops an accept whose start event was missed — and activated every
  //      pre-existing forming challenge when start-on-second-accept shipped. ───
  const { data: forming } = await supabase
    .from('shared_challenges')
    .select('id, accept_by, is_open')
    .eq('status', 'forming');
  for (const c of forming ?? []) {
    // Past accept_by, outstanding invites count as non-answers — otherwise one
    // ghosted invite parks the challenge in 'forming' forever.
    const elapsed = !!c.accept_by && Date.parse(c.accept_by) <= Date.now();
    // An OPEN-BOARD post is waiting on a stranger, not on an answer, and has no
    // invitees to prove it. This sweep runs every 15 minutes, so without the
    // skip a board post is cancelled within a quarter hour of going up — the
    // board would be empty every time anyone looked. tryStartForming guards this
    // too (shouldKeepForming); belt and braces, because the cost of getting it
    // wrong is the whole feature silently doing nothing. Once the window HAS
    // elapsed we do fall through, so the untaken post converts to a solo run.
    if (c.is_open && !elapsed) continue;
    const outcome = await tryStartForming(supabase, c.id, elapsed);
    if (outcome === 'started') stats.started++;
    else if (outcome === 'cancelled') stats.cancelled++;
  }

  // ── 1b. Open board: announce new posts to the people who could take one ────
  //
  // STAGED OFF (system_config.open_board_post_push = 'off'). A post is invisible
  // until someone happens to open /challenges, so at 48h most would go untaken —
  // but with a handful of opted-in members there is nobody to announce to yet,
  // and a fan-out over an empty board is pure noise. Flip it on only once
  // open_board_stats() shows posts_went_solo outpacing posts_taken:
  //
  //   update system_config set value = 'on' where key = 'open_board_post_push';
  //
  // Rollback is the same statement with 'off', no deploy. Read per-run rather
  // than cached at module scope so a flip takes effect without a cold start —
  // same discipline as _shared/visiblePush.ts's transport flag.
  //
  // Volume is bounded three ways, because this is the only push in the app that
  // fans OUT rather than targeting one person:
  //   · notification_config gives it class='social' + daily_cap=1 — a hard
  //     one-per-user-per-day ceiling. It is deliberately NOT nudge-class: the
  //     nudge pool holds a single daily slot that streak_at_risk and
  //     daily_reminder already compete for, and a board post must never
  //     suppress a streak warning.
  //   · get_open_board_audience resolves eligibility in ONE round-trip and only
  //     returns users who actually hold a push token.
  //   · MAX_BOARD_PUSHES caps the whole tick, so wall-clock can't run away as
  //     the base grows — every notifyPush is a full HTTP call to
  //     send-push-notification, which does ~7 queries of its own.
  const { data: boardFlag } = await supabase
    .from('system_config').select('value').eq('key', 'open_board_post_push').maybeSingle();
  if (String(boardFlag?.value ?? 'off').trim().toLowerCase() === 'on') {
    const MAX_BOARD_PUSHES = 60;
    let boardPushes = 0;

    const { data: unannounced } = await supabase
      .from('shared_challenges')
      .select('id, creator_id, template, created_at')
      .eq('is_open', true)
      .eq('board_notified', false)
      // 'forming' only. A post that already converted to a solo run is
      // status='active' with is_open still true — announcing that as "new on
      // the board" would invite people into a race already underway.
      .eq('status', 'forming')
      .eq('solo_start', false)
      // Freshness: if a post has sat unannounced for a day, the moment has
      // passed and a late "new!" is a lie.
      .gte('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString())
      .order('created_at', { ascending: true })
      .limit(3);

    for (const post of unannounced ?? []) {
      if (boardPushes >= MAX_BOARD_PUSHES) break;

      // Claim it BEFORE sending. A crash mid-fan-out costs one announcement;
      // claiming afterwards would re-announce the same post every 15 minutes.
      const { data: claimed } = await supabase
        .from('shared_challenges')
        .update({ board_notified: true })
        .eq('id', post.id)
        .eq('board_notified', false)
        .select('id')
        .maybeSingle();
      if (!claimed) continue;

      const { data: prof } = await supabase
        .from('profiles').select('display_name, username').eq('id', post.creator_id).maybeSingle();
      // First name only, exactly as the board itself shows it.
      const who = String(prof?.display_name || prof?.username || 'Someone').trim().split(' ')[0];
      const title = post.template?.title ?? 'a challenge';

      const { data: audience } = await supabase
        .rpc('get_open_board_audience', { p_challenge_id: post.id, p_limit: MAX_BOARD_PUSHES });

      for (const row of audience ?? []) {
        if (boardPushes >= MAX_BOARD_PUSHES) break;
        const uid = typeof row === 'string' ? row : row?.get_open_board_audience ?? row?.id;
        if (!uid) continue;
        await notifyPush(uid, 'challenge_open_posted', {
          challenge_id: post.id, title, from_name: who,
        });
        boardPushes++;
        stats.nudged++;
      }
    }
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
        const { data: expiredClaim } = await supabase.from('shared_challenges')
          .update({ status: 'expired', settled_at: nowIso })
          .eq('id', ch.id).is('settled_at', null)
          .select('id')
          .maybeSingle();
        // Tell the group it's over. Contributors got no points and no word at
        // all before this — the last thing they'd heard was the 6h "ending
        // soon" nudge. Guarded on the claim so a second tick can't re-announce.
        if (expiredClaim) {
          const { data: roster } = await supabase
            .from('shared_challenge_participants')
            .select('user_id')
            .eq('challenge_id', ch.id)
            .not('state', 'in', '(declined,left,invited)');
          for (const p of roster ?? []) {
            await notifyPush(p.user_id, 'challenge_ended', {
              challenge_id: ch.id,
              title: ch.template?.title ?? 'your challenge',
              outcome: 'pool_missed',
            });
          }
        }
      } else if (!r.completed && !endedP && ch.ends_at && !ch.expiring_notified) {
        const remaining = Date.parse(ch.ends_at) - Date.now();
        if (remaining > 0 && remaining <= EXPIRING_THRESHOLD_MS) {
          const { data: laggers } = await supabase
            .from('shared_challenge_participants')
            .select('user_id')
            .eq('challenge_id', ch.id)
            // Not the ghosts: a challenge can start with unanswered invites, and
            // nudging someone to finish something they never joined is noise.
            .not('state', 'in', '(declined,left,invited)');
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

      // The whole roster, so we can tell the people who DIDN'T finish that it's
      // over — the settlement loop below only ever touched finishers.
      const { data: roster } = await supabase
        .from('shared_challenge_participants')
        .select('user_id, completed, bonus_awarded')
        .eq('challenge_id', ch.id)
        .not('state', 'in', '(declined,left,invited)');

      // Finishers must exclude anyone who walked out. Every other roster query
      // in this file filters state; this one didn't, so a quitter who'd already
      // finished was still paid the togetherness bonus for a group they left —
      // and inflated everyone else's co-completer count with a head that isn't
      // there.
      const finishers = (roster ?? []).filter((p: any) => p.completed);
      const completerCount = finishers.length;

      // Nobody finished their part → the challenge flopped. Mark it expired
      // (not completed) so it reads correctly and skips the celebration window.
      if (completerCount === 0) {
        await supabase.from('shared_challenges').update({ status: 'expired' }).eq('id', ch.id);
        for (const p of roster ?? []) {
          await notifyPush(p.user_id, 'challenge_ended', {
            challenge_id: ch.id,
            title: ch.template?.title ?? 'your challenge',
            outcome: 'expired',
            // Lets the copy drop "nobody finished" when it was only ever you.
            roster: (roster ?? []).length,
          });
        }
        stats.settled++;
        continue;
      }

      // The people who tried and fell short. Previously they were never told
      // the challenge had ended at all — the loop below iterates finishers only,
      // so a non-finisher's last word on it was the "ending soon" nudge.
      for (const p of (roster ?? []).filter((r: any) => !r.completed)) {
        await notifyPush(p.user_id, 'challenge_ended', {
          challenge_id: ch.id,
          title: ch.template?.title ?? 'your challenge',
          outcome: 'missed',
          finishers: completerCount,
          roster: (roster ?? []).length,
        });
      }

      for (const f of finishers) {
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

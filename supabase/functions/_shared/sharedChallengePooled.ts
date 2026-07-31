// @ts-nocheck — Deno runtime, not Node.
//
// Pooled ("combined total") challenge evaluation (scope §3B). Unlike parallel
// (each person hits their OWN goal), a pooled challenge SUMS every participant's
// contribution toward one shared target and completes the moment the pool reaches
// it. Because it needs every participant's sessions, it MUST run service-role.
// Called by complete-shared-challenge (client trigger) and resolve cron (backstop
// + at-end). On reaching the target: every contributor (>0) earns base + a group
// bonus scaling with the number of OTHER contributors, settled once (settled_at
// claim guards against double-pay).
import { buildContext, challengeSessionWindow } from './challenges.ts';
import { groupBonus, poolContribution } from './sharedChallenges.ts';
import { notifyPush } from './notify.ts';

export interface PooledEvalResult {
  completed: boolean;
  newlyCompleted: boolean;
  poolTotal: number;
  target: number;
}

export async function evaluatePooledChallenge(supabase: any, challenge: any): Promise<PooledEvalResult> {
  const rule = challenge.rule ?? {};
  const target = Number(rule.target) || 0;
  if (challenge.status !== 'active' || !challenge.starts_at) {
    return { completed: false, newlyCompleted: false, poolTotal: 0, target };
  }

  const endMs = challenge.ends_at ? Date.parse(challenge.ends_at) : Date.now();
  const windowEnd = new Date(Math.min(Date.now(), endMs)).toISOString();
  const offset = challenge.utc_offset_minutes ?? 0;
  // Start-day walking buckets count (see challengeSessionWindow).
  const window = challengeSessionWindow(challenge.starts_at, offset);

  const { data: parts } = await supabase
    .from('shared_challenge_participants')
    .select('user_id, state')
    .eq('challenge_id', challenge.id)
    // 'invited' is excluded as well as declined/left. A challenge can now go
    // active with unanswered invites still on the roster (tryStartForming's
    // deadlineElapsed path), and a ghost is not a participant: their ordinary
    // daily activity must not feed the pool, must not earn them base + bonus,
    // and must not raise everyone else's co-contributor count by a head that
    // never joined. They keep the right to accept late — respond-shared-challenge
    // allows accepting an active challenge — and start counting from then.
    .not('state', 'in', '(declined,left,invited)');

  // Compute each participant's contribution over the challenge window.
  const contribs: { user_id: string; contribution: number }[] = [];
  for (const p of parts ?? []) {
    const { data: sessions } = await supabase
      .from('activity_sessions')
      .select('type, started_at, duration_sec, distance_m, steps, verification')
      .eq('user_id', p.user_id)
      .gte('started_at', window.fetchStartISO)
      .lte('started_at', windowEnd);
    const ctx = buildContext((sessions ?? []).filter(window.admits), offset, []);
    let dailyStepsTotal = 0;
    for (const v of ctx.dailySteps.values()) dailyStepsTotal += v.steps;
    contribs.push({ user_id: p.user_id, contribution: poolContribution(rule, ctx.sessions, dailyStepsTotal) });
  }

  const poolTotal = contribs.reduce((a, c) => a + c.contribution, 0);
  const frac = target > 0 ? Math.max(0, Math.min(1, poolTotal / target)) : 0;

  // Persist contributions + the shared pool fraction as everyone's progress.
  for (const c of contribs) {
    await supabase.from('shared_challenge_participants')
      .update({ contribution: c.contribution, progress: frac })
      .eq('challenge_id', challenge.id).eq('user_id', c.user_id);
  }

  if (!(target > 0 && poolTotal >= target)) {
    // Mid-pool milestone nudge to the WHOLE group (50% / 80%), at most once per
    // threshold. Claimed via a conditional `< milestone` bump so a client trigger
    // and a cron tick can't both fire the same milestone.
    const pct = target > 0 ? Math.floor((poolTotal / target) * 100) : 0;
    const milestone = pct >= 80 ? 80 : pct >= 50 ? 50 : 0;
    const prev = Number(challenge.pool_milestone_notified ?? 0);
    if (milestone > prev) {
      const { data: claimed } = await supabase
        .from('shared_challenges')
        .update({ pool_milestone_notified: milestone })
        .eq('id', challenge.id)
        .lt('pool_milestone_notified', milestone)
        .select('id')
        .maybeSingle();
      if (claimed) {
        const remainingBase = Math.max(0, target - poolTotal);
        const remaining = rule.metric === 'distance_m'
          ? Math.round((remainingBase / (rule.unit === 'mi' ? 1609.34 : 1000)) * 10) / 10
          : rule.metric === 'steps'
            ? Math.round(remainingBase)
            : Math.ceil(remainingBase);
        for (const p of parts ?? []) {
          await notifyPush(p.user_id, 'challenge_pool_milestone', {
            challenge_id: challenge.id,
            title: challenge.template?.title ?? 'your challenge',
            pct: milestone,
            remaining,
            unit: rule.unit ?? '',
          });
        }
      }
    }
    return { completed: false, newlyCompleted: false, poolTotal, target };
  }

  // Target reached — claim the settlement so only one caller pays out.
  const { data: claim } = await supabase
    .from('shared_challenges')
    .update({ status: 'completed', settled_at: new Date().toISOString() })
    .eq('id', challenge.id)
    .is('settled_at', null)
    .select('id')
    .maybeSingle();
  if (!claim) return { completed: true, newlyCompleted: false, poolTotal, target };

  const contributors = contribs.filter((c) => c.contribution > 0);
  const nowIso = new Date().toISOString();
  for (const c of contributors) {
    const coContributors = contributors.length - 1;
    const bonus = groupBonus(coContributors, { perHead: challenge.bonus_per_head, maxBonus: challenge.bonus_max });
    await supabase.from('point_transactions').insert({
      user_id: c.user_id, amount: challenge.base_points, type: 'earn', source: 'shared_challenge',
      description: `Together challenge: ${challenge.template?.title ?? 'Challenge'} (+${challenge.base_points})`,
    });
    if (bonus > 0) {
      await supabase.from('point_transactions').insert({
        user_id: c.user_id, amount: bonus, type: 'earn', source: 'shared_challenge_bonus',
        description: `Together bonus: ${challenge.template?.title ?? 'Challenge'} (+${bonus} · ${coContributors} friend${coContributors === 1 ? '' : 's'})`,
      });
    }
    await supabase.from('shared_challenge_participants')
      .update({ state: 'completed', completed: true, base_awarded: true, bonus_awarded: bonus, completed_at: nowIso })
      .eq('challenge_id', challenge.id).eq('user_id', c.user_id);
    await notifyPush(c.user_id, 'challenge_completed', {
      challenge_id: challenge.id, title: challenge.template?.title ?? 'your challenge',
      base: challenge.base_points, bonus, total: challenge.base_points + bonus, co_completers: coContributors,
    });
  }
  return { completed: true, newlyCompleted: true, poolTotal, target };
}

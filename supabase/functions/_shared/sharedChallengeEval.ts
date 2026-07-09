// @ts-nocheck — Deno runtime, not Node.
//
// Per-participant evaluation + BASE award for parallel co-op shared challenges.
// Used by BOTH paths so the maths lives in exactly one place:
//   - complete-shared-challenge: the signed-in user's own optimistic call, with
//     their live tz offset (authoritative).
//   - resolve-shared-challenges (cron): the backstop for app-closed participants,
//     using the challenge's stored offset.
//
// Mirrors complete-weekly-challenge: re-evaluate server-side, never trust the
// client, record-then-award, idempotent. The idempotency guard is a CONDITIONAL
// flip of base_awarded (false → true) so a client + cron race can't both award.
// The group BONUS is NOT awarded here — it's settled once at challenge end from
// the final co-completer count (see resolve-shared-challenges).
import { buildContext, evaluateChallenge, evaluateMomentum } from './challenges.ts';
import { notifyPush } from './notify.ts';

export interface ParticipantEvalResult {
  met: boolean;
  progress: number;        // 0..1 fraction toward the goal
  newlyCompleted: boolean; // true only on the call that first awards base
}

const NOOP: ParticipantEvalResult = { met: false, progress: 0, newlyCompleted: false };

export async function evaluateParticipant(
  supabase: any,
  challenge: any,            // shared_challenges row (id, rule, template, base_points, status, starts_at, ends_at)
  userId: string,
  utcOffsetMinutes: number,
): Promise<ParticipantEvalResult> {
  // Only evaluate once the clock is actually running.
  if (challenge.status !== 'active' || !challenge.starts_at) return NOOP;

  const { data: part } = await supabase
    .from('shared_challenge_participants')
    .select('state, completed, base_awarded')
    .eq('challenge_id', challenge.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!part || part.state === 'declined' || part.state === 'left') return NOOP;

  // The qualifying window is the challenge's own clock — [starts_at, ends_at],
  // capped at now — NOT the ISO week. "Do the goal within the challenge."
  const windowStart = challenge.starts_at;
  const endMs = challenge.ends_at ? Date.parse(challenge.ends_at) : Date.now();
  const windowEnd = new Date(Math.min(Date.now(), endMs)).toISOString();

  const { data: sessions } = await supabase
    .from('activity_sessions')
    .select('type, started_at, duration_sec, distance_m, steps, verification')
    .eq('user_id', userId)
    .gte('started_at', windowStart)
    .lte('started_at', windowEnd)
    .order('started_at', { ascending: true });

  let stepWindows: any[] = [];
  if (challenge.rule?.kind === 'step_window') {
    const { data: windows } = await supabase
      .from('daily_step_windows')
      .select('date, before_9am, midday_12_14, after_6pm')
      .eq('user_id', userId)
      .gte('date', windowStart.slice(0, 10))
      .lte('date', windowEnd.slice(0, 10));
    stepWindows = windows ?? [];
  }

  const ctx = buildContext(sessions ?? [], utcOffsetMinutes, stepWindows);
  const { progress, target, met } = evaluateChallenge(challenge.rule, ctx);
  const frac = target > 0 ? Math.max(0, Math.min(1, progress / target)) : met ? 1 : 0;
  // "So far today" figure (e.g. 2,567 / 10,000 steps) for goals where a day is
  // partially in progress — surfaced on the card so momentum is visible before a
  // day counts. null for goals with no partial notion (distinct_days, count_*).
  const momentum = evaluateMomentum(challenge.rule, ctx, utcOffsetMinutes);

  // Already credited — keep the progress bar fresh and return (idempotent). The
  // goal's met, so there's no "today" momentum left to show → clear it.
  if (part.completed || part.base_awarded) {
    await supabase.from('shared_challenge_participants')
      .update({ progress: frac, momentum: null })
      .eq('challenge_id', challenge.id).eq('user_id', userId);
    return { met: true, progress: frac, newlyCompleted: false };
  }

  if (!met) {
    await supabase.from('shared_challenge_participants')
      .update({ progress: frac, momentum })
      .eq('challenge_id', challenge.id).eq('user_id', userId);
    return { met: false, progress: frac, newlyCompleted: false };
  }

  // First time MET. Claim the award by flipping base_awarded false→true in a
  // single conditional update; the loser of a client/cron race matches 0 rows.
  const { data: claimed } = await supabase
    .from('shared_challenge_participants')
    .update({
      state: 'completed',
      completed: true,
      base_awarded: true,
      progress: 1,
      momentum: null,
      completed_at: new Date().toISOString(),
    })
    .eq('challenge_id', challenge.id)
    .eq('user_id', userId)
    .eq('base_awarded', false)
    .select('user_id')
    .maybeSingle();

  if (!claimed) return { met: true, progress: 1, newlyCompleted: false }; // lost the race — no-op

  const { error: ptErr } = await supabase.from('point_transactions').insert({
    user_id: userId,
    amount: challenge.base_points,
    type: 'earn',
    source: 'shared_challenge',
    description: `Together challenge: ${challenge.template?.title ?? 'Challenge'} (+${challenge.base_points})`,
  });
  if (ptErr) {
    // Roll the flag back so a retry can re-award — the safe failure direction.
    await supabase.from('shared_challenge_participants')
      .update({ state: 'accepted', completed: false, base_awarded: false, completed_at: null })
      .eq('challenge_id', challenge.id).eq('user_id', userId);
    console.error('[evaluateParticipant] base award failed, rolled back:', ptErr);
    return { met: true, progress: 1, newlyCompleted: false };
  }

  // Nudge the other live participants that someone finished their part.
  const { data: others } = await supabase
    .from('shared_challenge_participants')
    .select('user_id')
    .eq('challenge_id', challenge.id)
    .neq('user_id', userId)
    .not('state', 'in', '(declined,left)');
  const { data: prof } = await supabase
    .from('profiles').select('username, display_name').eq('id', userId).maybeSingle();
  const name = prof?.display_name || prof?.username || 'A friend';
  for (const o of others ?? []) {
    await notifyPush(o.user_id, 'challenge_friend_finished', {
      challenge_id: challenge.id,
      from_name: name,
      title: challenge.template?.title ?? 'your challenge',
    });
  }

  return { met: true, progress: 1, newlyCompleted: true };
}

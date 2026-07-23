// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Shared streak recompute. Replaces the duplicated copies that lived in
// claim-points and send-push-notification — one algorithm, one file, so the
// bonus math, the "Day N" push copy, and the app card can never drift apart.
//
// Streak = consecutive distinct UTC activity days ending today or yesterday,
// computed straight from activity_sessions (verification != 'manual'). We do
// NOT read user_streaks.current_streak: it's a denormalised cache that
// out-of-order/backdated writes can transiently corrupt; recomputing from
// source makes every surface self-correct.
//
// BRIDGE DAYS: a completed streak rescue (streak_rescues.status = 'completed')
// makes its missed_day count as an active day, so a rescued streak is restored
// everywhere this function is consulted — bonus math, push copy, and (via the
// mirrored client hook) the app card — without ever faking a session row.

export async function streakFromSessions(supabase: any, userId: string): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceIso = since.toISOString();

  const [{ data: sessions }, { data: rescues }] = await Promise.all([
    supabase
      .from('activity_sessions')
      .select('started_at')
      .eq('user_id', userId)
      .neq('verification', 'manual')
      .gte('started_at', sinceIso)
      .order('started_at', { ascending: false }),
    supabase
      .from('streak_rescues')
      .select('missed_day')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('missed_day', sinceIso.slice(0, 10)),
  ]);

  const daySet = new Set<string>(
    (sessions ?? []).map((s: { started_at: string }) => s.started_at.slice(0, 10)),
  );
  for (const r of rescues ?? []) {
    if (r?.missed_day) daySet.add(String(r.missed_day).slice(0, 10));
  }

  const uniqueDays = [...daySet].sort().reverse();

  const todayStr = new Date().toISOString().slice(0, 10);
  const yd = new Date();
  yd.setDate(yd.getDate() - 1);
  const yesterdayStr = yd.toISOString().slice(0, 10);

  if (uniqueDays.length === 0 || (uniqueDays[0] !== todayStr && uniqueDays[0] !== yesterdayStr)) {
    return 0;
  }

  let streak = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    const a = new Date(uniqueDays[i - 1]).getTime();
    const b = new Date(uniqueDays[i]).getTime();
    if (a - b === 86400000) streak++;
    else break;
  }
  return streak;
}

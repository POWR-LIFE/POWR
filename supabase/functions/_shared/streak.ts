// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Shared streak recompute. Replaces the duplicated copies that lived in
// claim-points and send-push-notification — one algorithm, one file, so the
// bonus math, the "Day N" push copy, and the app card can never drift apart.
//
// Streak = consecutive distinct activity days ending today or yesterday,
// computed straight from activity_sessions (verification != 'manual'). We do
// NOT read user_streaks.current_streak: it's a denormalised cache that
// out-of-order/backdated writes can transiently corrupt; recomputing from
// source makes every surface self-correct.
//
// DAY BOUNDARIES ARE THE USER'S LOCAL ONES, NOT UTC. This used to slice the
// UTC date off started_at, which quietly destroyed streaks for every user east
// of UTC. walkingSync writes a walking session at LOCAL MIDNIGHT of the day it
// represents (see lib/health/walkingSync.ts startOfDaysAgo), so under BST that
// row is stored at 23:00 UTC the PREVIOUS day. Bucketing on the UTC date filed
// it a day early, punched a hole in the run, and the loop broke at the first
// gap. It only showed on walk-only days — a gym session mid-afternoon has the
// same UTC and local date and papered over it — which is why it survived so
// long. Field-caught 2026-08-07: a 13-day streak recomputed to 1, and the push
// told the user "Day 1 streak".
//
// The old comment in hooks/useStreak.ts called this divergence "a rare ±1-day
// edge near midnight". It is not rare: the walking sync writes EVERY one of
// those rows exactly on the boundary, so for a positive-offset user it misfires
// every single time. hooks/useStreak.ts already buckets by device-local date;
// this function now agrees with it, and with streak_rescues.missed_day, which
// has always been stored as the user's local date.
//
// BRIDGE DAYS: a completed streak rescue (streak_rescues.status = 'completed')
// makes its missed_day count as an active day, so a rescued streak is restored
// everywhere this function is consulted — bonus math, push copy, and (via the
// mirrored client hook) the app card — without ever faking a session row.

// Users who have never registered a push token on a build carrying
// lib/api/notifications.ts's timezone write have no profiles.timezone. Falling
// back to UTC would reintroduce the exact bug this function exists to fix for
// the majority of the user base, so we fall back to POWR's home market instead.
// This is a stopgap, not a design: the durable fix is backfilling the column.
const FALLBACK_TZ = 'Europe/London';

/** YYYY-MM-DD for an instant, in the given IANA zone. 'en-CA' yields ISO order.
 *  Falls back to the UTC slice if the zone is unknown to the runtime, so a bad
 *  profiles.timezone value degrades to the old behaviour rather than throwing
 *  on the points path. */
function localDayKey(instant: string | Date, timeZone: string): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export async function streakFromSessions(supabase: any, userId: string): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceIso = since.toISOString();

  const [{ data: profile }, { data: sessions }, { data: rescues }] = await Promise.all([
    supabase
      .from('profiles')
      .select('timezone')
      .eq('id', userId)
      .maybeSingle(),
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

  const tz = profile?.timezone || FALLBACK_TZ;

  const daySet = new Set<string>(
    (sessions ?? []).map((s: { started_at: string }) => localDayKey(s.started_at, tz)),
  );
  // missed_day is already a bare local date — no conversion, it is not an instant.
  for (const r of rescues ?? []) {
    if (r?.missed_day) daySet.add(String(r.missed_day).slice(0, 10));
  }

  const uniqueDays = [...daySet].sort().reverse();

  const now = new Date();
  const todayStr = localDayKey(now, tz);
  const yesterdayStr = localDayKey(new Date(now.getTime() - 86400000), tz);

  if (uniqueDays.length === 0 || (uniqueDays[0] !== todayStr && uniqueDays[0] !== yesterdayStr)) {
    return 0;
  }

  // Date-only strings parse as UTC midnight, so the difference between two
  // adjacent local days is always exactly 86400000 — DST transitions included.
  // Comparing Date objects built from local wall-clock time would NOT be safe
  // here: the clocks-go-back day is 25 hours long.
  let streak = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    const a = new Date(uniqueDays[i - 1]).getTime();
    const b = new Date(uniqueDays[i]).getTime();
    if (a - b === 86400000) streak++;
    else break;
  }
  return streak;
}

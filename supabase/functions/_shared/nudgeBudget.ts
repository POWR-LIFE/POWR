// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
//
// Anti-bombardment budget, enforced at the send-push chokepoint.
//
// Every type in notification_config carries a class:
//   receipt — self-caused payoff moments; sent freely (optionally per-type capped)
//   social  — a human is waiting; individually toggleable, budget-exempt
//   nudge   — WE want something from the user; ALL nudge types share one
//             daily pool (system_config.nudge_daily_cap, default 1), counted
//             in the user's local day. Wiring a new nudge type can therefore
//             never increase how many nudges a user receives — only which
//             nudge wins the day's slot.
//
// Counting uses push_send_log (every real send attempt already logs there;
// status='skipped' rows are gate refusals and don't consume budget). The pool
// is first-come: the priority ordering lives in WHEN each nudge fires (streak
// risk at 20:00 local beats an unused evening slot; a morning daily reminder
// takes the slot before an evening nudge can).

// UTC instant of the current local midnight in an IANA zone. Falls back to
// treating the zone as UTC if Intl can't resolve it (bad tz string).
export function localDayStartUtc(tz: string): Date {
  try {
    const now = new Date();
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now); // YYYY-MM-DD
    const guess = new Date(`${ymd}T00:00:00Z`);
    // Offset of tz at that instant = (wall clock in tz) - (wall clock in UTC).
    const tzMs = new Date(guess.toLocaleString('en-US', { timeZone: tz })).getTime();
    const utcMs = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
    return new Date(guess.getTime() - (tzMs - utcMs));
  } catch {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}

/**
 * Returns a skip reason ('type_daily_cap' | 'nudge_budget') when the send
 * should be suppressed, or null to proceed. Fails open: budget plumbing must
 * never mute the push path outright.
 */
export async function nudgeBudgetGate(
  supabase: any,
  userId: string,
  type: string,
  cls: string | null,
  dailyCap: number | null,
): Promise<string | null> {
  try {
    if (dailyCap == null && cls !== 'nudge') return null;

    const { data: prof } = await supabase
      .from('profiles')
      .select('timezone')
      .eq('id', userId)
      .maybeSingle();
    const dayStart = localDayStartUtc(prof?.timezone?.trim() || 'Europe/London').toISOString();

    if (dailyCap != null) {
      const { count } = await supabase
        .from('push_send_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('type', type)
        .neq('status', 'skipped')
        .gte('created_at', dayStart);
      if ((count ?? 0) >= dailyCap) return 'type_daily_cap';
    }

    if (cls === 'nudge') {
      const [{ data: nudgeTypes }, { data: capRow }] = await Promise.all([
        supabase.from('notification_config').select('type').eq('class', 'nudge'),
        supabase.from('system_config').select('value').eq('key', 'nudge_daily_cap').maybeSingle(),
      ]);
      const pool = (nudgeTypes ?? []).map((r: { type: string }) => r.type);
      const cap = Math.max(1, parseInt(capRow?.value ?? '1', 10) || 1);
      if (pool.length > 0) {
        const { count } = await supabase
          .from('push_send_log')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .in('type', pool)
          .neq('status', 'skipped')
          .gte('created_at', dayStart);
        if ((count ?? 0) >= cap) return 'nudge_budget';
      }
    }

    return null;
  } catch (err) {
    console.warn('[nudgeBudget] gate failed open:', err);
    return null;
  }
}

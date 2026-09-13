/**
 * What the DEVICE has said about a visit, read from gym_visit_events, for two
 * beacon decisions that must never invert:
 *
 *   1. A visit the device has DISOWNED — answered a wake with
 *      `confirmed_outside{reason:'no_active_session'}` — is not a session. It is
 *      the drive-by shape: the passive stream delivered one fix inside a 25 m
 *      circle on a road past a gym, the check-in opened a server visit, the next
 *      fix was outside and the client finalized locally, but the close never
 *      landed (the open's answer never reached the phone, so it held no visit id
 *      to close). Field 2026-09-07, member "Butt" (Android): 11 visits in 9 days,
 *      all disowned on every wake, none closed by the device, one sitting on Live
 *      Ops as CLAIM OVERDUE at 153 minutes. Such a visit should close as
 *      `disowned_by_device` the moment the device says so, not collect four
 *      nudges and wait 12 h for the abandon net.
 *
 *   2. The settle pass pays "no exit observed" visits. A `confirmed_outside`
 *      answer AFTER the last proof is an exit observed — by the device itself —
 *      and the settle must not pay across it. Since 20260906170000 a drive-by
 *      check-in carries a creditable fix, so its proof clock is NOT null; without
 *      this guard the settle would pay a member 15 points for driving past a gym
 *      35 minutes earlier. The location-detected exit logs no `exit` region
 *      event (only the OS fence handler does), so `noExitSince` cannot see it.
 *
 * Pure so it can be unit-tested; the beacon supplies the rows.
 */

export interface VisitEventRow {
  event: string;
  created_at: string;
  detail: { reason?: string | null } | null;
}

/** How many wakes the device answered with "I hold no session for this". */
export function disownedAnswers(events: VisitEventRow[]): number {
  let n = 0;
  for (const e of events) {
    if (e.event === 'confirmed_outside' && e.detail?.reason === 'no_active_session') n++;
  }
  return n;
}

/**
 * True when the device reported itself OUTSIDE (for any reason) after `sinceIso`
 * (typically the visit's last proof). If `sinceIso` is null/undefined, any
 * `confirmed_outside` counts as a contradiction (fail closed).
 * A malformed timestamp counts as a contradiction: the settle pays real points,
 * and "could not read the evidence" must fail closed.
 */
export function deviceContradictsPresence(events: VisitEventRow[], sinceIso: string | null | undefined): boolean {
  const since = sinceIso ? Date.parse(sinceIso) : Number.MIN_SAFE_INTEGER;
  for (const e of events) {
    if (e.event !== 'confirmed_outside') continue;
    const at = Date.parse(e.created_at);
    if (!Number.isFinite(at) || !Number.isFinite(since)) return true;
    if (at > since) return true;
  }
  return false;
}

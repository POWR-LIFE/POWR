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
 *   3. Both of the above need the device to ANSWER A WAKE, and a phone with no
 *      push token cannot be woken. Field 2026-09-19, member on Android with
 *      notifications denied and zero token rows: a ride past a roadside gym
 *      opened a visit at 11:17, the phone was 9 km away by 13:09 and said so
 *      every ~15 minutes — in its own `sweep` rows, written on the device ticket
 *      with no push involved — and the visit still sat on Live Ops as CLAIM
 *      OVERDUE at 156 minutes, waiting for the 12 h abandon net. A sweep row
 *      carries the fix's accuracy, its age, and the distance to the nearest
 *      partner; the visit's venue cannot be nearer than the nearest partner, so
 *      `nearest_m - acc_m` is a floor on how far the device stood from it.
 *      `sweepWitnessesOutside` reads that as the same statement a
 *      `no_active_session` answer makes, under stricter terms because nobody
 *      asked the question: TWO independent fixes, both taken after the last
 *      thing the device said from inside, both clear of the exit bound by a
 *      wide margin.
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

export interface SweepRow {
  created_at: string;
  detail: {
    outcome?: string | null;
    acc_m?: number | null;
    age_s?: number | null;
    nearest_m?: number | null;
  } | null;
}

/** A sweep fix coarser than this proves nothing about where the device stood. */
export const SWEEP_WITNESS_MAX_ACC_M = 50;
/** Added to the venue's exit bound (radius + hysteresis). Wide on purpose: this
 *  closes a visit nobody asked the device about, and indoor GPS wanders. */
export const SWEEP_WITNESS_MARGIN_M = 150;
/** Two sweeps can report the SAME cached fix (the sweep reads the OS cache, up
 *  to ten minutes old). Witnesses must be this far apart in FIX time to count
 *  as two observations. */
export const SWEEP_WITNESS_MIN_GAP_MS = 60_000;
export const SWEEP_WITNESSES_REQUIRED = 2;

/**
 * How many independent sweep fixes, taken after `sinceIso`, put the device
 * clear of the venue. `exitBoundM` is the venue's radius plus the client's exit
 * hysteresis — the distance at which the client itself would call it an exit.
 *
 * The clock is the FIX's, not the row's: `created_at - age_s`. A sweep logged
 * after the last proof can carry a fix from before it, and where the device
 * USED to be says nothing about whether it has left. A row that cannot be read
 * (missing numbers, malformed time) is not a witness — this closes visits, so
 * unreadable evidence fails toward leaving the visit open.
 */
export function sweepWitnessesOutside(
  sweeps: SweepRow[],
  sinceIso: string | null | undefined,
  exitBoundM: number,
): number {
  const since = sinceIso ? Date.parse(sinceIso) : NaN;
  if (!Number.isFinite(since) || !Number.isFinite(exitBoundM)) return 0;

  const fixTimes: number[] = [];
  for (const s of sweeps) {
    const d = s.detail;
    if (!d || d.outcome !== 'handoff') continue;
    if (!Number.isFinite(acc_m) || !Number.isFinite(age_s) || !Number.isFinite(nearest_m) || acc_m < 0 || age_s < 0) continue;
    const loggedAt = Date.parse(s.created_at);
    if (!Number.isFinite(loggedAt)) continue;
    const fixAt = loggedAt - age_s * 1000;
    if (fixAt <= since) continue;
    if (nearest_m - acc_m < exitBoundM + SWEEP_WITNESS_MARGIN_M) continue;
    fixTimes.push(fixAt);
  }

  fixTimes.sort((a, b) => a - b);
  let n = 0;
  let last = -Infinity;
  for (const t of fixTimes) {
    if (t - last >= SWEEP_WITNESS_MIN_GAP_MS) { n++; last = t; }
  }
  return n;
}

/** The latest moment the device said anything from INSIDE the visit. A loose
 *  `inside` confirm (last_confirmed_at) counts: it is weaker than a proof, but
 *  this guard closes visits, and a newer "inside" of any strength outranks an
 *  older sweep. */
export function lastInsideWordIso(v: {
  started_at: string;
  last_proven_at?: string | null;
  last_confirmed_at?: string | null;
}): string {
  let best = v.started_at;
  for (const c of [v.last_proven_at, v.last_confirmed_at]) {
    if (c && Date.parse(c) > Date.parse(best)) best = c;
  }
  return best;
}

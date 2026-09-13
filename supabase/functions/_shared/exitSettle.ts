/**
 * Stage 3 of the beacon's settle pass: visits the device CLOSED on its way out
 * but never claimed.
 *
 * The 30 days to 2026-09-06 (real iOS members): 10 of 73 paid sessions were
 * claimed more than 90 minutes after check-in, and every one of them had an
 * exit or an app-open that could have paid it at the moment it happened. The
 * exit path claims from the device when the relaunched app manages the round
 * trip; when it does not (spent token, frozen auth, the close landed through
 * the ticket but the claim needs a session), the visit sits closed, proven and
 * unpaid until the member opens the app.
 *
 * Stages 1 and 2 select only OPEN visits, so they never see these. This stage
 * selects closed-by-exit, proven, unclaimed visits and pays them for the length
 * the close recorded — which, since 20260906170000, is the exit fence's own
 * time for a proven visit.
 *
 * Pure so it can be unit-tested; the beacon supplies rows and events.
 */

/** How long after the close the DEVICE keeps right-of-way. The relaunched app
 *  claims in seconds when it can at all (bench 2.4 s cold-start); three minutes
 *  is that with a wide margin, and the claim paths are idempotent either way. */
export const EXIT_SETTLE_RIGHT_OF_WAY_MS = 3 * 60 * 1000;

/** Only recent closes. Mirrors claim-points' own 6 h late-stamp window, so a
 *  settle here always finds a visit claim-points is still willing to mark. */
export const EXIT_SETTLE_LOOKBACK_MS = 6 * 60 * 60 * 1000;

/** Transient failures get this many tries; a terminal one stops at once. */
export const EXIT_SETTLE_MAX_ATTEMPTS = 3;

export interface ExitSettleVisit {
  started_at: string;
  ended_at: string | null;
  close_reason: string | null;
  claimed_session_id: string | null;
  last_proven_at: string | null;
}

export interface SettleEvent {
  event: string;
  detail: { stage?: string | null; terminal?: boolean | null } | null;
}

/** True when the visit is one this stage should pay now. */
export function exitSettleDue(v: ExitSettleVisit, dwellMin: number, nowMs: number): boolean {
  if (v.close_reason !== 'exit') return false;
  if (v.claimed_session_id) return false;
  if (!v.last_proven_at) return false;          // never proved presence — not ours to pay
  if (!v.ended_at) return false;
  const started = Date.parse(v.started_at);
  const ended = Date.parse(v.ended_at);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return false;
  if (ended - started < dwellMin * 60 * 1000) return false;   // under the threshold: nothing to pay
  if (nowMs - ended < EXIT_SETTLE_RIGHT_OF_WAY_MS) return false;
  if (nowMs - ended > EXIT_SETTLE_LOOKBACK_MS) return false;
  return true;
}

/** True when this stage must NOT try again: already settled, refused for
 *  good, or out of transient attempts. */
export function exitSettleExhausted(events: SettleEvent[]): boolean {
  let failures = 0;
  for (const e of events) {
    if (e.detail?.stage !== 'exit') continue;
    if (e.event === 'settled') return true;
    if (e.event === 'settle_failed') {
      if (e.detail?.terminal) return true;
      failures++;
    }
  }
  return failures >= EXIT_SETTLE_MAX_ATTEMPTS;
}

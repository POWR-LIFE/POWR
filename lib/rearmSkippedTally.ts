/**
 * Tally for refused fence re-arms — pure, no React Native imports.
 *
 * Android refuses every background re-arm of a live registration by design
 * (`background_would_destroy`, see armNativeRegions), and the location stream
 * asks on nearly every fix. On 2026-09-06 the two real Android members had
 * 8,638 `rearm_skipped` rows between them in 30 days — 150–250 rows a day per
 * phone, the single largest source of geofence telemetry and, at scale, the
 * first ceiling in docs/scaling-plan.md. The information in those rows is one
 * number: "fences have been stale for N hours, over M attempts".
 *
 * So: the FIRST refusal for a reason is reported at once (a fresh headless
 * process behaves like this on every wake, and "fences are stale" must never be
 * a fact we learn late), then one row per REARM_SKIPPED_ROW_INTERVAL_MS carrying
 * the number of refusals it stands for. A successful arm flushes whatever is
 * pending so a count is never lost to a process that lived less than the window.
 */
export const REARM_SKIPPED_ROW_INTERVAL_MS = 30 * 60_000;

export type RearmSkippedTally = {
  reason: string;
  /** refusals since the last row went out */
  count: number;
  /** when this reason was first seen in this process */
  since: number;
  lastRowAt: number;
};

export type RearmSkippedRow = { reason: string; count: number; window_s: number };

export type RearmSkippedDecision =
  | { emit: true; row: RearmSkippedRow; next: RearmSkippedTally }
  | { emit: false; next: RearmSkippedTally };

/** One refusal just happened. Says whether a row goes out now, and the state to keep. */
export function rearmSkippedDecision(
  prev: RearmSkippedTally | null,
  reason: string,
  now: number,
): RearmSkippedDecision {
  if (!prev || prev.reason !== reason) {
    // A pending tally for a DIFFERENT reason is not lost: callers flush before a
    // reason change would matter (the arm path), and a reason change is rare.
    return {
      emit: true,
      row: { reason, count: 1, window_s: 0 },
      next: { reason, count: 0, since: now, lastRowAt: now },
    };
  }
  const count = prev.count + 1;
  if (now - prev.lastRowAt >= REARM_SKIPPED_ROW_INTERVAL_MS) {
    return {
      emit: true,
      row: { reason, count, window_s: Math.round((now - prev.lastRowAt) / 1000) },
      next: { reason, count: 0, since: prev.since, lastRowAt: now },
    };
  }
  return { emit: false, next: { ...prev, count } };
}

/** An arm is about to succeed: ship whatever the tally holds, then forget it. */
export function rearmSkippedFlush(
  prev: RearmSkippedTally | null,
  now: number,
): { row: RearmSkippedRow | null; next: null } {
  if (!prev || prev.count <= 0) return { row: null, next: null };
  return {
    row: { reason: prev.reason, count: prev.count, window_s: Math.round((now - prev.lastRowAt) / 1000) },
    next: null,
  };
}

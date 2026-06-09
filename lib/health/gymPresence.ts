/**
 * Pure logic for reconciling a geofence gym session's duration against the
 * device health store (step samples). Kept free of native/Supabase imports so it
 * can be unit-tested — the native readers and DB write live in `gymReconcile.ts`.
 *
 * Why: a gym session's GPS-derived window can be wrong at the edges — entry
 * detected late (under-counts), or a missed/late EXIT leaving an inflated end
 * (over-counts). The health store keeps logging steps even when our app is dead
 * and works indoors where GPS fails, so the span of real step activity is a
 * strong, conservative correction signal.
 */

/** A timestamped step sample from HealthKit / Health Connect. */
export type StepSample = { startMs: number; endMs: number; steps: number };

export type CorrectedWindow = {
  startMs: number;
  endMs: number;
  durationSec: number;
  /** True when the health signal actually moved a boundary. */
  changed: boolean;
};

/** Backdate entry to first activity, but no more than this before detected entry. */
export const ENTRY_BACKDATE_MARGIN_MS = 30 * 60 * 1000; // 30 min
/** Only pull the exit back if the recorded end trails real activity by at least this. */
export const EXIT_SHRINK_MIN_GAP_MS = 20 * 60 * 1000; // 20 min
/** Keep a short cool-down after the last activity when shrinking the exit. */
export const EXIT_COOLDOWN_BUFFER_MS = 5 * 60 * 1000; // 5 min
/** Backstop — mirrors MAX_GYM_SESSION_SEC in GeofenceContext / upgrade-gym-tier. */
export const MAX_GYM_SESSION_MS = 12 * 60 * 60 * 1000; // 12 h

/**
 * Corrects a GPS-detected gym window using step activity.
 *
 * Conservative by design:
 *  - With no step signal, the GPS window is returned unchanged (never invented).
 *  - Entry is only ever moved EARLIER (recover late detection), capped to a margin
 *    so unrelated earlier activity can't drag the start back arbitrarily.
 *  - Exit is only pulled IN, and only when the recorded end clearly trails real
 *    activity (a missed/late EXIT) — normal end-of-session trailing gaps are kept.
 */
export function computeCorrectedWindow(
  detectedStartMs: number,
  detectedEndMs: number,
  samples: StepSample[],
): CorrectedWindow {
  const unchanged = (): CorrectedWindow => ({
    startMs: detectedStartMs,
    endMs: detectedEndMs,
    durationSec: Math.max(0, Math.round((detectedEndMs - detectedStartMs) / 1000)),
    changed: false,
  });

  const active = samples.filter(s => s.steps > 0 && s.endMs > s.startMs);
  if (active.length === 0) return unchanged();

  const firstActiveMs = Math.min(...active.map(s => s.startMs));
  const lastActiveMs = Math.max(...active.map(s => s.endMs));

  // ── Entry: backdate to first activity if the user was already moving before
  //    geofence detection, capped so the start can't be pulled back more than the margin.
  let startMs = detectedStartMs;
  if (firstActiveMs < detectedStartMs) {
    startMs = Math.max(firstActiveMs, detectedStartMs - ENTRY_BACKDATE_MARGIN_MS);
  }

  // ── Exit: if the recorded end trails real activity by a lot, the EXIT fired late
  //    (or duration came from entry→now). Pull it back to just after the last activity.
  let endMs = detectedEndMs;
  if (detectedEndMs - lastActiveMs > EXIT_SHRINK_MIN_GAP_MS) {
    endMs = lastActiveMs + EXIT_COOLDOWN_BUFFER_MS;
  }

  // Guard rails: ordered, non-negative, within the 12 h backstop.
  if (endMs < startMs) endMs = startMs;
  if (endMs - startMs > MAX_GYM_SESSION_MS) endMs = startMs + MAX_GYM_SESSION_MS;

  return {
    startMs,
    endMs,
    durationSec: Math.round((endMs - startMs) / 1000),
    changed: startMs !== detectedStartMs || endMs !== detectedEndMs,
  };
}

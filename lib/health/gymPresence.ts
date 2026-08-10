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

/**
 * Backdate entry to first activity, but no more than this before detected entry.
 *
 * ⚠ WAS 30 MIN, AND THAT WAS A LIVE DATA-INTEGRITY BUG. Field 2026-08-09: a
 * 44-minute visit was rewritten to 77 minutes on a settled, claimed, upgraded,
 * CLOSED session — `started_at` moved back by exactly 1800000 ms, the full width
 * of this margin. The step activity it "corrected" against was the owner walking
 * TO the venue.
 *
 * Steps recorded before the geofence fired are, by definition, steps taken
 * OUTSIDE it. This signal cannot separate "already inside, detected late" from
 * "on the way here" — both are just movement before entry. So the margin has to
 * be sized to the error it is actually correcting: observed late detection is
 * 24 s (iOS 08-08), 56 s (Android 08-08) and 216 s (Android 08-09, its worst).
 * Five minutes covers every measured case with headroom; thirty was longer than
 * most people's entire approach.
 */
export const ENTRY_BACKDATE_MARGIN_MS = 5 * 60 * 1000; // 5 min
/** Only pull the exit back if the recorded end trails real activity by at least this. */
export const EXIT_SHRINK_MIN_GAP_MS = 20 * 60 * 1000; // 20 min
/** Keep a short cool-down after the last activity when shrinking the exit. */
export const EXIT_COOLDOWN_BUFFER_MS = 5 * 60 * 1000; // 5 min
/** Backstop — mirrors MAX_GYM_SESSION_SEC in GeofenceContext / upgrade-gym-tier. */
export const MAX_GYM_SESSION_MS = 12 * 60 * 60 * 1000; // 12 h

/**
 * Accuracy beyond this buys NO further protection from an exit decision.
 *
 * ⚠ The exit bound used to be `radius + hysteresis + accuracy`, unbounded, which
 * inverted under bad conditions: the less the device knew, the more protection it
 * granted. Field 2026-08-10, both platforms — Android sat 334 m away on 900 m fixes
 * (bound 970 m) and iOS 544 m away on 930 m fixes (bound 1000 m), and neither could
 * ever close. A fix that vague is not evidence of presence and must not be treated
 * as a reason to keep earning.
 *
 * 30 m caps the bound at 100 m on a 20 m fence, which is the product answer: a user
 * 100 m outside has left, and people who live near a venue must not stay checked in.
 * Safety moves from precision to REPETITION — see exitReadingsRequired.
 */
export const EXIT_ACCURACY_CREDIT_CAP_M = 30;

/**
 * How far outside the fence a fix must place someone before it counts as evidence
 * they have gone. Bounded, so exit is always reachable.
 */
export function exitBoundM(radiusM: number, hysteresisM: number, accuracyM: number | null): number {
  return radiusM + hysteresisM + Math.min(Math.max(accuracyM ?? 0, 0), EXIT_ACCURACY_CREDIT_CAP_M);
}

/**
 * Consecutive outside readings before a session closes.
 *
 * This is what replaces the unbounded accuracy term. That term existed to stop one
 * wild fix ending a live session; capping it would have reopened that risk, so the
 * guard becomes repetition instead. Two independent readings agreeing is stronger
 * evidence than one precise one, and it is the pattern this codebase already trusts
 * (NO_FIX_STREAK_BROKEN, the location-loss confirmation marker).
 */
export const EXIT_READINGS_REQUIRED = 2;

/**
 * Does this fix justify BILLING the time up to now — as opposed to merely keeping
 * the session open?
 *
 * The two questions have opposite risk profiles and must not share a test.
 * Staying open should be generous: a coarse fix must never flap a real session
 * out, so the caller's `inside` check adds a 50 m hysteresis band and defaults to
 * true when the fix is unusable. Crediting time must be strict, because whatever
 * it certifies is what the user is told they earned.
 *
 * Field 2026-08-09: the generous test stamped the credit floor at distance 67 m
 * against a 20 m fence, nine minutes after the owner had left, and the completion
 * push then reported "60 min" for a 50.5-minute visit.
 *
 * The fix's own error bar counts as honest evidence — if the venue is inside it,
 * the user plausibly is too. The hysteresis band does not: it exists to damp
 * oscillation, not to describe anybody's position.
 */
export function fixCreditsPresence(opts: {
  fixTrusted: boolean;
  distanceM: number | null;
  radiusM: number | null;
  accuracyM: number | null;
}): boolean {
  const { fixTrusted, distanceM, radiusM, accuracyM } = opts;
  if (!fixTrusted) return false;
  if (distanceM == null || radiusM == null) return false;
  return distanceM <= radiusM + (accuracyM ?? 0);
}

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
  //    geofence detection — but ONLY when that activity begins inside the margin.
  //
  // ⚠ DO NOT RESTORE THE CLAMP. This used to read
  //     startMs = Math.max(firstActiveMs, detectedStartMs - ENTRY_BACKDATE_MARGIN_MS)
  // which, whenever activity reached back FURTHER than the margin, silently
  // awarded the entire margin. That is exactly backwards: activity extending well
  // before entry is the signature of an approach walk, not of late detection, and
  // the clamp turned the least-trustworthy input into the maximum correction.
  // It cost 33 phantom minutes on a closed session (see the margin's note above).
  //
  // Now a run of activity that starts beyond the margin buys nothing at all: we
  // cannot tell where the user was, so we decline to guess and keep the
  // geofence's own boundary. Same instinct as the exit clamp — miss rather than
  // invent.
  let startMs = detectedStartMs;
  if (firstActiveMs < detectedStartMs && firstActiveMs >= detectedStartMs - ENTRY_BACKDATE_MARGIN_MS) {
    startMs = firstActiveMs;
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

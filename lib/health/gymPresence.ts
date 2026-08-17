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
 * The immutable facts about a session that the reconciler must NOT derive from the
 * row it rewrites. Both come from `gym_visits`, which this writer never touches.
 *
 * ⚠ WHY THIS EXISTS — field 2026-08-17, Android visit/session `ae15fa06`. The
 * reconciler read its step window from the session row's OWN `started_at` and
 * compared the backdate margin against that same value, so every pass moved the
 * anchor it would read from next time: a self-feeding ratchet, one margin per pass,
 * limited only by how long the approach walk was. The same run also collapsed a real
 * 40.4-minute visit (13:19:45.988 → 14:00:11.377, 2425 s, 20 points already awarded)
 * to 584 s, because Health Connect reported steps for the 4m44s walk in and nothing
 * at all for 40 minutes of lifting — `steps > 0` reads a stationary lifter as absent.
 * The row's fingerprint was `ended_at − started_at` = 584,201 ms against
 * `duration_sec` = 584: only this writer sets all three columns independently.
 *
 * A step stream cannot see someone under a barbell. The geofence could, and said so
 * — so proven presence outranks the absence of steps, always.
 */
export type SessionAnchor = {
  /** `gym_visits.started_at` — the geofence check-in. Null when no visit row exists. */
  visitStartMs: number | null;
  /** `gym_visits.last_proven_at` — the proof clock. Null on pre-proof-clock rows. */
  provenUntilMs: number | null;
};

/**
 * The span of health data to read for a session.
 *
 * Exported and pure so the ratchet is testable: the bug was never in
 * `computeCorrectedWindow` (which is idempotent given fixed samples) but in the
 * caller re-deriving this window from its own last write. The lower bound is
 * anchored on the visit, so it is the same span on every pass forever.
 */
export function stepReadWindow(
  sessionStartMs: number,
  sessionEndMs: number,
  anchor: SessionAnchor | null,
): { fromMs: number; toMs: number } {
  const anchorStartMs = anchor?.visitStartMs ?? sessionStartMs;
  // `min` keeps an already-damaged row (start dragged below the anchor by a
  // pre-fix pass) fully inside the window, so a repair pass can still see it.
  const fromMs = Math.min(sessionStartMs, anchorStartMs) - ENTRY_BACKDATE_MARGIN_MS;
  const provenMs = anchor?.provenUntilMs;
  const toMs =
    (provenMs != null ? Math.max(sessionEndMs, provenMs) : sessionEndMs) + EXIT_COOLDOWN_BUFFER_MS;
  return { fromMs, toMs };
}

/**
 * How far back entry may be moved, in absolute terms.
 *
 * Distinct from the margin: the margin is relative to whatever `started_at` says
 * right now, which is a value this writer edits. This floor is relative to the
 * geofence check-in, which it does not. Without it, "no more than 5 minutes" means
 * five minutes per pass rather than five minutes total.
 */
export function backdateFloorMs(detectedStartMs: number, anchor: SessionAnchor | null): number {
  if (anchor?.visitStartMs == null) {
    // No anchor means no trustworthy reference for "how late did detection fire",
    // so decline to backdate at all. Miss rather than invent — same instinct as the
    // beyond-the-margin refusal below.
    return detectedStartMs;
  }
  return Math.max(detectedStartMs - ENTRY_BACKDATE_MARGIN_MS, anchor.visitStartMs - ENTRY_BACKDATE_MARGIN_MS);
}

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
 * How old a fix may be and still justify BILLING the time up to now.
 *
 * The dwell stream delivers roughly every 60 s while checked in, so two minutes
 * is one tick plus generous jitter: fresh enough that a walk-out stops earning
 * almost immediately, loose enough that a stationary phone indoors still has
 * something creditable to answer a wake with.
 *
 * ⚠ DELIBERATELY NOT APPLIED TO `inside`. Staying open and billing have opposite
 * risk profiles — the same asymmetry EXIT_ACCURACY_CREDIT_CAP_M documents. A
 * stale fix must still hold a real session open (refusing coarse fixes there
 * starved entire dwells on 07-03 and 07-11); it just must not pay for it.
 */
export const MAX_CREDIT_FIX_AGE_MS = 120 * 1000;

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
  /** Age of the fix at the moment of the decision. Omit only where genuinely
   *  unknowable — a missing age is treated as acceptable so existing callers are
   *  unchanged, but every caller that CAN supply it must. */
  fixAgeMs?: number | null;
}): boolean {
  const { fixTrusted, distanceM, radiusM, accuracyM, fixAgeMs } = opts;
  if (!fixTrusted) return false;
  if (distanceM == null || radiusM == null) return false;
  // ⚠ A PRECISE FIX IS NOT A PRESENT ONE. Field 2026-08-10 12:45:02Z: this
  // returned true on accuracy 28 m / distance 18 m and stamped last_proven_at —
  // four minutes AFTER the user walked out, from a fix that was already 219 s old
  // when it was used. The other handset in the same pocket read 193 m at that
  // instant. Trusted accuracy and a short distance describe the fix; only its age
  // describes WHEN it was true, and this test had no opinion about that at all —
  // while the very same event logged `stream_fix_age_s: 219` beside the verdict.
  if (fixAgeMs != null && fixAgeMs > MAX_CREDIT_FIX_AGE_MS) return false;
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
 *  - Neither boundary may cross the geofence's own evidence: `anchor` supplies an
 *    absolute floor for the start and the proof clock as a floor for the end.
 */
export function computeCorrectedWindow(
  detectedStartMs: number,
  detectedEndMs: number,
  samples: StepSample[],
  anchor: SessionAnchor | null = null,
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
  //
  // The floor is a VETO, not a clamp — activity reaching below it buys nothing,
  // rather than being rounded up to it. That distinction is the 08-09 bug.
  let startMs = detectedStartMs;
  const floorMs = backdateFloorMs(detectedStartMs, anchor);
  if (firstActiveMs < detectedStartMs && firstActiveMs >= floorMs) {
    startMs = firstActiveMs;
  }

  // ── Exit: if the recorded end trails real activity by a lot, the EXIT fired late
  //    (or duration came from entry→now). Pull it back to just after the last activity.
  let endMs = detectedEndMs;
  if (detectedEndMs - lastActiveMs > EXIT_SHRINK_MIN_GAP_MS) {
    endMs = lastActiveMs + EXIT_COOLDOWN_BUFFER_MS;
  }

  // ⚠ PROVEN PRESENCE IS A FLOOR — field 2026-08-17 (see SessionAnchor). No absence
  // of steps may shrink the session below time the geofence actually witnessed. The
  // floor is itself capped at the detected end because this function's authority is
  // to narrow a window, never to widen one: growing an end to meet the proof clock
  // is the beacon reaper's job, server-side, where the proof is authoritative.
  const provenMs = anchor?.provenUntilMs;
  if (provenMs != null) {
    const provenFloorMs = Math.min(provenMs, detectedEndMs);
    if (endMs < provenFloorMs) endMs = provenFloorMs;
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

/**
 * Tests for the gym-session presence reconciler (lib/health/gymPresence.ts).
 *
 * `computeCorrectedWindow` is the pure core that corrects a GPS-detected gym
 * window using step activity — the native HealthKit/Health Connect readers around
 * it can't run off-device, so this exercises the logic directly.
 */

import {
  computeCorrectedWindow,
  EXIT_ACCURACY_CREDIT_CAP_M,
  EXIT_COOLDOWN_BUFFER_MS,
  exitBoundM,
  fixCreditsPresence,
  MAX_GYM_SESSION_MS,
  type StepSample,
} from '@/lib/health/gymPresence';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** Build a single step sample spanning [fromMin, toMin] with steps. */
function steps(fromMin: number, toMin: number, count = 100): StepSample {
  return { startMs: fromMin * MIN, endMs: toMin * MIN, steps: count };
}

describe('computeCorrectedWindow', () => {
  it('leaves the window unchanged when there is no step signal', () => {
    const r = computeCorrectedWindow(10 * MIN, 70 * MIN, []);
    expect(r.changed).toBe(false);
    expect(r.startMs).toBe(10 * MIN);
    expect(r.endMs).toBe(70 * MIN);
    expect(r.durationSec).toBe(60 * 60);
  });

  it('ignores zero-step samples (treated as no signal)', () => {
    const r = computeCorrectedWindow(10 * MIN, 70 * MIN, [{ startMs: 0, endMs: 70 * MIN, steps: 0 }]);
    expect(r.changed).toBe(false);
  });

  it('shrinks a missed-exit runaway back to just after the last activity', () => {
    // Detected 0 → 12h (runaway), but steps only span 0 → 50 min.
    const r = computeCorrectedWindow(0, 12 * HOUR, [steps(0, 50)]);
    expect(r.endMs).toBe(50 * MIN + EXIT_COOLDOWN_BUFFER_MS);
    expect(r.startMs).toBe(0);
    expect(r.durationSec).toBe(Math.round((50 * MIN + EXIT_COOLDOWN_BUFFER_MS) / 1000));
    expect(r.changed).toBe(true);
  });

  it('backdates a late-detected entry to first activity, within the margin', () => {
    // Geofence fired 3 min late (Android's measured worst case is 216 s) — the
    // user was already inside and moving. This is the case backdating exists for.
    const r = computeCorrectedWindow(23 * MIN, 65 * MIN, [steps(20, 64)]);
    expect(r.startMs).toBe(20 * MIN);
    expect(r.endMs).toBe(65 * MIN); // trailing gap (1 min) < threshold → kept
    expect(r.changed).toBe(true);
  });

  it('refuses to backdate at all when activity reaches back BEYOND the margin', () => {
    // ⚠ REGRESSION GUARD — field 2026-08-09. This used to clamp to
    // `detected - margin`, so the further back the activity ran the MORE time it
    // awarded. Activity starting long before entry is an approach walk, not late
    // detection; outside the fence is outside the fence.
    const r = computeCorrectedWindow(120 * MIN, 180 * MIN, [steps(0, 175)]);
    expect(r.startMs).toBe(120 * MIN); // unmoved
    expect(r.changed).toBe(false);
  });

  it('does not inflate a settled visit from the walk-in (the 44 → 77 min case)', () => {
    // The real row: entry 10:32:39, exit 11:14:04 (41.4 min recorded), with step
    // activity running from ~10:02 because the owner walked there. The old margin
    // rewrote started_at back a full 30 min and booked 77.5 min.
    const entry = 632 * MIN;         // 10:32
    const exit = 674 * MIN;          // 11:14
    const r = computeCorrectedWindow(entry, exit, [steps(602, 673)]); // walking from 10:02
    expect(r.startMs).toBe(entry);
    expect(r.durationSec).toBe(42 * 60);
    expect(r.durationSec).toBeLessThan(45 * 60);
  });

  it('keeps a normal session with a small trailing gap unchanged', () => {
    // End 60, last steps at 57 → 3-min gap, below the 20-min shrink threshold.
    const r = computeCorrectedWindow(0, 60 * MIN, [steps(0, 57)]);
    expect(r.changed).toBe(false);
    expect(r.endMs).toBe(60 * MIN);
  });

  it('never exceeds the 12 h backstop', () => {
    const r = computeCorrectedWindow(0, 11 * HOUR, [steps(0, 11 * 60)]);
    expect(r.endMs - r.startMs).toBeLessThanOrEqual(MAX_GYM_SESSION_MS);
  });

  it('is idempotent — re-running on a corrected window makes no further change (window)', () => {
    const sample = [steps(0, 50)];
    const first = computeCorrectedWindow(0, 12 * HOUR, sample);
    const second = computeCorrectedWindow(first.startMs, first.endMs, sample);
    expect(second.changed).toBe(false);
    expect(second.startMs).toBe(first.startMs);
    expect(second.endMs).toBe(first.endMs);
  });
});

describe('exitBoundM — exit must always be reachable', () => {
  const RADIUS = 20;
  const HYST = 50;

  it('adds the error bar on a good fix, so a small wobble cannot eject anyone', () => {
    expect(exitBoundM(RADIUS, HYST, 20)).toBe(90);
  });

  it('never exceeds 100 m on a 20 m fence, however bad the fix', () => {
    // ⚠ REGRESSION GUARD — field 2026-08-10. Unbounded, this returned 970 m at
    // 900 m accuracy and 1000 m at 930 m, so two phones 334 m and 544 m away were
    // structurally incapable of closing and billed the time.
    for (const acc of [100, 350, 500, 900, 930, 5000]) {
      expect(exitBoundM(RADIUS, HYST, acc)).toBe(100);
    }
  });

  it('closes the two real field cases that could not close before', () => {
    expect(334).toBeGreaterThan(exitBoundM(RADIUS, HYST, 900)); // Android
    expect(544).toBeGreaterThan(exitBoundM(RADIUS, HYST, 930)); // iOS
  });

  it('treats a missing or negative accuracy as no error bar', () => {
    expect(exitBoundM(RADIUS, HYST, null)).toBe(70);
    expect(exitBoundM(RADIUS, HYST, -5)).toBe(70);
  });

  it('caps the contribution at exactly the documented constant', () => {
    expect(exitBoundM(0, 0, 10_000)).toBe(EXIT_ACCURACY_CREDIT_CAP_M);
  });

  it('still keeps someone just outside the fence checked in (no flapping)', () => {
    // Someone living 80 m from a venue, on a good fix: inside the bound, stays put.
    expect(80).toBeLessThan(exitBoundM(RADIUS, HYST, 20) + 1);
  });
});

describe('fixCreditsPresence — strict to credit, loose to close', () => {
  const RADIUS = 20;

  it('credits a trusted fix inside the radius', () => {
    expect(fixCreditsPresence({ fixTrusted: true, distanceM: 16, radiusM: RADIUS, accuracyM: 20 })).toBe(true);
  });

  it('credits when the venue falls inside the fix\'s own error bar', () => {
    // 35 m away on a 20 m fix — the error bar reaches the fence, so the user
    // plausibly is inside. That is honest evidence.
    expect(fixCreditsPresence({ fixTrusted: true, distanceM: 35, radiusM: RADIUS, accuracyM: 20 })).toBe(true);
  });

  it('REFUSES the field case that billed 9m11s after the owner left', () => {
    // ⚠ REGRESSION GUARD — 2026-08-09. distance 67 m against a 20 m fence on a
    // 46 m fix. The old test was `distance <= radius + 50 hysteresis`, which
    // passed at 67 ≤ 70 and stamped the credit floor nine minutes after the exit.
    expect(fixCreditsPresence({ fixTrusted: true, distanceM: 67, radiusM: RADIUS, accuracyM: 46 })).toBe(false);
  });

  it('refuses an untrusted fix however close it claims to be', () => {
    // The phantom-confirm signature: accuracy 574, distance 49.
    expect(fixCreditsPresence({ fixTrusted: false, distanceM: 49, radiusM: RADIUS, accuracyM: 574 })).toBe(false);
  });

  it('refuses when geometry is unknown rather than assuming presence', () => {
    expect(fixCreditsPresence({ fixTrusted: true, distanceM: null, radiusM: RADIUS, accuracyM: 20 })).toBe(false);
    expect(fixCreditsPresence({ fixTrusted: true, distanceM: 10, radiusM: null, accuracyM: 20 })).toBe(false);
  });

  it('does not use the 50 m hysteresis band as evidence of position', () => {
    // Exactly the band's edge on a perfect fix: open, but not billable.
    expect(fixCreditsPresence({ fixTrusted: true, distanceM: 70, radiusM: RADIUS, accuracyM: 0 })).toBe(false);
  });
});

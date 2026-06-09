/**
 * Tests for the gym-session presence reconciler (lib/health/gymPresence.ts).
 *
 * `computeCorrectedWindow` is the pure core that corrects a GPS-detected gym
 * window using step activity — the native HealthKit/Health Connect readers around
 * it can't run off-device, so this exercises the logic directly.
 */

import {
  computeCorrectedWindow,
  EXIT_COOLDOWN_BUFFER_MS,
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

  it('backdates a late-detected entry to first activity (Sorine case)', () => {
    // Geofence entered at 23 min, but the user was already moving from 0; left ~65.
    const r = computeCorrectedWindow(23 * MIN, 65 * MIN, [steps(0, 64)]);
    expect(r.startMs).toBe(0); // within the 30-min backdate margin
    expect(r.endMs).toBe(65 * MIN); // trailing gap (1 min) < threshold → kept
    expect(r.durationSec).toBe(65 * 60);
    expect(r.changed).toBe(true);
  });

  it('caps how far entry can be backdated (margin)', () => {
    // Activity started 2 h before detection → clamp to detected - 30 min.
    const r = computeCorrectedWindow(120 * MIN, 180 * MIN, [steps(0, 175)]);
    expect(r.startMs).toBe(120 * MIN - 30 * MIN);
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

  it('is idempotent — re-running on a corrected window makes no further change', () => {
    const sample = [steps(0, 50)];
    const first = computeCorrectedWindow(0, 12 * HOUR, sample);
    const second = computeCorrectedWindow(first.startMs, first.endMs, sample);
    expect(second.changed).toBe(false);
    expect(second.startMs).toBe(first.startMs);
    expect(second.endMs).toBe(first.endMs);
  });
});

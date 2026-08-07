/**
 * Telling "the same workout, told twice" apart from "a workout the user split
 * in two" (supabase/functions/_shared/sessionMerge.ts + its client mirror
 * shared/sessionMerge.js).
 *
 * These exist because of a real loss. On 2026-08-06 a ~10 km run was stopped
 * mid-way for a phone call and restarted, so Garmin uploaded two activities.
 * POWR keyed wearable workouts on (user, type, UTC day), so the second one
 * collided with the first, and the conflict handler's rule — keep whichever
 * telling is LONGER — overwrote the first half in place. The stored run was
 * 5.85 km, the first half was unrecoverable, and nothing anywhere recorded that
 * a workout had been dropped.
 *
 * The distinction that matters: a mid-workout fragment and its finished form
 * OVERLAP (same activity, same start, one is just further along), whereas two
 * halves of an interrupted workout do NOT overlap — they sit next to each other
 * with the interruption in between. Overlap therefore means "take the fuller
 * reading", adjacency means "add them up", and the thing that must never happen
 * again is either of them meaning "throw one away".
 */
import {
  CONTIGUOUS_GAP_MIN,
  mergeWorkouts,
  relateWorkouts,
  type WorkoutWindow,
} from '@/supabase/functions/_shared/sessionMerge';

const mirror = require('@/shared/sessionMerge');

const T0 = Date.parse('2026-08-06T05:30:00.000Z');
const min = (n: number) => n * 60_000;

function win(startMin: number, durMin: number, extra: Partial<WorkoutWindow> = {}): WorkoutWindow {
  return {
    startMs: T0 + min(startMin),
    endMs: T0 + min(startMin + durMin),
    durationSec: durMin * 60,
    ...extra,
  };
}

describe('relateWorkouts', () => {
  it('calls an overlapping delivery the same activity', () => {
    // A watch that syncs mid-workout sends a fragment, then the finished form.
    const fragment = win(0, 8);
    const finished = win(0, 34);
    expect(relateWorkouts(fragment, finished)).toBe('same');
  });

  it('calls a delivery that merely extends the window the same activity', () => {
    expect(relateWorkouts(win(0, 20), win(10, 25))).toBe('same');
  });

  it('calls two halves either side of a short interruption contiguous', () => {
    // Ran 23 min, took a call, ran another 34.
    expect(relateWorkouts(win(0, 23), win(35, 34))).toBe('contiguous');
  });

  it('treats back-to-back halves with no gap at all as contiguous, not overlapping', () => {
    expect(relateWorkouts(win(0, 23), win(23, 34))).toBe('contiguous');
  });

  it('is symmetric about which half arrives first', () => {
    expect(relateWorkouts(win(35, 34), win(0, 23))).toBe('contiguous');
  });

  it('keeps a morning run and a lunchtime run separate', () => {
    expect(relateWorkouts(win(0, 30), win(300, 30))).toBe('separate');
  });

  it('splits exactly at the contiguity gap', () => {
    const first = win(0, 20);
    expect(relateWorkouts(first, win(20 + CONTIGUOUS_GAP_MIN, 20))).toBe('contiguous');
    expect(relateWorkouts(first, win(20 + CONTIGUOUS_GAP_MIN + 1, 20))).toBe('separate');
  });

  it('does not care about day boundaries — a run resumed after midnight is one run', () => {
    const beforeMidnight = {
      startMs: Date.parse('2026-08-06T23:40:00.000Z'),
      endMs: Date.parse('2026-08-06T23:55:00.000Z'),
      durationSec: 15 * 60,
    };
    const afterMidnight = {
      startMs: Date.parse('2026-08-07T00:05:00.000Z'),
      endMs: Date.parse('2026-08-07T00:25:00.000Z'),
      durationSec: 20 * 60,
    };
    expect(relateWorkouts(beforeMidnight, afterMidnight)).toBe('contiguous');
  });
});

describe('mergeWorkouts — one activity told twice', () => {
  it('takes the fuller reading and never shrinks back on a replay', () => {
    const fragment = win(0, 8, { distanceM: 1400, hrAvg: 141 });
    const finished = win(0, 34, { distanceM: 5852, hrAvg: 149 });

    const healed = mergeWorkouts(fragment, finished, 'same');
    expect(healed.durationSec).toBe(34 * 60);
    expect(healed.distanceM).toBe(5852);
    expect(healed.hrAvg).toBe(149);
    expect(healed.changed).toBe(true);

    // terra-poll replays a 2-day window; the replay must be a no-op.
    const replay = mergeWorkouts({ ...finished }, finished, 'same');
    expect(replay.changed).toBe(false);
    expect(replay.durationSec).toBe(34 * 60);
    expect(replay.distanceM).toBe(5852);
  });

  it('keeps a reading the newer delivery omits', () => {
    const known = win(0, 30, { distanceM: 5000, hrAvg: 150 });
    const withoutHr = win(0, 32, { distanceM: 5200 });
    expect(mergeWorkouts(known, withoutHr, 'same').hrAvg).toBe(150);
  });
});

describe('mergeWorkouts — one activity split in two', () => {
  it('reconstructs the interrupted 10 k that started all this', () => {
    // Sorine, 2026-08-06. The second half is the real stored row (5.85 km /
    // 34 min, the only thing POWR kept); the first half is reconstructed to the
    // ~10 km she described, since the row that held it was overwritten and its
    // true figures are not recoverable from our tables.
    const firstHalf = win(0, 23, { distanceM: 4150, hrAvg: 146 });
    const secondHalf = win(35, 34, { distanceM: 5852, hrAvg: 149 });

    const merged = mergeWorkouts(firstHalf, secondHalf, 'contiguous');

    expect(merged.distanceM).toBe(10002); // the 10 k she actually ran
    expect(merged.durationSec).toBe(57 * 60); // moving time, NOT the 69 min elapsed
    expect(merged.startMs).toBe(firstHalf.startMs); // the run began when she set off
    expect(merged.endMs).toBe(secondHalf.endMs);
    expect(merged.changed).toBe(true);
  });

  it('does not bill the interruption as exercise', () => {
    const merged = mergeWorkouts(win(0, 20), win(50, 20), 'contiguous');
    expect(merged.durationSec).toBe(40 * 60);
    expect(merged.endMs - merged.startMs).toBe(min(70)); // elapsed span is longer
  });

  it('weights heart rate by how long each half lasted', () => {
    const merged = mergeWorkouts(
      win(0, 10, { hrAvg: 120 }),
      win(20, 30, { hrAvg: 160 }),
      'contiguous',
    );
    expect(merged.hrAvg).toBe(150); // (120·10 + 160·30) / 40
  });

  it('carries a metric only one half reported', () => {
    const merged = mergeWorkouts(
      win(0, 20, { distanceM: 3000 }),
      win(30, 20, {}),
      'contiguous',
    );
    expect(merged.distanceM).toBe(3000);
    expect(mergeWorkouts(win(0, 20), win(30, 20), 'contiguous').distanceM).toBeNull();
  });
});

describe('the client mirror agrees with the edge-function copy', () => {
  // shared/sessionMerge.js and supabase/functions/_shared/sessionMerge.ts cannot
  // import each other (Metro does not bundle Deno sources; the Supabase CLI only
  // bundles what lives under supabase/functions/). This is what stops them
  // drifting — a rule changed in one and not the other fails here.
  const cases: Array<[WorkoutWindow, WorkoutWindow]> = [
    [win(0, 8, { distanceM: 1400, hrAvg: 141 }), win(0, 34, { distanceM: 5852, hrAvg: 149 })],
    [win(0, 23, { distanceM: 4150, hrAvg: 146 }), win(35, 34, { distanceM: 5852, hrAvg: 149 })],
    [win(0, 30), win(300, 30)],
    [win(0, 20, { distanceM: 3000 }), win(30, 20)],
    [win(35, 34, { hrAvg: 149 }), win(0, 23, { hrAvg: 146 })],
    [win(0, 20), win(20 + CONTIGUOUS_GAP_MIN, 20)],
    [win(0, 20), win(20 + CONTIGUOUS_GAP_MIN + 1, 20)],
  ];

  it('exposes the same contiguity gap', () => {
    expect(mirror.CONTIGUOUS_GAP_MIN).toBe(CONTIGUOUS_GAP_MIN);
  });

  it.each(cases)('classifies and merges case %# identically', (existing, incoming) => {
    const relation = relateWorkouts(existing, incoming);
    expect(mirror.relateWorkouts(existing, incoming)).toBe(relation);
    if (relation === 'separate') return;
    expect(mirror.mergeWorkouts(existing, incoming, relation))
      .toEqual(mergeWorkouts(existing, incoming, relation));
  });
});

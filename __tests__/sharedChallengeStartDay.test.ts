/**
 * Start-day inclusion for shared-challenge evaluation
 * (supabase/functions/_shared/challenges.ts → challengeSessionWindow).
 *
 * Walking rows are day buckets timestamped at LOCAL MIDNIGHT of the day they
 * summarize, so the old `started_at >= starts_at` filter dropped the entire
 * start day's steps whenever a challenge went active mid-day (Jamie's
 * "my steps today didn't count" bug). The window now fetches from the start
 * day's local midnight and admits the pre-start rows only for walking;
 * precisely-timestamped sessions (gym, runs) keep the strict clock.
 */

import {
  buildContext,
  challengeSessionWindow,
  evaluateChallenge,
} from '@/supabase/functions/_shared/challenges';

const BST = 60; // London summer offset

describe('challengeSessionWindow', () => {
  // Challenge accepted mid-morning UK time: 2026-07-30 11:11 local (10:11Z).
  const startsAt = '2026-07-30T10:11:57.089Z';

  it('fetch window opens at the local midnight of the start day', () => {
    const w = challengeSessionWindow(startsAt, BST);
    // Local midnight 2026-07-30 00:00 BST = 2026-07-29 23:00Z.
    expect(w.fetchStartISO).toBe('2026-07-29T23:00:00.000Z');
  });

  it('admits the start day walking bucket despite its pre-start timestamp', () => {
    const w = challengeSessionWindow(startsAt, BST);
    expect(w.admits({ type: 'walking', started_at: '2026-07-29T23:00:00Z' })).toBe(true);
  });

  it('keeps the strict clock for timestamped sessions', () => {
    const w = challengeSessionWindow(startsAt, BST);
    // Gym before the challenge started — excluded.
    expect(w.admits({ type: 'gym', started_at: '2026-07-30T08:00:00Z' })).toBe(false);
    // Gym after — included.
    expect(w.admits({ type: 'gym', started_at: '2026-07-30T12:00:00Z' })).toBe(true);
  });

  it('handles negative offsets (start-of-day west of Greenwich)', () => {
    // 2026-07-30 02:00Z = 2026-07-29 21:00 in New York (UTC-5 used for a fixed
    // offset here) → local day is the 29th, whose midnight is 05:00Z.
    const w = challengeSessionWindow('2026-07-30T02:00:00Z', -300);
    expect(w.fetchStartISO).toBe('2026-07-29T05:00:00.000Z');
  });

  it('weekly_sum steps counts the start day bucket end-to-end', () => {
    const w = challengeSessionWindow(startsAt, BST);
    const rows = [
      // Start-day bucket, written at local midnight — the previously-dropped row.
      { type: 'walking', started_at: '2026-07-29T23:00:00Z', duration_sec: 0, distance_m: null, steps: 8000, verification: 'wearable' },
      // Next day's bucket.
      { type: 'walking', started_at: '2026-07-30T23:00:00Z', duration_sec: 0, distance_m: null, steps: 12000, verification: 'wearable' },
    ].filter(w.admits);
    const ctx = buildContext(rows as any, BST);
    const { progress } = evaluateChallenge({ kind: 'weekly_sum', metric: 'steps', target: 35000 }, ctx);
    expect(progress).toBe(20000);
  });
});

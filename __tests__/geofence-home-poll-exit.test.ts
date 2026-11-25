/**
 * The Home screen poll may no longer end a live visit on one reading.
 *
 * hooks/useActiveGeofence runs every 5 seconds while the app is open. It used to
 * close the visit the moment ONE fix sat further than radius + the fix's own
 * accuracy — 35-40 m on a sharp fix, where the engine itself needs a corroborated
 * reading past radius + 50 m and never acts in the first three minutes. It also
 * wrote nothing when it fired.
 *
 * Field 2026-11-16: a continuous 52-minute session recorded as 24 + 15½ minutes;
 * neither half reached the threshold, so no check-in and no gym credit. 30 days
 * to 11-25: nine paid visits ended within two minutes of the 30-minute mark —
 * eight at a venue whose members stand 29-39 m from a 30 m pin, six with the app
 * open — and none reached the 40-minute bonus.
 *
 * homeExitStep is the whole decision, pure, so it is pinned here without booting
 * the engine.
 */
import {
  HOME_EXIT_MIN_SPAN_MS,
  HOME_EXIT_READINGS,
  LOCATION_EXIT_GRACE_MS,
  exitBoundM,
  homeExitStep,
  type OutsideStreak,
} from '@/lib/health/gymPresence';

const ENTRY = 1_800_000_000_000;
const AFTER_GRACE = ENTRY + LOCATION_EXIT_GRACE_MS + 60_000;

const reading = (over: Partial<Parameters<typeof homeExitStep>[1]> = {}) => ({
  entryTimestamp: ENTRY,
  distanceM: 200,
  radiusM: 30,
  accuracyM: 8,
  fixAtMs: AFTER_GRACE,
  nowMs: AFTER_GRACE,
  ...over,
});

describe('homeExitStep', () => {
  it('the readings that used to close a visit no longer even count as outside', () => {
    // 29-39 m from a 30 m pin on a 5-8 m fix: past the old threshold (radius + accuracy).
    for (const distanceM of [36, 37, 39, 45, 60]) {
      const step = homeExitStep(null, reading({ distanceM, accuracyM: 6 }));
      expect(distanceM).toBeGreaterThan(30 + 6 - 1);
      expect(step.outside).toBe(false);
      expect(step.close).toBe(false);
      expect(step.streak).toBeNull();
    }
  });

  it('uses the same bound as every other departure test', () => {
    const step = homeExitStep(null, reading({ distanceM: 50, accuracyM: 12 }));
    expect(step.boundM).toBe(exitBoundM(30, 50, 12));
  });

  it('one reading well outside starts a count and closes nothing', () => {
    const step = homeExitStep(null, reading());
    expect(step.outside).toBe(true);
    expect(step.close).toBe(false);
    expect(step.streak).toMatchObject({ readings: 1, entryTimestamp: ENTRY });
  });

  it('a second reading five seconds later is the same wander measured twice', () => {
    const one = homeExitStep(null, reading());
    const two = homeExitStep(one.streak, reading({ fixAtMs: AFTER_GRACE + 5_000, nowMs: AFTER_GRACE + 5_000 }));
    expect(two.streak?.readings).toBe(2);
    expect(two.close).toBe(false);
  });

  it('two different readings spanning the minimum close the visit', () => {
    const one = homeExitStep(null, reading());
    const later = AFTER_GRACE + HOME_EXIT_MIN_SPAN_MS;
    const two = homeExitStep(one.streak, reading({ fixAtMs: later, nowMs: later }));
    expect(two.streak?.readings).toBe(HOME_EXIT_READINGS);
    expect(two.close).toBe(true);
  });

  it('the same cached fix polled again is one reading, however long it is polled', () => {
    let streak: OutsideStreak | null = homeExitStep(null, reading()).streak;
    for (let i = 1; i <= 12; i++) {
      const step = homeExitStep(streak, reading({ nowMs: AFTER_GRACE + i * 5_000 })); // fixAtMs unchanged
      expect(step.close).toBe(false);
      streak = step.streak;
    }
    expect(streak?.readings).toBe(1);
  });

  it('one reading back at the venue wipes the count', () => {
    const one = homeExitStep(null, reading());
    const back = homeExitStep(one.streak, reading({ distanceM: 12, fixAtMs: AFTER_GRACE + 10_000, nowMs: AFTER_GRACE + 10_000 }));
    expect(back.streak).toBeNull();
    const later = AFTER_GRACE + 40_000;
    const again = homeExitStep(back.streak, reading({ fixAtMs: later, nowMs: later }));
    expect(again.close).toBe(false);
    expect(again.streak?.readings).toBe(1);
  });

  it('never ends a visit in its first three minutes — and a reading from then cannot corroborate a later one', () => {
    const early = ENTRY + 60_000;
    const one = homeExitStep(null, reading({ fixAtMs: early, nowMs: early }));
    expect(one.outside).toBe(true);
    expect(one.streak).toBeNull();
    const two = homeExitStep(one.streak, reading());
    expect(two.close).toBe(false);
    expect(two.streak?.readings).toBe(1);
  });

  it('a count belongs to one visit: a new check-in starts from zero', () => {
    const one = homeExitStep(null, reading());
    const nextEntry = ENTRY + 30 * 60_000;
    const later = nextEntry + LOCATION_EXIT_GRACE_MS + HOME_EXIT_MIN_SPAN_MS;
    const two = homeExitStep(one.streak, reading({ entryTimestamp: nextEntry, fixAtMs: later, nowMs: later }));
    expect(two.close).toBe(false);
    expect(two.streak).toMatchObject({ readings: 1, entryTimestamp: nextEntry });
  });

  it('a vague fix cannot reach further than a sharp one could', () => {
    // 100 m from a 30 m pin on a 95 m fix: the accuracy term is capped at 30,
    // so the bound is 110 and this is still not outside.
    expect(homeExitStep(null, reading({ distanceM: 100, accuracyM: 95 })).outside).toBe(false);
    expect(homeExitStep(null, reading({ distanceM: 120, accuracyM: 95 })).outside).toBe(true);
  });
});

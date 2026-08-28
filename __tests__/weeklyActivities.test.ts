/**
 * Tests for the detected-activity smart-swap (lib/weeklyActivities.ts) shared
 * by the home weekly rings and the progress radial carousel.
 */

import type { ActivityType } from '@/constants/activities';
import {
  applyDetectedActivitySwap,
  orderedProgressActivities,
  WEEKLY_SESSION_TARGET,
  WEEKLY_STEPS_TARGET,
  weeklyRingPct,
} from '@/lib/weeklyActivities';

const PREFS: ActivityType[] = ['gym', 'running', 'walking'];

function metrics(perType: Record<string, number>, totalSteps = 0) {
  return { perType, totalSteps };
}

describe('weeklyRingPct', () => {
  it('measures walking by steps against the weekly target', () => {
    expect(weeklyRingPct('walking', metrics({}, WEEKLY_STEPS_TARGET / 2))).toBe(0.5);
  });

  it('measures other activities by session count, capped at 2', () => {
    expect(weeklyRingPct('gym', metrics({ gym: WEEKLY_SESSION_TARGET }))).toBe(1);
    expect(weeklyRingPct('gym', metrics({ gym: 100 }))).toBe(2);
    expect(weeklyRingPct('gym', metrics({}))).toBe(0);
  });
});

describe('applyDetectedActivitySwap', () => {
  it('returns preferences untouched when nothing outside them was detected', () => {
    const res = applyDetectedActivitySwap(PREFS, metrics({ gym: 2, running: 1 }));
    expect(res.types).toEqual(PREFS);
    expect(res.bonusType).toBeNull();
    expect(res.displacedType).toBeNull();
  });

  it('swaps a detected activity in for the weakest preference (Sorine case)', () => {
    // gym 2, running 1, no walking steps → walking is weakest; swim detected
    const res = applyDetectedActivitySwap(PREFS, metrics({ gym: 2, running: 1, swimming: 1 }));
    expect(res.bonusType).toBe('swimming');
    expect(res.displacedType).toBe('walking');
    expect(res.types).toEqual(['gym', 'running', 'swimming']);
  });

  it('keeps the bonus in the displaced preference slot', () => {
    // running weakest → swim takes running's position, order otherwise intact
    const res = applyDetectedActivitySwap(
      PREFS,
      metrics({ gym: 2, swimming: 1 }, WEEKLY_STEPS_TARGET),
    );
    expect(res.displacedType).toBe('running');
    expect(res.types).toEqual(['gym', 'swimming', 'walking']);
  });

  it('picks the detected activity with the most progress when several exist', () => {
    const res = applyDetectedActivitySwap(PREFS, metrics({ swimming: 1, cycling: 3 }));
    expect(res.bonusType).toBe('cycling');
  });

  it('never swaps in sleep or unknown session types', () => {
    const res = applyDetectedActivitySwap(
      PREFS,
      metrics({ gym: 1, sleep: 7, not_a_real_type: 4 }),
    );
    expect(res.bonusType).toBeNull();
    expect(res.types).toEqual(PREFS);
  });

  it('handles empty preferences without swapping', () => {
    const res = applyDetectedActivitySwap([], metrics({ swimming: 1 }));
    expect(res.types).toEqual([]);
    expect(res.bonusType).toBeNull();
  });

  it('ADDS a detected activity when there is a free ring slot (no gym in prefs)', () => {
    // Gym is no longer forced into every profile, so a two-pick user has room:
    // nothing should be displaced.
    const res = applyDetectedActivitySwap(['running', 'walking'], metrics({ cycling: 2 }));
    expect(res.types).toEqual(['running', 'walking', 'cycling']);
    expect(res.bonusType).toBe('cycling');
    expect(res.displacedType).toBeNull();
  });

  it('never exceeds MAX_RING_SLOTS — still swaps once the slots are full', () => {
    const res = applyDetectedActivitySwap(['running', 'walking', 'swimming'], metrics({ running: 2, cycling: 2 }, 20000));
    expect(res.types).toHaveLength(3);
    expect(res.displacedType).toBe('swimming');
  });
});

describe('orderedProgressActivities', () => {
  it('returns just the prefs, in pref order, when nothing else was detected', () => {
    expect(orderedProgressActivities(PREFS, metrics({}))).toEqual(['gym', 'running', 'walking']);
  });

  it('appends every detected activity after the prefs — nothing capped or folded', () => {
    expect(orderedProgressActivities(PREFS, metrics({ swimming: 3, hiit: 1, dance: 2 })))
      .toEqual(['gym', 'running', 'walking', 'swimming', 'dance', 'hiit']);
  });

  it('ranks detected extras by weekly progress (strongest first)', () => {
    expect(orderedProgressActivities(PREFS, metrics({ hiit: 1, swimming: 4 })))
      .toEqual(['gym', 'running', 'walking', 'swimming', 'hiit']);
  });

  it('never surfaces sleep or unknown session types as an activity', () => {
    expect(orderedProgressActivities(PREFS, metrics({ sleep: 5, bogus: 3 } as any)))
      .toEqual(['gym', 'running', 'walking']);
  });

  it('dedups a detected type already in the prefs', () => {
    expect(orderedProgressActivities(PREFS, metrics({ gym: 2, swimming: 1 })))
      .toEqual(['gym', 'running', 'walking', 'swimming']);
  });
});

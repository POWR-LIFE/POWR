/**
 * Tests for the detected-activity smart-swap (lib/weeklyActivities.ts) shared
 * by the home weekly rings and the progress radial carousel.
 */

import type { ActivityType } from '@/constants/activities';
import {
  applyDetectedActivitySwap,
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
});

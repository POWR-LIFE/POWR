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
  weeklyDistanceLabel,
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

describe('weeklyDistanceLabel', () => {
  it('shows a UK ride week in miles (Mark: 81.3 km = 50.5 mi)', () => {
    expect(weeklyDistanceLabel('cycling', { cycling: 81267 }, 'GB')).toEqual({ value: '50.5', unit: 'mi' });
  });

  it('shows the same ride in km outside the UK/US', () => {
    expect(weeklyDistanceLabel('cycling', { cycling: 81267 }, 'ES')).toEqual({ value: '81.3', unit: 'km' });
  });

  it('drops the decimal from 100 so the radial number stays short', () => {
    expect(weeklyDistanceLabel('cycling', { cycling: 425459 }, 'ES')).toEqual({ value: '425', unit: 'km' });
  });

  it('keeps UK runs in km and US runs in miles', () => {
    expect(weeklyDistanceLabel('running', { running: 10000 }, 'GB')).toEqual({ value: '10.0', unit: 'km' });
    expect(weeklyDistanceLabel('running', { running: 10000 }, 'US')).toEqual({ value: '6.2', unit: 'mi' });
  });

  it('shows swimming in metres everywhere', () => {
    expect(weeklyDistanceLabel('swimming', { swimming: 3200 }, 'US')).toEqual({ value: '3,200', unit: 'm' });
  });

  it('falls back to sessions when no effort carried a distance (indoor / Whoop)', () => {
    expect(weeklyDistanceLabel('cycling', { cycling: 0 }, 'GB')).toBeNull();
    expect(weeklyDistanceLabel('cycling', {}, 'GB')).toBeNull();
    expect(weeklyDistanceLabel('cycling', undefined, 'GB')).toBeNull();
  });

  it('leaves session-led activities alone even when they have distance', () => {
    expect(weeklyDistanceLabel('gym', { gym: 5000 }, 'GB')).toBeNull();
    expect(weeklyDistanceLabel('walking', { walking: 5000 }, 'GB')).toBeNull();
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

  describe('history gate', () => {
    const history = (...types: ActivityType[]) => new Set<ActivityType>(types);

    it('drops a preference with no history at all (no empty radials)', () => {
      expect(orderedProgressActivities(PREFS, metrics({}), history('gym', 'walking')))
        .toEqual(['gym', 'walking']);
    });

    it('keeps a preference with history even when this week is empty (lookback stays reachable)', () => {
      expect(orderedProgressActivities(PREFS, metrics({}), history('running')))
        .toEqual(['running']);
    });

    it("counts this week's sessions as proof before the history lookup catches up", () => {
      expect(orderedProgressActivities(PREFS, metrics({ running: 1 }), history()))
        .toEqual(['running']);
    });

    it('returns nothing for a brand-new user — the page-level empty state takes over', () => {
      expect(orderedProgressActivities(PREFS, metrics({}), history())).toEqual([]);
    });

    it('keeps every preference when history is unknown (null) or omitted', () => {
      expect(orderedProgressActivities(PREFS, metrics({}), null)).toEqual(PREFS);
      expect(orderedProgressActivities(PREFS, metrics({}), undefined)).toEqual(PREFS);
    });

    it('still appends detected extras after the gated prefs', () => {
      expect(orderedProgressActivities(PREFS, metrics({ swimming: 2 }), history('gym')))
        .toEqual(['gym', 'swimming']);
    });
  });
});

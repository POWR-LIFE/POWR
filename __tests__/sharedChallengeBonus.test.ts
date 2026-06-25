/**
 * Tests for the shared-challenge group-size bonus (lib/social/bonus.ts).
 * Mirrors the worked examples in docs/shared-challenges-scope.md §6a.
 */

import {
  BONUS_DEFAULTS,
  earnedPoints,
  groupBonus,
  groupSizeAtCap,
  maxBonusForGroup,
} from '@/lib/social/bonus';

describe('groupBonus', () => {
  it('is zero when nobody else completes (solo within the group)', () => {
    expect(groupBonus(0)).toBe(0);
  });

  it('scales flat-per-head with co-completers', () => {
    expect(groupBonus(1)).toBe(5); // perHead 5
    expect(groupBonus(3)).toBe(15);
    expect(groupBonus(6)).toBe(30);
  });

  it('hard-caps the bonus so big groups cannot mint unbounded points', () => {
    expect(groupBonus(6)).toBe(BONUS_DEFAULTS.maxBonus);
    expect(groupBonus(7)).toBe(BONUS_DEFAULTS.maxBonus);
    expect(groupBonus(20)).toBe(BONUS_DEFAULTS.maxBonus);
  });

  it('never returns negative and floors fractional input', () => {
    expect(groupBonus(-3)).toBe(0);
    expect(groupBonus(2.9)).toBe(10);
  });

  it('respects a custom config', () => {
    expect(groupBonus(4, { perHead: 10, maxBonus: 100 })).toBe(40);
    expect(groupBonus(20, { perHead: 10, maxBonus: 100 })).toBe(100);
  });
});

describe('earnedPoints', () => {
  it('returns base only when no co-completers', () => {
    expect(earnedPoints(30, 0)).toEqual({ base: 30, bonus: 0, total: 30 });
  });

  it('matches the scope-doc worked example (base 30)', () => {
    expect(earnedPoints(30, 1)).toEqual({ base: 30, bonus: 5, total: 35 });
    expect(earnedPoints(30, 6)).toEqual({ base: 30, bonus: 30, total: 60 });
  });
});

describe('maxBonusForGroup', () => {
  it('uses groupSize-1 co-completers (everyone else finished)', () => {
    expect(maxBonusForGroup(1)).toBe(0); // just you
    expect(maxBonusForGroup(2)).toBe(5); // you + 1 friend
    expect(maxBonusForGroup(4)).toBe(15);
    expect(maxBonusForGroup(10)).toBe(BONUS_DEFAULTS.maxBonus); // capped
  });
});

describe('groupSizeAtCap', () => {
  it('is the smallest group where the bonus maxes out', () => {
    // cap 30 / perHead 5 = 6 co-completers + you = 7
    expect(groupSizeAtCap()).toBe(7);
    expect(maxBonusForGroup(groupSizeAtCap())).toBe(BONUS_DEFAULTS.maxBonus);
    expect(maxBonusForGroup(groupSizeAtCap() - 1)).toBeLessThan(BONUS_DEFAULTS.maxBonus);
  });
});

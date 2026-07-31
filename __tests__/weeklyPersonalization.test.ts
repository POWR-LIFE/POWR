/**
 * Tests for the personalized weekly rotation (shared/weeklyChallenges.js):
 * the board's five goals filtered to the user's relevant categories, with
 * freed slots refilled from those same categories.
 */

import {
  CATALOG,
  CATEGORY_ORDER,
  getActiveChallengesForWeek,
  getPersonalizedChallengesForWeek,
} from '@/shared/weeklyChallenges';

const WEEK = '2026-W31';

describe('getPersonalizedChallengesForWeek', () => {
  it('keeps the week at five goals, drawn only from relevant categories + multi', () => {
    const active = getPersonalizedChallengesForWeek(WEEK, ['gym', 'walking']);
    expect(active).toHaveLength(getActiveChallengesForWeek(WEEK).length);
    for (const c of active) {
      expect(['gym', 'walking', 'multi']).toContain(c.category);
    }
    expect(active.some((c) => c.category === 'multi')).toBe(true);
  });

  it('refills freed slots with second challenges from the relevant categories', () => {
    const active = getPersonalizedChallengesForWeek(WEEK, ['gym', 'walking']);
    const gymCount = active.filter((c) => c.category === 'gym').length;
    const walkCount = active.filter((c) => c.category === 'walking').length;
    expect(gymCount).toBeGreaterThanOrEqual(2);
    expect(walkCount).toBeGreaterThanOrEqual(1);
  });

  it('never duplicates a challenge id', () => {
    for (const cats of [['gym'], ['gym', 'walking'], ['running', 'cycling']]) {
      const active = getPersonalizedChallengesForWeek(WEEK, cats);
      const ids = active.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps the rotation primary pick for each relevant category', () => {
    const full = getActiveChallengesForWeek(WEEK);
    const active = getPersonalizedChallengesForWeek(WEEK, ['gym', 'walking']);
    for (const c of full) {
      if (['gym', 'walking', 'multi'].includes(c.category)) {
        expect(active.map((x) => x.id)).toContain(c.id);
      }
    }
  });

  it('falls back to the full rotation on cold start (no relevant categories)', () => {
    expect(getPersonalizedChallengesForWeek(WEEK, [])).toEqual(getActiveChallengesForWeek(WEEK));
  });

  it('falls back to the full rotation when only non-challenge buckets are relevant', () => {
    // A swimming/yoga-only user has no challenge categories yet — personalizing
    // down to just multi would gut the board, so the full rotation returns.
    expect(getPersonalizedChallengesForWeek(WEEK, ['swimming', 'yoga'])).toEqual(
      getActiveChallengesForWeek(WEEK),
    );
  });

  it('returns the full rotation unchanged when every category is relevant', () => {
    expect(getPersonalizedChallengesForWeek(WEEK, CATEGORY_ORDER)).toEqual(
      getActiveChallengesForWeek(WEEK),
    );
  });

  it('ignores unknown bucket names mixed into the relevance list', () => {
    const active = getPersonalizedChallengesForWeek(WEEK, ['gym', 'swimming', 'yoga']);
    for (const c of active) {
      expect(['gym', 'multi']).toContain(c.category);
    }
    expect(active).toHaveLength(getActiveChallengesForWeek(WEEK).length);
  });

  it('is deterministic for a given week and varies refills across weeks', () => {
    const a = getPersonalizedChallengesForWeek(WEEK, ['gym', 'walking']);
    const b = getPersonalizedChallengesForWeek(WEEK, ['gym', 'walking']);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));

    const nextWeek = getPersonalizedChallengesForWeek('2026-W32', ['gym', 'walking']);
    expect(nextWeek.map((c) => c.id)).not.toEqual(a.map((c) => c.id));
  });

  it('only ever selects supported challenges', () => {
    const unsupported = new Set(CATALOG.filter((c) => c.supported === false).map((c) => c.id));
    for (const cats of [['gym'], ['gym', 'walking'], ['running']]) {
      for (const c of getPersonalizedChallengesForWeek(WEEK, cats)) {
        expect(unsupported.has(c.id)).toBe(false);
      }
    }
  });
});

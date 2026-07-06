import { applyPlacements, pickHeroPlacement, type ResolvedPlacement } from '@/lib/api/placements';
import type { Reward } from '@/lib/api/rewards';

// Minimal reward factory — only the fields applyPlacements touches (id) matter.
const reward = (id: string): Reward => ({ id } as Reward);

const placement = (
  reward_id: string,
  over: Partial<ResolvedPlacement> = {},
): ResolvedPlacement => ({
  placement_id: `pl-${reward_id}`,
  reward_id,
  visibility: 'boost',
  priority: 0,
  paid: false,
  partner_id: null,
  distance_m: 100,
  ...over,
});

describe('applyPlacements', () => {
  it('moves placed rewards to the front and keeps the rest in order', () => {
    const rewards = [reward('a'), reward('b'), reward('c'), reward('d')];
    const { rewards: out } = applyPlacements(rewards, [placement('c')]);
    expect(out.map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('does not hide any reward', () => {
    const rewards = [reward('a'), reward('b'), reward('c')];
    const { rewards: out } = applyPlacements(rewards, [placement('b')]);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((r) => r.id))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('ranks paid placements ahead of unpaid ones', () => {
    const rewards = [reward('unpaid'), reward('paid')];
    const out = applyPlacements(rewards, [
      placement('unpaid', { paid: false, priority: 999 }),
      placement('paid', { paid: true, priority: 0 }),
    ]);
    expect(out.rewards.map((r) => r.id)).toEqual(['paid', 'unpaid']);
  });

  it('paid always beats unpaid, even against extreme priority values', () => {
    // Regression: a weighted scalar rank let an unpaid placement with a
    // priority ~1000 above a paid one leapfrog it. Ordering is lexicographic.
    const rewards = [reward('unpaid'), reward('paid')];
    const out = applyPlacements(rewards, [
      placement('unpaid', { paid: false, priority: 5_000_000, distance_m: 0 }),
      placement('paid', { paid: true, priority: -10, distance_m: 900 }),
    ]);
    expect(out.rewards.map((r) => r.id)).toEqual(['paid', 'unpaid']);
  });

  it('breaks ties by priority then distance', () => {
    const rewards = [reward('far'), reward('near'), reward('hi')];
    const out = applyPlacements(rewards, [
      placement('far', { priority: 5, distance_m: 500 }),
      placement('near', { priority: 5, distance_m: 10 }),
      placement('hi', { priority: 9, distance_m: 999 }),
    ]);
    // higher priority first, then nearer among equal priority
    expect(out.rewards.map((r) => r.id)).toEqual(['hi', 'near', 'far']);
  });

  it('maps reward_id → placement for tagging/logging', () => {
    const { placementByRewardId } = applyPlacements([reward('x')], [placement('x', { paid: true })]);
    expect(placementByRewardId.get('x')?.paid).toBe(true);
    expect(placementByRewardId.has('nope')).toBe(false);
  });

  it('is a no-op when there are no placements', () => {
    const rewards = [reward('a'), reward('b')];
    const { rewards: out } = applyPlacements(rewards, []);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('pickHeroPlacement', () => {
  const ids = (...xs: string[]) => new Set(xs);

  it('returns null when nothing applies', () => {
    expect(pickHeroPlacement(ids('a', 'b'), [])).toBeNull();
  });

  it('ignores placements whose reward is not in the vault', () => {
    // Reward "z" isn't visible, so its placement can't seize the hero.
    expect(pickHeroPlacement(ids('a'), [placement('z', { paid: true })])).toBeNull();
  });

  it('picks the best-ranked eligible placement (paid → priority → nearest)', () => {
    const chosen = pickHeroPlacement(ids('unpaid', 'paid'), [
      placement('unpaid', { paid: false, priority: 999 }),
      placement('paid', { paid: true, priority: 0 }),
    ]);
    expect(chosen?.reward_id).toBe('paid');
  });

  it('breaks ties by priority then distance among visible rewards', () => {
    const chosen = pickHeroPlacement(ids('far', 'near', 'hi'), [
      placement('far', { priority: 5, distance_m: 500 }),
      placement('near', { priority: 5, distance_m: 10 }),
      placement('hi', { priority: 9, distance_m: 999 }),
    ]);
    expect(chosen?.reward_id).toBe('hi');
  });
});

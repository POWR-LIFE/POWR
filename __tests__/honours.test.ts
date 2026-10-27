import { type Honour, honourNext, honourTier, sortHonours } from '@/constants/honours';

describe('honours (the trophies brief)', () => {
    it('power climbs the ladder: 4+ days ×5 / ×10, 5+ ×25, 6+ ×30', () => {
        expect(honourTier('power', 4)).toBeNull();
        expect(honourTier('power', 5)).toBe('bronze');
        expect(honourTier('power', 10)).toBe('silver');
        expect(honourTier('power', 40, { w5: 24 })).toBe('silver');
        expect(honourTier('power', 40, { w5: 25 })).toBe('gold');
        expect(honourTier('power', 40, { w5: 30, w6: 30 })).toBe('platinum');
    });

    it('on fire, diamond and strength are plain counts', () => {
        expect(honourTier('on_fire', 9)).toBeNull();
        expect([10, 20, 40, 60].map((n) => honourTier('on_fire', n))).toEqual(['bronze', 'silver', 'gold', 'platinum']);
        expect([1, 3, 6, 12].map((n) => honourTier('diamond', n))).toEqual(['bronze', 'silver', 'gold', 'platinum']);
        expect([4, 30, 60, 100].map((n) => honourTier('strength', n))).toEqual(['bronze', 'silver', 'gold', 'platinum']);
        expect(honourTier('strength', 3)).toBeNull();
    });

    it('wings: places climbed, platinum for Nº 1 from outside the top 10', () => {
        expect(honourTier('wings', 9)).toBeNull();
        expect([10, 20, 30].map((n) => honourTier('wings', n))).toEqual(['bronze', 'silver', 'gold']);
        expect(honourTier('wings', 5, { top: true })).toBe('platinum');
    });

    it('the hive: bronze on friends, the rest on active friends', () => {
        expect(honourTier('hive', 2)).toBeNull();
        expect(honourTier('hive', 3)).toBe('bronze');
        expect(honourTier('hive', 10, { active: 5 })).toBe('bronze');
        expect(honourTier('hive', 10, { active: 6 })).toBe('silver');
        expect(honourTier('hive', 40, { active: 12 })).toBe('gold');
        expect(honourTier('hive', 40, { active: 30 })).toBe('platinum');
    });

    it('king is gold with a win', () => {
        expect(honourTier('king', 0)).toBeNull();
        expect(honourTier('king', 1)).toBe('gold');
    });

    it('says what is left to the next metal', () => {
        expect(honourNext({ kind: 'on_fire', tier: 'silver', count: 34 })).toEqual({ tier: 'gold', have: 34, need: 40, unit: 'weeks' });
        expect(honourNext({ kind: 'power', tier: 'silver', count: 40, detail: { w5: 6, w6: 1 } })).toEqual({ tier: 'gold', have: 6, need: 25, unit: 'weeks5' });
        expect(honourNext({ kind: 'hive', tier: 'bronze', count: 4, detail: { active: 2 } })).toEqual({ tier: 'silver', have: 2, need: 6, unit: 'friends' });
        expect(honourNext({ kind: 'strength', tier: 'platinum', count: 120 })).toBeNull();
        expect(honourNext({ kind: 'king', tier: 'gold', count: 1 })).toBeNull();
    });

    it('sorts the King first, then by metal, newest first', () => {
        const list: Honour[] = [
            { kind: 'on_fire', tier: 'gold', count: 40, earned_at: '2027-01-01' },
            { kind: 'power', tier: 'bronze', count: 5, earned_at: '2027-03-01' },
            { kind: 'king', tier: 'gold', count: 1, earned_at: '2026-11-16' },
            { kind: 'strength', tier: 'gold', count: 60, earned_at: '2027-02-01' },
            { kind: 'diamond', tier: 'platinum', count: 12, earned_at: '2026-12-01' },
        ];
        expect(sortHonours(list).map((h) => h.kind)).toEqual(['king', 'diamond', 'strength', 'on_fire', 'power']);
    });
});

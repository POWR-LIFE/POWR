import { honourTier, sortHonours, type Honour } from '@/constants/honours';

describe('honours', () => {
    it('tiers match the server thresholds', () => {
        expect(honourTier('king', 0)).toBeNull();
        expect(honourTier('king', 1)).toBe('gold');
        expect(honourTier('on_fire', 3)).toBeNull();
        expect(honourTier('on_fire', 4)).toBe('bronze');
        expect(honourTier('on_fire', 8)).toBe('silver');
        expect(honourTier('on_fire', 12)).toBe('gold');
        expect(honourTier('power', 1)).toBe('bronze');
        expect(honourTier('power', 4)).toBe('silver');
        expect(honourTier('power', 8)).toBe('gold');
        expect(honourTier('hive', 2)).toBe('bronze');
        expect(honourTier('hive', 3)).toBe('silver');
        expect(honourTier('hive', 5)).toBe('gold');
        for (const k of ['diamond', 'wings', 'strength'] as const) {
            expect(honourTier(k, 0)).toBeNull();
            expect(honourTier(k, 1)).toBe('bronze');
            expect(honourTier(k, 2)).toBe('silver');
            expect(honourTier(k, 3)).toBe('gold');
        }
    });

    it('sorts heaviest first, gold before bronze within a kind', () => {
        const list: Honour[] = [
            { kind: 'on_fire', tier: 'gold', count: 12 },
            { kind: 'king', tier: 'gold', count: 2 },
            { kind: 'power', tier: 'bronze', count: 1 },
            { kind: 'diamond', tier: 'silver', count: 2 },
        ];
        expect(sortHonours(list).map((h) => h.kind)).toEqual(['king', 'diamond', 'power', 'on_fire']);
    });
});

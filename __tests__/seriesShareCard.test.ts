import type { Honour } from '@/constants/honours';
import { CABINET_TOTAL, cabinet, cardClimb, cardRank, cardStats, nextHonour } from '@/lib/seriesShareCard';

const h = (kind: Honour['kind'], tier: Honour['tier'], count: number, detail: Honour['detail'] = {}): Honour => ({ kind, tier, count, detail });

describe('the Series share card (standing)', () => {
    it('the cabinet: 25 pieces, holding a metal lights every metal below it', () => {
        expect(CABINET_TOTAL).toBe(25);
        // The design's example: Power bronze, On Fire silver, Wings gold, Hive bronze, Strength gold = 10.
        const box = cabinet([
            h('power', 'bronze', 2),
            h('on_fire', 'silver', 4),
            h('wings', 'gold', 31),
            h('hive', 'bronze', 3),
            h('strength', 'gold', 61),
        ]);
        expect(box.earned).toBe(10);
        expect(box.total).toBe(25);
        const col = (k: string) => box.columns.find((c) => c.kind === k)!;
        expect(box.columns.map((c) => c.kind)).toEqual(['king', 'power', 'on_fire', 'diamond', 'wings', 'hive', 'strength']);
        // Rows run platinum → bronze, top to bottom.
        expect(col('wings').slots.map((x) => x?.earned)).toEqual([false, true, true, true]);
        expect(col('on_fire').slots.map((x) => x?.earned)).toEqual([false, false, true, true]);
        expect(col('diamond').any).toBe(false);
        // The King is one gold piece in the top row.
        expect(col('king').slots).toEqual([{ tier: 'gold', earned: false }, null, null, null]);
        expect(cabinet([h('king', 'gold', 1)]).earned).toBe(1);
        expect(cabinet([]).earned).toBe(0);
    });

    it('next: the trophy nearest its next metal; the rule when you hold none', () => {
        // Strength 50/60 (83%) beats On Fire 4/6 (67%).
        expect(nextHonour([h('on_fire', 'silver', 4), h('strength', 'silver', 50)])).toEqual(
            { kind: 'strength', tier: 'gold', have: 50, need: 60, unit: 'sessions' },
        );
        // Platinum and the King have nothing above them.
        expect(nextHonour([h('king', 'gold', 1), h('on_fire', 'platinum', 9)])).toEqual(
            { kind: 'strength', tier: 'bronze', have: null, need: null, unit: null },
        );
        expect(nextHonour([])).toEqual({ kind: 'on_fire', tier: 'bronze', have: null, need: null, unit: null });
        const all = ['power', 'on_fire', 'diamond', 'wings', 'hive', 'strength'].map((k) => h(k as Honour['kind'], 'platinum', 999, { w6: 9, active: 99, top: true }));
        expect(nextHonour(all)).toBeNull();
    });

    it('stats: steps, run, gym, and a real number in place of any 0', () => {
        const extra = { points: 140, daysLeft: 14 };
        expect(cardStats({ steps: 18942, runKm: 14.62, gym: 3, rideKm: 0, workouts: 0 }, extra)).toEqual([
            { key: 'steps', value: 18942 }, { key: 'run', value: 14.6 }, { key: 'gym', value: 3 },
        ]);
        // No run: the gym moves up and the Series points fill the third cell.
        expect(cardStats({ steps: 9000, runKm: 0, gym: 2, rideKm: 0, workouts: 0 }, extra).map((x) => x.key)).toEqual(['steps', 'gym', 'points']);
        // One real number: the days left keep it company.
        expect(cardStats(null, extra)).toEqual([{ key: 'points', value: 140 }, { key: 'daysLeft', value: 14 }]);
        expect(cardStats({ steps: 4571, runKm: 0, gym: 0, rideKm: 0, workouts: 0 }, { points: 0, daysLeft: 14 }))
            .toEqual([{ key: 'steps', value: 4571 }, { key: 'daysLeft', value: 14 }]);
        // Nothing at all: the days left, never a 0; a finished round, nothing.
        expect(cardStats(null, { points: 0, daysLeft: 14 })).toEqual([{ key: 'daysLeft', value: 14 }]);
        expect(cardStats(null, { points: 0, daysLeft: 0 })).toEqual([]);
    });

    it('the climb: places up today, else how many are racing (never a 0 or a ▼)', () => {
        expect(cardClimb({ rank: 123, rank_mid: 548 }, 1512)).toEqual({ key: 'climb', value: 425 });
        expect(cardClimb({ rank: 123, rank_mid: 120 }, 1512)).toEqual({ key: 'racing', value: 1512 });
        expect(cardClimb({ rank: 900, rank_mid: 900 }, 1512)).toEqual({ key: 'racing', value: 1512 });
    });

    it('the rank: your place in your city, else on the whole board', () => {
        const me = { rank: 400 };
        expect(cardRank({ me, city: { you: { name: 'London' }, rank: 123 } })).toEqual({ rank: 123, city: 'London' });
        expect(cardRank({ me, city: { you: null, rank: null } })).toEqual({ rank: 400, city: null });
        expect(cardRank({ me })).toEqual({ rank: 400, city: null });
        expect(cardRank({ me: null })).toBeNull();
    });
});

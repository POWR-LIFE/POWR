import { CREW_SHARE, crewBattery, formatKm, memberCharge, pickCrewReward, CREW_POOL } from '@/lib/crew';

const m = (id: string, steps: number, minutes = 0, isYou = false) => ({ id, name: id, isYou, steps, minutes });

describe('memberCharge', () => {
    it('counts steps one-for-one and an active minute as 100 steps', () => {
        expect(memberCharge({ steps: 2000, minutes: 25 })).toBe(4500);
        expect(memberCharge({ steps: -5, minutes: -1 })).toBe(0);
    });
});

describe('crewBattery', () => {
    it('sizes capacity to the crew so a bigger crew is not an easier one', () => {
        expect(crewBattery([m('you', 0, 0, true), m('a', 0), m('b', 0)]).capacity).toBe(3 * CREW_SHARE);
        expect(crewBattery([m('you', 0, 0, true), m('a', 0), m('b', 0), m('c', 0)]).capacity).toBe(4 * CREW_SHARE);
    });

    it('pools everyone and reports what is left as distance', () => {
        const b = crewBattery([m('you', 6000, 0, true), m('a', 4000), m('b', 0, 20)]);
        expect(b.total).toBe(12000);
        expect(b.pct).toBeCloseTo(12000 / 18000);
        expect(b.remaining).toBe(6000);
        expect(b.remainingKm).toBeCloseTo(6000 / 1300);
        expect(b.charged).toBe(false);
    });

    it('lists quiet members, never you', () => {
        const b = crewBattery([m('you', 0, 0, true), m('a', 0), m('b', 300)]);
        expect(b.quiet.map(q => q.id)).toEqual(['a']);
    });

    it('scales slices down together once it overflows, and is charged', () => {
        const b = crewBattery([m('you', 12000, 0, true), m('a', 12000), m('b', 0)]);
        expect(b.charged).toBe(true);
        expect(b.pct).toBe(1);
        const sum = b.slices.reduce((a, s) => a + s.share, 0);
        expect(sum).toBeCloseTo(1);
        expect(b.slices[0].share).toBeCloseTo(0.5);
        expect(b.slices[2].share).toBe(0);
    });
});

describe('formatKm', () => {
    it('reads cleanly at the ends', () => {
        expect(formatKm(0)).toBe('0 km');
        expect(formatKm(0.04)).toBe('0.1 km');
        expect(formatKm(1.44)).toBe('1.4 km');
        expect(formatKm(12.6)).toBe('13 km');
    });
});

describe('pickCrewReward', () => {
    it('maps a roll onto the pool', () => {
        expect(pickCrewReward(0)).toBe(CREW_POOL[0]);
        expect(pickCrewReward(1)).toBe(CREW_POOL[CREW_POOL.length - 1]);
    });
});

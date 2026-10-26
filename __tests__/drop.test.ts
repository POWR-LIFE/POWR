import { AUTO_STARTER, autoTarget, DROP_POOLS, dropProgress, dropTier, nextMove, pickDropReward } from '@/lib/drop';

describe('dropProgress', () => {
    const steady = dropTier('steady'); // 10,000 steps or 30 min

    it('takes the further along of steps and minutes', () => {
        expect(dropProgress(steady, 5000, 0)).toBeCloseTo(0.5);
        expect(dropProgress(steady, 1000, 24)).toBeCloseTo(0.8);
    });

    it('clamps to 0..1 and ignores negatives', () => {
        expect(dropProgress(steady, 25000, 0)).toBe(1);
        expect(dropProgress(steady, -500, -3)).toBe(0);
    });
});

describe('nextMove', () => {
    const steady = dropTier('steady');

    it('picks steps when the walk is quicker', () => {
        // 1,800 steps ≈ 18 min on foot vs 30 active min
        const m = nextMove(steady, 8200, 0);
        expect(m.route).toBe('steps');
        expect(m.minutes).toBe(18);
        expect(m.line).toBe('1,800 steps opens it');
        expect(m.left).toBe('1,800 steps');
        expect(m.alt).toBe('or 30 active min');
    });

    it('picks active minutes when they are closer', () => {
        // 6,800 steps ≈ 68 min vs 12 active min
        const m = nextMove(steady, 3200, 18);
        expect(m.route).toBe('minutes');
        expect(m.minutes).toBe(12);
        expect(m.line).toBe('12 active min opens it');
        expect(m.left).toBe('12 active min');
        expect(m.alt).toBe('or 6,800 steps');
    });

    it('prefers the walk on a tie', () => {
        const m = nextMove(steady, 7000, 0); // 3,000 steps = 30 min = 30 active min
        expect(m.route).toBe('steps');
    });

    it('reads as open once either route is done', () => {
        expect(nextMove(steady, 10000, 0)).toMatchObject({ minutes: 0, alt: null });
        expect(nextMove(steady, 0, 30)).toMatchObject({ minutes: 0, route: 'minutes', alt: null });
    });
});

describe('pickDropReward', () => {
    it('maps a roll onto the tier pool, including the edges', () => {
        expect(pickDropReward('long', 0)).toBe(DROP_POOLS.long[0]);
        expect(pickDropReward('long', 0.999)).toBe(DROP_POOLS.long[2]);
        expect(pickDropReward('long', 1)).toBe(DROP_POOLS.long[2]);
    });
});

describe('autoTarget', () => {
    const week = (steps: number, minutes: number, n = 14) =>
        Array.from({ length: n }, (_, i) => ({ steps: steps + (i % 3 - 1) * 400, minutes: i % 2 ? minutes : 0 }));

    it('starts new members on the starter target', () => {
        expect(autoTarget(week(8000, 30, 3))).toMatchObject({ ...AUTO_STARTER, basis: 'starter' });
    });

    it('sits a nudge above your typical day', () => {
        const t = autoTarget(week(7600, 25));
        expect(t.basis).toBe('history');
        expect(t.typicalSteps).toBe(7600);
        expect(t.steps).toBe(8500); // 7,600 × 1.1 = 8,360 → nearest 500
        expect(t.minutes).toBe(30); // 25 + 5
    });

    it('eases back to typical after a big day', () => {
        const days = [...week(7600, 25, 13), { steps: 16000, minutes: 0 }];
        const t = autoTarget(days);
        expect(t.basis).toBe('recovery');
        expect(t.steps).toBe(7500);
    });

    it('doesn’t claim a rest day when easing off changes nothing', () => {
        // 4,300 a day: the usual (4,730) and the eased (4,300) both round to 4,500
        const days = [...week(4300, 0, 13), { steps: 9000, minutes: 0 }];
        expect(autoTarget(days)).toMatchObject({ basis: 'history', steps: 4500 });
    });

    it('asks for less on a comeback', () => {
        expect(autoTarget(week(7600, 25), { comeback: true })).toMatchObject({ basis: 'comeback', steps: 5500, minutes: 20 }); // 17.5 → nearest 5
    });

    it('keeps targets inside sane bounds', () => {
        expect(autoTarget(week(1500, 0)).steps).toBe(4000);
        expect(autoTarget(week(30000, 120)).steps).toBe(15000);
        expect(autoTarget(week(30000, 120)).minutes).toBe(60);
    });
});

import {
    activeDaysTo, cumulative, defaultRival, EMPTY_TALLY, OTHER, placesFor, planOptions, pointsMix, raceOptions, racePace, racePlan, raceRows, raceTarget, rankAfter,
    sampleClimb, samplePath, type SeriesPath, sessionValues, tallyTo, topActivity,
} from '@/lib/seriesPath';

const d = (day: number, acts: [string, number, number?][]) => ({
    day, pts: acts.reduce((n, a) => n + a[1], 0), acts: acts.map(([type, pts, n]) => ({ type, pts, n: n ?? 1 })),
});

// The live #1 on 19 Nov, roughly: gym most days, a run, walks.
const ava: SeriesPath = {
    user_id: 'ava', you: false, points: 160,
    days: [
        d(1, [['gym', 20], ['walking', 5]]),
        d(2, [['gym', 20], ['running', 13], ['walking', 4]]),
        d(3, [['gym', 20], ['walking', 5], ['yoga', 5]]),
        d(4, [['gym', 20], ['cycling', 6], ['walking', 4]]),
        d(5, [['gym', 20], ['running', 13], ['walking', 5]]),
    ],
};
// You: walks most days, one gym visit, a yoga class, a rest day.
const you: SeriesPath = {
    user_id: 'me', you: true, points: 52,
    days: [d(1, [['walking', 3]]), d(2, [['gym', 20], ['yoga', 9]]), d(4, [['walking', 5]]), d(5, [['gym', 15]])],
};

describe('tallyTo', () => {
    it('adds up points and sessions to the end of a day', () => {
        expect(tallyTo(ava, 2)).toEqual({ total: 62, pts: { gym: 40, walking: 9, running: 13 }, n: { gym: 2, walking: 2, running: 1 } });
        expect(tallyTo(ava, Infinity).total).toBe(160);
        expect(tallyTo(you, Infinity)).toEqual({ total: 52, pts: { walking: 8, gym: 35, yoga: 9 }, n: { walking: 2, gym: 2, yoga: 1 } });
    });

    it('counts a day as one session when an older server sends no counts', () => {
        expect(tallyTo({ days: [{ day: 1, pts: 40, acts: [{ type: 'gym', pts: 40 }] }] }, 1).n.gym).toBe(1);
    });

    it('is empty with no path', () => {
        expect(tallyTo(null, Infinity)).toEqual(EMPTY_TALLY);
    });
});

describe('raceRows', () => {
    it('names the three biggest activities and folds the rest into other', () => {
        const rows = raceRows(tallyTo(you, Infinity), tallyTo(ava, Infinity));
        expect(rows.map((r) => r.type)).toEqual(['gym', 'walking', 'running', OTHER]);
        expect(rows[0]).toEqual({ type: 'gym', a: { pts: 35, n: 2 }, b: { pts: 100, n: 5 } });
        // yoga (9 + 5) and cycling (6)
        expect(rows[3]).toEqual({ type: OTHER, a: { pts: 9, n: 1 }, b: { pts: 11, n: 2 } });
    });

    it('keeps a lone fourth by name', () => {
        const a = { total: 4, pts: { gym: 1, running: 1, walking: 1, yoga: 1 }, n: {} };
        expect(raceRows(a, null).map((r) => r.type)).toEqual(['gym', 'running', 'walking', 'yoga']);
    });

    it('works for one member on their own', () => {
        expect(raceRows(tallyTo(ava, Infinity), null)[0]).toEqual({ type: 'gym', a: { pts: 100, n: 5 }, b: { pts: 0, n: 0 } });
    });
});

describe('raceTarget', () => {
    it('picks what passes them in the fewest sessions', () => {
        // gap 108; gym pays 135 / 7 ≈ 19.3 a session → 6 visits; running 13 → 9 runs; walking far more.
        expect(raceTarget(tallyTo(you, Infinity), tallyTo(ava, Infinity))).toMatchObject({ kind: 'chase', type: 'gym', sessions: 6, gap: 108 });
        // what a session is worth, for the 'after' bar: (35 + 100) / (2 + 5)
        expect((raceTarget(tallyTo(you, Infinity), tallyTo(ava, Infinity)) as { per: number }).per).toBeCloseTo(135 / 7);
    });

    it('never targets something you already out-earn them on', () => {
        const me = { total: 30, pts: { gym: 30 }, n: { gym: 1 } };
        const them = { total: 40, pts: { gym: 20, walking: 20 }, n: { gym: 1, walking: 4 } };
        expect(raceTarget(me, them)).toEqual({ kind: 'chase', type: 'walking', sessions: 3, gap: 10, per: 5 });
    });

    it('needs one point more than level', () => {
        const t = { total: 20, pts: { gym: 20 }, n: { gym: 1 } };
        expect(raceTarget({ total: 0, pts: {}, n: {} }, t)).toEqual({ kind: 'chase', type: 'gym', sessions: 2, gap: 20, per: 20 });
        expect(raceTarget(t, t)).toBeNull();
    });

    it('says by how much when you are ahead', () => {
        expect(raceTarget(tallyTo(ava, Infinity), tallyTo(you, Infinity))).toEqual({ kind: 'ahead', lead: 108 });
    });

    it('has nothing to say when neither has points', () => {
        expect(raceTarget(EMPTY_TALLY, EMPTY_TALLY)).toBeNull();
    });
});

describe('defaultRival', () => {
    const podium = [{ id: 'c', rank: 3 }, { id: 'a', rank: 1 }, { id: 'b', rank: 2 }];
    it('is the last prize place when you are off the podium', () => {
        expect(defaultRival(612, podium)?.id).toBe('c');
        expect(defaultRival(null, podium)?.id).toBe('c');
    });

    it('is the place above you on the podium, or #2 when you lead', () => {
        expect(defaultRival(3, podium.filter((p) => p.rank !== 3))?.id).toBe('b');
        expect(defaultRival(2, podium.filter((p) => p.rank !== 2))?.id).toBe('a');
        expect(defaultRival(1, podium.filter((p) => p.rank !== 1))?.id).toBe('b');
    });

    it('is nobody without a podium', () => {
        expect(defaultRival(612, [])).toBeNull();
    });
});

describe('raceOptions', () => {
    it('lists every way past them, fewest sessions first', () => {
        // gap 108: gym ≈ 19.3 a visit → 6; running 13 → 9; yoga 14/2 = 7 → 16; cycling 6 → 19; walking 31/7 → 25
        expect(raceOptions(tallyTo(you, Infinity), tallyTo(ava, Infinity))).toEqual([
            { type: 'gym', sessions: 6 }, { type: 'running', sessions: 9 }, { type: 'yoga', sessions: 16 },
            { type: 'cycling', sessions: 19 }, { type: 'walking', sessions: 25 },
        ]);
    });

    it('agrees with the target on the best one', () => {
        const t = raceTarget(tallyTo(you, Infinity), tallyTo(ava, Infinity));
        expect(t?.kind === 'chase' && t.sessions).toBe(raceOptions(tallyTo(you, Infinity), tallyTo(ava, Infinity))[0].sessions);
    });

    it('is empty when you are ahead', () => {
        expect(raceOptions(tallyTo(ava, Infinity), tallyTo(you, Infinity))).toEqual([]);
    });
});

describe('racePlan', () => {
    const me = tallyTo(you, Infinity); // 52 after 5 days: 10.4 a day
    const her = tallyTo(ava, Infinity); // 160 after 5 days: 32 a day

    it('runs you both on to the end of the round at your pace so far', () => {
        // Close rival: 70 after 5 days (14 a day), 12 days left → ends on 70 + 14 × 11 = 224; you on 52 + 10.4 × 11 = 166.
        const close = { total: 70, pts: { gym: 60, walking: 10 }, n: { gym: 3, walking: 5 } };
        const p = racePlan(me, close, 5, 12);
        expect(p).toMatchObject({ kind: 'finish', type: 'gym', youEnd: 166, themEnd: 224 });
        // gym pays (35 + 60) / (2 + 3) = 19 a visit → 59 / 19 → 4 extra visits
        expect(p && p.kind === 'finish' && p.sessions).toBe(4);
    });

    it('says more than passing where they are today would', () => {
        // Today the gap to a 70-point rival is 18: one visit. To finish ahead takes 4.
        const close = { total: 70, pts: { gym: 60, walking: 10 }, n: { gym: 3, walking: 5 } };
        expect(raceTarget(me, close)).toMatchObject({ sessions: 1 });
        expect(racePlan(me, close, 5, 12)).toMatchObject({ sessions: 4 });
    });

    it('becomes the next step up the board when one extra a day cannot do it', () => {
        // Ava ends on 160 + 32 × 11 = 512, you on 166: 347 / 19.3 = 18 visits in 12 days.
        expect(racePlan(me, her, 5, 12)).toEqual({ kind: 'climb', type: 'gym', per: 135 / 7, themRate: 32 });
    });

    it('on the last day is just today\'s gap', () => {
        const close = { total: 70, pts: { gym: 60, walking: 10 }, n: { gym: 3, walking: 5 } };
        expect(racePlan(me, close, 16, 1)).toMatchObject({ kind: 'finish', sessions: 1, youEnd: 52, themEnd: 70 });
    });

    it('says your lead when you are ahead, and nothing when level on everything', () => {
        expect(racePlan(her, me, 5, 12)).toEqual({ kind: 'ahead', lead: 108 });
        expect(racePlan(me, me, 5, 12)).toBeNull();
    });
});

describe('planOptions and sessionValues', () => {
    const me = tallyTo(you, Infinity);
    const close = { total: 70, pts: { gym: 40, running: 20, walking: 10 }, n: { gym: 2, running: 2, walking: 5 } };

    it('lists the other ways to the same finish that fit one a day', () => {
        const p = racePlan(me, close, 5, 12);
        if (!p || p.kind !== 'finish') throw new Error('expected a finish plan');
        // Running is the plan here (they out-run you by the most). need 224 − 166 + 1 = 59:
        // gym 75 / 4 a visit → 4; yoga 9 → 7; walking 18 / 7 → 23 days: too many for 12.
        expect(p.type).toBe('running');
        expect(planOptions(me, close, p, 12)).toEqual([{ type: 'gym', sessions: 4 }, { type: 'yoga', sessions: 7 }]);
    });

    it('ranks what a session of each is worth', () => {
        expect(sessionValues(me, close).map((x) => x.type)).toEqual(['gym', 'running', 'yoga', 'walking']);
    });
});

describe('placesFor, rankAfter and sampleClimb', () => {
    const climb = { rank: 612, ladder: [612, 610, 600, 590, 500] };

    it('reads places gained off the ladder', () => {
        expect(placesFor(climb, 3)).toBe(12);
        expect(rankAfter(climb, 3)).toBe(600);
        expect(placesFor(climb, 1)).toBe(0);
    });

    it('uses the last rung past the end, and says 0 without a ladder', () => {
        expect(placesFor(climb, 50)).toBe(112);
        expect(placesFor(null, 19)).toBe(0);
        expect(placesFor({ rank: 5, ladder: [] }, 19)).toBe(0);
        expect(placesFor(climb, 0)).toBe(0);
    });

    it('dev sample: climbs evenly to just outside the podium, then into it', () => {
        const c = sampleClimb(612, 52, 118);
        expect(c?.ladder.length).toBe(200);
        expect(c?.ladder[0]).toBeLessThanOrEqual(612);
        expect(c?.ladder[65]).toBe(4); // level with the #3
        expect(c?.ladder[66]).toBe(3); // past them
        expect(c?.ladder.every((r, i, a) => i === 0 || r <= a[i - 1])).toBe(true);
        expect(sampleClimb(3, 100, 90)).toBeNull();
    });
});

describe('racePace', () => {
    it('spreads the sessions over the days left', () => {
        expect(racePace(4, 12, 'gym')).toEqual({ kind: 'every', days: 3 });
        expect(racePace(6, 12, 'gym')).toEqual({ kind: 'every', days: 2 });
        expect(racePace(7, 12, 'gym')).toEqual({ kind: 'daily' });
        expect(racePace(12, 12, 'gym')).toEqual({ kind: 'daily' });
    });

    it('says when it takes more than one a day', () => {
        expect(racePace(9, 4, 'running')).toEqual({ kind: 'perDay', n: 3 });
        // a gym's check-in and the day's walk only pay once a day
        expect(racePace(13, 12, 'gym')).toEqual({ kind: 'tooMany' });
        expect(racePace(30, 12, 'walking')).toEqual({ kind: 'tooMany' });
    });
});

describe('pointsMix', () => {
    it('names the top three and folds the rest, adding up to 100', () => {
        const m = pointsMix(tallyTo(ava, Infinity));
        expect(m.map((x) => x.type)).toEqual(['gym', 'running', 'walking', OTHER]);
        expect(m[0]).toEqual({ type: 'gym', pts: 100, pct: 63 });
        expect(m.reduce((n, x) => n + x.pct, 0)).toBe(100);
    });

    it('keeps a lone fourth by name, and thirds still add up to 100', () => {
        expect(pointsMix({ total: 4, pts: { a: 1, b: 1, c: 1, d: 1 }, n: {} }).map((x) => x.type)).toEqual(['a', 'b', 'c', 'd']);
        expect(pointsMix({ total: 3, pts: { a: 1, b: 1, c: 1 }, n: {} }).map((x) => x.pct)).toEqual([34, 33, 33]);
    });

    it('is empty with no points', () => {
        expect(pointsMix(EMPTY_TALLY)).toEqual([]);
    });
});

describe('cumulative and activeDaysTo', () => {
    it('runs from zero at the start through every day, rest days flat', () => {
        expect(cumulative(you, 5)).toEqual([0, 3, 32, 32, 37, 52]);
        expect(cumulative(ava, 5)).toEqual([0, 25, 62, 92, 122, 160]);
        expect(cumulative(null, 3)).toEqual([0, 0, 0, 0]);
    });

    it('counts the days with points so far', () => {
        expect(activeDaysTo(you, 5)).toBe(4);
        expect(activeDaysTo(you, 3)).toBe(2);
        expect(activeDaysTo(null, 5)).toBe(0);
    });
});

describe('topActivity', () => {
    it('is what most of the points came from', () => {
        expect(topActivity(tallyTo(ava, Infinity))).toBe('gym');
        expect(topActivity({ total: 10, pts: { walking: 6, yoga: 4 }, n: {} })).toBe('walking');
    });

    it('breaks a tie the same way every time, and is null with no points', () => {
        expect(topActivity({ total: 10, pts: { yoga: 5, gym: 5 }, n: {} })).toBe('gym');
        expect(topActivity(EMPTY_TALLY)).toBeNull();
    });
});

describe('samplePath (dev only)', () => {
    it.each([[160, 5], [1, 1], [7, 16], [2400, 16], [33, 3]])('ends exactly on the board total (%i over %i days)', (pts, days) => {
        const p = samplePath('user-123', pts, days, false);
        expect(p.sample).toBe(true);
        expect(p.days.reduce((n, x) => n + x.pts, 0)).toBe(pts);
        p.days.forEach((x) => {
            expect(x.pts).toBeGreaterThan(0);
            expect(x.acts.reduce((n, a) => n + a.pts, 0)).toBe(x.pts);
            x.acts.forEach((a) => expect(a.n).toBeGreaterThanOrEqual(1));
        });
    });

    it('is the same every time for the same member', () => {
        expect(samplePath('x', 120, 5, true)).toEqual(samplePath('x', 120, 5, true));
    });

    it('has nothing to replay at zero points', () => {
        expect(samplePath('x', 0, 5, true).days).toEqual([]);
    });
});

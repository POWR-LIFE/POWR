/**
 * The Series on Home (components/series/SeriesToday): the top line's one move,
 * the Draw chip on the streak card, the ×2 badges on the activity rings, and
 * what a gym visit is worth against your rival.
 */
import { countdown, type Seen, sinceLabel, sinceLines } from '@/components/series/SeriesHomeCards';
import {
    liveComing, liveNextMoment, payoffLine, type SeriesToday, seriesDrawChip, seriesNextMove, seriesRingBoosts, seriesSessionLine, type TodayMoment,
} from '@/components/series/SeriesToday';
import type { SeriesBoard, SeriesMoment } from '@/lib/api/series';
import { gapToday } from '@/components/series/todayMove';
import type { Rival } from '@/lib/dev/seriesPrototype';

const rival = (gap: number, ahead = false, how = 'One run does it'): Rival => ({
    p: { id: 'r', name: 'Arjun Brown', pts: 60, today: 0, mid: 1, title: null, mult: 1, act: 'walk', city: '', you: false, event: false, totalEarned: 0 },
    rank: 81, gap, ahead, friend: false, sealed: false, how, share: 0.5, meRank: 82, mePts: 59, meToday: 0,
});
const moment = (m: Partial<TodayMoment>): TodayMoment => ({
    kind: 'power_hour', name: 'Power Hour', what: '', icon: 'timer-outline', endsAt: null, multiplier: 2, activities: null, topN: null, ...m,
});
const today = (over: Partial<SeriesToday> = {}): SeriesToday => ({
    source: 'live', season: 'Autumn Series', slug: 'autumn-01', roundName: 'Round 01', rank: 82, total: 1550, move: 0, heat: null, blind: false,
    day: 6, days: 15, draw: { logged: 4, need: 10, todayLogged: true }, drawDots: [], prizesOn: 'on Mon 30 Nov',
    points: 59, pointsToday: 0, rival: rival(12), moment: null, nextMoment: null, around: [], news: null, cityName: null,
    prizes: { sample: false, places: [], named: {} }, gainFor: () => 0, ...over,
});
const draw = (logged: number, todayLogged: boolean, day = 6) => today({ day, draw: { logged, need: 10, todayLogged } });

describe('the top line', () => {
    it('turns the rival gap into the move', () => {
        expect(seriesNextMove(today())).toBe('One run passes Arjun');
        expect(seriesNextMove(today({ rival: rival(40, false, 'About 3 sessions do it') }))).toBe('About 3 sessions pass Arjun');
        expect(seriesNextMove(today({ rival: rival(40, false, 'About 4 walks to pass') }))).toBe('About 4 walks pass Arjun');
        expect(seriesNextMove(today({ rival: rival(5, true) }))).toBe('Stay clear of Arjun');
    });

    it('names nobody in Blind Mode, and says climb with no rival', () => {
        expect(seriesNextMove(today({ blind: true }))).toBe('Bank points in the dark');
        expect(seriesNextMove(today({ rival: null }))).toBe('Move today to climb');
        expect(seriesNextMove(today({ rival: null, points: 0 }))).toBe('One session puts you on the board');
    });

    it('while the Drop is sealed, says its route, and the pass when it covers the gap', () => {
        const drop = { head: 'Walk 18 min', tail: '', passes: true, who: 'Arjun', sealed: false };
        expect(seriesNextMove(today(), drop)).toBe('Walk 18 min passes Arjun');
        expect(seriesNextMove(today(), { ...drop, passes: false })).toBe('Walk 18 min opens your Drop');
    });
});

describe('the Draw chip', () => {
    it('says what is at stake today', () => {
        // Day 6 of 15, 4 of 10 logged: today + 9 more days to find 6.
        expect(seriesDrawChip(draw(4, false))).toEqual({ text: 'DRAW · NOT LOGGED TODAY', tone: 'act' });
        expect(seriesDrawChip(draw(4, true))).toEqual({ text: 'DRAW 4/10 · 3 TO SPARE', tone: 'calm' });
        expect(seriesDrawChip(draw(10, true))).toEqual({ text: 'IN THE DRAW', tone: 'done' });
        expect(seriesDrawChip(null)).toBeUndefined();
    });

    it('warns on the last day you can miss, then says out of reach', () => {
        // Day 10: today + 5 more days, 6 to find.
        expect(seriesDrawChip(draw(4, false, 10))).toEqual({ text: 'DRAW · MOVE TODAY', tone: 'warn' });
        expect(seriesDrawChip(draw(3, false, 10))).toEqual({ text: 'DRAW OUT OF REACH', tone: 'out' });
        expect(seriesDrawChip(draw(9, true, 15))).toEqual({ text: 'DRAW OUT OF REACH', tone: 'out' });
    });
});

describe('ring badges', () => {
    it('only a boost that picks activities badges rings', () => {
        const dd = seriesRingBoosts(today({ moment: moment({ kind: 'double_down', activities: ['running'] }) }));
        expect(dd).toEqual({ running: '×2' });
        // Power Hour and All In are said by the banner alone.
        expect(seriesRingBoosts(today({ moment: moment({}) }))).toBeUndefined();
        expect(seriesRingBoosts(today({ moment: moment({ kind: 'all_in', multiplier: 1.5, topN: 10 }) }))).toBeUndefined();
        // A Double Down with no activities listed boosts everything: banner only too.
        expect(seriesRingBoosts(today({ moment: moment({ kind: 'double_down' }) }))).toBeUndefined();
    });

    it('Blind Mode and no moment show nothing', () => {
        expect(seriesRingBoosts(today({ moment: moment({ kind: 'blind', multiplier: 1 }) }))).toBeUndefined();
        expect(seriesRingBoosts(today())).toBeUndefined();
    });
});

describe('a gym visit, in the Series', () => {
    it('says whether it passes your rival', () => {
        expect(seriesSessionLine(today(), 20)).toBe('This visit: ~20 Series pts · enough to pass Arjun');
        expect(seriesSessionLine(today({ rival: rival(30) }), 20)).toBe('This visit: ~20 Series pts · 11 short of Arjun');
        expect(seriesSessionLine(today({ rival: rival(5, true) }), 20)).toBe('This visit: ~20 Series pts · keeps you clear of Arjun');
    });

    it('counts a boost that covers gym visits, and only that', () => {
        expect(seriesSessionLine(today({ moment: moment({}) }), 15)).toBe('This visit: ~30 Series pts (Power Hour ×2) · enough to pass Arjun');
        expect(seriesSessionLine(today({ moment: moment({ kind: 'double_down', name: 'Double Down', activities: ['running'] }) }), 15))
            .toBe('This visit: ~15 Series pts · enough to pass Arjun');
    });

    it('names nobody in Blind Mode', () => {
        expect(seriesSessionLine(today({ blind: true }), 20)).toBe('This visit: ~20 Series pts');
    });
});

describe('the rival card bar', () => {
    const r = (gap: number, ahead: boolean, meToday: number, theirToday: number): Rival => ({
        ...rival(gap, ahead), meToday, p: { ...rival(gap, ahead).p, today: theirToday },
    });

    it('chasing: the share of this morning\'s gap you closed', () => {
        expect(gapToday(r(35, false, 1156, 60))).toMatchObject({ label: 'Gap closed today', value: '1,096 pts', tone: 'gold' });
        expect(gapToday(r(30, false, 10, 0)).fill).toBeCloseTo(0.25);
        expect(gapToday(r(30, false, 0, 0))).toMatchObject({ value: '0 pts', fill: 0 });
    });

    it('chasing and losing ground: grey, and says when they passed you today', () => {
        expect(gapToday(r(40, false, 0, 10))).toMatchObject({ label: 'Gap grew today', value: '+10 pts', fill: 0.25, tone: 'grey' });
        // You were 21 ahead this morning; they're 1 ahead now.
        expect(gapToday(r(1, false, 0, 22))).toMatchObject({ label: 'Arjun passed you today', value: '+22 pts', fill: 1, tone: 'grey' });
    });

    it('ahead: your lead grew, or how much of it they closed', () => {
        expect(gapToday(r(20, true, 10, 0))).toMatchObject({ label: 'Your lead grew today', value: '+10 pts', fill: 0.5, tone: 'green' });
        expect(gapToday(r(5, true, 25, 0))).toMatchObject({ label: 'You passed Arjun today', tone: 'green' });
        expect(gapToday(r(10, true, 0, 10))).toMatchObject({ label: 'Arjun closed today', value: '10 pts', fill: 0.5, tone: 'grey' });
        expect(gapToday(r(1, true, 0, 0))).toMatchObject({ label: 'Your lead held today', value: '0 pts', fill: 0 });
    });

    it('says nothing in Blind Mode', () => {
        expect(gapToday({ ...rival(12), sealed: true })).toMatchObject({ value: '?', fill: 0 });
    });
});

describe('since you last looked', () => {
    const seen = (over: Partial<Seen> = {}): Seen => ({
        slug: 'autumn-01', at: 0, rank: 131, points: 40, logged: 4, need: 10,
        around: [{ id: 'z', name: 'Zara Khan', pts: 45 }, { id: 'o', name: 'Ola Ade', pts: 42 }, { id: 'b', name: 'Ben Hart', pts: 30 }],
        ...over,
    });
    const now = (over: Partial<SeriesToday> = {}) => today({
        rank: 82, points: 59,
        around: [{ id: 'z', name: 'Zara Khan', pts: 50 }, { id: 'o', name: 'Ola Ade', pts: 42 }, { id: 'b', name: 'Ben Hart', pts: 70 }],
        ...over,
    });

    it('says places, who you passed, who passed you, then your rival', () => {
        expect(sinceLines(seen(), now()).map((l) => l.text)).toEqual([
            'Up 49 places · you’re #82',
            'You passed Zara and Ola',
            'Ben passed you',
        ]);
        expect(sinceLines(seen({ around: [] }), now()).map((l) => l.text)).toEqual(['Up 49 places · you’re #82', 'Arjun is 12 pts ahead']);
    });

    it('only names people the board showed both times', () => {
        expect(sinceLines(seen(), now({ around: [] })).map((l) => l.text)).toEqual(['Up 49 places · you’re #82', 'Arjun is 12 pts ahead']);
    });

    it('says when you made the Draw, and nothing when nothing changed', () => {
        expect(sinceLines(seen({ rank: 82, around: [] }), now({ draw: { logged: 10, need: 10, todayLogged: true } }))[0].text).toBe('You’re in the Draw');
        expect(sinceLines(seen({ rank: 82, around: [] }), now())).toEqual([]);
    });

    it('hides places and names in Blind Mode', () => {
        expect(sinceLines(seen(), now({ blind: true }))).toEqual([]);
    });

    it('labels the time since in London days', () => {
        const at = Date.UTC(2026, 10, 18, 9, 14);
        expect(sinceLabel(at, at + 4 * 3_600_000)).toBe('SINCE 09:14');
        expect(sinceLabel(at, at + 20 * 3_600_000)).toBe('SINCE YESTERDAY');
        expect(sinceLabel(at, at + 3 * 86_400_000)).toBe('SINCE WED');
    });
});

describe('the payoff', () => {
    it('says the points, the places and who you passed', () => {
        expect(payoffLine({ pts: 22, places: 12, passed: 'Arjun', blind: false })).toBe('+22 Series pts · up 12 places · passed Arjun');
        expect(payoffLine({ pts: 8, places: 1, passed: null, blind: false })).toBe('+8 Series pts · up 1 place');
        expect(payoffLine({ pts: 8, places: 0, passed: null, blind: false })).toBe('+8 Series pts');
        expect(payoffLine({ pts: 8, places: 4, passed: 'Arjun', blind: true })).toBe('+8 Series pts · banked in the dark');
    });
});

describe('before and between rounds', () => {
    const board = (state: SeriesBoard['state'], over: Partial<SeriesBoard> = {}): SeriesBoard => ({
        state,
        round: { slug: 'autumn-01', name: 'Round 01', starts_at: '2026-11-15T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', day: 1, days: 16, draw_days: 10 },
        next: { slug: 'autumn-02', name: 'Round 02', starts_at: '2026-12-01T00:00:00Z' },
        total: 1550, me: { rank: 304, rank_mid: 300, points: 60, today: 0, days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
        rows: [], rival: null, gym: null,
        duels: { week_start: '', ends_at: '', you: 0, active: [], invites: [], sent: [], open: [] },
        ...over,
    });
    const P = { sample: false, places: [], named: {} };

    it('before a round: the round, when it starts, the Draw', () => {
        const c = liveComing(board('upcoming'), 'Autumn Series', P, false)!;
        expect(c).toMatchObject({ phase: 'upcoming', roundName: 'Round 01', days: 16, need: 10, finish: null });
        expect(c.next).toEqual({ name: 'Round 01', startsAt: Date.parse('2026-11-15T00:00:00Z') });
    });

    it('between rounds: where you finished and the next round', () => {
        const c = liveComing(board('ended'), 'Autumn Series', P, true)!;
        expect(c).toMatchObject({ phase: 'between', finish: { rank: 304, total: 1550, inDraw: true }, winners: true });
        expect(c.next?.name).toBe('Round 02');
        expect(liveComing(board('running'), 'Autumn Series', P, false)).toBeNull();
    });

    it('asks for a city only when there are options and none is set', () => {
        const city = { you: null, rank: null, members: null, open: false, min_cities: 3, cities: [], forming: 0, options: ['London', 'Leeds'] };
        expect(liveComing(board('upcoming', { city }), 'S', P, false)?.cityPick).toBe(true);
        expect(liveComing(board('upcoming', { city: { ...city, you: { name: 'London', source: 'gym', locked: true } } }), 'S', P, false)?.cityPick).toBe(false);
    });

    it('counts down in days, then hours, then minutes', () => {
        expect(countdown(23 * 86_400_000 + 4 * 3_600_000 + 60_000)).toBe('23d 04h');
        expect(countdown(14 * 3_600_000 + 5 * 60_000)).toBe('14h 05m');
        expect(countdown(38 * 60_000 + 30_000)).toBe('38m');
    });
});

describe('the next moment', () => {
    const m = (id: string, kind: SeriesMoment['kind'], starts: string | null, ends: string | null, name: string | null = 'Double Down'): SeriesMoment =>
        ({ id, kind, name, line: '', starts_at: starts, ends_at: ends, multiplier: 2 });
    const now = Date.parse('2026-11-17T12:00:00Z');

    it('is the next announced one', () => {
        const next = liveNextMoment([
            m('a', 'gun', '2026-11-15T00:00:00Z', '2026-11-16T00:00:00Z', 'The Gun'),
            m('b', 'double_down', '2026-11-18T00:00:00Z', '2026-11-19T00:00:00Z'),
            m('c', 'secret', null, null, null),
        ], now);
        expect(next).toMatchObject({ name: 'Double Down', when: 'Wed 18 Nov' });
    });

    it('falls back to a secret one still sealed, else nothing', () => {
        expect(liveNextMoment([m('c', 'secret', null, null, null)], now)?.name).toBe('A secret moment');
        expect(liveNextMoment([m('a', 'gun', '2026-11-15T00:00:00Z', '2026-11-16T00:00:00Z')], now)).toBeNull();
    });
});

/**
 * What every member sees from the gun to the end of the season, live:
 * Home's round card on 0 points (never a dash or a 0), the coming card
 * between rounds and after the last one, the League card's numbers (the
 * server sends no last-round or best place), the season-over header, the
 * leaders on the board, and the Squad Builder line.
 */
import { comingStats } from '@/components/series/SeriesHomeCards';
import { roundStats } from '@/components/series/SeriesRound';
import { roundCardStats } from '@/components/series/SeriesRoundCard';
import type { SeriesComing, SeriesToday } from '@/components/series/SeriesToday';
import { fromLive } from '@/components/series/seriesView';
import type { SeriesBoard, SeriesRow } from '@/lib/api/series';
import type { Rival } from '@/lib/dev/seriesPrototype';
import i18n from '@/lib/i18n';
import en from '@/shared/i18n/en/app/series.json';
import es from '@/shared/i18n/es/app/series.json';
import fr from '@/shared/i18n/fr/app/series.json';

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o);

const rival = (gap: number, ahead = false): Rival => ({
    p: { id: 'r', name: 'Arjun Brown', pts: 60, today: 0, mid: 1, title: null, mult: 1, act: 'walk', city: '', you: false, event: false, totalEarned: 0 },
    rank: 81, gap, ahead, friend: false, sealed: false, how: 'One run does it', share: 0.5, meRank: 82, mePts: 59, meToday: 0,
});
const today = (over: Partial<SeriesToday> = {}): SeriesToday => ({
    source: 'live', season: 'Autumn Series', slug: 'autumn-01', roundName: 'Round 01', rank: 82, total: 1550, move: 0, blind: false,
    day: 6, days: 16, draw: { logged: 4, need: 10, todayLogged: true }, drawDots: [], prizesOn: 'on Tue 1 Dec',
    points: 59, pointsToday: 0, rival: rival(12), moment: null, nextMoment: null, around: [], news: null, cityName: null,
    prizes: { sample: false, places: [], named: {} }, gainFor: () => 0, ...over,
});
const noDash = (xs: { value: string }[]) => xs.forEach((x) => {
    expect(x.value).not.toBe('—');
    expect(x.value).not.toMatch(/^0(\/|$)/);
});

describe('Home round card', () => {
    it('at the gun, on 0 points: how many are racing, the days left, the days the Draw takes', () => {
        const s = roundCardStats(today({ day: 1, points: 0, rival: rival(0), draw: { logged: 0, need: 10, todayLogged: false } }), t);
        expect(s.place).toEqual({ value: '1,550', label: 'Racing' });
        expect(s.gap).toEqual({ value: '16', label: 'Days left' });
        expect(s.draw).toMatchObject({ value: '10', label: 'Days for the draw' });
        noDash([s.place, s.gap, s.draw]);
    });

    it('no rival yet: the days left, not a dash', () => {
        expect(roundCardStats(today({ rival: null }), t).gap).toEqual({ value: '11', label: 'Days left' });
        expect(roundCardStats(today({ day: 16, rival: null }), t).gap).toEqual({ value: '1', label: 'Day left' });
    });

    it('once moving: place, gap and Draw days as before', () => {
        const s = roundCardStats(today(), t);
        expect(s.place).toMatchObject({ value: '#82', label: 'Of 1,550', tone: 'gold' });
        expect(s.gap).toEqual({ value: '12', label: 'Pts to Arjun' });
        expect(s.draw).toMatchObject({ value: '4/10', label: 'Draw days' });
        expect(roundCardStats(today({ rival: rival(5, true) }), t).gap).toMatchObject({ value: '5', tone: 'green' });
    });

    it('the Draw: in, out of reach (never 0/10), or the last day you can miss', () => {
        expect(roundCardStats(today({ draw: { logged: 10, need: 10, todayLogged: true } }), t).draw).toMatchObject({ value: '10/10', tone: 'green' });
        // Day 12 of 16, nothing logged: 5 days left for 10.
        expect(roundCardStats(today({ day: 12, draw: { logged: 0, need: 10, todayLogged: false } }), t).draw).toMatchObject({ value: 'Out', tone: 'red' });
        // Day 7, 0 logged, 10 days left today included: today is the last you can miss.
        expect(roundCardStats(today({ day: 7, draw: { logged: 0, need: 10, todayLogged: false } }), t).draw)
            .toMatchObject({ value: '10', label: 'Draw · move today', tone: 'orange' });
    });

    it('Blind Mode keeps its question marks', () => {
        const s = roundCardStats(today({ blind: true, points: 0, rival: rival(0) }), t);
        expect(s.place.value).toBe('?');
    });
});

describe('Home coming card', () => {
    const base: SeriesComing = {
        source: 'live', phase: 'between', season: 'Autumn Series', roundName: 'Round 02', next: null,
        finish: { rank: 40, total: 1600, inDraw: true }, days: 17, need: 10, cityPick: false, cityName: null,
        prizes: { sample: false, places: [], named: {} }, winners: true, invite: null, join: null, racing: null,
    };
    const now = Date.parse('2027-01-02T10:00:00Z');

    it('after the last round: where you finished and the Draw, no clock and no dash', () => {
        const items = comingStats(base, now, t);
        expect(items.map((x) => x.value)).toEqual(['#40', 'In']);
        noDash(items);
    });

    it('joined after the round that ended: you are in the next one', () => {
        const items = comingStats({ ...base, roundName: 'Round 01', finish: null, next: { name: 'Round 02', startsAt: Date.parse('2026-12-15T00:00:00Z') } }, Date.parse('2026-12-05T00:00:00Z'), t);
        expect(items.map((x) => x.label)).toEqual(['You’re in Round 02', 'Days in the round', 'To Round 02']);
        noDash(items);
    });

    it('nothing true to show: no stats (the card stays away)', () => {
        expect(comingStats({ ...base, finish: null }, now, t)).toEqual([]);
    });
});

describe('League, live', () => {
    const row = (rank: number, points: number, you = false): SeriesRow => ({
        user_id: you ? 'me' : `u${rank}`, name: you ? 'Me' : `Racer ${rank}`, avatar_url: null, country: null,
        rank, rank_mid: rank, points, today: 0, you,
    } as SeriesRow);
    const board = (over: Partial<SeriesBoard> = {}): SeriesBoard => ({
        state: 'running',
        round: { slug: 'autumn-01', name: 'Round 01', starts_at: '2026-11-15T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', day: 6, days: 16, draw_days: 10 },
        next: { slug: 'autumn-02', name: 'Round 02', starts_at: '2026-12-15T00:00:00Z' },
        total: 1550, me: { rank: 300, rank_mid: 304, points: 59, today: 12, days: [1, 2, 3, 4, 6] },
        rows: [row(1, 400), row(2, 380), row(3, 350), row(299, 60), row(300, 59, true), row(301, 58), row(302, 50)],
        rival: null, gym: null,
        duels: { week_start: '', ends_at: '', you: 0, active: [], invites: [], sent: [], open: [] },
        ...over,
    });

    it('shows the leaders above you, with the gap between', () => {
        const v = fromLive(board(), 'Autumn Series')!;
        const lanes = v.rows.filter((r) => r.type === 'lane').map((r) => (r.type === 'lane' ? r.rank : 0));
        expect(lanes).toEqual([1, 2, 3, 299, 300, 301, 302]);
        expect(v.rows.find((r) => r.type === 'sep')).toMatchObject({ n: 295 });
    });

    it('never in Blind Mode: the extra names would give the top away', () => {
        const v = fromLive(board(), 'Autumn Series', true)!;
        const lanes = v.rows.filter((r) => r.type === 'lane').map((r) => (r.type === 'lane' ? r.rank : 0)).sort((a, b) => a - b);
        expect(lanes).toEqual([299, 300, 301, 302]);
    });

    it('the card: your points and the Draw, not "Last round: New" and "Your best: —"', () => {
        const v = fromLive(board(), 'Autumn Series')!;
        expect(roundStats(v, t)).toEqual([
            { label: 'SERIES PTS', value: '59', sub: '+12 today' },
            { label: 'THE DRAW', value: '5/10', sub: 'days logged' },
        ]);
        const zero = fromLive(board({ round: { ...board().round, day: 1 }, me: { rank: 1500, rank_mid: 1500, points: 0, today: 0, days: [] } }), 'Autumn Series')!;
        const [pts, draw] = roundStats(zero, t);
        expect(pts).toMatchObject({ label: 'DAYS LEFT', value: '16' });
        expect(draw).toMatchObject({ value: '10 days', sub: 'to get in' });
        noDash([pts, draw]);
    });

    it('between rounds the header still points at the next one', () => {
        const v = fromLive(board({ state: 'ended' }), 'Autumn Series')!;
        expect(v.header).toBe('Autumn Series · Round 02 starts Tue 15 Dec');
        expect(v.next.none).toBe(false);
    });

    it('after the last round: the season is complete, never a past start date', () => {
        const v = fromLive(board({
            state: 'ended', next: null,
            round: { slug: 'autumn-02', name: 'Round 02', starts_at: '2026-12-15T00:00:00Z', ends_at: '2027-01-01T00:00:00Z', day: 17, days: 17, draw_days: 10 },
        }), 'Autumn Series')!;
        expect(v.header).toBe('Autumn Series · complete');
        expect(v.next.none).toBe(true);
        expect(v.hero.points).toBe(59);
    });
});

describe('Squad Builder line', () => {
    it('never names The Plague (no such moment runs)', () => {
        [en, fr, es].forEach((d) => expect(d.prizes.squadBuilder.how).not.toMatch(/Plague/));
    });
});

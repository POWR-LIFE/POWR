/**
 * DEV ONLY: the Autumn Series board on sample data, so the design can be
 * judged inside the real League tab before any backend exists. Nothing here
 * talks to the server, and release builds never see it (__DEV__).
 *
 * The model mirrors the approved mock (claude.ai artifact "Autumn Series
 * Board"): a big board is held as the top dozen plus a window of people
 * around you, ranks are base + index inside each window, and every session
 * re-sorts its window so overtakes animate.
 */
import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

type IconName = ComponentProps<typeof Ionicons>['name'];

export const SERIES_PROTOTYPE = __DEV__;

export type ActKey = 'walk' | 'run' | 'gym' | 'ride' | 'swim';
export const ACTS: Record<ActKey, { label: string; icon: IconName; min: [number, number]; ppm: number; outdoor: boolean }> = {
    walk: { label: 'Walk', icon: 'walk-outline', min: [20, 55], ppm: 3.2, outdoor: true },
    run: { label: 'Run', icon: 'fitness-outline', min: [20, 50], ppm: 6.4, outdoor: true },
    gym: { label: 'Gym session', icon: 'barbell-outline', min: [35, 70], ppm: 4.8, outdoor: false },
    ride: { label: 'Ride', icon: 'bicycle-outline', min: [25, 60], ppm: 4.6, outdoor: true },
    swim: { label: 'Swim', icon: 'water-outline', min: [20, 45], ppm: 6.0, outdoor: false },
};

export type TitleKey = 'leader' | 'wanted' | 'hot' | 'mover' | 'under' | 'rookie';
export const TITLES: Record<TitleKey, { label: string; icon: IconName; ember?: boolean }> = {
    leader: { label: 'LEADER', icon: 'ribbon-outline' },
    wanted: { label: 'MOST WANTED', icon: 'locate-outline', ember: true },
    hot: { label: 'HOT STREAK', icon: 'flame' },
    mover: { label: 'BIGGEST MOVER', icon: 'trending-up-outline' },
    under: { label: 'UNDERDOG', icon: 'arrow-up-circle-outline' },
    rookie: { label: 'ROOKIE', icon: 'leaf-outline' },
};

export type Person = {
    id: string;
    name: string;
    pts: number;
    today: number;
    /** Rank at local midnight: the arrow is mid - rank. */
    mid: number;
    title: TitleKey | null;
    mult: number;
    act: ActKey;
    city: string;
    you: boolean;
    /** Checked in on event night (×2 Series points). */
    event: boolean;
    /** Lifetime points, for the level pill. */
    totalEarned: number;
};

export type Seg = { base: number; people: Person[] };
export type LensKey = 'overall' | 'city' | 'gym' | 'friends';
export type Board = {
    key: LensKey;
    total: number;
    segs: Seg[];
    prizes: boolean;
    /** The next milestone above you on a big board: "N pts to the top 5%". */
    ms?: { label: string; pts: number };
};
/** Days of the round the prototype can jump between. */
export type SeriesState = 'day3' | 'eventNight' | 'day9' | 'rain' | 'flash' | 'final48';
export type Scale = 'pitch' | 'today';

export type Row =
    | { type: 'lane'; key: string; p: Person; rank: number; dark: boolean }
    | { type: 'sep'; key: string; n: number }
    | { type: 'prize'; key: string }
    | { type: 'dark'; key: string };

export type Model = {
    boards: Record<LensKey, Board>;
    /** Points scale: 1 on the 5,000-entrant board, 0.25 at today's size. */
    k: number;
    rnd: () => number;
    pid: number;
    bounty: { live: boolean; pot: number; claimedBy: string | null; from: string | null };
    hour: number;
};

export const STATE_INFO: Record<SeriesState, {
    label: string;
    day: number;
    left: string;
    mult: { icon: IconName; text: string };
    band?: { icon: IconName; text: string; right: string | null; tone: 'gold' | 'rain' };
    logged: number;
    flash: string;
}> = {
    day3: { label: 'DAY 3', day: 3, left: '12d 04h', mult: { icon: 'flame', text: '×1.25' }, logged: 3, flash: 'None used yet. 15 minutes’ notice by push.' },
    eventNight: {
        label: 'EVENT NIGHT', day: 6, left: '9d 05h', mult: { icon: 'location-outline', text: '×2.0' }, logged: 5, flash: 'None used yet. 15 minutes’ notice by push.',
        band: { icon: 'location-outline', text: 'EVENT NIGHT · ONE LDN · ×2 CHECKED IN', right: 'till 23:59', tone: 'gold' },
    },
    day9: { label: 'DAY 9', day: 9, left: '6d 04h', mult: { icon: 'flame', text: '×1.25' }, logged: 7, flash: 'One used. The next one is tonight.' },
    rain: {
        label: 'RAIN', day: 10, left: '5d 06h', mult: { icon: 'rainy-outline', text: '×1.56' }, logged: 8, flash: 'Two used, one left.',
        band: { icon: 'rainy-outline', text: 'RAIN CHECK · ×1.25 OUTDOORS', right: 'till 18:00', tone: 'rain' },
    },
    flash: {
        label: 'FLASH', day: 9, left: '6d 04h', mult: { icon: 'flash', text: '×2.0' }, logged: 7, flash: 'One hour of ×2. Live right now.',
        band: { icon: 'flash', text: 'FLASH WINDOW · ×2 ON EVERY SESSION', right: null, tone: 'gold' },
    },
    final48: { label: 'FINAL 48', day: 14, left: '1d 22h', mult: { icon: 'flame', text: '×1.88' }, logged: 10, flash: 'All three used.' },
};

export const fmt = (n: number) => Math.round(n).toLocaleString('en-GB');
export const initialsOf = (name: string) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

const SPARE = ['Ike Nwosu', 'Zara Quinn', 'Ravi Shah', 'Ana Lima', 'Theo Baker', 'Maya Rose', 'Yusuf Khan', 'Chloe Dunn', 'Nat Evans', 'Will Stone', 'Liv Marsh', 'Remy Doyle', 'Tola Fash', 'Cass North', 'Joel Vance'];

function rng(seed: number) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

type PersonInit = Partial<Omit<Person, 'id' | 'name' | 'pts'>>;

export function createModel(scale: Scale): Model {
    const rnd = rng(11);
    const k = scale === 'pitch' ? 1 : 0.25;
    const model: Model = {
        boards: {} as Record<LensKey, Board>,
        k,
        rnd,
        pid: 0,
        bounty: { live: true, pot: 2000, claimedBy: null, from: null },
        hour: scale === 'pitch' ? 212 : 9,
    };
    const acts = Object.keys(ACTS) as ActKey[];
    const P = (name: string, pts: number, o: PersonInit = {}): Person => ({
        id: `p${++model.pid}`,
        name,
        pts: Math.round(pts * k),
        today: o.today ?? Math.round(40 + rnd() * 180),
        mid: o.mid ?? 0,
        title: o.title ?? null,
        mult: o.mult ?? (o.title === 'hot' ? 1.25 : 1),
        act: o.act ?? acts[Math.floor(rnd() * acts.length)],
        city: o.city ?? 'London',
        you: !!o.you,
        event: o.event ?? rnd() < 0.4,
        totalEarned: Math.round(pts * k * 2.6),
    });
    const you = (pts: number, mid: number) => P('you', pts, { you: true, mid, title: 'hot', mult: 1.25, act: 'walk', today: 186, event: true });
    const seg = (base: number, people: Person[]): Seg => {
        people.forEach((p, i) => { if (!p.mid) p.mid = base + i; });
        return { base, people };
    };
    const top12 = () => [
        P('Alex Reid', 24860, { title: 'wanted', mult: 1.25, act: 'run', mid: 1 }), P('Marta Ruiz', 21040, { title: 'hot', act: 'run', city: 'Manchester', mid: 2 }),
        P('James Okafor', 20915, { title: 'mover', mult: 1.1, act: 'gym', mid: 5 }), P('Priya Kaur', 20480, { mult: 1.1, act: 'ride', city: 'Bristol', mid: 4 }),
        P('Sam Lyons', 19730, { title: 'hot', act: 'gym', mid: 3 }), P('Noor Haddad', 19312, { act: 'swim', city: 'Leeds', mid: 7 }),
        P('Kofi Asante', 18904, { mult: 1.1, act: 'run', mid: 6 }), P('Ben Carter', 18650, { act: 'ride', city: 'Brighton', mid: 8 }),
        P('Amara Obi', 18322, { title: 'hot', act: 'walk', mid: 10 }), P('Finn Clarke', 18105, { act: 'gym', city: 'Glasgow', mid: 9 }),
        P('Inès Moreau', 17890, { mult: 1.1, act: 'swim', mid: 12 }), P('George Price', 17644, { act: 'run', city: 'Cardiff', mid: 11 }),
    ];
    const pitch = scale === 'pitch';

    const oBase = pitch ? 307 : 16;
    model.boards.overall = {
        key: 'overall',
        total: pitch ? 5000 : 130,
        prizes: true,
        segs: [seg(1, top12()), seg(oBase, [
            P('Ellie Moss', 9512, { mid: oBase + 2 }), P('Dev Patel', 9488, { mid: oBase - 2, city: 'Leeds' }),
            P('Hannah Brooks', 9455, { mid: oBase + 4 }), P('Oscar Webb', 9431, { mid: oBase + 9 }),
            P('Tom Fitzgerald', 9402, { mid: oBase + 1, act: 'gym' }), you(9388, oBase + (pitch ? 46 : 10)),
            P('Léa Laurent', 9371, { title: 'under', mid: oBase + 33 }), P('Rachel Tan', 9350, { mid: oBase + 3, title: 'rookie' }),
            P('Mo Ali', 9333, { mid: oBase + 6 }), P('Jess Hart', 9310, { mid: oBase + 11, city: 'Bath' }),
            P('Luca Valli', 9296, { mid: oBase + 7 }),
        ])],
        ms: { label: pitch ? 'the top 5%' : 'the top 10%', pts: Math.round(9388 * k) + Math.round(1140 * k) },
    };

    const cBase = pitch ? 114 : 13;
    const cTop = top12().filter((p) => p.city === 'London').concat([
        P('Maya Rose', 17410, { act: 'run' }), P('Theo Baker', 17020, { act: 'gym' }), P('Ana Lima', 16890, { act: 'walk' }), P('Yusuf Khan', 16540, { act: 'ride' }),
    ]);
    cTop.forEach((p, i) => { p.mid = i + 1; });
    model.boards.city = {
        key: 'city',
        total: pitch ? 1912 : 74,
        prizes: false,
        segs: [seg(1, cTop), seg(cBase, [
            P('Ellie Moss', 9512, { mid: cBase + 1 }), P('Hannah Brooks', 9455, { mid: cBase }), P('Ike Nwosu', 9440, { mid: cBase + 6 }),
            P('Tom Fitzgerald', 9402, { mid: cBase + 2, act: 'gym' }), you(9388, cBase + (pitch ? 19 : 6)),
            P('Léa Laurent', 9371, { title: 'under', mid: cBase + 15 }), P('Rachel Tan', 9350, { mid: cBase + 3, title: 'rookie' }),
            P('Mo Ali', 9333, { mid: cBase + 5 }), P('Zara Quinn', 9318, { mid: cBase + 8 }),
        ])],
        ms: { label: pitch ? 'the top 5%' : 'the top 15%', pts: Math.round(9388 * k) + Math.round(380 * k) },
    };

    model.boards.gym = {
        key: 'gym',
        total: pitch ? 64 : 18,
        prizes: false,
        segs: [seg(1, [
            P('James Okafor', 20915, { title: 'mover', mult: 1.1, act: 'gym', mid: 1 }), P('Sam Lyons', 19730, { title: 'hot', act: 'gym', mid: 2 }),
            P('Kemi Adeyemi', 14220, { act: 'gym', mid: 3 }), P('Dan Walsh', 12980, { act: 'gym', mid: 5 }), P('Rosa Flores', 11450, { act: 'gym', mid: 4 }),
            P('Tom Fitzgerald', 9402, { act: 'gym', mid: 6 }), you(9388, 9), P('Will Stone', 8930, { act: 'gym', mid: 7 }),
            P('Nat Evans', 8410, { act: 'gym', mid: 8 }), P('Ade Bello', 7990, { act: 'gym', mid: 10 }), P('Liv Marsh', 7420, { act: 'gym', mid: 11 }), P('Chris Ojo', 6950, { act: 'gym', mid: 12 }),
        ])],
    };

    model.boards.friends = {
        key: 'friends',
        total: 9,
        prizes: false,
        segs: [seg(1, [
            P('Amara Obi', 18322, { title: 'hot', act: 'walk', mid: 1 }), P('Hannah Brooks', 9455, { mid: 3 }), P('Tom Fitzgerald', 9402, { act: 'gym', mid: 2 }),
            you(9388, 5), P('Nat Evans', 8410, { mid: 4 }), P('Jo King', 7210, { mid: 6 }), P('Sami Rahim', 5820, { mid: 7 }), P('Bea Tran', 3940, { mid: 8 }), P('Max Lowe', 1880, { mid: 9 }),
        ])],
    };
    return model;
}

export function known(b: Board): { p: Person; rank: number }[] {
    const out: { p: Person; rank: number }[] = [];
    b.segs.forEach((sg) => sg.people.forEach((p, i) => out.push({ p, rank: sg.base + i })));
    return out;
}

export const youOf = (b: Board) => known(b).find((k) => k.p.you)!;
export const leaderPts = (b: Board) => Math.max(1, b.segs[0].people[0].pts);
export const isDark = (state: SeriesState, rank: number, p: Person) => state === 'final48' && rank <= 10 && !p.you;

export function sortBoard(b: Board) {
    b.segs.forEach((sg) => sg.people.sort((a, c) => c.pts - a.pts));
}

/** Keep the window around you populated as you climb or fall: the real board
 *  has thousands; the sample only ever holds the people near you. */
export function rebalance(model: Model, b: Board) {
    const sg = b.segs.find((x) => x.people.some((p) => p.you));
    if (!sg || sg.base === 1) return;
    let i = sg.people.findIndex((p) => p.you);
    const step = () => Math.round((8 + model.rnd() * 22) * model.k * 4);
    const fresh = (pts: number, mid: number): Person => {
        const taken = new Set(known(b).map((x) => x.p.name));
        const name = SPARE.find((h) => !taken.has(h)) ?? `Member ${model.pid}`;
        return {
            id: `p${++model.pid}`, name, pts, today: 60, mid, title: null, mult: 1,
            act: 'walk', city: 'London', you: false, event: false, totalEarned: Math.round(pts * 2.6),
        };
    };
    while (i < 4) {
        sg.people.unshift(fresh(sg.people[0].pts + step(), sg.base - 1));
        sg.base -= 1;
        i += 1;
    }
    while (i > 6) { sg.people.shift(); sg.base += 1; i -= 1; }
    while (sg.people.length - 1 - i < 4) {
        sg.people.push(fresh(Math.max(0, sg.people[sg.people.length - 1].pts - step()), sg.base + sg.people.length));
    }
    while (sg.people.length - 1 - i > 6) sg.people.pop();
}

export function visibleRows(b: Board, state: SeriesState): Row[] {
    const all = known(b);
    const me = all.find((k) => k.p.you)!;
    const topN = state === 'final48' ? 10 : 3;
    const showAll = b.total <= 10;
    const want = new Set<number>();
    all.forEach((k) => {
        // Around you: the one to pass, you, and the two behind.
        if (showAll || k.rank <= topN || (k.rank >= me.rank - 1 && k.rank <= me.rank + 2)) want.add(k.rank);
    });
    const rows = all
        .filter((k) => want.has(k.rank))
        .sort((a, c) => a.rank - c.rank)
        .map((k): Extract<Row, { type: 'lane' }> => ({ type: 'lane', key: k.p.id, p: k.p, rank: k.rank, dark: isDark(state, k.rank, k.p) }));
    const out: Row[] = [];
    if (state === 'final48') {
        const dark = rows.filter((r) => r.rank <= 10);
        const rest = rows.filter((r) => r.rank > 10);
        dark.sort((a, c) => (a.p.you ? -1 : c.p.you ? 1 : a.p.name.localeCompare(c.p.name)));
        out.push({ type: 'dark', key: 'dark' }, ...dark);
        let prev = 10;
        rest.forEach((r) => {
            if (r.rank - prev > 1) out.push({ type: 'sep', key: 'sep-a', n: r.rank - prev - 1 });
            out.push(r);
            prev = r.rank;
        });
        return out;
    }
    let prev = 0;
    let sepN = 0;
    rows.forEach((r) => {
        if (r.rank - prev > 1) out.push({ type: 'sep', key: `sep-${sepN++}`, n: r.rank - prev - 1 });
        if (b.prizes && prev === 3 && r.rank === 4) out.push({ type: 'prize', key: 'prize' });
        out.push(r);
        prev = r.rank;
    });
    return out;
}

export function multOf(p: Person, rank: number, b: Board, state: SeriesState, bountyLive: boolean, act: ActKey = p.act) {
    let m = p.mult;
    if (state === 'flash') m *= 2;
    if (state === 'eventNight' && p.event) m *= 2;
    if (state === 'rain' && ACTS[act].outdoor) m *= 1.25;
    if (state === 'final48' && rank > 10) m *= 1.5;
    const wanted = b.key === 'overall' && rank === 1 && bountyLive;
    return Math.min(m, wanted ? 1.25 : 2);
}

export const multLabel = (m: number) => (m >= 2 ? '×2' : `×${Math.round(m * 100) / 100}`);

export function titleOf(p: Person, rank: number, b: Board, bountyLive: boolean): TitleKey | null {
    if (b.key === 'overall' && rank === 1) return bountyLive ? 'wanted' : 'leader';
    if (p.title === 'wanted') return bountyLive ? 'wanted' : null;
    if (p.title === 'leader') return null;
    return p.title;
}

export function pickAct(model: Model, p: Person): ActKey {
    const acts = Object.keys(ACTS) as ActKey[];
    return model.rnd() < 0.7 ? p.act : acts[Math.floor(model.rnd() * acts.length)];
}

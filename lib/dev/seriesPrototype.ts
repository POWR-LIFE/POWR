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
import { type Honour, type HonourKind, type HonourTier, TIER_RANK } from '@/constants/honours';
import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import type { PrizeRace, SeriesInviteBoard } from '@/lib/api/series';
import { getFormatLocale } from '@/lib/i18n';

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

export type TitleKey = 'leader' | 'hot' | 'mover' | 'under' | 'rookie' | 'early' | 'giant' | 'crown' | 'pack';
export const TITLES: Record<TitleKey, { label: string; icon: IconName; ember?: boolean }> = {
    leader: { label: 'LEADER', icon: 'ribbon-outline' },
    hot: { label: 'HOT STREAK', icon: 'flame' },
    mover: { label: 'BIGGEST MOVER', icon: 'trending-up-outline' },
    under: { label: 'UNDERDOG', icon: 'arrow-up-circle-outline' },
    rookie: { label: 'ROOKIE', icon: 'leaf-outline' },
    early: { label: 'EARLY BIRD', icon: 'sunny-outline' },
    giant: { label: 'GIANT KILLER', icon: 'flash-outline' },
    crown: { label: 'CROWN HOLDER', icon: 'trophy-outline' },
    pack: { label: 'PACK WINNER', icon: 'people-outline' },
};
/** The titles a round can award you, for the collection in Your File. */
/** Titles that give away places: they sit out Blind Mode. */
export const BLIND_HIDES: TitleKey[] = ['mover', 'giant', 'under'];
export const COLLECTABLE: TitleKey[] = ['mover', 'early', 'giant', 'hot', 'crown', 'pack', 'under', 'rookie', 'leader'];

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
    /** The flag they race under (ISO country code). */
    flag?: string;
    /** Their place in the last round; null = new this round. */
    last?: number | null;
    /** Your heat: where they came from last round (null = new this round). */
    heatFrom?: 'up' | 'down' | 'held' | null;
    /** What they've earned (the icons under the name). */
    honours?: Honour[];
};

/**
 * Sample honours, settled by the name so a person keeps theirs between
 * renders: about half the field has something, a few have a lot.
 */
export function sampleHonours(name: string, you = false): Honour[] {
    if (you) return [{ kind: 'diamond', tier: 'bronze', count: 1 }, { kind: 'power', tier: 'silver', count: 12, detail: { w5: 6, w6: 1 } }, { kind: 'on_fire', tier: 'silver', count: 24 }];
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pick = (kind: HonourKind, chance: number, tiers: HonourTier[]): Honour | null => {
        h = (h * 1103515245 + 12345) >>> 0;
        if ((h >>> 8) / 0xffffff > chance) return null;
        h = (h * 1103515245 + 12345) >>> 0;
        const tier = tiers[(h >>> 8) % tiers.length];
        return { kind, tier, count: TIER_RANK[tier] };
    };
    return [
        pick('king', 0.03, ['gold']),
        pick('diamond', 0.12, ['bronze', 'bronze', 'silver']),
        pick('wings', 0.14, ['bronze', 'silver', 'gold']),
        pick('strength', 0.2, ['bronze', 'silver', 'gold', 'platinum']),
        pick('hive', 0.15, ['bronze', 'bronze', 'silver']),
        pick('power', 0.3, ['bronze', 'silver', 'gold']),
        pick('on_fire', 0.4, ['bronze', 'silver', 'gold', 'platinum']),
    ].filter((x): x is Honour => !!x);
}

export type Seg = { base: number; people: Person[] };
export type LensKey = 'overall' | 'city' | 'gym' | 'friends';
export type Board = {
    key: LensKey | 'heat';
    total: number;
    segs: Seg[];
    prizes: boolean;
    /** The next milestone above you on a big board: "N pts to the top 5%". */
    ms?: { label: string; pts: number };
};
/** Days of the round the prototype can jump between: a quiet day and each calendar moment. */
export type SeriesState = 'day3' | 'doubleDown' | 'eventNight' | 'plague' | 'blind' | 'powerHour' | 'allIn';
export type Scale = 'pitch' | 'today';

export type Row =
    | { type: 'lane'; key: string; p: Person; rank: number; dark: boolean; hideRank?: boolean }
    | { type: 'sep'; key: string; n: number }
    | { type: 'prize'; key: string }
    | { type: 'dark'; key: string }
    /** Your heat's lines: who moves up a division, who drops one. */
    | { type: 'zone'; key: string; kind: 'up' | 'down'; text: string };

export type Model = {
    boards: Record<LensKey, Board>;
    /** Your heat (see createHeat): its own small board, fixed for the round. */
    heat: Board;
    heatMeta: HeatMeta;
    /** Points scale: 1 on the 5,000-entrant board, 0.25 at today's size. */
    k: number;
    rnd: () => number;
    pid: number;
    hour: number;
    /** Your best ever place in a round. */
    pb: number;
};

export const STATE_INFO: Record<SeriesState, {
    label: string;
    day: number;
    left: string;
    /** The calendar moment that's on today, said in the header. */
    moment?: string;
    /** What you hold right now, on the badge by your rank: icon, name, value. */
    mult: { icon: IconName; text: string; name: string };
    band?: { icon: IconName; text: string; right: string | null; tone: 'gold' | 'dark' };
    logged: number;
}> = {
    day3: { label: 'DAY 3', day: 3, left: '12d 04h', mult: { icon: 'flame', text: '×1.25', name: 'HOT STREAK' }, logged: 3 },
    doubleDown: {
        label: 'DOUBLE DOWN', day: 4, left: '11d 06h', moment: 'Double Down', mult: { icon: 'flash-outline', text: '×2.0', name: 'RUNS' }, logged: 4,
        band: { icon: 'flash-outline', text: 'DOUBLE DOWN · RUNS COUNT 2× TODAY', right: 'till 23:59', tone: 'gold' },
    },
    eventNight: {
        label: 'EVENT NIGHT', day: 6, left: '9d 05h', moment: 'Event night', mult: { icon: 'location-outline', text: '×2.0', name: 'EVENT' }, logged: 5,
        band: { icon: 'location-outline', text: 'EVENT NIGHT · ×2 AT ONE LDN', right: 'till 23:59', tone: 'gold' },
    },
    plague: {
        label: 'THE PLAGUE', day: 8, left: '7d 09h', moment: 'The Plague', mult: { icon: 'flame', text: '×1.25', name: 'HOT STREAK' }, logged: 7,
        band: { icon: 'people-outline', text: 'THE PLAGUE · EVERY FRIEND YOU BRING IN COUNTS', right: '2 days', tone: 'gold' },
    },
    blind: {
        label: 'BLIND MODE', day: 10, left: '5d 08h', moment: 'Blind Mode', mult: { icon: 'flame', text: '×1.25', name: 'HOT STREAK' }, logged: 8,
        band: { icon: 'eye-off-outline', text: 'BLIND MODE · EVERY RANK IS HIDDEN', right: 'back Thu', tone: 'dark' },
    },
    powerHour: {
        label: 'POWER HOUR', day: 12, left: '3d 05h', moment: 'Power Hour', mult: { icon: 'timer-outline', text: '×2.0', name: 'POWER HOUR' }, logged: 10,
        band: { icon: 'timer-outline', text: 'POWER HOUR · ×2 ON EVERY SESSION', right: null, tone: 'gold' },
    },
    allIn: {
        label: 'ALL IN', day: 14, left: '1d 22h', moment: 'All In', mult: { icon: 'flame', text: '×1.9', name: 'ALL IN' }, logged: 12,
        band: { icon: 'flame-outline', text: 'ALL IN · ×1.5 OUTSIDE THE TOP 10', right: '1d 22h', tone: 'gold' },
    },
};

/*
 * The round changes while you're in it. Each moment is announced (named,
 * dated) only when it's next; the rest stay sealed. The Golden P is never on
 * the calendar: it just turns up.
 */
export type RoundMoment = { day: number; days?: number; key: SeriesState | 'gun'; name: string; what: string; icon: IconName };
export const ROUND_MOMENTS: RoundMoment[] = [
    { day: 1, key: 'gun', name: 'THE GUN', what: 'The board goes live', icon: 'flag-outline' },
    { day: 4, key: 'doubleDown', name: 'DOUBLE DOWN', what: 'A surprise activity counts 2× for 24 hours', icon: 'flash-outline' },
    { day: 6, key: 'eventNight', name: 'EVENT NIGHT', what: 'ONE LDN · ×2 Series points if you check in', icon: 'location-outline' },
    { day: 8, days: 2, key: 'plague', name: 'THE PLAGUE', what: 'Friends you bring in count for Squad Builder', icon: 'people-outline' },
    { day: 10, days: 2, key: 'blind', name: 'BLIND MODE', what: 'Every rank goes dark for 48 hours, yours too', icon: 'eye-off-outline' },
    { day: 12, key: 'powerHour', name: 'POWER HOUR', what: 'One hour at ×2, with 15 minutes’ notice', icon: 'timer-outline' },
    { day: 14, days: 2, key: 'allIn', name: 'ALL IN', what: 'The last 48 hours · ×1.5 for everyone outside the top 10', icon: 'flame-outline' },
];
/** Round 01 opens Sun 1 Nov: day n is n Nov. */
export function roundDate(day: number): string {
    const W = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${W[(day - 1) % 7]} ${day} Nov`;
}

/** A whole number in the member's locale: "1,234" in English, "1 234" in French (live screens use it too). */
export const fmt = (n: number) => Math.round(n).toLocaleString(getFormatLocale());

/** Sample flags: mostly British, as a London Series would be, with a few from abroad. */
const FLAG_OF: Record<string, string> = {
    'Marta Ruiz': 'ES', 'James Okafor': 'NG', 'Inès Moreau': 'FR', 'Léa Laurent': 'FR', 'Luca Valli': 'IT',
    'Finn Clarke': 'IE', 'Ben Carter': 'AU', 'Rachel Tan': 'SG', 'Kofi Asante': 'GH', 'Ana Lima': 'BR', 'Remy Doyle': 'IE',
    'Hana Sato': 'JP', 'Sofia Rossi': 'IT', 'Pablo Ruiz': 'ES', 'Mia Kowalski': 'PL', 'Freya Lund': 'SE', 'Omar Farouk': 'EG',
};
export const flagOf = (name: string) => FLAG_OF[name] ?? 'GB';
/** An ISO country code as its flag emoji. */
export const flagEmoji = (code: string) => String.fromCodePoint(...Array.from(code.toUpperCase()).map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
export const initialsOf = (name: string) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

/** Last round's places for the sample top of the board: each one different. */
const TOP_LAST = [4, 6, 1, 3, 8, 2, 12, 15, 9, 5, 11, 7, 14, 10, 13, 16];

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
        hour: scale === 'pitch' ? 212 : 9,
        pb: scale === 'pitch' ? 280 : 14,
        heat: { key: 'heat', total: 0, segs: [], prizes: false },
        heatMeta: { div: 1, divs: 1, size: 0, up: 0, down: 0 },
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
        flag: o.you ? 'GB' : flagOf(name),
        last: o.last,
        honours: o.honours ?? sampleHonours(name, !!o.you),
    });
    const you = (pts: number, mid: number) => P('you', pts, { you: true, mid, title: 'hot', mult: 1.25, act: 'walk', today: 186, event: true, last: scale === 'pitch' ? 428 : 31 });
    const seg = (base: number, people: Person[]): Seg => {
        people.forEach((p, i) => {
            if (!p.mid) p.mid = base + i;
            // Where they finished last round; a rookie is new.
            if (p.last === undefined) p.last = p.title === 'rookie' ? null : base === 1 ? TOP_LAST[i % TOP_LAST.length] : Math.max(1, base + i + Math.round((rnd() - 0.45) * 90));
        });
        return { base, people };
    };
    const top12 = () => [
        P('Alex Reid', 24860, { title: 'leader', mult: 1.25, act: 'run', mid: 1 }), P('Marta Ruiz', 21040, { title: 'hot', act: 'run', city: 'Manchester', mid: 2 }),
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

    // Your heat. The people either side of you on the big board are at your
    // pace too, so they're in it as well (same names, same points).
    const H = HEAT_PEOPLE.slice(0, pitch ? 30 : 24);
    model.heat = {
        key: 'heat',
        total: H.length,
        prizes: false,
        segs: [{
            base: 1,
            people: H.map(([name, pts, from], i) => {
                const mid = name === 'you' ? i + 2 : Math.max(1, i + 1 + Math.round((rnd() - 0.5) * 4));
                const p = name === 'you' ? you(pts, mid) : P(name, pts, { mid });
                p.heatFrom = from;
                return p;
            }),
        }],
    };
    // At 5,000 in, six divisions; at today's size two, and you start in the second.
    model.heatMeta = pitch
        ? { div: 3, divs: 6, size: H.length, up: HEAT_UP, down: HEAT_DOWN }
        : { div: 2, divs: 2, size: H.length, up: HEAT_UP, down: 0 };
    return model;
}

/*
 * Your heat: about 30 people at your pace (matched on the last four weeks'
 * points), fixed for the whole round. The top HEAT_UP move up a division next
 * round and the bottom HEAT_DOWN drop one, so every place in it counts. Real
 * members only. The big board stays above it as the prestige layer.
 */
export const HEAT_UP = 5;
export const HEAT_DOWN = 5;
export type HeatMeta = { div: number; divs: number; size: number; up: number; down: number };
const HEAT_PEOPLE: [string, number, Person['heatFrom']][] = [
    ['Grace Lin', 10940, 'held'], ['Omar Farouk', 10610, 'down'], ['Isla Byrne', 10205, 'up'], ['Callum Reece', 9880, 'held'],
    ['Niamh Kelly', 9640, 'up'], ['Ellie Moss', 9512, 'held'], ['Hannah Brooks', 9455, 'up'], ['Tom Fitzgerald', 9402, 'held'],
    ['you', 9388, 'up'], ['Léa Laurent', 9371, 'down'], ['Rachel Tan', 9350, null], ['Arjun Mehta', 9120, 'held'],
    ['Sofia Rossi', 8960, 'held'], ['Ewan Fraser', 8790, 'up'], ['Hana Sato', 8605, 'held'], ['Leon Wright', 8440, 'down'],
    ['Mia Kowalski', 8180, 'held'], ['Ollie Grant', 7960, 'up'], ['Ruth Okoro', 7735, 'held'], ['Dan Pike', 7520, null],
    ['Jade Moreno', 7290, 'held'], ['Kai Turner', 7060, 'down'], ['Freya Lund', 6840, 'held'], ['Seb Clarke', 6600, 'up'],
    ['Anya Petrova', 6370, 'held'], ['Josh Ellery', 6110, 'held'], ['Lola Mensah', 5860, 'down'], ['Ryan Doherty', 5590, 'held'],
    ['Tess Murray', 5300, null], ['Pablo Ruiz', 4980, 'held'],
];

/** Where you stand in your heat, and what the next line is worth. */
export type HeatInfo = {
    meta: HeatMeta;
    rank: number;
    /** Places since midnight (+ = up). */
    move: number;
    /** up = in the move-up places; drop = in the drop zone; mid = neither. */
    status: 'up' | 'mid' | 'drop';
    /** Points to reach the move-up places (mid / drop), or to pass 1st in the top division. */
    toUp: number | null;
    /** In the move-up places: your lead over the first place outside them. */
    clear: number | null;
    /** In the drop zone: points to climb out of it. */
    toSafe: number | null;
    /** toUp (or toSafe) as 30-minute walks. */
    walks: number;
};

export function heatInfo(model: Model): HeatInfo {
    const m = model.heatMeta;
    const all = known(model.heat);
    const me = all.find((k) => k.p.you)!;
    const at = (rank: number) => all.find((k) => k.rank === rank)?.p.pts ?? 0;
    const top = m.div === 1;
    const inUp = !top && me.rank <= m.up;
    const inDrop = m.down > 0 && me.rank > m.size - m.down;
    const toUp = inUp ? null : top ? (me.rank === 1 ? null : at(1) - me.p.pts + 1) : at(m.up) - me.p.pts + 1;
    const toSafe = inDrop ? at(m.size - m.down) - me.p.pts + 1 : null;
    const walk = Math.max(1, Math.round(ACTS.walk.ppm * model.k * 30));
    return {
        meta: m,
        rank: me.rank,
        move: me.p.mid - me.rank,
        status: inUp ? 'up' : inDrop ? 'drop' : 'mid',
        toUp,
        clear: inUp ? me.p.pts - at(m.up + 1) : null,
        toSafe,
        walks: Math.max(1, Math.ceil((toSafe ?? toUp ?? 0) / walk)),
    };
}

/**
 * The heat as rows. Short (the default): the move-up places, the line, the
 * people either side of you, and the drop line; the bottom places show only
 * when you're near them. `full`: all of it.
 */
export function heatRows(model: Model, state: SeriesState, full: boolean): Row[] {
    const m = model.heatMeta;
    const all = known(model.heat);
    const me = all.find((k) => k.p.you)!;
    const lane = (k: { p: Person; rank: number }): Extract<Row, { type: 'lane' }> => ({
        type: 'lane', key: `h-${k.p.id}`, p: k.p, rank: k.rank, dark: isDark(state, k.rank, k.p), hideRank: state === 'blind',
    });
    if (state === 'blind') {
        // A–Z, so the order gives nothing away; no lines either.
        const rows = all.map(lane).sort((a, c) => (a.p.you ? -1 : c.p.you ? 1 : a.p.name.localeCompare(c.p.name)));
        return [{ type: 'dark', key: 'dark' }, ...rows];
    }
    const upAt = m.div > 1 ? m.up : 0;
    const downAt = m.down > 0 ? m.size - m.down + 1 : 0;
    const want = (rank: number) => full
        || rank <= Math.max(upAt, 3)
        || Math.abs(rank - me.rank) <= 2
        || (downAt > 0 && me.rank + 2 >= downAt && rank >= downAt);
    const out: Row[] = [];
    const upLine = (): Row => ({ type: 'zone', key: 'zone-up', kind: 'up', text: `TOP ${m.up} MOVE UP TO DIVISION ${m.div - 1}` });
    const downLine = (): Row => ({ type: 'zone', key: 'zone-down', kind: 'down', text: `BOTTOM ${m.down} DROP TO DIVISION ${m.div + 1}` });
    let prev = 0;
    let sepN = 0;
    all.filter((k) => want(k.rank)).forEach((k) => {
        if (prev > 0 && k.rank - prev > 1) out.push({ type: 'sep', key: `hsep-${sepN++}`, n: k.rank - prev - 1 });
        if (k.rank === downAt) out.push(downLine());
        out.push(lane(k));
        if (k.rank === upAt) out.push(upLine());
        prev = k.rank;
    });
    // Short view, nowhere near the bottom: the people left, then where the drop starts.
    if (prev < m.size) {
        out.push({ type: 'sep', key: `hsep-${sepN++}`, n: m.size - prev });
        if (downAt > 0) out.push(downLine());
    }
    return out;
}

/** Under a heat row's name: where they came from last round. */
export function heatFromLine(p: Person, div: number): string {
    if (p.heatFrom === 'up') return `Up from Division ${div + 1}`;
    if (p.heatFrom === 'down') return `Down from Division ${div - 1}`;
    if (p.heatFrom === 'held') return `Stayed in Division ${div}`;
    return 'New this round';
}

export function known(b: Board): { p: Person; rank: number }[] {
    const out: { p: Person; rank: number }[] = [];
    b.segs.forEach((sg) => sg.people.forEach((p, i) => out.push({ p, rank: sg.base + i })));
    return out;
}

export const youOf = (b: Board) => known(b).find((k) => k.p.you)!;
export const leaderPts = (b: Board) => Math.max(1, b.segs[0].people[0].pts);
/** Blind Mode: every rank is hidden. Others' points too; your own points you can still see. */
export const isDark = (state: SeriesState, rank: number, p: Person) => state === 'blind' && !p.you;

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
            act: 'walk', city: 'London', you: false, event: false, totalEarned: Math.round(pts * 2.6), flag: flagOf(name),
            last: Math.max(1, mid + Math.round((model.rnd() - 0.45) * 90)),
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

/** The race's views: your heat, the five around you on the big board, or its top (and you). */
export type RaceView = 'heat' | 'around' | 'top';
export function visibleRows(b: Board, state: SeriesState, view: RaceView = 'around'): Row[] {
    const all = known(b);
    const me = all.find((k) => k.p.you)!;
    const showAll = b.total <= 10;
    const want = new Set<number>();
    all.forEach((k) => {
        const around = k.rank >= me.rank - 2 && k.rank <= me.rank + 2;
        // Top: everyone the sample holds at the top (the real board pages to 100), then you.
        const top = k.rank <= 100 || k.p.you;
        if (showAll || (view === 'around' ? around : top)) want.add(k.rank);
    });
    const rows = all
        .filter((k) => want.has(k.rank))
        .sort((a, c) => a.rank - c.rank)
        .map((k): Extract<Row, { type: 'lane' }> => ({
            type: 'lane', key: k.p.id, p: k.p, rank: k.rank, dark: isDark(state, k.rank, k.p), hideRank: state === 'blind',
        }));
    const out: Row[] = [];
    if (state === 'blind') {
        // A–Z, so the order gives nothing away; no gaps, no prize line.
        rows.sort((a, c) => (a.p.you ? -1 : c.p.you ? 1 : a.p.name.localeCompare(c.p.name)));
        out.push({ type: 'dark', key: 'dark' }, ...rows);
        return out;
    }
    let prev = 0;
    let sepN = 0;
    rows.forEach((r) => {
        // A gap line between runs of rows, never above the first row.
        if (prev > 0 && r.rank - prev > 1) out.push({ type: 'sep', key: `sep-${sepN++}`, n: r.rank - prev - 1 });
        if (b.prizes && prev === 3 && r.rank === 4) out.push({ type: 'prize', key: 'prize' });
        out.push(r);
        prev = r.rank;
    });
    return out;
}

export function multOf(p: Person, rank: number, state: SeriesState, act: ActKey = p.act) {
    let m = p.mult;
    if (state === 'powerHour') m *= 2;
    if (state === 'doubleDown' && act === 'run') m *= 2;
    if (state === 'eventNight' && p.event) m *= 2;
    if (state === 'allIn' && rank > 10) m *= 1.5;
    return Math.min(m, 2);
}

// Quarter steps (×1.25, ×1.5) read as they are; a stacked ×1.875 reads ×1.9.
export const multLabel = (m: number) => (m >= 2 ? '×2' : `×${Number.isInteger(m * 4) ? m : Math.round(m * 10) / 10}`);

export function titleOf(p: Person, rank: number, b: Board): TitleKey | null {
    if (b.key === 'overall' && rank === 1) return 'leader';
    if (p.title === 'leader') return null;
    return p.title;
}

export function pickAct(model: Model, p: Person): ActKey {
    const acts = Object.keys(ACTS) as ActKey[];
    return model.rnd() < 0.7 ? p.act : acts[Math.floor(model.rnd() * acts.length)];
}

/** The one rival Home and League both show. */
export type Rival = {
    p: Person;
    /** Their place on the Overall board, when the window around you holds them. */
    rank: number | null;
    gap: number;
    /** You're #1 overall: the rival is the one chasing you. */
    ahead: boolean;
    friend: boolean;
    sealed: boolean;
    /** The gap as something to do: "One 30-min walk does it". */
    how: string;
    /** Your share of today's points between the two of you. */
    share: number;
    meRank: number;
    mePts: number;
    meToday: number;
};

/**
 * Who you're racing, chosen the same way everywhere: a friend just above you
 * on the Series if they're within reach today (about three walks), otherwise
 * the person directly above you on the Overall board (or chasing you, at #1).
 */
export function rivalOf(model: Model, state: SeriesState): Rival {
    const ov = model.boards.overall;
    const all = known(ov);
    const me = all.find((k) => k.p.you)!;
    const walk = Math.max(1, Math.round(ACTS.walk.ppm * model.k * multOf(me.p, me.rank, state, 'walk') * 30));
    const fr = known(model.boards.friends);
    const meF = fr.find((k) => k.p.you)!;
    const fAbove = fr.find((k) => k.rank === meF.rank - 1);
    let pick: { p: Person; ahead: boolean; friend: boolean };
    if (fAbove && fAbove.p.pts - meF.p.pts <= walk * 3) {
        pick = { p: fAbove.p, ahead: false, friend: true };
    } else {
        const ahead = me.rank === 1;
        pick = { p: all.find((k) => k.rank === (ahead ? 2 : me.rank - 1))!.p, ahead, friend: false };
    }
    const onOverall = all.find((k) => !k.p.you && k.p.name === pick.p.name);
    const rank = onOverall?.rank ?? null;
    const sealed = rank != null && isDark(state, rank, pick.p);
    const gap = Math.abs(pick.p.pts - me.p.pts);
    const n = Math.max(1, Math.ceil(gap / walk));
    const how = sealed
        ? 'Sealed until the reveal'
        : pick.ahead
            ? `${n} walk${n > 1 ? 's' : ''} in hand`
            : gap <= walk ? 'One 30-min walk does it' : `About ${n} walks to pass`;
    return {
        p: pick.p, rank, gap, ahead: pick.ahead, friend: pick.friend, sealed, how,
        share: me.p.today / Math.max(1, me.p.today + pick.p.today),
        meRank: me.rank, mePts: me.p.pts, meToday: me.p.today,
    };
}

/*
 * The other three tabs are their own games, not filters of the race:
 *   My city  = City clash: cities ranked on average Series points per member.
 *   My gym   = The crown: king of the hill on sessions verified at your gym, rolling 7 days.
 *   Friends  = Duels: 1v1 on this week's points, so everyone starts level each Monday.
 */
export type CityRow = { name: string; members: number; avg: number; you: boolean };
export type CourtRow = { name: string; pts: number; you: boolean };
export type Duel = { id: string; name: string; them: number; w: number; l: number };
export type TabGames = {
    city: CityRow[];
    gym: {
        name: string;
        area: string;
        /** Days the current holder has held the crown; null = not tracked (live). */
        held: number | null;
        /** People checked in right now; null = not tracked (live). */
        inNow: number | null;
        friendIn: string | null;
        /** Everyone on the court this week (court may hold only the top 5 and you). */
        people: number;
        court: CourtRow[];
    };
    duel: {
        you: number;
        ends: string;
        /** Ids of friends you've challenged this week. */
        sent: string[];
        invite: { id: string; name: string; them: number } | null;
        open: { id: string; name: string }[];
        active: Duel[];
    };
};

export function createTabs(model: Model, scale: Scale): TabGames {
    const { k } = model;
    const s = (n: number) => Math.round(n * k);
    const members = (n: number) => (scale === 'pitch' ? n : Math.max(2, Math.round(n * 0.026)));
    const cities: [string, number, number][] = [
        ['Manchester', 846, 3530], ['London', 0, 3489], ['Bristol', 412, 3180], ['Leeds', 388, 2940], ['Glasgow', 350, 2815], ['Brighton', 240, 2770],
        ['Edinburgh', 210, 2610], ['Cardiff', 205, 2580], ['Liverpool', 180, 2490], ['Newcastle', 101, 2410], ['Bath', 96, 2350], ['Nottingham', 60, 2200],
    ];
    const fullCourt: [string, number][] = [['Dan Walsh', 2140], ['Kemi Adeyemi', 1880], ['you', 1530], ['Rosa Flores', 1405], ['Will Stone', 1210], ['Tom Fitzgerald', 1130]];
    // At today's size only three people train at Kiln, so the crown is still shut.
    const court = scale === 'pitch' ? fullCourt : fullCourt.slice(1, 4);
    const duels: [string, number, number, number][] = [['Tom Fitzgerald', 1198, 2, 1], ['Nat Evans', 830, 1, 0], ['Amara Obi', 1870, 0, 2]];
    return {
        city: cities.map(([name, n, avg]) => ({
            name, members: name === 'London' ? model.boards.city.total : members(n), avg: avg * k, you: name === 'London',
        })),
        gym: {
            name: 'Kiln Gym', area: 'Hackney', held: 4, inNow: 5, friendIn: 'Tom Fitzgerald', people: court.length,
            court: court.map(([name, pts]) => ({ name, pts: s(pts), you: name === 'you' })),
        },
        duel: {
            you: s(1240), ends: 'Sun 23:59', sent: [], invite: { id: 'Jo King', name: 'Jo King', them: s(640) },
            open: ['Hannah Brooks', 'Sami Rahim', 'Bea Tran', 'Max Lowe'].map((name) => ({ id: name, name })),
            active: duels.map(([name, them, w, l]) => ({ id: name, name, them: s(them), w, l })),
        },
    };
}

/**
 * A game only opens where there are enough people to make it a race:
 * My gym needs GYM_MIN people in the round at your gym; My city needs at least
 * CITY_MIN_CITIES cities with CITY_MIN_MEMBERS entrants each. At today's size
 * (~130 members, mostly London) City stays shut.
 */
export const GYM_MIN = 5;
export const CITY_MIN_MEMBERS = 20;
export const CITY_MIN_CITIES = 3;
export function gamesOpen(t: TabGames): Record<LensKey, boolean> {
    return {
        overall: true,
        city: t.city.filter((c) => c.members >= CITY_MIN_MEMBERS).length >= CITY_MIN_CITIES,
        gym: t.gym.people >= GYM_MIN,
        friends: true,
    };
}

/** The Draw: log on DRAW_NEEDED of the round's ROUND_DAYS days to be in it. */
export const ROUND_DAYS = 15;
export const DRAW_NEEDED = 10;
/** Which days of the round you logged, up to today (counted as logged: you've moved today). */
export function drawDays(day: number, logged: number): boolean[] {
    const out = Array.from({ length: ROUND_DAYS }, (_, i) => i < day);
    const misses = Math.max(0, day - Math.min(logged, day));
    for (let k = 0; k < misses; k += 1) {
        const d = Math.round(((k + 1) * (day - 1)) / (misses + 1)) - 1;
        out[Math.max(0, Math.min(day - 2, d))] = false;
    }
    return out;
}

/** Between rounds: Round 01 ran 1–15 Nov, Round 02 opens Tue 1 Dec. */
export const NEXT_ROUND = { label: 'Round 02', starts: 'Tue 1 Dec', inDays: 12 };

/*
 * The daily loop (sample). Opening the app reveals things; it never pays.
 *   Drop       Home's daily Drop is the one reveal; during a round it can hold
 *              Series prizes (2× for an hour, a Draw ticket). See lib/drop.
 *   Recap      "while you were away": what changed since you last looked
 *   Titles     awarded at 07:00 for yesterday; each one you win is a Draw ticket
 *   Results    Monday: last week's duels, with a one-tap rematch
 *   Golden P   turns up somewhere in the app, unannounced; the first 10 to find
 *              it get that night's challenge
 * Prizes are extra Draw tickets, never points: nothing inflates and nothing is staked.
 * Comeback (after a lapse) lives with the Drop on Home: there's one.
 */
/** The Golden P's challenge: active minutes before midnight. */
export const GOLDEN_MINUTES = 45;
/** How many people can find it. */
export const GOLDEN_FINDERS = 10;

export type DailyTitle = { key: TitleKey; who: string; why: string; you: boolean };
/**
 * Daily titles are gone (2026-10-25): who's on course for each of the round's
 * prizes is the daily thing to check now (sampleRace). Kept so the loop's
 * plumbing still runs.
 */
export function titlesFor(_morning: number): DailyTitle[] {
    return [];
}

/**
 * Who's on course for each named prize in the sample, by the round's day. The
 * same shape the live get_series_prize_race returns. Level Up counts from the
 * end of day 3, so before that it has nobody in line. You're not a Rookie: the
 * sample has you in an earlier round.
 */
export function sampleRace(model: Model, day: number, days: boolean[]): PrizeRace {
    // Your longest run of days so far.
    let run = 0;
    let best = 0;
    days.slice(0, day).forEach((on) => { run = on ? run + 1 : 0; best = Math.max(best, run); });
    const lead = (name: string, score: number, detail: number | null = null) => ({ name, score, detail, you: false });
    return {
        patient_zero: {
            kind: 'patient_zero',
            leader: lead('Jo King', day >= 8 ? 3 : 2),
            you: day >= 8 ? { score: 1, detail: null, ord: 2 } : null,
        },
        hot_streak: { kind: 'hot_streak', leader: lead('Alex Reid', day), you: best ? { score: best, detail: null, ord: best === day ? 2 : 14 } : null },
        biggest_mover: day <= 3
            ? { kind: 'biggest_mover', leader: null, you: null }
            : { kind: 'biggest_mover', leader: lead('Léa Laurent', 38 + (day - 4) * 3, 452), you: { score: 12, detail: 310, ord: 9 } },
        // Rachel Tan, the sample's rookie, on her board pace (about 3,100 a day at full size).
        rookie: { kind: 'rookie', leader: lead('Rachel Tan', Math.round(3120 * day * model.k)), you: null },
    };
}

export type DuelResult = { id: string; name: string; you: number; them: number };
/** Last week's duels, as the Monday card shows them. */
export function lastWeekDuels(k: number): DuelResult[] {
    const s = (n: number) => Math.round(n * k);
    return [
        { id: 'Tom Fitzgerald', name: 'Tom Fitzgerald', you: s(1240), them: s(1198) },
        { id: 'Nat Evans', name: 'Nat Evans', you: s(1240), them: s(830) },
        { id: 'Amara Obi', name: 'Amara Obi', you: s(1240), them: s(1870) },
    ];
}

export const cityRanked = (t: TabGames) => [...t.city].sort((a, c) => c.avg - a.avg);
export const courtRanked = (t: TabGames) => [...t.gym.court].sort((a, c) => c.pts - a.pts);
/** One 50-minute gym session's worth of points, for "about N sessions takes it". */
export const gymSessionPts = (k: number) => Math.max(1, Math.round(ACTS.gym.ppm * 50 * k * 1.25));
export const firstName = (name: string) => name.split(' ')[0];
export const ordinal = (n: number) => {
    const teen = n % 100 > 10 && n % 100 < 14;
    return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/*
 * The invite board in the sample (the live app reads get_series_invite_board):
 * a race on friends brought in before Round 01, for Squad Builder. Ties go to
 * whoever got there first, so you sit below anyone level with you.
 */
/** The sample round's gun: 6 days 14 hours from when the app opened. */
const SAMPLE_START = new Date(Date.now() + (6 * 24 + 14) * 3_600_000).toISOString();
const SAMPLE_OPENED = new Date(Date.now() - 6 * 24 * 3_600_000).toISOString();
const INVITE_OTHERS: [string, number][] = [['Jo King', 3], ['Amara Obi', 2], ['Tom Fitzgerald', 2], ['Hannah Brooks', 1], ['Nat Evans', 1], ['Rachel Tan', 1]];
export function sampleInviteBoard(friends: number, joining: number): SeriesInviteBoard {
    const people = INVITE_OTHERS.map(([name, f], i) => ({ name, friends: f, at: i, you: false }));
    people.push({ name: 'you', friends, at: 99, you: true });
    const ranked = people.filter((x) => x.friends > 0).sort((a, b) => b.friends - a.friends || a.at - b.at);
    const rows = ranked.map((x, i) => ({ rank: i + 1, name: x.name, friends: x.friends, joining: x.you ? joining : 0, you: x.you }));
    const me = rows.find((r) => r.you);
    return {
        round: { slug: 'sample', name: 'Round 01', starts_at: SAMPLE_START },
        open: true,
        opens_at: '2026-10-20T09:00:00Z',
        rows: rows.filter((r) => r.rank <= 10 || r.you),
        ranked: rows.length,
        start_line: 124,
        me: { rank: me?.rank ?? null, friends, joining, code: 'POWR-SAMPLE' },
        // 131 real waiting; the pacers fill to a 1,500 board by the gun (the invite period opened 6 days ago).
        crowd: { real: 131, pacers_at_gun: 1369, ramp_from: SAMPLE_OPENED, ramp_to: SAMPLE_START, base: 0.4 },
    };
}

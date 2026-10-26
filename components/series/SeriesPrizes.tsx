import { Ionicons } from '@expo/vector-icons';
import { Image, type ImageSource } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { trackTap } from '@/lib/analytics';
import { NAMED_PRIZES, type NamedPrize, type PrizeRace, type PrizeRaceEntry, type SeriesPrize, type SeriesResults } from '@/lib/api/series';
import { fmt, ordinal } from '@/lib/dev/seriesPrototype';
import { storageImage } from '@/lib/storageImage';
import { BRONZE, CARD_BG, CARD_BORDER, GOLD, GREEN, HAIR, SectionLabel, SILVER, TEXT, TEXT_2, TEXT_3 } from './SeriesLane';
import { InfoList, type InfoRow, Sheet, SheetHead } from './SeriesSheets';
import { useSeasonCard } from './season';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/*
 * Sample prizes, taken from past live events (FNL x POWR, Stars Gym x POWR) to
 * show the look. Nothing here is agreed with a partner.
 */
const IMG: Record<'mandarin' | 'unbound' | 'form' | 'healthspan' | 'huel', ImageSource> = {
    mandarin: require('@/assets/images/series-prizes/mandarin.jpg'),
    unbound: require('@/assets/images/series-prizes/unbound.jpg'),
    form: require('@/assets/images/series-prizes/form.jpg'),
    healthspan: require('@/assets/images/series-prizes/healthspan.jpg'),
    huel: require('@/assets/images/series-prizes/huel.jpg'),
};
/** One prize as the screen shows it. */
export type PrizeItem = { name: string; by: string | null; line?: string | null; winners: number; img?: ImageSource };
/**
 * A round's prizes: the sample set while designing, the ones set in
 * /admin/series when live. Anything missing hasn't been announced yet.
 */
export type PrizeSet = {
    sample: boolean;
    /** 1st, 2nd, 3rd … (Champion, Runner-up, Podium) */
    places: PrizeItem[];
    /** Every Move Counts: the draw. */
    draw?: PrizeItem;
    /** The six named prizes; a missing one isn't on offer this round (sample: not announced yet). */
    named: Partial<Record<NamedPrize, PrizeItem>>;
    /** Set in /admin/series only: not part of the round's standard ten. */
    golden?: PrizeItem;
    city?: PrizeItem;
};
/*
 * The ten ways to win, one prize each: whoever already holds a prize is passed
 * over for the next one. Names here are the prizes' own; nothing else in the
 * app uses them (the daily titles that did are gone).
 */
export const NAMED: Record<NamedPrize, {
    title: string;
    icon: IconName;
    /** How to win it, in one sentence (the prize's own drawer). */
    how: string;
    /** The same, short (list rows). */
    short: string;
    /** What the prize counts, read out: score (and detail, where it has one). */
    unit: (n: number, detail: number | null) => string;
}> = {
    most_wanted: {
        title: 'Most Wanted', icon: 'locate-outline', short: 'Most bounties claimed',
        how: 'Whoever leads carries a bounty. Take the lead and you’ve claimed it. Most claims wins.',
        unit: (n) => `${n} bount${n === 1 ? 'y' : 'ies'}`,
    },
    hot_streak: {
        title: 'Hot Streak', icon: 'flame-outline', short: 'Most days in a row',
        how: 'The longest run of days in a row with a session that counts.',
        unit: (n) => `${n} day${n === 1 ? '' : 's'} in a row`,
    },
    biggest_mover: {
        title: 'Biggest Mover', icon: 'trending-up-outline', short: 'Most places climbed from day 3',
        how: 'The most places climbed between the end of day 3 and the finish.',
        unit: (n) => `▲${fmt(n)} place${n === 1 ? '' : 's'}`,
    },
    underdog: {
        title: 'Underdog', icon: 'arrow-up-circle-outline', short: 'Best finish from the bottom half',
        how: 'In the bottom half at halfway? Whoever finishes highest from there wins it.',
        unit: (n, d) => (d != null ? `#${fmt(d)} → #${fmt(n)}` : `#${fmt(n)}`),
    },
    patient_zero: {
        title: 'Patient Zero', icon: 'people-outline', short: 'Most friends brought in during The Plague',
        how: 'The most friends who join with your code during The Plague. Each counts once they log a workout.',
        unit: (n) => `${n} friend${n === 1 ? '' : 's'}`,
    },
    photo_finish: {
        title: 'Photo Finish', icon: 'stopwatch-outline', short: 'Most points on the last day',
        how: 'The most Series points on the round’s last day.',
        unit: (n) => `${fmt(n)} pts`,
    },
};

export const SAMPLE_PRIZES: PrizeSet = {
    sample: true,
    places: [
        { name: 'Wellness day for two', by: 'Mandarin Oriental Hyde Park', line: 'A 2-hour bespoke ritual with spa and thermal access', winners: 1, img: IMG.mandarin },
        { name: 'Health testing package', by: 'Unbound', line: 'Full blood biomarkers, strength and mobility, expert review', winners: 1, img: IMG.unbound },
        { name: 'FORM Smart Swim 2', by: 'FORM', line: 'Smart goggles that track every length', winners: 1, img: IMG.form },
    ],
    draw: { name: 'Healthspan Elite hamper', by: 'Healthspan', winners: 3, img: IMG.healthspan },
    named: {
        hot_streak: { name: 'Huel hamper', by: 'Huel', winners: 1, img: IMG.huel },
        patient_zero: { name: 'Nutrition Reset', by: 'Nourished by Fiona', line: 'a 4-week programme built around you', winners: 1 },
    },
};

/** The admin's prizes for a round, in the screen's shape. */
export function prizeSetFrom(rows: SeriesPrize[]): PrizeSet {
    const item = (r: SeriesPrize): PrizeItem => ({
        name: r.name, by: r.sponsor, line: r.detail, winners: r.winners,
        img: r.image_url ? { uri: storageImage(r.image_url, 720, 720) ?? r.image_url } : undefined,
    });
    const one = (k: SeriesPrize['kind']) => { const r = rows.find((x) => x.kind === k); return r ? item(r) : undefined; };
    const named: PrizeSet['named'] = {};
    NAMED_PRIZES.forEach((k) => { const x = one(k); if (x) named[k] = x; });
    return {
        sample: false,
        places: rows.filter((r) => r.kind === 'place').sort((a, b) => (a.place ?? 0) - (b.place ?? 0)).map(item),
        draw: one('draw'),
        named,
        golden: one('golden'),
        city: one('city'),
    };
}

const TBA = 'To be announced';
const MEDALS = [GOLD, SILVER, BRONZE];
/** 1st, 2nd and 3rd as list rows, with their medal colours. */
const placeRows = (P: PrizeSet): InfoRow[] => (P.places.length
    ? P.places.map((x, i) => ({
        key: `place-${i + 1}`, img: x.img, icon: x.img ? undefined : 'trophy-outline' as const,
        eyebrow: { text: ordinal(i + 1).toUpperCase(), color: MEDALS[i] ?? TEXT_3 }, title: x.name, line: x.by ?? x.line ?? '',
    }))
    : [{ key: 'place-1', icon: 'trophy-outline' as const, title: TBA, line: 'The top places win prizes' }]);

export type PrizeKey = 'draw' | 'top3' | 'golden' | 'city' | 'event' | 'tickets' | NamedPrize;
const isNamed = (k: PrizeKey): k is NamedPrize => (NAMED_PRIZES as readonly string[]).includes(k);
/** The named prizes the round has: the admin's, or all six in the sample. */
const namedOn = (P: PrizeSet): NamedPrize[] => NAMED_PRIZES.filter((k) => P.sample || P.named[k]);
/** Where you stand on each prize, from whatever's on screen (sample or live). */
export type PrizeState = {
    day: number;
    logged: number;
    tickets: number;
    ticketLog: string[];
    rank: number;
    total: number;
    blind: boolean;
    golden: { state: 'hidden' | 'showing' | 'found' | 'accepted'; minutes: number; need: number; done: boolean } | null;
    /** Who's on course for each named prize (get_series_prize_race, or the sample's). */
    race: PrizeRace;
    /** Your city's place in the city clash (0 = top); null when the clash isn't open. */
    cityPos: number | null;
    cityName: string | null;
    event: { name: string; rank: number | null; over: boolean } | null;
    /** The round's prizes (sample or the admin's). */
    prizes: PrizeSet;
    /** Live data: the sample-only games (titles, tickets) aren't on. */
    live: boolean;
    /** The round hasn't started: nobody has a place yet. */
    notYet?: boolean;
    /** The Draw: days needed, and which of the round's days you've logged. */
    need: number;
    drawDots: boolean[];
    roundName: string;
    /** "on the 16th" / "on Mon 16 Nov". */
    prizesOn: string;
};

type Tone = 'gold' | 'ok' | 'muted';
type Tile = { key: PrizeKey; img?: ImageSource; icon?: IconName; title: string; prize: string; how: string; status: string; tone: Tone; lead?: boolean };

/** Where a named prize stands: who's on course, and you. */
function raceStatus(k: NamedPrize, e: PrizeRaceEntry | undefined, p: PrizeState): { status: string; tone: Tone } {
    const days = p.drawDots.length;
    const half = Math.floor(days / 2);
    if (p.notYet) return { status: 'NOT STARTED', tone: 'muted' };
    if (e?.sealed || (p.blind && (k === 'biggest_mover' || k === 'underdog'))) return { status: 'HIDDEN IN BLIND MODE', tone: 'muted' };
    if (!e?.leader) {
        const wait = k === 'biggest_mover' && p.day <= 3 ? 'COUNTS FROM DAY 4'
            : k === 'underdog' && p.day <= half ? `COUNTS FROM DAY ${half + 1}`
                : k === 'photo_finish' && p.day < days ? 'ON THE LAST DAY'
                    : k === 'most_wanted' ? 'NO BOUNTIES YET' : 'NOBODY YET';
        return { status: wait, tone: 'muted' };
    }
    const unit = NAMED[k].unit(e.leader.score, e.leader.detail).toUpperCase();
    if (e.leader.you) return { status: `YOU LEAD · ${unit}`, tone: 'gold' };
    const first = e.leader.name.split(' ')[0].toUpperCase();
    if (e.you) return { status: `YOU’RE ${ordinal(e.you.ord).toUpperCase()} · ${first} LEADS`, tone: 'muted' };
    return { status: `${first} LEADS · ${unit}`, tone: 'muted' };
}

function tilesFor(p: PrizeState): Tile[] {
    const P = p.prizes;
    const inDraw = p.logged >= p.need;
    const g = p.golden;
    const first = P.places[0];
    const named: Tile[] = namedOn(P).map((k) => {
        const x = P.named[k];
        const st = raceStatus(k, p.race[k], p);
        return { key: k, img: x?.img, icon: NAMED[k].icon, title: NAMED[k].title, prize: x?.name ?? TBA, how: NAMED[k].short, ...st };
    });
    const tiles: Tile[] = [
        {
            key: 'draw', img: P.draw?.img, icon: 'ticket-outline', title: 'Every Move Counts', prize: P.draw?.name ?? TBA, lead: true,
            status: inDraw ? 'YOU’RE IN' : `${p.logged}/${p.need} DAYS`, tone: inDraw ? 'ok' : 'gold',
            how: `${P.draw ? `${P.draw.winners} winner${P.draw.winners === 1 ? '' : 's'} · ` : ''}${inDraw
                ? (p.live ? 'you’re in' : `you’re in with ${p.tickets + 1} entries`)
                : `${p.need - p.logged} more active days gets you in`}`,
        },
        {
            key: 'top3', img: first?.img, icon: 'trophy-outline', title: 'Champion', prize: first?.name ?? TBA,
            how: first ? `${first.by ?? first.line ?? ''}${P.places.length > 1 ? ` · Runner-up${P.places.length > 2 ? ' and Podium' : ''} win too` : ''}` : 'The top places win prizes',
            status: p.notYet ? 'NOT STARTED' : p.blind ? 'RANK HIDDEN' : `YOU’RE #${fmt(p.rank)}`, tone: 'muted',
        },
        ...named,
    ];
    if (g && P.golden) {
        tiles.push({
            key: 'golden', img: P.golden.img, title: 'The Golden P', prize: `${P.golden.name} + a ticket`, how: 'For the first 10 to find it',
            status: g.done ? 'WON' : g.state === 'accepted' ? `${g.minutes}/${g.need} MIN` : g.state === 'found' ? 'FOUND' : g.state === 'showing' ? 'IT’S OUT' : 'NOT OUT YET',
            tone: g.done ? 'ok' : g.state === 'hidden' ? 'muted' : 'gold',
        });
    }
    // Top city only when the round has a city prize (parked until cities open).
    if (p.cityPos != null && P.city) {
        tiles.push({
            key: 'city', icon: 'location-outline', title: 'Top city', prize: `${P.city.name} for ${P.city.winners}`, how: 'Drawn from the winning city',
            status: `${(p.cityName ?? 'YOUR CITY').toUpperCase()} ${ordinal(p.cityPos + 1).toUpperCase()}`, tone: p.cityPos === 0 ? 'gold' : 'muted',
        });
    }
    if (p.event) {
        tiles.push({
            key: 'event', icon: 'trophy-outline', title: p.event.name, prize: 'Its own prizes', how: 'A separate board, on the event’s page',
            status: p.event.rank ? (p.event.over ? `FINISHED #${p.event.rank}` : `#${p.event.rank} THERE`) : 'OPEN TO JOIN', tone: 'muted',
        });
    }
    return tiles;
}
const toneColor = (t: Tone) => (t === 'ok' ? GREEN : t === 'gold' ? GOLD : TEXT_2);

/** What you can win, under the race: one tile per prize, with where you stand on it. */
export function PrizeRow({ state, onOpen }: { state: PrizeState; onOpen: (k: PrizeKey) => void }) {
    const sc = useSeasonCard();
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.row}
            snapToInterval={184}
            decelerationRate="fast"
        >
            {tilesFor(state).map((t) => (
                <Pressable
                    key={t.key}
                    onPress={() => { trackTap('series_prize_open', { prize: t.key }); onOpen(t.key); }}
                    style={({ pressed }) => [s.tile, sc, t.lead && s.tileLead, pressed && { opacity: 0.8 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.title}: ${t.prize}. ${t.status.toLowerCase()}. Opens the prizes.`}
                >
                    <View style={s.pic}>
                        {t.img
                            ? <Image source={t.img} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                            : (
                                <View style={[StyleSheet.absoluteFill, s.icoBox]}>
                                    <LinearGradient colors={['rgba(232,210,0,0.14)', 'rgba(232,210,0,0)']} style={StyleSheet.absoluteFill} start={{ x: 0.5, y: 0.2 }} end={{ x: 0.5, y: 1 }} />
                                    <Ionicons name={t.icon} size={30} color={GOLD} />
                                </View>
                            )}
                        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={s.picFade} />
                        <View style={s.status}><Text style={[s.statusText, { color: toneColor(t.tone) }]}>{t.status}</Text></View>
                    </View>
                    <View style={s.body}>
                        <Text style={s.tTitle} numberOfLines={1}>{t.title.toUpperCase()}</Text>
                        <Text style={s.tPrize} numberOfLines={2}>{t.prize}</Text>
                        <Text style={s.tHow} numberOfLines={2}>{t.how}</Text>
                    </View>
                </Pressable>
            ))}
        </ScrollView>
    );
}

/** Ways to win, as one list: each prize, what's on offer and where you stand. Tap for the full sheet. */
export function WaysToWin({ state, onOpen }: { state: PrizeState; onOpen: (k: PrizeKey) => void }) {
    const sc = useSeasonCard();
    const P = state.prizes;
    const NAME: Partial<Record<PrizeKey, string>> = { top3: 'Champion · Runner-up · Podium', draw: 'Every Move Counts', city: 'Top city' };
    const SUB: Partial<Record<PrizeKey, string>> = {
        top3: P.places.length ? `${P.places[0].name}${P.places.length > 1 ? ' and more' : ''}` : TBA,
        draw: P.draw ? `${P.draw.winners} × ${P.draw.name}` : TBA,
    };
    const order: PrizeKey[] = ['top3', ...NAMED_PRIZES, 'draw', 'golden', 'city', 'event'];
    // The event has its own card on the page, so it isn't repeated here.
    const tiles = tilesFor(state).filter((t) => t.key !== 'event').sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return (
        <View style={[s.list, sc]}>
            {tiles.map((t, i) => (
                <Pressable
                    key={t.key}
                    onPress={() => { trackTap('series_prize_open', { prize: t.key }); onOpen(t.key); }}
                    style={({ pressed }) => [s.wRow, i > 0 && s.yrRule, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${NAME[t.key] ?? t.title}: ${SUB[t.key] ?? t.prize}. ${t.status.toLowerCase()}. Opens the prizes.`}
                >
                    {t.img
                        ? <Image source={t.img} style={s.wThumb} contentFit="cover" />
                        : <View style={[s.wThumb, s.wIcon]}><Ionicons name={t.icon ?? 'trophy-outline'} size={20} color={GOLD} /></View>}
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.wTitle} numberOfLines={1}>{NAME[t.key] ?? t.title}</Text>
                        <Text style={s.wSub} numberOfLines={1}>{SUB[t.key] ?? t.prize}</Text>
                        <Text style={[s.wStatus, { color: toneColor(t.tone) }]} numberOfLines={1}>{t.status}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={TEXT_3} />
                </Pressable>
            ))}
            <Text style={s.oneEach}>One prize each. Win two and the next in line takes the other.</Text>
        </View>
    );
}

/**
 * One prize, on its own: its picture, what it is, how to win it and where you
 * stand. The leaderboard shows its three places; titles show today's titles.
 */
export function PrizeDetailSheet({
    visible, prize, state, onClose, onOpenEvent,
}: {
    visible: boolean;
    prize: PrizeKey | null;
    state: PrizeState;
    onClose: () => void;
    onOpenEvent?: () => void;
}) {
    const key: PrizeKey = prize === 'tickets' ? 'draw' : prize ?? 'draw';
    const t = tilesFor(state).find((x) => x.key === key);
    const tone = t ? toneColor(t.tone) : TEXT_3;
    const head: Record<PrizeKey, [string, string]> = {
        top3: ['The ', 'top three'], draw: ['Every Move ', 'Counts'], golden: ['The Golden ', 'P'],
        city: ['Top ', 'city'], event: ['Live ', 'event'], tickets: ['Every Move ', 'Counts'],
        most_wanted: ['Most ', 'Wanted'], hot_streak: ['Hot ', 'Streak'], biggest_mover: ['Biggest ', 'Mover'],
        underdog: ['', 'Underdog'], patient_zero: ['Patient ', 'Zero'], photo_finish: ['Photo ', 'Finish'],
    };
    const P = state.prizes;
    const drawHow = `A draw from everyone active on ${state.need} of the ${state.drawDots.length} days`;
    // A prize with a picture gets the picture; without one, its icon.
    const hero: Partial<Record<PrizeKey, { img: ImageSource; name: string; how: string }>> = {};
    if (P.draw?.img) hero.draw = { img: P.draw.img, name: `${P.draw.winners} × ${P.draw.name}`, how: drawHow };
    if (P.golden?.img) hero.golden = { img: P.golden.img, name: `${P.golden.name} + a Draw ticket`, how: 'Be one of the first 10 to find the Golden P' };
    const plain: Partial<Record<PrizeKey, { icon: React.ComponentProps<typeof Ionicons>['name']; name: string; how: string }>> = {
        city: { icon: 'location-outline', name: P.city ? `${P.city.name} for ${P.city.winners}` : TBA, how: 'Drawn from the top city when the round closes' },
        event: { icon: 'trophy-outline', name: state.event?.name ?? 'Live event', how: 'Its own board and prizes, on its page' },
    };
    NAMED_PRIZES.forEach((k) => {
        const x = P.named[k];
        if (x?.img) hero[k] = { img: x.img, name: x.name, how: NAMED[k].how };
        else plain[k] = { icon: NAMED[k].icon, name: x?.name ?? TBA, how: NAMED[k].how };
    });
    const race = isNamed(key) ? state.race[key] : undefined;
    if (!hero.draw) plain.draw = { icon: 'ticket-outline', name: P.draw ? `${P.draw.winners} × ${P.draw.name}` : TBA, how: drawHow };
    if (!hero.golden && P.golden) plain.golden = { icon: 'star-outline', name: `${P.golden.name} + a Draw ticket`, how: 'Be one of the first 10 to find the Golden P' };
    const [light, bold] = head[key];
    const h = hero[key];
    const pl = plain[key];
    return (
        <Sheet visible={visible} onClose={onClose}>
            <SheetHead light={light} bold={bold} onClose={onClose} />
            <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
                {h && (
                    <View style={s.dHero}>
                        <Image source={h.img} style={StyleSheet.absoluteFill} contentFit="cover" />
                        {t && <View style={s.status}><Text style={[s.statusText, { color: tone }]}>{t.status}</Text></View>}
                    </View>
                )}
                {pl && (
                    <View style={s.dIconRow}>
                        <View style={s.dIcon}><Ionicons name={pl.icon} size={26} color={GOLD} /></View>
                        {t && <Text style={[s.dStatus, { color: tone }]}>{t.status}</Text>}
                    </View>
                )}
                {(h || pl) && (
                    <>
                        <Text style={s.dName}>{(h ?? pl)!.name}</Text>
                        <Text style={s.dHow}>{(h ?? pl)!.how}</Text>
                    </>
                )}

                {key === 'draw' && (
                    <View style={s.dBlock}>
                        <View style={s.dots}>
                            {state.drawDots.map((on, d) => (
                                <View key={d} style={[s.dot, d >= state.day ? null : on ? s.dotOn : s.dotMiss]} />
                            ))}
                        </View>
                        <Text style={s.dMeta}>
                            {state.logged} of {state.need} days{state.live ? '' : ` · ${state.tickets} extra ticket${state.tickets === 1 ? '' : 's'}`}
                        </Text>
                    </View>
                )}

                {key === 'top3' && (
                    <>
                        <InfoList rows={placeRows(P)} />
                        <Text style={s.dMeta}>
                            {state.notYet ? 'Places count from the first day of the round'
                                : state.blind ? (state.live ? 'Ranks are hidden while Blind Mode is on' : 'Ranks are hidden till Thursday') : `You’re #${fmt(state.rank)} of ${fmt(state.total)}`}
                        </Text>
                    </>
                )}

                {isNamed(key) && race?.leader && !race.sealed && (
                    <InfoList rows={[
                        {
                            key: 'lead', icon: NAMED[key].icon, eyebrow: { text: 'ON COURSE', color: GOLD },
                            title: race.leader.you ? 'You' : race.leader.name, line: NAMED[key].unit(race.leader.score, race.leader.detail),
                        },
                        ...(race.you && !race.leader.you ? [{
                            key: 'you', icon: 'person-outline' as const, eyebrow: { text: 'YOU', color: TEXT_3 },
                            title: `${ordinal(race.you.ord)} in line`, line: NAMED[key].unit(race.you.score, race.you.detail),
                        }] : []),
                    ]} />
                )}
                {isNamed(key) && <Text style={s.dMeta}>One prize each: if you win two, the next in line takes the other.</Text>}

                {key === 'event' && onOpenEvent && (
                    <Pressable onPress={onOpenEvent} style={({ pressed }) => [s.dBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                        <Text style={s.dBtnText}>OPEN THE EVENT</Text>
                    </Pressable>
                )}
            </ScrollView>
        </Sheet>
    );
}

/** The round's winners, once they're announced in /admin/series: places, then The Draw and the top city. */
export function WinnersCard({ results }: { results: SeriesResults }) {
    const sc = useSeasonCard();
    if (!results.winners.length) return null;
    const PLACE = ['CHAMPION', 'RUNNER-UP', 'PODIUM'];
    const label = (w: SeriesResults['winners'][number]) => (w.kind === 'place'
        ? PLACE[w.place - 1] ?? ordinal(w.place).toUpperCase()
        : w.kind === 'draw' ? 'EVERY MOVE COUNTS'
            : w.kind === 'city' ? `TOP CITY${w.city ? ` · ${w.city.toUpperCase()}` : ''}`
                : NAMED[w.kind].title.toUpperCase());
    const icon = (k: SeriesResults['winners'][number]['kind']): IconName => (k === 'place' ? 'trophy-outline'
        : k === 'draw' ? 'ticket-outline' : k === 'city' ? 'location-outline' : NAMED[k].icon);
    return (
        <>
            <SectionLabel text="The winners" right={results.round.name} />
            <View style={[s.list, sc]}>
                {results.winners.map((w, i) => (
                    <View key={`${w.kind}-${w.place}`} style={[s.wRow, i > 0 && s.yrRule]}>
                        {w.image_url
                            ? <Image source={{ uri: storageImage(w.image_url, 256, 256) ?? w.image_url }} style={s.wThumb} contentFit="cover" />
                            : (
                                <View style={[s.wThumb, s.wIcon]}>
                                    <Ionicons name={icon(w.kind)} size={20} color={GOLD} />
                                </View>
                            )}
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[s.wStatus, { marginTop: 0, marginBottom: 3, color: w.kind === 'place' ? (MEDALS[w.place - 1] ?? TEXT_3) : GOLD }]}>{label(w)}</Text>
                            <Text style={[s.wTitle, w.you && { color: GOLD }]} numberOfLines={1}>{w.you ? `${w.name} (you)` : w.name}</Text>
                            {w.prize ? <Text style={s.wSub} numberOfLines={1}>{w.prize}{w.sponsor ? ` · ${w.sponsor}` : ''}</Text> : null}
                        </View>
                    </View>
                ))}
            </View>
        </>
    );
}

/** Every prize as one list, opened at the one you tapped. */
export function PrizesSheet({ visible, focus, state, onClose }: { visible: boolean; focus: PrizeKey | null; state: PrizeState; onClose: () => void }) {
    const scroll = useRef<ScrollView>(null);
    const ys = useRef<Record<string, number>>({});
    useEffect(() => {
        if (!visible || !focus) return undefined;
        const key = focus === 'top3' ? 'place-1' : focus === 'tickets' ? 'draw' : focus;
        const y = key === 'place-1' ? 0 : Math.max(0, (ys.current[key] ?? 0) - 6);
        const tm = setTimeout(() => scroll.current?.scrollTo({ y, animated: true }), 380);
        return () => clearTimeout(tm);
    }, [visible, focus]);
    const tiles = tilesFor(state);
    const st = (k: PrizeKey) => tiles.find((t) => t.key === k);
    const tone = (k: PrizeKey): InfoRow['tone'] => { const t = st(k)?.tone; return t === 'ok' ? 'green' : t === 'gold' ? 'gold' : 'muted'; };
    const P = state.prizes;
    const places = placeRows(P);
    places[0] = { ...places[0], right: state.blind || state.notYet ? undefined : `YOU’RE #${fmt(state.rank)}`, tone: 'muted' };
    const rows: InfoRow[] = [
        ...places,
        ...namedOn(P).map((k): InfoRow => ({
            key: k, img: P.named[k]?.img, icon: P.named[k]?.img ? undefined : NAMED[k].icon,
            eyebrow: { text: NAMED[k].title.toUpperCase(), color: GOLD }, title: P.named[k]?.name ?? TBA, line: NAMED[k].short,
        })),
        {
            key: 'draw', img: P.draw?.img, icon: P.draw?.img ? undefined : 'ticket-outline', eyebrow: { text: 'EVERY MOVE COUNTS', color: GOLD },
            title: P.draw ? `${P.draw.winners} × ${P.draw.name}` : TBA,
            line: `A draw: active on ${state.need} of the ${state.drawDots.length} days`, right: st('draw')?.status, tone: tone('draw'),
        },
    ];
    if (state.golden && P.golden) rows.push({ key: 'golden', img: P.golden.img, title: P.golden.name, line: 'Find the Golden P in the app', right: st('golden')?.status, tone: tone('golden') });
    if (state.cityPos != null && P.city) rows.push({ key: 'city', icon: 'location-outline', title: P.city ? `${P.city.name} × ${P.city.winners}` : `Top city · ${TBA.toLowerCase()}`, line: 'Your city finishes top', right: st('city')?.status, tone: tone('city') });
    if (state.event) rows.push({ key: 'event', icon: 'trophy-outline', title: state.event.name, line: 'Its own prizes, on its page', right: st('event')?.status, tone: 'muted' });
    return (
        <Sheet visible={visible} onClose={onClose}>
            <SheetHead light="What you can " bold="win" onClose={onClose} />
            <Text style={s.sub}>{state.roundName} · prizes land {state.prizesOn}</Text>
            <ScrollView ref={scroll} style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
                <InfoList rows={rows} onRowLayout={(k, y) => { ys.current[k] = y; }} />
                <Text style={s.foot}>{P.sample ? 'Sample prizes. ' : ''}One prize each: win two and the next in line takes the other. Prizes never cost points.</Text>
            </ScrollView>
        </Sheet>
    );
}

const s = StyleSheet.create({
    row: { paddingHorizontal: 16, gap: 8 },
    tile: { width: 176, borderRadius: 16, overflow: 'hidden', backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER },
    tileLead: { borderColor: 'rgba(232,210,0,0.4)' },
    pic: { width: '100%', aspectRatio: 3 / 2, backgroundColor: '#0b0b0b', overflow: 'hidden' },
    icoBox: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0b0b' },
    picFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
    status: { position: 'absolute', left: 10, top: 10, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.62)' },
    statusText: { fontSize: 8, fontWeight: '700', letterSpacing: 1.3 },
    body: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 13, gap: 2 },
    tTitle: { fontSize: 9, fontWeight: '700', letterSpacing: 1.6, color: TEXT_3 },
    tPrize: { marginTop: 2, fontSize: 14, fontWeight: '400', lineHeight: 18, color: TEXT },
    tHow: { marginTop: 3, fontSize: 11, fontWeight: '300', lineHeight: 15, color: TEXT_3 },

    sub: { fontSize: 12, fontWeight: '300', color: TEXT_3 },
    dHero: { width: '100%', aspectRatio: 16 / 10, maxHeight: 220, borderRadius: 16, overflow: 'hidden', backgroundColor: '#0b0b0b', marginTop: 6 },
    dIconRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    dIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(232,210,0,0.25)', backgroundColor: 'rgba(232,210,0,0.06)' },
    dStatus: { fontSize: 9, fontWeight: '700', letterSpacing: 1.4 },
    dName: { marginTop: 14, fontSize: 20, fontWeight: '300', color: TEXT, letterSpacing: -0.2 },
    dHow: { marginTop: 4, fontSize: 13, fontWeight: '300', color: TEXT_2 },
    dBlock: { marginTop: 16 },
    dMeta: { marginTop: 10, fontSize: 12, fontWeight: '300', color: TEXT_3 },
    dBtn: { marginTop: 18, height: 46, borderRadius: 23, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
    dBtnText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: '#0a0a0a' },
    oneEach: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 12, fontSize: 11, fontWeight: '300', color: TEXT_3, textAlign: 'center' },
    foot: { marginTop: 12, marginBottom: 4, fontSize: 11, fontWeight: '300', color: TEXT_3, textAlign: 'center' },
    list: { marginHorizontal: 16, borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, overflow: 'hidden' },
    wRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 12 },
    wThumb: { width: 52, height: 52, borderRadius: 12, backgroundColor: '#0b0b0b' },
    wIcon: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(232,210,0,0.25)', backgroundColor: 'rgba(232,210,0,0.06)' },
    wTitle: { fontSize: 15, fontWeight: '400', color: TEXT },
    wSub: { marginTop: 2, fontSize: 12, fontWeight: '300', color: TEXT_2 },
    wStatus: { marginTop: 4, fontSize: 8, fontWeight: '700', letterSpacing: 1.3 },
    h: { marginTop: 18, marginBottom: 8, fontSize: 9, fontWeight: '600', letterSpacing: 2, color: GOLD },
    banner: { width: '100%', aspectRatio: 3 / 2, maxHeight: 200, borderRadius: 14, overflow: 'hidden', marginBottom: 8, backgroundColor: '#0b0b0b' },
    bannerCap: { position: 'absolute', left: 14, right: 14, bottom: 12 },
    bannerSmall: { fontSize: 9, fontWeight: '700', letterSpacing: 1.6, color: GOLD },
    bannerName: { marginTop: 2, fontSize: 18, fontWeight: '300', color: TEXT },
    yr: { borderRadius: 14, borderWidth: 1, borderColor: CARD_BORDER, backgroundColor: 'rgba(255,255,255,0.02)', overflow: 'hidden' },
    yrRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
    yrRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR },
    yrTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    yrTitle: { flexShrink: 1, fontSize: 13, fontWeight: '500', color: TEXT },
    yrStatus: { fontSize: 9, fontWeight: '700', letterSpacing: 1.4 },
    yrBody: { marginTop: 2, fontSize: 12, fontWeight: '300', lineHeight: 17, color: TEXT_3 },
    medal: { fontSize: 8, fontWeight: '700', letterSpacing: 1.6 },
    thumb: { width: 72, height: 48, borderRadius: 9, backgroundColor: '#0b0b0b' },
    dots: { flexDirection: 'row', gap: 3, marginTop: 10 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.10)' },
    dotOn: { backgroundColor: GOLD },
    dotMiss: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
    note: { marginTop: 8, marginHorizontal: 2, fontSize: 12, fontWeight: '300', lineHeight: 17, color: TEXT_3 },
    center: { textAlign: 'center', marginTop: 16 },
});

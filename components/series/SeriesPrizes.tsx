import { Ionicons } from '@expo/vector-icons';
import { Image, type ImageSource } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { trackTap } from '@/lib/analytics';
import { NAMED_PRIZES, type NamedPrize, type PrizeRace, type PrizeRaceEntry, type SeriesPrize, type SeriesResults } from '@/lib/api/series';
import { fmt } from '@/lib/dev/seriesPrototype';
import i18n from '@/lib/i18n';
import { storageImage } from '@/lib/storageImage';
import { BRONZE, CARD_BG, CARD_BORDER, GOLD, GREEN, HAIR, SectionLabel, SILVER, TEXT, TEXT_2, TEXT_3 } from './SeriesLane';
import { InfoList, type InfoRow, Sheet, SheetHead } from './SeriesSheets';
import { useSeasonCard } from './season';
import { placeOrdinal } from './seriesView';

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
 * app uses them (the daily titles that did are gone). The titles stay English
 * in every language; the lines are getters, read in the language on screen.
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
        title: 'Most Wanted', icon: 'locate-outline', get short() { return i18n.t('series:prizes.mostWanted.short'); },
        get how() { return i18n.t('series:prizes.mostWanted.how'); },
        unit: (n) => i18n.t('series:prizes.mostWanted.unit', { count: n }),
    },
    hot_streak: {
        title: 'Hot Streak', icon: 'flame-outline', get short() { return i18n.t('series:prizes.hotStreak.short'); },
        get how() { return i18n.t('series:prizes.hotStreak.how'); },
        unit: (n) => i18n.t('series:prizes.hotStreak.unit', { count: n }),
    },
    biggest_mover: {
        title: 'Biggest Mover', icon: 'trending-up-outline', get short() { return i18n.t('series:prizes.biggestMover.short'); },
        get how() { return i18n.t('series:prizes.biggestMover.how'); },
        unit: (n) => i18n.t('series:prizes.biggestMover.unit', { count: n, n: fmt(n) }),
    },
    underdog: {
        title: 'Underdog', icon: 'arrow-up-circle-outline', get short() { return i18n.t('series:prizes.underdog.short'); },
        get how() { return i18n.t('series:prizes.underdog.how'); },
        unit: (n, d) => (d != null ? `#${fmt(d)} → #${fmt(n)}` : `#${fmt(n)}`),
    },
    patient_zero: {
        title: 'Patient Zero', icon: 'people-outline', get short() { return i18n.t('series:prizes.patientZero.short'); },
        get how() { return i18n.t('series:prizes.patientZero.how'); },
        unit: (n) => i18n.t('series:prizes.patientZero.unit', { count: n }),
    },
    photo_finish: {
        title: 'Photo Finish', icon: 'stopwatch-outline', get short() { return i18n.t('series:prizes.photoFinish.short'); },
        get how() { return i18n.t('series:prizes.photoFinish.how'); },
        unit: (n) => i18n.t('series:prizes.photoFinish.unit', { n: fmt(n) }),
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

/** A prize not announced yet (read at call time, in the language on screen). */
const tba = () => i18n.t('series:prizes.tba');
const MEDALS = [GOLD, SILVER, BRONZE];
/** 1st, 2nd and 3rd as list rows, with their medal colours. */
const placeRows = (P: PrizeSet): InfoRow[] => (P.places.length
    ? P.places.map((x, i) => ({
        key: `place-${i + 1}`, img: x.img, icon: x.img ? undefined : 'trophy-outline' as const,
        eyebrow: { text: placeOrdinal(i + 1).toUpperCase(), color: MEDALS[i] ?? TEXT_3 }, title: x.name, line: x.by ?? x.line ?? '',
    }))
    : [{ key: 'place-1', icon: 'trophy-outline' as const, title: tba(), line: i18n.t('series:prizes.topPlacesWin') }]);

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
    if (p.notYet) return { status: i18n.t('series:prizes.status.notStarted'), tone: 'muted' };
    if (e?.sealed || (p.blind && (k === 'biggest_mover' || k === 'underdog'))) return { status: i18n.t('series:prizes.status.hiddenBlind'), tone: 'muted' };
    if (!e?.leader) {
        const wait = k === 'biggest_mover' && p.day <= 3 ? i18n.t('series:prizes.status.countsFrom', { day: 4 })
            : k === 'underdog' && p.day <= half ? i18n.t('series:prizes.status.countsFrom', { day: half + 1 })
                : k === 'photo_finish' && p.day < days ? i18n.t('series:prizes.status.lastDay')
                    : k === 'most_wanted' ? i18n.t('series:prizes.status.noBounties') : i18n.t('series:prizes.status.nobody');
        return { status: wait, tone: 'muted' };
    }
    const unit = NAMED[k].unit(e.leader.score, e.leader.detail).toUpperCase();
    if (e.leader.you) return { status: i18n.t('series:prizes.status.youLead', { unit }), tone: 'gold' };
    const first = e.leader.name.split(' ')[0].toUpperCase();
    if (e.you) return { status: i18n.t('series:prizes.status.youreBehind', { ord: placeOrdinal(e.you.ord).toUpperCase(), name: first }), tone: 'muted' };
    return { status: i18n.t('series:prizes.status.theyLead', { name: first, unit }), tone: 'muted' };
}

function tilesFor(p: PrizeState): Tile[] {
    const P = p.prizes;
    const inDraw = p.logged >= p.need;
    const g = p.golden;
    const first = P.places[0];
    const named: Tile[] = namedOn(P).map((k) => {
        const x = P.named[k];
        const st = raceStatus(k, p.race[k], p);
        return { key: k, img: x?.img, icon: NAMED[k].icon, title: NAMED[k].title, prize: x?.name ?? tba(), how: NAMED[k].short, ...st };
    });
    const tiles: Tile[] = [
        {
            key: 'draw', img: P.draw?.img, icon: 'ticket-outline', title: 'Every Move Counts', prize: P.draw?.name ?? tba(), lead: true,
            status: inDraw ? i18n.t('series:prizes.status.youreIn') : i18n.t('series:prizes.status.drawDays', { logged: p.logged, need: p.need }), tone: inDraw ? 'ok' : 'gold',
            how: `${P.draw ? `${i18n.t('series:prizes.draw.winners', { count: P.draw.winners })} · ` : ''}${inDraw
                ? (p.live ? i18n.t('series:prizes.draw.youreIn') : `you’re in with ${p.tickets + 1} entries`)
                : i18n.t('series:prizes.draw.moreDays', { count: p.need - p.logged })}`,
        },
        {
            key: 'top3', img: first?.img, icon: 'trophy-outline', title: 'Champion', prize: first?.name ?? tba(),
            how: first
                ? `${first.by ?? first.line ?? ''}${P.places.length > 1 ? ` · ${P.places.length > 2 ? i18n.t('series:prizes.top3.alsoPodium') : i18n.t('series:prizes.top3.alsoRunnerUp')}` : ''}`
                : i18n.t('series:prizes.topPlacesWin'),
            status: p.notYet ? i18n.t('series:prizes.status.notStarted') : p.blind ? i18n.t('series:prizes.status.rankHidden') : i18n.t('series:prizes.status.yourRank', { rank: fmt(p.rank) }), tone: 'muted',
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
            key: 'city', icon: 'location-outline', title: i18n.t('series:prizes.city.title'),
            prize: i18n.t('series:prizes.city.prizeFor', { name: P.city.name, winners: P.city.winners }), how: i18n.t('series:prizes.city.how'),
            status: i18n.t('series:prizes.city.status', {
                city: (p.cityName ?? i18n.t('series:prizes.city.yourCity')).toUpperCase(), ord: placeOrdinal(p.cityPos + 1).toUpperCase(),
            }),
            tone: p.cityPos === 0 ? 'gold' : 'muted',
        });
    }
    if (p.event) {
        tiles.push({
            key: 'event', icon: 'trophy-outline', title: p.event.name, prize: i18n.t('series:prizes.event.ownPrizes'), how: i18n.t('series:prizes.event.how'),
            status: p.event.rank
                ? (p.event.over ? i18n.t('series:prizes.event.finished', { rank: p.event.rank }) : i18n.t('series:prizes.event.rankThere', { rank: p.event.rank }))
                : i18n.t('series:prizes.event.open'),
            tone: 'muted',
        });
    }
    return tiles;
}
const toneColor = (t: Tone) => (t === 'ok' ? GREEN : t === 'gold' ? GOLD : TEXT_2);

/** What you can win, under the race: one tile per prize, with where you stand on it. */
export function PrizeRow({ state, onOpen }: { state: PrizeState; onOpen: (k: PrizeKey) => void }) {
    const { t } = useTranslation();
    const sc = useSeasonCard();
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.row}
            snapToInterval={184}
            decelerationRate="fast"
        >
            {tilesFor(state).map((tile) => (
                <Pressable
                    key={tile.key}
                    onPress={() => { trackTap('series_prize_open', { prize: tile.key }); onOpen(tile.key); }}
                    style={({ pressed }) => [s.tile, sc, tile.lead && s.tileLead, pressed && { opacity: 0.8 }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('series:prizes.tileA11y', { title: tile.title, prize: tile.prize, status: tile.status.toLowerCase() })}
                >
                    <View style={s.pic}>
                        {tile.img
                            ? <Image source={tile.img} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                            : (
                                <View style={[StyleSheet.absoluteFill, s.icoBox]}>
                                    <LinearGradient colors={['rgba(232,210,0,0.14)', 'rgba(232,210,0,0)']} style={StyleSheet.absoluteFill} start={{ x: 0.5, y: 0.2 }} end={{ x: 0.5, y: 1 }} />
                                    <Ionicons name={tile.icon} size={30} color={GOLD} />
                                </View>
                            )}
                        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={s.picFade} />
                        <View style={s.status}><Text style={[s.statusText, { color: toneColor(tile.tone) }]}>{tile.status}</Text></View>
                    </View>
                    <View style={s.body}>
                        <Text style={s.tTitle} numberOfLines={1}>{tile.title.toUpperCase()}</Text>
                        <Text style={s.tPrize} numberOfLines={2}>{tile.prize}</Text>
                        <Text style={s.tHow} numberOfLines={2}>{tile.how}</Text>
                    </View>
                </Pressable>
            ))}
        </ScrollView>
    );
}

/** Ways to win, as one list: each prize, what's on offer and where you stand. Tap for the full sheet. */
export function WaysToWin({ state, onOpen }: { state: PrizeState; onOpen: (k: PrizeKey) => void }) {
    const { t } = useTranslation();
    const sc = useSeasonCard();
    const P = state.prizes;
    const TBA = t('series:prizes.tba');
    const NAME: Partial<Record<PrizeKey, string>> = { top3: 'Champion · Runner-up · Podium', draw: 'Every Move Counts', city: t('series:prizes.city.title') };
    const SUB: Partial<Record<PrizeKey, string>> = {
        top3: P.places.length ? (P.places.length > 1 ? t('series:prizes.andMore', { name: P.places[0].name }) : P.places[0].name) : TBA,
        draw: P.draw ? `${P.draw.winners} × ${P.draw.name}` : TBA,
    };
    const order: PrizeKey[] = ['top3', ...NAMED_PRIZES, 'draw', 'golden', 'city', 'event'];
    // The event has its own card on the page, so it isn't repeated here.
    const tiles = tilesFor(state).filter((x) => x.key !== 'event').sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return (
        <View style={[s.list, sc]}>
            {tiles.map((tile, i) => (
                <Pressable
                    key={tile.key}
                    onPress={() => { trackTap('series_prize_open', { prize: tile.key }); onOpen(tile.key); }}
                    style={({ pressed }) => [s.wRow, i > 0 && s.yrRule, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('series:prizes.tileA11y', { title: NAME[tile.key] ?? tile.title, prize: SUB[tile.key] ?? tile.prize, status: tile.status.toLowerCase() })}
                >
                    {tile.img
                        ? <Image source={tile.img} style={s.wThumb} contentFit="cover" />
                        : <View style={[s.wThumb, s.wIcon]}><Ionicons name={tile.icon ?? 'trophy-outline'} size={20} color={GOLD} /></View>}
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.wTitle} numberOfLines={1}>{NAME[tile.key] ?? tile.title}</Text>
                        <Text style={s.wSub} numberOfLines={1}>{SUB[tile.key] ?? tile.prize}</Text>
                        <Text style={[s.wStatus, { color: toneColor(tile.tone) }]} numberOfLines={1}>{tile.status}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={TEXT_3} />
                </Pressable>
            ))}
            <Text style={s.oneEach}>{t('series:prizes.oneEach')}</Text>
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
    const { t } = useTranslation();
    const TBA = t('series:prizes.tba');
    const key: PrizeKey = prize === 'tickets' ? 'draw' : prize ?? 'draw';
    const tile = tilesFor(state).find((x) => x.key === key);
    const tone = tile ? toneColor(tile.tone) : TEXT_3;
    const head: Record<PrizeKey, [string, string]> = {
        top3: [t('series:prizes.head.top3Light'), t('series:prizes.head.top3Bold')], draw: ['Every Move ', 'Counts'], golden: ['The Golden ', 'P'],
        city: [t('series:prizes.head.cityLight'), t('series:prizes.head.cityBold')], event: [t('series:prizes.head.eventLight'), t('series:prizes.head.eventBold')], tickets: ['Every Move ', 'Counts'],
        most_wanted: ['Most ', 'Wanted'], hot_streak: ['Hot ', 'Streak'], biggest_mover: ['Biggest ', 'Mover'],
        underdog: ['', 'Underdog'], patient_zero: ['Patient ', 'Zero'], photo_finish: ['Photo ', 'Finish'],
    };
    const P = state.prizes;
    const drawHow = t('series:prizes.drawHow', { need: state.need, days: state.drawDots.length });
    // A prize with a picture gets the picture; without one, its icon.
    const hero: Partial<Record<PrizeKey, { img: ImageSource; name: string; how: string }>> = {};
    if (P.draw?.img) hero.draw = { img: P.draw.img, name: `${P.draw.winners} × ${P.draw.name}`, how: drawHow };
    if (P.golden?.img) hero.golden = { img: P.golden.img, name: `${P.golden.name} + a Draw ticket`, how: 'Be one of the first 10 to find the Golden P' };
    const plain: Partial<Record<PrizeKey, { icon: React.ComponentProps<typeof Ionicons>['name']; name: string; how: string }>> = {
        city: {
            icon: 'location-outline', name: P.city ? t('series:prizes.city.prizeFor', { name: P.city.name, winners: P.city.winners }) : TBA,
            how: t('series:prizes.city.drawnAtClose'),
        },
        event: { icon: 'trophy-outline', name: state.event?.name ?? t('series:prizes.event.liveEvent'), how: t('series:prizes.event.ownBoard') },
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
                        {tile && <View style={s.status}><Text style={[s.statusText, { color: tone }]}>{tile.status}</Text></View>}
                    </View>
                )}
                {pl && (
                    <View style={s.dIconRow}>
                        <View style={s.dIcon}><Ionicons name={pl.icon} size={26} color={GOLD} /></View>
                        {tile && <Text style={[s.dStatus, { color: tone }]}>{tile.status}</Text>}
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
                            {t('series:prizes.drawMeta', { logged: state.logged, need: state.need })}{state.live ? '' : ` · ${state.tickets} extra ticket${state.tickets === 1 ? '' : 's'}`}
                        </Text>
                    </View>
                )}

                {key === 'top3' && (
                    <>
                        <InfoList rows={placeRows(P)} />
                        <Text style={s.dMeta}>
                            {state.notYet ? t('series:prizes.top3.notYet')
                                : state.blind ? (state.live ? t('series:prizes.top3.blind') : 'Ranks are hidden till Thursday')
                                    : t('series:prizes.top3.rankOf', { rank: fmt(state.rank), total: fmt(state.total) })}
                        </Text>
                    </>
                )}

                {isNamed(key) && race?.leader && !race.sealed && (
                    <InfoList rows={[
                        {
                            key: 'lead', icon: NAMED[key].icon, eyebrow: { text: t('series:prizes.race.onCourse'), color: GOLD },
                            title: race.leader.you ? t('series:prizes.race.you') : race.leader.name, line: NAMED[key].unit(race.leader.score, race.leader.detail),
                        },
                        ...(race.you && !race.leader.you ? [{
                            key: 'you', icon: 'person-outline' as const, eyebrow: { text: t('series:prizes.race.youCaps'), color: TEXT_3 },
                            title: t('series:prizes.race.inLine', { ord: placeOrdinal(race.you.ord) }), line: NAMED[key].unit(race.you.score, race.you.detail),
                        }] : []),
                    ]} />
                )}
                {isNamed(key) && <Text style={s.dMeta}>{t('series:prizes.oneEachIf')}</Text>}

                {key === 'event' && onOpenEvent && (
                    <Pressable onPress={onOpenEvent} style={({ pressed }) => [s.dBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                        <Text style={s.dBtnText}>{t('series:prizes.openEvent')}</Text>
                    </Pressable>
                )}
            </ScrollView>
        </Sheet>
    );
}

/** The round's winners, once they're announced in /admin/series: places, then The Draw and the top city. */
export function WinnersCard({ results }: { results: SeriesResults }) {
    const { t } = useTranslation();
    const sc = useSeasonCard();
    if (!results.winners.length) return null;
    const PLACE = ['CHAMPION', 'RUNNER-UP', 'PODIUM'];
    const label = (w: SeriesResults['winners'][number]) => (w.kind === 'place'
        ? PLACE[w.place - 1] ?? placeOrdinal(w.place).toUpperCase()
        : w.kind === 'draw' ? 'EVERY MOVE COUNTS'
            : w.kind === 'city' ? `${t('series:prizes.winners.topCity')}${w.city ? ` · ${w.city.toUpperCase()}` : ''}`
                : NAMED[w.kind].title.toUpperCase());
    const icon = (k: SeriesResults['winners'][number]['kind']): IconName => (k === 'place' ? 'trophy-outline'
        : k === 'draw' ? 'ticket-outline' : k === 'city' ? 'location-outline' : NAMED[k].icon);
    return (
        <>
            <SectionLabel text={t('series:prizes.winners.title')} right={results.round.name} />
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
                            <Text style={[s.wTitle, w.you && { color: GOLD }]} numberOfLines={1}>{w.you ? t('series:prizes.winners.you', { name: w.name }) : w.name}</Text>
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
    const { t } = useTranslation();
    const TBA = t('series:prizes.tba');
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
    const st = (k: PrizeKey) => tiles.find((x) => x.key === k);
    const tone = (k: PrizeKey): InfoRow['tone'] => { const tn = st(k)?.tone; return tn === 'ok' ? 'green' : tn === 'gold' ? 'gold' : 'muted'; };
    const P = state.prizes;
    const places = placeRows(P);
    places[0] = { ...places[0], right: state.blind || state.notYet ? undefined : t('series:prizes.status.yourRank', { rank: fmt(state.rank) }), tone: 'muted' };
    const rows: InfoRow[] = [
        ...places,
        ...namedOn(P).map((k): InfoRow => ({
            key: k, img: P.named[k]?.img, icon: P.named[k]?.img ? undefined : NAMED[k].icon,
            eyebrow: { text: NAMED[k].title.toUpperCase(), color: GOLD }, title: P.named[k]?.name ?? TBA, line: NAMED[k].short,
        })),
        {
            key: 'draw', img: P.draw?.img, icon: P.draw?.img ? undefined : 'ticket-outline', eyebrow: { text: 'EVERY MOVE COUNTS', color: GOLD },
            title: P.draw ? `${P.draw.winners} × ${P.draw.name}` : TBA,
            line: t('series:prizes.drawLine', { need: state.need, days: state.drawDots.length }), right: st('draw')?.status, tone: tone('draw'),
        },
    ];
    if (state.golden && P.golden) rows.push({ key: 'golden', img: P.golden.img, title: P.golden.name, line: 'Find the Golden P in the app', right: st('golden')?.status, tone: tone('golden') });
    if (state.cityPos != null && P.city) {
        rows.push({
            key: 'city', icon: 'location-outline', title: P.city ? `${P.city.name} × ${P.city.winners}` : `${t('series:prizes.city.title')} · ${TBA.toLowerCase()}`,
            line: t('series:prizes.city.finishesTop'), right: st('city')?.status, tone: tone('city'),
        });
    }
    if (state.event) rows.push({ key: 'event', icon: 'trophy-outline', title: state.event.name, line: t('series:prizes.event.ownPrizesPage'), right: st('event')?.status, tone: 'muted' });
    return (
        <Sheet visible={visible} onClose={onClose}>
            <SheetHead light={t('series:prizes.sheet.light')} bold={t('series:prizes.sheet.bold')} onClose={onClose} />
            <Text style={s.sub}>{t('series:prizes.sheet.sub', { round: state.roundName, on: state.prizesOn })}</Text>
            <ScrollView ref={scroll} style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
                <InfoList rows={rows} onRowLayout={(k, y) => { ys.current[k] = y; }} />
                <Text style={s.foot}>{P.sample ? 'Sample prizes. ' : ''}{t('series:prizes.sheet.foot')}</Text>
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

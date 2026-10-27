import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { kit } from '@/components/drop/cardKit';
import { HomeCard, HomeNote, type HomeStat, HomeStats } from '@/components/home/HomeCard';
import { trackTap } from '@/lib/analytics';
import { crowdAt, seriesClock, seriesDate, seriesNum, seriesOrdinal } from '@/lib/api/series';
import i18n, { getFormatLocale } from '@/lib/i18n';
import { inviteNext } from './SeriesInvite';
import { type JoinRound, openSeriesJoin, roundDays } from './SeriesJoin';
import { useSeriesDress } from './SeriesRoundCard';
import { CARD_BG, CARD_BORDER, GOLD, GREEN, HAIR, RED, TEXT, TEXT_2, TEXT_3 } from './SeriesLane';
import type { PrizeState } from './SeriesPrizes';
import type { Around, SeriesComing, SeriesToday } from './SeriesToday';
import { useSeasonCard } from './season';
import type { RecapLine } from './useSeriesSim';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/*
 * The Series cards Home shows around the round itself: the countdown before a
 * round (and how the last one went, between rounds), what changed since you
 * last looked, and what you're playing for. They read Home's one Series source
 * (useSeriesHome in ./SeriesToday).
 */

const LON = 'Europe/London';
const timeOf = (ms: number) => new Date(ms).toLocaleTimeString(getFormatLocale(), { hour: '2-digit', minute: '2-digit', timeZone: LON });
// A London calendar day to compare, never shown: fixed format, whatever the language.
const dateKey = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { timeZone: LON });
const first = (name: string) => name.split(' ')[0];

const openLeague = (from: string) => {
    void Haptics.selectionAsync();
    trackTap('series_home_open', { from });
    router.push('/(tabs)/league');
};

/** "23d 04h", "14h 05m", "38m". */
export function countdown(ms: number): string {
    const m = Math.max(0, Math.floor(ms / 60_000));
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    return d > 0 ? seriesClock(d, h, null) : seriesClock(0, h, m % 60);
}

/* ── Before a round, and between rounds ──────────────────────────────── */

/**
 * The Series on Home when no round is running, in Home's one layout: before
 * one, when it starts and what gets you in the Draw; between rounds, where
 * you finished, whether you made the Draw, and the countdown to the next.
 *
 * Nobody is in until they join (20261027120000): until then the card carries
 * one gold JOIN that opens the join sheet. Once you're in, while a round's
 * invite period is on, the card leads with that, who's waiting at the start
 * line (it grows towards the gun, as on the League) and the countdown.
 * Inviting is on the League: the card opens it. The invite race is an
 * optional extra for Squad Builder, never a way onto the board: once you've
 * brought a friend in, your race place shows instead.
 * Never a dash or a 0. Just the card: picking a city is left to the League.
 */
export function SeriesComingCard({ coming: c }: { coming: SeriesComing }) {
    const [now, setNow] = useState(Date.now());
    const near = c.next != null && c.next.startsAt - now < 3_600_000;
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), near ? 15_000 : 60_000);
        return () => clearInterval(t);
    }, [near]);
    const join = c.join;
    const openJoin = join ? () => openSeriesJoin(join, 'home') : undefined;
    return join && openJoin && (c.phase === 'running' || (c.phase === 'between' && !c.finish))
        ? <JoinCard coming={c} join={join} now={now} onJoin={openJoin} />
        : <ComingCard coming={c} now={now} onJoin={openJoin} />;
}

function ComingCard({ coming: c, now, onJoin }: { coming: SeriesComing; now: number; onJoin?: () => void }) {
    const { t } = useTranslation();
    const upcoming = c.phase === 'upcoming';
    // Gold is for your own numbers: the countdown stays white.
    const clock: HomeStat = c.next
        ? { value: countdown(c.next.startsAt - now), label: t('series:homeCards.toRound', { round: upcoming ? c.roundName : c.next.name }) }
        : { value: '—', label: t('series:homeCards.nextSoon') };
    // You're in, before the round: the invite race, once its period is on.
    const inv = upcoming && !c.join ? c.invite : null;
    // Not in the invite race (yet): the crowd at the line and that you're in;
    // in it: your race place and friends in.
    const offRace = inv != null && inv.me.rank == null;
    const items: HomeStat[] = inv && offRace
        ? [
            { value: seriesNum(crowdAt(inv, now)), label: t('series:homeCards.onStartLine') },
            { value: t('series:homeCards.in'), label: t('series:homeCards.youreInRound', { round: c.roundName }), tone: 'green' },
            clock,
        ]
        : inv
        ? [
            { value: seriesOrdinal(inv.me.rank!), label: t('series:homeCards.racePlace'), tone: 'gold' },
            {
                value: `${inv.me.friends}`,
                label: inv.me.joining > 0
                    ? t('series:homeCards.friendsInJoining', { count: inv.me.friends, n: inv.me.joining })
                    : t('series:homeCards.friendsIn', { count: inv.me.friends }),
            },
            clock,
        ]
        // Not joined yet: who's waiting at the line, the countdown and the round; JOIN below.
        : upcoming && c.join && c.invite
        ? [
            { value: seriesNum(crowdAt(c.invite, now)), label: t('series:homeCards.onStartLine') },
            clock,
            { value: `${c.days}`, label: t('series:homeCards.roundDays') },
        ]
        : upcoming
        ? [clock, { value: `${c.days}`, label: t('series:homeCards.roundDays') }, { value: `${c.need}`, label: t('series:homeCards.drawDays') }]
        : [
            c.finish
                ? { value: `#${seriesNum(c.finish.rank)}`, label: t('series:homeCards.finishedOf', { n: seriesNum(c.finish.total) }), tone: 'gold' }
                : { value: '—', label: t('series:homeCards.finished') },
            c.finish
                ? {
                    value: c.finish.inDraw ? t('series:homeCards.in') : t('series:homeCards.out'),
                    label: t('series:homeCards.theDraw'),
                    tone: c.finish.inDraw ? 'green' : undefined,
                }
                : { value: '—', label: t('series:homeCards.theDraw') },
            clock,
        ];
    const dress = useSeriesDress(
        c.season,
        (inv || c.join) && upcoming && c.next
            ? t('series:homeCards.roundStarts', { round: c.roundName, date: seriesDate(new Date(c.next.startsAt).toISOString()) })
            : upcoming ? t('series:homeCards.startingSoon', { round: c.roundName }) : t('series:homeCards.roundFinished', { round: c.roundName }),
    );
    // One button: JOIN while you're not in (it's the thing to do now), else the winners once they're out.
    const action = onJoin
        ? { icon: 'flag-outline' as const, label: t('series:join.button'), primary: true, onPress: onJoin }
        : !upcoming && c.winners ? { icon: 'trophy-outline' as const, label: t('series:homeCards.winners'), onPress: () => openLeague('winners') } : undefined;
    return (
        <HomeCard
            {...dress}
            title={upcoming ? `${c.season} · ${c.roundName}` : t('series:homeCards.roundFinished', { round: c.roundName })}
            onPress={() => openLeague(upcoming ? 'coming' : 'finished')}
            label={t('series:homeCards.a11y', { season: c.season, stats: items.map((x) => `${x.value} ${x.label}`).join('. ') })}
            // Inviting lives on the League (Jamie, 26 Oct): the card opens it.
            action={action}
        >
            <HomeStats items={items} />
            {inv && <HomeNote icon="people-outline" lead={t('series:homeCards.next')} text={offRace && inv.me.joining > 0 ? t('series:invite.joining', { n: seriesNum(inv.me.joining) }) : inviteNext(inv)} />}
        </HomeCard>
    );
}

/**
 * Home while a round is on and you're not in it (or between rounds, when you
 * weren't in the last one): the round to join, in the same layout. Racing ·
 * days left · days for the Draw, a line that joining late costs nothing, and
 * the one gold JOIN.
 */
function JoinCard({ coming: c, join, now, onJoin }: { coming: SeriesComing; join: JoinRound; now: number; onJoin: () => void }) {
    const { t } = useTranslation();
    const running = c.phase === 'running';
    const { days, day } = roundDays(join, now);
    const left = Math.max(1, days - day + 1);
    const date = seriesDate(new Date(join.startsAt).toISOString());
    const items: HomeStat[] = running
        ? [
            ...(c.racing ? [{ value: seriesNum(c.racing), label: t('series:join.racing') }] : []),
            { value: seriesNum(left), label: t('series:join.daysLeft', { count: left }) },
            { value: `${join.need}`, label: t('series:homeCards.drawDays') },
        ]
        : [
            { value: countdown(join.startsAt - now), label: t('series:homeCards.toRound', { round: join.name }) },
            { value: `${days}`, label: t('series:homeCards.roundDays') },
            { value: `${join.need}`, label: t('series:homeCards.drawDays') },
        ];
    const dress = useSeriesDress(
        c.season,
        running ? t('series:join.onNowShort', { round: join.name, day, days }) : t('series:homeCards.roundStarts', { round: join.name, date }),
    );
    return (
        <HomeCard
            {...dress}
            title={`${c.season} · ${join.name}`}
            onPress={() => openLeague('join')}
            label={t('series:homeCards.a11y', { season: c.season, stats: items.map((x) => `${x.value} ${x.label}`).join('. ') })}
            action={{ icon: 'flag-outline', label: t('series:join.button'), primary: true, onPress: onJoin }}
        >
            <HomeStats items={items} />
            {running && <HomeNote icon="time-outline" lead={t('series:join.lateLead')} text={t('series:join.lateNote', { date })} />}
        </HomeCard>
    );
}

/* ── Since you last looked ───────────────────────────────────────────── */

/** What Home remembers between visits (live). */
export type Seen = { slug: string; at: number; rank: number; points: number; logged: number; need: number; around: Around[] };

const SEEN_KEY = '@powr/series_seen_v1';
/** Away at least this long before Home says what changed. */
const AWAY_MS = 3 * 3_600_000;

/** "SINCE 09:14" today, "SINCE YESTERDAY", else "SINCE TUE". */
export function sinceLabel(at: number, now: number): string {
    if (dateKey(at) === dateKey(now)) return i18n.t('series:homeCards.sinceTime', { time: timeOf(at) });
    if (dateKey(at) === dateKey(now - 86_400_000)) return i18n.t('series:homeCards.sinceYesterday');
    const day = new Date(at).toLocaleDateString(getFormatLocale(), { weekday: 'short', timeZone: LON }).toUpperCase();
    return i18n.t('series:homeCards.sinceDay', { day });
}

/**
 * What changed between two looks at the board, in up to three lines: places,
 * who you passed and who passed you (only people the board showed both times,
 * so it never guesses), the Draw, then where your rival stands.
 */
export function sinceLines(seen: Seen, t: SeriesToday): RecapLine[] {
    const lines: RecapLine[] = [];
    const names = (xs: Around[]) => {
        const f = xs.map((x) => first(x.name));
        if (f.length === 1) return f[0];
        return f.length === 2
            ? i18n.t('series:homeCards.namesTwo', { a: f[0], b: f[1] })
            : i18n.t('series:homeCards.namesMore', { a: f[0], b: f[1], count: f.length - 2 });
    };
    if (!t.blind) {
        const places = seen.rank - t.rank;
        const rank = seriesNum(t.rank);
        if (places > 0) lines.push({ icon: 'caret-up', tone: 'green', text: i18n.t('series:homeCards.up', { count: places, n: seriesNum(places), rank }) });
        else if (places < 0) lines.push({ icon: 'caret-down', tone: 'red', text: i18n.t('series:homeCards.down', { count: -places, n: seriesNum(-places), rank }) });
        const now = new Map(t.around.map((a) => [a.id, a.pts]));
        const passed = seen.around.filter((a) => a.pts > seen.points && (now.get(a.id) ?? Infinity) < t.points);
        const passedYou = seen.around.filter((a) => a.pts < seen.points && (now.get(a.id) ?? -Infinity) > t.points);
        if (passed.length) lines.push({ icon: 'trending-up-outline', tone: 'muted', text: i18n.t('series:homeCards.youPassed', { names: names(passed) }) });
        if (passedYou.length) {
            lines.push({ icon: 'trending-down-outline', tone: 'muted', text: i18n.t('series:homeCards.passedYou', { count: passedYou.length, names: names(passedYou) }) });
        }
    }
    if (seen.logged < seen.need && t.draw.logged >= t.draw.need) lines.push({ icon: 'ticket-outline', tone: 'gold', text: i18n.t('series:homeCards.inDraw') });
    if (!lines.length) return lines;
    const r = t.rival;
    if (r && !t.blind && lines.length < 3) {
        const gap = { count: r.gap, n: seriesNum(r.gap), name: first(r.p.name) };
        lines.push({
            icon: 'locate-outline', tone: 'muted',
            text: r.ahead ? i18n.t('series:homeCards.rivalBehind', gap) : i18n.t('series:homeCards.rivalAhead', gap),
        });
    }
    return lines.slice(0, 3);
}

/* The sample's card, shown until dismissed; the sim's SINCE YESTERDAY chip brings it back. */
let sinceHidden = false;
const sinceListeners = new Set<() => void>();
export const sinceSim = {
    show() { sinceHidden = false; sinceListeners.forEach((l) => l()); },
    hide() { sinceHidden = true; sinceListeners.forEach((l) => l()); },
};
const useSinceHidden = () => useSyncExternalStore(
    (l) => { sinceListeners.add(l); return () => { sinceListeners.delete(l); }; },
    () => sinceHidden,
);

/**
 * Live: compares the board with the last look (kept on the device), once each
 * time Home comes into view, then remembers this look. Shown only after three
 * hours away and only when something changed.
 */
function useLiveSince(t: SeriesToday | null): { label: string; lines: RecapLine[] } | null {
    const focused = useIsFocused();
    const live = t?.source === 'live' ? t : null;
    const [since, setSince] = useState<{ label: string; lines: RecapLine[] } | null>(null);
    const checked = useRef(false);
    useEffect(() => {
        if (!focused) checked.current = false;
    }, [focused]);
    useEffect(() => {
        if (!live || !focused) return undefined;
        let gone = false;
        const look: Seen = {
            slug: live.slug, at: Date.now(), rank: live.rank, points: live.points,
            logged: live.draw.logged, need: live.draw.need, around: live.around,
        };
        void (async () => {
            if (!checked.current) {
                checked.current = true;
                try {
                    const raw = await AsyncStorage.getItem(SEEN_KEY);
                    const seen = raw ? (JSON.parse(raw) as Seen) : null;
                    const lines = seen && seen.slug === live.slug && look.at - seen.at >= AWAY_MS ? sinceLines(seen, live) : [];
                    if (!gone) setSince(lines.length && seen ? { label: sinceLabel(seen.at, look.at), lines } : null);
                } catch {
                    if (!gone) setSince(null);
                }
            }
            await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(look)).catch(() => {});
        })();
        return () => { gone = true; };
    }, [live?.slug, live?.rank, live?.points, live?.draw.logged, focused]); // eslint-disable-line react-hooks/exhaustive-deps
    return since;
}

/** Under the top line on the first look after a while: what changed, no tap needed to find out. */
export function SeriesSinceCard({ today }: { today: SeriesToday }) {
    const { t } = useTranslation();
    const sc = useSeasonCard();
    const liveSince = useLiveSince(today);
    const hidden = useSinceHidden();
    const [closed, setClosed] = useState<string | null>(null);
    const since = today.source === 'sample'
        ? (hidden || !today.news?.length ? null : { label: t('series:homeCards.sinceYesterday'), lines: today.news.slice(0, 3) })
        : liveSince;
    if (!since || closed === since.label + since.lines.map((l) => l.text).join()) return null;
    const close = () => {
        void Haptics.selectionAsync();
        if (today.source === 'sample') sinceSim.hide();
        else setClosed(since.label + since.lines.map((l) => l.text).join());
    };
    // The lines open the League; the × sits beside them, not inside the button (web can't nest buttons).
    return (
        <View style={[s.since, sc]}>
            <View style={s.sinceHead}>
                <Text style={s.kicker}>{since.label}</Text>
                <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('series:homeCards.dismiss')}>
                    <Ionicons name="close" size={15} color={TEXT_3} />
                </Pressable>
            </View>
            <Pressable
                onPress={() => openLeague('since')}
                style={({ pressed }) => [s.sinceBody, pressed && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityLabel={t('series:homeCards.sinceA11y', { label: since.label.toLowerCase(), lines: since.lines.map((l) => l.text).join('. ') })}
            >
                {since.lines.map((l) => {
                    const c = l.tone === 'green' ? GREEN : l.tone === 'red' ? RED : l.tone === 'gold' ? GOLD : TEXT_3;
                    return (
                        <View key={l.text} style={s.sinceRow}>
                            <View style={[s.sinceIcon, { borderColor: `${c.startsWith('#') ? c : '#8a8a8a'}66` }]}>
                                <Ionicons name={l.icon as IconName} size={11} color={c} />
                            </View>
                            <Text style={[s.sinceText, l.tone === 'gold' && { color: GOLD }]} numberOfLines={1}>{l.text}</Text>
                        </View>
                    );
                })}
            </Pressable>
        </View>
    );
}

/* ── What you're playing for ─────────────────────────────────────────── */

/** Where you stand on each prize, for the prizes sheet Home opens. */
export function seriesPrizeState(t: SeriesToday): PrizeState {
    return {
        day: t.day, logged: t.draw.logged, tickets: 0, ticketLog: [], rank: t.rank, total: t.total, blind: t.blind,
        golden: null, race: {}, cityPos: null, cityName: t.cityName, event: null,
        prizes: t.prizes, live: t.source === 'live', need: t.draw.need, drawDots: t.drawDots,
        roundName: t.roundName, prizesOn: t.prizesOn,
    };
}

/**
 * Under the rival card: the prize most people can win (the Draw) and the one
 * at the top, so the race on Home says what it's for. Opens the prizes sheet.
 * Nothing until the round has prizes.
 */
export function SeriesPrizeRow({ today, onOpen }: { today: SeriesToday; onOpen: () => void }) {
    const { t } = useTranslation();
    const sc = useSeasonCard();
    const P = today.prizes;
    const draw = P.draw;
    const top = P.places[0];
    const main = draw ?? top;
    if (!main) return null;
    const inDraw = today.draw.logged >= today.draw.need;
    const kicker = draw
        ? (inDraw ? t('series:homeCards.prizeDrawIn', { count: draw.winners }) : t('series:homeCards.prizeDraw', { count: draw.winners }))
        : t('series:homeCards.firstPlace');
    const sub = draw && top
        ? t('series:homeCards.firstWins', { prize: top.name })
        : draw
            ? t('series:homeCards.drawn', { when: today.prizesOn })
            : P.places.length > 1 ? t('series:homeCards.podiumToo') : t('series:homeCards.decided', { when: today.prizesOn });
    return (
        <Pressable
            onPress={() => { void Haptics.selectionAsync(); trackTap('series_home_prizes'); onOpen(); }}
            style={({ pressed }) => [kit.card, s.prize, sc, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={t('series:homeCards.prizeA11y', { prize: main.name, sub })}
        >
            {main.img
                ? <Image source={main.img} style={s.prizeImg} contentFit="cover" />
                : <View style={[s.prizeImg, s.thumbIcon]}><Ionicons name={draw ? 'ticket-outline' : 'trophy-outline'} size={20} color={GOLD} /></View>}
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={[s.kicker, inDraw && draw && { color: GREEN }]} numberOfLines={1}>{kicker}</Text>
                <Text style={s.prizeName} numberOfLines={1}>{main.name}</Text>
                <Text style={s.prizeSub} numberOfLines={1}>{sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={TEXT_3} />
        </Pressable>
    );
}

const s = StyleSheet.create({
    kicker: { fontSize: 9, fontWeight: '700', letterSpacing: 1.6, color: GOLD },

    coming: {
        marginBottom: 10, padding: 14, gap: 10,
        borderRadius: 18, borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)', backgroundColor: CARD_BG,
    },
    comingHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    headLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    headLinkText: { fontSize: 12, fontWeight: '600', color: GOLD },
    comingMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    comingTitle: { fontSize: 20, fontWeight: '300', color: TEXT },
    comingSub: { marginTop: 3, fontSize: 12, fontWeight: '300', lineHeight: 16, color: TEXT_2 },
    clock: { alignItems: 'flex-end', minWidth: 70 },
    clockBig: { fontSize: 22, fontWeight: '200', color: TEXT, fontVariant: ['tabular-nums'] },
    clockSmall: { fontSize: 8, fontWeight: '700', letterSpacing: 1.4, color: TEXT_3 },
    comingPrize: {
        flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR,
    },
    thumb: { width: 26, height: 26, borderRadius: 7 },
    thumbIcon: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: CARD_BORDER },
    comingPrizeText: { flex: 1, fontSize: 12, fontWeight: '400', color: TEXT_2 },
    cta: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        height: 36, borderRadius: 18, backgroundColor: GOLD,
    },
    ctaText: { fontSize: 13, fontWeight: '600', color: '#0a0a0a' },

    since: {
        marginBottom: 10, paddingHorizontal: 14, paddingVertical: 12, gap: 8,
        borderRadius: 18, borderWidth: 1, borderColor: CARD_BORDER, backgroundColor: CARD_BG,
    },
    sinceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sinceBody: { gap: 8 },
    sinceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sinceIcon: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    sinceText: { flex: 1, fontSize: 13, fontWeight: '300', color: TEXT },

    prize: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
    prizeImg: { width: 52, height: 52, borderRadius: 12 },
    prizeName: { fontSize: 16, fontWeight: '400', color: TEXT },
    prizeSub: { fontSize: 12, fontWeight: '300', color: TEXT_3 },
});

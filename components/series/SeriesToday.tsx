import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { trackTap } from '@/lib/analytics';
import {
    fetchSeriesMoments, fetchSeriesPrizes, fetchSeriesResults, type SeriesBoard, seriesClock, type SeriesInviteBoard, type SeriesMoment, seriesNum,
    useSeriesBoard, useSeriesEnabled, useSeriesInviteBoard,
} from '@/lib/api/series';
import { DROP_PROTOTYPE, todayTarget, useDropPrototype } from '@/lib/dev/dropPrototype';
import { type HeatInfo, ordinal, type Rival, SERIES_PROTOTYPE, type SeriesState } from '@/lib/dev/seriesPrototype';
import { dropProgress, nextMove } from '@/lib/drop';
import i18n, { getFormatLocale } from '@/lib/i18n';
import { CARD_BG, CARD_BORDER, GOLD, GREEN, RED, TEXT, TEXT_2, TEXT_3 } from './SeriesLane';
import { type PrizeSet, prizeSetFrom, SAMPLE_PRIZES } from './SeriesPrizes';
import { liveMomentCards, MOMENT_ICON, sampleMomentCards } from './SeriesRound';
import { useSeason, useSeasonCard } from './season';
import { fromLive, fromSim } from './seriesView';
import { type TodayMove, todayMove } from './todayMove';
import { type RecapLine, useSeriesSim } from './useSeriesSim';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/*
 * The Series on Home. "Home is about today, League is about the round": every
 * Home card that touches the Series reads this one source, so they all agree
 * with each other and with League.
 *
 * Live: the board (get_series_board), the round's moments
 * (get_series_moments) and prizes while the Series is on for this member
 * (series_live in /admin/series). `today` while a round runs; `coming` before
 * a round and between rounds. Dev builds fall back to the sample sim, so the
 * cards can be judged before a real round (the sim's ROUND chip steps through
 * on / starts soon / just ended). For members the Series is off for, both are
 * null and Home is exactly what it was.
 */

/** The moment that's on now, as Home needs it. */
export type TodayMoment = {
    kind: string;
    name: string;
    what: string;
    icon: IconName;
    /** When it ends (ms), for the countdown; null = no clock. */
    endsAt: number | null;
    multiplier: number;
    /** Double Down: the activities it boosts (null = all). */
    activities: string[] | null;
    /** All In: you're boosted only outside this place. */
    topN: number | null;
};

export type NextMoment = { name: string; when: string; icon: IconName };
/** Someone on the board near you (live), for "since you last looked". */
export type Around = { id: string; name: string; pts: number };

export type SeriesToday = {
    source: 'live' | 'sample';
    season: string;
    /** The round's slug ('sample' for the sample), so a new round never reads as a change. */
    slug: string;
    roundName: string;
    rank: number;
    /** Everyone on the board. */
    total: number;
    /** Places since midnight (+ = up). */
    move: number;
    /** Your heat, when it's what leads (sample only so far): Home shows that place instead. */
    heat: HeatInfo | null;
    blind: boolean;
    day: number;
    days: number;
    draw: { logged: number; need: number; todayLogged: boolean };
    /** Which of the round's days you've logged, for the Draw. */
    drawDots: boolean[];
    /** "on Mon 30 Nov" */
    prizesOn: string;
    /** Your Series points in the round, and today. */
    points: number;
    pointsToday: number;
    rival: Rival | null;
    moment: TodayMoment | null;
    /** The next moment still to come (not the one that's on). */
    nextMoment: NextMoment | null;
    /** Live: the people the board shows around you; sample: none (it has `news`). */
    around: Around[];
    /** Sample: what changed since yesterday, the sim's own lines. */
    news: RecapLine[] | null;
    cityName: string | null;
    prizes: PrizeSet;
    /** Series points `minutes` of walking or training would earn now (the sample's own maths; live, an estimate). */
    gainFor: (minutes: number, route: 'steps' | 'minutes') => number;
};

/** Before a round, and between rounds: what's coming, and how the last one went. */
export type SeriesComing = {
    source: 'live' | 'sample';
    phase: 'upcoming' | 'between';
    season: string;
    /** The round that's coming (upcoming) or just finished (between). */
    roundName: string;
    /** The round to come and when it starts (ms); null when none is planned. */
    next: { name: string; startsAt: number } | null;
    /** Between rounds: where you finished. */
    finish: { rank: number; total: number; inDraw: boolean } | null;
    days: number;
    need: number;
    /** You still have a city to pick. */
    cityPick: boolean;
    cityName: string | null;
    /** The coming round's prizes. */
    prizes: PrizeSet;
    /** The finished round's winners are out. */
    winners: boolean;
    /** Before the round, while its invite period is on: the invite race. */
    invite: SeriesInviteBoard | null;
};

export type SeriesHome = { today: SeriesToday | null; coming: SeriesComing | null };

/** The round's moments, re-read every minute while Home is in view. */
function useMoments(slug: string | null, active: boolean): SeriesMoment[] {
    const [moments, setMoments] = useState<SeriesMoment[]>([]);
    useEffect(() => {
        if (!slug || !active) return undefined;
        let live = true;
        const read = () => { void fetchSeriesMoments(slug).then((m) => { if (live) setMoments(m); }); };
        read();
        const t = setInterval(read, 60_000);
        return () => { live = false; clearInterval(t); };
    }, [slug, active]);
    return moments;
}

const NO_PRIZES = prizeSetFrom([]);

/** A round's prizes from /admin/series, read once per round. */
function usePrizes(slug: string | null): PrizeSet {
    const [got, setGot] = useState<{ slug: string; prizes: PrizeSet } | null>(null);
    useEffect(() => {
        if (!slug) return undefined;
        let live = true;
        void fetchSeriesPrizes(slug).then((rows) => { if (live) setGot({ slug, prizes: prizeSetFrom(rows) }); });
        return () => { live = false; };
    }, [slug]);
    return got && got.slug === slug ? got.prizes : NO_PRIZES;
}

/** Whether a finished round's winners have been announced. */
function useWinnersOut(slug: string | null): boolean {
    const [out, setOut] = useState<string | null>(null);
    useEffect(() => {
        if (!slug) return undefined;
        let live = true;
        void fetchSeriesResults().then((r) => { if (live) setOut(r?.round.slug ?? null); });
        return () => { live = false; };
    }, [slug]);
    return !!slug && out === slug;
}

/** The live moment to show: Blind Mode first (it changes what you can see), else the biggest boost. */
function liveMoment(moments: SeriesMoment[], now: number): TodayMoment | null {
    const on = moments.filter((m) => m.kind !== 'secret' && m.starts_at && m.ends_at
        && now >= new Date(m.starts_at).getTime() && now < new Date(m.ends_at).getTime());
    if (!on.length) return null;
    const m = on.find((x) => x.kind === 'blind') ?? [...on].sort((a, b) => (b.multiplier ?? 1) - (a.multiplier ?? 1))[0];
    return {
        kind: m.kind, name: m.name ?? '', what: m.line ?? '', icon: MOMENT_ICON[m.kind] ?? 'flash-outline',
        endsAt: m.ends_at ? new Date(m.ends_at).getTime() : null,
        multiplier: m.multiplier ?? 1, activities: m.activities ?? null, topN: m.top_n ?? null,
    };
}

const titleCase = (x: string) => x.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** The next moment to come: the next announced one, else "a secret one" while one is still sealed. */
export function liveNextMoment(moments: SeriesMoment[], now: number): NextMoment | null {
    const cards = liveMomentCards(moments, now);
    const i = cards.findIndex((c) => c.state === 'next');
    if (i >= 0) return { name: moments[i].name || titleCase(cards[i].name), when: cards[i].soon ?? cards[i].when, icon: cards[i].icon };
    return cards.some((c) => c.secret)
        ? { name: i18n.t('series:today.secretMoment'), when: i18n.t('series:today.thisRound'), icon: 'help-outline' }
        : null;
}

function sampleNextMoment(day: number): NextMoment | null {
    const c = sampleMomentCards(day).find((x) => x.state === 'next');
    return c ? { name: titleCase(c.name), when: c.when, icon: c.icon } : null;
}

/** The sample's moment for each calendar state (dev only). */
function sampleMoment(state: SeriesState, now: number): TodayMoment | null {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const base = { activities: null, topN: null };
    switch (state) {
        case 'doubleDown':
            return { ...base, kind: 'double_down', name: 'Double Down', what: 'Runs count 2× today', icon: 'flash-outline', endsAt: midnight.getTime(), multiplier: 2, activities: ['running'] };
        case 'eventNight':
            return { ...base, kind: 'event_night', name: 'Event night', what: '×2 Series points if you check in at ONE LDN', icon: 'location-outline', endsAt: midnight.getTime(), multiplier: 2 };
        case 'powerHour':
            return { ...base, kind: 'power_hour', name: 'Power Hour', what: 'Every session counts 2×', icon: 'timer-outline', endsAt: now + 41 * 60_000, multiplier: 2 };
        case 'blind':
            return { ...base, kind: 'blind', name: 'Blind Mode', what: 'Every rank is hidden. Keep moving.', icon: 'eye-off-outline', endsAt: midnight.getTime() + 36 * 3_600_000, multiplier: 1 };
        case 'allIn':
            return { ...base, kind: 'all_in', name: 'All In', what: '×1.5 for everyone outside the top 10', icon: 'flame-outline', endsAt: midnight.getTime() + 24 * 3_600_000, multiplier: 1.5, topN: 10 };
        default:
            return null;
    }
}

/** The live board before a round or between rounds, as Home's card needs it. */
export function liveComing(b: SeriesBoard, season: string, prizes: PrizeSet, winners: boolean, invite: SeriesInviteBoard | null = null): SeriesComing | null {
    if (b.state === 'running') return null;
    const r = b.round;
    const base = {
        source: 'live' as const, season, roundName: r.name, days: r.days, need: r.draw_days,
        cityPick: !!b.city?.options?.length && !b.city?.you, cityName: b.city?.you?.name ?? null, prizes,
    };
    if (b.state === 'upcoming') {
        return {
            ...base, phase: 'upcoming', next: { name: r.name, startsAt: Date.parse(r.starts_at) }, finish: null, winners: false,
            invite: invite?.open ? invite : null,
        };
    }
    return {
        ...base, phase: 'between', winners, invite: null,
        next: b.next ? { name: b.next.name, startsAt: Date.parse(b.next.starts_at) } : null,
        finish: b.me ? { rank: b.me.rank, total: b.total, inDraw: b.me.days.length >= r.draw_days } : null,
    };
}

/** Dev: the sample's "starts soon" and "just ended", for judging the cards before a real round. */
function sampleComing(phase: 'soon' | 'ended', season: string, now: number, invite: SeriesInviteBoard | null): SeriesComing {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const base = { source: 'sample' as const, season, days: 15, need: 10, cityPick: false, cityName: 'London', prizes: SAMPLE_PRIZES };
    return phase === 'soon'
        ? { ...base, phase: 'upcoming', roundName: 'Round 01', next: { name: 'Round 01', startsAt: midnight.getTime() + 2 * 86_400_000 }, finish: null, winners: false, invite }
        : { ...base, phase: 'between', roundName: 'Round 01', next: { name: 'Round 02', startsAt: midnight.getTime() + 86_400_000 }, finish: { rank: 298, total: 5000, inDraw: true }, winners: true, invite: null };
}

/**
 * Home's one Series source. `refreshKey`: change it to read the board again
 * now (Home bumps it when a session ends, so the payoff shows straight away).
 */
export function useSeriesHome(refreshKey?: number): SeriesHome {
    const focused = useIsFocused();
    const seriesOn = useSeriesEnabled();
    const enabled = SERIES_PROTOTYPE || seriesOn;
    const { def } = useSeason();
    const live = useSeriesBoard(focused && enabled);
    const { refresh } = live;
    useEffect(() => {
        if (refreshKey && enabled) void refresh();
    }, [refreshKey, enabled, refresh]);
    const b = live.board;
    const base = b ? fromLive(b, def.name) : null;
    const running = b?.state === 'running' && !!base;
    const moments = useMoments(running && b ? b.round.slug : null, focused && enabled);
    const sim = useSeriesSim(focused && SERIES_PROTOTYPE && !running);
    // The coming round's prizes: this round's while it runs, else the next one's.
    const prizeSlug = !enabled || !b ? null : b.state === 'ended' ? (b.next?.slug ?? b.round.slug) : b.round.slug;
    const livePrizes = usePrizes(prizeSlug);
    const winners = useWinnersOut(enabled && b?.state === 'ended' ? b.round.slug : null);
    // Before a round: the invite race, once its invite period is on.
    const invite = useSeriesInviteBoard(focused && enabled && b?.state === 'upcoming');
    // Moments start and end on the clock, not on a fetch: look again every 30 seconds.
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!focused || !enabled) return undefined;
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
    }, [focused, enabled]);
    // The sample's Power Hour clock starts when its state does, not on every tick.
    const sampleAt = useMemo(() => Date.now(), [sim.state]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!enabled) return { today: null, coming: null };
    if (running && b && base) {
        const moment = liveMoment(moments, now);
        const v = moment?.kind === 'blind' ? fromLive(b, def.name, true) ?? base : base;
        return {
            coming: null,
            today: {
                source: 'live', season: def.name, slug: b.round.slug, roundName: v.round.name,
                rank: v.hero.rank, total: v.hero.total, move: v.hero.move, heat: null, blind: v.hero.blind,
                day: v.hero.day, days: v.round.days,
                draw: { logged: v.hero.logged, need: v.hero.need, todayLogged: !!v.hero.days[v.hero.day - 1] },
                drawDots: v.hero.days, prizesOn: v.round.prizesOn,
                points: b.me?.points ?? 0, pointsToday: v.hero.today,
                rival: v.rival, moment, nextMoment: liveNextMoment(moments, now),
                around: b.rows.filter((r) => !r.you).map((r) => ({ id: r.user_id, name: r.name, pts: r.points })),
                news: null, cityName: v.city?.name ?? b.city?.you?.name ?? null, prizes: livePrizes,
                // The same rough sizes the live rival line uses (lib/api/series seriesHow:
                // a run ≈ 10 pts), walking at half that, times a boost that covers you.
                gainFor: (minutes, route) => {
                    const boost = moment && moment.multiplier > 1 && !(moment.topN != null && v.hero.rank <= moment.topN)
                        && (moment.kind !== 'double_down' || !moment.activities?.length
                            || moment.activities.includes(route === 'steps' ? 'walking' : 'running'))
                        ? moment.multiplier : 1;
                    return Math.round((route === 'steps' ? minutes / 6 : minutes / 3) * boost);
                },
            },
        };
    }
    if (SERIES_PROTOTYPE && sim.inRound) {
        const v = fromSim(sim, def.name);
        return {
            coming: null,
            today: {
                source: 'sample', season: def.name, slug: 'sample', roundName: v.round.name,
                rank: v.hero.rank, total: v.hero.total, move: v.hero.move,
                heat: v.headline === 'heat' ? v.heat : null, blind: v.hero.blind,
                day: v.hero.day, days: v.round.days,
                draw: { logged: v.hero.logged, need: v.hero.need, todayLogged: !!v.hero.days[v.hero.day - 1] },
                drawDots: v.hero.days, prizesOn: v.round.prizesOn,
                points: v.rival?.mePts ?? 0, pointsToday: v.hero.today,
                rival: v.rival, moment: sampleMoment(sim.state, sampleAt), nextMoment: sampleNextMoment(v.hero.day),
                around: [], news: sim.news, cityName: v.city?.name ?? null, prizes: SAMPLE_PRIZES,
                gainFor: sim.gainFor,
            },
        };
    }
    // Dev, round switched off in the sim: the live board if it's in that phase, else the sample's.
    if (SERIES_PROTOTYPE) {
        const want = sim.offPhase === 'soon' ? 'upcoming' : 'ended';
        return {
            today: null,
            coming: b && b.state === want
                ? liveComing(b, def.name, livePrizes, winners, invite)
                : sampleComing(sim.offPhase, def.name, now, sim.offPhase === 'soon' ? sim.inviteBoard : null),
        };
    }
    return { today: null, coming: b ? liveComing(b, def.name, livePrizes, winners, invite) : null };
}

/* ── What each Home card takes from it ───────────────────────────────── */

/** A boost's multiplier as the member reads it: "2", "1.5" ("1,5" in French). */
const times = (x: number) => Number(x.toFixed(2)).toLocaleString(getFormatLocale());

/** Does the moment boost you (All In skips the top N)? */
const boostsYou = (t: SeriesToday) => !!t.moment && t.moment.multiplier > 1 && !(t.moment.topN != null && t.rank <= t.moment.topN);

/**
 * The ×2 badge on the activity rings, only when a boost picks some activities
 * (a Double Down on runs). A boost on everything (Power Hour, All In) is said
 * once, by the banner: gold on every ring would mean nothing.
 */
export function seriesRingBoosts(t: SeriesToday | null): Partial<Record<string, string>> | undefined {
    const m = t?.moment;
    if (!t || !m || m.kind !== 'double_down' || !m.activities?.length || !boostsYou(t)) return undefined;
    const x = `×${times(m.multiplier)}`;
    return Object.fromEntries(m.activities.map((a) => [a, x]));
}

export type DrawTone = 'done' | 'act' | 'warn' | 'calm' | 'out';
/**
 * The Draw, under the streak, said as what's at stake today: in already; not
 * logged today (and whether today is the last day you can miss); or how many
 * days you can still miss.
 */
export function seriesDrawChip(t: SeriesToday | null): { text: string; tone: DrawTone } | undefined {
    if (!t) return undefined;
    const { logged, need, todayLogged } = t.draw;
    if (logged >= need) return { text: i18n.t('series:today.chipIn'), tone: 'done' };
    const short = need - logged;
    // Days still to come, today included unless it's already logged.
    const left = t.days - t.day + (todayLogged ? 0 : 1);
    const spare = left - short;
    if (spare < 0) return { text: i18n.t('series:today.chipOut'), tone: 'out' };
    if (!todayLogged) {
        return spare === 0
            ? { text: i18n.t('series:today.chipMoveToday'), tone: 'warn' }
            : { text: i18n.t('series:today.chipNotLogged'), tone: 'act' };
    }
    return { text: i18n.t('series:today.chipSpare', { logged, need, spare }), tone: 'calm' };
}

/**
 * Home's one next move while today's Drop (dev) is still sealed: the Drop's
 * quicker route, and whether it also passes your rival. Null once the Drop is
 * open, or with no Drop (release): the move is then your rival's gap.
 * The top line and the rival card both read this, so they say the same thing.
 */
export function useDropMove(t: SeriesToday | null): TodayMove | null {
    const drop = useDropPrototype();
    if (!t || !DROP_PROTOTYPE || drop.opened) return null;
    const target = todayTarget(drop);
    if (dropProgress(target, drop.steps, drop.minutes) >= 1) return null;
    const move = nextMove(target, drop.steps, drop.minutes);
    const rival = t.rival && t.blind ? { ...t.rival, sealed: true } : t.rival;
    return todayMove(move, rival, t.gainFor(move.minutes, move.route));
}

/**
 * The one thing to do, for the top line: your rival's gap as an action. Blind
 * Mode names nobody; at #1 it's about staying clear.
 */
export function seriesNextMove(t: SeriesToday, drop: TodayMove | null = null): string {
    // The Drop's route is dev-only (DROP_PROTOTYPE), so it stays in English.
    if (drop) return drop.passes ? `${drop.head} passes ${drop.who}` : `${drop.head} opens your Drop`;
    const r = t.rival;
    if (t.blind) return i18n.t('series:today.moveBlind');
    // No points yet: a rank among everyone tied on zero means nothing.
    if (t.points === 0) return i18n.t('series:today.moveFirst');
    if (!r) return i18n.t('series:today.moveClimb');
    const first = r.p.name.split(' ')[0];
    if (r.ahead) return i18n.t('series:today.moveStayClear', { name: first });
    // The live line is one of seriesHow's, in the language on screen: say it as the pass.
    if (r.how === i18n.t('series:api.howRun')) return i18n.t('series:today.moveOneRun', { name: first });
    if (r.how === i18n.t('series:api.howGym')) return i18n.t('series:today.moveOneGym', { name: first });
    const sessions = Number(r.how.match(/\d+/)?.[0]);
    if (sessions && r.how === i18n.t('series:api.howSessions', { count: sessions })) {
        return i18n.t('series:today.moveSessions', { count: sessions, name: first });
    }
    // The sample's own lines (dev only), in English.
    const how = r.how
        .replace(/^About (\d+) walks to pass$/, 'About $1 walks')
        .replace(/ does it$/, '')
        .replace(/ do it$/, '');
    const plural = /^About \d+/.test(how);
    return `${how} ${plural ? 'pass' : 'passes'} ${first}`;
}

/** During a gym visit: what it's worth in the Series, against your rival. */
export function seriesSessionLine(t: SeriesToday | null, visitPts: number): string | undefined {
    if (!t || visitPts <= 0) return undefined;
    const m = t.moment;
    const boosted = m && boostsYou(t) && (m.kind === 'power_hour' || m.kind === 'all_in'
        || (m.kind === 'double_down' && (!m.activities?.length || m.activities.includes('gym'))));
    const pts = Math.round(visitPts * (boosted ? m!.multiplier : 1));
    const head = boosted
        ? i18n.t('series:today.visitBoost', { n: seriesNum(pts), moment: m!.name, x: times(m!.multiplier) })
        : i18n.t('series:today.visit', { n: seriesNum(pts) });
    const r = t.rival;
    if (!r || t.blind) return head;
    const first = r.p.name.split(' ')[0];
    if (r.ahead) return i18n.t('series:today.visitClear', { head, name: first });
    return pts > r.gap
        ? i18n.t('series:today.visitPass', { head, name: first })
        : i18n.t('series:today.visitShort', { head, n: seriesNum(r.gap - pts + 1), name: first });
}

/* ── The top of Home ─────────────────────────────────────────────────── */

const openLeague = (what: string) => {
    void Haptics.selectionAsync();
    trackTap('series_home_open', { from: what });
    router.push('/(tabs)/league');
};

/** One line above the streak: your place, and the one move that changes it. */
export function SeriesTopLine({ today }: { today: SeriesToday }) {
    const { t } = useTranslation();
    const sc = useSeasonCard();
    // With heats, Home leads with your place in your heat, like the League card.
    const h = today.heat;
    const places = h ? h.move : today.move;
    const up = places > 0;
    const move = seriesNextMove(today, useDropMove(today));
    const unranked = today.points === 0 && !today.blind;
    return (
        <Pressable
            onPress={() => openLeague('line')}
            style={({ pressed }) => [s.row, sc, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel={t('series:today.topA11y', {
                season: today.season,
                place: today.blind
                    ? t('series:today.rankHiddenA11y')
                    : unranked ? t('series:today.notRankedA11y') : h ? `${ordinal(h.rank)} in your heat` : t('series:today.numberA11y', { rank: today.rank }),
                move,
            })}
        >
            <View style={s.dot} />
            {unranked
                ? <Text style={s.unranked}>{t('series:today.notRanked')}</Text>
                : <Text style={s.rank}>{today.blind ? '#?' : h ? ordinal(h.rank) : `#${seriesNum(today.rank)}`}</Text>}
            {h && !today.blind && !unranked && <Text style={s.unranked}>IN HEAT</Text>}
            {!today.blind && !unranked && places !== 0 && (
                <Text style={[s.move, { color: up ? GREEN : RED }]}>{up ? '▲' : '▼'} {Math.abs(places)}</Text>
            )}
            <View style={s.rule} />
            <Text style={s.line} numberOfLines={1}>{move}</Text>
            <Ionicons name="chevron-forward" size={14} color={TEXT_3} />
        </Pressable>
    );
}

/** What your last points did, for the moment they land: +22 Series pts · ▲12 · passed Arjun. */
export type Payoff = { pts: number; places: number; passed: string | null; blind: boolean };

/**
 * Watches your Series points: when they go up (a session landing, the board's
 * minute poll, or Home's refresh after a session), returns the payoff for six
 * seconds. Never on first sight, a new round, or the midnight reset.
 */
export function useSeriesPayoff(t: SeriesToday | null): Payoff | null {
    const prev = useRef<{ slug: string; pts: number; rank: number; rival: string | null; chasing: boolean } | null>(null);
    const [payoff, setPayoff] = useState<Payoff | null>(null);
    const rival = t?.rival ?? null;
    useEffect(() => {
        if (!t) { prev.current = null; return undefined; }
        const p = prev.current;
        prev.current = { slug: t.slug, pts: t.pointsToday, rank: t.rank, rival: rival?.p.name ?? null, chasing: !!rival && !rival.ahead };
        if (!p || p.slug !== t.slug || t.pointsToday <= p.pts) return undefined;
        const passed = p.chasing && p.rival && p.rival !== rival?.p.name ? p.rival.split(' ')[0] : null;
        setPayoff({ pts: t.pointsToday - p.pts, places: p.rank - t.rank, passed, blind: t.blind });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const tm = setTimeout(() => setPayoff(null), 6000);
        return () => clearTimeout(tm);
    }, [t?.slug, t?.pointsToday, t?.rank, rival?.p.name]); // eslint-disable-line react-hooks/exhaustive-deps
    return payoff;
}

/** The payoff, said in the top line's place. */
export function payoffLine(p: Payoff): string {
    const bits = [i18n.t('series:today.payoffPts', { n: seriesNum(p.pts) })];
    if (p.blind) bits.push(i18n.t('series:today.payoffDark'));
    else {
        if (p.places > 0) bits.push(i18n.t('series:today.payoffUp', { count: p.places, n: seriesNum(p.places) }));
        if (p.passed) bits.push(i18n.t('series:today.payoffPassed', { name: p.passed }));
    }
    return bits.join(' · ');
}

/**
 * The top of Home during a round, only when it can't wait: the payoff for a
 * few seconds after points land, else a moment that's on. Otherwise nothing:
 * Home opens on your streak, and your place lives in the Series block below.
 */
export function SeriesAlert({ today }: { today: SeriesToday }) {
    const { t } = useTranslation();
    const payoff = useSeriesPayoff(today);
    const sc = useSeasonCard();
    if (payoff) {
        return (
            <Pressable
                onPress={() => openLeague('payoff')}
                style={({ pressed }) => [s.row, sc, s.rowLit, pressed && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityLabel={t('series:today.opensLeague', { text: payoffLine(payoff) })}
                accessibilityLiveRegion="polite"
            >
                <Ionicons name="trending-up" size={15} color={GOLD} />
                {!payoff.blind && <Text style={s.rank}>#{seriesNum(today.rank)}</Text>}
                <View style={s.rule} />
                <Text style={[s.line, { color: GOLD }]} numberOfLines={1}>{payoffLine(payoff)}</Text>
            </Pressable>
        );
    }
    return today.moment ? <MomentBanner today={today} /> : null;
}

/** "41:20" under an hour, "3h 12m" under a day, else the day it ends (`until`). */
function clockTo(endsAt: number, now: number): { big: string; small: string; until: boolean } {
    const ms = Math.max(0, endsAt - now);
    if (ms < 3_600_000) {
        const mm = Math.floor(ms / 60_000);
        const ss = Math.floor((ms % 60_000) / 1000);
        return { big: `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, small: i18n.t('series:today.left'), until: false };
    }
    if (ms < 86_400_000) {
        return { big: seriesClock(0, Math.floor(ms / 3_600_000), Math.floor((ms % 3_600_000) / 60_000)), small: i18n.t('series:today.left'), until: false };
    }
    return {
        big: new Date(endsAt).toLocaleDateString(getFormatLocale(), { weekday: 'short', timeZone: 'Europe/London' }),
        small: i18n.t('series:today.until'),
        until: true,
    };
}

/** While a moment is on, it takes the top line's place: what it is and how long it has. */
export function MomentBanner({ today }: { today: SeriesToday }) {
    const { t } = useTranslation();
    const sc = useSeasonCard(true);
    const m = today.moment!;
    const [now, setNow] = useState(Date.now());
    const near = m.endsAt != null && m.endsAt - now < 3_600_000;
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), near ? 1000 : 30_000);
        return () => clearInterval(t);
    }, [near]);
    const blind = m.kind === 'blind';
    const clock = m.endsAt ? clockTo(m.endsAt, now) : null;
    const missesOut = m.topN != null && today.rank <= m.topN;
    return (
        <Pressable
            onPress={() => openLeague(`moment_${m.kind}`)}
            style={({ pressed }) => [s.banner, sc, !blind && s.bannerLive, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={t('series:today.momentA11y', { name: m.name, what: m.what, clock: clock ? `${clock.big} ${clock.small.toLowerCase()}` : '' })}
        >
            <View style={[s.bIcon, blind && s.bIconBlind]}>
                <Ionicons name={m.icon} size={17} color={blind ? TEXT : '#0a0a0a'} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.bName, blind && { color: TEXT_2 }]} numberOfLines={1}>
                    {m.name.toUpperCase()}{m.multiplier > 1 ? ` · ×${times(m.multiplier)}` : ''}
                </Text>
                <Text style={s.bWhat} numberOfLines={2}>
                    {missesOut ? t('series:today.topHold', { n: m.topN }) : m.what}
                </Text>
            </View>
            {clock && (
                <View style={s.bClock}>
                    <Text style={s.bClockBig}>{blind ? clock.big.replace('LEFT', '') : clock.big}</Text>
                    <Text style={s.bClockSmall}>{blind ? (clock.until ? t('series:today.ranksBack') : t('series:today.tillRanks')) : clock.small}</Text>
                </View>
            )}
        </Pressable>
    );
}

const s = StyleSheet.create({
    row: {
        marginBottom: 10, height: 40, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9,
        borderRadius: 20, borderWidth: 1, borderColor: CARD_BORDER, backgroundColor: CARD_BG,
    },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
    rank: { fontSize: 14, fontWeight: '500', color: GOLD, fontVariant: ['tabular-nums'] },
    move: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
    unranked: { fontSize: 9, fontWeight: '700', letterSpacing: 1.4, color: TEXT_3 },
    rule: { width: StyleSheet.hairlineWidth, height: 14, backgroundColor: 'rgba(255,255,255,0.2)' },
    line: { flex: 1, fontSize: 13, fontWeight: '400', color: TEXT },
    rowLit: { borderColor: 'rgba(232,210,0,0.5)', backgroundColor: 'rgba(232,210,0,0.07)' },

    banner: {
        marginBottom: 10, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
        borderRadius: 18, borderWidth: 1, borderColor: CARD_BORDER, backgroundColor: CARD_BG,
    },
    bannerLive: { borderColor: 'rgba(232,210,0,0.45)' },
    bIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
    bIconBlind: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
    bName: { fontSize: 10, fontWeight: '700', letterSpacing: 1.6, color: GOLD },
    bWhat: { marginTop: 2, fontSize: 13, fontWeight: '300', lineHeight: 17, color: TEXT },
    bClock: { alignItems: 'flex-end', minWidth: 58 },
    bClockBig: { fontSize: 20, fontWeight: '200', color: TEXT, fontVariant: ['tabular-nums'] },
    bClockSmall: { fontSize: 8, fontWeight: '700', letterSpacing: 1.4, color: TEXT_3 },
});

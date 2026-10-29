import type { Honour } from '@/constants/honours';
import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { type SeriesBoard, type SeriesCity, seriesDate, seriesHow, timeLeft } from '@/lib/api/series';
import {
    BLIND_HIDES,
    type Board,
    CITY_MIN_CITIES,
    CITY_MIN_MEMBERS,
    type DailyTitle,
    DRAW_NEEDED,
    drawDays,
    type DuelResult,
    GYM_MIN,
    gamesOpen,
    gymSessionPts,
    type LensKey,
    NEXT_ROUND,
    type Person,
    type Rival,
    type RaceView,
    type Row,
    type Seg,
    STATE_INFO,
    type TabGames,
    type TitleKey,
    titleOf,
    visibleRows,
    youOf,
} from '@/lib/dev/seriesPrototype';
import i18n from '@/lib/i18n';
import type { RecapLine, useSeriesSim } from './useSeriesSim';

type IconName = ComponentProps<typeof Ionicons>['name'];
type Sim = ReturnType<typeof useSeriesSim>;

/**
 * A place as the language on screen says it: "1st", "22nd"; "1er", "2e";
 * "1.º". The language's own ordinal rule picks the form, which in English is
 * exactly seriesPrototype's st/nd/rd/th `ordinal`.
 */
export function placeOrdinal(n: number): string {
    let form = 'other';
    try {
        form = new Intl.PluralRules(i18n.language, { type: 'ordinal' }).select(n);
    } catch {
        // No ordinal rules here: the general form.
    }
    if (form === 'one') return i18n.t('series:view.ordinal.one', { n });
    if (form === 'two') return i18n.t('series:view.ordinal.two', { n });
    if (form === 'few') return i18n.t('series:view.ordinal.few', { n });
    return i18n.t('series:view.ordinal.other', { n });
}

/** Why a game isn't open yet, and what opens it. Shown in place of the game. */
export type GameLock = {
    /** What opens it, in one line. */
    rule: string;
    /** Who's on the way: progress 0–1 where there's a number to show, else ready or forming. */
    items: { label: string; ready: boolean; progress: number | null; you: boolean }[];
    /** One line under the list ("2 more cities forming"). */
    more: string | null;
    /** Your part in it. */
    note: string;
    action: 'invite' | 'pickGym' | null;
};

/**
 * What the League tab draws, whichever source feeds it: the sample sim (dev
 * design work) or the live board (get_series_board). The screen reads only this.
 */
export type SeriesView = {
    live: boolean;
    /** running = a round is on; between = one has ended; upcoming = before Round 01. */
    phase: 'running' | 'between' | 'upcoming';
    /**
     * The round on screen: its slug (live only), name and length, and when its
     * prizes land ("on the 16th" for prose, "16 Nov" where space is short).
     */
    round: { slug: string | null; name: string; days: number; prizesOn: string; prizesDay: string; lastDay: string };
    header: string;
    band: { icon: IconName; text: string; right: string | null; tone: 'gold' | 'rain' | 'dark' } | null;
    hero: {
        rank: number;
        move: number;
        total: number;
        left: string;
        badge: { icon: IconName; name: string; text: string } | null;
        /** Blind Mode: every rank is hidden, yours too. */
        blind: boolean;
        day: number;
        logged: number;
        need: number;
        days: boolean[];
        /** Series points you've added today. */
        today: number;
        /** Your place last round (null = new), and your best ever place. */
        last: number | null;
        pb: number | null;
    };
    /** Which slice of the race the rows show. */
    view: RaceView;
    rival: Rival | null;
    board: Board;
    rows: Row[];
    title: (p: Person, rank: number) => TitleKey | null;
    tabs: TabGames;
    open: Record<LensKey, boolean>;
    /** Your city, your place in it and its size, once you have one. */
    city: { name: string; rank: number; members: number } | null;
    /** Cities you can pick when your gym doesn't set yours (live only). */
    cityPick: string[] | null;
    /** Cities not ranked yet (live only). */
    cityForming: number;
    /** Why each shut game is shut. */
    locks: Partial<Record<LensKey, GameLock>>;
    finish: { rank: number; total: number; pct: number; climb: number | null; inDraw: boolean } | null;
    next: { label: string; starts: string; inDays: number };
    eventNight: boolean;
    /** One gym session's points, for "about N sessions takes the crown". */
    gymSessionPts: number;
    /** The daily loop: sample only so far (no server side yet). */
    loop: {
        recap: RecapLine[] | null;
        /** The recap in two short facts, for the line under your rank (Home's Pulse says the same). */
        pulse: RecapLine[];
        /** What changed since yesterday, shown on the page under the Series card. */
        news: RecapLine[];
        tickets: number;
        ticketLog: string[];
        titlesToday: DailyTitle[];
        titlesWon: TitleKey[];
        results: DuelResult[] | null;
        rematched: string[];
        golden: Sim['golden'];
    } | null;
};

function gymLock(t: TabGames, hasGym: boolean): GameLock {
    if (!hasGym) {
        return {
            rule: i18n.t('series:view.gymLock.noGymRule'),
            items: [],
            more: null,
            note: i18n.t('series:view.gymLock.noGymNote'),
            action: 'pickGym',
        };
    }
    const g = t.gym;
    return {
        rule: i18n.t('series:view.gymLock.rule', { min: GYM_MIN, gym: g.name }),
        items: [{ label: g.name, ready: false, progress: Math.min(1, g.people / GYM_MIN), you: true }],
        more: null,
        note: i18n.t('series:view.gymLock.note', { people: g.people, min: GYM_MIN }),
        action: 'invite',
    };
}

/** The sample's city gate, with its numbers. */
function sampleCityLock(t: TabGames): GameLock {
    const rows = [...t.city].sort((a, b) => b.members - a.members);
    const shown = rows.slice(0, 4);
    const you = rows.find((r) => r.you);
    return {
        rule: `City vs city starts when ${CITY_MIN_CITIES} cities have ${CITY_MIN_MEMBERS} people each.`,
        items: shown.map((r) => ({
            label: r.name, ready: r.members >= CITY_MIN_MEMBERS, progress: Math.min(1, r.members / CITY_MIN_MEMBERS), you: r.you,
        })),
        more: rows.length > shown.length ? `${rows.length - shown.length} more cities forming` : null,
        note: you ? `You’re on ${you.name}’s team. Every friend you bring counts for ${you.name}.` : 'Every friend you bring counts for your city.',
        action: 'invite',
    };
}

/** The live city gate: which cities are ready, never how many people a city is short. */
function liveCityLock(c: SeriesCity): GameLock {
    const need = Math.max(1, c.min_cities - c.cities.length);
    const items: GameLock['items'] = c.cities.map((x) => ({ label: x.name, ready: true, progress: null, you: x.you }));
    if (c.you && !c.cities.some((x) => x.you)) items.push({ label: c.you.name, ready: false, progress: null, you: true });
    return {
        rule: i18n.t('series:view.cityLock.rule', { min: c.min_cities }),
        items,
        more: c.forming
            ? i18n.t('series:view.cityLock.moreForming', { count: need, forming: c.forming })
            : i18n.t('series:view.cityLock.more', { count: need }),
        note: c.you
            ? i18n.t('series:view.cityLock.team', { city: c.you.name })
            : i18n.t('series:view.cityLock.pick'),
        action: c.you ? 'invite' : null,
    };
}

/** The sample just before Round 01 (Sun 1 Nov): the invite period. */
const FIRST_ROUND = { label: 'Round 01', starts: 'Sun 1 Nov', inDays: 6 };

/** `name` is the season's ("Autumn Series"), from /admin/series. */
export function fromSim(sim: Sim, name = 'Autumn Series'): SeriesView {
    const st = sim.state;
    const info = STATE_INFO[st];
    const me = youOf(sim.board);
    const open = gamesOpen(sim.tabs);
    const f = sim.scale === 'pitch' ? { rank: 298, total: 5000, pct: 6, climb: 55 } : { rank: 17, total: 130, pct: 13, climb: 9 };
    // Not in a round: just before Round 01 (the invite board), or between rounds.
    const upcoming = !sim.inRound && sim.offPhase === 'soon';
    const next = upcoming ? FIRST_ROUND : NEXT_ROUND;
    return {
        live: false,
        phase: sim.inRound ? 'running' : upcoming ? 'upcoming' : 'between',
        round: { slug: null, name: 'Round 01', days: 15, prizesOn: 'on the 16th', prizesDay: '16 Nov', lastDay: 'Sun 15 Nov' },
        header: sim.inRound
            ? `${name} · Day ${info.day} of 15${info.moment ? ` · ${info.moment}` : ''}`
            : `${name} · ${next.label} starts ${next.starts}`,
        band: info.band ?? null,
        hero: {
            rank: me.rank,
            move: me.p.mid - me.rank,
            total: sim.board.total,
            left: info.left,
            badge: info.mult,
            blind: st === 'blind',
            day: info.day,
            logged: info.logged,
            need: DRAW_NEEDED,
            days: drawDays(info.day, info.logged),
            today: me.p.today,
            last: me.p.last ?? null,
            pb: sim.pb,
        },
        view: sim.view,
        rival: sim.rival,
        board: sim.board,
        rows: sim.rows,
        title: (p, rank) => titleOf(p, rank, sim.board),
        tabs: sim.tabs,
        open,
        city: { name: 'London', rank: youOf(sim.model.boards.city).rank, members: sim.model.boards.city.total },
        cityPick: null,
        cityForming: 0,
        locks: {
            ...(open.city ? {} : { city: sampleCityLock(sim.tabs) }),
            ...(open.gym ? {} : { gym: gymLock(sim.tabs, true) }),
        },
        finish: upcoming ? null : { ...f, inDraw: true },
        next,
        eventNight: st === 'eventNight',
        gymSessionPts: gymSessionPts(sim.model.k),
        loop: {
            recap: sim.recap,
            pulse: sim.pulse,
            news: sim.news,
            tickets: sim.tickets,
            ticketLog: sim.ticketLog,
            // Blind Mode hides places, so the titles that are about places sit it out.
            titlesToday: st === 'blind' ? sim.titlesToday.filter((x) => !BLIND_HIDES.includes(x.key)) : sim.titlesToday,
            titlesWon: sim.titlesWon,
            results: sim.results,
            rematched: sim.rematched,
            golden: sim.golden,
        },
    };
}

const person = (
    r: { user_id: string; name: string; points: number; today: number; country?: string | null; honours?: Honour[] },
    rankMid: number,
    you: boolean,
): Person => ({
    id: r.user_id, name: r.name, pts: r.points, today: r.today, mid: rankMid, title: null, mult: 1,
    act: 'walk', city: '', you, event: false, totalEarned: 0, flag: r.country ?? undefined,
    honours: r.honours ?? [],
});

/** The rows the server sent (top 3 + around you) as runs of consecutive ranks. */
function boardOf(b: SeriesBoard): Board {
    const segs: Seg[] = [];
    [...b.rows].sort((x, y) => x.rank - y.rank).forEach((r) => {
        const last = segs[segs.length - 1];
        const p = person(r, r.rank_mid, r.you);
        if (last && last.base + last.people.length === r.rank) last.people.push(p);
        else segs.push({ base: r.rank, people: [p] });
    });
    return { key: 'overall', total: b.total, prizes: true, segs };
}

function daysUntil(iso: string): number {
    return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/** The live board, or null when it can't fill the screen (not signed in to it yet). */
/** `blind`: a Blind Mode moment is on, so ranks are hidden and the rows go A–Z. */
export function fromLive(b: SeriesBoard, name = 'Series', blind = false): SeriesView | null {
    const me = b.me;
    if (!me) return null;
    const r = b.round;
    const board = boardOf(b);
    const rival: Rival | null = b.rival
        ? (() => {
            const gap = Math.abs(b.rival.points - me.points);
            const ahead = me.rank === 1;
            return {
                p: person(b.rival, b.rival.rank, false),
                rank: b.rival.rank, gap, ahead, friend: b.rival.friend, sealed: false,
                how: seriesHow(gap, ahead),
                share: me.today / Math.max(1, me.today + b.rival.today),
                meRank: me.rank, mePts: me.points, meToday: me.today,
            };
        })()
        : null;
    const g = b.gym;
    const area = g?.address?.split(',')[1]?.trim().split(' ')[0] ?? '';
    const c = b.city ?? null;
    const gymOpen = !!g && g.people >= GYM_MIN;
    const tabs: TabGames = {
        city: (c?.cities ?? []).map((x) => ({ name: x.name, members: x.members, avg: x.avg, you: x.you })),
        gym: {
            name: g?.name ?? i18n.t('series:view.yourGym'), area, held: null, inNow: null, friendIn: null, people: g?.people ?? 0,
            court: (g?.court ?? []).map((c) => ({ name: c.name, pts: c.points, you: c.you })),
        },
        duel: {
            you: b.duels.you,
            ends: i18n.t('series:view.duelEnds'),
            sent: b.duels.sent,
            invite: b.duels.invites[0] ? { id: b.duels.invites[0].id, name: b.duels.invites[0].name, them: b.duels.invites[0].them } : null,
            open: b.duels.open.map((o) => ({ id: o.user_id, name: o.name })),
            active: b.duels.active.map((a) => ({ id: a.id, name: a.name, them: a.them, w: a.w, l: a.l })),
        },
    };
    const phase = b.state === 'running' ? 'running' : b.state === 'ended' ? 'between' : 'upcoming';
    const upcoming = b.next ?? r;
    const nextFor = phase === 'upcoming' ? r : upcoming;
    const next = { label: nextFor.name, starts: seriesDate(nextFor.starts_at), inDays: daysUntil(nextFor.starts_at) };
    const days = Array.from({ length: r.days }, (_, i) => me.days.includes(i + 1));
    return {
        live: true,
        phase,
        round: {
            slug: r.slug, name: r.name, days: r.days, prizesOn: i18n.t('series:view.prizesOn', { date: seriesDate(r.ends_at) }), prizesDay: seriesDate(r.ends_at),
            // ends_at is the midnight after the last day
            lastDay: seriesDate(new Date(new Date(r.ends_at).getTime() - 12 * 3_600_000).toISOString()),
        },
        header: phase === 'running'
            ? i18n.t('series:view.headerDay', { name, day: r.day, days: r.days })
            : i18n.t('series:view.headerNext', { name, round: next.label, date: next.starts }),
        band: null,
        hero: {
            rank: me.rank, move: me.rank_mid - me.rank, total: b.total, left: timeLeft(r.ends_at), badge: null, blind,
            day: r.day, logged: me.days.length, need: r.draw_days, days, today: me.today, last: null, pb: null,
        },
        view: 'around',
        rival,
        board,
        rows: visibleRows(board, blind ? 'blind' : 'day3'),
        title: () => null,
        tabs,
        open: { overall: true, city: !!c?.open, gym: gymOpen, friends: true },
        city: c?.you && c.rank != null && c.members != null ? { name: c.you.name, rank: c.rank, members: c.members } : null,
        cityPick: c?.options ?? null,
        cityForming: c?.forming ?? 0,
        locks: {
            ...(c && !c.open ? { city: liveCityLock(c) } : {}),
            ...(gymOpen ? {} : { gym: gymLock(tabs, !!g) }),
        },
        finish: phase === 'between'
            ? { rank: me.rank, total: b.total, pct: Math.max(1, Math.round((me.rank / Math.max(1, b.total)) * 100)), climb: null, inDraw: me.days.length >= r.draw_days }
            : null,
        next,
        eventNight: false,
        // A gym check-in pays 15, 20 with the 40-minute upgrade (claim-points).
        gymSessionPts: 15,
        loop: null,
    };
}

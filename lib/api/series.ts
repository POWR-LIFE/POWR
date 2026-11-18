import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import type { Honour, HonourKind, HonourTier } from '@/constants/honours';
import i18n, { getFormatLocale } from '@/lib/i18n';
import { type SquadPrize, squadPrize } from '@/lib/seriesInvite';
import type { RoundTotals } from '@/lib/seriesShareCard';
import { getSessionUser, supabase } from '@/lib/supabase';

/**
 * The Autumn Series on the server (supabase/migrations/20261020150000_autumn_series.sql).
 * get_series_board returns everything the League tab shows in one call; it runs
 * as definer, so members see each other's Series points (the league views can't).
 */
export type SeriesRow = {
    user_id: string;
    name: string;
    avatar_url: string | null;
    rank: number;
    /** Rank at the start of today (London): the ▲/▼ is places since midnight. */
    rank_mid: number;
    points: number;
    today: number;
    you: boolean;
    /** Their ISO country code, for the flag (null = not known yet). */
    country: string | null;
    /** What they've earned (get_honours, 20261027180000): attached after the board arrives. */
    honours?: Honour[];
};

/**
 * My city. Your city comes from your gym, or you pick one (options) when you
 * have none, and it locks for the round. cities = the ones ranked so far, by
 * average points per member; forming = how many aren't ranked yet.
 */
export type SeriesCity = {
    you: { name: string; source: 'gym' | 'picked'; locked: boolean } | null;
    rank: number | null;
    members: number | null;
    open: boolean;
    min_cities: number;
    cities: { name: string; members: number; avg: number; you: boolean }[];
    forming: number;
    options: string[] | null;
};

/** The round joining puts you in: the one on now, else the next one. */
export type SeriesJoinRound = { slug: string; name: string; starts_at: string; ends_at: string; draw_days: number };

export type SeriesBoard = {
    state: 'upcoming' | 'running' | 'ended';
    round: { slug: string; name: string; starts_at: string; ends_at: string; day: number; days: number; draw_days: number };
    next: { slug: string; name: string; starts_at: string } | null;
    /**
     * Whether you've joined the Series this season (20261027120000_series_join).
     * Missing on an older server, where everyone is in: read it with seriesJoined().
     */
    joined?: boolean;
    /** The round joining puts you in; null when there's none to join (or the Series is off for you). */
    join?: SeriesJoinRound | null;
    total: number;
    /** Null until you've joined: the rows are then the top 20 on their own. */
    me: { rank: number; rank_mid: number; points: number; today: number; days: number[] } | null;
    /**
     * The top 20 (SERIES_BOARD_TOP), plus the one above you, you and the two
     * below. A server before 20261115180000_series_board_top_20 sends the top 3.
     */
    rows: SeriesRow[];
    rival: { user_id: string; name: string; rank: number; points: number; today: number; friend: boolean } | null;
    /** Missing before 20261022120000_series_pacers_and_cities. */
    city?: SeriesCity;
    gym: {
        id: string;
        name: string | null;
        address: string | null;
        people: number;
        court: { user_id: string; name: string; points: number; rank: number; you: boolean }[];
    } | null;
    duels: {
        week_start: string;
        ends_at: string;
        you: number;
        active: { id: string; user_id: string; name: string; them: number; w: number; l: number }[];
        invites: { id: string; user_id: string; name: string; them: number }[];
        sent: string[];
        open: { user_id: string; name: string }[];
    };
};

/** The leaders the League's race shows above the window around you (get_series_board sends them). */
export const SERIES_BOARD_TOP = 20;

/** null when the Series isn't on the server (yet), or the call fails: the screen falls back. */
/** The board, or null when there's none for this member. Throws when it can't be read. */
export async function fetchSeriesBoard(): Promise<SeriesBoard | null> {
    const { data, error } = await supabase.rpc('get_series_board');
    if (error) throw error;
    const board = (data as SeriesBoard | null) ?? null;
    if (board) await attachHonours(board);
    return board;
}

/**
 * The honours of everyone on the board, in one call. A server without
 * get_honours (or any error) just leaves the rows as they came: the icons
 * are an extra, never the reason a board fails to show.
 */
async function attachHonours(board: SeriesBoard): Promise<void> {
    const ids = board.rows.map((r) => r.user_id);
    if (ids.length === 0) return;
    const { data, error } = await supabase.rpc('get_honours', { p_users: ids });
    if (error || !Array.isArray(data)) return;
    const by = new Map<string, Honour[]>();
    for (const h of data as { user_id: string; kind: HonourKind; tier: HonourTier; count: number; detail?: Record<string, number | boolean>; earned_at?: string }[]) {
        const list = by.get(h.user_id) ?? [];
        list.push({ kind: h.kind, tier: h.tier, count: h.count, detail: h.detail ?? {}, earned_at: h.earned_at });
        by.set(h.user_id, list);
    }
    board.rows.forEach((r) => { r.honours = by.get(r.user_id) ?? []; });
}

/**
 * Your round so far for the share card: steps (the day's walking session),
 * run and ride km, gym visits and other workouts since `fromIso`. Your own
 * rows only (RLS), and only those the Series would count: not manual, not
 * flagged, no sleep. A failed read is null and the card shows other numbers.
 */
export async function fetchSeriesRoundTotals(fromIso: string): Promise<RoundTotals | null> {
    const user = await getSessionUser();
    if (!user) return null;
    const { data, error } = await supabase
        .from('activity_sessions')
        .select('type, steps, distance_m')
        .eq('user_id', user.id)
        .gte('started_at', fromIso)
        .neq('type', 'sleep')
        .neq('verification', 'manual')
        .or('flagged.is.null,flagged.eq.false')
        .limit(1000);
    if (error || !Array.isArray(data)) return null;
    const t: RoundTotals = { steps: 0, runKm: 0, gym: 0, rideKm: 0, workouts: 0 };
    for (const r of data as { type: string; steps: number | null; distance_m: number | null }[]) {
        if (r.type === 'walking') t.steps += r.steps ?? 0;
        else if (r.type === 'running') t.runKm += (r.distance_m ?? 0) / 1000;
        else if (r.type === 'cycling') t.rideKm += (r.distance_m ?? 0) / 1000;
        else if (r.type === 'gym') t.gym += 1;
        else t.workouts += 1;
    }
    return t;
}

/** Have you joined? An older server has no joining (everyone's in), so a missing answer is yes. */
export const seriesJoined = (b: SeriesBoard | null | undefined): boolean => b?.joined !== false;

/*
 * Joining (join_series, 20261027120000): once a season, and you're in every
 * round of it. Every board on screen reads again the moment you join, so Home
 * and the League both change straight away.
 */
let joinedAt = 0;
const joinSubs = new Set<() => void>();
const useJoinedAt = () => useSyncExternalStore(
    (f) => { joinSubs.add(f); return () => { joinSubs.delete(f); }; },
    () => joinedAt,
);

export type SeriesJoinResult = { joined: true; season: string | null; round: SeriesJoinRound };

/** Join the Series. Throws: P0001 = the server's reason ("The Series isn't open yet"). */
export async function joinSeries(): Promise<SeriesJoinResult> {
    const { data, error } = await supabase.rpc('join_series');
    if (error) throw error;
    joinedAt = Date.now();
    joinSubs.forEach((f) => f());
    return data as SeriesJoinResult;
}

export async function challengeFriend(friendId: string): Promise<void> {
    const { error } = await supabase.rpc('series_challenge', { p_friend: friendId });
    if (error) throw error;
}

/**
 * The round's named prizes (20261027150000), in the order they're given out:
 * one prize each, so whoever already holds one is passed over for the next.
 * The kinds are the server's keys; the names on screen are Squad Builder,
 * Unbreakable, Level Up and Rookie of the Series (NAMED in SeriesPrizes).
 */
export const NAMED_PRIZES = ['patient_zero', 'hot_streak', 'biggest_mover', 'rookie'] as const;
export type NamedPrize = (typeof NAMED_PRIZES)[number];

/** A round's prize, as set in /admin/series (series_prizes). */
export type SeriesPrize = {
    id: string;
    kind: 'place' | 'draw' | 'city' | 'golden' | NamedPrize;
    place: number | null;
    name: string;
    sponsor: string | null;
    detail: string | null;
    image_url: string | null;
    winners: number;
};

/** The round's prizes ([] when none are set yet), or null when the call fails. */
async function readSeriesPrizes(slug: string): Promise<SeriesPrize[] | null> {
    const { data, error } = await supabase
        .from('series_prizes')
        .select('id, kind, place, name, sponsor, detail, image_url, winners, series_rounds!inner(slug)')
        .eq('series_rounds.slug', slug)
        .order('place', { ascending: true, nullsFirst: false });
    if (error || !data) return null;
    return (data as unknown as (SeriesPrize & { series_rounds: unknown })[]).map(({ series_rounds: _r, ...p }) => p);
}

/** The round's prizes; [] when none are set yet (or the call fails). */
export async function fetchSeriesPrizes(slug: string): Promise<SeriesPrize[]> {
    return (await readSeriesPrizes(slug)) ?? [];
}

const NO_PRIZE_ROWS: SeriesPrize[] = [];
// The last prizes read for each round: a screen that opens again starts from
// them instead of "To be announced", and every screen shares one answer.
const prizeCache = new Map<string, SeriesPrize[]>();

/**
 * A round's prizes as set in /admin/series. Read again every time the screen
 * comes into view (`active`) and every time the app comes back to the front,
 * so a prize saved in the admin shows without closing the app. A failed read
 * keeps the prizes already on screen.
 */
export function useSeriesPrizeRows(slug: string | null | undefined, active: boolean): SeriesPrize[] {
    const [got, setGot] = useState<{ slug: string; rows: SeriesPrize[] } | null>(null);
    useEffect(() => {
        if (!slug || !active) return undefined;
        let live = true;
        const read = () => {
            void readSeriesPrizes(slug).then((rows) => {
                if (!live || !rows) return;
                prizeCache.set(slug, rows);
                setGot({ slug, rows });
            });
        };
        read();
        const sub = AppState.addEventListener('change', (state) => { if (state === 'active') read(); });
        return () => { live = false; sub.remove(); };
    }, [slug, active]);
    if (!slug) return NO_PRIZE_ROWS;
    return got?.slug === slug ? got.rows : (prizeCache.get(slug) ?? NO_PRIZE_ROWS);
}

/**
 * One of a round's moments (get_series_moments), set in /admin/series. A
 * secret one comes back as kind 'secret' with no name or dates until it starts.
 */
export type SeriesMoment = {
    id: string;
    kind: 'gun' | 'double_down' | 'event_night' | 'power_hour' | 'all_in' | 'blind' | 'plague' | 'secret';
    name: string | null;
    line: string | null;
    starts_at: string | null;
    ends_at: string | null;
    multiplier: number | null;
    /** Double Down's activities (null = all); from 20261023120000. */
    activities?: string[] | null;
    /** All In: everyone outside this place gets the boost. */
    top_n?: number | null;
};

export async function fetchSeriesMoments(slug: string): Promise<SeriesMoment[]> {
    const { data, error } = await supabase.rpc('get_series_moments', { p_slug: slug });
    if (error || !Array.isArray(data)) return [];
    return data as SeriesMoment[];
}

/** A round's announced winners (get_series_results). */
export type SeriesResults = {
    round: { slug: string; name: string; ends_at: string };
    winners: {
        kind: 'place' | 'draw' | 'city' | NamedPrize;
        place: number;
        name: string;
        points: number;
        /** What won it: days in a row, places climbed, points on the last day … */
        score?: number | null;
        city: string | null;
        you: boolean;
        prize: string | null;
        sponsor: string | null;
        image_url: string | null;
    }[];
};

/**
 * The invite board (get_series_invite_board, 20261026120000): before a round,
 * a race on friends brought in, counting towards its Squad Builder. A friend
 * counts once they've joined with your code and logged a verified workout;
 * `joining` = signed up, not yet moved. `open` = the invite period is on.
 */
export type SeriesInviteBoard = {
    round: { slug: string; name: string; starts_at: string };
    open: boolean;
    opens_at: string | null;
    rows: { rank: number; name: string; friends: number; joining: number; you: boolean }[];
    ranked: number;
    start_line: number;
    /** joined: you've joined the round's season (missing on an older server: everyone's in). */
    me: { rank: number | null; friends: number; joining: number; code: string | null; joined?: boolean };
    /**
     * The crowd at the start line (20261026150000): real members waiting, plus
     * the pacers who fill it to the board's day-1 size by the gun. Missing on
     * an older server: the crowd is then the real members only.
     */
    crowd?: { real: number; pacers_at_gun: number; ramp_from: string; ramp_to: string; base: number };
};

/** How many are waiting at the start line at time `t` (ms): the server's ramp, worked out per second. */
export function crowdAt(b: SeriesInviteBoard, t: number): number {
    const c = b.crowd;
    if (!c) return b.start_line + b.ranked;
    const from = Date.parse(c.ramp_from);
    const to = Date.parse(c.ramp_to);
    const p = to > from ? Math.min(1, Math.max(0, (t - from) / (to - from))) : 1;
    return c.real + Math.round(c.pacers_at_gun * (c.base + (1 - c.base) * p));
}

/** The crowd at the gun: what the start line fills up to. */
export function crowdAtGun(b: SeriesInviteBoard): number {
    return b.crowd ? b.crowd.real + b.crowd.pacers_at_gun : b.start_line + b.ranked;
}

/** The next round's invite board; null before 20261026120000 is applied, or on any error. */
export async function fetchSeriesInviteBoard(): Promise<SeriesInviteBoard | null> {
    const { data, error } = await supabase.rpc('get_series_invite_board');
    if (error || !data) return null;
    return data as SeriesInviteBoard;
}

/** The invite board while a screen that shows it is in view, re-read every minute. */
export function useSeriesInviteBoard(active: boolean) {
    const [board, setBoard] = useState<SeriesInviteBoard | null>(null);
    const joined = useJoinedAt();
    useEffect(() => {
        if (!active) return undefined;
        let live = true;
        const read = () => { void fetchSeriesInviteBoard().then((b) => { if (live) setBoard(b); }); };
        read();
        const t = setInterval(read, 60_000);
        return () => { live = false; clearInterval(t); };
    }, [active, joined]);
    return board;
}

/**
 * The round's Squad Builder prize (name + photo) once /admin/series has named
 * it, else null; read again whenever the screen comes into view, never blocks
 * the screen it sits on.
 */
export function useSquadPrize(slug: string | null | undefined, active = true): SquadPrize | null {
    const rows = useSeriesPrizeRows(slug, active);
    return useMemo(() => squadPrize(rows), [rows]);
}

/** The latest round with announced winners, or null. */
export async function fetchSeriesResults(): Promise<SeriesResults | null> {
    const { data, error } = await supabase.rpc('get_series_results');
    if (error || !data) return null;
    return data as SeriesResults;
}

/**
 * Who's on course for one prize (get_series_prize_race). `score` and `detail`
 * mean what the prize counts: friends brought in, days in a row, places climbed
 * (detail: where you started), a newcomer's points. `sealed` = hidden while
 * Blind Mode is on.
 */
export type PrizeRaceEntry = {
    kind: 'place' | NamedPrize;
    sealed?: boolean;
    leader: { name: string; score: number; detail: number | null; you: boolean } | null;
    you: { score: number; detail: number | null; ord: number } | null;
};
export type PrizeRace = Partial<Record<NamedPrize, PrizeRaceEntry>>;

/** The running round's prize race; {} before 20261025120000 is applied, or on any error. */
export async function fetchSeriesPrizeRace(slug: string): Promise<PrizeRace> {
    const { data, error } = await supabase.rpc('get_series_prize_race', { p_slug: slug });
    if (error || !data?.prizes) return {};
    const out: PrizeRace = {};
    (data.prizes as PrizeRaceEntry[]).forEach((e) => { if (e.kind !== 'place') out[e.kind] = e; });
    return out;
}

/**
 * A round's prizes, its moments, who's on course for each prize and (between
 * rounds) its winners, while the screen is in view. Moments and the race are
 * re-read every minute: a secret moment appears when it starts, Blind Mode has
 * to switch on on time, and the race moves with every session. The prizes are
 * re-read each time the screen comes into view (`active`).
 */
export function useSeriesExtras(slug: string | null, between: boolean, active = true) {
    const prizes = useSeriesPrizeRows(slug, active);
    const [moments, setMoments] = useState<SeriesMoment[]>([]);
    const [results, setResults] = useState<SeriesResults | null>(null);
    const [race, setRace] = useState<PrizeRace>({});
    useEffect(() => {
        if (!slug) return undefined;
        let live = true;
        const readMoments = () => {
            void fetchSeriesMoments(slug).then((m) => { if (live) setMoments(m); });
            if (!between) void fetchSeriesPrizeRace(slug).then((r) => { if (live) setRace(r); });
        };
        readMoments();
        const t = setInterval(readMoments, 60_000);
        if (between) void fetchSeriesResults().then((r) => { if (live) setResults(r); });
        return () => { live = false; clearInterval(t); };
    }, [slug, between]);
    return { prizes, moments, results, race };
}

/** The season the app wears, as set in /admin/series (series_seasons). */
export type SeriesSeason = {
    slug: string;
    name: string;
    look: 'autumn' | 'winter' | 'spring' | 'summer';
    number: number;
    code: string | null;
    starts_on: string;
    ends_on: string;
    /** The season's round on now (else next, else last): "Round 02". */
    round: string | null;
};

/*
 * Is the Series on for me, and which season is it? Admins flip series_live
 * (off / testers / on) and set the seasons in /admin/series; series_status()
 * answers for the signed-in member. Read once when something first asks, and
 * again each time the League tab opens.
 */
let seriesOn = false;
let seriesSeason: SeriesSeason | null = null;
let seriesAsked = false;
const seriesSubs = new Set<() => void>();
const subscribeSeries = (f: () => void) => { seriesSubs.add(f); return () => { seriesSubs.delete(f); }; };
export async function refreshSeriesEnabled(): Promise<boolean> {
    seriesAsked = true;
    try {
        const { data, error } = await supabase.rpc('series_status');
        if (!error && data) {
            const st = data as { on: boolean; season: SeriesSeason | null };
            seriesOn = st.on === true;
            // Keep the same object while nothing changed, so the season doesn't re-render the app.
            if (JSON.stringify(st.season) !== JSON.stringify(seriesSeason)) seriesSeason = st.season ?? null;
        } else {
            // Before 20261022180000: only the switch exists.
            const old = await supabase.rpc('series_enabled');
            if (!old.error) seriesOn = old.data === true;
        }
    } catch {
        // keep what we had
    }
    seriesSubs.forEach((f) => f());
    return seriesOn;
}
// The answer is per member, so ask again whenever who's signed in changes: a
// read made on the sign-in screen (signed out = off) must not stick after
// sign-in. Deferred, because supabase-js deadlocks on calls made inside this callback.
supabase.auth?.onAuthStateChange?.((event) => {
    if (event === 'SIGNED_OUT') {
        seriesOn = false;
        seriesSeason = null;
        seriesSubs.forEach((f) => f());
        return;
    }
    if (event === 'SIGNED_IN' && seriesAsked) setTimeout(() => { void refreshSeriesEnabled(); }, 0);
});

export function useSeriesEnabled(): boolean {
    if (!seriesAsked) void refreshSeriesEnabled();
    return useSyncExternalStore(subscribeSeries, () => seriesOn);
}
/** The current season from /admin/series, or null before one is published. */
export function useSeriesSeason(): SeriesSeason | null {
    if (!seriesAsked) void refreshSeriesEnabled();
    return useSyncExternalStore(subscribeSeries, () => seriesSeason);
}

/** Your city for the round, when your gym doesn't set it. Locks once picked. */
export async function pickSeriesCity(city: string): Promise<string> {
    const { data, error } = await supabase.rpc('series_pick_city', { p_city: city });
    if (error) throw error;
    return data as string;
}

export async function respondToDuel(duelId: string, accept: boolean): Promise<void> {
    const { error } = await supabase.rpc('series_respond', { p_duel: duelId, p_accept: accept });
    if (error) throw error;
}

/**
 * A Series gap as the one session that closes it. POWR pays by tier: a run
 * 5–10, a gym visit 15–20. Mirrored by seriesHow in
 * supabase/functions/_shared/pushCopy.ts so the push and the screen agree.
 */
export function seriesHow(gap: number, ahead: boolean): string {
    if (ahead) return i18n.t('series:api.howClear');
    if (gap <= 10) return i18n.t('series:api.howRun');
    if (gap <= 20) return i18n.t('series:api.howGym');
    return i18n.t('series:api.howSessions', { count: Math.ceil(gap / 15) });
}

/** A whole number as the member reads it: "1,234" in English, "1 234" in French. */
export function seriesNum(n: number): string {
    return Math.round(n).toLocaleString(getFormatLocale());
}

const ORDINAL_KEYS: Partial<Record<Intl.LDMLPluralRule, string>> = {
    one: 'series:api.ordinalOne', two: 'series:api.ordinalTwo', few: 'series:api.ordinalFew',
};

/** A place, in the language on screen: "2nd", "2e", "2.º". */
export function seriesOrdinal(n: number): string {
    let rule: Intl.LDMLPluralRule = 'other';
    try {
        rule = new Intl.PluralRules(getFormatLocale(), { type: 'ordinal' }).select(n);
    } catch {
        // No ordinal rules here: the plain form.
    }
    return i18n.t(ORDINAL_KEYS[rule] ?? 'series:api.ordinalOther', { n });
}

/** A countdown in the language on screen: "23d 04h" (no minutes given), else "14h 05m", or "38m" with no hours. */
export function seriesClock(d: number, h: number, m: number | null): string {
    if (m == null) return i18n.t('series:api.clockDH', { d, h: String(h).padStart(2, '0') });
    if (h > 0) return i18n.t('series:api.clockHM', { h, m: String(m).padStart(2, '0') });
    return i18n.t('series:api.clockM', { m });
}

/** "Sun 1 Nov", London time. */
export function seriesDate(iso: string): string {
    const d = new Date(iso);
    try {
        return d.toLocaleDateString(getFormatLocale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }).replace(',', '');
    } catch {
        const W = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${W[d.getUTCDay()]} ${d.getUTCDate()} ${M[d.getUTCMonth()]}`;
    }
}

const SERIES_TZ = 'Europe/London';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "30 Nov": a day without its weekday. */
export function seriesDay(iso: string): string {
    const d = new Date(iso);
    try {
        return d.toLocaleDateString(getFormatLocale(), { day: 'numeric', month: 'short', timeZone: SERIES_TZ }).replace(',', '');
    } catch {
        return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    }
}

/**
 * A round's first to last day: "15–30 Nov" ("Nov 15–30" where the month comes
 * first), or "28 Nov – 5 Dec" across two months.
 */
export function seriesSpan(fromIso: string, toIso: string): string {
    const from = seriesDay(fromIso);
    const to = seriesDay(toIso);
    const num = (x: string) => x.match(/\d+/)?.[0] ?? x;
    if (from.replace(/\d+/, '') !== to.replace(/\d+/, '')) return `${from} – ${to}`;
    // One month: write it once, where the locale puts it.
    return /^\d/.test(to) ? `${num(from)}–${to}` : `${from}–${num(to)}`;
}

/** "12d 04h" until a moment; "0d 00h" once it has passed. */
export function timeLeft(iso: string, now = Date.now()): string {
    const ms = Math.max(0, new Date(iso).getTime() - now);
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    return seriesClock(d, h, null);
}

/*
 * The board's live tick (20261027180000_series_board_live_tick): a trigger on
 * point_transactions broadcasts 'tick' on the public topic 'series-board'
 * whenever anyone earns, and every board on screen re-reads itself. The
 * payload is empty on purpose; the read is what carries the data.
 *
 * ⚠ supabase.channel(topic) is a CACHE LOOKUP, not a factory, and .on()
 * throws on an instance that is already joined (context/AuthContext.tsx has
 * the full story). So: one channel for the life of the JS runtime, created
 * the first time a board asks, dispatching through a module-level set that
 * boards add themselves to and leave. Never asked for twice.
 */
const BOARD_TOPIC = 'series-board';
const tickSubs = new Set<() => void>();
let boardChannelMade = false;

function ensureBoardChannel() {
    if (boardChannelMade) return;
    boardChannelMade = true;
    try {
        // A cached instance we don't know about (dev Fast Refresh re-ran this
        // module but the client kept its channels): leave it be rather than
        // call .on() on a joined channel; the poll still carries the board.
        if (supabase.getChannels().some(c => c.topic === `realtime:${BOARD_TOPIC}`)) return;
        supabase
            .channel(BOARD_TOPIC, { config: { broadcast: { self: false } } })
            .on('broadcast', { event: 'tick' }, () => { tickSubs.forEach((f) => { try { f(); } catch { /* one board's error is not another's */ } }); })
            .subscribe();
    } catch {
        // No realtime here (a test, a stale client): the poll is the board.
    }
}

/** Hear the board tick while on screen. Returns the unsubscribe. */
export function subscribeSeriesTicks(f: () => void): () => void {
    ensureBoardChannel();
    tickSubs.add(f);
    return () => { tickSubs.delete(f); };
}

/** Ticks arrive in bursts (one per point row); one re-read serves the burst. */
const TICK_SETTLE_MS = 1_500;

/**
 * The live board while the screen is in view: fetched on focus, re-read
 * within a couple of seconds of anyone earning, and every minute regardless.
 */
export function useSeriesBoard(active: boolean) {
    const [board, setBoard] = useState<SeriesBoard | null>(null);
    // False until the first answer, so "no board" can be told from "not yet".
    const [loaded, setLoaded] = useState(false);
    const refresh = useCallback(async () => {
        try {
            setBoard(await fetchSeriesBoard());
            setLoaded(true);
        } catch {
            // Keep the last board: one failed poll (a tunnel, a blip) must not
            // send the League back to its old look for the rest of the session.
            // With no board yet, the League shows its old look, as before.
            setLoaded(true);
        }
    }, []);
    const joined = useJoinedAt();
    useEffect(() => {
        if (!active) return undefined;
        void refresh();
        const t = setInterval(() => { void refresh(); }, 60_000);
        let settle: ReturnType<typeof setTimeout> | null = null;
        const off = subscribeSeriesTicks(() => {
            if (settle) clearTimeout(settle);
            settle = setTimeout(() => { settle = null; void refresh(); }, TICK_SETTLE_MS);
        });
        return () => {
            clearInterval(t);
            if (settle) clearTimeout(settle);
            off();
        };
    }, [active, refresh, joined]);
    return { board, loaded, refresh };
}

/**
 * A bounty an admin put on a member (get_series_bounties, 20261118160000).
 * The first member who was below them when it went on and climbs above them
 * on Series points claims it and wins `prize`. Never points. `you` is null when
 * it's on you or you aren't in the round; `you.gap` = the points you need to go
 * above them (0 or less: you're past them and the claim lands within a minute;
 * null in Blind Mode or when you were ahead at the start). `target.points` is
 * null in Blind Mode.
 */
export type SeriesBounty = {
    id: string;
    status: 'live' | 'claimed' | 'ended';
    prize: string;
    detail: string | null;
    sponsor: string | null;
    image_url: string | null;
    placed_at: string;
    ends_at: string | null;
    claimed_at: string | null;
    target: { user_id: string; name: string; avatar_url: string | null; you: boolean; points: number | null };
    claimer: { user_id: string; name: string; avatar_url: string | null; you: boolean } | null;
    you: { can_claim: boolean; gap: number | null } | null;
};
export type SeriesBounties = { round: string; blind: boolean; bounties: SeriesBounty[] };

/** The round's live bounties and the ones claimed in the last day; null on any error (or before the migration). */
export async function fetchSeriesBounties(slug: string): Promise<SeriesBounties | null> {
    const { data, error } = await supabase.rpc('get_series_bounties', { p_slug: slug });
    if (error || !data || !Array.isArray((data as SeriesBounties).bounties)) return null;
    return data as SeriesBounties;
}

const NO_BOUNTIES: SeriesBounty[] = [];

/**
 * The round's bounties while the screen is in view: read on focus, every
 * minute (a new one or a claim lands on the minute) and, while one is live, a
 * moment after anyone earns (the gap moves with every session). A failed read
 * keeps what's on screen.
 */
export function useSeriesBounties(slug: string | null, active: boolean): SeriesBounty[] {
    const [got, setGot] = useState<{ slug: string; rows: SeriesBounty[] } | null>(null);
    useEffect(() => {
        if (!slug || !active) return undefined;
        let live = true;
        // No live bounty: nothing on screen moves with a session, so ticks don't re-read.
        let anyLive = false;
        const read = () => {
            void fetchSeriesBounties(slug).then((b) => {
                if (!live || !b) return;
                anyLive = b.bounties.some((x) => x.status === 'live');
                setGot({ slug, rows: b.bounties });
            });
        };
        read();
        const t = setInterval(read, 60_000);
        let settle: ReturnType<typeof setTimeout> | null = null;
        const off = subscribeSeriesTicks(() => {
            if (!anyLive) return;
            if (settle) clearTimeout(settle);
            settle = setTimeout(() => { settle = null; read(); }, TICK_SETTLE_MS);
        });
        return () => {
            live = false;
            clearInterval(t);
            if (settle) clearTimeout(settle);
            off();
        };
    }, [slug, active]);
    return slug && got?.slug === slug ? got.rows : NO_BOUNTIES;
}

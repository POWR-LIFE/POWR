import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';

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

export type SeriesBoard = {
    state: 'upcoming' | 'running' | 'ended';
    round: { slug: string; name: string; starts_at: string; ends_at: string; day: number; days: number; draw_days: number };
    next: { slug: string; name: string; starts_at: string } | null;
    total: number;
    me: { rank: number; rank_mid: number; points: number; today: number; days: number[] } | null;
    /** The top 3, plus the one above you, you and the two below. */
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

/** null when the Series isn't on the server (yet), or the call fails: the screen falls back. */
/** The board, or null when there's none for this member. Throws when it can't be read. */
export async function fetchSeriesBoard(): Promise<SeriesBoard | null> {
    const { data, error } = await supabase.rpc('get_series_board');
    if (error) throw error;
    return (data as SeriesBoard | null) ?? null;
}

export async function challengeFriend(friendId: string): Promise<void> {
    const { error } = await supabase.rpc('series_challenge', { p_friend: friendId });
    if (error) throw error;
}

/**
 * The round's named prizes (20261025120000), in the order they're given out:
 * one prize each, so whoever already holds one is passed over for the next.
 */
export const NAMED_PRIZES = ['most_wanted', 'hot_streak', 'biggest_mover', 'underdog', 'patient_zero', 'photo_finish'] as const;
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

/** The round's prizes; [] when none are set yet (or the call fails). */
export async function fetchSeriesPrizes(slug: string): Promise<SeriesPrize[]> {
    const { data, error } = await supabase
        .from('series_prizes')
        .select('id, kind, place, name, sponsor, detail, image_url, winners, series_rounds!inner(slug)')
        .eq('series_rounds.slug', slug)
        .order('place', { ascending: true, nullsFirst: false });
    if (error || !data) return [];
    return (data as unknown as (SeriesPrize & { series_rounds: unknown })[]).map(({ series_rounds: _r, ...p }) => p);
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
 * a race on friends brought in, counting towards its Patient Zero. A friend
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
    me: { rank: number | null; friends: number; joining: number; code: string | null };
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
    useEffect(() => {
        if (!active) return undefined;
        let live = true;
        const read = () => { void fetchSeriesInviteBoard().then((b) => { if (live) setBoard(b); }); };
        read();
        const t = setInterval(read, 60_000);
        return () => { live = false; clearInterval(t); };
    }, [active]);
    return board;
}

/** The latest round with announced winners, or null. */
export async function fetchSeriesResults(): Promise<SeriesResults | null> {
    const { data, error } = await supabase.rpc('get_series_results');
    if (error || !data) return null;
    return data as SeriesResults;
}

/**
 * Who's on course for one prize (get_series_prize_race). `score` and `detail`
 * mean what the prize counts: bounties, days in a row, places climbed (detail:
 * where you started), your place now (detail: your place at halfway), friends
 * brought in, points on the last day. `sealed` = hidden while Blind Mode is on.
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
 * to switch on on time, and the race moves with every session.
 */
export function useSeriesExtras(slug: string | null, between: boolean) {
    const [prizes, setPrizes] = useState<SeriesPrize[]>([]);
    const [moments, setMoments] = useState<SeriesMoment[]>([]);
    const [results, setResults] = useState<SeriesResults | null>(null);
    const [race, setRace] = useState<PrizeRace>({});
    useEffect(() => {
        if (!slug) return undefined;
        let live = true;
        void fetchSeriesPrizes(slug).then((p) => { if (live) setPrizes(p); });
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
    if (ahead) return 'One session today keeps you clear';
    if (gap <= 10) return 'One run does it';
    if (gap <= 20) return 'One gym session does it';
    return `About ${Math.ceil(gap / 15)} sessions do it`;
}

/** "Sun 1 Nov", London time. */
export function seriesDate(iso: string): string {
    const d = new Date(iso);
    try {
        return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }).replace(',', '');
    } catch {
        const W = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${W[d.getUTCDay()]} ${d.getUTCDate()} ${M[d.getUTCMonth()]}`;
    }
}

/** "12d 04h" until a moment; "0d 00h" once it has passed. */
export function timeLeft(iso: string, now = Date.now()): string {
    const ms = Math.max(0, new Date(iso).getTime() - now);
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    return `${d}d ${String(h).padStart(2, '0')}h`;
}

/** The live board while the screen is in view: fetched on focus, then every minute. */
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
    useEffect(() => {
        if (!active) return undefined;
        void refresh();
        const t = setInterval(() => { void refresh(); }, 60_000);
        return () => clearInterval(t);
    }, [active, refresh]);
    return { board, loaded, refresh };
}

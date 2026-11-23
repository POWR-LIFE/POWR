/**
 * The Series board's "you vs them" drawer (get_series_paths, 20261119120000):
 * the honest move that catches them, what they do that you don't, and where
 * more points would put you. Pure, so the screen only draws it.
 */

/** What earned a day's points: an activity, its Series points and how many sessions. */
export type PathAct = { type: string; pts: number; n?: number };

/** One day of a member's round: its Series points and what earned them, biggest first. */
export type SeriesPathDay = { day: number; pts: number; acts: PathAct[] };

/** A member's round so far, as the server scored it (the board's own points). */
export type SeriesPath = {
    user_id: string;
    you: boolean;
    points: number;
    days: SeriesPathDay[];
    /** Dev only: made up from the board's total because the server has no get_series_paths yet. */
    sample?: boolean;
};

/** A member's round added up to the end of a day: the total, and points and sessions by activity. */
export type Tally = { total: number; pts: Record<string, number>; n: Record<string, number> };

/** The bucket for the activities past the named ones. */
export const OTHER = 'other';

export const EMPTY_TALLY: Tally = { total: 0, pts: {}, n: {} };

/** Everything up to and including `day` (Infinity = the whole round so far). */
export function tallyTo(path: Pick<SeriesPath, 'days'> | null | undefined, day: number): Tally {
    const t: Tally = { total: 0, pts: {}, n: {} };
    for (const d of path?.days ?? []) {
        if (d.day > day || d.pts <= 0) continue;
        t.total += d.pts;
        for (const a of d.acts) {
            t.pts[a.type] = (t.pts[a.type] ?? 0) + a.pts;
            // An older server sent no counts: a day's activity is one session.
            t.n[a.type] = (t.n[a.type] ?? 0) + (a.n ?? 1);
        }
    }
    return t;
}

export type RaceSide = { pts: number; n: number };
export type RaceRow = { type: string; a: RaceSide; b: RaceSide };

/**
 * One row per activity, biggest (both of you together) first: the top three
 * by name and the rest folded into OTHER. A lone fourth keeps its name, since
 * folding one activity says less than naming it. `b` is empty with no rival.
 */
export function raceRows(a: Tally, b: Tally | null, named = 3): RaceRow[] {
    const types = new Set([...Object.keys(a.pts), ...Object.keys(b?.pts ?? {})]);
    const all = [...types]
        .map((type) => ({
            type,
            a: { pts: a.pts[type] ?? 0, n: a.n[type] ?? 0 },
            b: { pts: b?.pts[type] ?? 0, n: b?.n[type] ?? 0 },
        }))
        .filter((r) => r.a.pts + r.b.pts > 0)
        .sort((x, y) => (y.a.pts + y.b.pts) - (x.a.pts + x.b.pts) || x.type.localeCompare(y.type));
    if (all.length <= named + 1) return all;
    const rest = all.slice(named);
    const fold = (k: 'a' | 'b'): RaceSide => ({ pts: rest.reduce((n, r) => n + r[k].pts, 0), n: rest.reduce((n, r) => n + r[k].n, 0) });
    return [...all.slice(0, named), { type: OTHER, a: fold('a'), b: fold('b') }];
}

/**
 * What takes you past them. Behind: of the activities they out-earn you on,
 * the one that gets you there in the fewest sessions (points per session from
 * both of you), and how many. Ahead: by how much.
 */
export type RaceTarget =
    | { kind: 'chase'; type: string; sessions: number; gap: number; per: number }
    | { kind: 'ahead'; lead: number };

export function raceTarget(you: Tally, them: Tally): RaceTarget | null {
    const gap = them.total - you.total;
    if (gap < 0) return { kind: 'ahead', lead: -gap };
    if (them.total <= 0) return null;
    let best: { type: string; sessions: number; edge: number; per: number } | null = null;
    for (const type of Object.keys(them.pts)) {
        const edge = them.pts[type] - (you.pts[type] ?? 0);
        if (edge <= 0) continue;
        const n = (them.n[type] ?? 0) + (you.n[type] ?? 0);
        const per = (them.pts[type] + (you.pts[type] ?? 0)) / Math.max(1, n);
        if (per <= 0) continue;
        // Level is not past: one point more than them.
        const sessions = Math.ceil((gap + 1) / per);
        if (!best || sessions < best.sessions || (sessions === best.sessions && edge > best.edge)) best = { type, sessions, edge, per };
    }
    return best ? { kind: 'chase', type: best.type, sessions: best.sessions, gap, per: best.per } : null;
}

/**
 * Who you race when you open your own row: the place above you if you're on
 * the podium (the #2 if you lead), otherwise the last prize place. `podium` is
 * everyone else on it, by rank.
 */
export function defaultRival<T extends { rank: number }>(youRank: number | null, podium: T[]): T | null {
    if (podium.length === 0) return null;
    const byRank = [...podium].sort((a, b) => a.rank - b.rank);
    if (youRank != null && youRank <= 3) {
        const above = byRank.filter((p) => p.rank < youRank);
        return above[above.length - 1] ?? byRank[0];
    }
    return byRank[byRank.length - 1];
}

/**
 * Where a member's points came from, biggest first: the top three activities
 * and the rest as OTHER, in whole percentages that add up to exactly 100
 * (largest remainder), so a legend never reads 99% or 101%.
 */
export function pointsMix(t: Tally, named = 3): { type: string; pts: number; pct: number }[] {
    const all = Object.entries(t.pts)
        .filter(([, pts]) => pts > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const total = all.reduce((n, [, pts]) => n + pts, 0);
    if (total <= 0) return [];
    const keep = all.length <= named + 1 ? all : all.slice(0, named);
    const rest = all.length <= named + 1 ? 0 : all.slice(named).reduce((n, [, pts]) => n + pts, 0);
    const parts = keep.map(([type, pts]) => ({ type, pts }));
    if (rest > 0) parts.push({ type: OTHER, pts: rest });
    const raw = parts.map((p) => (p.pts / total) * 100);
    const pct = raw.map(Math.floor);
    let left = 100 - pct.reduce((n, x) => n + x, 0);
    raw.map((x, i) => ({ i, r: x - Math.floor(x) }))
        .sort((a, b) => b.r - a.r || a.i - b.i)
        .forEach(({ i }) => { if (left > 0) { pct[i] += 1; left -= 1; } });
    return parts.map((p, i) => ({ ...p, pct: pct[i] }));
}

/** Points so far at the end of each day of the round, day 0 (the start) first: the gap chart's line. */
export function cumulative(path: Pick<SeriesPath, 'days'> | null | undefined, days: number): number[] {
    const by = new Map<number, number>();
    for (const d of path?.days ?? []) if (d.pts > 0) by.set(d.day, (by.get(d.day) ?? 0) + d.pts);
    const out = [0];
    for (let d = 1; d <= Math.max(1, days); d++) out.push(out[d - 1] + (by.get(d) ?? 0));
    return out;
}

/** Days with points, up to `days`. */
export const activeDaysTo = (path: Pick<SeriesPath, 'days'> | null | undefined, days: number): number =>
    (path?.days ?? []).filter((d) => d.pts > 0 && d.day <= days).length;

/** What most of a member's points came from (null before their first). */
export function topActivity(t: Tally): string | null {
    let best: string | null = null;
    for (const [type, pts] of Object.entries(t.pts)) {
        if (pts > 0 && (best == null || pts > t.pts[best] || (pts === t.pts[best] && type < best))) best = type;
    }
    return best;
}

/** What a session of each activity is worth, from both of you (null with no sessions of it). */
function perSession(you: Tally, them: Tally, type: string): number | null {
    const n = (them.n[type] ?? 0) + (you.n[type] ?? 0);
    const pts = (them.pts[type] ?? 0) + (you.pts[type] ?? 0);
    return n > 0 && pts > 0 ? pts / n : null;
}

/**
 * Every activity either of you has points from, and how many sessions of it
 * alone would take you past them, fewest first. The story's "Or" line.
 */
export function raceOptions(you: Tally, them: Tally): { type: string; sessions: number }[] {
    const gap = them.total - you.total;
    if (gap < 0) return [];
    const types = new Set([...Object.keys(them.pts), ...Object.keys(you.pts)]);
    return [...types]
        .map((type) => ({ type, per: perSession(you, them, type) }))
        .filter((x): x is { type: string; per: number } => x.per != null)
        .map((x) => ({ type: x.type, sessions: Math.ceil((gap + 1) / x.per) }))
        .sort((a, b) => a.sessions - b.sessions || a.type.localeCompare(b.type));
}

/**
 * The honest plan. Passing where they are today isn't passing them: they keep
 * earning. So both of you are run on to the end of the round at your pace so
 * far, and the plan is the extra sessions (on top of your usual) that finish
 * you ahead. One extra a day is a plan; when it would take more than that,
 * the plan is the next step up the board instead (`climb`), and the card says
 * how fast they're moving.
 */
export type RacePlan =
    | { kind: 'finish'; type: string; sessions: number; per: number; youEnd: number; themEnd: number }
    | { kind: 'climb'; type: string; per: number; themRate: number }
    | { kind: 'ahead'; lead: number };

/** `day` = days of the round so far (today included); `daysLeft` = days still to play (today included). */
export function racePlan(you: Tally, them: Tally, day: number, daysLeft: number): RacePlan | null {
    if (you.total > them.total) return { kind: 'ahead', lead: you.total - them.total };
    const t = raceTarget(you, them);
    if (!t || t.kind !== 'chase') return null;
    const d = Math.max(1, day);
    const rest = Math.max(0, daysLeft - 1);
    const youEnd = Math.round(you.total + (you.total / d) * rest);
    const themEnd = Math.round(them.total + (them.total / d) * rest);
    const sessions = Math.max(1, Math.ceil((themEnd - youEnd + 1) / t.per));
    if (sessions <= Math.max(1, daysLeft)) return { kind: 'finish', type: t.type, sessions, per: t.per, youEnd, themEnd };
    return { kind: 'climb', type: t.type, per: t.per, themRate: Math.round(them.total / d) };
}

/**
 * The other ways to the same finish: every activity either of you has points
 * from, as extra sessions of it alone, fewest first, only those that fit one a
 * day in the days left.
 */
export function planOptions(you: Tally, them: Tally, plan: Extract<RacePlan, { kind: 'finish' }>, daysLeft: number): { type: string; sessions: number }[] {
    const need = plan.themEnd - plan.youEnd + 1;
    const types = new Set([...Object.keys(them.pts), ...Object.keys(you.pts)]);
    return [...types]
        .filter((type) => type !== plan.type)
        .map((type) => ({ type, per: perSession(you, them, type) }))
        .filter((x): x is { type: string; per: number } => x.per != null)
        .map((x) => ({ type: x.type, sessions: Math.max(1, Math.ceil(need / x.per)) }))
        .filter((x) => x.sessions <= Math.max(1, daysLeft))
        .sort((a, b) => a.sessions - b.sessions || a.type.localeCompare(b.type));
}

/** What one session of each activity is worth (both of you pooled), best first: the climb's "or". */
export function sessionValues(you: Tally, them: Tally): { type: string; per: number }[] {
    const types = new Set([...Object.keys(them.pts), ...Object.keys(you.pts)]);
    return [...types]
        .map((type) => ({ type, per: perSession(you, them, type) }))
        .filter((x): x is { type: string; per: number } => x.per != null)
        .sort((a, b) => b.per - a.per || a.type.localeCompare(b.type));
}

/**
 * Where more points would put you (get_series_paths `me`): `ladder[k - 1]` is
 * your place with k more points and everyone else standing still.
 */
export type Climb = { rank: number; ladder: number[] };

/** Places gained with `pts` more points (0 when the ladder can't say). */
export function placesFor(climb: Climb | null | undefined, pts: number): number {
    if (!climb || climb.ladder.length === 0) return 0;
    const k = Math.min(climb.ladder.length, Math.round(pts));
    if (k < 1) return 0;
    return Math.max(0, climb.rank - climb.ladder[k - 1]);
}

/** Your place after `pts` more points (your place now when the ladder can't say). */
export function rankAfter(climb: Climb, pts: number): number {
    return climb.rank - placesFor(climb, pts);
}

/**
 * Dev only, with the sample paths: a ladder that climbs evenly from your
 * place to just outside the podium as your points reach the #3's.
 */
export function sampleClimb(rank: number, points: number, thirdPoints: number): Climb | null {
    if (rank <= 3 || thirdPoints <= points) return null;
    const span = thirdPoints - points;
    return {
        rank,
        ladder: Array.from({ length: 200 }, (_, i) => Math.max(i + 1 > span ? 3 : 4, Math.round(rank - ((i + 1) / span) * (rank - 4)))),
    };
}

/** Activities that pay once a day however often you do them (the day's walk; a gym's check-in). */
export const ONCE_A_DAY = ['walking', 'gym'];

/**
 * How often, with the days left: one every few days, one a day, a few a day,
 * or (for something that only pays once a day) more days than there are.
 */
export type Pace = { kind: 'every'; days: number } | { kind: 'daily' } | { kind: 'perDay'; n: number } | { kind: 'tooMany' };

export function racePace(sessions: number, daysLeft: number, type: string): Pace {
    const left = Math.max(1, daysLeft);
    if (sessions > left) return ONCE_A_DAY.includes(type) ? { kind: 'tooMany' } : { kind: 'perDay', n: Math.ceil(sessions / left) };
    const every = Math.floor(left / Math.max(1, sessions));
    return every >= 2 ? { kind: 'every', days: every } : { kind: 'daily' };
}

/**
 * Dev only, before get_series_paths is on the server: a round that ends
 * exactly on the board's `points` over `days` days, seeded by the id so the
 * same row always replays the same way. Never shown in a release build.
 */
export function samplePath(userId: string, points: number, days: number, you: boolean): SeriesPath {
    let seed = 0;
    for (const c of userId) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };
    const n = Math.max(1, days);
    const restDay = n >= 4 && rnd() < 0.5 ? 1 + Math.floor(rnd() * n) : 0;
    const weights = Array.from({ length: n }, (_, i) => (i + 1 === restDay ? 0 : 0.6 + rnd()));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    let given = 0;
    const out: SeriesPathDay[] = [];
    weights.forEach((w, i) => {
        if (w === 0 || points <= 0) return;
        const last = weights.slice(i + 1).every((x) => x === 0);
        // Floors before the last day, the remainder on it: the days add up to `points` exactly.
        const pts = last ? points - given : Math.floor((points * w) / sum);
        if (pts <= 0) return;
        given += pts;
        const walk = Math.min(pts, 3 + Math.floor(rnd() * 4));
        const rest = pts - walk;
        const second = rnd() < 0.35 ? (rnd() < 0.5 ? 'running' : 'cycling') : null;
        const acts: PathAct[] = rest <= 0
            ? [{ type: 'walking', pts: walk, n: 1 }]
            : second && rest > 12
                ? [
                    { type: 'gym', pts: Math.round(rest * 0.7), n: Math.max(1, Math.round((rest * 0.7) / 20)) },
                    { type: second, pts: rest - Math.round(rest * 0.7), n: 1 },
                    { type: 'walking', pts: walk, n: 1 },
                ]
                : [{ type: 'gym', pts: rest, n: Math.max(1, Math.round(rest / 20)) }, { type: 'walking', pts: walk, n: 1 }];
        out.push({ day: i + 1, pts, acts: acts.sort((a, b) => b.pts - a.pts) });
    });
    return { user_id: userId, you, points, days: out, sample: true };
}

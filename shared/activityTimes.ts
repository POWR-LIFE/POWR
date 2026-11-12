/**
 * When in the day a member is active — the admin user profile's "Activity
 * times" card.
 *
 * Inputs are what the profile already loads: every activity_sessions row (real
 * start/end times for workouts, gym visits and sleep) plus daily_step_hours
 * (steps per local hour, read from the phone). Walking sessions are one row per
 * day, midnight to midnight, so they say nothing about time of day and are left
 * out; only tracked walks (a real start and end) count as walking here.
 *
 * Session times are UTC instants, shown in the member's own timezone
 * (profiles.timezone). Step hours are already local to the phone.
 */

export interface SessionLike {
    type: string;
    started_at: string;
    ended_at: string | null;
}

export interface StepHoursLike {
    date: string;        // local YYYY-MM-DD
    steps: number[];     // 24 entries, local hours 0..23
}

export type RowKind = 'sleep' | 'steps' | 'workout';

export interface ActivityTimeRow {
    key: string;          // 'sleep' | 'steps' | the activity type
    kind: RowKind;
    /** Per local hour: minutes spent (sleep / workouts) or average steps (steps). */
    values: number[];
    /** Per local hour: sessions or nights that touched it, or days with steps in it. */
    counts: number[];
    /** Sessions, nights, or days of step data in the range. */
    total: number;
    /** Workouts: the two-hour window most sessions start in. Steps: the busiest hour. */
    peak: { from: number; to: number } | null;
    /** Workouts: how many sessions started inside `peak`. */
    peakCount: number;
    /** Sleep only: median bedtime / wake time, minutes after local midnight. */
    bedtime: number | null;
    wake: number | null;
    /** Sleep only: nights long enough to count towards bedtime and wake time. */
    nights: number;
}

/** Workout rows in a fixed order, so the same activity sits in the same place for every member. */
export const WORKOUT_ORDER = ['gym', 'running', 'cycling', 'walking', 'hiit', 'yoga', 'swimming', 'sports', 'dance'];

const HOUR_MS = 3_600_000;
/** A walking row this long is the day's step total, not a walk. */
const DAILY_TOTAL_MS = 6 * HOUR_MS;
/**
 * Step-total rows start on a local midnight, and every timezone offset is a
 * multiple of 15 minutes, so they start exactly on a quarter hour. A real walk
 * starts on an arbitrary second. Today's total (midnight → last sync) can be
 * short, so length alone doesn't catch it: 76 such prod rows on 2026-11-12.
 */
const QUARTER_HOUR_MS = 15 * 60_000;
export const isDayTotalWalk = (start: number, span: number) =>
    span >= DAILY_TOTAL_MS || start % QUARTER_HOUR_MS === 0;
/** Longer than this is bad data, not an activity. */
const MAX_SESSION_MS = 20 * HOUR_MS;
/** Shorter sleeps are naps: they shade the hours but don't move bedtime / wake time. */
const MIN_NIGHT_MS = 3 * HOUR_MS;

export const FALLBACK_TIMEZONE = 'Europe/London';

/** The member's timezone if it is a real IANA zone, else the UK fallback. */
export function resolveTimezone(tz: string | null | undefined): { tz: string; reported: boolean } {
    if (tz) {
        try {
            new Intl.DateTimeFormat('en-GB', { timeZone: tz });
            return { tz, reported: true };
        } catch { /* not a zone this browser knows */ }
    }
    return { tz: FALLBACK_TIMEZONE, reported: false };
}

interface LocalClock { hour: number; minute: number; second: number; dateKey: string }

/** A reader for wall-clock parts of an instant in `tz`. */
export function localClock(tz: string): (ms: number) => LocalClock {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    return (ms: number) => {
        const p: Record<string, string> = {};
        for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
        return {
            hour: Number(p.hour) % 24,
            minute: Number(p.minute),
            second: Number(p.second),
            dateKey: `${p.year}-${p.month}-${p.day}`,
        };
    };
}

/**
 * Minutes of [startMs, endMs) that fall in each local hour. Walks the span one
 * local hour at a time, so a DST change or a half-hour-offset zone lands right.
 */
export function minutesByLocalHour(startMs: number, endMs: number, clock: (ms: number) => LocalClock): number[] {
    const out = new Array(24).fill(0);
    let cursor = startMs;
    let guard = 0;
    while (cursor < endMs && guard++ < 48) {
        const { hour, minute, second } = clock(cursor);
        const intoHour = (minute * 60 + second) * 1000 + (((cursor % 1000) + 1000) % 1000);
        const next = Math.min(cursor + HOUR_MS - intoHour, endMs);
        out[hour] += (next - cursor) / 60_000;
        cursor = next;
    }
    return out;
}

function median(values: number[]): number | null {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median of clock times that straddle midnight (bedtimes): measured from noon so 23:00 and 01:00 sit together. */
function medianAcrossMidnight(minutes: number[]): number | null {
    const m = median(minutes.map(v => (v + 720) % 1440));
    return m == null ? null : Math.round((m + 720) % 1440);
}

function emptyRow(key: string, kind: RowKind): ActivityTimeRow {
    return {
        key, kind,
        values: new Array(24).fill(0),
        counts: new Array(24).fill(0),
        total: 0, peak: null, peakCount: 0,
        bedtime: null, wake: null, nights: 0,
    };
}

/**
 * The two-hour window (wrapping midnight) that holds the most starts. On a tie
 * the window that opens on the busier hour wins, so a lone 6pm start reads
 * "6–8pm", not "5–7pm".
 */
function busiestTwoHours(starts: number[]): { from: number; to: number; count: number } {
    let best = { from: 0, to: 2, count: -1 };
    for (let h = 0; h < 24; h++) {
        const count = starts[h] + starts[(h + 1) % 24];
        if (count > best.count || (count === best.count && starts[h] > starts[best.from])) {
            best = { from: h, to: (h + 2) % 24, count };
        }
    }
    return best;
}

/**
 * The card's rows for one member over a time range.
 *
 * @param sinceMs  only sessions starting at or after this instant, and step days
 *                 on or after its local date. Pass null for all time.
 */
export function buildActivityTimes(params: {
    sessions: SessionLike[];
    stepHours: StepHoursLike[] | null;
    tz: string;
    sinceMs: number | null;
}): ActivityTimeRow[] {
    const { sessions, stepHours, tz, sinceMs } = params;
    const clock = localClock(tz);

    const sleep = emptyRow('sleep', 'sleep');
    const bedtimes: number[] = [];
    const wakes: number[] = [];
    const workouts = new Map<string, ActivityTimeRow & { starts: number[] }>();

    for (const s of sessions) {
        if (!s.ended_at) continue;
        const start = Date.parse(s.started_at);
        const end = Date.parse(s.ended_at);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        const span = end - start;
        if (span <= 0 || span > MAX_SESSION_MS) continue;
        if (sinceMs != null && start < sinceMs) continue;
        if (s.type === 'walking' && isDayTotalWalk(start, span)) continue;

        const mins = minutesByLocalHour(start, end, clock);

        if (s.type === 'sleep') {
            sleep.total++;
            mins.forEach((m, h) => {
                if (m > 0) { sleep.values[h] += m; sleep.counts[h]++; }
            });
            if (span >= MIN_NIGHT_MS) {
                const a = clock(start);
                const b = clock(end);
                bedtimes.push(a.hour * 60 + a.minute);
                wakes.push(b.hour * 60 + b.minute);
            }
            continue;
        }

        let row = workouts.get(s.type);
        if (!row) {
            row = { ...emptyRow(s.type, 'workout'), starts: new Array(24).fill(0) };
            workouts.set(s.type, row);
        }
        row.total++;
        row.starts[clock(start).hour]++;
        mins.forEach((m, h) => {
            if (m > 0) { row!.values[h] += m; row!.counts[h]++; }
        });
    }

    sleep.nights = bedtimes.length;
    sleep.bedtime = medianAcrossMidnight(bedtimes);
    sleep.wake = median(wakes) == null ? null : Math.round(median(wakes)!);

    const steps = emptyRow('steps', 'steps');
    if (stepHours?.length) {
        const sinceKey = sinceMs == null ? null : clock(sinceMs).dateKey;
        const days = stepHours.filter(r =>
            Array.isArray(r.steps) && r.steps.length === 24 &&
            (sinceKey == null || r.date >= sinceKey) &&
            r.steps.some(v => v > 0));
        steps.total = days.length;
        for (const d of days) {
            d.steps.forEach((v, h) => {
                if (v > 0) { steps.values[h] += v; steps.counts[h]++; }
            });
        }
        if (days.length) {
            steps.values = steps.values.map(v => v / days.length);
            const top = steps.values.indexOf(Math.max(...steps.values));
            steps.peak = { from: top, to: (top + 1) % 24 };
        }
    }

    const rows: ActivityTimeRow[] = [];
    if (sleep.total) rows.push(sleep);
    if (steps.total) rows.push(steps);
    const ordered = [...workouts.keys()].sort((a, b) => {
        const ia = WORKOUT_ORDER.indexOf(a);
        const ib = WORKOUT_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    for (const key of ordered) {
        const { starts, ...row } = workouts.get(key)!;
        const best = busiestTwoHours(starts);
        rows.push({ ...row, peak: { from: best.from, to: best.to }, peakCount: best.count });
    }
    return rows;
}

// ── Labels ────────────────────────────────────────────────────────────────────

/** 0 → "12am", 13 → "1pm". */
export function hourLabel(h: number): string {
    const hh = ((h % 24) + 24) % 24;
    const twelve = hh % 12 === 0 ? 12 : hh % 12;
    return `${twelve}${hh < 12 ? 'am' : 'pm'}`;
}

/** An hour span, end exclusive: (17, 19) → "5–7pm", (23, 1) → "11pm–1am", (11, 13) → "11am–1pm". */
export function hourRange(from: number, to: number): string {
    const a = hourLabel(from);
    const b = hourLabel(to);
    // Short spans only (one or two hours), so a shared am/pm means no noon or midnight in between.
    return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -2)}–${b}` : `${a}–${b}`;
}

/** Minutes after midnight → "11:10pm". */
export function clockLabel(minutes: number): string {
    const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, '0');
    const twelve = h % 12 === 0 ? 12 : h % 12;
    return `${twelve}:${mm}${h < 12 ? 'am' : 'pm'}`;
}

// ── One session's times (the profile's Activity Logs rows) ───────────────────

const dayFormats = new Map<string, Intl.DateTimeFormat>();
function dayFormat(tz: string, withYear: boolean): Intl.DateTimeFormat {
    const key = `${tz}|${withYear}`;
    let f = dayFormats.get(key);
    if (!f) {
        f = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz, weekday: 'short', day: 'numeric', month: 'short',
            ...(withYear ? { year: 'numeric' } : {}),
        });
        dayFormats.set(key, f);
    }
    return f;
}
const clocks = new Map<string, (ms: number) => LocalClock>();
function cachedClock(tz: string) {
    let c = clocks.get(tz);
    if (!c) { c = localClock(tz); clocks.set(tz, c); }
    return c;
}

export interface SessionTimes {
    /** "Sat 8 Nov" (with the year when it isn't this year). */
    day: string;
    /** "6:05–6:50pm", "10:06pm – 7:07am", or "Whole day" / "Day so far" for a daily step total. */
    time: string;
    /** Daily step totals only, once that day's step hours exist: "8–9am". */
    busiestHour: string | null;
}

/**
 * When one session happened, in the member's timezone. A walking row that is
 * the day's step total has no time of its own, so it reads "Whole day" — plus
 * that day's busiest step hour when step hours were recorded for it.
 */
export function sessionTimes(
    session: SessionLike & { duration_sec?: number | null },
    tz: string,
    stepHoursByDate?: Map<string, number[]> | null,
    nowMs: number = Date.now(),
): SessionTimes | null {
    const start = Date.parse(session.started_at);
    if (!Number.isFinite(start)) return null;
    let end = session.ended_at ? Date.parse(session.ended_at) : NaN;
    if (!Number.isFinite(end) && session.duration_sec) end = start + session.duration_sec * 1000;

    const clock = cachedClock(tz);
    const a = clock(start);
    const thisYear = clock(nowMs).dateKey.slice(0, 4);
    // en-GB puts a comma after the weekday once a year is in it; keep both forms "Tue 30 Dec".
    const day = dayFormat(tz, a.dateKey.slice(0, 4) !== thisYear).format(new Date(start)).replace(/,/g, '');

    if (session.type === 'walking' && (!Number.isFinite(end) || isDayTotalWalk(start, end - start))) {
        const hours = stepHoursByDate?.get(a.dateKey);
        let busiestHour: string | null = null;
        if (hours && hours.length === 24 && hours.some(v => v > 0)) {
            const top = hours.indexOf(Math.max(...hours));
            busiestHour = hourRange(top, (top + 1) % 24);
        }
        // Today's total is still counting up until the day ends.
        return { day, time: a.dateKey === clock(nowMs).dateKey ? 'Day so far' : 'Whole day', busiestHour };
    }

    const startLabel = clockLabel(a.hour * 60 + a.minute);
    if (!Number.isFinite(end) || end <= start) return { day, time: startLabel, busiestHour: null };
    const b = clock(end);
    const endLabel = clockLabel(b.hour * 60 + b.minute);
    const sameHalf = a.dateKey === b.dateKey && startLabel.slice(-2) === endLabel.slice(-2);
    const time = sameHalf ? `${startLabel.slice(0, -2)}–${endLabel}` : `${startLabel} – ${endLabel}`;
    return { day, time, busiestHour: null };
}

/** 260 → "4h 20m", 45 → "45m". */
export function durationLabel(minutes: number): string {
    const m = Math.round(minutes);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
}

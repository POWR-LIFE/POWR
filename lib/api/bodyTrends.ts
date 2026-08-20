// ─── Body trends: the vitals we quietly collect, as day-by-day series ────────
// Powers the BODY tab on Progress. Everything here is derived from data the app
// already stores — health_snapshots rows (native daily syncs, Terra workouts,
// Terra nightly sleep) and activity_sessions — nothing new is collected.
//
// Windows are fixed (30 days of trends, 7 days of load) rather than D/W/M
// steppable: these are "how am I trending" reads, not a ledger to page through.

import { localDateStr } from '@/lib/api/activity';
import { hrZonesFrom, isDayWideRow } from '@/lib/api/pointsBreakdown';
import { getSessionUser, supabase } from '@/lib/supabase';

export type TrendPoint = {
    /** Local calendar date, 'YYYY-MM-DD'. */
    date: string;
    value: number;
};

export type LoadDay = {
    date: string;
    /** Minutes of tracked exercise (walking and sleep excluded). */
    activeMin: number;
    /** Minutes the provider called high-intensity — subset of activeMin. */
    hardMin: number;
};

export type WeekVitals = {
    /** Seconds spent in each HR zone (index = zone) across the week's workouts. */
    zoneMixSec: number[];
    /** Highest per-workout max HR this week, day-wide rows excluded. */
    peakHr: number | null;
    /** Active kcal across the week's tracked workouts, day-wide rows excluded. */
    kcal: number;
};

export type BodyTrends = {
    /** One resting-HR reading per day (the day's last), oldest first. */
    restingHr: TrendPoint[];
    /** Per-workout HRV (avg RMSSD, ms), one point per day it was measured. */
    hrv: TrendPoint[];
    /** Nightly sleep hours, oldest first. */
    sleepHours: TrendPoint[];
    /** Last 7 local days including today, every day present even at 0. */
    load: LoadDay[];
    /** This week's effort, aggregated across every tracked workout. */
    week: WeekVitals;
};

export const TREND_DAYS = 30;
export const LOAD_DAYS = 7;

const EMPTY_WEEK: WeekVitals = { zoneMixSec: [], peakHr: null, kcal: 0 };
const EMPTY: BodyTrends = { restingHr: [], hrv: [], sleepHours: [], load: [], week: EMPTY_WEEK };

/** True when there is genuinely nothing to draw on the tab. */
export function isEmptyTrends(t: BodyTrends): boolean {
    return t.restingHr.length === 0 && t.hrv.length === 0
        && t.sleepHours.length === 0 && t.load.every(d => d.activeMin === 0);
}

// ─── Readiness derivation ────────────────────────────────────────────────────
// Shared by the BODY tab's signals row and the Progress page's body radial, so
// the word in the ring can never disagree with the chip beneath it.

/** The judgements the signals row, insight sentence and body radial all read. */
export type BodySignals = {
    rhrFresh: TrendPoint | null;
    rhrAvg: number | null;
    rhrElevated: boolean;
    nightFresh: TrendPoint | null;
    shortNight: boolean;
    sleepAvg7: number | null;
    yesterdayMin: number;
    bigDay: boolean;
};

const seriesLatest = (s: TrendPoint[]): TrendPoint | null => s.length > 0 ? s[s.length - 1] : null;
const seriesMean = (s: TrendPoint[]): number | null =>
    s.length > 0 ? s.reduce((sum, p) => sum + p.value, 0) / s.length : null;

function localDaysAgo(date: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((today.getTime() - new Date(`${date}T00:00:00`).getTime()) / 86400000);
}

export function deriveBodySignals(t: BodyTrends): BodySignals {
    const rhr = seriesLatest(t.restingHr);
    const rhrAvg = seriesMean(t.restingHr);
    const rhrFresh = rhr && localDaysAgo(rhr.date) <= 3 ? rhr : null;
    const rhrElevated = !!(rhrFresh && rhrAvg != null && t.restingHr.length >= 5
        && rhrFresh.value - rhrAvg >= 3);

    const night = seriesLatest(t.sleepHours);
    const nightFresh = night && localDaysAgo(night.date) <= 1 ? night : null;
    const sleepPrevAvg = seriesMean(t.sleepHours.slice(0, -1));
    const shortNight = !!(nightFresh
        && (nightFresh.value < 6 || (sleepPrevAvg != null && nightFresh.value <= sleepPrevAvg - 1.5)));

    const yesterday = t.load[t.load.length - 2];
    const yesterdayMin = yesterday?.activeMin ?? 0;
    const avgLoad = seriesMean(t.load.slice(0, -1).map(d => ({ date: d.date, value: d.activeMin })));
    const bigDay = !!(avgLoad != null && yesterdayMin >= 45 && yesterdayMin >= avgLoad * 1.5);

    return {
        rhrFresh,
        rhrAvg,
        rhrElevated,
        nightFresh,
        shortNight,
        sleepAvg7: seriesMean(t.sleepHours.slice(-7)),
        yesterdayMin,
        bigDay,
    };
}

export type Readiness = {
    /** One short word — "Primed" / "Easy" / "Rest" / "—". Fits the radial's centre. */
    word: string;
    /** Why, in a few words — "short night", "good to push". */
    reason: string;
    level: 'good' | 'attention' | 'unknown';
    /**
     * Ring fill for the body radial: the share of the three signals (sleep,
     * resting HR, load) currently in a good place. A fill, not a score — the
     * word carries the verdict; this just gives the ring something honest.
     */
    ring: number;
};

export function readinessOf(d: BodySignals): Readiness {
    const goods = [
        !!(d.nightFresh && !d.shortNight),
        !!(d.rhrFresh && !d.rhrElevated),
        !d.bigDay,
    ].filter(Boolean).length;
    const ring = goods / 3;

    if (d.rhrElevated || d.shortNight) {
        return { word: 'Easy', reason: d.rhrElevated ? 'heart says rest' : 'short night', level: 'attention', ring };
    }
    if (d.bigDay) {
        return { word: 'Rest', reason: 'big day yesterday', level: 'attention', ring };
    }
    if (d.nightFresh || d.rhrFresh) {
        return { word: 'Primed', reason: 'good to push', level: 'good', ring };
    }
    return { word: '—', reason: 'needs more data', level: 'unknown', ring: 0 };
}

type SnapshotRow = {
    recorded_at: string;
    source: string | null;
    hr_max: number | null;
    calories_active: number | null;
    hr_resting: number | null;
    sleep_duration_h: number | null;
    sleep_deep_h: number | null;
    sleep_rem_h: number | null;
    sleep_light_h: number | null;
    extras: Record<string, unknown> | null;
};

type SessionRow = {
    started_at: string;
    duration_sec: number | null;
    type: string;
};

export async function fetchBodyTrends(): Promise<BodyTrends> {
    const user = await getSessionUser();
    if (!user) return EMPTY;

    const since = new Date();
    since.setDate(since.getDate() - TREND_DAYS);
    since.setHours(0, 0, 0, 0);

    const loadSince = new Date();
    loadSince.setDate(loadSince.getDate() - (LOAD_DAYS - 1));
    loadSince.setHours(0, 0, 0, 0);

    // The explicit user_id filter is belt-and-braces on top of RLS — vitals
    // queries must never rely on the policy alone (see the sleep-detail leak).
    // One fetch covers RHR, HRV and sleep: a heavy user holds ~300 snapshot rows
    // per 30 days in prod, well under PostgREST's 1000-row response cap.
    const [snapshots, sessions] = await Promise.all([
        supabase
            .from('health_snapshots')
            .select('recorded_at, source, hr_max, calories_active, hr_resting, sleep_duration_h, sleep_deep_h, sleep_rem_h, sleep_light_h, extras')
            .eq('user_id', user.id)
            .gte('recorded_at', since.toISOString())
            .order('recorded_at', { ascending: true }),
        supabase
            .from('activity_sessions')
            .select('started_at, duration_sec, type')
            .eq('user_id', user.id)
            .gte('started_at', loadSince.toISOString())
            .order('started_at', { ascending: true }),
    ]);
    if (snapshots.error) throw snapshots.error;
    if (sessions.error) throw sessions.error;

    const snapRows = (snapshots.data ?? []) as SnapshotRow[];
    return {
        ...seriesFromSnapshots(snapRows),
        load: loadFrom((sessions.data ?? []) as SessionRow[], snapRows, loadSince),
        week: weekVitalsFrom(snapRows, loadSince),
    };
}

/**
 * This week's effort in aggregate: total time per HR zone, the week's peak
 * heart rate, and the active-kcal total. Peak and kcal apply the same day-wide
 * gate as the breakdown sheet — a native "today" row carries the DAY's figures,
 * which would fake a workout peak and double-count burn.
 */
function weekVitalsFrom(rows: SnapshotRow[], since: Date): WeekVitals {
    const zoneMixSec: number[] = [];
    let peakHr: number | null = null;
    let kcal = 0;

    for (const r of rows) {
        if (new Date(r.recorded_at) < since) continue;

        const zones = hrZonesFrom(r.extras);
        if (zones) {
            for (const z of zones) {
                zoneMixSec[z.zone] = (zoneMixSec[z.zone] ?? 0) + z.durationSec;
            }
        }

        if (isDayWideRow(r)) continue;
        if (r.hr_max != null && r.hr_max > 0 && (peakHr == null || r.hr_max > peakHr)) peakHr = r.hr_max;
        if (r.calories_active != null && r.calories_active > 0) kcal += r.calories_active;
    }

    // Sparse holes → 0 so the renderer can trust every index.
    for (let i = 0; i < zoneMixSec.length; i++) zoneMixSec[i] = zoneMixSec[i] ?? 0;
    // A mix under 5 total minutes isn't a week's shape worth drawing.
    if (zoneMixSec.reduce((s, v) => s + v, 0) < 300) zoneMixSec.length = 0;

    return { zoneMixSec, peakHr, kcal: Math.round(kcal) };
}

function seriesFromSnapshots(rows: SnapshotRow[]): Omit<BodyTrends, 'load' | 'week'> {
    // Keyed by local day; rows arrive oldest-first so a later reading replaces
    // an earlier one and each day keeps its freshest value.
    const rhrByDay = new Map<string, number>();
    const hrvByDay = new Map<string, number>();
    const sleepByDay = new Map<string, number>();

    for (const r of rows) {
        const day = localDateStr(new Date(r.recorded_at));

        if (r.hr_resting != null && r.hr_resting > 0) rhrByDay.set(day, r.hr_resting);

        const hrv = r.extras?.hrv_rmssd;
        if (typeof hrv === 'number' && Number.isFinite(hrv) && hrv > 0) hrvByDay.set(day, hrv);

        // A night's hours: the explicit total when present, else the stage sum.
        // Bucketed by the morning the row was recorded — close enough for a
        // 30-day trend, and one rule for every provider.
        const stages = (r.sleep_deep_h ?? 0) + (r.sleep_rem_h ?? 0) + (r.sleep_light_h ?? 0);
        const hours = r.sleep_duration_h ?? (stages > 0 ? stages : null);
        // 12h+ "nights" are late-write artefacts, not sleep — don't chart them.
        if (hours != null && hours >= 1 && hours <= 12) {
            sleepByDay.set(day, Math.round(hours * 10) / 10);
        }
    }

    const toSeries = (m: Map<string, number>): TrendPoint[] =>
        [...m.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date < b.date ? -1 : 1);

    return {
        restingHr: toSeries(rhrByDay),
        hrv: toSeries(hrvByDay),
        sleepHours: toSeries(sleepByDay),
    };
}

function loadFrom(sessions: SessionRow[], snapshots: SnapshotRow[], loadSince: Date): LoadDay[] {
    const days: LoadDay[] = [];
    const byDate = new Map<string, LoadDay>();
    for (let i = 0; i < LOAD_DAYS; i++) {
        const d = new Date(loadSince);
        d.setDate(d.getDate() + i);
        const day: LoadDay = { date: localDateStr(d), activeMin: 0, hardMin: 0 };
        days.push(day);
        byDate.set(day.date, day);
    }

    for (const s of sessions) {
        // Walking is a passive daily aggregate and sleep isn't training; either
        // would swamp the chart with hours that aren't workouts.
        if (s.type === 'walking' || s.type === 'sleep') continue;
        const day = byDate.get(localDateStr(new Date(s.started_at)));
        if (!day || !s.duration_sec || s.duration_sec <= 0) continue;
        // 4h+ singles are open-ended check-ins, not effort — cap their weight.
        day.activeMin += Math.min(Math.round(s.duration_sec / 60), 240);
    }

    for (const r of snapshots) {
        const day = byDate.get(localDateStr(new Date(r.recorded_at)));
        if (!day) continue;
        const hard = r.extras?.high_intensity_min;
        if (typeof hard === 'number' && Number.isFinite(hard) && hard > 0) {
            day.hardMin += Math.round(hard);
        }
        // Zone 4+5 time counts as hard too, for providers that send zones but
        // no intensity minutes (Whoop, today's only zone sender, sends both
        // shapes on different workouts).
        const zones = hrZonesFrom(r.extras);
        if (zones && r.extras?.high_intensity_min == null) {
            const hardSec = zones.filter(z => z.zone >= 4).reduce((s, z) => s + z.durationSec, 0);
            if (hardSec > 0) day.hardMin += Math.round(hardSec / 60);
        }
    }

    for (const day of days) day.hardMin = Math.min(day.hardMin, day.activeMin);
    return days;
}

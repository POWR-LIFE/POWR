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

/** A provider's own recovery/readiness verdict for a morning, 0–100. */
export type ReadinessPoint = TrendPoint & {
    /** Which device scored it — 'whoop', 'garmin', 'oura'… as the row's source. */
    source: string | null;
};

/** One night, with whatever quality detail the provider sent. */
export type SleepNight = {
    /** The morning you woke, local date. */
    date: string;
    hours: number;
    deepH: number | null;
    remH: number | null;
    /** Percent of time in bed spent asleep, where the device reports it. */
    efficiency: number | null;
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
    /** One resting-HR reading per day (the night's, else the day's), oldest first. */
    restingHr: TrendPoint[];
    /** HRV (avg RMSSD, ms) — nightly where the device measures it in sleep, else per reading. */
    hrv: TrendPoint[];
    /** Nightly sleep hours, oldest first. */
    sleepHours: TrendPoint[];
    /** The same nights with stages and efficiency, oldest first. */
    sleepNights: SleepNight[];
    /** The provider's own recovery score per morning, where it sends one. */
    readiness: ReadinessPoint[];
    /** Last 7 local days including today, every day present even at 0. */
    load: LoadDay[];
    /**
     * Minutes of exercise in a typical week, from the three weeks BEFORE the
     * load window. Null until there is at least one trained day back there —
     * a first week has nothing to be "usual" against.
     */
    loadNormWeekMin: number | null;
    /** This week's effort, aggregated across every tracked workout. */
    week: WeekVitals;
};

export const TREND_DAYS = 30;
export const LOAD_DAYS = 7;
/** How far back the "usual week" norm looks: the load window plus three more. */
export const LOAD_NORM_DAYS = LOAD_DAYS * 4;
/** A night within this many days = "this device is worn to bed". */
export const SLEEP_TRACKED_DAYS = 7;
/** The nightly goal the sleep bars and the weekly shortfall are measured against. */
export const SLEEP_GOAL_H = 8;

const EMPTY_WEEK: WeekVitals = { zoneMixSec: [], peakHr: null, kcal: 0 };
const EMPTY: BodyTrends = {
    restingHr: [], hrv: [], sleepHours: [], sleepNights: [], readiness: [],
    load: [], loadNormWeekMin: null, week: EMPTY_WEEK,
};

/** True when there is genuinely nothing to draw on the tab. */
export function isEmptyTrends(t: BodyTrends): boolean {
    return t.restingHr.length === 0 && t.hrv.length === 0
        && t.sleepHours.length === 0 && t.load.every(d => d.activeMin === 0);
}

// ─── Readiness derivation ────────────────────────────────────────────────────
// Shared by the BODY tab's signals row and the Progress page's body radial, so
// the word in the ring can never disagree with the chip beneath it.

/** A signal the verdict actually rested on. */
export type BasisSignal = 'sleep' | 'hrv' | 'rhr';

/** The judgements the signals row, insight sentence and body radial all read. */
export type BodySignals = {
    rhrFresh: TrendPoint | null;
    rhrAvg: number | null;
    rhrElevated: boolean;
    /** Days since the last resting-HR reading; null when there has never been one. */
    rhrDaysAgo: number | null;
    /** Last night's HRV (or the latest daily reading, within a day). */
    hrvFresh: TrendPoint | null;
    hrvAvg: number | null;
    /** Enough HRV readings that "vs your usual" means something. */
    hrvBaselineReady: boolean;
    /** Fresh HRV well under the user's own usual — the body is still working. */
    hrvLow: boolean;
    /** HRV has landed at all in the window. */
    tracksHrv: boolean;
    /**
     * The device's OWN recovery verdict for this morning (Whoop recovery,
     * Oura readiness…), 0–100. When present it outranks our derivation: it is
     * computed from the overnight signal we only see summaries of.
     */
    providerReadiness: ReadinessPoint | null;
    nightFresh: TrendPoint | null;
    shortNight: boolean;
    sleepAvg7: number | null;
    /**
     * Minutes short of the nightly goal, summed over the last 7 nights that
     * were recorded. Nights over the goal don't pay it back — sleep debt
     * doesn't work that way.
     */
    sleepDebtMin7: number;
    /** Share of the last 7 nights' sleep that was deep or REM, 0–1. */
    deepRemShare7: number | null;
    /** Average sleep efficiency over the last 7 nights, where reported. */
    efficiency7: number | null;
    yesterdayMin: number;
    bigDay: boolean;
    /** This week's minutes against the usual week; null without a norm. */
    weekVsUsualMin: number | null;
    /**
     * The device has produced a night in the last SLEEP_TRACKED_DAYS. False
     * means "isn't worn to bed", not "hasn't synced yet" — the two need
     * different words, and the ring must not count a night that was never
     * going to arrive. A short window (not the full 30 days) so an occasional
     * sleeper who has stopped again is back on the honest copy within a week,
     * rather than reading "waiting on your device" for a month.
     */
    tracksSleep: boolean;
    /** Resting HR has landed at all in the window. */
    tracksRhr: boolean;
    /** Enough RHR readings that "vs your average" means something. */
    rhrBaselineReady: boolean;
    /** Days trained in the load window, and the minutes behind them. */
    weekActiveDays: number;
    weekActiveMin: number;
    /**
     * The fresh signals the verdict rests on, and the ones the device tracks
     * but hasn't delivered today. A verdict from one signal out of three is
     * still a verdict — but the reader deserves to know it is a thin one.
     */
    basis: BasisSignal[];
    missing: BasisSignal[];
};

const seriesLatest = <T extends TrendPoint>(s: T[]): T | null => s.length > 0 ? s[s.length - 1] : null;
const seriesMean = (s: TrendPoint[]): number | null =>
    s.length > 0 ? s.reduce((sum, p) => sum + p.value, 0) / s.length : null;
const mean = (xs: number[]): number | null =>
    xs.length > 0 ? xs.reduce((s, v) => s + v, 0) / xs.length : null;

function localDaysAgo(date: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((today.getTime() - new Date(`${date}T00:00:00`).getTime()) / 86400000);
}

export function deriveBodySignals(t: BodyTrends): BodySignals {
    const rhr = seriesLatest(t.restingHr);
    const rhrAvg = seriesMean(t.restingHr);
    const rhrDaysAgo = rhr ? localDaysAgo(rhr.date) : null;
    const rhrFresh = rhr && rhrDaysAgo != null && rhrDaysAgo <= 3 ? rhr : null;
    const rhrBaselineReady = t.restingHr.length >= 5;
    const rhrElevated = !!(rhrFresh && rhrAvg != null && rhrBaselineReady
        && rhrFresh.value - rhrAvg >= 3);

    // HRV is a night's measure for the devices that send it, so "fresh" is
    // this morning or, for a day-level reading, yesterday's — a two-day-old
    // HRV says nothing about today.
    const hrvLatest = seriesLatest(t.hrv);
    const hrvFresh = hrvLatest && localDaysAgo(hrvLatest.date) <= 1 ? hrvLatest : null;
    const hrvAvg = seriesMean(t.hrv);
    const hrvBaselineReady = t.hrv.length >= 5;
    // 15% under your own average is past night-to-night noise for most
    // people; the threshold is deliberately generous so an ordinary dip
    // doesn't get called a warning.
    const hrvLow = !!(hrvFresh && hrvAvg != null && hrvBaselineReady
        && hrvFresh.value <= hrvAvg * 0.85);

    const scored = seriesLatest(t.readiness);
    const providerReadiness = scored && localDaysAgo(scored.date) === 0 ? scored : null;

    // Strictly today: sleep is bucketed by wake morning, so "last night" is
    // only a night that ended TODAY. A night that woke yesterday morning is
    // the night before last — claiming it as "last night" (as the old ≤1-day
    // gate did) shows stale sleep whenever the wearable hasn't synced yet.
    const night = seriesLatest(t.sleepHours);
    const nightFresh = night && localDaysAgo(night.date) === 0 ? night : null;
    const sleepPrevAvg = seriesMean(t.sleepHours.slice(0, -1));
    const shortNight = !!(nightFresh
        && (nightFresh.value < 6 || (sleepPrevAvg != null && nightFresh.value <= sleepPrevAvg - 1.5)));

    const last7 = t.sleepNights.filter(n => localDaysAgo(n.date) < 7);
    const sleepDebtMin7 = Math.round(last7.reduce((s, n) => s + Math.max(0, SLEEP_GOAL_H - n.hours) * 60, 0));
    const staged = last7.filter(n => n.deepH != null || n.remH != null);
    const stagedHours = staged.reduce((s, n) => s + n.hours, 0);
    const deepRemShare7 = stagedHours > 0
        ? staged.reduce((s, n) => s + (n.deepH ?? 0) + (n.remH ?? 0), 0) / stagedHours
        : null;
    const efficiency7 = mean(last7.map(n => n.efficiency).filter((e): e is number => e != null));

    const yesterday = t.load[t.load.length - 2];
    const yesterdayMin = yesterday?.activeMin ?? 0;
    const avgLoad = seriesMean(t.load.slice(0, -1).map(d => ({ date: d.date, value: d.activeMin })));
    const bigDay = !!(avgLoad != null && yesterdayMin >= 45 && yesterdayMin >= avgLoad * 1.5);
    const weekActiveMin = t.load.reduce((s, day) => s + day.activeMin, 0);

    const tracksSleep = !!(night && localDaysAgo(night.date) <= SLEEP_TRACKED_DAYS);
    const tracksRhr = t.restingHr.length > 0;
    const tracksHrv = t.hrv.length > 0;

    const basis: BasisSignal[] = [];
    const missing: BasisSignal[] = [];
    if (tracksSleep) (nightFresh ? basis : missing).push('sleep');
    if (tracksHrv) (hrvFresh ? basis : missing).push('hrv');
    if (tracksRhr) (rhrFresh ? basis : missing).push('rhr');

    return {
        rhrFresh,
        rhrAvg,
        rhrElevated,
        rhrDaysAgo,
        hrvFresh,
        hrvAvg,
        hrvBaselineReady,
        hrvLow,
        tracksHrv,
        providerReadiness,
        nightFresh,
        shortNight,
        sleepAvg7: seriesMean(t.sleepHours.slice(-7)),
        sleepDebtMin7,
        deepRemShare7,
        efficiency7,
        yesterdayMin,
        bigDay,
        weekVsUsualMin: t.loadNormWeekMin != null ? weekActiveMin - t.loadNormWeekMin : null,
        tracksSleep,
        tracksRhr,
        rhrBaselineReady,
        weekActiveDays: t.load.filter(day => day.activeMin > 0).length,
        weekActiveMin,
        basis,
        missing,
    };
}

export type Readiness = {
    /** One short word — "Primed" / "Easy" / "Rest" / "—". Fits the radial's centre. */
    word: string;
    /** Why, in a few words — "short night", "good to push". */
    reason: string;
    level: 'good' | 'attention' | 'unknown';
    /**
     * Ring fill for the body radial. With a provider score it IS the score;
     * otherwise the share of the tracked signals currently in a good place.
     * The word carries the verdict; this just gives the ring something honest.
     */
    ring: number;
    /**
     * True when the verdict rests on fewer signals than the device usually
     * gives — a "Primed" from sleep alone while HRV and resting HR are
     * still to come. The chip says so rather than sounding certain.
     */
    partial: boolean;
};

/** Whoop's own bands — green from 67, yellow from 34, red below. */
export const READINESS_GOOD = 67;
export const READINESS_LOW = 34;

export function readinessOf(d: BodySignals): Readiness {
    // The device's own verdict wins outright. Whoop scores recovery from the
    // whole night's HRV, resting HR, respiration and sleep — a far richer read
    // than the summaries we hold — so when it has spoken for this morning we
    // relay it and keep our derivation for the days it hasn't.
    if (d.providerReadiness) {
        const score = d.providerReadiness.value;
        const ring = Math.min(1, Math.max(0, score / 100));
        if (score >= READINESS_GOOD) {
            return { word: 'Primed', reason: `recovery ${Math.round(score)}%`, level: 'good', ring, partial: false };
        }
        if (score >= READINESS_LOW) {
            return { word: 'Easy', reason: `recovery ${Math.round(score)}%`, level: 'attention', ring, partial: false };
        }
        return { word: 'Rest', reason: `recovery ${Math.round(score)}%`, level: 'attention', ring, partial: false };
    }

    // Only the signals this user's device actually produces count toward the
    // ring. Someone who never wears their wearable to bed is judged on resting
    // HR and load alone — not held a third empty forever for a night that was
    // never going to arrive.
    const checks = [
        d.tracksSleep ? !!(d.nightFresh && !d.shortNight) : null,
        d.tracksHrv ? !!(d.hrvFresh && !d.hrvLow) : null,
        d.tracksRhr ? !!(d.rhrFresh && !d.rhrElevated) : null,
        !d.bigDay,
    ].filter((c): c is boolean => c !== null);
    const ring = checks.filter(Boolean).length / checks.length;
    const partial = d.basis.length > 0 && d.missing.length > 0;

    if (d.rhrElevated || d.hrvLow || d.shortNight) {
        const reason = d.rhrElevated ? 'heart says rest' : d.hrvLow ? 'HRV below your usual' : 'short night';
        return { word: 'Easy', reason, level: 'attention', ring, partial };
    }
    if (d.bigDay) {
        return { word: 'Rest', reason: 'big day yesterday', level: 'attention', ring, partial };
    }
    if (d.nightFresh || d.rhrFresh || d.hrvFresh) {
        return { word: 'Primed', reason: 'good to push', level: 'good', ring, partial };
    }
    // Nothing fresh to judge by. Say WHICH kind of nothing: a device that has
    // never sent sleep or resting HR needs wearing differently; one that has
    // just hasn't sent anything lately.
    const reason = !d.tracksSleep && !d.tracksRhr && !d.tracksHrv
        ? 'needs sleep or resting HR' : 'no recent readings';
    return { word: '—', reason, level: 'unknown', ring: 0, partial: false };
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
    /** The linked activity session — a sleep row's TRUE start/end times. */
    session: { started_at: string; ended_at: string | null } | null;
};

type SessionRow = {
    started_at: string;
    duration_sec: number | null;
    type: string;
};

export async function fetchBodyTrends(): Promise<BodyTrends> {
    const user = await getSessionUser();
    if (!user) return EMPTY;

    // TREND_DAYS - 1, matching loadSince below: the window is INCLUSIVE of
    // today, so a bare `- TREND_DAYS` returned 31 distinct local days into a
    // scale that only has 30 columns. The chart's x-scale clamps the overflow
    // onto its left edge, which stacked two readings on one x — invisible when
    // the line was a polyline, fatal once it became a smoothed path.
    const since = new Date();
    since.setDate(since.getDate() - (TREND_DAYS - 1));
    since.setHours(0, 0, 0, 0);

    const loadSince = new Date();
    loadSince.setDate(loadSince.getDate() - (LOAD_DAYS - 1));
    loadSince.setHours(0, 0, 0, 0);

    // Sessions reach back four weeks so this week can be read against a
    // usual one. Still bounded: a heavy trainer holds ~150 rows in 28 days.
    const normSince = new Date();
    normSince.setDate(normSince.getDate() - (LOAD_NORM_DAYS - 1));
    normSince.setHours(0, 0, 0, 0);

    // The explicit user_id filter is belt-and-braces on top of RLS — vitals
    // queries must never rely on the policy alone (see the sleep-detail leak).
    // One fetch covers RHR, HRV and sleep: a heavy user holds ~300 snapshot rows
    // per 30 days in prod, well under PostgREST's 1000-row response cap.
    const [snapshots, sessions] = await Promise.all([
        supabase
            .from('health_snapshots')
            .select('recorded_at, source, hr_max, calories_active, hr_resting, sleep_duration_h, sleep_deep_h, sleep_rem_h, sleep_light_h, extras, session:activity_sessions(started_at, ended_at)')
            .eq('user_id', user.id)
            .gte('recorded_at', since.toISOString())
            .order('recorded_at', { ascending: true }),
        supabase
            .from('activity_sessions')
            .select('started_at, duration_sec, type')
            .eq('user_id', user.id)
            .gte('started_at', normSince.toISOString())
            .order('started_at', { ascending: true }),
    ]);
    if (snapshots.error) throw snapshots.error;
    if (sessions.error) throw sessions.error;

    // The session embed is to-one (session_id → id), which PostgREST returns
    // as an object — the generated types mistake it for an array.
    const snapRows = (snapshots.data ?? []) as unknown as SnapshotRow[];
    const sessionRows = (sessions.data ?? []) as SessionRow[];
    return {
        ...seriesFromSnapshots(snapRows),
        load: loadFrom(sessionRows, snapRows, loadSince),
        loadNormWeekMin: loadNormFrom(sessionRows, normSince, loadSince),
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

const finite = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
const positive = (v: unknown): number | null => {
    const n = finite(v);
    return n != null && n > 0 ? n : null;
};

/**
 * Exported for the tests only — the row shapes are what PostgREST hands back.
 *
 * Two kinds of row carry vitals. A NIGHT (sleep row with a linked session)
 * carries the sleeping heart's resting HR and HRV plus the provider's recovery
 * verdict, and belongs to the morning you woke. A DAY row (Terra daily, native
 * sync) carries the day's figures under its own date. Where both exist for one
 * date the night wins: it is the measurement the day's figure was derived
 * from, and it is the one the provider scored.
 */
export function seriesFromSnapshots(rows: SnapshotRow[]): Omit<BodyTrends, 'load' | 'loadNormWeekMin' | 'week'> {
    // Keyed by local day; rows arrive oldest-first so a later reading replaces
    // an earlier one and each day keeps its freshest value.
    const rhrByDay = new Map<string, number>();
    const rhrByNight = new Map<string, number>();
    const hrvByDay = new Map<string, number>();
    const hrvByNight = new Map<string, number>();
    const readinessByNight = new Map<string, ReadinessPoint>();
    const nightByDay = new Map<string, SleepNight>();

    for (const r of rows) {
        const day = localDateStr(new Date(r.recorded_at));

        // A night's hours: the explicit total when present, else the stage sum.
        const stages = (r.sleep_deep_h ?? 0) + (r.sleep_rem_h ?? 0) + (r.sleep_light_h ?? 0);
        const hours = r.sleep_duration_h ?? (stages > 0 ? stages : null);
        // 12h+ "nights" are late-write artefacts, not sleep — don't chart them.
        const isNight = hours != null && hours >= 1 && hours <= 12;

        if (!isNight) {
            if (r.hr_resting != null && r.hr_resting > 0) rhrByDay.set(day, r.hr_resting);
            const hrv = positive(r.extras?.hrv_rmssd);
            if (hrv != null) hrvByDay.set(day, hrv);
            continue;
        }

        // A night belongs to the morning you WOKE — the linked session's
        // real end time, not the row's write time. Terra delivers sleep
        // hours (sometimes a day+) after it happened, and write-time
        // bucketing was crediting those nights to the wrong day — a stale
        // fragment could masquerade as "last night". Backfill batches also
        // stamp several nights with one write time, collapsing them.
        const wakeDay = r.session
            ? localDateStr(new Date(r.session.ended_at
                ?? new Date(r.session.started_at).getTime() + hours * 3600_000))
            : day;
        // Longest record wins the day: a night can arrive alongside its
        // own fragments or an afternoon nap, and "last night" should mean
        // the main sleep, not whichever row happened to land last. The
        // night's vitals travel with it — a nap's HRV must not displace
        // the night's.
        const prev = nightByDay.get(wakeDay);
        if (prev != null && hours <= prev.hours) continue;

        nightByDay.set(wakeDay, {
            date: wakeDay,
            hours: Math.round(hours * 10) / 10,
            deepH: positive(r.sleep_deep_h),
            remH: positive(r.sleep_rem_h),
            efficiency: positive(r.extras?.sleep_efficiency),
        });
        if (r.hr_resting != null && r.hr_resting > 0) rhrByNight.set(wakeDay, r.hr_resting);
        const hrv = positive(r.extras?.hrv_rmssd);
        if (hrv != null) hrvByNight.set(wakeDay, hrv);
        const score = positive(r.extras?.readiness);
        if (score != null) readinessByNight.set(wakeDay, { date: wakeDay, value: score, source: r.source });
    }

    const toSeries = (m: Map<string, number>): TrendPoint[] =>
        [...m.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date < b.date ? -1 : 1);
    const byDate = <T extends { date: string }>(xs: T[]): T[] => xs.sort((a, b) => a.date < b.date ? -1 : 1);
    const nights = byDate([...nightByDay.values()]);

    return {
        restingHr: toSeries(new Map([...rhrByDay, ...rhrByNight])),
        hrv: toSeries(new Map([...hrvByDay, ...hrvByNight])),
        sleepHours: nights.map(n => ({ date: n.date, value: n.hours })),
        sleepNights: nights,
        readiness: byDate([...readinessByNight.values()]),
    };
}

/** Minutes a session adds to its day: walking/sleep excluded, 4h+ singles capped. */
function sessionLoadMin(s: SessionRow): number {
    // Walking is a passive daily aggregate and sleep isn't training; either
    // would swamp the chart with hours that aren't workouts.
    if (s.type === 'walking' || s.type === 'sleep') return 0;
    if (!s.duration_sec || s.duration_sec <= 0) return 0;
    // 4h+ singles are open-ended check-ins, not effort — cap their weight.
    return Math.min(Math.round(s.duration_sec / 60), 240);
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
        const day = byDate.get(localDateStr(new Date(s.started_at)));
        if (!day) continue;
        day.activeMin += sessionLoadMin(s);
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

/**
 * The usual week: exercise minutes per week over the three weeks before the
 * load window. Exported for the tests. Null when nothing was trained back
 * there — "+2h vs your usual week" against a usual of zero is not a comparison.
 */
export function loadNormFrom(sessions: SessionRow[], normSince: Date, loadSince: Date): number | null {
    const priorDays = Math.round((loadSince.getTime() - normSince.getTime()) / 86400000);
    if (priorDays <= 0) return null;
    let priorMin = 0;
    for (const s of sessions) {
        const at = new Date(s.started_at);
        if (at < normSince || at >= loadSince) continue;
        priorMin += sessionLoadMin(s);
    }
    if (priorMin === 0) return null;
    return Math.round(priorMin / priorDays * LOAD_DAYS);
}

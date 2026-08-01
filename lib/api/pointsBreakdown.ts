// ─── Per-activity points breakdown ───────────────────────────────────────────
// Powers the (i) on the Progress page's POWR EARNED metric: "where did this
// number come from?"
//
// This reads the user's OWN ledger rows rather than restating a rate card, and
// that is deliberate. POWR has four independent earn paths (claim-points,
// terra-webhook, native health sync, manual log) which do not agree on what a
// session is worth, and the gym dwell/upgrade thresholds are admin-tunable at
// runtime — so any hardcoded "here's what you earn" copy drifts out of sync
// with what the user was actually paid. Their own rows can't.

import { type ActivityType } from '@/constants/activities';
import {
    dayAnchor,
    monthAnchorEnd,
    monthAnchorStart,
    weekAnchorMonday,
    type LookbackPeriod,
} from '@/lib/progressLookback';
import { getSessionUser, supabase } from '@/lib/supabase';

/**
 * Per-effort vitals from the linked health_snapshots row — the heart rate and
 * calorie burn the user would otherwise open their watch app to find.
 *
 * Null fields mean "not reported for this session", never zero. A null `source`
 * means no snapshot is linked at all.
 */
export type SessionVitals = {
    hrAvg: number | null;
    hrMax: number | null;
    caloriesActive: number | null;
    /** Provider that measured it — 'whoop', 'garmin', … Powers the attribution. */
    source: string | null;
    /**
     * Sleep stage hours. NOT subject to the day-wide-source rule that gates heart
     * rate: a night's stages are genuinely per-session on every provider, which
     * is why fetchSleepDayDetail has always trusted HealthKit's.
     */
    sleepDeepH: number | null;
    sleepRemH: number | null;
    sleepLightH: number | null;
    /**
     * Bounded per-workout extras the provider sent — elevation, power, swim laps
     * and so on. Every key is optional: providers fill very different subsets, so
     * read defensively and render only what's present.
     */
    extras: SessionExtras;
};

/**
 * Optional per-workout metrics from health_snapshots.extras. All fields absent
 * unless that provider sent them, so treat every one as missing by default.
 */
export type SessionExtras = {
    elevationGainM?: number;
    avgWatts?: number;
    maxWatts?: number;
    swimLaps?: number;
    poolLengthM?: number;
    floors?: number;
    highIntensityMin?: number;
    hrMin?: number;
    hrvRmssd?: number;
};

export type PointsLedgerRow = {
    id: string;
    amount: number;
    /** point_transactions.type — 'earn', 'streak', 'bonus', 'redeem', … */
    kind: string;
    /** Human label. Falls back to a source-derived one when the row has none. */
    label: string;
    sessionId: string;
    sessionStartedAt: string;
    sessionDurationMin: number;
    /** What the session actually recorded — null when the source didn't report it. */
    sessionSteps: number | null;
    sessionDistanceM: number | null;
    verification: string;
    vitals: SessionVitals | null;
};

export type UnpaidSession = {
    id: string;
    startedAt: string;
    durationMin: number;
    steps: number | null;
    distanceM: number | null;
    verification: string;
    vitals: SessionVitals | null;
};

export type PointsBreakdown = {
    total: number;
    /** Newest session first; rows within a session in ledger order. */
    rows: PointsLedgerRow[];
    /**
     * Sessions in the window that earned nothing — usually below the activity's
     * minimum duration, or superseded by a higher-trust source. Surfacing them
     * answers "I trained, why is this zero?" without guessing at a reason.
     */
    unpaid: UnpaidSession[];
};

const EMPTY: PointsBreakdown = { total: 0, rows: [], unpaid: [] };

/**
 * Inclusive-start, exclusive-end window matching what a D/W/M breakdown view is
 * currently showing, so the sheet's total reconciles with the metric above it.
 */
export function breakdownWindow(period: LookbackPeriod, offset: number): { start: Date; end: Date } {
    if (period === 'D') {
        const start = dayAnchor(offset);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return { start, end };
    }
    if (period === 'W') {
        const start = weekAnchorMonday(offset);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        return { start, end };
    }
    // M is the calendar month the view is anchored to — the current month runs
    // to today, past months to their final day.
    const start = monthAnchorStart(offset);
    const end = new Date(monthAnchorEnd(offset));
    end.setDate(end.getDate() + 1);
    return { start, end };
}

/**
 * Best available label for a ledger row. claim-points and upgrade-gym-tier write
 * readable descriptions ("gym session upgrade (40min)", "4-day streak bonus");
 * the health-sync and manual paths write only a `source`, so those get a derived
 * label instead of rendering blank.
 *
 * Historical rows can name thresholds that have since been retuned (the ledger
 * still holds "gym session upgrade (45min)" from when that was the live gate).
 * That is left as-is on purpose — it is what the user was actually paid for.
 */
function labelFor(
    type: ActivityType,
    kind: string,
    description: string | null,
    source: string | null,
): string {
    const desc = description?.trim();
    if (desc) return desc.charAt(0).toUpperCase() + desc.slice(1);

    if (kind === 'streak') return 'Streak bonus';
    if (kind === 'bonus') return 'Bonus';

    switch (source) {
        case 'health_sync':
            // Walking rows are written as tier DELTAS as the day's step count
            // climbs, so a 1-POWR row is a top-up, not a tier value.
            return type === 'walking' ? 'Step tier progress' : 'Synced from your device';
        case 'manual_log':
            return 'Manual log';
        case 'terra':
        case 'terra_webhook':
            return 'Synced from your wearable';
        case 'shared_challenge':
        case 'shared_challenge_bonus':
            return 'Challenge reward';
        default:
            return 'Session';
    }
}

/**
 * Sources whose heart-rate and calorie figures are DAY-WIDE, not per-workout.
 *
 * The native sync path has no per-workout accessor: it reads getHeartRateToday()
 * / getCaloriesToday() once and stamps that same figure onto every session it
 * writes that day (hooks/useHealthSync.ts). So a HIIT session comes back reading
 * the day's average, not the effort. Measured in prod: 25 of 34 multi-workout
 * HealthKit days carry an IDENTICAL hr_avg across every session, and median
 * "running" HR is 80 bpm against Whoop's 142. Terra providers send a genuine
 * per-workout summary, so they're safe to show.
 *
 * `verification` is NOT a usable discriminator: verificationFromProvenance()
 * marks an Apple-Watch-sourced HealthKit workout as 'wearable' while its HR is
 * still the day-wide number. Only the snapshot's `source` records how the figure
 * was actually measured, which is why this gates on that.
 *
 * Remove a source from this set once it gains a real per-workout read — see the
 * HealthKit follow-up (HKStatisticsQuery over each workout's own time range).
 */
const DAY_WIDE_VITAL_SOURCES = new Set(['healthkit', 'health_connect']);

type SnapshotRow = {
    source: string | null;
    hr_avg: number | null;
    hr_max: number | null;
    calories_active: number | null;
    sleep_deep_h: number | null;
    sleep_rem_h: number | null;
    sleep_light_h: number | null;
    extras: Record<string, unknown> | null;
};

/** Reads a numeric key out of the extras bag, ignoring anything malformed. */
function extraNum(extras: Record<string, unknown> | null, key: string): number | undefined {
    const v = extras?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Maps the extras bag to a typed shape. Snake_case in the column (it's written
 * by the Deno webhook) and camelCase out, so callers don't straddle both.
 */
function extrasFrom(extras: Record<string, unknown> | null): SessionExtras {
    return {
        elevationGainM: extraNum(extras, 'elevation_gain_m'),
        avgWatts: extraNum(extras, 'avg_watts'),
        maxWatts: extraNum(extras, 'max_watts'),
        swimLaps: extraNum(extras, 'swim_laps'),
        poolLengthM: extraNum(extras, 'pool_length_m'),
        floors: extraNum(extras, 'floors'),
        highIntensityMin: extraNum(extras, 'high_intensity_min'),
        hrMin: extraNum(extras, 'hr_min'),
        hrvRmssd: extraNum(extras, 'hrv_rmssd'),
    };
}

type SessionRow = {
    id: string;
    started_at: string;
    duration_sec: number | null;
    steps: number | null;
    distance_m: number | null;
    verification: string;
    health_snapshots: SnapshotRow[] | null;
    point_transactions:
        | { id: string; amount: number; type: string; description: string | null; source: string | null; created_at: string }[]
        | null;
};

/**
 * Vitals for a session, or null when there is nothing trustworthy to show.
 *
 * Returns null rather than zeroes when the snapshot is missing or day-wide: a
 * wrong heart rate under a workout is worse than no heart rate, because the user
 * can check it against the watch that measured it.
 */
function vitalsFrom(snapshots: SnapshotRow[] | null): SessionVitals | null {
    const rows = snapshots ?? [];
    const carries = (s: SnapshotRow) => s.hr_avg != null || s.calories_active != null
        || s.extras != null || s.sleep_deep_h != null || s.sleep_rem_h != null || s.sleep_light_h != null;
    const isDayWide = (s: SnapshotRow) => s.source != null && DAY_WIDE_VITAL_SOURCES.has(s.source);

    // A session has at most one linked snapshot in practice. Where history left
    // two, prefer one from a per-workout source — otherwise a stray HealthKit row
    // would shadow the Whoop row beside it and lose its heart rate. The day-wide
    // fallback still matters though: it may be the only row carrying sleep stages.
    const snap = rows.find(s => carries(s) && !isDayWide(s))
        ?? rows.find(carries)
        ?? rows[0];
    if (!snap) return null;

    // The gate is per-FIELD, not per-snapshot. Heart rate and calories from a
    // native sync are the day's figures stamped on every session, so they're
    // dropped — but the same row's sleep stages are a real per-night breakdown
    // and are kept. Gating the whole row would throw away good data with bad.
    const dayWide = snap.source != null && DAY_WIDE_VITAL_SOURCES.has(snap.source);

    const vitals: SessionVitals = {
        hrAvg: dayWide ? null : snap.hr_avg,
        hrMax: dayWide ? null : snap.hr_max,
        caloriesActive: dayWide ? null : snap.calories_active,
        sleepDeepH: snap.sleep_deep_h,
        sleepRemH: snap.sleep_rem_h,
        sleepLightH: snap.sleep_light_h,
        source: snap.source,
        extras: dayWide ? {} : extrasFrom(snap.extras),
    };

    // Nothing survived the gate — render no attribution rather than an empty row.
    // Treat 0 the same as null: the contract says "null means not reported, never
    // zero", and the UI suppresses every tile when its value is <= 0, so a zero
    // surviving here would surface an attribution chip with nothing beneath it.
    const hasAnything = (vitals.hrAvg != null && vitals.hrAvg !== 0) || (vitals.hrMax != null && vitals.hrMax !== 0)
        || (vitals.caloriesActive != null && vitals.caloriesActive !== 0)
        || (vitals.sleepDeepH != null && vitals.sleepDeepH !== 0)
        || (vitals.sleepRemH != null && vitals.sleepRemH !== 0)
        || (vitals.sleepLightH != null && vitals.sleepLightH !== 0)
        || Object.values(vitals.extras).some(v => v !== undefined && v !== 0);
    return hasAnything ? vitals : null;
}

/**
 * Every point transaction attached to a session of `type` inside the window,
 * newest session first. Only session-linked rows appear here — standalone
 * bonuses (referrals, signup, weekly challenges) have no session to attribute
 * to an activity, which is the same rule `fetchWeeklyMetrics` uses for its
 * per-type totals, so the two agree.
 */
export async function fetchPointsBreakdown(
    type: ActivityType,
    start: Date,
    end: Date,
): Promise<PointsBreakdown> {
    const user = await getSessionUser();
    if (!user) return EMPTY;

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('id, started_at, duration_sec, steps, distance_m, verification, health_snapshots(source, hr_avg, hr_max, calories_active, sleep_deep_h, sleep_rem_h, sleep_light_h, extras), point_transactions(id, amount, type, description, source, created_at)')
        .eq('user_id', user.id)
        .eq('type', type)
        .gte('started_at', start.toISOString())
        .lt('started_at', end.toISOString())
        .order('started_at', { ascending: false });
    if (error) throw error;

    const sessions = (data ?? []) as unknown as SessionRow[];

    const rows: PointsLedgerRow[] = [];
    const unpaid: UnpaidSession[] = [];
    let total = 0;

    for (const s of sessions) {
        const durationMin = Math.round((s.duration_sec ?? 0) / 60);
        const vitals = vitalsFrom(s.health_snapshots);
        const txs = [...(s.point_transactions ?? [])].sort((a, b) =>
            a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
        );

        if (txs.length === 0) {
            unpaid.push({
                id: s.id,
                startedAt: s.started_at,
                durationMin,
                steps: s.steps,
                distanceM: s.distance_m,
                verification: s.verification,
                vitals,
            });
            continue;
        }

        for (const t of txs) {
            total += t.amount;
            rows.push({
                id: t.id,
                amount: t.amount,
                kind: t.type,
                label: labelFor(type, t.type, t.description, t.source),
                sessionId: s.id,
                sessionStartedAt: s.started_at,
                sessionDurationMin: durationMin,
                sessionSteps: s.steps,
                sessionDistanceM: s.distance_m,
                verification: s.verification,
                vitals,
            });
        }
    }

    return { total, rows, unpaid };
}

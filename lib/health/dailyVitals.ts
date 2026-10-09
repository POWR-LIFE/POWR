/**
 * Resting heart rate and HRV for each of the last seven days, from the phone's
 * own health store, as one 'daily' health_snapshots row per day.
 *
 * The Body tab charts resting HR and HRV from health_snapshots. For wearables
 * on Terra those rows come from terra-webhook's upsertDailyVitals — one 'daily'
 * row per day. For Apple Health and Health Connect nothing wrote them: the only
 * resting HR the native path saved rode along on a workout row, for today only,
 * so a phone user's chart had a point only on days they trained AND opened the
 * app, and HRV never appeared at all. This writes the same 'daily' row from the
 * phone, for the whole week, whenever the app syncs.
 *
 * HRV comes in each store's own measure and is stored under its own key —
 * HealthKit records SDNN (`extras.hrv_sdnn`), Health Connect RMSSD
 * (`extras.hrv_rmssd`, the key Terra uses too). They are different statistics
 * and are never mixed in one series; lib/api/bodyTrends picks one per user.
 *
 * Insert-only, by necessity: health_snapshots has no UPDATE policy for users.
 * planDailyVitalWrites() keeps that bounded — a day is written again only when
 * its numbers changed, today at most every TODAY_REWRITE_MS, and a past day's
 * row is stamped at the END of that day so it sorts after any written while the
 * day was still running (the Body tab keeps the latest row per day).
 */

import { Platform } from 'react-native';

import { saveHealthSnapshot } from '@/lib/api/activity';
import { getSessionUser, supabase } from '@/lib/supabase';

export const DAILY_VITALS_DAYS = 7;
/** Today's numbers keep moving; rewrite them at most this often. */
export const TODAY_REWRITE_MS = 2 * 60 * 60 * 1000;
/** The sync loop runs every 15 minutes; these reads don't need to. */
const MIN_RUN_INTERVAL_MS = 60 * 60 * 1000;

export type HrvKey = 'hrv_sdnn' | 'hrv_rmssd';

export type DayVitals = {
    /** Local calendar day, YYYY-MM-DD. */
    date: string;
    restingHr: number | null;
    hrv: number | null;
};

export type DailyVitalsRow = {
    recorded_at: string;
    hr_resting: number | null;
    extras: Record<string, unknown> | null;
};

export type DailyVitalsWrite = {
    recordedAt: string;
    restingHr: number | null;
    hrv: number | null;
};

function pad(n: number): string {
    return n.toString().padStart(2, '0');
}

export function localDateKey(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 23:59:00 local on a YYYY-MM-DD day. */
function endOfLocalDayMs(date: string): number {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 0, 0).getTime();
}

function plausible(v: number | null, min: number, max: number): boolean {
    return v != null && Number.isFinite(v) && v >= min && v <= max;
}

/**
 * Which day rows to insert, given this sync's readings and the rows already
 * written. Exported for the tests — the bound on rows per day lives here.
 */
export function planDailyVitalWrites(
    days: DayVitals[], existing: DailyVitalsRow[], hrvKey: HrvKey, now: Date,
): DailyVitalsWrite[] {
    const latestByDay = new Map<string, { row: DailyVitalsRow; atMs: number }>();
    for (const row of existing) {
        const atMs = new Date(row.recorded_at).getTime();
        if (!Number.isFinite(atMs)) continue;
        const day = localDateKey(new Date(atMs));
        const prev = latestByDay.get(day);
        if (!prev || atMs > prev.atMs) latestByDay.set(day, { row, atMs });
    }

    const todayKey = localDateKey(now);
    const writes: DailyVitalsWrite[] = [];
    for (const d of days) {
        const restingHr = plausible(d.restingHr, 25, 150) ? Math.round(d.restingHr!) : null;
        const hrv = plausible(d.hrv, 1, 300) ? Math.round(d.hrv! * 10) / 10 : null;
        if (restingHr == null && hrv == null) continue;

        const prev = latestByDay.get(d.date);
        if (prev) {
            const prevHrv = prev.row.extras?.[hrvKey];
            const same = (prev.row.hr_resting ?? null) === restingHr
                && (typeof prevHrv === 'number' ? prevHrv : null) === hrv;
            if (same) continue;
        }

        let atMs: number;
        if (d.date === todayKey) {
            if (prev && now.getTime() - prev.atMs < TODAY_REWRITE_MS) continue;
            atMs = now.getTime();
        } else {
            const end = endOfLocalDayMs(d.date);
            // After the day's latest row, so this one is what the Body tab keeps —
            // but never past the day itself.
            atMs = prev ? Math.max(end, prev.atMs + 1000) : end;
            if (localDateKey(new Date(atMs)) !== d.date) continue;
        }
        writes.push({ recordedAt: new Date(atMs).toISOString(), restingHr, hrv });
    }
    return writes;
}

/** Local day `daysAgo` before `now`, clamped so today ends at `now`. */
function dayWindow(now: Date, daysAgo: number): { start: Date; end: Date; date: string } {
    const start = new Date(now);
    start.setDate(start.getDate() - daysAgo);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end: end > now ? now : end, date: localDateKey(start) };
}

async function readDaysIOS(now: Date): Promise<DayVitals[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const HK = require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');
    const average = async (id: 'HKQuantityTypeIdentifierRestingHeartRate' | 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
        unit: string, start: Date, end: Date): Promise<number | null> => {
        try {
            const res = await HK.queryStatisticsForQuantity(id, ['discreteAverage'], {
                filter: { date: { startDate: start, endDate: end } },
                unit,
            });
            return res.averageQuantity?.quantity ?? null;
        } catch {
            return null; // not shared, or nothing recorded
        }
    };
    const days: DayVitals[] = [];
    for (let i = 0; i < DAILY_VITALS_DAYS; i++) {
        const { start, end, date } = dayWindow(now, i);
        days.push({
            date,
            restingHr: await average('HKQuantityTypeIdentifierRestingHeartRate', 'count/min', start, end),
            hrv: await average('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'ms', start, end),
        });
    }
    return days;
}

async function readDaysAndroid(now: Date): Promise<DayVitals[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initialize, aggregateRecord, readRecords } = require('react-native-health-connect');
    await initialize();
    const days: DayVitals[] = [];
    for (let i = 0; i < DAILY_VITALS_DAYS; i++) {
        const { start, end, date } = dayWindow(now, i);
        const timeRangeFilter = { operator: 'between' as const, startTime: start.toISOString(), endTime: end.toISOString() };

        let restingHr: number | null = null;
        try {
            const res = await aggregateRecord({ recordType: 'RestingHeartRate', timeRangeFilter });
            restingHr = res?.BPM_AVG > 0 ? res.BPM_AVG : null;
        } catch { /* not granted, or nothing recorded */ }

        // HRV has no aggregate in Health Connect; average the day's readings.
        // Needs READ_HEART_RATE_VARIABILITY, which only binaries that declare it
        // can be granted — until then this read throws and HRV stays null.
        let hrv: number | null = null;
        try {
            const { records } = await readRecords('HeartRateVariabilityRmssd', { timeRangeFilter });
            const values = ((records ?? []) as { heartRateVariabilityMillis: number }[])
                .map(r => r.heartRateVariabilityMillis)
                .filter(v => Number.isFinite(v) && v > 0);
            if (values.length > 0) hrv = values.reduce((s, v) => s + v, 0) / values.length;
        } catch { /* not granted on this binary */ }

        days.push({ date, restingHr, hrv });
    }
    return days;
}

let lastRunAt = 0;

/**
 * Reads the week's resting HR and HRV from the phone and writes any day rows
 * that changed. Foreground, best-effort, never throws; at most hourly unless
 * `force` (e.g. right after the user grants HRV). Returns rows written.
 */
export async function syncDailyVitals(opts: { force?: boolean; now?: Date } = {}): Promise<number> {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 0;
    const now = opts.now ?? new Date();
    if (!opts.force && now.getTime() - lastRunAt < MIN_RUN_INTERVAL_MS) return 0;
    lastRunAt = now.getTime();

    try {
        const user = await getSessionUser();
        if (!user) return 0;

        const days = Platform.OS === 'ios' ? await readDaysIOS(now) : await readDaysAndroid(now);
        if (!days.some(d => d.restingHr != null || d.hrv != null)) return 0;

        const source = Platform.OS === 'ios' ? 'healthkit' : 'health_connect';
        const hrvKey: HrvKey = Platform.OS === 'ios' ? 'hrv_sdnn' : 'hrv_rmssd';
        const since = dayWindow(now, DAILY_VITALS_DAYS - 1).start;
        // user_id explicitly, on top of RLS — admins can read everyone's rows.
        const { data, error } = await supabase
            .from('health_snapshots')
            .select('recorded_at, hr_resting, extras')
            .eq('user_id', user.id)
            .eq('activity_type', 'daily')
            .eq('source', source)
            .is('session_id', null)
            .gte('recorded_at', since.toISOString());
        if (error) return 0;

        const writes = planDailyVitalWrites(days, (data ?? []) as DailyVitalsRow[], hrvKey, now);
        for (const w of writes) {
            await saveHealthSnapshot({
                activityType: 'daily',
                source,
                hrResting: w.restingHr ?? undefined,
                // 'day' is terra-webhook's marker for the same row.
                extras: { scope: 'day', ...(w.hrv != null ? { [hrvKey]: w.hrv } : {}) },
                recordedAt: w.recordedAt,
            });
        }
        if (writes.length > 0) console.log(`[dailyVitals] wrote ${writes.length} day row(s)`);
        return writes.length;
    } catch (e) {
        console.warn('[dailyVitals] sync failed:', e);
        return 0;
    }
}

/**
 * Per-window vitals from the phone's own health store — the heart rate and
 * active energy recorded between two instants, on either platform.
 *
 * Why this exists: the native sync path only ever had `getHeartRateToday()` /
 * `getCaloriesToday()`, so every session it wrote that day carried the DAY's
 * figures, and the Progress sheet has to gate those out as untrustworthy
 * (`DAY_WIDE_VITAL_SOURCES` in lib/api/pointsBreakdown). Both native libraries
 * take an arbitrary window; the "today" readers just hardcoded midnight→now.
 *
 * A snapshot written from this read is tagged `extras.scope = 'session'` (see
 * `SESSION_SCOPED_EXTRAS`) so the gate can tell a measured window from a day-wide
 * figure written by the same provider. Old rows stay gated; new ones show.
 *
 * Returns null (never zeroes) when the store is unavailable OR nothing was
 * measured in the window — a phone in a locker records no heart rate, and a
 * watch that hasn't synced to the phone yet records none either. Callers treat
 * null as "try again later", not "nothing happened".
 */

import { Platform } from 'react-native';

import { zonesFromSamples, type HrSample, type HrZoneRecord } from './hrZones';

export type WindowVitals = {
    /** Average heart rate across the window's samples, bpm. Null = no samples. */
    hrAvg: number | null;
    hrMax: number | null;
    /** Active energy burned in the window, kcal. Null = nothing recorded. */
    caloriesActive: number | null;
    /**
     * Time in each heart-rate zone (lib/health/hrZones), when the caller passed
     * a max heart rate and the window held enough samples. Absent otherwise.
     */
    hrZones?: HrZoneRecord[];
};

export type WindowVitalsOptions = {
    /** Max heart rate to build zones against (lib/health/maxHeartRate). No zones without it. */
    maxHr?: number | null;
};

/** The marker a window-scoped snapshot carries in health_snapshots.extras. */
export const SESSION_SCOPED_EXTRAS = { scope: 'session' } as const;

/**
 * The extras a window-read session snapshot carries: the scope marker and, when
 * the read built them, the zones — under `hr_zones`, the key and shape Whoop's
 * zones arrive in from Terra, so the sheet and the Body tab draw both alike.
 */
export function sessionExtras(vitals: Pick<WindowVitals, 'hrZones'>): Record<string, unknown> {
    return vitals.hrZones
        ? { ...SESSION_SCOPED_EXTRAS, hr_zones: vitals.hrZones }
        : { ...SESSION_SCOPED_EXTRAS };
}

/** True when a snapshot's extras say its vitals were read over the session's own window. */
export function isSessionScoped(extras: Record<string, unknown> | null | undefined): boolean {
    return extras?.scope === 'session';
}

function finite(n: unknown): number | null {
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

function pack(
    hrAvg: number | null, hrMax: number | null, caloriesActive: number | null, hrZones: HrZoneRecord[] | null,
): WindowVitals | null {
    if (hrAvg == null && hrMax == null && caloriesActive == null) return null;
    const vitals: WindowVitals = {
        hrAvg: hrAvg != null ? Math.round(hrAvg) : null,
        hrMax: hrMax != null ? Math.round(hrMax) : null,
        caloriesActive: caloriesActive != null ? Math.round(caloriesActive) : null,
    };
    if (hrZones) vitals.hrZones = hrZones;
    return vitals;
}

async function readZonesIOS(fromMs: number, toMs: number, maxHr: number): Promise<HrZoneRecord[] | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const HK = require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');
        const samples = await HK.queryQuantitySamples('HKQuantityTypeIdentifierHeartRate', {
            filter: { date: { startDate: new Date(fromMs), endDate: new Date(toMs) } },
            limit: -1,
            unit: 'count/min',
            ascending: true,
        });
        const points: HrSample[] = samples.map(s => ({ atMs: s.startDate.getTime(), bpm: s.quantity }));
        return zonesFromSamples(points, toMs, maxHr);
    } catch {
        return null; // zones are a nicety — never cost the averages
    }
}

async function readZonesAndroid(fromMs: number, toMs: number, maxHr: number): Promise<HrZoneRecord[] | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readRecords } = require('react-native-health-connect');
        const { records } = await readRecords('HeartRate', {
            timeRangeFilter: {
                operator: 'between',
                startTime: new Date(fromMs).toISOString(),
                endTime: new Date(toMs).toISOString(),
            },
        });
        const points: HrSample[] = [];
        for (const r of (records ?? []) as { samples?: { time: string; beatsPerMinute: number }[] }[]) {
            for (const s of r.samples ?? []) {
                const atMs = new Date(s.time).getTime();
                // A record can straddle the window; only its samples inside count.
                if (atMs >= fromMs && atMs <= toMs) points.push({ atMs, bpm: s.beatsPerMinute });
            }
        }
        return zonesFromSamples(points, toMs, maxHr);
    } catch {
        return null;
    }
}

async function readWindowVitalsIOS(fromMs: number, toMs: number, maxHr: number | null): Promise<WindowVitals | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const HK = require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');
        const filter = { date: { startDate: new Date(fromMs), endDate: new Date(toMs) } };

        let hrAvg: number | null = null;
        let hrMax: number | null = null;
        try {
            const hr = await HK.queryStatisticsForQuantity(
                'HKQuantityTypeIdentifierHeartRate',
                ['discreteAverage', 'discreteMax'],
                { filter, unit: 'count/min' },
            );
            hrAvg = finite(hr.averageQuantity?.quantity);
            hrMax = finite(hr.maximumQuantity?.quantity);
        } catch { /* heart rate not readable — calories may still be */ }

        let kcal: number | null = null;
        try {
            const energy = await HK.queryStatisticsForQuantity(
                'HKQuantityTypeIdentifierActiveEnergyBurned',
                ['cumulativeSum'],
                { filter, unit: 'kcal' },
            );
            kcal = finite(energy.sumQuantity?.quantity);
        } catch { /* active energy not readable */ }

        const zones = hrAvg != null && maxHr ? await readZonesIOS(fromMs, toMs, maxHr) : null;
        return pack(hrAvg, hrMax, kcal, zones);
    } catch (e) {
        console.warn('[windowVitals] iOS read failed:', e);
        return null;
    }
}

async function readWindowVitalsAndroid(fromMs: number, toMs: number, maxHr: number | null): Promise<WindowVitals | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, aggregateRecord } = require('react-native-health-connect');
        await initialize();
        const timeRangeFilter = {
            operator: 'between' as const,
            startTime: new Date(fromMs).toISOString(),
            endTime: new Date(toMs).toISOString(),
        };

        // aggregateRecord lets Health Connect do the window maths — it prorates a
        // record that straddles the boundary, which a raw readRecords sum would
        // not — and it counts every origin the user has granted us.
        let hrAvg: number | null = null;
        let hrMax: number | null = null;
        try {
            const hr = await aggregateRecord({ recordType: 'HeartRate', timeRangeFilter });
            if ((hr?.MEASUREMENTS_COUNT ?? 0) > 0) {
                hrAvg = finite(hr.BPM_AVG);
                hrMax = finite(hr.BPM_MAX);
            }
        } catch { /* heart rate not readable */ }

        let kcal: number | null = null;
        try {
            const energy = await aggregateRecord({ recordType: 'ActiveCaloriesBurned', timeRangeFilter });
            kcal = finite(energy?.ACTIVE_CALORIES_TOTAL?.inKilocalories);
        } catch { /* active energy not readable */ }

        const zones = hrAvg != null && maxHr ? await readZonesAndroid(fromMs, toMs, maxHr) : null;
        return pack(hrAvg, hrMax, kcal, zones);
    } catch (e) {
        console.warn('[windowVitals] Android read failed:', e);
        return null;
    }
}

/**
 * Heart rate and active energy between `fromMs` and `toMs` from the native
 * health store, plus time-in-zone when `opts.maxHr` is given. Foreground only —
 * native reads are unreliable headless. Null when unavailable or when nothing
 * was measured in the window.
 */
export function readWindowVitals(
    fromMs: number, toMs: number, opts: WindowVitalsOptions = {},
): Promise<WindowVitals | null> {
    if (!(toMs > fromMs)) return Promise.resolve(null);
    const maxHr = opts.maxHr ?? null;
    if (Platform.OS === 'ios') return readWindowVitalsIOS(fromMs, toMs, maxHr);
    if (Platform.OS === 'android') return readWindowVitalsAndroid(fromMs, toMs, maxHr);
    return Promise.resolve(null);
}

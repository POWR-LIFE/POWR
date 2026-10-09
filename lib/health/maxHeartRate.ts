/**
 * The user's max heart rate, read from the phone's health store — what
 * lib/health/hrZones measures a workout's zones against.
 *
 * HealthKit can share a birth date (if the user allowed it) and both stores
 * know the highest heart rate the user has actually reached. maxHrFrom() turns
 * those into one number; this module only does the reading. Cached for the
 * app session: neither input moves within a day, and a sync reads zones for up
 * to a week of workouts at once.
 *
 * Never throws. Null means "no zones": nothing readable, or no effort yet high
 * enough to measure against.
 */

import { Platform } from 'react-native';

import { maxHrFrom } from './hrZones';

/** How far back the observed peak looks. */
const PEAK_LOOKBACK_DAYS = 180;
const CACHE_MS = 12 * 60 * 60 * 1000;

let cached: { value: number | null; at: number } | null = null;

async function readIOS(from: Date, to: Date): Promise<{ birthDate: Date | null; observedPeak: number | null }> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const HK = require('@kingstinct/react-native-healthkit') as typeof import('@kingstinct/react-native-healthkit');

    let birthDate: Date | null = null;
    try {
        // Readable only if the user shared it (HKCharacteristicTypeIdentifierDateOfBirth).
        birthDate = HK.getDateOfBirth() ?? null;
    } catch { /* not shared */ }

    let observedPeak: number | null = null;
    try {
        const res = await HK.queryStatisticsForQuantity('HKQuantityTypeIdentifierHeartRate', ['discreteMax'], {
            filter: { date: { startDate: from, endDate: to } },
            unit: 'count/min',
        });
        observedPeak = res.maximumQuantity?.quantity ?? null;
    } catch { /* heart rate not readable */ }

    return { birthDate, observedPeak };
}

async function readAndroid(from: Date, to: Date): Promise<{ birthDate: Date | null; observedPeak: number | null }> {
    // Health Connect holds no birth date — the observed peak is all there is.
    let observedPeak: number | null = null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { initialize, aggregateRecord } = require('react-native-health-connect');
        await initialize();
        const hr = await aggregateRecord({
            recordType: 'HeartRate',
            timeRangeFilter: { operator: 'between', startTime: from.toISOString(), endTime: to.toISOString() },
        });
        if ((hr?.MEASUREMENTS_COUNT ?? 0) > 0) observedPeak = hr.BPM_MAX ?? null;
    } catch { /* heart rate not readable */ }
    return { birthDate: null, observedPeak };
}

/** Max heart rate for zone maths, or null when there's nothing to go on. */
export async function resolveMaxHr(now: number = Date.now()): Promise<number | null> {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
    if (cached && now - cached.at < CACHE_MS) return cached.value;
    try {
        const from = new Date(now - PEAK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
        const to = new Date(now);
        const inputs = Platform.OS === 'ios' ? await readIOS(from, to) : await readAndroid(from, to);
        const value = maxHrFrom({ ...inputs, now });
        cached = { value, at: now };
        return value;
    } catch (e) {
        console.warn('[maxHeartRate] read failed:', e);
        return null;
    }
}

/** Drops the cached value — after the user grants a new permission. */
export function forgetMaxHr(): void {
    cached = null;
}

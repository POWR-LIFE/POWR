/**
 * lib/health/dailyVitals — the week's resting HR and HRV from the phone's
 * health store, one 'daily' row per day (what terra-webhook writes for cloud
 * wearables).
 *
 * health_snapshots has no UPDATE policy for users, so every change is a new
 * row. What's under test is the bound on that: a day is written again only
 * when its numbers changed, today at most every two hours, and a past day's
 * row lands at the end of that day so it outranks rows written while the day
 * was still running.
 */

const mockPlatform = { OS: 'ios' as string };
jest.mock('react-native', () => ({ Platform: { get OS() { return mockPlatform.OS; } } }));

const mockQueryStats = jest.fn();
jest.mock('@kingstinct/react-native-healthkit', () => ({
    queryStatisticsForQuantity: (...args: unknown[]) => mockQueryStats(...args),
}), { virtual: true });

const mockSave = jest.fn(async (_p: Record<string, unknown>) => {});
jest.mock('@/lib/api/activity', () => ({ saveHealthSnapshot: (p: Record<string, unknown>) => mockSave(p) }));

let mockExisting: unknown[] = [];
const mockQuery: Record<string, jest.Mock> = {
    select: jest.fn(() => mockQuery),
    eq: jest.fn(() => mockQuery),
    is: jest.fn(() => mockQuery),
    gte: jest.fn(async () => ({ data: mockExisting, error: null })),
};
jest.mock('@/lib/supabase', () => ({
    supabase: { from: jest.fn(() => mockQuery) },
    getSessionUser: jest.fn(async () => ({ id: 'user-1' })),
}));

import {
    localDateKey,
    planDailyVitalWrites,
    syncDailyVitals,
    TODAY_REWRITE_MS,
    type DailyVitalsRow,
} from '@/lib/health/dailyVitals';

// 15:00 local on 7 Oct — the tests reason in the device's own calendar.
const NOW = new Date(2026, 9, 7, 15, 0, 0);
const TODAY = localDateKey(NOW);
const YESTERDAY = localDateKey(new Date(2026, 9, 6));
const local = (d: number, h: number, m = 0, s = 0) => new Date(2026, 9, d, h, m, s).toISOString();
const row = (recorded_at: string, hr_resting: number | null, extras: Record<string, unknown> | null = null): DailyVitalsRow =>
    ({ recorded_at, hr_resting, extras });

describe('planDailyVitalWrites', () => {
    it('writes each day that has a reading, today now and a past day at its close', () => {
        const writes = planDailyVitalWrites([
            { date: TODAY, restingHr: 58.4, hrv: 41.26 },
            { date: YESTERDAY, restingHr: 60, hrv: null },
            { date: localDateKey(new Date(2026, 9, 5)), restingHr: null, hrv: null },
        ], [], 'hrv_sdnn', NOW);

        expect(writes).toEqual([
            { recordedAt: NOW.toISOString(), restingHr: 58, hrv: 41.3 },
            { recordedAt: local(6, 23, 59), restingHr: 60, hrv: null },
        ]);
    });

    it('writes nothing when the numbers already on record are the same', () => {
        const writes = planDailyVitalWrites(
            [{ date: YESTERDAY, restingHr: 60.2, hrv: 44.04 }],
            [row(local(6, 23, 59), 60, { scope: 'day', hrv_sdnn: 44 })],
            'hrv_sdnn', NOW,
        );
        expect(writes).toEqual([]);
    });

    it('compares HRV under the key this store writes', () => {
        // The same 44 under the OTHER measure's key is not the same reading.
        const writes = planDailyVitalWrites(
            [{ date: YESTERDAY, restingHr: 60, hrv: 44 }],
            [row(local(6, 23, 59), 60, { hrv_rmssd: 44 })],
            'hrv_sdnn', NOW,
        );
        expect(writes).toHaveLength(1);
    });

    it("rewrites today's moving numbers at most every two hours", () => {
        const reading = [{ date: TODAY, restingHr: 57, hrv: 48 }];
        const recent = [row(new Date(NOW.getTime() - TODAY_REWRITE_MS + 60_000).toISOString(), 58, { hrv_sdnn: 41 })];
        expect(planDailyVitalWrites(reading, recent, 'hrv_sdnn', NOW)).toEqual([]);

        const older = [row(new Date(NOW.getTime() - TODAY_REWRITE_MS).toISOString(), 58, { hrv_sdnn: 41 })];
        expect(planDailyVitalWrites(reading, older, 'hrv_sdnn', NOW)).toEqual([
            { recordedAt: NOW.toISOString(), restingHr: 57, hrv: 48 },
        ]);
    });

    it("stamps a past day's final numbers after the rows written while it was running", () => {
        const reading = [{ date: YESTERDAY, restingHr: 59, hrv: 46 }];

        // Written mid-day yesterday → the final row lands at 23:59.
        expect(planDailyVitalWrites(reading, [row(local(6, 10, 0), 61)], 'hrv_sdnn', NOW))
            .toEqual([{ recordedAt: local(6, 23, 59), restingHr: 59, hrv: 46 }]);

        // A final row already at 23:59 → the next one a second after it.
        expect(planDailyVitalWrites(reading, [row(local(6, 23, 59), 61)], 'hrv_sdnn', NOW))
            .toEqual([{ recordedAt: local(6, 23, 59, 1), restingHr: 59, hrv: 46 }]);

        // ...but never into the next day.
        const lastSecond = new Date(2026, 9, 6, 23, 59, 59, 500).toISOString();
        expect(planDailyVitalWrites(reading, [row(lastSecond, 61)], 'hrv_sdnn', NOW)).toEqual([]);
    });

    it('drops readings no body produces', () => {
        expect(planDailyVitalWrites([{ date: YESTERDAY, restingHr: 210, hrv: 0 }], [], 'hrv_sdnn', NOW)).toEqual([]);
    });
});

describe('syncDailyVitals (iOS)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPlatform.OS = 'ios';
        mockExisting = [];
        mockQueryStats.mockImplementation(async (id: string) =>
            id === 'HKQuantityTypeIdentifierRestingHeartRate'
                ? { averageQuantity: { quantity: 57.6 } }
                : { averageQuantity: { quantity: 43.21 } });
    });

    it("reads the week from HealthKit and writes SDNN under its own key, as 'daily' rows", async () => {
        const written = await syncDailyVitals({ force: true, now: NOW });

        expect(written).toBe(7);
        expect(mockSave).toHaveBeenCalledTimes(7);
        expect(mockSave.mock.calls[0][0]).toEqual({
            activityType: 'daily',
            source: 'healthkit',
            hrResting: 58,
            extras: { scope: 'day', hrv_sdnn: 43.2 },
            recordedAt: NOW.toISOString(),
        });
        // SDNN read in ms; resting HR in bpm.
        const units = mockQueryStats.mock.calls.map(c => [c[0], (c[2] as { unit: string }).unit]);
        expect(units).toContainEqual(['HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'ms']);
        expect(units).toContainEqual(['HKQuantityTypeIdentifierRestingHeartRate', 'count/min']);
    });

    it('runs at most hourly unless forced', async () => {
        await syncDailyVitals({ force: true, now: NOW });
        mockQueryStats.mockClear();

        expect(await syncDailyVitals({ now: new Date(NOW.getTime() + 30 * 60_000) })).toBe(0);
        expect(mockQueryStats).not.toHaveBeenCalled();
    });

    it('writes nothing when the phone holds no resting HR or HRV (no watch)', async () => {
        mockQueryStats.mockResolvedValue({});
        expect(await syncDailyVitals({ force: true, now: NOW })).toBe(0);
        expect(mockSave).not.toHaveBeenCalled();
    });
});

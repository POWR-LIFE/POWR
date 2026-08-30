/**
 * The 7-day native health backfill pays for the week exactly as the live sync
 * would have — through the live sync's own write functions, priced by the
 * shared lib/health/points ladder. Until 2026-08-30 it wrote 0-point rows by
 * design while the Terra wearable backfill scored the same week like live.
 */

jest.mock('@/lib/supabase', () => {
    const chain = (): any => {
        const c: any = {};
        for (const m of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'limit', 'maybeSingle', 'single']) {
            c[m] = jest.fn(() => c);
        }
        c.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
        return c;
    };
    return {
        supabase: { auth: { updateUser: jest.fn() }, from: jest.fn(() => chain()) },
        getSessionUser: jest.fn(),
    };
});
jest.mock('@/hooks/useHealthData', () => ({ getWeekHistoryNow: jest.fn() }));
jest.mock('@/lib/api/activity', () => {
    const actual = jest.requireActual('@/lib/api/activity');
    return {
        saveHealthSnapshot: jest.fn(),
        buildStreakFromDates: jest.fn(async () => 3),
        logManualSession: jest.fn(async () => 'sess-id'),
        logHealthWalkingSession: jest.fn(async () => 'walk-id'),
        updateHealthWalkingSession: jest.fn(),
        getWalkingDaySummary: jest.fn(async () => ({ session: null, dayPoints: 0 })),
        stepTierPoints: actual.stepTierPoints,
        WALKING_DAILY_CAP: actual.WALKING_DAILY_CAP,
    };
});
jest.mock('@/lib/health/windowVitals', () => ({
    readWindowVitals: jest.fn(async () => ({ hrAvg: 150, hrMax: 172, caloriesActive: 320 })),
    SESSION_SCOPED_EXTRAS: { scope: 'session' },
}));
jest.mock('@/lib/pointsEvents', () => ({ emitPointsChanged: jest.fn() }));

import {
    getWalkingDaySummary,
    logHealthWalkingSession,
    logManualSession,
    saveHealthSnapshot,
    updateHealthWalkingSession,
} from '@/lib/api/activity';
import { calculateBasePoints, calculateSleepPoints } from '@/lib/health/points';
import { syncHistoricalHealthData } from '@/lib/api/onboardingSync';
import { emitPointsChanged } from '@/lib/pointsEvents';
import { getSessionUser, supabase } from '@/lib/supabase';

const mockUser = getSessionUser as jest.Mock;
const mockLog = logManualSession as jest.Mock;
const mockWalk = logHealthWalkingSession as jest.Mock;
const mockWalkUpdate = updateHealthWalkingSession as jest.Mock;
const mockDaySummary = getWalkingDaySummary as jest.Mock;

function day(date: string, extra: Record<string, unknown> = {}) {
    return { date, steps: 0, activities: [], sleep: null, heartRate: null, calories: null, ...extra };
}

const localKey = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

beforeEach(() => {
    jest.clearAllMocks();
    mockUser.mockResolvedValue({ id: 'u1', user_metadata: {} });
    (supabase.auth.updateUser as unknown as jest.Mock).mockResolvedValue({ data: {}, error: null });
    mockDaySummary.mockResolvedValue({ session: null, dayPoints: 0 });
});

describe('syncHistoricalHealthData pays the week', () => {
    it('prices a run, a night and a step day with the live scorer and writes them through the live path', async () => {
        const run = { type: 'HKWorkoutActivityTypeRunning', startedAt: '2026-08-28T12:22:23.000Z', durationMin: 31, distanceM: 6012, rawName: 'Outdoor Run' };
        const sleep = { startedAt: '2026-08-27T22:30:00.000Z', endedAt: '2026-08-28T06:40:00.000Z', durationHours: 8.2, deepHours: 1.6, remHours: 1.5, lightHours: 5.1 };
        const result = await syncHistoricalHealthData([
            day('2026-08-28', { steps: 12000, activities: [run], sleep }),
        ]);

        // Run: 31 min / 6.01 km → the 5 km rung, same as useHealthSync.
        expect(calculateBasePoints('running', 31, 6012)).toBe(8);
        expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({
            type: 'running',
            points: 8,
            duration_sec: 31 * 60,
            distance_m: 6012,
            started_at: run.startedAt,
            healthVerified: true,
            healthSource: 'health',
            rawActivityName: 'Outdoor Run',
            hr_avg: 150,
            pointsFor: expect.any(Function),
        }));
        // pointsFor re-prices a stitched/restated session with the same ladder.
        const runCall = mockLog.mock.calls.find(c => c[0].type === 'running')![0];
        expect(runCall.pointsFor(65, null)).toBe(10);

        // Sleep: 8.2h with a 38% restorative share → full 5.
        expect(calculateSleepPoints(8.2, 1.6, 1.5)).toBe(5);
        expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({
            type: 'sleep', points: 5, started_at: sleep.startedAt, healthVerified: true, sleepDeepH: 1.6,
        }));

        // Walking: 12,000 steps → tier 5, keyed on LOCAL midnight of that day, not UTC.
        const localMidnight = new Date(2026, 7, 28).toISOString();
        const nextMidnight = new Date(2026, 7, 29).toISOString();
        expect(mockWalk).toHaveBeenCalledWith(12000, 5, 'health', localMidnight, nextMidnight);

        // Snapshots are linked to the session that was written (never orphaned).
        expect(saveHealthSnapshot).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-id', activityType: run.type }));
        expect(saveHealthSnapshot).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'walk-id', activityType: 'walking' }));

        expect(result.totalSessions).toBe(3);
        expect(result.totalPoints).toBe(18);
        expect(result.dailyBreakdown[0]).toMatchObject({ points: 18, sessionCount: 3, activities: ['Running'], sleepHours: 8.2 });
        expect(result.streakDays).toBe(3);
        expect(emitPointsChanged).toHaveBeenCalled();
        expect(supabase.auth.updateUser).toHaveBeenCalledWith({ data: { initial_health_sync_complete: true } });
    });

    it('counts what the session was worth even when it is below the ladder floor', async () => {
        // A 12-minute jog is recorded (the live sync records it too) but pays 0.
        await syncHistoricalHealthData([
            day('2026-08-27', { activities: [{ type: 'Running', startedAt: '2026-08-27T07:00:00.000Z', durationMin: 12 }] }),
        ]);
        expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ type: 'running', points: 0 }));
    });

    it('does not record a walk or hike as a workout — steps pay the day, as on the live path', async () => {
        const result = await syncHistoricalHealthData([
            day('2026-08-27', { steps: 3000, activities: [{ type: 'HKWorkoutActivityTypeHiking', startedAt: '2026-08-27T09:00:00.000Z', durationMin: 90 }] }),
        ]);
        expect(mockLog).not.toHaveBeenCalled();
        // 3,000 steps is under the first tier: the day is still recorded, at 0.
        expect(mockWalk).toHaveBeenCalledWith(3000, 0, 'health', expect.any(String), expect.any(String));
        expect(result.totalPoints).toBe(0);
    });

    it('tops up a day the walking sync already holds by the tier delta, under the daily cap', async () => {
        mockDaySummary.mockResolvedValue({ session: { id: 'w0', steps: 5000, points: 2 }, dayPoints: 2 });
        const result = await syncHistoricalHealthData([day('2026-08-26', { steps: 9000 })]);
        // 9,000 → tier 4; already paid 2 → +2. Not a second session.
        expect(mockWalkUpdate).toHaveBeenCalledWith('w0', 9000, 2, new Date(2026, 7, 27).toISOString());
        expect(mockWalk).not.toHaveBeenCalled();
        expect(result.totalSessions).toBe(0);
        expect(result.totalPoints).toBe(2);
    });

    it("leaves TODAY's steps to syncWalkingNow rather than racing it", async () => {
        const today = localKey(new Date());
        const result = await syncHistoricalHealthData([day(today, { steps: 15000 })]);
        expect(mockWalk).not.toHaveBeenCalled();
        expect(mockWalkUpdate).not.toHaveBeenCalled();
        expect(result.totalPoints).toBe(0);
        // …but the day still counts as active for the streak.
        expect(result.activeDates).toEqual([today]);
    });

    it('skips a workout the live sync already recorded (same type + start instant)', async () => {
        const existingChain = supabase.from as jest.Mock;
        existingChain.mockImplementationOnce(() => {
            const c: any = {};
            for (const m of ['select', 'eq', 'in', 'gte', 'lt']) c[m] = jest.fn(() => c);
            c.then = (resolve: (v: unknown) => void) => resolve({
                data: [{ type: 'running', started_at: '2026-08-28T12:22:23+00:00' }], error: null,
            });
            return c;
        });
        const result = await syncHistoricalHealthData([
            day('2026-08-28', { activities: [{ type: 'Running', startedAt: '2026-08-28T12:22:23.000Z', durationMin: 31, distanceM: 6012 }] }),
        ]);
        expect(mockLog).not.toHaveBeenCalled();
        expect(result.totalPoints).toBe(0);
    });

    it('one failing write never aborts the rest of the week', async () => {
        mockLog.mockRejectedValueOnce(new Error('boom'));
        const result = await syncHistoricalHealthData([
            day('2026-08-27', { activities: [{ type: 'Running', startedAt: '2026-08-27T07:00:00.000Z', durationMin: 40, distanceM: 8000 }] }),
            day('2026-08-28', { steps: 11000 }),
        ]);
        expect(mockWalk).toHaveBeenCalledWith(11000, 5, 'health', expect.any(String), expect.any(String));
        expect(result.totalPoints).toBe(5);
        expect(supabase.auth.updateUser).toHaveBeenCalled();
    });
});

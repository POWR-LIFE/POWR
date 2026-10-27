/**
 * The health sync's triggers (lib/health/healthSync): one pass at a time, the
 * wake path's 10-minute gap, and the store-change path's settle + 45 s gap.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@/lib/health/dailyVitals', () => ({ syncDailyVitals: jest.fn(async () => {}) }));
jest.mock('@/lib/health/gymReconcile', () => ({ reconcileRecentGymSessions: jest.fn(async () => {}) }));
jest.mock('@/lib/health/gymVitals', () => ({ captureRecentGymVitals: jest.fn(async () => {}) }));
jest.mock('@/lib/health/maxHeartRate', () => ({ resolveMaxHr: jest.fn(async () => null) }));
jest.mock('@/lib/health/runInference', () => ({ getInferredActivitiesForWeek: jest.fn(async () => []) }));
jest.mock('@/lib/health/windowVitals', () => ({ readWindowVitals: jest.fn(async () => null), sessionExtras: jest.fn() }));
jest.mock('@/lib/health/terraPause', () => ({ hydrateTerraPause: jest.fn(async () => false) }));
jest.mock('@/lib/health/garminDirect', () => ({ hydrateGarminDirect: jest.fn(async () => false) }));
jest.mock('@/lib/api/activity', () => ({ logManualSession: jest.fn(async () => null), saveHealthSnapshot: jest.fn(async () => {}) }));
jest.mock('@/lib/api/notifications', () => ({ triggerServerNotification: jest.fn(async () => {}) }));
jest.mock('@/lib/health/dataSource', () => ({ sourceLabel: (s: unknown) => String(s), verificationFromProvenance: () => 'health' }));
jest.mock('@/lib/health/points', () => ({
    calculateBasePoints: () => 10, calculateSleepPoints: () => 0, mapHealthType: (t: string) => t,
}));
jest.mock('@/lib/health/providers', () => ({
    getNativeProviderId: () => 'apple-health',
    isPausedProvider: () => false,
    isServerDelivered: (id: string | null) => id === 'garmin',
    verificationForProvider: () => 'health',
}));

const mockWeekHistory = jest.fn(async () => [] as unknown[]);
jest.mock('@/hooks/useHealthData', () => ({
    getWeekHistoryNow: () => mockWeekHistory(),
    getHeartRateTodayNow: jest.fn(async () => null),
    getCaloriesTodayNow: jest.fn(async () => null),
}));

let mockActiveProvider: string | null = null;
const mockChain = () => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const k of ['select', 'eq', 'in', 'gte']) q[k] = self;
    q.single = async () => ({ data: { active_health_provider: mockActiveProvider } });
    q.then = (res: (v: unknown) => void) => res({ data: [] });
    return q;
};
let mockUser: { id: string } | null = { id: 'u1' };
jest.mock('@/lib/supabase', () => ({
    getSessionUser: async () => mockUser,
    supabase: { from: () => mockChain() },
}));

import {
    __resetHealthSyncForTests, headlessHealthSyncContext, lastHealthSyncAt, syncHealthFromWake, syncHealthNow, syncHealthOnStoreChange,
} from '@/lib/health/healthSync';

const ctx = () => ({
    activeId: null, isNativeProvider: true, source: 'healthkit' as const, verificationSource: 'health' as const,
    getWeekHistory: () => mockWeekHistory() as Promise<never[]>,
    getHeartRateToday: async () => null,
    getCaloriesToday: async () => null,
});

beforeEach(async () => {
    __resetHealthSyncForTests();
    await AsyncStorage.clear();
    mockWeekHistory.mockClear();
    mockUser = { id: 'u1' };
    mockActiveProvider = null;
});

describe('one pass at a time', () => {
    it('joins a run already in flight instead of starting a second', async () => {
        let release: () => void = () => {};
        mockWeekHistory.mockImplementationOnce(() => new Promise(res => { release = () => res([]); }));
        const a = syncHealthNow(ctx());
        const b = syncHealthNow(ctx());
        expect(b).toBe(a);
        release();
        await a;
        expect(mockWeekHistory).toHaveBeenCalledTimes(1);
        expect(lastHealthSyncAt()).toBeGreaterThan(0);
    });
});

describe('the wake path', () => {
    it('runs once, then not again within 10 minutes', async () => {
        await syncHealthFromWake();
        await syncHealthFromWake();
        expect(mockWeekHistory).toHaveBeenCalledTimes(1);
    });

    it('runs again once the gap has passed', async () => {
        await AsyncStorage.setItem('@powr/health_wake_sync_at', String(Date.now() - 11 * 60_000));
        await syncHealthFromWake();
        expect(mockWeekHistory).toHaveBeenCalledTimes(1);
    });

    it('stamps before the read, so a hung read does not hold the gate open', async () => {
        mockWeekHistory.mockImplementationOnce(() => new Promise(() => {}));
        void syncHealthFromWake();
        await new Promise(r => setTimeout(r, 0));
        const stamp = Number(await AsyncStorage.getItem('@powr/health_wake_sync_at'));
        expect(stamp).toBeGreaterThan(0);
    });

    it('does nothing with no member signed in', async () => {
        mockUser = null;
        await syncHealthFromWake();
        expect(mockWeekHistory).not.toHaveBeenCalled();
    });
});

describe('the headless context', () => {
    it('is the phone store for a native or paused provider', async () => {
        expect((await headlessHealthSyncContext())?.source).toBe('healthkit');
    });

    it('is nothing for a provider the server delivers for', async () => {
        mockActiveProvider = 'garmin';
        expect(await headlessHealthSyncContext()).toBeNull();
    });

    it('is nothing for an OAuth provider the foreground hook owns', async () => {
        mockActiveProvider = 'whoop';
        expect(await headlessHealthSyncContext()).toBeNull();
    });
});

describe('the store-change path', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

    it('lets a burst settle, then runs once', async () => {
        syncHealthOnStoreChange();
        syncHealthOnStoreChange();
        syncHealthOnStoreChange();
        jest.advanceTimersByTime(7_999);
        await flush();
        expect(mockWeekHistory).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        await flush();
        expect(mockWeekHistory).toHaveBeenCalledTimes(1);
    });

    it('skips when a pass finished under 45 s ago', async () => {
        await syncHealthNow(ctx());
        expect(mockWeekHistory).toHaveBeenCalledTimes(1);
        syncHealthOnStoreChange();
        jest.advanceTimersByTime(8_000);
        await flush();
        expect(mockWeekHistory).toHaveBeenCalledTimes(1);
    });
});

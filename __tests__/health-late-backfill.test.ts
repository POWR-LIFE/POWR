/**
 * The 7-day history backfill used to run in exactly one place: onboarding's
 * health step. Anyone who skipped there and connected later (Settings, the Home
 * prime sheet, or by granting in OS settings) got today onward and no history at
 * all. `backfillHealthHistoryIfNeeded` closes that gap — these are the
 * invariants that keep it from misfiring.
 */

jest.mock('@/lib/supabase', () => {
    // A chainable, awaitable query stub: every builder method returns the chain,
    // awaiting it yields an empty result (no existing sessions).
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

jest.mock('@/lib/api/activity', () => ({
    saveHealthSnapshot: jest.fn(),
    buildStreakFromDates: jest.fn(async () => 0),
    logManualSession: jest.fn(async () => 'sess'),
    logHealthWalkingSession: jest.fn(async () => 'walk'),
    updateHealthWalkingSession: jest.fn(),
    getWalkingDaySummary: jest.fn(async () => ({ session: null, dayPoints: 0 })),
    stepTierPoints: jest.fn(() => 0),
    WALKING_DAILY_CAP: 5,
}));
jest.mock('@/lib/health/windowVitals', () => ({ readWindowVitals: jest.fn(async () => null), SESSION_SCOPED_EXTRAS: { scope: 'session' } }));
jest.mock('@/lib/pointsEvents', () => ({ emitPointsChanged: jest.fn() }));

import { getWeekHistoryNow } from '@/hooks/useHealthData';
import {
    backfillHealthHistoryIfNeeded,
    setOnboardingOwnsBackfill,
} from '@/lib/api/onboardingSync';
import { getSessionUser, supabase } from '@/lib/supabase';

const mockWeek = getWeekHistoryNow as jest.Mock;
const mockUser = getSessionUser as jest.Mock;
const mockUpdateUser = supabase.auth.updateUser as unknown as jest.Mock;

/** A day with nothing in it — enough to exercise the loop without any inserts. */
function emptyDay(date: string) {
    return { date, steps: 0, activities: [], sleep: null, heartRate: null, calories: null };
}

beforeEach(() => {
    jest.clearAllMocks();
    setOnboardingOwnsBackfill(false);
    mockUser.mockResolvedValue({ id: 'u1', user_metadata: {} });
    mockUpdateUser.mockResolvedValue({ data: {}, error: null });
});

describe('backfillHealthHistoryIfNeeded', () => {
    it('pulls the week and marks the one-shot flag on a first late connect', async () => {
        mockWeek.mockResolvedValue([emptyDay('2026-08-20'), emptyDay('2026-08-21')]);

        const result = await backfillHealthHistoryIfNeeded();

        expect(mockWeek).toHaveBeenCalled();
        expect(result).not.toBeNull();
        expect(mockUpdateUser).toHaveBeenCalledWith({
            data: { initial_health_sync_complete: true },
        });
    });

    it('stands down while onboarding owns the sync, without touching the health store', async () => {
        // Onboarding renders its own per-day progress. On Android the Health
        // Connect dialog bounces the app through background→active, so the
        // auto-connect listener can fire mid-flow; if it won that race,
        // onboarding would report "0 sessions synced" over a real week.
        setOnboardingOwnsBackfill(true);

        expect(await backfillHealthHistoryIfNeeded()).toBeNull();
        expect(mockWeek).not.toHaveBeenCalled();
        expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('skips an account that already synced, before the slow week read', async () => {
        mockUser.mockResolvedValue({
            id: 'u1',
            user_metadata: { initial_health_sync_complete: true },
        });

        expect(await backfillHealthHistoryIfNeeded()).toBeNull();
        expect(mockWeek).not.toHaveBeenCalled();
    });

    it('does NOT burn the one-shot flag when the store reads back empty', async () => {
        // A grant that isn't live yet reads as zero days. Syncing that would set
        // initial_health_sync_complete on nothing and there'd be no second run.
        mockWeek.mockResolvedValue([]);

        expect(await backfillHealthHistoryIfNeeded()).toBeNull();
        expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('swallows failures so a broken backfill never fails the connect', async () => {
        mockWeek.mockRejectedValue(new Error('Health Connect unavailable'));

        await expect(backfillHealthHistoryIfNeeded()).resolves.toBeNull();
    });
});

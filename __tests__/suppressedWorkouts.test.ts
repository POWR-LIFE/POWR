/**
 * "Reward the gym, record the run" (Jamie, 2026-08-21): a workout suppressed by
 * a geofence check-in surfaces in history and Progress stats as an unrewarded
 * session. These tests pin the two rules the surfacing depends on:
 *
 * 1. It must NEVER pay or count as payable — the shaped session carries an
 *    empty ledger and the unrewarded flag, so every consumer that sums
 *    point_transactions renders zero and the feed shows an em dash.
 * 2. Same-type (gym) suppressions must NEVER surface — the check-in already
 *    shows that time, and surfacing both would double the visit in stats,
 *    which is exactly the double-count the supersede rule exists to prevent.
 */
import {
    fetchSuppressedWorkouts,
    suppressedToSession,
    surfacesInStats,
    type SuppressedWorkoutRow,
} from '@/lib/api/suppressedWorkouts';

jest.mock('@/lib/supabase', () => ({
    supabase: {
        from: jest.fn(() => { throw new Error('unexpected supabase call'); }),
    },
}));

const RUN: SuppressedWorkoutRow = {
    id: 'abc-123',
    type: 'running',
    started_at: '2026-08-21T18:00:00Z',
    ended_at: '2026-08-21T18:32:00Z',
    duration_sec: 1920,
    distance_m: 5210,
    hr_avg: 151,
    source: 'whoop',
    raw_activity_name: 'Running',
};

describe('surfacesInStats', () => {
    it('surfaces cross-type workouts — the activity done inside the visit', () => {
        for (const t of ['running', 'cycling', 'hiit', 'yoga', 'swimming', 'sports']) {
            expect(surfacesInStats(t)).toBe(true);
        }
    });

    it('hides same-type gym suppressions and day-wide aggregates', () => {
        expect(surfacesInStats('gym')).toBe(false);
        expect(surfacesInStats('walking')).toBe(false);
        expect(surfacesInStats('sleep')).toBe(false);
    });
});

describe('suppressedToSession', () => {
    it('shapes an unrewarded session with an empty ledger', () => {
        const s = suppressedToSession(RUN);
        expect(s.unrewarded).toBe(true);
        expect(s.point_transactions).toEqual([]);
        expect(s.type).toBe('running');
        expect(s.duration_sec).toBe(1920);
        expect(s.distance_m).toBe(5210);
    });

    it('namespaces the id so it can never collide with a session id in a list key', () => {
        expect(suppressedToSession(RUN).id).toBe('suppressed:abc-123');
    });

    it('maps native stores to health verification and Terra providers to wearable', () => {
        expect(suppressedToSession({ ...RUN, source: 'healthkit' }).verification).toBe('health');
        expect(suppressedToSession({ ...RUN, source: 'health_connect' }).verification).toBe('health');
        expect(suppressedToSession({ ...RUN, source: 'whoop' }).verification).toBe('wearable');
        expect(suppressedToSession({ ...RUN, source: null }).verification).toBe('wearable');
    });
});

describe('fetchSuppressedWorkouts', () => {
    it('short-circuits non-surfaceable per-type reads without touching the network', async () => {
        // The mock throws on any supabase.from() call, so reaching the query
        // would fail this test — gym/walking/sleep must return [] up front.
        await expect(fetchSuppressedWorkouts('uid', { type: 'gym' })).resolves.toEqual([]);
        await expect(fetchSuppressedWorkouts('uid', { type: 'walking' })).resolves.toEqual([]);
        await expect(fetchSuppressedWorkouts('uid', { type: 'sleep' })).resolves.toEqual([]);
    });

    it('returns [] instead of throwing when the read fails — stats must never blank', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(fetchSuppressedWorkouts('uid', { type: 'running' })).resolves.toEqual([]);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

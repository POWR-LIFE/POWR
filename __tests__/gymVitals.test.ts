/**
 * lib/health/gymVitals — attaches the phone's window-read heart rate / calories
 * to recent geofence gym check-ins.
 *
 * Write-once per session, so the SELECTION rules are what's worth pinning: a
 * live visit must not be frozen mid-way, a session already carrying vitals must
 * not get a second row, a backstop-clamped 12h row must not restate the day, a
 * too-fresh exit must wait for the watch to sync, and "nothing measured" must
 * leave no row (so the next sync retries) rather than a permanent blank.
 */

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const mockRead = jest.fn();
jest.mock('@/lib/health/windowVitals', () => ({
    ...jest.requireActual('@/lib/health/windowVitals'),
    readWindowVitals: (...args: unknown[]) => mockRead(...args),
}));

const mockSave = jest.fn(async (_params: Record<string, unknown>) => {});
jest.mock('@/lib/api/activity', () => ({ saveHealthSnapshot: (params: Record<string, unknown>) => mockSave(params) }));

jest.mock('@/lib/supabase', () => ({
    supabase: { from: jest.fn() },
    getSessionUser: jest.fn(),
}));

import { captureRecentGymVitals } from '@/lib/health/gymVitals';
import { getSessionUser, supabase } from '@/lib/supabase';

const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);
const H = 60 * 60 * 1000;

type Row = {
    id: string;
    started_at: string;
    ended_at: string | null;
    duration_sec: number;
    health_snapshots: { hr_avg: number | null; calories_active: number | null }[];
};

function row(id: string, endedAgoMs: number, durationSec = 3600, snaps: Row['health_snapshots'] = []): Row {
    const end = NOW - endedAgoMs;
    return {
        id,
        started_at: new Date(end - durationSec * 1000).toISOString(),
        ended_at: new Date(end).toISOString(),
        duration_sec: durationSec,
        health_snapshots: snaps,
    };
}

/** Stubs the two reads: activity_sessions (terminal .limit) and gym_visits (terminal .in). */
function mockDb(sessions: Row[], liveSessionIds: string[] = []) {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'gte', 'order', 'is']) b[m] = jest.fn(() => b);
        if (table === 'activity_sessions') {
            b.limit = jest.fn(async () => ({ data: sessions, error: null }));
        } else {
            b.in = jest.fn(async () => ({
                data: liveSessionIds.map(id => ({ claimed_session_id: id })), error: null,
            }));
        }
        return b;
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    (getSessionUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    mockRead.mockResolvedValue({ hrAvg: 131, hrMax: 164, caloriesActive: 402 });
});

it('writes a session-scoped snapshot over the visit\'s own window', async () => {
    const s = row('s1', 2 * H, 3300);
    mockDb([s]);

    await captureRecentGymVitals(NOW);

    expect(mockRead).toHaveBeenCalledWith(+new Date(s.started_at), +new Date(s.ended_at!));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0]).toMatchObject({
        sessionId: 's1',
        hrAvg: 131, hrMax: 164, caloriesActive: 402,
        activityType: 'gym',
        durationSec: 3300,
        source: 'healthkit',
        extras: { scope: 'session' },
    });
});

it('leaves a session that already carries vitals alone', async () => {
    mockDb([row('s1', 2 * H, 3600, [{ hr_avg: 120, calories_active: null }])]);
    await captureRecentGymVitals(NOW);
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
});

it('skips a session whose visit is still open — a partial read would be frozen forever', async () => {
    mockDb([row('live', 2 * H), row('done', 3 * H)], ['live']);
    await captureRecentGymVitals(NOW);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0]).toMatchObject({ sessionId: 'done' });
});

it('waits for the watch to sync before reading a just-ended visit', async () => {
    mockDb([row('fresh', 5 * 60 * 1000)]);
    await captureRecentGymVitals(NOW);
    expect(mockRead).not.toHaveBeenCalled();
});

it('never reads a backstop-clamped 12h row', async () => {
    mockDb([row('clamped', 2 * H, 12 * 60 * 60)]);
    await captureRecentGymVitals(NOW);
    expect(mockRead).not.toHaveBeenCalled();
});

it('writes nothing when the window measured nothing, so the next sync retries', async () => {
    mockRead.mockResolvedValue(null);
    mockDb([row('s1', 2 * H)]);
    await captureRecentGymVitals(NOW);
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockSave).not.toHaveBeenCalled();
});

it('does nothing signed out', async () => {
    (getSessionUser as jest.Mock).mockResolvedValue(null);
    mockDb([row('s1', 2 * H)]);
    await captureRecentGymVitals(NOW);
    expect(supabase.from).not.toHaveBeenCalled();
});

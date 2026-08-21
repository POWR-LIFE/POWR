jest.mock('@/lib/supabase', () => ({
    supabase: { from: jest.fn() },
    getSessionUser: jest.fn(),
}));

jest.mock('@/lib/device', () => ({ getDeviceId: jest.fn() }));
jest.mock('@/lib/pointsEvents', () => ({ emitPointsChanged: jest.fn() }));

import { logManualSession } from '@/lib/api/activity';
import { getDeviceId } from '@/lib/device';
import { emitPointsChanged } from '@/lib/pointsEvents';
import { getSessionUser, supabase } from '@/lib/supabase';

type SessionRow = {
    id: string;
    user_id: string;
    type: string;
    verification: string;
    started_at: string;
    ended_at: string;
    duration_sec: number;
    distance_m: number | null;
    hr_avg: number | null;
};

type SnapshotRow = {
    id: string;
    session_id: string;
    created_at: string;
    sleep_duration_h: number | null;
    sleep_deep_h: number | null;
    sleep_rem_h: number | null;
    sleep_light_h: number | null;
    duration_sec?: number | null;
    activity_type?: string | null;
    source?: string | null;
};

type TxRow = {
    session_id: string;
    amount: number;
    type: string;
    source?: string | null;
};

const state: {
    sessions: SessionRow[];
    snapshots: SnapshotRow[];
    txs: TxRow[];
} = { sessions: [], snapshots: [], txs: [] };

function matches(row: Record<string, unknown>, filters: Array<{ kind: 'eq' | 'in' | 'gte' | 'lte' | 'lt'; col: string; value: unknown }>) {
    return filters.every(filter => {
        const value = row[filter.col];
        switch (filter.kind) {
            case 'eq': return value === filter.value;
            case 'in': return Array.isArray(filter.value) && filter.value.includes(value as never);
            case 'gte': return String(value) >= String(filter.value);
            case 'lte': return String(value) <= String(filter.value);
            case 'lt': return String(value) < String(filter.value);
        }
    });
}

function rowsFor(table: string) {
    if (table === 'activity_sessions') return state.sessions;
    if (table === 'health_snapshots') return state.snapshots;
    if (table === 'point_transactions') return state.txs;
    throw new Error(`Unexpected table ${table}`);
}

function builder(table: string) {
    const query: {
        op: 'select' | 'update' | 'insert';
        payload?: Record<string, unknown> | Array<Record<string, unknown>>;
        filters: Array<{ kind: 'eq' | 'in' | 'gte' | 'lte' | 'lt'; col: string; value: unknown }>;
        order?: { col: string; ascending: boolean };
        limit?: number;
        maybeSingle?: boolean;
    } = { op: 'select', filters: [] };

    const run = async () => {
        const rows = rowsFor(table);
        if (query.op === 'select') {
            let data = rows.filter(row => matches(row as Record<string, unknown>, query.filters));
            if (query.order) {
                data = [...data].sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
                    query.order!.ascending
                        ? String(a[query.order!.col]).localeCompare(String(b[query.order!.col]))
                        : String(b[query.order!.col]).localeCompare(String(a[query.order!.col])));
            }
            if (query.limit != null) data = data.slice(0, query.limit);
            return { data: query.maybeSingle ? (data[0] ?? null) : data, error: null };
        }

        if (query.op === 'update') {
            for (const row of rows) {
                if (matches(row as Record<string, unknown>, query.filters)) Object.assign(row, query.payload);
            }
            return { data: null, error: null };
        }

        const payloads = Array.isArray(query.payload) ? query.payload : [query.payload ?? {}];
        for (const payload of payloads) rows.push(payload as never);
        return { data: null, error: null };
    };

    const chain: Record<string, unknown> = {
        select: jest.fn(() => chain),
        update: jest.fn((payload: Record<string, unknown>) => { query.op = 'update'; query.payload = payload; return chain; }),
        insert: jest.fn((payload: Record<string, unknown> | Array<Record<string, unknown>>) => { query.op = 'insert'; query.payload = payload; return chain; }),
        eq: jest.fn((col: string, value: unknown) => { query.filters.push({ kind: 'eq', col, value }); return chain; }),
        in: jest.fn((col: string, value: unknown[]) => { query.filters.push({ kind: 'in', col, value }); return chain; }),
        gte: jest.fn((col: string, value: unknown) => { query.filters.push({ kind: 'gte', col, value }); return chain; }),
        lte: jest.fn((col: string, value: unknown) => { query.filters.push({ kind: 'lte', col, value }); return chain; }),
        lt: jest.fn((col: string, value: unknown) => { query.filters.push({ kind: 'lt', col, value }); return chain; }),
        order: jest.fn((col: string, opts?: { ascending?: boolean }) => {
            query.order = { col, ascending: opts?.ascending ?? true };
            return chain;
        }),
        limit: jest.fn((value: number) => { query.limit = value; return chain; }),
        maybeSingle: jest.fn(() => { query.maybeSingle = true; return chain; }),
        then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) => run().then(resolve, reject),
    };
    return chain;
}

beforeEach(() => {
    jest.clearAllMocks();
    state.sessions = [{
        id: 'session-1',
        user_id: 'user-1',
        type: 'sleep',
        verification: 'health',
        started_at: '2026-08-20T22:00:00.000Z',
        ended_at: '2026-08-21T05:00:00.000Z',
        duration_sec: 7 * 3600,
        distance_m: null,
        hr_avg: null,
    }];
    state.snapshots = [{
        id: 'snap-1',
        session_id: 'session-1',
        created_at: '2026-08-21T05:05:00.000Z',
        sleep_duration_h: 7,
        sleep_deep_h: 1,
        sleep_rem_h: 1,
        sleep_light_h: 5,
        duration_sec: 7 * 3600,
        activity_type: 'sleep',
        source: 'healthkit',
    }];
    state.txs = [{ session_id: 'session-1', amount: 4, type: 'earn', source: 'manual_log' }];
    (getSessionUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getDeviceId as jest.Mock).mockResolvedValue('device-1');
    (supabase.from as jest.Mock).mockImplementation((table: string) => builder(table));
});

describe('logManualSession sleep merge', () => {
    it('updates the merged sleep snapshot and tops up points for a fuller restatement', async () => {
        await expect(logManualSession({
            type: 'sleep',
            duration_sec: 8 * 3600,
            started_at: '2026-08-20T22:00:00.000Z',
            points: 5,
            healthVerified: true,
            healthSource: 'health',
            source: 'healthkit',
            sleepDeepH: 1.5,
            sleepRemH: 1.5,
            sleepLightH: 5,
        })).resolves.toBeNull();

        expect(state.sessions).toHaveLength(1);
        expect(state.sessions[0]).toMatchObject({
            id: 'session-1',
            started_at: '2026-08-20T22:00:00.000Z',
            ended_at: '2026-08-21T06:00:00.000Z',
            duration_sec: 8 * 3600,
        });
        expect(state.snapshots).toEqual([expect.objectContaining({
            id: 'snap-1',
            session_id: 'session-1',
            sleep_duration_h: 8,
            sleep_deep_h: 1.5,
            sleep_rem_h: 1.5,
            sleep_light_h: 5,
            duration_sec: 8 * 3600,
            activity_type: 'sleep',
        })]);
        expect(state.txs).toContainEqual(expect.objectContaining({
            session_id: 'session-1',
            amount: 1,
            type: 'earn',
            source: 'health_sync',
        }));
        expect(emitPointsChanged).toHaveBeenCalledTimes(1);
    });
});

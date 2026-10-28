// The real hook path, on the day it broke: London, Wed 28 Oct 2026, three days
// after the clocks went back. A member who has moved every day since 8 Sep.
process.env.TZ = 'Europe/London';

const mockCalls: { table: string; op: string; args: unknown[] }[] = [];
let mockSessions: { started_at: string }[] = [];

jest.mock('@/lib/supabase', () => {
    const table = (name: string) => {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        for (const m of ['select', 'eq', 'neq', 'gte', 'order']) chain[m] = self;
        chain.maybeSingle = async () => ({ data: null, error: null });
        chain.upsert = (payload: unknown, opts: unknown) => { mockCalls.push({ table: name, op: 'upsert', args: [payload, opts] }); return Promise.resolve({ error: null }); };
        chain.update = (payload: unknown) => { mockCalls.push({ table: name, op: 'update', args: [payload] }); return { eq: async () => ({ error: null }) }; };
        chain.then = (resolve: (v: unknown) => void) => resolve({ data: name === 'activity_sessions' ? mockSessions : [], error: null });
        return chain;
    };
    return { supabase: { from: table }, getSessionUser: async () => ({ id: 'member-1' }) };
});

import { computeStreakFromSessions } from '@/hooks/useStreak';

/** 07:00 London on each day from `from` to `to`, as the wearable sync stores it. */
const londonMornings = (from: string, to: string) => {
    const out: { started_at: string }[] = [];
    for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += 86_400_000) {
        const day = new Date(ms).toISOString().slice(0, 10);
        out.push({ started_at: new Date(`${day}T07:00:00`).toISOString() }); // local 07:00 → instant
    }
    return out.reverse();
};

describe('useStreak recompute across the 25 Oct clock change', () => {
    beforeAll(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }); jest.setSystemTime(new Date('2026-10-28T12:00:00Z')); });
    afterAll(() => jest.useRealTimers());
    beforeEach(() => { mockCalls.length = 0; });

    it('the 25 Oct session really sits on a 25-hour local day', () => {
        const d = new Date('2026-10-25T07:00:00');
        expect(d.toISOString()).toBe('2026-10-25T07:00:00.000Z'); // GMT by 07:00 that morning
        expect(new Date('2026-10-24T07:00:00').toISOString()).toBe('2026-10-24T06:00:00.000Z'); // still BST the day before
    });

    it('counts 51 days through the change and writes 51 back to user_streaks', async () => {
        mockSessions = londonMornings('2026-09-08', '2026-10-28');
        const r = await computeStreakFromSessions();
        expect(r.current).toBe(51);
        expect(r.longest).toBe(51);
        const up = mockCalls.find((c) => c.table === 'user_streaks' && c.op === 'upsert');
        expect(up?.args[0]).toMatchObject({ user_id: 'member-1', current_streak: 51, longest_streak: 51, last_activity_date: '2026-10-28' });
    });

    it('still ends a streak at a real gap', async () => {
        mockSessions = [...londonMornings('2026-10-26', '2026-10-28'), ...londonMornings('2026-09-08', '2026-10-24')];
        const r = await computeStreakFromSessions();
        expect(r.current).toBe(3);
        expect(r.longest).toBe(47);
    });
});

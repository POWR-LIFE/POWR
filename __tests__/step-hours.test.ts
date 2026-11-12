/**
 * Steps per hour are read from the phone store one local hour at a time. The
 * hour edges must add up to the whole day on the two DST days, or the admin
 * profile's step-hours would lose (spring) or double (autumn) an hour.
 */
process.env.TZ = 'Europe/London';

jest.mock('expo-background-fetch', () => ({
    registerTaskAsync: jest.fn(),
    getStatusAsync: jest.fn(),
    BackgroundFetchStatus: { Restricted: 1, Denied: 2 },
    BackgroundFetchResult: { NewData: 1, Failed: 3 },
}));
jest.mock('expo-task-manager', () => ({
    defineTask: jest.fn(),
    isTaskRegisteredAsync: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/lib/supabase', () => ({
    supabase: {},
    getSessionUser: jest.fn().mockResolvedValue(null),
}));

import { localHourEdges } from '@/lib/health/walkingSync';

const HOUR = 3_600_000;
const spans = (edges: Date[]) => edges.slice(1).map((e, i) => (+e - +edges[i]) / HOUR);

describe('localHourEdges', () => {
    it('gives 24 one-hour buckets on an ordinary day', () => {
        const edges = localHourEdges(new Date(2026, 0, 14));
        expect(edges).toHaveLength(25);
        expect(spans(edges)).toEqual(new Array(24).fill(1));
        expect(edges[0].getHours()).toBe(0);
        expect(edges[24].getDate()).toBe(15);
    });

    it('leaves the skipped hour empty on the 23-hour day (29 Mar 2026)', () => {
        const edges = localHourEdges(new Date(2026, 2, 29));
        const s = spans(edges);
        expect(s.reduce((a, v) => a + v, 0)).toBe(23);
        expect(s.filter(v => v === 0)).toHaveLength(1);
        expect(s.every(v => v >= 0)).toBe(true);
    });

    it('folds the repeated hour into one bucket on the 25-hour day (25 Oct 2026)', () => {
        const edges = localHourEdges(new Date(2026, 9, 25));
        const s = spans(edges);
        expect(s.reduce((a, v) => a + v, 0)).toBe(25);
        expect(s[1]).toBe(2);
    });
});

// ── 30-day catch-up ───────────────────────────────────────────────────────────

describe('backfillStepHours', () => {
    const DAY = 24 * HOUR;

    beforeEach(() => {
        jest.resetModules();
    });

    /** Loads walkingSync against a fake phone store that has 100 steps in every
     *  9am hour, plus fakes for the two step-hours API calls. */
    function load(written: Map<string, string>, emptyDays: Set<string> = new Set()) {
        const saved: Array<{ date: string; steps: number[] }> = [];
        const keyOf = (d: Date) => {
            const p = (n: number) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        };
        jest.doMock('@kingstinct/react-native-healthkit', () => ({
            queryStatisticsForQuantity: jest.fn(async (_id: string, _s: string[], opts: { filter: { date: { startDate: Date; endDate: Date } } }) => {
                const { startDate, endDate } = opts.filter.date;
                if (emptyDays.has(keyOf(startDate))) return { sumQuantity: { quantity: 0 } };
                // 100 steps per 9am hour inside the range.
                let n = 0;
                for (let t = +startDate; t < +endDate; t += HOUR) if (new Date(t).getHours() === 9) n += 100;
                return { sumQuantity: { quantity: n } };
            }),
        }), { virtual: true });
        jest.doMock('@/lib/supabase', () => ({
            supabase: {},
            getSessionUser: jest.fn().mockResolvedValue({ id: 'u1' }),
        }));
        jest.doMock('@/lib/api/activity', () => ({
            saveDailyStepWindows: jest.fn(),
            saveDailyStepHours: jest.fn(async (_u: string, date: string, steps: number[]) => { saved.push({ date, steps }); }),
            fetchStepHoursWritten: jest.fn(async () => written),
            WALKING_DAILY_CAP: 0,
        }));
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('@/lib/health/walkingSync') as typeof import('@/lib/health/walkingSync');
        return { mod, saved, keyOf };
    }

    it('fills every past day with steps, as 24 local hours', async () => {
        const { mod, saved } = load(new Map());
        await mod.backfillStepHours(5);
        expect(saved).toHaveLength(5);
        for (const row of saved) {
            expect(row.steps).toHaveLength(24);
            expect(row.steps[9]).toBe(100);
            expect(row.steps.reduce((a, v) => a + v, 0)).toBe(100);
        }
    });

    it('skips a day already written after it ended, and re-reads one written part-way through', async () => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const key = (i: number) => {
            const d = new Date(today); d.setDate(d.getDate() - i);
            const p = (n: number) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        };
        const written = new Map([
            [key(2), new Date(+today - DAY + 60_000).toISOString()],   // written just after day -2 ended: final
            [key(1), new Date(+today - 6 * HOUR).toISOString()],       // written at 6pm on day -1: partial
        ]);
        const { mod, saved } = load(written);
        await mod.backfillStepHours(3);
        expect(saved.map(r => r.date).sort()).toEqual([key(3), key(1)].sort());
    });

    it('writes nothing for a day the phone has no steps for', async () => {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 1);
        const p = (n: number) => String(n).padStart(2, '0');
        const yesterday = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        const { mod, saved } = load(new Map(), new Set([yesterday]));
        await mod.backfillStepHours(2);
        expect(saved.map(r => r.date)).not.toContain(yesterday);
        expect(saved).toHaveLength(1);
    });
});

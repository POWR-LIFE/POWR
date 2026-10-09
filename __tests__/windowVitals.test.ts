/**
 * lib/health/windowVitals — the per-window heart-rate / active-energy read that
 * replaces the day-wide "today" figures on the native path.
 *
 * The native modules are mocked; what's under test is the contract the callers
 * lean on: null means "nothing measured" (never zeroes), one metric failing
 * doesn't lose the other, and the numbers come back rounded. gymVitals writes
 * once per session, so "null → try again later" vs "zeroes → written forever"
 * is the whole difference between a retry and a permanent blank.
 */

const mockPlatform = { OS: 'ios' as string };
// A getter, not the object: imports are hoisted above this const, so the factory
// must defer touching it until a test actually reads Platform.OS.
jest.mock('react-native', () => ({ Platform: { get OS() { return mockPlatform.OS; } } }));

const mockQueryStats = jest.fn();
const mockQuerySamples = jest.fn();
jest.mock('@kingstinct/react-native-healthkit', () => ({
    queryStatisticsForQuantity: (...args: unknown[]) => mockQueryStats(...args),
    queryQuantitySamples: (...args: unknown[]) => mockQuerySamples(...args),
}), { virtual: true });

const mockAggregate = jest.fn();
const mockReadRecords = jest.fn();
const mockInitialize = jest.fn(async () => true);
jest.mock('react-native-health-connect', () => ({
    initialize: () => mockInitialize(),
    aggregateRecord: (...args: unknown[]) => mockAggregate(...args),
    readRecords: (...args: unknown[]) => mockReadRecords(...args),
}), { virtual: true });

import { isSessionScoped, readWindowVitals, SESSION_SCOPED_EXTRAS, sessionExtras } from '@/lib/health/windowVitals';

const FROM = Date.UTC(2026, 7, 18, 18, 0, 0);
const TO = Date.UTC(2026, 7, 18, 19, 5, 0);

beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.OS = 'ios';
});

describe('iOS (HealthKit)', () => {
    it('reads heart rate and active energy over exactly the window asked for', async () => {
        mockQueryStats.mockImplementation(async (id: string) => {
            if (id === 'HKQuantityTypeIdentifierHeartRate') {
                return { averageQuantity: { quantity: 138.4 }, maximumQuantity: { quantity: 171.2 } };
            }
            return { sumQuantity: { quantity: 511.6 } };
        });

        const v = await readWindowVitals(FROM, TO);

        expect(v).toEqual({ hrAvg: 138, hrMax: 171, caloriesActive: 512 });
        // Both calls carry the window, not midnight→now.
        for (const call of mockQueryStats.mock.calls) {
            const filter = (call[2] as { filter: { date: { startDate: Date; endDate: Date } } }).filter;
            expect(filter.date.startDate.getTime()).toBe(FROM);
            expect(filter.date.endDate.getTime()).toBe(TO);
        }
    });

    it('returns null, not zeroes, when the window recorded nothing', async () => {
        mockQueryStats.mockResolvedValue({});
        expect(await readWindowVitals(FROM, TO)).toBeNull();
    });

    it('keeps calories when the heart-rate query throws', async () => {
        mockQueryStats.mockImplementation(async (id: string) => {
            if (id === 'HKQuantityTypeIdentifierHeartRate') throw new Error('no HR permission');
            return { sumQuantity: { quantity: 240 } };
        });
        expect(await readWindowVitals(FROM, TO)).toEqual({ hrAvg: null, hrMax: null, caloriesActive: 240 });
    });

    it('treats a zero sum as nothing measured', async () => {
        mockQueryStats.mockImplementation(async (id: string) =>
            id === 'HKQuantityTypeIdentifierHeartRate' ? {} : { sumQuantity: { quantity: 0 } });
        expect(await readWindowVitals(FROM, TO)).toBeNull();
    });
});

describe('Android (Health Connect)', () => {
    beforeEach(() => { mockPlatform.OS = 'android'; });

    it('aggregates over the window and lets Health Connect do the prorating', async () => {
        mockAggregate.mockImplementation(async ({ recordType }: { recordType: string }) => {
            if (recordType === 'HeartRate') return { BPM_AVG: 126.7, BPM_MAX: 160, BPM_MIN: 70, MEASUREMENTS_COUNT: 412 };
            return { ACTIVE_CALORIES_TOTAL: { inKilocalories: 379.9 } };
        });

        const v = await readWindowVitals(FROM, TO);

        expect(mockInitialize).toHaveBeenCalled();
        expect(v).toEqual({ hrAvg: 127, hrMax: 160, caloriesActive: 380 });
        const hrCall = mockAggregate.mock.calls.find(c => (c[0] as { recordType: string }).recordType === 'HeartRate')![0] as {
            timeRangeFilter: { startTime: string; endTime: string };
        };
        expect(new Date(hrCall.timeRangeFilter.startTime).getTime()).toBe(FROM);
        expect(new Date(hrCall.timeRangeFilter.endTime).getTime()).toBe(TO);
    });

    it('ignores a heart-rate aggregate with no measurements behind it', async () => {
        mockAggregate.mockImplementation(async ({ recordType }: { recordType: string }) => {
            if (recordType === 'HeartRate') return { BPM_AVG: 0, BPM_MAX: 0, BPM_MIN: 0, MEASUREMENTS_COUNT: 0 };
            return { ACTIVE_CALORIES_TOTAL: { inKilocalories: 0 } };
        });
        expect(await readWindowVitals(FROM, TO)).toBeNull();
    });
});

/**
 * 2026-10-07 — heart-rate zones from the phone. Only when the caller passes a
 * max heart rate, only when the window measured heart rate at all, and a failed
 * sample read costs the zones, never the averages.
 */
describe('heart-rate zones', () => {
    /** Ten minutes at `bpm`, one sample every 5 s from FROM. */
    const tenMinutesAt = (bpm: number) => Array.from({ length: 120 }, (_, i) => ({ atMs: FROM + i * 5000, bpm }));

    it('iOS: builds the zones from the window\'s samples when given a max', async () => {
        mockQueryStats.mockImplementation(async (id: string) => id === 'HKQuantityTypeIdentifierHeartRate'
            ? { averageQuantity: { quantity: 150 }, maximumQuantity: { quantity: 158 } }
            : { sumQuantity: { quantity: 300 } });
        mockQuerySamples.mockResolvedValue(tenMinutesAt(150).map(s => ({ startDate: new Date(s.atMs), quantity: s.bpm })));

        const v = await readWindowVitals(FROM, FROM + 600_000, { maxHr: 190 });

        expect(v?.hrZones?.map(z => z.duration_seconds)).toEqual([0, 0, 0, 600, 0, 0]);
        const [id, opts] = mockQuerySamples.mock.calls[0] as [string, { filter: { date: { startDate: Date } }; unit: string }];
        expect(id).toBe('HKQuantityTypeIdentifierHeartRate');
        expect(opts.unit).toBe('count/min');
        expect(opts.filter.date.startDate.getTime()).toBe(FROM);
        expect(sessionExtras(v!)).toEqual({ scope: 'session', hr_zones: v!.hrZones });
    });

    it('iOS: no max, no sample read and no zones — the averages are unchanged', async () => {
        mockQueryStats.mockResolvedValue({ averageQuantity: { quantity: 150 }, maximumQuantity: { quantity: 158 } });
        const v = await readWindowVitals(FROM, TO);
        expect(mockQuerySamples).not.toHaveBeenCalled();
        expect(v?.hrZones).toBeUndefined();
        expect(sessionExtras(v!)).toEqual({ scope: 'session' });
    });

    it('iOS: a failed sample read costs the zones, never the averages', async () => {
        mockQueryStats.mockResolvedValue({ averageQuantity: { quantity: 150 }, maximumQuantity: { quantity: 158 } });
        mockQuerySamples.mockRejectedValue(new Error('denied'));
        const v = await readWindowVitals(FROM, TO, { maxHr: 190 });
        expect(v).toMatchObject({ hrAvg: 150, hrMax: 158 });
        expect(v?.hrZones).toBeUndefined();
    });

    it('Android: reads the samples inside the window out of the heart-rate series records', async () => {
        mockPlatform.OS = 'android';
        mockAggregate.mockImplementation(async ({ recordType }: { recordType: string }) => recordType === 'HeartRate'
            ? { BPM_AVG: 150, BPM_MAX: 158, MEASUREMENTS_COUNT: 120 }
            : { ACTIVE_CALORIES_TOTAL: { inKilocalories: 300 } });
        const inside = tenMinutesAt(150).map(s => ({ time: new Date(s.atMs).toISOString(), beatsPerMinute: s.bpm }));
        // A record straddling the window: its sample from before FROM must not count.
        const straddle = { samples: [{ time: new Date(FROM - 60_000).toISOString(), beatsPerMinute: 60 }] };
        mockReadRecords.mockResolvedValue({ records: [straddle, { samples: inside }] });

        const v = await readWindowVitals(FROM, FROM + 600_000, { maxHr: 190 });

        expect(mockReadRecords.mock.calls[0][0]).toBe('HeartRate');
        expect(v?.hrZones?.map(z => z.duration_seconds)).toEqual([0, 0, 0, 600, 0, 0]);
    });
});

describe('guards', () => {
    it('refuses an empty or inverted window without touching the store', async () => {
        expect(await readWindowVitals(TO, FROM)).toBeNull();
        expect(await readWindowVitals(FROM, FROM)).toBeNull();
        expect(mockQueryStats).not.toHaveBeenCalled();
    });

    it('returns null on web', async () => {
        mockPlatform.OS = 'web';
        expect(await readWindowVitals(FROM, TO)).toBeNull();
    });

    it('the marker round-trips through the extras bag', () => {
        expect(isSessionScoped({ ...SESSION_SCOPED_EXTRAS })).toBe(true);
        expect(isSessionScoped({ elevation_gain_m: 12 })).toBe(false);
        expect(isSessionScoped(null)).toBe(false);
    });
});

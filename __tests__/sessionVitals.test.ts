/**
 * Per-session vitals on the Progress day sheet — the heart rate and calorie burn
 * read back from the linked health_snapshots row.
 *
 * The whole risk here is showing a WRONG number. The native sync path has no
 * per-workout heart-rate read: it takes one getHeartRateToday() figure and
 * stamps it on every session it writes that day, so a HIIT workout comes back
 * reading the day's resting average. Measured in prod before this shipped: 25 of
 * 34 multi-workout HealthKit days carried an identical hr_avg across every
 * session, and median "running" HR was 80 bpm against Whoop's 142.
 *
 * These tests pin the rule that keeps those out — gate on the snapshot's SOURCE,
 * never on the session's verification.
 */

jest.mock('@/lib/supabase', () => ({
    supabase: { from: jest.fn() },
    getSessionUser: jest.fn(),
}));

import { sleepDayWindow } from '@/lib/api/activity';
import { fetchPointsBreakdown } from '@/lib/api/pointsBreakdown';
import { getSessionUser, supabase } from '@/lib/supabase';

type Snapshot = {
    source: string | null;
    hr_avg: number | null;
    hr_max: number | null;
    calories_active: number | null;
    extras?: Record<string, unknown> | null;
};

/** A wearable workout dropped because it overlapped this check-in. */
type Suppressed = {
    source: string | null;
    duration_sec: number | null;
    hr_avg: number | null;
    hr_max: number | null;
    calories_active: number | null;
};

/** One session with a paid ledger row, shaped as PostgREST returns it. */
function session(overrides: {
    verification?: string;
    snapshots?: Snapshot[];
    suppressed?: Suppressed[];
    paid?: boolean;
} = {}) {
    const { verification = 'wearable', snapshots = [], suppressed = [], paid = true } = overrides;
    return {
        id: 'session-1',
        started_at: '2026-07-24T09:00:00Z',
        duration_sec: 2700,
        steps: null,
        distance_m: 7100,
        verification,
        health_snapshots: snapshots,
        suppressed_workouts: suppressed,
        point_transactions: paid
            ? [{
                id: 'tx-1', amount: 6, type: 'earn',
                description: null, source: 'terra', created_at: '2026-07-24T09:45:00Z',
            }]
            : [],
    };
}

/** Stubs the single activity_sessions select fetchPointsBreakdown makes. */
let lastQuery: { gte?: string; lt?: string } = {};

function mockSessions(rows: unknown[]) {
    lastQuery = {};
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq']) {
        builder[method] = jest.fn(() => builder);
    }
    builder.gte = jest.fn((_col: string, v: string) => { lastQuery.gte = v; return builder; });
    builder.lt = jest.fn((_col: string, v: string) => { lastQuery.lt = v; return builder; });
    builder.order = jest.fn(() => Promise.resolve({ data: rows, error: null }));
    (supabase.from as jest.Mock).mockReturnValue(builder);
}

const WINDOW = { start: new Date('2026-07-24T00:00:00Z'), end: new Date('2026-07-25T00:00:00Z') };

const fetchVitals = async () =>
    (await fetchPointsBreakdown('running', WINDOW.start, WINDOW.end)).rows[0].vitals;

beforeEach(() => {
    jest.clearAllMocks();
    (getSessionUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
});

/**
 * Sleep is stored with BEDTIME as started_at, and both sleep views attribute an
 * evening bedtime to the morning you wake — 11pm Monday is Tuesday's sleep. The
 * day sheet windowed on plain local midnight, so tapping Tuesday opened the
 * night that STARTED Tuesday evening — the one the chart was calling Wednesday.
 * Off by one on almost every night.
 */
describe('the sleep day window', () => {
    it('runs 18:00 the evening before to 18:00 that day', () => {
        const { start, end } = sleepDayWindow(new Date(2026, 6, 29));  // Wed 29 Jul

        expect(start.getDate()).toBe(28);
        expect(start.getHours()).toBe(18);
        expect(end.getDate()).toBe(29);
        expect(end.getHours()).toBe(18);
    });

    it('captures an 11pm bedtime as the NEXT day, matching the charts', () => {
        // A night begun 22:30 on Tue 28th is Wednesday's sleep in both the week
        // bars and the month heatmap, so Wednesday's window must contain it.
        const bedtime = new Date(2026, 6, 28, 22, 30);
        const wed = sleepDayWindow(new Date(2026, 6, 29));
        const tue = sleepDayWindow(new Date(2026, 6, 28));

        expect(bedtime >= wed.start && bedtime < wed.end).toBe(true);
        expect(bedtime >= tue.start && bedtime < tue.end).toBe(false);
    });

    it('keeps an early-hours bedtime on the day it wakes', () => {
        // 01:00 Wednesday is still Wednesday's night — the shift is at 18:00.
        const bedtime = new Date(2026, 6, 29, 1, 0);
        const wed = sleepDayWindow(new Date(2026, 6, 29));

        expect(bedtime >= wed.start && bedtime < wed.end).toBe(true);
    });
});

describe('trustworthy sources', () => {
    it('surfaces heart rate and calories from a Terra provider', async () => {
        mockSessions([session({
            snapshots: [{ source: 'whoop', hr_avg: 142, hr_max: null, calories_active: 634 }],
        })]);

        // toEqual ignores undefined-valued keys, so an all-absent extras bag
        // compares equal to {}.
        expect(await fetchVitals()).toEqual({
            hrAvg: 142, hrMax: null, caloriesActive: 634, source: 'whoop', extras: {},
        });
    });

    it('carries max heart rate when the provider reports one', async () => {
        mockSessions([session({
            snapshots: [{ source: 'garmin', hr_avg: 145, hr_max: 176, calories_active: 496 }],
        })]);

        const vitals = await fetchVitals();
        expect(vitals?.hrMax).toBe(176);
    });
});

describe('day-wide sources are suppressed', () => {
    it('drops HealthKit vitals — that heart rate is the whole day, not the workout', async () => {
        mockSessions([session({
            verification: 'health',
            snapshots: [{ source: 'healthkit', hr_avg: 71, hr_max: 95, calories_active: 942 }],
        })]);

        expect(await fetchVitals()).toBeNull();
    });

    it('drops Health Connect vitals for the same reason', async () => {
        mockSessions([session({
            snapshots: [{ source: 'health_connect', hr_avg: 68, hr_max: null, calories_active: 300 }],
        })]);

        expect(await fetchVitals()).toBeNull();
    });

    /**
     * The trap this rule exists for. verificationFromProvenance() marks an
     * Apple-Watch-sourced HealthKit workout as 'wearable' even though its heart
     * rate is still the day-wide figure — 46 such sessions are live in prod.
     * Gating on verification would publish those as per-workout numbers.
     */
    it('suppresses an Apple Watch workout even though it verifies as "wearable"', async () => {
        mockSessions([session({
            verification: 'wearable',
            snapshots: [{ source: 'healthkit', hr_avg: 76, hr_max: 117, calories_active: 509 }],
        })]);

        expect(await fetchVitals()).toBeNull();
    });
});

/**
 * Terra ships far more per workout than the five fields the webhook used to
 * read, and never re-serves an old payload — so the extras bag is written wide
 * and read defensively. Providers fill very different subsets.
 */
/**
 * The native path now reads each workout's own window (lib/health/windowVitals)
 * and marks the row `extras.scope = 'session'`. That marker — not the source — is
 * what makes a HealthKit figure trustworthy: the day-wide rows history left
 * behind carry the same source and must stay gated.
 */
describe('window-scoped native reads pass the gate', () => {
    it('surfaces a HealthKit row read over the session\'s own window', async () => {
        mockSessions([session({
            snapshots: [{ source: 'healthkit', hr_avg: 139, hr_max: 168, calories_active: 412, extras: { scope: 'session' } }],
        })]);

        const v = await fetchVitals();
        expect(v?.hrAvg).toBe(139);
        expect(v?.caloriesActive).toBe(412);
        expect(v?.source).toBe('healthkit');
    });

    it('still drops a HealthKit row without the marker, even beside a scoped one from another day', async () => {
        mockSessions([session({
            snapshots: [{ source: 'healthkit', hr_avg: 71, hr_max: 95, calories_active: 900 }],
        })]);
        expect(await fetchVitals()).toBeNull();
    });

    it('prefers the window-scoped row when history left a day-wide one beside it', async () => {
        mockSessions([session({
            snapshots: [
                { source: 'healthkit', hr_avg: 71, hr_max: 95, calories_active: 900 },
                { source: 'healthkit', hr_avg: 139, hr_max: 168, calories_active: 412, extras: { scope: 'session' } },
            ],
        })]);
        expect((await fetchVitals())?.hrAvg).toBe(139);
    });

    it('lets a check-in show the window its phone recorded, with the chip naming the phone store', async () => {
        mockSessions([session({
            verification: 'geofence',
            snapshots: [{ source: 'health_connect', hr_avg: 127, hr_max: 161, calories_active: 380, extras: { scope: 'session' } }],
        })]);
        const v = await fetchVitals();
        expect(v?.hrAvg).toBe(127);
        expect(v?.source).toBe('health_connect');
    });
});

describe('provider extras', () => {
    it('maps the snake_case column into typed camelCase fields', async () => {
        mockSessions([session({
            snapshots: [{
                source: 'garmin', hr_avg: 145, hr_max: 176, calories_active: 496,
                extras: {
                    elevation_gain_m: 124, avg_watts: 210, max_watts: 640,
                    swim_laps: 40, pool_length_m: 25, high_intensity_min: 12,
                },
            }],
        })]);

        const vitals = await fetchVitals();
        expect(vitals?.extras).toMatchObject({
            elevationGainM: 124, avgWatts: 210, maxWatts: 640,
            swimLaps: 40, poolLengthM: 25, highIntensityMin: 12,
        });
    });

    it('leaves every field absent when the provider sent none', async () => {
        mockSessions([session({
            snapshots: [{ source: 'whoop', hr_avg: 142, hr_max: null, calories_active: 634, extras: null }],
        })]);

        expect((await fetchVitals())?.extras).toEqual({});
    });

    it('ignores malformed values rather than rendering them', async () => {
        mockSessions([session({
            snapshots: [{
                source: 'garmin', hr_avg: 145, hr_max: null, calories_active: null,
                extras: { elevation_gain_m: 'lots', avg_watts: null, swim_laps: 40 },
            }],
        })]);

        const extras = (await fetchVitals())?.extras;
        expect(extras?.elevationGainM).toBeUndefined();
        expect(extras?.avgWatts).toBeUndefined();
        expect(extras?.swimLaps).toBe(40);
    });

    /** A snapshot can carry only extras — no HR, no calories — and still count. */
    it('surfaces a snapshot that has extras but no heart rate or calories', async () => {
        mockSessions([session({
            snapshots: [{
                source: 'garmin', hr_avg: null, hr_max: null, calories_active: null,
                extras: { elevation_gain_m: 300 },
            }],
        })]);

        expect((await fetchVitals())?.extras.elevationGainM).toBe(300);
    });
});

describe('missing data', () => {
    it('is null when no snapshot is linked', async () => {
        mockSessions([session({ snapshots: [] })]);
        expect(await fetchVitals()).toBeNull();
    });

    it('is null when a linked snapshot carries neither heart rate nor calories', async () => {
        mockSessions([session({
            snapshots: [{ source: 'whoop', hr_avg: null, hr_max: null, calories_active: null }],
        })]);
        expect(await fetchVitals()).toBeNull();
    });

    it('prefers a usable snapshot over a day-wide one when history left both', async () => {
        mockSessions([session({
            snapshots: [
                { source: 'healthkit', hr_avg: 71, hr_max: 95, calories_active: 900 },
                { source: 'whoop', hr_avg: 142, hr_max: null, calories_active: 634 },
            ],
        })]);

        expect((await fetchVitals())?.source).toBe('whoop');
    });
});

/**
 * A geofence check-in is the authoritative record of the hour, so the wearable's
 * telling of it is never a session — but it IS kept (suppressed_workouts, keyed
 * to the winning check-in) and it carries the heart rate the check-in can't
 * measure. Half of prod check-ins come from people whose wearable was running;
 * every one of them showed nothing.
 */
describe('a check-in borrows the suppressed wearable workout\'s vitals', () => {
    it('surfaces heart rate and calories from the workout the check-in outranked', async () => {
        mockSessions([session({
            verification: 'geofence',
            suppressed: [{ source: 'whoop', duration_sec: 2600, hr_avg: 138, hr_max: 171, calories_active: 512 }],
        })]);

        const v = await fetchVitals();
        expect(v?.hrAvg).toBe(138);
        expect(v?.hrMax).toBe(171);
        expect(v?.caloriesActive).toBe(512);
        expect(v?.source).toBe('whoop');
    });

    it('takes the longest effort when a long window swallowed several', async () => {
        mockSessions([session({
            verification: 'geofence',
            suppressed: [
                { source: 'whoop', duration_sec: 600, hr_avg: 110, hr_max: 130, calories_active: 80 },
                { source: 'whoop', duration_sec: 2400, hr_avg: 141, hr_max: 175, calories_active: 470 },
            ],
        })]);

        expect((await fetchVitals())?.hrAvg).toBe(141);
    });

    it('still prefers a snapshot linked to the session itself', async () => {
        mockSessions([session({
            verification: 'geofence',
            snapshots: [{ source: 'garmin', hr_avg: 129, hr_max: 160, calories_active: 400 }],
            suppressed: [{ source: 'whoop', duration_sec: 2600, hr_avg: 138, hr_max: 171, calories_active: 512 }],
        })]);

        expect((await fetchVitals())?.source).toBe('garmin');
    });

    it('applies the same day-wide gate — a phone-synced suppression is no more per-workout', async () => {
        mockSessions([session({
            verification: 'geofence',
            suppressed: [{ source: 'healthkit', duration_sec: 2600, hr_avg: 74, hr_max: 98, calories_active: 900 }],
        })]);

        expect(await fetchVitals()).toBeNull();
    });

    it('ignores a suppressed workout that measured nothing', async () => {
        mockSessions([session({
            verification: 'geofence',
            suppressed: [{ source: 'strava', duration_sec: 2600, hr_avg: null, hr_max: null, calories_active: null }],
        })]);

        expect(await fetchVitals()).toBeNull();
    });
});

describe('unpaid sessions', () => {
    it('still carries vitals — "I trained, why is this zero?" deserves the detail', async () => {
        mockSessions([session({
            paid: false,
            snapshots: [{ source: 'whoop', hr_avg: 121, hr_max: null, calories_active: 354 }],
        })]);

        const { unpaid } = await fetchPointsBreakdown('running', WINDOW.start, WINDOW.end);
        expect(unpaid[0].vitals?.hrAvg).toBe(121);
    });
});

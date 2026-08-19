/**
 * Render tests for the vitals block on components/progress/PointsBreakdownSheet.
 *
 * lib/api/pointsBreakdown decides WHETHER a number is trustworthy (see
 * __tests__/sessionVitals.test.ts); this covers the wiring on the other side —
 * that a trustworthy figure reaches the screen, that a suppressed one leaves no
 * empty scaffolding behind, and that the wearable pitch only appears for someone
 * who actually trained without it.
 */

import { render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

jest.mock('@expo/vector-icons', () => {
    const React = require('react');
    const { Text } = require('react-native');
    const Icon = (props: any) => React.createElement(Text, null, props.name);
    return { Ionicons: Icon };
});

jest.mock('@/hooks/useSheetDragDismiss', () => ({
    useSheetDragDismiss: () => ({
        dragY: { interpolate: () => 0 },
        backdropOpacity: 1,
        panHandlers: {},
        dismiss: jest.fn(),
    }),
}));

jest.mock('@/lib/gymDwellConfig', () => ({
    getGymDwellMinutes: () => 30,
    getGymUpgradeMinutes: () => 40,
}));

const mockFetch = jest.fn();
jest.mock('@/lib/api/pointsBreakdown', () => ({
    ...jest.requireActual('@/lib/api/pointsBreakdown'),
    fetchPointsBreakdown: (...args: unknown[]) => mockFetch(...args),
}));

import PointsBreakdownSheet from '@/components/progress/PointsBreakdownSheet';
import type { ActivityType } from '@/constants/activities';
import type { SessionExtras, SessionVitals } from '@/lib/api/pointsBreakdown';

/** Sleep stages and extras default to absent — most tests don't exercise them. */
type PartialVitals = Partial<SessionVitals> & Pick<SessionVitals, 'source'>;

function breakdown(vitals: PartialVitals | null, verification = 'wearable') {
    const full: SessionVitals | null = vitals
        ? {
            hrAvg: null, hrMax: null, caloriesActive: null,
            sleepDeepH: null, sleepRemH: null, sleepLightH: null,
            extras: {},
            ...vitals,
        }
        : null;
    return buildBreakdown(full, verification);
}

function buildBreakdown(vitals: SessionVitals | null, verification: string) {
    return {
        total: 6,
        rows: [{
            id: 'tx-1',
            amount: 6,
            kind: 'earn',
            label: 'Synced from your wearable',
            sessionId: 'session-1',
            sessionStartedAt: '2026-07-24T09:00:00Z',
            sessionDurationMin: 45,
            sessionSteps: null as number | null,
            sessionDistanceM: 7100 as number | null,
            verification,
            vitals,
        }],
        unpaid: [],
    };
}

function renderSheet(type: ActivityType = 'running') {
    return render(
        <PointsBreakdownSheet
            visible
            onClose={jest.fn()}
            type={type}
            period="D"
            offset={0}
            day={new Date('2026-07-24T12:00:00Z')}
        />,
    );
}

/** A session with explicit distance/duration, for the pace maths. */
function paceBreakdown(distanceM: number | null, durationMin: number) {
    const b = breakdown(null);
    b.rows[0].sessionDistanceM = distanceM;
    b.rows[0].sessionDurationMin = durationMin;
    return b;
}

beforeEach(() => jest.clearAllMocks());

it('shows heart rate, calories and which device measured them', async () => {
    mockFetch.mockResolvedValue(breakdown({
        hrAvg: 142, hrMax: 167, caloriesActive: 634, source: 'whoop',
    }));

    renderSheet();

    // Value and unit are one Text with a nested unit span, so they compose.
    await waitFor(() => expect(screen.getByText('142 bpm')).toBeTruthy());
    expect(screen.getByText('634 kcal')).toBeTruthy();
    expect(screen.getByText('AVG HR')).toBeTruthy();
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    // Naming the device beats "Wearable" — it says which app to check against.
    expect(screen.getByText('Whoop')).toBeTruthy();
    expect(screen.queryByText('Wearable')).toBeNull();
});

/**
 * The check-in verified the session; the wearable only measured it. The chip
 * keeps both so the user knows what was PAID and which app to compare against —
 * "Whoop" alone would read as a wearable-paid session.
 */
it('names both the check-in and the device when a check-in borrows vitals', async () => {
    mockFetch.mockResolvedValue(breakdown({
        hrAvg: 138, hrMax: 171, caloriesActive: 512, source: 'whoop',
    }, 'geofence'));

    renderSheet('gym');

    await waitFor(() => expect(screen.getByText('138 bpm')).toBeTruthy());
    expect(screen.getByText('Gym check-in · Whoop')).toBeTruthy();
    expect(screen.queryByText(/Heart rate and calories show here/)).toBeNull();
});

it('gives max heart rate its own tile, so both read at tile size', async () => {
    mockFetch.mockResolvedValue(breakdown({
        hrAvg: 142, hrMax: 167, caloriesActive: null, source: 'whoop',
    }));

    renderSheet();

    await waitFor(() => expect(screen.getByText('MAX HR')).toBeTruthy());
    expect(screen.getByText('167 bpm')).toBeTruthy();
});

it('omits the max tile when the provider sent no max', async () => {
    mockFetch.mockResolvedValue(breakdown({
        hrAvg: 121, hrMax: null, caloriesActive: null, source: 'garmin',
    }));

    renderSheet();

    await waitFor(() => expect(screen.getByText('121 bpm')).toBeTruthy());
    expect(screen.queryByText('MAX HR')).toBeNull();
    expect(screen.queryByText(/kcal/)).toBeNull();
});

/**
 * Time and distance used to live in a 9px muted string beside the source chip.
 * Promoting them into the same tile row is what gives gym and manual sessions —
 * which never have vitals — a glanceable row at all.
 */
describe('time and distance', () => {
    it('renders as tiles alongside the vitals', async () => {
        mockFetch.mockResolvedValue(breakdown({
            hrAvg: 142, hrMax: null, caloriesActive: 634, source: 'whoop',
        }));

        renderSheet();

        await waitFor(() => expect(screen.getByText('45m')).toBeTruthy());
        expect(screen.getByText('7.1 km')).toBeTruthy();
        expect(screen.getByText('TIME')).toBeTruthy();
        expect(screen.getByText('DISTANCE')).toBeTruthy();
    });

    it('still renders for a session with no vitals at all', async () => {
        mockFetch.mockResolvedValue(breakdown(null));

        renderSheet();

        await waitFor(() => expect(screen.getByText('45m')).toBeTruthy());
        expect(screen.getByText('7.1 km')).toBeTruthy();
        expect(screen.queryByText('AVG HR')).toBeNull();
    });
});

it('renders no vitals scaffolding when there is nothing trustworthy to show', async () => {
    mockFetch.mockResolvedValue(breakdown(null));

    renderSheet();

    // The ledger still renders — only the vitals block is absent.
    await waitFor(() => expect(screen.getByText('Synced from your wearable')).toBeTruthy());
    expect(screen.queryByText(/bpm/)).toBeNull();
    expect(screen.queryByText(/kcal/)).toBeNull();
});

/**
 * Pace is DERIVED from distance ÷ duration, not ingested — so it needs no Terra
 * change and works on historic sessions. The risk is the tail: prod holds gym
 * check-ins of 8-12 hours and swims whose duration covers the whole pool visit,
 * which derive a pace near zero.
 */
describe('pace', () => {
    it('reads in min/km for a run', async () => {
        mockFetch.mockResolvedValue(paceBreakdown(7100, 42));   // 10.14 km/h
        renderSheet('running');
        await waitFor(() => expect(screen.getByText('5:55 /km')).toBeTruthy());
        expect(screen.getByText('PACE')).toBeTruthy();
    });

    it('reads as speed in km/h for a ride', async () => {
        mockFetch.mockResolvedValue(paceBreakdown(30000, 73));  // 24.7 km/h
        renderSheet('cycling');
        await waitFor(() => expect(screen.getByText('24.7 km/h')).toBeTruthy());
        expect(screen.getByText('SPEED')).toBeTruthy();
        expect(screen.queryByText('PACE')).toBeNull();
    });

    it('reads per 100m for a swim, the unit swimmers actually use', async () => {
        mockFetch.mockResolvedValue(paceBreakdown(1000, 40));   // 1.5 km/h
        renderSheet('swimming');
        await waitFor(() => expect(screen.getByText('4:00 /100m')).toBeTruthy());
    });

    it('is suppressed when the duration dwarfs the effort', async () => {
        // A check-in that never closed: 834m across 8 hours → 0.1 km/h.
        mockFetch.mockResolvedValue(paceBreakdown(834, 480));
        renderSheet('running');
        await waitFor(() => expect(screen.getByText('8h')).toBeTruthy());
        expect(screen.queryByText('PACE')).toBeNull();
    });

    it('never appears for an activity where pace is meaningless', async () => {
        // Gym sessions do carry a stray distance in prod — it must not derive one.
        mockFetch.mockResolvedValue(paceBreakdown(834, 45));
        renderSheet('gym');
        await waitFor(() => expect(screen.getByText('45m')).toBeTruthy());
        expect(screen.queryByText('PACE')).toBeNull();
        expect(screen.queryByText('SPEED')).toBeNull();
    });

    it('is absent when the session has no distance', async () => {
        mockFetch.mockResolvedValue(paceBreakdown(null, 45));
        renderSheet('running');
        await waitFor(() => expect(screen.getByText('45m')).toBeTruthy());
        expect(screen.queryByText('PACE')).toBeNull();
    });
});

/**
 * Each activity shows what means something FOR IT. A tile existing in the data
 * isn't reason enough: running carries steps on 1 session in 108, and climb on a
 * yoga class is noise dressed as detail.
 */
describe('per-activity tile sets', () => {
    const withEverything = () => breakdown({
        hrAvg: 142, hrMax: 167, caloriesActive: 634, source: 'garmin',
        extras: { elevationGainM: 124, avgWatts: 288, swimLaps: 40, highIntensityMin: 18 },
    });

    it('gives a gym session intensity only — no distance, pace or climb', async () => {
        const b = withEverything();
        b.rows[0].sessionDistanceM = 834;   // gym sessions do carry a stray distance
        mockFetch.mockResolvedValue(b);
        renderSheet('gym');

        await waitFor(() => expect(screen.getByText('142 bpm')).toBeTruthy());
        expect(screen.getByText('634 kcal')).toBeTruthy();
        expect(screen.queryByText('DISTANCE')).toBeNull();
        expect(screen.queryByText('PACE')).toBeNull();
        expect(screen.queryByText('CLIMB')).toBeNull();
    });

    it('gives a ride power and climb', async () => {
        mockFetch.mockResolvedValue(withEverything());
        renderSheet('cycling');

        await waitFor(() => expect(screen.getByText('288 w')).toBeTruthy());
        expect(screen.getByText('CLIMB')).toBeTruthy();
        expect(screen.queryByText('LAPS')).toBeNull();
    });

    it('gives a swim laps but never power or climb', async () => {
        mockFetch.mockResolvedValue(withEverything());
        renderSheet('swimming');

        await waitFor(() => expect(screen.getByText('LAPS')).toBeTruthy());
        expect(screen.queryByText('POWER')).toBeNull();
        expect(screen.queryByText('CLIMB')).toBeNull();
    });

    it('keeps steps off a run — 1 session in 108 has them, so it is clutter', async () => {
        const b = withEverything();
        b.rows[0].sessionSteps = 8210;
        mockFetch.mockResolvedValue(b);
        renderSheet('running');

        await waitFor(() => expect(screen.getByText('PACE')).toBeTruthy());
        expect(screen.queryByText('STEPS')).toBeNull();
    });

    it('leads a walk with steps', async () => {
        const b = breakdown({ hrAvg: null, source: 'whoop' });
        b.rows[0].sessionSteps = 8210;
        mockFetch.mockResolvedValue(b);
        renderSheet('walking');

        await waitFor(() => expect(screen.getByText('8,210')).toBeTruthy());
        expect(screen.getByText('STEPS')).toBeTruthy();
    });
});

/**
 * 926 nights carry deep/REM/light and none were reachable until the sleep
 * backfill — a sleep sheet could only ever show a duration.
 */
describe('sleep', () => {
    it('shows the stage breakdown instead of heart rate and burn', async () => {
        mockFetch.mockResolvedValue(breakdown({
            sleepDeepH: 1.4, sleepRemH: 1.8, sleepLightH: 4.2,
            hrAvg: 52, caloriesActive: 400, source: 'whoop',
        }));
        renderSheet('sleep');

        await waitFor(() => expect(screen.getByText('DEEP')).toBeTruthy());
        expect(screen.getByText('1h 24m')).toBeTruthy();   // 1.4h
        expect(screen.getByText('REM')).toBeTruthy();
        expect(screen.getByText('LIGHT')).toBeTruthy();
        // Heart rate and calories mean nothing on a night's sleep.
        expect(screen.queryByText('AVG HR')).toBeNull();
        expect(screen.queryByText(/kcal/)).toBeNull();
    });

    /**
     * The day-wide rule gates heart rate, NOT sleep stages — a night's stages are
     * per-session on every provider, which is why fetchSleepDayDetail has always
     * trusted HealthKit's. 663 of the 926 stage rows are native.
     */
    it('trusts HealthKit stages even though its heart rate is suppressed', async () => {
        mockFetch.mockResolvedValue(breakdown({
            sleepDeepH: 1.1, sleepRemH: 1.5, sleepLightH: 3.9, source: 'healthkit',
        }));
        renderSheet('sleep');

        await waitFor(() => expect(screen.getByText('DEEP')).toBeTruthy());
        expect(screen.getByText('Apple Health')).toBeTruthy();
    });
});

/**
 * The sheet, not the fetch, decides a pinned day's window — so this is where the
 * sleep convention has to be applied. Getting it wrong opened the neighbouring
 * night for any evening bedtime.
 */
describe('the pinned-day window', () => {
    it('shifts a sleep day to 18:00→18:00', async () => {
        mockFetch.mockResolvedValue(breakdown(null));
        renderSheet('sleep');

        await waitFor(() => expect(mockFetch).toHaveBeenCalled());
        const [, start, end] = mockFetch.mock.calls[0];
        expect(start.getHours()).toBe(18);
        expect(end.getHours()).toBe(18);
        // The sheet is pinned to 24 Jul, so the window opens the evening before.
        expect(start.getDate()).toBe(23);
        expect(end.getDate()).toBe(24);
    });

    it('leaves a workout day on plain midnight→midnight', async () => {
        mockFetch.mockResolvedValue(breakdown(null));
        renderSheet('running');

        await waitFor(() => expect(mockFetch).toHaveBeenCalled());
        const [, start, end] = mockFetch.mock.calls[0];
        expect(start.getHours()).toBe(0);
        expect(end.getHours()).toBe(0);
        expect(start.getDate()).toBe(24);
        expect(end.getDate()).toBe(25);
    });
});

describe('the wearable pitch', () => {
    it('appears for someone who trained and got no vitals', async () => {
        mockFetch.mockResolvedValue(breakdown(null));
        renderSheet();
        await waitFor(() => expect(screen.getByText(/Heart rate and calories show here/)).toBeTruthy());
    });

    it('stays away once vitals are already showing', async () => {
        mockFetch.mockResolvedValue(breakdown({
            hrAvg: 142, hrMax: null, caloriesActive: 634, source: 'whoop',
        }));
        renderSheet();
        await waitFor(() => expect(screen.getByText('142 bpm')).toBeTruthy());
        expect(screen.queryByText(/Heart rate and calories show here/)).toBeNull();
    });

    it('stays away on an empty day — there is nothing to enrich', async () => {
        mockFetch.mockResolvedValue({ total: 0, rows: [], unpaid: [] });
        renderSheet();
        await waitFor(() => expect(screen.getByText(/Nothing earned/)).toBeTruthy());
        expect(screen.queryByText(/Heart rate and calories show here/)).toBeNull();
    });

    /**
     * A gym check-in only carries vitals second-hand (the overlapping wearable
     * workout is kept in suppressed_workouts, not as a session), and the native
     * phone path can't supply them at all yet. Prompting there asks for
     * something the user may already be doing — and lands in front of Whoop
     * wearers.
     */
    it('stays away on a gym check-in, which can only borrow vitals', async () => {
        mockFetch.mockResolvedValue(breakdown(null, 'geofence'));

        renderSheet();

        await waitFor(() => expect(screen.getByText('Gym check-in')).toBeTruthy());
        expect(screen.queryByText(/Heart rate and calories show here/)).toBeNull();
        // The time tile still renders — the session just has nothing else.
        expect(screen.getByText('45m')).toBeTruthy();
    });
});

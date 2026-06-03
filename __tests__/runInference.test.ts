/**
 * Tests for the activity-inference detector (lib/health/runInference.ts).
 *
 * Garmin (and similar wearables) mirror distance into Apple Health but write no
 * HKWorkout, so we reconstruct run/cycle/swim from those distance samples.
 * `buildEfforts` is the pure grouping/pace-gating core — the native readers
 * around it can't run off-device, so this exercises the logic directly.
 */

import {
    buildEfforts,
    RUNNING_GATE,
    CYCLING_GATE,
    SWIMMING_GATE,
    type RawDistanceSample,
} from '@/lib/health/runInference';

const GARMIN = {
    platform: 'ios' as const,
    sourceBundleId: 'com.garmin.connect.mobile',
    sourceName: 'Garmin Connect',
};
const IPHONE = {
    platform: 'ios' as const,
    sourceBundleId: 'com.apple.health',
    sourceName: 'iPhone',
};

function at(hhmm: string): Date {
    return new Date(`2026-06-03T${hhmm}:00.000Z`);
}

/** One distance sample. meters over [start,end]; pace = meters/duration. */
function sample(start: string, end: string, meters: number, prov = GARMIN): RawDistanceSample {
    return { start: at(start), end: at(end), meters, prov };
}

describe('buildEfforts — running', () => {
    it('detects a Garmin run from a single sample (3.8km in 22min ≈ 10.4 km/h)', () => {
        const runs = buildEfforts([sample('12:04', '12:26', 3800)], RUNNING_GATE);
        expect(runs).toHaveLength(1);
        expect(runs[0].type).toBe('running');
        expect(runs[0].distanceM).toBe(3800);
        expect(runs[0].durationMin).toBe(22);
        expect(runs[0].avgSpeedKmh).toBeGreaterThan(8);
        expect(runs[0].startedAt).toBe(at('12:04').toISOString());
    });

    it('ignores phone-sourced distance (never infer from the iPhone pedometer)', () => {
        expect(buildEfforts([sample('12:04', '12:26', 3800, IPHONE)], RUNNING_GATE)).toHaveLength(0);
    });

    it('rejects a wearable WALK by pace (5km over 60min = 5 km/h)', () => {
        expect(buildEfforts([sample('07:00', '08:00', 5000)], RUNNING_GATE)).toHaveLength(0);
    });

    it('rejects efforts below the minimum distance even at running pace', () => {
        // 800m in 5min = 9.6 km/h (run pace) but under minDistanceM.
        expect(buildEfforts([sample('12:00', '12:05', 800)], RUNNING_GATE)).toHaveLength(0);
    });

    it('rejects implausibly fast efforts (vehicle/bike, > maxSpeedKmh)', () => {
        // 10km in 10min = 60 km/h.
        expect(buildEfforts([sample('12:00', '12:10', 10000)], RUNNING_GATE)).toHaveLength(0);
    });

    it('stitches contiguous samples (< 5min gap) into one run', () => {
        const runs = buildEfforts([
            sample('12:00', '12:08', 1400),
            sample('12:10', '12:18', 1400), // 2-min gap → same effort
            sample('12:20', '12:28', 1400),
        ], RUNNING_GATE);
        expect(runs).toHaveLength(1);
        expect(runs[0].distanceM).toBe(4200);
        expect(runs[0].startedAt).toBe(at('12:00').toISOString());
        expect(runs[0].endedAt).toBe(at('12:28').toISOString());
    });

    it('splits efforts separated by a long gap (> 5min) into distinct runs', () => {
        const runs = buildEfforts([
            sample('07:00', '07:22', 3800),
            sample('17:00', '17:22', 3800),
        ], RUNNING_GATE);
        expect(runs).toHaveLength(2);
    });
});

describe('buildEfforts — cycling', () => {
    it('detects a ride (10km in 25min = 24 km/h)', () => {
        const rides = buildEfforts([sample('09:00', '09:25', 10000)], CYCLING_GATE);
        expect(rides).toHaveLength(1);
        expect(rides[0].type).toBe('cycling');
        expect(rides[0].avgSpeedKmh).toBeCloseTo(24, 0);
    });

    it('rejects a ride below cycling pace (running-speed effort)', () => {
        // 2km in 15min = 8 km/h — below cycling minSpeedKmh (12).
        expect(buildEfforts([sample('09:00', '09:15', 2000)], CYCLING_GATE)).toHaveLength(0);
    });
});

describe('buildEfforts — swimming', () => {
    it('detects a swim (1km in 25min = 2.4 km/h)', () => {
        const swims = buildEfforts([sample('18:00', '18:25', 1000)], SWIMMING_GATE);
        expect(swims).toHaveLength(1);
        expect(swims[0].type).toBe('swimming');
    });

    it('rejects too-short swims (300m, under minDistanceM)', () => {
        expect(buildEfforts([sample('18:00', '18:12', 300)], SWIMMING_GATE)).toHaveLength(0);
    });
});

describe('buildEfforts — edge cases', () => {
    it('returns nothing for an empty sample set', () => {
        expect(buildEfforts([], RUNNING_GATE)).toHaveLength(0);
    });

    it('ignores zero-distance samples', () => {
        expect(buildEfforts([sample('12:00', '12:22', 0)], RUNNING_GATE)).toHaveLength(0);
    });
});

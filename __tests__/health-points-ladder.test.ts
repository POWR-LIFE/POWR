/**
 * lib/health/points is the ONE client scoring table for native-health sessions,
 * shared by the live sync and the history backfill. These rungs are the ones
 * enforce_point_award_cap recomputes server-side — if a value here moves, the
 * trigger (and _shared/points.ts) must move with it.
 */
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

import { calculateBasePoints, calculateSleepPoints, mapHealthType } from '@/lib/health/points';

describe('calculateBasePoints', () => {
    it('cardio takes the better of distance and duration', () => {
        expect(calculateBasePoints('running', 31, 6012)).toBe(8);
        expect(calculateBasePoints('running', 28, 5543)).toBe(8);   // 5 km rung on distance alone
        expect(calculateBasePoints('running', 137, 30046)).toBe(10);
        expect(calculateBasePoints('running', 14, 1000)).toBe(0);
        expect(calculateBasePoints('cycling', 61, 28964)).toBe(8);
        expect(calculateBasePoints('swimming', 33, null)).toBe(7);
        expect(calculateBasePoints('swimming', 45, null)).toBe(9);
    });

    it('duration-only ladders', () => {
        expect(calculateBasePoints('yoga', 26)).toBe(3);
        expect(calculateBasePoints('yoga', 31)).toBe(4);
        expect(calculateBasePoints('sports', 79)).toBe(8);
        expect(calculateBasePoints('sports', 95)).toBe(10);
        expect(calculateBasePoints('dance', 19)).toBe(0);
    });

    it('strength lane: gym entry is the tunable dwell, hiit entry is fixed at 20, upgrade is shared', () => {
        expect(calculateBasePoints('gym', 25)).toBe(0);
        expect(calculateBasePoints('gym', 30)).toBe(15);
        expect(calculateBasePoints('gym', 45)).toBe(20);
        expect(calculateBasePoints('hiit', 25)).toBe(15);
        expect(calculateBasePoints('hiit', 47)).toBe(20);
    });
});

describe('calculateSleepPoints', () => {
    it('duration tier, scaled down by a poor restorative share', () => {
        expect(calculateSleepPoints(9.2)).toBe(5);
        expect(calculateSleepPoints(7.5)).toBe(4);
        expect(calculateSleepPoints(7.5, 0.5, 0.5)).toBe(2);   // 13% restorative → ×0.6
        expect(calculateSleepPoints(2.5)).toBe(0);
    });
});

describe('mapHealthType', () => {
    it('buckets provider names; walks and hikes are not workouts', () => {
        expect(mapHealthType('HKWorkoutActivityTypeRunning')).toBe('running');
        expect(mapHealthType('Functional Strength Training')).toBe('gym');
        expect(mapHealthType('HIIT')).toBe('hiit');
        expect(mapHealthType('HKWorkoutActivityTypeHiking')).toBeNull();
        expect(mapHealthType('Walking')).toBeNull();
    });
});

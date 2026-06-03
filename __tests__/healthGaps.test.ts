/**
 * Tests for the health-gap detector (lib/health/healthGaps.ts).
 *
 * The detector decides when to nudge the user that POWR isn't getting their
 * workouts. The overriding requirement is "never nag": phone-only users and rest
 * days must stay quiet, while genuine permission/setting gaps surface.
 */

import { detectHealthGap, WORKOUT_ENERGY_HINT, type HealthGapSignals } from '@/lib/health/healthGaps';

const base: HealthGapSignals = {
    platform: 'ios',
    nativeConnected: true,
    androidExerciseGranted: null,
    wearablePresent: true,
    hadCapturedWorkoutToday: false,
    activeEnergyToday: WORKOUT_ENERGY_HINT + 100,
};

describe('detectHealthGap — quiet by default', () => {
    it('says none on web', () => {
        expect(detectHealthGap({ ...base, platform: 'web' })).toBe('none');
    });

    it('says none when the native store isn’t connected (don’t nag the unconnected)', () => {
        expect(detectHealthGap({ ...base, nativeConnected: false })).toBe('none');
    });

    it('says none for a phone-only user (no wearable present)', () => {
        expect(detectHealthGap({ ...base, wearablePresent: false })).toBe('none');
    });

    it('says none on a rest day (wearable present but low active energy)', () => {
        expect(detectHealthGap({ ...base, activeEnergyToday: 120 })).toBe('none');
    });

    it('says none once a workout has been captured today', () => {
        expect(detectHealthGap({ ...base, hadCapturedWorkoutToday: true })).toBe('none');
    });
});

describe('detectHealthGap — Android exercise permission', () => {
    it('flags missing ExerciseSession permission (highest precision)', () => {
        expect(detectHealthGap({
            ...base, platform: 'android', androidExerciseGranted: false,
        })).toBe('android_exercise_permission');
    });

    it('permission gap wins even with no other evidence (low energy, no wearable)', () => {
        expect(detectHealthGap({
            ...base, platform: 'android', androidExerciseGranted: false,
            wearablePresent: false, activeEnergyToday: 0,
        })).toBe('android_exercise_permission');
    });

    it('does not flag permission when ExerciseSession is granted', () => {
        // Granted + a captured workout → fully healthy.
        expect(detectHealthGap({
            ...base, platform: 'android', androidExerciseGranted: true,
            hadCapturedWorkoutToday: true,
        })).toBe('none');
    });
});

describe('detectHealthGap — workouts missing (both platforms)', () => {
    it('flags an iOS wearable that did real work but produced no workout', () => {
        expect(detectHealthGap(base)).toBe('workouts_missing');
    });

    it('flags an Android wearable (permission granted) whose workout never arrived', () => {
        expect(detectHealthGap({
            ...base, platform: 'android', androidExerciseGranted: true,
        })).toBe('workouts_missing');
    });

    it('requires energy at or above the hint threshold', () => {
        expect(detectHealthGap({ ...base, activeEnergyToday: WORKOUT_ENERGY_HINT })).toBe('workouts_missing');
        expect(detectHealthGap({ ...base, activeEnergyToday: WORKOUT_ENERGY_HINT - 1 })).toBe('none');
    });
});

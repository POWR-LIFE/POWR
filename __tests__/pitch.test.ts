import { compact, doorProgress, huntStage, peopleToPass, PULSE_PITCH, PULSE_TODAY, pulseRank } from '@/lib/pitch';

describe('pulseRank', () => {
    it('climbs with steps at the pitch scale, barely at today’s', () => {
        expect(pulseRank(PULSE_PITCH, 2000)).toBe(634 - 46);
        expect(pulseRank(PULSE_TODAY, 2000)).toBe(5);
    });

    it('never goes above #1', () => {
        expect(pulseRank(PULSE_TODAY, 1_000_000)).toBe(1);
    });
});

describe('peopleToPass', () => {
    it('scales with the distance left and caps at the people above you', () => {
        expect(peopleToPass(PULSE_PITCH, 634, 1800)).toBe(41);
        expect(peopleToPass(PULSE_TODAY, 6, 1800)).toBe(1);
        expect(peopleToPass(PULSE_TODAY, 2, 50_000)).toBe(1);
        expect(peopleToPass(PULSE_PITCH, 634, 0)).toBe(0);
    });
});

describe('huntStage', () => {
    it('opens clues at 2, 5 and 10 km', () => {
        expect(huntStage(1.9)).toMatchObject({ open: 0, next: { atKm: 2 } });
        expect(huntStage(5)).toMatchObject({ open: 2, next: { atKm: 10 } });
        expect(huntStage(12)).toMatchObject({ open: 3, next: null, pct: 1 });
    });
});

describe('compact / doorProgress', () => {
    it('reads big numbers short', () => {
        expect(compact(1_800_000)).toBe('1.8M');
        expect(compact(2_000_000)).toBe('2M');
        expect(compact(24_000)).toBe('24k');
        expect(compact(2814)).toBe('2,814');
    });

    it('clamps door progress', () => {
        expect(doorProgress(20, 40)).toBe(0.5);
        expect(doorProgress(60, 40)).toBe(1);
        expect(doorProgress(5, 0)).toBe(0);
    });
});

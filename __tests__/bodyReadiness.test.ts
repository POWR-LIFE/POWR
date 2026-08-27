/**
 * Readiness for people who don't wear their wearable to bed (Sorine, 2026-08-27):
 * the ring and the verdict must be judged on the signals the device actually
 * produces, and "no data" must say which kind of nothing it is.
 */
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() }, getSessionUser: jest.fn() }));
jest.mock('@/lib/api/activity', () => ({
    localDateStr: (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
}));
jest.mock('@/lib/api/pointsBreakdown', () => ({ hrZonesFrom: () => undefined, isDayWideRow: () => false }));

import {
    deriveBodySignals,
    readinessOf,
    type BodyTrends,
    type LoadDay,
    type TrendPoint,
} from '@/lib/api/bodyTrends';

function daysAgo(n: number): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Oldest first, one reading per day ending today. */
function series(values: number[]): TrendPoint[] {
    return values.map((value, i) => ({ date: daysAgo(values.length - 1 - i), value }));
}

/** Seven load days ending today; `activeMin` per day oldest first. */
function load(activeMin: number[]): LoadDay[] {
    return activeMin.map((min, i) => ({ date: daysAgo(6 - i), activeMin: min, hardMin: 0 }));
}

const EMPTY_WEEK = { zoneMixSec: [], peakHr: null, kcal: 0 };

function trends(partial: Partial<BodyTrends>): BodyTrends {
    return { restingHr: [], hrv: [], sleepHours: [], load: load([0, 0, 0, 0, 0, 0, 0]), week: EMPTY_WEEK, ...partial };
}

describe('readiness without sleep', () => {
    test('a day-worn device with fresh resting HR reads Primed on RHR + load alone', () => {
        const t = trends({
            restingHr: series([55, 54, 56, 55, 54, 53]),
            load: load([0, 40, 0, 45, 0, 30, 0]),
        });
        const d = deriveBodySignals(t);
        expect(d.tracksSleep).toBe(false);
        expect(d.tracksRhr).toBe(true);
        expect(d.rhrBaselineReady).toBe(true);
        const r = readinessOf(d);
        expect(r.word).toBe('Primed');
        expect(r.level).toBe('good');
        // Two signals available (RHR + load), both good — a FULL ring, not 2/3.
        expect(r.ring).toBe(1);
    });

    test('an elevated resting HR still says Easy, ring halves', () => {
        const t = trends({ restingHr: series([52, 52, 52, 52, 52, 58]) });
        const r = readinessOf(deriveBodySignals(t));
        expect(r.word).toBe('Easy');
        expect(r.reason).toBe('heart says rest');
        expect(r.ring).toBe(0.5);
    });

    test('a resting HR too old to be fresh is not a verdict', () => {
        const stale = [{ date: daysAgo(13), value: 55 }, { date: daysAgo(12), value: 56 }];
        const d = deriveBodySignals(trends({ restingHr: stale, load: load([0, 40, 0, 45, 0, 30, 0]) }));
        expect(d.rhrFresh).toBeNull();
        const r = readinessOf(d);
        expect(r.level).toBe('unknown');
        // RHR HAS landed before — the device is worn, it just hasn't sent lately.
        expect(r.reason).toBe('no recent readings');
    });

    test('training only, no sleep and no RHR ever, names what is missing', () => {
        const d = deriveBodySignals(trends({ load: load([0, 40, 0, 45, 0, 30, 0]) }));
        expect(d.weekActiveDays).toBe(3);
        expect(d.weekActiveMin).toBe(115);
        const r = readinessOf(d);
        expect(r.level).toBe('unknown');
        expect(r.reason).toBe('needs sleep or resting HR');
        expect(r.ring).toBe(0);
    });
});

describe('readiness with sleep (unchanged behaviour)', () => {
    test('a sleeper whose night has not synced today is still "not synced", not "not tracked"', () => {
        const t = trends({ sleepHours: [{ date: daysAgo(2), value: 7.5 }, { date: daysAgo(1), value: 7 }] });
        const d = deriveBodySignals(t);
        expect(d.tracksSleep).toBe(true);
        expect(d.nightFresh).toBeNull();
        expect(readinessOf(d).level).toBe('unknown');
    });

    test('a sleeper who stopped wearing it to bed is "not tracked" again after a week', () => {
        const lapsed = [{ date: daysAgo(12), value: 7.5 }, { date: daysAgo(10), value: 7 }];
        const d = deriveBodySignals(trends({ sleepHours: lapsed, restingHr: series([55, 54, 56, 55, 54, 53]) }));
        expect(d.tracksSleep).toBe(false);
        // Judged on RHR + load again — a full ring, not a stale night's absence.
        expect(readinessOf(d).ring).toBe(1);
    });

    test('a short night still says Easy, and the sleep signal counts against the ring', () => {
        const t = trends({ sleepHours: series([7.5, 7.4, 7.6, 5]) });
        const r = readinessOf(deriveBodySignals(t));
        expect(r.word).toBe('Easy');
        expect(r.reason).toBe('short night');
        // sleep (bad) + load (good) → half
        expect(r.ring).toBe(0.5);
    });

    test('a good night with no RHR device is a full ring, not a third empty for an untracked signal', () => {
        const t = trends({ sleepHours: series([7.5, 7.4, 7.6, 7.8]) });
        const r = readinessOf(deriveBodySignals(t));
        expect(r.word).toBe('Primed');
        expect(r.ring).toBe(1);
    });
});

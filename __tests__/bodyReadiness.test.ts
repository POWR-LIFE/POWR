/**
 * Readiness for people who don't wear their wearable to bed (Sorine, 2026-08-27):
 * the ring and the verdict must be judged on the signals the device actually
 * produces, and "no data" must say which kind of nothing it is.
 *
 * 2026-09-06: the night's own vitals (resting HR, HRV, the provider's recovery
 * score) now ride on the sleep row. A provider score outranks our derivation;
 * a low HRV is a caution; a verdict from one signal out of several says so.
 */
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() }, getSessionUser: jest.fn() }));
jest.mock('@/lib/api/activity', () => ({
    localDateStr: (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
}));
jest.mock('@/lib/api/pointsBreakdown', () => ({ hrZonesFrom: () => undefined, isDayWideRow: () => false }));

import {
    deriveBodySignals,
    loadNormFrom,
    readinessOf,
    seriesFromSnapshots,
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
    const sleepHours = partial.sleepHours ?? [];
    return {
        restingHr: [], hrv: [], sleepHours, readiness: [],
        sleepNights: sleepHours.map(p => ({ date: p.date, hours: p.value, deepH: null, remH: null, efficiency: null })),
        load: load([0, 0, 0, 0, 0, 0, 0]), loadNormWeekMin: null, week: EMPTY_WEEK,
        ...partial,
    };
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
        // The only tracked signal is present — nothing is missing, not partial.
        expect(r.partial).toBe(false);
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
        expect(d.rhrDaysAgo).toBe(12);
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

describe('the night carries its vitals', () => {
    test('a provider recovery score for this morning outranks the derivation', () => {
        // Sleep says fine, RHR says fine — but the device scored the night low.
        const t = trends({
            sleepHours: series([7.5, 7.4, 7.6, 7.8]),
            restingHr: series([55, 54, 56, 55, 54, 53]),
            readiness: [{ date: daysAgo(0), value: 28, source: 'whoop' }],
        });
        const d = deriveBodySignals(t);
        expect(d.providerReadiness?.value).toBe(28);
        const r = readinessOf(d);
        expect(r.word).toBe('Rest');
        expect(r.level).toBe('attention');
        expect(r.reason).toBe('recovery 28%');
        // The ring IS the score when the device gave one.
        expect(r.ring).toBeCloseTo(0.28);
        expect(r.partial).toBe(false);
    });

    test('provider bands: 67+ Primed, 34–66 Easy', () => {
        const at = (value: number) => readinessOf(deriveBodySignals(trends({
            sleepHours: series([7.5, 7.4, 7.6, 7.8]),
            readiness: [{ date: daysAgo(0), value, source: 'whoop' }],
        })));
        expect(at(67).word).toBe('Primed');
        expect(at(66).word).toBe('Easy');
        expect(at(34).word).toBe('Easy');
        expect(at(33).word).toBe('Rest');
    });

    test("yesterday's provider score is not this morning's verdict", () => {
        const t = trends({
            sleepHours: series([7.5, 7.4, 7.6, 7.8]),
            readiness: [{ date: daysAgo(1), value: 28, source: 'whoop' }],
        });
        const d = deriveBodySignals(t);
        expect(d.providerReadiness).toBeNull();
        // Falls back to the derivation: a good night → Primed.
        expect(readinessOf(d).word).toBe('Primed');
    });

    test('HRV well under the usual is a caution, even after a fine night', () => {
        const t = trends({
            sleepHours: series([7.5, 7.4, 7.6, 7.8]),
            hrv: series([70, 72, 68, 74, 71, 55]),
        });
        const d = deriveBodySignals(t);
        expect(d.hrvBaselineReady).toBe(true);
        expect(d.hrvLow).toBe(true);
        const r = readinessOf(d);
        expect(r.word).toBe('Easy');
        expect(r.reason).toBe('HRV below your usual');
    });

    test('an ordinary HRV dip is not a warning', () => {
        const t = trends({ sleepHours: series([7.5, 7.4, 7.6, 7.8]), hrv: series([70, 72, 68, 74, 71, 65]) });
        const d = deriveBodySignals(t);
        expect(d.hrvLow).toBe(false);
        expect(readinessOf(d).word).toBe('Primed');
    });

    test('HRV needs a baseline before it can be "low"', () => {
        const t = trends({ sleepHours: series([7.5, 7.4, 7.6, 7.8]), hrv: series([80, 40]) });
        expect(deriveBodySignals(t).hrvLow).toBe(false);
    });

    test('a verdict from sleep alone, while HRV and RHR are tracked but unsynced, is partial', () => {
        const t = trends({
            sleepHours: series([7.5, 7.4, 7.6, 7.8]),
            hrv: series([70, 72, 68, 74, 71]).map(p => ({ ...p, date: daysAgo(3 + (5 - series([1, 1, 1, 1, 1]).indexOf(p))) })),
            restingHr: [{ date: daysAgo(5), value: 55 }, { date: daysAgo(4), value: 54 }],
        });
        const d = deriveBodySignals(t);
        expect(d.basis).toEqual(['sleep']);
        expect(d.missing).toEqual(expect.arrayContaining(['hrv', 'rhr']));
        const r = readinessOf(d);
        expect(r.word).toBe('Primed');
        expect(r.partial).toBe(true);
    });

    test('a full read — sleep, HRV and RHR all fresh — is not partial', () => {
        const t = trends({
            sleepHours: series([7.5, 7.4, 7.6, 7.8]),
            hrv: series([70, 72, 68, 74, 71, 73]),
            restingHr: series([55, 54, 56, 55, 54, 53]),
        });
        const d = deriveBodySignals(t);
        expect(d.basis).toEqual(['sleep', 'hrv', 'rhr']);
        expect(d.missing).toEqual([]);
        expect(readinessOf(d).partial).toBe(false);
    });
});

describe('sleep quality and debt', () => {
    test('debt is the shortfall against 8h over the last 7 recorded nights; long nights do not pay it back', () => {
        const t = trends({ sleepHours: series([9, 6, 7, 8, 6.5, 7.5, 8.5]) });
        const d = deriveBodySignals(t);
        // 2h + 1h + 1.5h + 0.5h = 5h short; the 9h and 8.5h nights add nothing.
        expect(d.sleepDebtMin7).toBe(300);
    });

    test('deep + REM share and efficiency average over the week where reported', () => {
        const nights = [
            { date: daysAgo(2), hours: 8, deepH: 2, remH: 2, efficiency: 90 },
            { date: daysAgo(1), hours: 6, deepH: 1, remH: 1, efficiency: 80 },
            { date: daysAgo(0), hours: 7, deepH: null, remH: null, efficiency: null },
        ];
        const t = trends({
            sleepHours: nights.map(n => ({ date: n.date, value: n.hours })),
            sleepNights: nights,
        });
        const d = deriveBodySignals(t);
        // Only staged nights count toward the share: (2+2+1+1) / (8+6).
        expect(d.deepRemShare7).toBeCloseTo(6 / 14);
        expect(d.efficiency7).toBe(85);
    });
});

describe('load against the usual week', () => {
    test('this week vs the mean of the three before it', () => {
        const t = trends({ load: load([0, 40, 0, 45, 0, 30, 0]), loadNormWeekMin: 90 });
        expect(deriveBodySignals(t).weekVsUsualMin).toBe(25);
    });

    test('loadNormFrom averages the prior weeks and ignores the load window itself', () => {
        const normSince = new Date(); normSince.setHours(0, 0, 0, 0); normSince.setDate(normSince.getDate() - 27);
        const loadSince = new Date(); loadSince.setHours(0, 0, 0, 0); loadSince.setDate(loadSince.getDate() - 6);
        const at = (n: number, min: number, type = 'gym') => ({
            started_at: new Date(`${daysAgo(n)}T10:00:00`).toISOString(), duration_sec: min * 60, type,
        });
        const sessions = [
            at(20, 60), at(15, 60), at(10, 60),       // 180 min over 21 prior days
            at(3, 45),                                // this week — excluded
            at(12, 500, 'walking'),                   // walking never counts
        ];
        // 180 / 21 days * 7 = 60 min per usual week.
        expect(loadNormFrom(sessions, normSince, loadSince)).toBe(60);
    });

    test('no training in the prior weeks means no norm', () => {
        const normSince = new Date(); normSince.setDate(normSince.getDate() - 27);
        const loadSince = new Date(); loadSince.setDate(loadSince.getDate() - 6);
        expect(loadNormFrom([], normSince, loadSince)).toBeNull();
        expect(deriveBodySignals(trends({ load: load([0, 40, 0, 0, 0, 0, 0]) })).weekVsUsualMin).toBeNull();
    });
});

describe('seriesFromSnapshots — night vitals belong to the morning you woke', () => {
    const iso = (day: string, time: string) => new Date(`${day}T${time}`).toISOString();
    const row = (over: Record<string, unknown>) => ({
        recorded_at: iso(daysAgo(0), '09:00:00'), source: 'whoop', hr_max: null, calories_active: null,
        hr_resting: null, sleep_duration_h: null, sleep_deep_h: null, sleep_rem_h: null, sleep_light_h: null,
        extras: null, session: null, ...over,
    });

    test('a night that ended this morning files its RHR, HRV and score under today', () => {
        const rows = [row({
            recorded_at: iso(daysAgo(0), '07:30:00'),
            hr_resting: 52, sleep_duration_h: 7.5, sleep_deep_h: 1.5, sleep_rem_h: 2,
            extras: { hrv_rmssd: 71.2, readiness: 82, sleep_efficiency: 91 },
            session: { started_at: iso(daysAgo(1), '23:30:00'), ended_at: iso(daysAgo(0), '07:15:00') },
        })];
        const s = seriesFromSnapshots(rows as never);
        expect(s.restingHr).toEqual([{ date: daysAgo(0), value: 52 }]);
        expect(s.hrv).toEqual([{ date: daysAgo(0), value: 71.2 }]);
        expect(s.readiness).toEqual([{ date: daysAgo(0), value: 82, source: 'whoop' }]);
        expect(s.sleepNights[0]).toMatchObject({ date: daysAgo(0), hours: 7.5, deepH: 1.5, remH: 2, efficiency: 91 });
    });

    test("a nap's HRV does not displace the night's", () => {
        const night = row({
            recorded_at: iso(daysAgo(0), '07:30:00'),
            sleep_duration_h: 7.5, extras: { hrv_rmssd: 71 },
            session: { started_at: iso(daysAgo(1), '23:30:00'), ended_at: iso(daysAgo(0), '07:15:00') },
        });
        const nap = row({
            recorded_at: iso(daysAgo(0), '15:30:00'),
            sleep_duration_h: 1.2, extras: { hrv_rmssd: 40 },
            session: { started_at: iso(daysAgo(0), '14:00:00'), ended_at: iso(daysAgo(0), '15:15:00') },
        });
        const s = seriesFromSnapshots([night, nap] as never);
        expect(s.hrv).toEqual([{ date: daysAgo(0), value: 71 }]);
        expect(s.sleepHours).toEqual([{ date: daysAgo(0), value: 7.5 }]);
    });

    test("the night's resting HR wins over the day row's for the same date", () => {
        const day = row({ recorded_at: iso(daysAgo(0), '12:00:00'), hr_resting: 60, extras: { scope: 'day' } });
        const night = row({
            recorded_at: iso(daysAgo(0), '07:30:00'), hr_resting: 55, sleep_duration_h: 7,
            session: { started_at: iso(daysAgo(1), '23:30:00'), ended_at: iso(daysAgo(0), '07:00:00') },
        });
        const s = seriesFromSnapshots([night, day] as never);
        expect(s.restingHr).toEqual([{ date: daysAgo(0), value: 55 }]);
    });

    test('a day row alone still lands under its own date', () => {
        const day = row({ recorded_at: iso(daysAgo(1), '12:00:00'), hr_resting: 60, extras: { hrv_rmssd: 50 } });
        const s = seriesFromSnapshots([day] as never);
        expect(s.restingHr).toEqual([{ date: daysAgo(1), value: 60 }]);
        expect(s.hrv).toEqual([{ date: daysAgo(1), value: 50 }]);
        expect(s.sleepNights).toEqual([]);
    });
});

/**
 * lib/health/hrZones — time-in-zone built on the phone from a workout's heart
 * rate samples, in the shape Whoop's zones arrive in through Terra, so the day
 * sheet and the Body tab's effort mix draw them unchanged.
 */
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() }, getSessionUser: jest.fn() }));

import { hrZonesFrom } from '@/lib/api/pointsBreakdown';
import { maxHrFrom, zonesFromSamples, type HrSample } from '@/lib/health/hrZones';

const T0 = Date.UTC(2026, 9, 7, 7, 0, 0);
const S = 1000;

/** One sample every `everySec` seconds for `forSec`, all at `bpm`. */
function steady(bpm: number, forSec: number, everySec = 5, startMs = T0): HrSample[] {
    const out: HrSample[] = [];
    for (let t = 0; t < forSec; t += everySec) out.push({ atMs: startMs + t * S, bpm });
    return out;
}

const secs = (zones: ReturnType<typeof zonesFromSamples>) => zones!.map(z => z.duration_seconds);

describe('zonesFromSamples', () => {
    it('credits each sample with the time until the next, into its % of max', () => {
        // 150 of 190 = 79% → zone 3, for ten minutes.
        const zones = zonesFromSamples(steady(150, 600), T0 + 600 * S, 190);
        expect(secs(zones)).toEqual([0, 0, 0, 600, 0, 0]);
    });

    it('splits a workout across zones', () => {
        const samples = [
            ...steady(100, 300),                       // 53% → zone 1
            ...steady(175, 300, 5, T0 + 300 * S),      // 92% → zone 5
        ];
        expect(secs(zonesFromSamples(samples, T0 + 600 * S, 190))).toEqual([0, 300, 0, 0, 0, 300]);
    });

    it('puts a reading exactly on an edge in the zone above it', () => {
        // 171 of 190 = 90.0% → zone 5; 94 of 190 = 49.5% → zone 0.
        expect(secs(zonesFromSamples(steady(171, 120), T0 + 120 * S, 190))).toEqual([0, 0, 0, 0, 0, 120]);
        expect(secs(zonesFromSamples(steady(94, 120), T0 + 120 * S, 190))).toEqual([120, 0, 0, 0, 0, 0]);
    });

    it("doesn't let the last reading before a gap claim the whole silence", () => {
        // Two readings ten minutes apart: the first speaks for two minutes, no more.
        const samples = [{ atMs: T0, bpm: 150 }, { atMs: T0 + 600 * S, bpm: 150 }];
        expect(secs(zonesFromSamples(samples, T0 + 610 * S, 190))).toEqual([0, 0, 0, 130, 0, 0]);
    });

    it('drops readings no heart makes', () => {
        const samples = [...steady(150, 120), { atMs: T0 + 30 * S, bpm: 0 }, { atMs: T0 + 31 * S, bpm: 255 }];
        expect(secs(zonesFromSamples(samples, T0 + 120 * S, 190))).toEqual([0, 0, 0, 120, 0, 0]);
    });

    it('returns null with nothing to measure against or too little to draw', () => {
        expect(zonesFromSamples(steady(150, 600), T0 + 600 * S, null)).toBeNull();
        expect(zonesFromSamples([{ atMs: T0, bpm: 150 }], T0 + 600 * S, 190)).toBeNull();
        expect(zonesFromSamples(steady(150, 40), T0 + 40 * S, 190)).toBeNull(); // under a minute
    });

    it('comes out in the shape the sheet already reads for Whoop', () => {
        const zones = zonesFromSamples(steady(150, 600), T0 + 600 * S, 190)!;
        expect(zones[3]).toEqual({ name: 'Zone 3', zone: 3, start_percentage: 70, end_percentage: 80, duration_seconds: 600 });
        // Round trip through the reader the day sheet and the Body tab use.
        const read = hrZonesFrom({ hr_zones: zones });
        expect(read?.map(z => z.durationSec)).toEqual([0, 0, 0, 600, 0, 0]);
        expect(read?.[3].pctOfMax).toBe(80);
    });
});

describe('maxHrFrom', () => {
    const NOW = Date.UTC(2026, 9, 7);
    const bornYearsAgo = (y: number) => new Date(NOW - y * 365.25 * 24 * 3600 * 1000);

    it("uses the age formula when there's a birth date", () => {
        expect(maxHrFrom({ birthDate: bornYearsAgo(40), now: NOW })).toBe(180); // 208 − 28
    });

    it("rises to what the user has actually reached, by at most 15 bpm", () => {
        expect(maxHrFrom({ birthDate: bornYearsAgo(40), observedPeak: 186, now: NOW })).toBe(186);
        // A 228 sensor spike can't drag every zone down.
        expect(maxHrFrom({ birthDate: bornYearsAgo(40), observedPeak: 228, now: NOW })).toBe(195);
        // A lower peak doesn't pull the formula down.
        expect(maxHrFrom({ birthDate: bornYearsAgo(40), observedPeak: 150, now: NOW })).toBe(180);
    });

    it('falls back to the observed peak without a birth date (Health Connect has none)', () => {
        expect(maxHrFrom({ observedPeak: 177, now: NOW })).toBe(177);
        expect(maxHrFrom({ observedPeak: 226, now: NOW })).toBe(210);
    });

    it('gives no max at all until the user has pushed hard enough to measure against', () => {
        expect(maxHrFrom({ observedPeak: 140, now: NOW })).toBeNull();
        expect(maxHrFrom({ now: NOW })).toBeNull();
        // A birth date that can't be right is ignored, not trusted.
        expect(maxHrFrom({ birthDate: bornYearsAgo(5), observedPeak: 140, now: NOW })).toBeNull();
    });
});

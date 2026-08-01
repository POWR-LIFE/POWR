/**
 * Per-workout metric extraction from Terra payloads
 * (supabase/functions/_shared/terraExtras.ts).
 *
 * These exist because the first version shipped inline in the edge function,
 * untestable, and silently fabricated a zero for every field a provider sent as
 * null — `typeof null === 'object'`, so it fell through to `Number(null) === 0`,
 * which is finite and passed every downstream guard. Prod picked up a gym
 * session holding `swim_laps: 0` and `pool_length_m: 0`, and a HIIT session
 * holding `hr_min: 0`, before it was caught.
 *
 * The distinction that matters: Garmin sends populated summary objects whose
 * unmeasured members are explicit nulls, while Whoop omits the keys entirely.
 * Both must produce an ABSENT field, never a zero.
 */

import { activityExtras, num } from '@/supabase/functions/_shared/terraExtras';

describe('num', () => {
    it('passes finite numbers through', () => {
        expect(num(124)).toBe(124);
        expect(num(0)).toBe(0);
        expect(num(-5)).toBe(-5);
    });

    it('rounds to the requested precision', () => {
        expect(num(42.4567, 1)).toBe(42.5);
        expect(num(42.4567)).toBe(42);
    });

    /** The bug. Every one of these coerces to a finite number under Number(). */
    it.each<[string, unknown]>([
        ['null', null],
        ['empty string', ''],
        ['blank string', '   '],
        ['empty array', []],
        ['true', true],
        ['false', false],
    ])('rejects %s rather than coercing it to a number', (_label, input) => {
        expect(num(input)).toBeNull();
    });

    it('rejects undefined, NaN and non-numeric strings', () => {
        expect(num(undefined)).toBeNull();
        expect(num(NaN)).toBeNull();
        expect(num('abc')).toBeNull();
        expect(num(Infinity)).toBeNull();
    });

    it('still accepts a numeric string — a quoted number is a formatting quirk', () => {
        expect(num('124')).toBe(124);
        expect(num('42.46', 1)).toBe(42.5);
    });
});

describe('activityExtras', () => {
    /** Garmin's shape: the summary objects exist, unmeasured members are null. */
    it('drops explicit nulls instead of storing them as zeroes', () => {
        const extras = activityExtras({
            heart_rate_data: { summary: { min_hr_bpm: 59, avg_hrv_rmssd: null } },
            distance_data: {
                summary: {
                    steps: null,
                    floors_climbed: null,
                    elevation: { gain_actual_meters: null, loss_actual_meters: null },
                    swimming: { num_laps: null, num_strokes: null, pool_length_meters: null },
                },
            },
            power_data: { avg_watts: null, max_watts: null },
            MET_data: { num_high_intensity_minutes: null },
        });

        // Only the one real reading survives.
        expect(extras).toEqual({ hr_min: 59 });
        // Specifically: a gym workout must never come back claiming pool data.
        expect(extras).not.toHaveProperty('swim_laps');
        expect(extras).not.toHaveProperty('pool_length_m');
        expect(extras).not.toHaveProperty('avg_watts');
    });

    /** Whoop's shape: keys simply absent. Already worked, pinned so it stays. */
    it('handles a provider that omits keys entirely', () => {
        const extras = activityExtras({
            heart_rate_data: { summary: { min_hr_bpm: 58, avg_hrv_rmssd: 42.5 } },
            MET_data: { num_high_intensity_minutes: 12 },
        });

        expect(extras).toEqual({ hr_min: 58, hrv_rmssd: 42.5, high_intensity_min: 12 });
    });

    it('returns null when the payload carries nothing usable', () => {
        expect(activityExtras({})).toBeNull();
        expect(activityExtras({ heart_rate_data: { summary: { min_hr_bpm: null } } })).toBeNull();
    });

    it('keeps a genuine zero apart from a missing value', () => {
        // 0 elevation gain on a flat run is a real reading and should persist.
        const extras = activityExtras({
            distance_data: { summary: { elevation: { gain_actual_meters: 0 } } },
        });
        expect(extras).toEqual({ elevation_gain_m: 0 });
    });

    describe('the bounded-json rule', () => {
        it('never lets a sample series into the column', () => {
            const extras = activityExtras({
                heart_rate_data: {
                    summary: { min_hr_bpm: 60 },
                    samples: Array.from({ length: 5000 }, (_, i) => ({ timestamp: i, bpm: 120 })),
                },
                power_data: {
                    avg_watts: 210,
                    power_samples: Array.from({ length: 5000 }, (_, i) => ({ t: i, w: 200 })),
                },
                position_data: { position_samples: Array.from({ length: 5000 }, () => ({ lat: 1, lng: 2 })) },
            });

            expect(JSON.stringify(extras).length).toBeLessThan(500);
            expect(extras).toEqual({ hr_min: 60, avg_watts: 210 });
        });

        it('caps hr_zones and strips nested objects from each entry', () => {
            const extras = activityExtras({
                heart_rate_data: {
                    summary: {
                        min_hr_bpm: 60,
                        hr_zone_data: Array.from({ length: 40 }, (_, i) => ({
                            zone: i,
                            duration_seconds: 60,
                            samples: Array.from({ length: 500 }, () => 1),
                        })),
                    },
                },
            });

            const zones = (extras as any).hr_zones;
            expect(zones).toHaveLength(8);
            expect(zones[0]).toEqual({ zone: 0, duration_seconds: 60 });
            expect(zones[0]).not.toHaveProperty('samples');
        });

        /**
         * Zones are stored in the provider's own shape because Terra publishes no
         * schema for HeartRateZoneData — so unknown key names must survive.
         */
        it('preserves zone keys we have never seen', () => {
            const extras = activityExtras({
                heart_rate_data: {
                    summary: { hr_zone_data: [{ name: 'Zone 3', secs_in_zone: 420, pct: 31.5 }] },
                },
            });

            expect((extras as any).hr_zones).toEqual([{ name: 'Zone 3', secs_in_zone: 420, pct: 31.5 }]);
        });
    });
});

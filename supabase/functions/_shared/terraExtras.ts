// Per-workout metric extraction from a Terra activity payload. Pure and
// dependency-free — no Deno or React Native APIs — so both runtimes import it:
//   - edge function (Deno): import { ... } from '../_shared/terraExtras.ts'
//   - jest (Node):          import { ... } from '@/supabase/functions/_shared/terraExtras'
//
// This lives here rather than inline in terra-webhook specifically so it can be
// tested. The first version shipped inline and silently wrote a fabricated 0 for
// every field a provider sent as null — a gym session came back holding
// swim_laps: 0 and pool_length_m: 0, and a HIIT session held hr_min: 0. Nothing
// caught it because nothing could run it.

/**
 * A finite number, or null for anything that isn't genuinely numeric.
 *
 * The null check is load-bearing and must come FIRST: `typeof null === 'object'`,
 * so a bare `Number(v)` coercion turns null into 0, which is finite and sails
 * through every downstream guard. Garmin sends populated summary objects whose
 * unmeasured members are explicit nulls (Whoop just omits the keys), so that one
 * gap fabricated a dozen zero readings per Garmin workout.
 *
 * Booleans and empty/blank strings are rejected for the same reason —
 * Number(true) === 1, Number('') === 0, Number([]) === 0. Numeric strings are
 * still accepted, since a provider quoting its numbers is a formatting quirk
 * rather than a missing measurement.
 */
export function num(v: unknown, dp = 0): number | null {
    if (v == null) return null;
    if (typeof v === 'boolean') return null;

    let n: number;
    if (typeof v === 'number') {
        n = v;
    } else if (typeof v === 'string' && v.trim() !== '') {
        n = Number(v);
    } else {
        return null;
    }

    if (!Number.isFinite(n)) return null;
    const f = 10 ** dp;
    return Math.round(n * f) / f;
}

/**
 * The per-workout metrics Terra sends beyond the five stored as columns.
 *
 * Terra never re-serves an old payload, so anything not read here is lost for
 * that session forever — hence casting wide. Providers fill very different
 * subsets (Whoop sends no distance or max HR; Garmin sends both), so every field
 * is optional and null-stripped: a snapshot holds only what actually arrived,
 * and null is returned rather than {} when nothing did.
 *
 * HARD RULE: summaries only. Terra also ships heart_rate_samples, power_samples,
 * MET_samples and position_data — thousands of points per workout. Those must
 * never land in this column; an oversized json write is what broke every points
 * award for 4.5 hours on 2026-07-20. hr_zones is the one array allowed through
 * because it is at most a handful of buckets, and it is length-capped anyway.
 */
export function activityExtras(a: any): Record<string, unknown> | null {
    const hr = a?.heart_rate_data?.summary ?? {};
    const dist = a?.distance_data?.summary ?? {};
    const cal = a?.calories_data ?? {};
    const met = a?.MET_data ?? {};
    const power = a?.power_data ?? {};

    const out: Record<string, unknown> = {
        hr_min: num(hr.min_hr_bpm),
        hrv_rmssd: num(hr.avg_hrv_rmssd, 1),
        elevation_gain_m: num(dist.elevation?.gain_actual_meters),
        elevation_loss_m: num(dist.elevation?.loss_actual_meters),
        steps: num(dist.steps),
        floors: num(dist.floors_climbed),
        swim_laps: num(dist.swimming?.num_laps),
        swim_strokes: num(dist.swimming?.num_strokes),
        pool_length_m: num(dist.swimming?.pool_length_meters, 1),
        avg_watts: num(power.avg_watts),
        max_watts: num(power.max_watts),
        net_calories: num(cal.net_activity_calories),
        high_intensity_min: num(met.num_high_intensity_minutes),
        moderate_intensity_min: num(met.num_moderate_intensity_minutes),
    };

    // Time-in-zone, stored in the PROVIDER'S OWN SHAPE on purpose.
    //
    // Terra documents hr_zone_data as Array<HeartRateZoneData> but publishes no
    // schema for it — not in the data-models reference, not in the v2 OpenAPI
    // bundle. Mapping it to guessed key names would silently drop every zone the
    // moment a guess was wrong, and Terra never re-serves a payload, so those
    // would be gone for good. Capturing the raw objects means a real delivery
    // tells us the names and we map on the read side.
    //
    // Still bounded, which is the rule for this column: at most 8 entries, each
    // reduced to its SCALAR keys so a nested sample series can't ride in.
    const zones = Array.isArray(hr.hr_zone_data) ? hr.hr_zone_data.slice(0, 8) : [];
    const safeZones = zones
        .map((z: unknown) => {
            if (!z || typeof z !== 'object') return null;
            const scalars: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(z as Record<string, unknown>)) {
                const t = typeof v;
                if (t === 'number' || t === 'string' || t === 'boolean') scalars[k] = v;
            }
            return Object.keys(scalars).length ? scalars : null;
        })
        .filter(Boolean);
    if (safeZones.length) out.hr_zones = safeZones;

    for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
    return Object.keys(out).length ? out : null;
}

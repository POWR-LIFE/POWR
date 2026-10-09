/**
 * Time-in-zone for a workout, from the heart-rate samples the phone's health
 * store recorded over it.
 *
 * Until now only Whoop sent zones (through Terra), so the Body tab's effort mix
 * and the day sheet's zone bar were Whoop-only. Apple Health and Health Connect
 * hold every heart-rate sample a watch recorded, so the same buckets can be
 * built on the phone for anyone who wears one.
 *
 * The output is Whoop's shape, the one lib/api/pointsBreakdown hrZonesFrom()
 * already reads — six zones, 0–5, by % of max heart rate:
 *   { name, zone, start_percentage, end_percentage, duration_seconds }
 * so every surface that draws Whoop's zones draws these unchanged.
 *
 * Pure: no native imports. The samples are read in lib/health/windowVitals and
 * the max heart rate in lib/health/maxHeartRate.
 */

export type HrSample = { atMs: number; bpm: number };

export type HrZoneRecord = {
    name: string;
    zone: number;
    start_percentage: number;
    end_percentage: number;
    duration_seconds: number;
};

/** Zone edges as % of max heart rate — Whoop's six zones, 0 through 5. */
const ZONE_EDGES = [0, 50, 60, 70, 80, 90, 100] as const;

/**
 * Longest gap one sample may speak for. A watch samples every few seconds in a
 * workout; a longer gap is the watch off the wrist or out of contact, and the
 * last reading before it must not claim the whole silence.
 */
const MAX_SAMPLE_SPAN_MS = 2 * 60 * 1000;

/** Under a minute of zone time isn't a distribution (pointsBreakdown's floor too). */
const MIN_TOTAL_SEC = 60;

const PLAUSIBLE_BPM = { min: 30, max: 230 };

function zoneOf(pctOfMax: number): number {
    for (let z = ZONE_EDGES.length - 2; z >= 1; z--) {
        if (pctOfMax >= ZONE_EDGES[z]) return z;
    }
    return 0;
}

/**
 * Seconds in each zone. Each sample speaks for the time until the next one (or
 * the window's end), capped at MAX_SAMPLE_SPAN_MS. Null when there's too little
 * to draw, or no max heart rate to measure against.
 */
export function zonesFromSamples(
    samples: HrSample[],
    windowEndMs: number,
    maxHr: number | null | undefined,
): HrZoneRecord[] | null {
    if (maxHr == null || !(maxHr > 0)) return null;
    const sorted = samples
        .filter(s => Number.isFinite(s.atMs) && s.bpm >= PLAUSIBLE_BPM.min && s.bpm <= PLAUSIBLE_BPM.max)
        .sort((a, b) => a.atMs - b.atMs);
    if (sorted.length < 2) return null;

    const ms = new Array<number>(ZONE_EDGES.length - 1).fill(0);
    for (let i = 0; i < sorted.length; i++) {
        const until = i + 1 < sorted.length ? sorted[i + 1].atMs : windowEndMs;
        const span = Math.min(Math.max(until - sorted[i].atMs, 0), MAX_SAMPLE_SPAN_MS);
        ms[zoneOf((sorted[i].bpm / maxHr) * 100)] += span;
    }

    const totalSec = ms.reduce((s, v) => s + v, 0) / 1000;
    if (totalSec < MIN_TOTAL_SEC) return null;

    return ms.map((spanMs, zone) => ({
        name: `Zone ${zone}`,
        zone,
        start_percentage: ZONE_EDGES[zone],
        end_percentage: ZONE_EDGES[zone + 1],
        duration_seconds: Math.round(spanMs / 1000),
    }));
}

/**
 * Max heart rate to measure zones against.
 *
 * With a birth date: Tanaka's 208 − 0.7 × age, raised to what the user has
 * actually reached (a fit 50-year-old routinely beats the formula) but by no
 * more than 15 bpm — one optical-sensor spike must not drag every zone down.
 * Without one (Health Connect has no birth date): the user's own observed peak,
 * capped for the same reason, and only once it's high enough to be a real
 * effort — a peak of 140 says the user hasn't pushed yet, not that 140 is max.
 */
export function maxHrFrom(input: {
    birthDate?: Date | null;
    observedPeak?: number | null;
    now?: number;
}): number | null {
    const now = input.now ?? Date.now();
    const peak = input.observedPeak != null && Number.isFinite(input.observedPeak)
        && input.observedPeak >= 100 && input.observedPeak <= PLAUSIBLE_BPM.max
        ? input.observedPeak : null;

    const birth = input.birthDate?.getTime();
    const age = birth != null && Number.isFinite(birth)
        ? (now - birth) / (365.25 * 24 * 60 * 60 * 1000) : null;
    if (age != null && age >= 13 && age <= 100) {
        const predicted = 208 - 0.7 * age;
        const raised = peak != null ? Math.min(Math.max(predicted, peak), predicted + 15) : predicted;
        return Math.round(raised);
    }

    if (peak == null || peak < 150) return null;
    return Math.round(Math.min(peak, 210));
}

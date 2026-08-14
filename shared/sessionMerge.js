/**
 * Deciding whether a newly-seen workout is a NEW workout or another telling of
 * one we already hold.
 *
 * A mirror copy lives at supabase/functions/_shared/sessionMerge.ts (Deno ESM,
 * used by terra-webhook) — keep in sync. __tests__/sessionMerge.test.ts asserts
 * the two agree, so a change to one that isn't made to the other fails CI.
 * Same arrangement as shared/challengeRules.js ↔ _shared/challenges.ts: the two
 * runtimes cannot import each other (the Supabase CLI only bundles what lives
 * under supabase/functions/, and Metro does not bundle Deno sources).
 *
 * Why this exists: a workout the user stops and restarts — pausing for a phone
 * call mid-run — reaches us as TWO activities. Until 2026-08-07 a per-type-per
 * -day unique index made the second one collide with the first, and whichever
 * telling was longer overwrote the other, so a 10 k run came out as the 5.85 km
 * that happened after the call. Both halves were real.
 */

/**
 * How long a workout may be interrupted and still count as one workout.
 *
 * Long enough to cover the thing that actually interrupts people — a phone
 * call, a level crossing, waiting for someone to catch up — and short enough
 * that a morning run and a lunchtime run stay two runs.
 */
const CONTIGUOUS_GAP_MIN = 30;

/**
 * @typedef {Object} WorkoutWindow
 * @property {number} startMs
 * @property {number} endMs
 * @property {number} durationSec
 * @property {number|null} [distanceM]
 * @property {number|null} [hrAvg]
 */

/**
 * Classify an incoming workout against one we already hold: 'same' (one
 * activity told twice), 'contiguous' (one activity split in two), or
 * 'separate'.
 *
 * Overlap means one activity, always — a wearable cannot record two runs at the
 * same time. Everything else is judged on the gap between them.
 *
 * @param {WorkoutWindow} existing
 * @param {WorkoutWindow} incoming
 * @param {number} [gapMin]
 * @returns {'same'|'contiguous'|'separate'}
 */
function relateWorkouts(existing, incoming, gapMin = CONTIGUOUS_GAP_MIN) {
    if (existing.startMs < incoming.endMs && incoming.startMs < existing.endMs) return 'same';
    const gapMs = incoming.startMs >= existing.endMs
        ? incoming.startMs - existing.endMs
        : existing.startMs - incoming.endMs;
    return gapMs <= gapMin * 60000 ? 'contiguous' : 'separate';
}

/**
 * Combine an incoming workout into the one we hold.
 *
 * 'same'       — take the more complete of each field; a fragment under-reports
 *                everything, so max() is the truth and a replay changes nothing.
 * 'contiguous' — the window spans both, but duration and distance SUM: elapsed
 *                time would bill the phone call as running, and the pause is
 *                exactly what the user did not do.
 *
 * @param {WorkoutWindow} existing
 * @param {WorkoutWindow} incoming
 * @param {'same'|'contiguous'} relation
 */
function mergeWorkouts(existing, incoming, relation) {
    const startMs = Math.min(existing.startMs, incoming.startMs);
    const endMs = Math.max(existing.endMs, incoming.endMs);

    const durationSec = relation === 'contiguous'
        ? existing.durationSec + incoming.durationSec
        : Math.max(existing.durationSec, incoming.durationSec);

    const distanceM = relation === 'contiguous'
        ? sumOrNull(existing.distanceM, incoming.distanceM)
        : maxOrNull(existing.distanceM, incoming.distanceM);

    const rawHr = relation === 'contiguous'
        ? weightedHr(existing, incoming)
        : (incoming.durationSec >= existing.durationSec
            ? (incoming.hrAvg ?? existing.hrAvg ?? null)
            : (existing.hrAvg ?? incoming.hrAvg ?? null));
    const hrAvg = rawHr == null ? null : Math.round(rawHr);

    return {
        startMs,
        endMs,
        durationSec,
        distanceM,
        hrAvg,
        changed: startMs !== existing.startMs
            || endMs !== existing.endMs
            || durationSec !== existing.durationSec
            || distanceM !== (existing.distanceM ?? null)
            || hrAvg !== (existing.hrAvg ?? null),
    };
}

function sumOrNull(a, b) {
    if (a == null && b == null) return null;
    return (a ?? 0) + (b ?? 0);
}

function maxOrNull(a, b) {
    if (a == null && b == null) return null;
    return Math.max(a ?? 0, b ?? 0);
}

/** Duration-weighted mean HR; falls back to whichever side reported one. */
function weightedHr(a, b) {
    if (a.hrAvg == null) return b.hrAvg ?? null;
    if (b.hrAvg == null) return a.hrAvg;
    const aW = Math.max(a.durationSec, 1);
    const bW = Math.max(b.durationSec, 1);
    return (a.hrAvg * aW + b.hrAvg * bW) / (aW + bW);
}

module.exports = { CONTIGUOUS_GAP_MIN, relateWorkouts, mergeWorkouts };

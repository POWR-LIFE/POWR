// Pure, dependency-free helpers for deciding what a newly-delivered wearable
// workout IS relative to one we already hold. No Deno or React Native APIs, so
// both runtimes can import it:
//   - edge function (Deno): import { ... } from '../_shared/sessionMerge.ts'
//   - jest (Node):          import { ... } from '@/supabase/functions/_shared/sessionMerge'
//
// Terra hands us the same workout more than once (a mid-workout fragment, then
// the finished article, then whatever terra-poll replays), and it hands us
// genuinely different workouts that happen to share a type and a day. Until
// 2026-08-07 both cases collapsed into one 23505 on a per-type-per-day unique
// index and the longer telling simply overwrote the shorter one — which quietly
// destroyed the first half of any workout the user paused and resumed (a 10 k
// run interrupted by a phone call was stored as the 5.85 km that came after it).
//
// Telling the cases apart is a question about the two time windows, not about
// the database, so it lives here where it can be tested directly.

/** One delivery's window and the metrics that merge across deliveries. */
export interface WorkoutWindow {
  startMs: number;
  endMs: number;
  durationSec: number;
  distanceM?: number | null;
  hrAvg?: number | null;
}

/**
 * How long a workout may be interrupted and still count as one workout.
 *
 * Long enough to cover the thing that actually interrupts people — a phone
 * call, a level crossing, waiting for someone to catch up — and short enough
 * that a morning run and a lunchtime run stay two runs. A watch that is paused
 * rather than stopped never reaches us as two activities at all, so this only
 * governs the case where the user ENDED one activity and STARTED another.
 */
export const CONTIGUOUS_GAP_MIN = 30;

export type SegmentRelation =
  /** Two tellings of ONE activity: a fragment and its finished form, or a replay. */
  | 'same'
  /** Two activities close enough together to be one interrupted workout. */
  | 'contiguous'
  /** Unrelated workouts that merely share a type. */
  | 'separate';

/**
 * Classify an incoming delivery against a workout we already hold.
 *
 * Overlap means one activity, always: a wearable cannot record two runs at the
 * same time, so overlapping windows are the same run told twice. Everything
 * else is judged on the gap between them.
 */
export function relateWorkouts(
  existing: WorkoutWindow,
  incoming: WorkoutWindow,
  gapMin: number = CONTIGUOUS_GAP_MIN,
): SegmentRelation {
  if (existing.startMs < incoming.endMs && incoming.startMs < existing.endMs) return 'same';
  const gapMs = incoming.startMs >= existing.endMs
    ? incoming.startMs - existing.endMs
    : existing.startMs - incoming.endMs;
  return gapMs <= gapMin * 60_000 ? 'contiguous' : 'separate';
}

export interface MergedWorkout {
  startMs: number;
  endMs: number;
  durationSec: number;
  distanceM: number | null;
  hrAvg: number | null;
  /** False when the incoming delivery told us nothing we did not already hold. */
  changed: boolean;
}

/**
 * Combine an incoming delivery into the workout we hold.
 *
 * 'same'       — one activity, two tellings. Take the more complete of each
 *                field; a fragment under-reports everything, so max() is the
 *                truth and a stale replay changes nothing.
 * 'contiguous' — one activity the user split in two. The window spans both, but
 *                duration and distance SUM: elapsed time would bill the phone
 *                call as running, and the pause is exactly what the user did not
 *                do. Heart rate averages weighted by how long each half lasted.
 */
export function mergeWorkouts(
  existing: WorkoutWindow,
  incoming: WorkoutWindow,
  relation: Exclude<SegmentRelation, 'separate'>,
): MergedWorkout {
  const startMs = Math.min(existing.startMs, incoming.startMs);
  const endMs = Math.max(existing.endMs, incoming.endMs);

  const durationSec = relation === 'contiguous'
    ? existing.durationSec + incoming.durationSec
    : Math.max(existing.durationSec, incoming.durationSec);

  const distanceM = relation === 'contiguous'
    ? sumOrNull(existing.distanceM, incoming.distanceM)
    : maxOrNull(existing.distanceM, incoming.distanceM);

  const hrAvg = relation === 'contiguous'
    ? weightedHr(existing, incoming)
    // The longer telling saw more of the workout, so its average is the better
    // one. Never null out a reading we already learned.
    : (incoming.durationSec >= existing.durationSec
        ? (incoming.hrAvg ?? existing.hrAvg ?? null)
        : (existing.hrAvg ?? incoming.hrAvg ?? null));

  return {
    startMs,
    endMs,
    durationSec,
    distanceM,
    hrAvg: hrAvg == null ? null : Math.round(hrAvg),
    changed: startMs !== existing.startMs
      || endMs !== existing.endMs
      || durationSec !== existing.durationSec
      || distanceM !== (existing.distanceM ?? null)
      || (hrAvg == null ? null : Math.round(hrAvg)) !== (existing.hrAvg ?? null),
  };
}

function sumOrNull(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function maxOrNull(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null;
  return Math.max(a ?? 0, b ?? 0);
}

/** Duration-weighted mean HR; falls back to whichever side reported one. */
function weightedHr(a: WorkoutWindow, b: WorkoutWindow): number | null {
  if (a.hrAvg == null) return b.hrAvg ?? null;
  if (b.hrAvg == null) return a.hrAvg;
  const aW = Math.max(a.durationSec, 1);
  const bW = Math.max(b.durationSec, 1);
  return (a.hrAvg * aW + b.hrAvg * bW) / (aW + bW);
}

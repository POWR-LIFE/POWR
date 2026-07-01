// Pure, dependency-free source-of-truth priority rules shared by the edge
// functions (claim-points, terra-webhook) and the Jest unit tests. NO Deno or
// React Native APIs here, so both runtimes can import it:
//   - edge function (Deno): import { ... } from '../_shared/sessionPriority.ts'
//   - jest (Node):          import { ... } from '@/supabase/functions/_shared/sessionPriority'
//
// Priority is geofence (0.94) > wearable/health (0.85 / walking 0.90) > manual
// (0.55). A POWR geofence gym check-in is the feature we own and the authoritative
// record of that time spent at the gym, so it outranks any wearable/health/manual
// entry for the same window. 'health' (native phone sync, split from 'wearable' in
// migration 20260601000002) ranks with wearable — both defer to a check-in.
// See project_verification_priority_and_manual_cap.

export interface PrioritySession {
  type: string;
  verification: string;
  trust_score: number;
  started_at: string;
  /** Optional — falls back to started_at + duration_sec when absent. */
  ended_at?: string | null;
  duration_sec?: number | null;
}

/** Daily-aggregate categories that stand on their own and are NEVER superseded by
 *  a gym visit: `walking` (its session spans the whole day) and `sleep`. */
const DAILY_CATEGORIES = new Set(['walking', 'sleep']);

/** [startMs, endMs] for a session, resolving the end from ended_at, else
 *  started_at + duration_sec (0 when neither is known → a zero-length window). */
export function sessionWindowMs(s: PrioritySession): [number, number] {
  const start = new Date(s.started_at).getTime();
  const end = s.ended_at
    ? new Date(s.ended_at).getTime()
    : start + (s.duration_sec ?? 0) * 1000;
  return [start, end];
}

/** Half-open overlap: two windows share time iff aStart < bEnd && aEnd > bStart. */
export function windowsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Verification sources that defer to a geofence check-in for the same window. */
const SUPERSEDABLE = new Set(['wearable', 'health', 'manual']);

/**
 * Should the geofence check-in `winner` supersede `candidate`?
 *
 * True when the candidate is a lower-trust wearable/health/manual WORKOUT whose
 * window overlaps the check-in — it's the same time at the gym, so it defers
 * regardless of how the device classified it (cycling on the gym bike, a HIIT
 * class, a yoga class, generic "strength", etc.). This is deliberately
 * type-agnostic: matching only same-type would let an overlapping wearable
 * `cycling`/`hiit`/`sports` survive alongside the gym check-in and double-count
 * points.
 *
 * Excluded: `walking` (daily steps; its session spans the whole day so it would
 * always "overlap") and `sleep` — both are independent of a gym visit. Also
 * excluded: anything not lower-trust than the check-in (another geofence, etc.).
 */
export function geofenceSupersedes(winner: PrioritySession, candidate: PrioritySession): boolean {
  if (winner.verification !== 'geofence') return false;
  if (!SUPERSEDABLE.has(candidate.verification)) return false;
  if (candidate.trust_score >= winner.trust_score) return false;
  if (DAILY_CATEGORIES.has(candidate.type)) return false;
  const [wStart, wEnd] = sessionWindowMs(winner);
  const [cStart, cEnd] = sessionWindowMs(candidate);
  return windowsOverlap(wStart, wEnd, cStart, cEnd);
}

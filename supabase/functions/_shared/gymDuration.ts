// Pure, dependency-free rule for the duration a gym session should RECORD, as
// distinct from the elapsed wall clock it is GATED on. NO Deno or React Native
// APIs here, so both runtimes can import it:
//   - edge function (Deno): import { ... } from '../_shared/gymDuration.ts'
//   - jest (Node):          import { ... } from '@/supabase/functions/_shared/gymDuration'
//
// WHY THIS EXISTS. upgrade-gym-tier used to write duration_sec = now − started_at
// on every call, and it performs that UPDATE *before* its `delta <= 0` idempotency
// return — so even a no-op retry ratcheted the number forward. A relay landing
// hours late (Doze, a failed retry, the app reopened the next morning) overwrote
// an already-correct 45-min session with the 12 h backstop. Measured 2026-08-01:
// 3 of the 16 sessions pinned at exactly 43200 s got there this way — 086aa9f0 has
// stream ticks proving 57 min of presence, and 5b34d854 stores 7.1 h off a 42-min
// visit across 4 'upgraded' events.
//
// See project_session_duration_integrity.

/** Backstop — mirrors MAX_GYM_SESSION_SEC in GeofenceContext / gymPresence.ts. */
export const MAX_GYM_SESSION_SEC = 12 * 60 * 60; // 12 h

export interface GymDurationInputs {
  /** Real entry→now wall clock in seconds, already 12 h-capped. The eligibility
   *  gate reads this directly; it is only ever an upper bound here. */
  elapsedSec: number;
  /** started_at → gym_visits.last_confirmed_at, "last time the DEVICE proved it
   *  was inside" (20260713150000_gym_visit_beacon.sql:20,31). Null when the visit
   *  is unknown or never confirmed — populated on roughly 44 % of visits. */
  presenceSec?: number | null;
  /** The duration already on the row — usually the client's own frozen exit
   *  value, which beats any wall clock computable server-side. */
  recordedSec?: number | null;
  /** system_config → gym_upgrade_minutes (default 40). The tier being paid for. */
  upgradeMin: number;
}

/**
 * The duration to STORE on a gym session at upgrade time.
 *
 * Takes the MIN of the available evidence rather than a priority order, because
 * last_confirmed_at is not purely a location proof: claim-points and
 * upgrade-gym-tier's own markVisitUpgraded both stamp it to now() on a relay
 * mark, so a second late call would otherwise read back its own timestamp and
 * re-inflate. Taking the weakest bound makes the function convergent — repeated
 * calls settle on one value instead of ratcheting.
 *
 * Bounds: never above `elapsedSec`, never below the tier being paid for (a row
 * must stay consistent with its own tier) — and that floor is itself capped at
 * elapsed, so the dev-test short-upgrade path can't be inflated past real time.
 *
 * Returning a SHORT estimate is safe — points key off session_id and the target
 * tier, never off duration_sec, and a narrower window only means fewer real
 * workouts suppressed by supersedeLowerTrust / overlapsGeofenceGym. WRITING it
 * short is not: the stored row only ever grows (#345 — the exit close guards
 * with greatest(), and a post-close upgrade replay shrank a closed 3276 s
 * session to its 2400 s tier floor on 2026-08-11). The caller clamps
 * grows-only at write time; this function stays a pure estimate. That clamp
 * also means a row already poisoned high no longer self-heals downward here —
 * correcting those is a cleanup's job, not a live write path's.
 */
export function recordedGymDurationSec(input: GymDurationInputs): number {
  const elapsedSec = Number.isFinite(input.elapsedSec)
    ? Math.min(Math.max(0, Math.round(input.elapsedSec)), MAX_GYM_SESSION_SEC)
    : MAX_GYM_SESSION_SEC;

  const evidence = [input.presenceSec, input.recordedSec].filter(
    (v): v is number => v != null && Number.isFinite(v) && v > 0,
  );

  const bounded = evidence.length ? Math.min(elapsedSec, ...evidence) : elapsedSec;

  // Floor at the tier so the stored length can never contradict the tier just
  // awarded — but never above elapsed, so a dev-override upgrade of a genuinely
  // short session records its real length.
  const tierFloorSec = Math.min(Math.max(0, input.upgradeMin) * 60, elapsedSec);

  return Math.max(tierFloorSec, bounded);
}

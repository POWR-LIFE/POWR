// Pure, dependency-free rule for whether a claimed geofence gym session should
// be FLAGGED as carrying more duration than the device ever proved. NO Deno or
// React Native APIs here, so both runtimes can import it:
//   - edge function (Deno): import { ... } from '../_shared/proofAudit.ts'
//   - jest (Node):          import { ... } from '@/supabase/functions/_shared/proofAudit'
//
// WHY THIS EXISTS. The visit-side proof floor clamps gym_visits.ended_at to the
// last proven moment, but the session row is INSERTed by the client and the
// grows-only DB guard (guard_client_session_window) only fires on UPDATE — so a
// claim arriving hours later carries whatever duration the client computed and
// nothing server-side ever compares it to the evidence. Field 2026-08-19: a
// 2-hour visit with ZERO presence proofs was clamped to 0.0 min on the visit and
// still claimed as a 121-minute geofence-verified session. 2026-08-17: a 0-min
// visit claimed the NEXT DAY as 128 minutes.
//
// The award is deliberately untouched — most zero-proof visits are honest users
// whose background pipeline was dead (auth jam, undelivered wakes, revoked
// permission), and never-drop-a-workout is the product rule. This audit only
// decides whether the session must surface in the flagged-only admin triage
// instead of passing as silently verified.
//
// ⚠ Feed this last_proven_at ONLY — never last_confirmed_at. claim-points marks
// the visit claimed with last_confirmed_at = now() moments before the audit
// runs, so the weaker column always reads "proved through the claim" and the
// audit would never fire. last_proven_at has one writer class (fixes that pass
// the credit gate) and is exactly the clock the exit clamp already trusts.
//
// See project_geofence_realuser_review_20260820.

/** A session may exceed its proven window by this much before it is flagged.
 *  Generous on purpose: proof cadence is minutes apart, exits detect late, and
 *  a claim can land a beat after the last proof. What it must catch is the
 *  shape where the proven window is (near) zero and the claimed duration is a
 *  whole workout. */
export const UNPROVEN_EXCESS_FLAG_SEC = 30 * 60;

export interface ProofAuditInputs {
  /** activity_sessions.duration_sec as claimed. */
  durationSec: number;
  /** gym_visits.started_at of the visit this claim marked (claimed_session_id).
   *  Null when no visit resolved — which is itself zero evidence: every real
   *  geofence chain creates a visit at check-in. */
  visitStartedAt?: string | null;
  /** gym_visits.last_proven_at — the last moment the device PROVED presence.
   *  Null when the visit never proved once. */
  lastProvenAt?: string | null;
  /** gym_visits.ended_at when close_gym_visit closed the visit on an END
   *  WITNESS (exit event `end_basis` = 'exit_witness' | 'capped_12h'). The
   *  visit engine already believes the device was present until that moment
   *  (20260906170000), so the audit must too — otherwise a claim that settles
   *  on the way out is flagged at "proven 0" while the visit that produced it
   *  was closed unclamped on the same evidence (LP, 2026-09-14: 102 min,
   *  exit_witness, clamped:false, flagged). Null for every other close. */
  exitWitnessedAt?: string | null;
}

/** Seconds of presence the server can actually vouch for. 0 when there is no
 *  visit, no proof, or unparseable timestamps — absence of evidence is the
 *  honest reading here, because this value only ever widens leniency. */
export function provenSec(i: ProofAuditInputs): number {
  if (!i.visitStartedAt) return 0;
  const start = Date.parse(i.visitStartedAt);
  if (!Number.isFinite(start)) return 0;
  const proven = i.lastProvenAt ? Date.parse(i.lastProvenAt) : NaN;
  const witnessed = i.exitWitnessedAt ? Date.parse(i.exitWitnessedAt) : NaN;
  const until = Math.max(
    Number.isFinite(proven) ? proven : Number.NEGATIVE_INFINITY,
    Number.isFinite(witnessed) ? witnessed : Number.NEGATIVE_INFINITY,
  );
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, Math.round((until - start) / 1000));
}

/** Exit-event `end_basis` values under which the visit engine believed the
 *  device's own end time (see close_gym_visit, 20260906170000). Shared with
 *  the SQL reconcile so both readers agree on what an end witness is. */
export const END_WITNESS_BASES = ['exit_witness', 'capped_12h'] as const;

export function exitWitnessedAtFromExitEvent(
  detail: { end_basis?: string | null; ended_at?: string | null } | null | undefined,
): string | null {
  if (!detail) return null;
  if (!END_WITNESS_BASES.includes(detail.end_basis as typeof END_WITNESS_BASES[number])) return null;
  return detail.ended_at ?? null;
}

/** Claimed seconds beyond what was proven. Never negative. */
export function unprovenExcessSec(i: ProofAuditInputs): number {
  const dur = Number.isFinite(i.durationSec) ? Math.max(0, i.durationSec) : 0;
  return Math.max(0, dur - provenSec(i));
}

export function shouldFlagUnproven(
  i: ProofAuditInputs,
  thresholdSec: number = UNPROVEN_EXCESS_FLAG_SEC,
): boolean {
  return unprovenExcessSec(i) > thresholdSec;
}

// Pure, dependency-free "which activities are relevant to this user" rule.
// NO Deno or React Native APIs here, so both runtimes can import it:
//   - edge function (Deno): import { ... } from '../_shared/activityRelevance.ts'
//   - client / jest:        import { ... } from '@/supabase/functions/_shared/activityRelevance'
//
// WHY THIS EXISTS. Until 2026-08-28 'gym' was force-prepended to every user's
// activity_preferences (the "locked slot"), so a walk/run/cycle-only user could
// never say they don't go to the gym — and every gym-framed surface (the
// weekly challenge board, "your gym check-ins are paused", the permission-fix
// copy) fired for them anyway. Gym is now an ordinary, pre-selected pick, and
// relevance is decided HERE, once, from two signals:
//
//   declared  — profiles.activity_preferences (what the user picked)
//   observed  — activity types that actually landed as sessions recently
//
// Relevance = declared ∪ observed. Observed-over-declared is deliberate in both
// directions: a runner who starts checking in at a gym gets gym surfaces
// without touching settings, and someone who ticked gym in onboarding and
// never went is still *declared* gym (we honour the pick) — the copy just
// stops assuming everyone is. The challenge board and the streak-rescue sweep
// already used this union rule in hand-rolled copies; this is the one place.

/** How far back "observed" looks for the copy/notification decisions. The
 *  rescue sweep uses the same 21-day evidence window. The weekly challenge
 *  board passes its own this-week sessions instead (a mid-week new activity
 *  should add its challenge that week, not three weeks later). */
export const RELEVANCE_WINDOW_DAYS = 21;
export const RELEVANCE_WINDOW_MS = RELEVANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export interface SessionLike {
  type?: string | null;
  started_at?: string | null;
  verification?: string | null;
}

/** Session types with no activity identity of their own — never "relevant". */
const NON_ACTIVITY_TYPES = new Set(['sleep']);

/**
 * Distinct activity types the user has actually produced, newest-agnostic.
 * Manual logs are EXCLUDED by default: the challenge board never counts them
 * and a self-reported gym log shouldn't switch someone's board to gym goals.
 * Pass `includeManual: true` for copy decisions, where a manual gym log is
 * still honest evidence that the gym matters to this person.
 */
export function observedActivityTypes(
  sessions: ReadonlyArray<SessionLike> | null | undefined,
  opts: { sinceMs?: number; includeManual?: boolean } = {},
): string[] {
  const out = new Set<string>();
  for (const s of sessions ?? []) {
    if (!s || typeof s.type !== 'string' || !s.type) continue;
    if (NON_ACTIVITY_TYPES.has(s.type)) continue;
    if (!opts.includeManual && s.verification === 'manual') continue;
    if (opts.sinceMs != null) {
      const t = s.started_at ? Date.parse(s.started_at) : NaN;
      if (!Number.isFinite(t) || t < opts.sinceMs) continue;
    }
    out.add(s.type);
  }
  return [...out];
}

/**
 * declared ∪ observed, declared order first, de-duplicated, garbage dropped.
 * `declared` is typed unknown because it arrives straight from a jsonb /
 * text[] column or user_metadata and may be anything.
 */
export function relevantActivities(
  declared: unknown,
  observed: Iterable<string> | null | undefined = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v !== 'string' || !v || NON_ACTIVITY_TYPES.has(v) || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  if (Array.isArray(declared)) for (const d of declared) push(d);
  for (const o of observed ?? []) push(o);
  return out;
}

export function isActivityRelevant(
  type: string,
  declared: unknown,
  observed: Iterable<string> | null | undefined = [],
): boolean {
  return relevantActivities(declared, observed).includes(type);
}

/**
 * The question every gym-framed surface asks. Uses the 21-day window and
 * counts manual gym logs as evidence (see observedActivityTypes).
 */
export function isGymRelevant(
  declared: unknown,
  sessions: ReadonlyArray<SessionLike> | null | undefined,
  nowMs: number,
): boolean {
  const observed = observedActivityTypes(sessions, {
    sinceMs: nowMs - RELEVANCE_WINDOW_MS,
    includeManual: true,
  });
  return isActivityRelevant('gym', declared, observed);
}

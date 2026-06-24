// Pure, dependency-free helpers for shared ("together") challenges, shared by the
// shared-challenge edge functions and the Jest unit tests. NO Deno or React
// Native APIs here, so both runtimes can import it:
//   - edge function (Deno): import { ... } from '../_shared/sharedChallenges.ts'
//   - jest (Node):          import { ... } from '@/supabase/functions/_shared/sharedChallenges'
//
// Two concerns live here:
//   1. groupBonus — the AUTHORITATIVE mirror of the app's lib/social/bonus.ts.
//      The completion settlement computes the bonus from this; never trust a
//      client total. See docs/shared-challenges-scope.md §6a.
//   2. templateRule — translate an admin-authored structured `measure` into a
//      rule-engine Rule (the same shape evaluateChallenge in ./challenges.ts
//      consumes). The admin panel authors {measure,target,unit,days,window};
//      this is the single place that becomes a real Rule, snapshotted onto the
//      challenge instance at creation.

// ── Group-size bonus ─────────────────────────────────────────────────────────
export interface BonusConfig {
  /** Points added per co-completer (other participant who individually finished). */
  perHead: number;
  /** Hard cap on the total bonus, so a big group can't mint unbounded points. */
  maxBonus: number;
}

/**
 * Bonus points for a given number of co-completers (participants EXCLUDING you
 * who individually met their part). Always ≥ 0 and ≤ maxBonus.
 */
export function groupBonus(coCompleters: number, cfg: BonusConfig): number {
  const heads = Math.max(0, Math.floor(coCompleters));
  return Math.min(cfg.maxBonus, cfg.perHead * heads);
}

// ── Structured measure → Rule ────────────────────────────────────────────────

/** The structured authoring shape the admin panel stores on a template. */
export interface Measure {
  measure: string;            // 'checkins' | 'distinct_days' | 'steps_week' | 'steps_day' | 'distance' | 'runs' | 'rides' | 'sessions' | 'categories'
  target: number;
  unit?: string | null;       // 'km' | 'mi' for distance measures
  days?: number | null;       // per-day measures: how many qualifying days
  window?: string | null;     // 'any' | 'before_9am' | 'midday' | 'after_6pm'
}

/** A rule-engine Rule (structurally what evaluateChallenge in ./challenges.ts reads). */
export type SharedRule = Record<string, unknown> & { kind: string; target: number };

const KM_M = 1000;
const MILE_M = 1609.34;

/** Gym time-window → the session_count rule's hour predicate. */
function withGymWindow(rule: SharedRule, window?: string | null): SharedRule {
  switch (window) {
    case 'before_9am': return { ...rule, beforeHour: 9 };
    case 'midday':     return { ...rule, hourWindow: [12, 14] };
    case 'after_6pm':  return { ...rule, hourWindow: [18, 24] };
    default:           return rule;
  }
}

/** Walking time-window → the step_window rule's bucket name. */
const STEP_WINDOW: Record<string, 'morning' | 'midday' | 'evening'> = {
  before_9am: 'morning',
  midday: 'midday',
  after_6pm: 'evening',
};

/**
 * Translate a template's structured measure (+ its category) into the Rule the
 * evaluator understands. Mirrors the admin panel's goalText mapping 1:1.
 */
export function templateRule(category: string, m: Measure): SharedRule {
  const target = Math.max(0, Math.floor(Number(m.target) || 0));

  switch (m.measure) {
    case 'checkins':
      return withGymWindow({ kind: 'session_count', category: 'gym', target }, m.window);

    case 'distinct_days':
      return { kind: 'distinct_days', category: 'gym', target };

    case 'steps_week':
      return { kind: 'weekly_sum', metric: 'steps', target };

    case 'steps_day': {
      const days = Math.max(1, Math.floor(Number(m.days) || 1));
      const win = m.window && m.window !== 'any' ? STEP_WINDOW[m.window] : null;
      return win
        ? { kind: 'step_window', window: win, threshold: target, target: days }
        : { kind: 'daily_metric_days', threshold: target, target: days };
    }

    case 'distance': {
      const metres = Math.round((Number(m.target) || 0) * (m.unit === 'mi' ? MILE_M : KM_M));
      return { kind: 'weekly_sum', metric: 'distance_m', category, target: metres };
    }

    case 'runs':
      return { kind: 'session_count', category: 'running', target };

    case 'rides':
      return { kind: 'session_count', category: 'cycling', target };

    case 'sessions':
      return { kind: 'session_count', target };

    case 'categories':
      return { kind: 'distinct_categories', perCat: 1, target };

    default:
      // Safe fallback: count sessions in the template's category.
      return { kind: 'session_count', category, target: target || 1 };
  }
}

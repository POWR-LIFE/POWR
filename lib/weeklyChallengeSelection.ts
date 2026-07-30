/**
 * Picks which weekly challenges the Home board shows. Completion data says the
 * long list read as failure: nobody has ever cleared all five, and 84% of
 * completing weeks are 1–2 finishes — so the board runs two visible "slots"
 * and keeps the rest as a hidden queue that reveals one-at-a-time as slots
 * clear. All five still evaluate and award server-side; this is display only,
 * which also means a hidden challenge completed through normal activity pops
 * in already-done rather than never existing.
 */

import type { ChallengeCardData } from '@/hooks/useWeeklyChallenge';

export const ACTIVE_SLOTS = 2;

const TIER_RANK: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

export interface WeeklyBoard {
  /** The visible goals — at most ACTIVE_SLOTS, momentum-ranked. */
  active: ChallengeCardData[];
  /** Finished this week — rendered as receipts under the goals. */
  done: ChallengeCardData[];
  /** Still queued out of sight ("N more unlock as you clear these"). */
  hiddenCount: number;
  /**
   * Categories ranked by this week's signal, for persisting — next Monday
   * everything resets to zero, and without a memory the slots would open on
   * arbitrary catalog order (the "0/100 km to a non-cyclist" problem). Null
   * when this week has no signal yet, so a quiet week never overwrites a
   * meaningful order with noise.
   */
  derivedOrder: string[] | null;
}

/**
 * This week's relevance signal. Fraction dominates (it is literal progress
 * toward the goal); category-active days break ties for goals the user is
 * circling but not yet moving (walked every day, but short of the daily
 * target). Weighting fraction ×100 also stops the multi/'All' challenge —
 * whose day-count accrues from ANY activity — from outranking a genuinely
 * progressed single-category goal.
 */
function score(c: ChallengeCardData): number {
  return c.fraction * 100 + c.streak.filter(Boolean).length;
}

function isDone(c: ChallengeCardData): boolean {
  return c.completed || c.fraction >= 1;
}

export function selectWeeklyBoard(
  challenges: ChallengeCardData[],
  storedOrder: string[] | null,
): WeeklyBoard {
  const done = challenges.filter(isDone);
  const remaining = challenges.filter((c) => !isDone(c));

  const orderIdx = (c: ChallengeCardData) => {
    const i = storedOrder?.indexOf(c.category) ?? -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  // Momentum first, then last-known relevance, then the easiest thing to say
  // yes to. Array.prototype.sort is stable, so full ties keep catalog order.
  const ranked = [...remaining].sort(
    (a, b) =>
      score(b) - score(a) ||
      orderIdx(a) - orderIdx(b) ||
      (TIER_RANK[a.tier] ?? 1) - (TIER_RANK[b.tier] ?? 1),
  );

  const active = ranked.slice(0, ACTIVE_SLOTS);
  const hiddenCount = ranked.length - active.length;

  // Completed counts as signal (fraction 1 → score ≥ 100), so a cleared
  // category correctly leads next week's order. MERGE with the stored order
  // rather than replace it: a category quiet THIS week keeps last week's
  // standing — otherwise one gym-only week would demote a regular runner's
  // running slot to catalog noise.
  const hasSignal = challenges.some((c) => score(c) > 0);
  let derivedOrder: string[] | null = null;
  if (hasSignal) {
    const scored = challenges
      .filter((c) => score(c) > 0)
      .sort((a, b) => score(b) - score(a))
      .map((c) => c.category);
    const rest = challenges
      .map((c) => c.category)
      .filter((cat) => !scored.includes(cat))
      .sort((a, b) => {
        const ia = storedOrder?.indexOf(a) ?? -1;
        const ib = storedOrder?.indexOf(b) ?? -1;
        return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
      });
    derivedOrder = [...scored, ...rest];
  }

  return { active, done, hiddenCount, derivedOrder };
}

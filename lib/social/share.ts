import type { ChallengeShareInput } from '@/lib/api/share';
import { challengeBonusConfig, earnedPoints, type BonusConfig } from '@/lib/social/bonus';
import { progressUnit } from '@/lib/social/challengeProgress';
import type { SharedChallenge } from '@/lib/social/types';

/**
 * Maps a completed shared ("together") challenge onto the share screen's
 * challenge-card input — the same card solo weekly challenges use. Points are
 * the member's full breakdown (base + group bonus), matching the number the
 * completion celebration counts up to.
 *
 * `bonusConfig` is the global tuning, used only as a fallback — the challenge's
 * own snapshot wins, since that's what the server settled from. Without either,
 * the card brags a BONUS_DEFAULTS figure that may not be what was banked.
 */
export function buildSharedChallengeShareInput(
  challenge: SharedChallenge,
  bonusConfig?: Partial<BonusConfig>,
): ChallengeShareInput {
  const { template, participants, pool, goalTarget, goalRule } = challenge;
  const coCompleters = participants.filter((p) => !p.isSelf && p.completed).length;
  const { total } = earnedPoints(
    template.basePoints,
    coCompleters,
    challengeBonusConfig(challenge, bonusConfig),
  );

  const displayGoal = pool?.target ?? goalTarget ?? 1;
  const unit = pool?.unit ?? progressUnit(goalRule) ?? '';

  return {
    challengeTitle: template.title,
    challengeDescription: template.goal,
    // The card's middle stat label — brands the share as a group win.
    categoryLabel: 'Together',
    tier: template.tier,
    points: total,
    displayValue: displayGoal, // complete ⇒ value met the goal
    displayGoal,
    unit,
  };
}

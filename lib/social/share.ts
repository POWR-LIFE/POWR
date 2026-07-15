import type { ChallengeShareInput } from '@/lib/api/share';
import { earnedPoints } from '@/lib/social/bonus';
import { progressUnit } from '@/lib/social/challengeProgress';
import type { SharedChallenge } from '@/lib/social/types';

/**
 * Maps a completed shared ("together") challenge onto the share screen's
 * challenge-card input — the same card solo weekly challenges use. Points are
 * the member's full breakdown (base + group bonus), matching the number the
 * completion celebration counts up to.
 */
export function buildSharedChallengeShareInput(challenge: SharedChallenge): ChallengeShareInput {
  const { template, participants, pool, goalTarget, goalRule } = challenge;
  const coCompleters = participants.filter((p) => !p.isSelf && p.completed).length;
  const { total } = earnedPoints(template.basePoints, coCompleters);

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

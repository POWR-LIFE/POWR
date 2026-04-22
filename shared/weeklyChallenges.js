export const WEEKLY_CHALLENGES = [
  {
    id: 'early-bird',
    active: true,
    status: 'live',
    title: 'Early Bird',
    description: 'Gym or run before 12pm — triple points + 150 XP',
    bonusLabel: '3× BONUS',
    expiresIn: '4h 22m',
    imageUri:
      'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/sign/powr-challenge-cards/cycle-challenge-card.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9hYzcyYjdjNy02MmJkLTQyYzUtYWU4Zi1iNTYzOTU1YzE5YTIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJwb3dyLWNoYWxsZW5nZS1jYXJkcy9jeWNsZS1jaGFsbGVuZ2UtY2FyZC5qcGciLCJpYXQiOjE3NzY4NTA0ODQsImV4cCI6MTgwODM4NjQ4NH0.zs0FXaC2BjJybfEDV0fuxPGnUtboaXoeTRLjJuGKJEQ',
    imageOffsetY: 18,
    hint: 'Complete a morning session to earn',
    xpReward: 150,
    powrRewardText: '3× POWR',
    cadenceLabel: 'Rotates weekly',
    scheduleLabel: 'Before 12pm',
    audienceLabel: 'All members',
  },
];

const challengeDefaults = {
  active: false,
  status: 'draft',
  title: '',
  description: '',
  bonusLabel: '',
  expiresIn: '',
  imageUri: '',
  imageOffsetY: 0,
  hint: '',
  xpReward: 0,
  powrRewardText: '',
  cadenceLabel: 'Rotates weekly',
  scheduleLabel: '',
  audienceLabel: 'All members',
};

export function normalizeWeeklyChallenge(challenge, index = 0) {
  return {
    ...challengeDefaults,
    ...challenge,
    id: challenge?.id || `weekly-challenge-${index + 1}`,
    imageOffsetY: Number.isFinite(Number(challenge?.imageOffsetY)) ? Number(challenge.imageOffsetY) : 0,
    xpReward: Number.isFinite(Number(challenge?.xpReward)) ? Number(challenge.xpReward) : 0,
  };
}

export function normalizeWeeklyChallenges(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return WEEKLY_CHALLENGES.map(normalizeWeeklyChallenge);
  }

  const normalized = input.map(normalizeWeeklyChallenge);
  return normalized.some((challenge) => challenge.active)
    ? normalized
    : normalized.map((challenge, index) => ({ ...challenge, active: index === 0 }));
}

export function parseWeeklyChallengesConfig(value) {
  if (!value) return normalizeWeeklyChallenges(WEEKLY_CHALLENGES);

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return normalizeWeeklyChallenges(parsed);
  } catch {
    return normalizeWeeklyChallenges(WEEKLY_CHALLENGES);
  }
}

export function serializeWeeklyChallenges(challenges) {
  return JSON.stringify(normalizeWeeklyChallenges(challenges));
}

export function getActiveWeeklyChallenge(challenges) {
  const normalized = normalizeWeeklyChallenges(challenges);
  return normalized.find((challenge) => challenge.active) || normalized[0];
}

export const ACTIVE_WEEKLY_CHALLENGE = getActiveWeeklyChallenge(WEEKLY_CHALLENGES);
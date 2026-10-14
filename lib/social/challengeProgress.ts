import i18n, { getFormatLocale } from '@/lib/i18n';

import type { ChallengeGoalRule } from './types';

// Keys, resolved at call time so the unit follows the language on screen.
const categoryNoun: Record<string, string> = {
  gym: 'social:units.checkIns',
  running: 'social:units.runs',
  cycling: 'social:units.rides',
};

const qualifyingNoun: Record<string, string> = {
  gym: 'social:units.qualifyingCheckIns',
  running: 'social:units.qualifyingRuns',
  cycling: 'social:units.qualifyingRides',
};

function stepWindowKey(window?: ChallengeGoalRule['window']): string {
  switch (window) {
    case 'morning': return 'social:milestone.morning';
    case 'midday': return 'social:milestone.midday';
    case 'evening': return 'social:milestone.evening';
    default: return 'social:milestone.anyTime';
  }
}

/** The unit a goal is counted in, plural unless `count` is 1. */
export function progressUnit(rule?: ChallengeGoalRule, count = 2): string | undefined {
  if (!rule) return undefined;
  const unit = (key: string) => i18n.t(key, { count });

  switch (rule.kind) {
    case 'daily_metric_days':
    case 'step_window':
    case 'distinct_days':
    case 'spaced_days':
    case 'same_day_count':
      return unit('social:units.qualifyingDays');
    case 'weekly_sum':
    case 'weekend_sum':
      return rule.metric === 'distance_m' ? 'km' : unit('social:units.steps');
    case 'session_count':
      return unit(categoryNoun[rule.category ?? ''] ?? 'social:units.sessions');
    case 'count_with_min_metric':
      return unit(qualifyingNoun[rule.category ?? ''] ?? 'social:units.qualifyingSessions');
    case 'count_and_sum':
      return unit(categoryNoun[rule.category ?? ''] ?? 'social:units.sessions');
    case 'distinct_categories':
      return unit('social:units.activityTypes');
    case 'same_day_combo':
      return unit('social:units.activityCombos');
    default:
      return undefined;
  }
}

export function dailyMilestoneHint(rule: ChallengeGoalRule | undefined, target: number | undefined): string | null {
  if (!rule || !target || !rule.threshold || (rule.kind !== 'daily_metric_days' && rule.kind !== 'step_window')) {
    return null;
  }

  const steps = Math.round(rule.threshold).toLocaleString(getFormatLocale());
  return i18n.t(stepWindowKey(rule.window), { steps, count: target });
}
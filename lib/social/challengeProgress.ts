import type { ChallengeGoalRule } from './types';

const categoryNoun: Record<string, string> = {
  gym: 'check-in',
  running: 'run',
  cycling: 'ride',
};

function pluralize(noun: string, count = 2): string {
  return count === 1 ? noun : `${noun}s`;
}

function stepWindowLabel(window?: ChallengeGoalRule['window']): string {
  switch (window) {
    case 'morning': return ' before 9am';
    case 'midday': return ' between 12pm and 2pm';
    case 'evening': return ' after 6pm';
    default: return '';
  }
}

export function progressUnit(rule?: ChallengeGoalRule): string | undefined {
  if (!rule) return undefined;

  switch (rule.kind) {
    case 'daily_metric_days':
    case 'step_window':
    case 'distinct_days':
    case 'spaced_days':
    case 'same_day_count':
      return 'qualifying days';
    case 'weekly_sum':
    case 'weekend_sum':
      return rule.metric === 'distance_m' ? 'km' : 'steps';
    case 'session_count':
      return pluralize(categoryNoun[rule.category ?? ''] ?? 'session');
    case 'count_with_min_metric':
      return `qualifying ${pluralize(categoryNoun[rule.category ?? ''] ?? 'session')}`;
    case 'count_and_sum':
      return pluralize(categoryNoun[rule.category ?? ''] ?? 'session');
    case 'distinct_categories':
      return 'activity types';
    case 'same_day_combo':
      return 'activity combos';
    default:
      return undefined;
  }
}

export function dailyMilestoneHint(rule: ChallengeGoalRule | undefined, target: number | undefined): string | null {
  if (!rule || !target || !rule.threshold || (rule.kind !== 'daily_metric_days' && rule.kind !== 'step_window')) {
    return null;
  }

  const steps = Math.round(rule.threshold).toLocaleString('en-US');
  return `Hit ${steps} steps${stepWindowLabel(rule.window)} on ${target} ${target === 1 ? 'day' : 'days'}.`;
}
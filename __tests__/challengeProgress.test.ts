import { dailyMilestoneHint, progressUnit } from '@/lib/social/challengeProgress';

describe('shared challenge remaining-work copy', () => {
  it('labels repeated step goals as qualifying days, not steps', () => {
    const rule = { kind: 'daily_metric_days', threshold: 10000 };

    expect(progressUnit(rule)).toBe('qualifying days');
    expect(dailyMilestoneHint(rule, 4)).toBe('Hit 10,000 steps on 4 days.');
  });

  it('keeps time-window step goals specific about their qualifying window', () => {
    const rule = { kind: 'step_window', threshold: 3000, window: 'morning' as const };

    expect(progressUnit(rule)).toBe('qualifying days');
    expect(dailyMilestoneHint(rule, 3)).toBe('Hit 3,000 steps before 9am on 3 days.');
  });

  it.each([
    [{ kind: 'weekly_sum', metric: 'steps' }, 'steps'],
    [{ kind: 'weekly_sum', metric: 'distance_m' }, 'km'],
    [{ kind: 'weekend_sum', metric: 'steps' }, 'steps'],
    [{ kind: 'session_count', category: 'gym' }, 'check-ins'],
    [{ kind: 'session_count', category: 'running' }, 'runs'],
    [{ kind: 'distinct_days' }, 'qualifying days'],
    [{ kind: 'count_with_min_metric', category: 'cycling' }, 'qualifying rides'],
    [{ kind: 'count_and_sum', category: 'running' }, 'runs'],
    [{ kind: 'distinct_categories' }, 'activity types'],
    [{ kind: 'same_day_combo' }, 'activity combos'],
    [{ kind: 'spaced_days' }, 'qualifying days'],
    [{ kind: 'same_day_count' }, 'qualifying days'],
  ] as const)('uses an accurate unit for %o', (rule, expectedUnit) => {
    expect(progressUnit(rule)).toBe(expectedUnit);
  });
});
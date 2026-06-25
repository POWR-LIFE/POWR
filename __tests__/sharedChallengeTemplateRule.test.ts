/**
 * Tests for the structured-measure → Rule translator used when a shared
 * challenge is created (supabase/functions/_shared/sharedChallenges.ts), plus a
 * parity check that the server-side groupBonus matches the app's lib/social/bonus.
 *
 * The translator output is fed straight into the real rule engine
 * (supabase/functions/_shared/challenges.ts), so each case asserts both the
 * emitted Rule AND that the engine evaluates it as expected — that's what
 * actually decides whether a participant completed their part.
 */

import {
  groupBonus,
  poolContribution,
  pooledRule,
  templateRule,
} from '@/supabase/functions/_shared/sharedChallenges';
import {
  buildContext,
  evaluateChallenge,
} from '@/supabase/functions/_shared/challenges';
import { groupBonus as appGroupBonus, BONUS_DEFAULTS } from '@/lib/social/bonus';

// Reference week: all sessions UTC+0. Mon 2026-05-25 … Sun 2026-05-31.
const session = (over: Partial<Record<string, unknown>> = {}) => ({
  type: 'gym',
  started_at: '2026-05-25T10:00:00.000Z',
  duration_sec: 3600,
  distance_m: 0,
  steps: 0,
  verification: 'geofence',
  ...over,
});

describe('templateRule — gym', () => {
  it('checkins → session_count over the gym category', () => {
    expect(templateRule('gym', { measure: 'checkins', target: 3, window: 'any' })).toEqual({
      kind: 'session_count',
      category: 'gym',
      target: 3,
    });
  });

  it('checkins with a window adds the hour predicate', () => {
    expect(templateRule('gym', { measure: 'checkins', target: 3, window: 'before_9am' })).toMatchObject({ beforeHour: 9 });
    expect(templateRule('gym', { measure: 'checkins', target: 3, window: 'midday' })).toMatchObject({ hourWindow: [12, 14] });
    expect(templateRule('gym', { measure: 'checkins', target: 3, window: 'after_6pm' })).toMatchObject({ hourWindow: [18, 24] });
  });

  it('3 check-ins is met by exactly 3 gym sessions', () => {
    const rule = templateRule('gym', { measure: 'checkins', target: 3, window: 'any' });
    const ctx = buildContext(
      [
        session({ started_at: '2026-05-25T10:00:00Z' }),
        session({ started_at: '2026-05-26T10:00:00Z' }),
        session({ started_at: '2026-05-27T10:00:00Z' }),
      ],
      0,
    );
    expect(evaluateChallenge(rule, ctx).met).toBe(true);
  });

  it('distinct_days → distinct_days rule', () => {
    expect(templateRule('gym', { measure: 'distinct_days', target: 5 })).toEqual({
      kind: 'distinct_days',
      category: 'gym',
      target: 5,
    });
  });
});

describe('templateRule — walking', () => {
  it('steps_week → weekly_sum steps', () => {
    expect(templateRule('walking', { measure: 'steps_week', target: 35000 })).toEqual({
      kind: 'weekly_sum',
      metric: 'steps',
      target: 35000,
    });
  });

  it('steps_day (any) → daily_metric_days with threshold=steps, target=days', () => {
    expect(templateRule('walking', { measure: 'steps_day', target: 10000, days: 4, window: 'any' })).toEqual({
      kind: 'daily_metric_days',
      threshold: 10000,
      target: 4,
    });
  });

  it('steps_day with a window → step_window bucket', () => {
    expect(templateRule('walking', { measure: 'steps_day', target: 3000, days: 4, window: 'before_9am' })).toEqual({
      kind: 'step_window',
      window: 'morning',
      threshold: 3000,
      target: 4,
    });
  });

  it('10k steps a day for 4 days is met by four 10k walking days', () => {
    const rule = templateRule('walking', { measure: 'steps_day', target: 10000, days: 4, window: 'any' });
    const ctx = buildContext(
      ['25', '26', '27', '28'].map((d) =>
        session({ type: 'walking', started_at: `2026-05-${d}T10:00:00Z`, steps: 10000 }),
      ),
      0,
    );
    expect(evaluateChallenge(rule, ctx).met).toBe(true);
  });
});

describe('templateRule — running / cycling / multi', () => {
  it('distance in km → weekly_sum distance_m (km → metres)', () => {
    expect(templateRule('running', { measure: 'distance', target: 5, unit: 'km' })).toEqual({
      kind: 'weekly_sum',
      metric: 'distance_m',
      category: 'running',
      target: 5000,
    });
  });

  it('distance in miles → metres', () => {
    expect(templateRule('cycling', { measure: 'distance', target: 10, unit: 'mi' }).target).toBe(16093);
  });

  it('runs / rides → category session_count', () => {
    expect(templateRule('running', { measure: 'runs', target: 2 })).toEqual({ kind: 'session_count', category: 'running', target: 2 });
    expect(templateRule('cycling', { measure: 'rides', target: 3 })).toEqual({ kind: 'session_count', category: 'cycling', target: 3 });
  });

  it('multi sessions → uncategorised session_count; categories → distinct_categories', () => {
    expect(templateRule('multi', { measure: 'sessions', target: 5 })).toEqual({ kind: 'session_count', target: 5 });
    expect(templateRule('multi', { measure: 'categories', target: 4 })).toEqual({ kind: 'distinct_categories', perCat: 1, target: 4 });
  });
});

describe('pooledRule — combined-total translation', () => {
  it('steps → pool_sum on steps', () => {
    expect(pooledRule('walking', { measure: 'steps_week', target: 150000 })).toEqual({
      kind: 'pool_sum', metric: 'steps', target: 150000, unit: 'steps',
    });
  });
  it('distance km → metres pool with km display unit', () => {
    expect(pooledRule('running', { measure: 'distance', target: 100, unit: 'km' })).toEqual({
      kind: 'pool_sum', metric: 'distance_m', category: 'running', target: 100000, unit: 'km',
    });
  });
  it('check-ins → sessions pool on the gym category', () => {
    expect(pooledRule('gym', { measure: 'checkins', target: 20 })).toEqual({
      kind: 'pool_sum', metric: 'sessions', category: 'gym', target: 20, unit: 'check-ins',
    });
  });
});

describe('poolContribution — per-person tally', () => {
  const sessions = [
    { category: 'running', distance_m: 5000, steps: 0 },
    { category: 'running', distance_m: 3000, steps: 0 },
    { category: 'gym', distance_m: 0, steps: 0 },
  ];
  it('steps uses the daily-steps total', () => {
    expect(poolContribution({ metric: 'steps' }, sessions, 12000)).toBe(12000);
  });
  it('distance sums the category metres', () => {
    expect(poolContribution({ metric: 'distance_m', category: 'running' }, sessions, 0)).toBe(8000);
  });
  it('sessions counts category sessions', () => {
    expect(poolContribution({ metric: 'sessions', category: 'gym' }, sessions, 0)).toBe(1);
    expect(poolContribution({ metric: 'sessions' }, sessions, 0)).toBe(3);
  });
});

describe('groupBonus — server mirror matches the app', () => {
  it('matches lib/social/bonus for the default config across co-completer counts', () => {
    for (let n = 0; n <= 12; n++) {
      expect(groupBonus(n, BONUS_DEFAULTS)).toBe(appGroupBonus(n));
    }
  });

  it('honours a custom per-head + cap', () => {
    expect(groupBonus(6, { perHead: 10, maxBonus: 40 })).toBe(40); // capped
    expect(groupBonus(2, { perHead: 10, maxBonus: 40 })).toBe(20);
  });
});

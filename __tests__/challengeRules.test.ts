/**
 * Tests for the weekly challenge rule engine (shared/challengeRules.js) and
 * catalog/rotation helpers (shared/weeklyChallenges.js).
 *
 * All tests use UTC+0 offset. The reference week is 2026-05-25 (Mon) → 2026-05-31 (Sun).
 * Day-of-week mapping (Mon=0 … Sun=6):
 *   Mon 2026-05-25 dow=0, Tue 05-26 dow=1, Wed 05-27 dow=2, Thu 05-28 dow=3,
 *   Fri 05-29 dow=4, Sat 05-30 dow=5, Sun 05-31 dow=6
 */

// challengeRules.js is CommonJS — require for reliable interop.
/* eslint-disable @typescript-eslint/no-var-requires */
const {
  buildContext,
  evaluateChallenge,
} = require('@/shared/challengeRules');

import {
  computeExpiresIn,
  getActiveChallengesForWeek,
  getISOWeek,
  weekNumber,
  CATALOG,
  parseChallengeCatalog,
} from '@/shared/weeklyChallenges';

// ── Helpers ──────────────────────────────────────────────────────────────────

const UTC = 0;

/** Build a raw activity_session row. date is YYYY-MM-DD, hour is 0-23 UTC. */
function rawSession(
  type: string,
  date: string,
  hour = 10,
  extra: Record<string, unknown> = {},
) {
  return {
    type,
    started_at: `${date}T${String(hour).padStart(2, '0')}:00:00Z`,
    duration_sec: 3600,
    distance_m: 0,
    steps: 0,
    verification: 'automatic',
    ...extra,
  };
}

/** Build a normalized context directly from session shorthand. */
function ctx(sessions: ReturnType<typeof rawSession>[], windows: any[] = []) {
  return buildContext(sessions, UTC, windows);
}

// ── buildContext ──────────────────────────────────────────────────────────────

describe('buildContext', () => {
  it('includes automatic gym sessions', () => {
    const c = ctx([rawSession('gym', '2026-05-25')]);
    expect(c.sessions).toHaveLength(1);
    expect(c.sessions[0].category).toBe('gym');
    expect(c.sessions[0].dow).toBe(0); // Monday
    expect(c.sessions[0].hour).toBe(10);
  });

  it('excludes manual sessions', () => {
    const c = ctx([rawSession('gym', '2026-05-25', 10, { verification: 'manual' })]);
    expect(c.sessions).toHaveLength(0);
  });

  it('excludes sleep sessions', () => {
    const c = ctx([rawSession('sleep', '2026-05-25')]);
    expect(c.sessions).toHaveLength(0);
  });

  it('accumulates walking steps into dailySteps', () => {
    const sessions = [
      rawSession('walking', '2026-05-25', 10, { steps: 4000 }),
      rawSession('walking', '2026-05-25', 15, { steps: 3000 }),
    ];
    const c = ctx(sessions);
    const day = c.dailySteps.get('2026-05-25');
    expect(day?.steps).toBe(7000);
  });

  it('does not add non-walking steps to dailySteps', () => {
    const c = ctx([rawSession('running', '2026-05-25', 10, { steps: 5000 })]);
    expect(c.dailySteps.size).toBe(0);
  });

  it('maps session types to categories', () => {
    const sessions = [
      rawSession('gym', '2026-05-25'),
      rawSession('running', '2026-05-26'),
      rawSession('cycling', '2026-05-27'),
      rawSession('walking', '2026-05-28'),
    ];
    const c = ctx(sessions);
    const cats = c.sessions.map((s: any) => s.category);
    expect(cats).toEqual(['gym', 'running', 'cycling', 'walking']);
  });

  it('populates stepWindows from rows', () => {
    const windows = [{ date: '2026-05-25', before_9am: 1500, midday_12_14: 2200, after_6pm: 3100 }];
    const c = ctx([], windows);
    const w = c.stepWindows.get('2026-05-25');
    expect(w).toEqual({ morning: 1500, midday: 2200, evening: 3100 });
  });
});

// ── evaluateChallenge ─────────────────────────────────────────────────────────

describe('evaluateChallenge', () => {
  describe('session_count', () => {
    const rule = { kind: 'session_count', category: 'gym', target: 3 };

    it('counts matching sessions', () => {
      const c = ctx([
        rawSession('gym', '2026-05-25'),
        rawSession('gym', '2026-05-26'),
        rawSession('gym', '2026-05-27'),
      ]);
      expect(evaluateChallenge(rule, c)).toEqual({ progress: 3, target: 3, met: true });
    });

    it('is not met when below target', () => {
      const c = ctx([rawSession('gym', '2026-05-25')]);
      const r = evaluateChallenge(rule, c);
      expect(r.met).toBe(false);
      expect(r.progress).toBe(1);
    });

    it('ignores other categories', () => {
      const c = ctx([
        rawSession('running', '2026-05-25'),
        rawSession('running', '2026-05-26'),
        rawSession('running', '2026-05-27'),
      ]);
      expect(evaluateChallenge(rule, c).progress).toBe(0);
    });

    it('filters by dayOfWeek', () => {
      // MON=0, TUE=1, WED=2
      const weekdayRule = { kind: 'session_count', category: 'gym', dayOfWeek: [0, 1, 2], target: 1 };
      const c = ctx([
        rawSession('gym', '2026-05-25'), // Monday dow=0 ✓
        rawSession('gym', '2026-05-30'), // Saturday dow=5 ✗
      ]);
      expect(evaluateChallenge(weekdayRule, c).progress).toBe(1);
    });

    it('filters by beforeHour', () => {
      const earlyRule = { kind: 'session_count', category: 'gym', beforeHour: 8, target: 2 };
      const c = ctx([
        rawSession('gym', '2026-05-25', 7),  // 7am ✓
        rawSession('gym', '2026-05-26', 8),  // 8am ✗ (not strictly before)
        rawSession('gym', '2026-05-27', 6),  // 6am ✓
      ]);
      expect(evaluateChallenge(earlyRule, c)).toEqual({ progress: 2, target: 2, met: true });
    });

    it('filters by hourWindow', () => {
      const lunchRule = { kind: 'session_count', category: 'gym', hourWindow: [12, 14], target: 2 };
      const c = ctx([
        rawSession('gym', '2026-05-25', 12), // noon ✓
        rawSession('gym', '2026-05-26', 13), // 1pm ✓
        rawSession('gym', '2026-05-27', 14), // 2pm ✗ (not < 14)
        rawSession('gym', '2026-05-28', 11), // 11am ✗
      ]);
      expect(evaluateChallenge(lunchRule, c)).toEqual({ progress: 2, target: 2, met: true });
    });

    it('counts all categories when no category filter', () => {
      const anyRule = { kind: 'session_count', target: 10 };
      const sessions = [
        rawSession('gym', '2026-05-25'),
        rawSession('running', '2026-05-26'),
        rawSession('cycling', '2026-05-27'),
      ];
      expect(evaluateChallenge(anyRule, ctx(sessions)).progress).toBe(3);
    });
  });

  describe('distinct_days', () => {
    it('counts unique days for a category', () => {
      const rule = { kind: 'distinct_days', category: 'gym', target: 3 };
      const c = ctx([
        rawSession('gym', '2026-05-25'),
        rawSession('gym', '2026-05-25'), // same day — should not double-count
        rawSession('gym', '2026-05-26'),
        rawSession('gym', '2026-05-27'),
      ]);
      expect(evaluateChallenge(rule, c)).toEqual({ progress: 3, target: 3, met: true });
    });

    it('counts unique days across all categories when no filter', () => {
      const rule = { kind: 'distinct_days', target: 5 };
      const c = ctx([
        rawSession('gym', '2026-05-25'),
        rawSession('running', '2026-05-25'), // same day — still 1
        rawSession('cycling', '2026-05-26'),
        rawSession('walking', '2026-05-27'),
      ]);
      expect(evaluateChallenge(rule, c).progress).toBe(3);
    });
  });

  describe('daily_metric_days', () => {
    const rule = { kind: 'daily_metric_days', threshold: 7000, target: 3 };

    it('counts days where steps meet threshold', () => {
      const sessions = [
        rawSession('walking', '2026-05-25', 10, { steps: 7000 }),
        rawSession('walking', '2026-05-26', 10, { steps: 8000 }),
        rawSession('walking', '2026-05-27', 10, { steps: 7000 }),
      ];
      expect(evaluateChallenge(rule, ctx(sessions))).toEqual({ progress: 3, target: 3, met: true });
    });

    it('excludes days below threshold', () => {
      const sessions = [
        rawSession('walking', '2026-05-25', 10, { steps: 6999 }),
        rawSession('walking', '2026-05-26', 10, { steps: 7000 }),
      ];
      expect(evaluateChallenge(rule, ctx(sessions)).progress).toBe(1);
    });

    it('accumulates splits across multiple walking sessions in one day', () => {
      const sessions = [
        rawSession('walking', '2026-05-25', 9,  { steps: 4000 }),
        rawSession('walking', '2026-05-25', 17, { steps: 4000 }),
      ];
      // combined = 8000 >= 7000
      expect(evaluateChallenge(rule, ctx(sessions)).progress).toBe(1);
    });
  });

  describe('weekly_sum', () => {
    it('sums steps across the week', () => {
      const rule = { kind: 'weekly_sum', metric: 'steps', target: 35000 };
      const sessions = [
        rawSession('walking', '2026-05-25', 10, { steps: 10000 }),
        rawSession('walking', '2026-05-26', 10, { steps: 10000 }),
        rawSession('walking', '2026-05-27', 10, { steps: 15000 }),
      ];
      expect(evaluateChallenge(rule, ctx(sessions))).toEqual({ progress: 35000, target: 35000, met: true });
    });

    it('sums distance for a specific category', () => {
      const rule = { kind: 'weekly_sum', metric: 'distance_m', category: 'running', target: 10000 };
      const sessions = [
        rawSession('running', '2026-05-25', 10, { distance_m: 5000 }),
        rawSession('running', '2026-05-26', 10, { distance_m: 5000 }),
        rawSession('cycling', '2026-05-27', 10, { distance_m: 20000 }), // should not count
      ];
      expect(evaluateChallenge(rule, ctx(sessions))).toEqual({ progress: 10000, target: 10000, met: true });
    });
  });

  describe('weekend_sum', () => {
    const rule = { kind: 'weekend_sum', metric: 'steps', target: 30000 };

    it('only sums weekend steps (Sat=5, Sun=6)', () => {
      const sessions = [
        rawSession('walking', '2026-05-25', 10, { steps: 20000 }), // Mon ✗
        rawSession('walking', '2026-05-30', 10, { steps: 15000 }), // Sat ✓
        rawSession('walking', '2026-05-31', 10, { steps: 16000 }), // Sun ✓
      ];
      expect(evaluateChallenge(rule, ctx(sessions))).toEqual({ progress: 31000, target: 30000, met: true });
    });

    it('is not met when only weekday steps logged', () => {
      const sessions = [
        rawSession('walking', '2026-05-25', 10, { steps: 50000 }), // Mon only
      ];
      expect(evaluateChallenge(rule, ctx(sessions)).met).toBe(false);
    });
  });

  describe('count_with_min_metric', () => {
    const rule = { kind: 'count_with_min_metric', category: 'running', metric: 'distance_m', threshold: 5000, target: 2 };

    it('counts runs that meet minimum distance', () => {
      const sessions = [
        rawSession('running', '2026-05-25', 10, { distance_m: 5000 }),
        rawSession('running', '2026-05-26', 10, { distance_m: 6000 }),
        rawSession('running', '2026-05-27', 10, { distance_m: 4999 }), // below threshold
      ];
      expect(evaluateChallenge(rule, ctx(sessions))).toEqual({ progress: 2, target: 2, met: true });
    });

    it('is not met when no run meets the distance', () => {
      const sessions = [
        rawSession('running', '2026-05-25', 10, { distance_m: 3000 }),
        rawSession('running', '2026-05-26', 10, { distance_m: 4999 }),
      ];
      expect(evaluateChallenge(rule, ctx(sessions)).met).toBe(false);
    });
  });

  describe('count_and_sum', () => {
    const rule = { kind: 'count_and_sum', category: 'running', metric: 'distance_m', target: 3, min: 10000 };

    it('is met when both count and total distance are satisfied', () => {
      const sessions = [
        rawSession('running', '2026-05-25', 10, { distance_m: 4000 }),
        rawSession('running', '2026-05-26', 10, { distance_m: 3500 }),
        rawSession('running', '2026-05-27', 10, { distance_m: 3000 }),
      ];
      // count=3 ✓, sum=10500 >= 10000 ✓
      expect(evaluateChallenge(rule, ctx(sessions))).toMatchObject({ met: true, progress: 3 });
    });

    it('is not met when count is reached but total distance is short', () => {
      const sessions = [
        rawSession('running', '2026-05-25', 10, { distance_m: 2000 }),
        rawSession('running', '2026-05-26', 10, { distance_m: 2000 }),
        rawSession('running', '2026-05-27', 10, { distance_m: 2000 }),
      ];
      // count=3 ✓ but sum=6000 < 10000 ✗
      expect(evaluateChallenge(rule, ctx(sessions)).met).toBe(false);
    });
  });

  describe('distinct_categories', () => {
    it('counts categories that have at least perCat sessions', () => {
      const rule = { kind: 'distinct_categories', perCat: 2, target: 3 };
      const sessions = [
        rawSession('gym', '2026-05-25'),
        rawSession('gym', '2026-05-26'),     // gym: 2 ✓
        rawSession('running', '2026-05-25'),
        rawSession('running', '2026-05-26'), // running: 2 ✓
        rawSession('cycling', '2026-05-25'), // cycling: 1 ✗ (needs 2)
        rawSession('walking', '2026-05-25'),
        rawSession('walking', '2026-05-26'), // walking: 2 ✓
      ];
      expect(evaluateChallenge(rule, ctx(sessions))).toEqual({ progress: 3, target: 3, met: true });
    });

    it('counts categories where perCat=1', () => {
      const rule = { kind: 'distinct_categories', perCat: 1, target: 2 };
      const sessions = [
        rawSession('gym', '2026-05-25'),
        rawSession('running', '2026-05-26'),
      ];
      expect(evaluateChallenge(rule, ctx(sessions))).toEqual({ progress: 2, target: 2, met: true });
    });
  });

  describe('same_day_combo', () => {
    const rule = { kind: 'same_day_combo', a: 'gym', b: ['walking', 'running'], target: 1 };

    it('counts days where gym + walk/run both occur', () => {
      const sessions = [
        rawSession('gym', '2026-05-25'),
        rawSession('walking', '2026-05-25'),
      ];
      expect(evaluateChallenge(rule, ctx(sessions))).toEqual({ progress: 1, target: 1, met: true });
    });

    it('does not count days where only one side is present', () => {
      const sessions = [
        rawSession('gym', '2026-05-25'),
        rawSession('walking', '2026-05-26'), // different day
      ];
      expect(evaluateChallenge(rule, ctx(sessions)).progress).toBe(0);
    });

    it('counts multiple qualifying days', () => {
      const doubleRule = { kind: 'same_day_combo', a: 'gym', b: ['running'], target: 2 };
      const sessions = [
        rawSession('gym', '2026-05-25'),
        rawSession('running', '2026-05-25'),
        rawSession('gym', '2026-05-26'),
        rawSession('running', '2026-05-26'),
      ];
      expect(evaluateChallenge(doubleRule, ctx(sessions))).toEqual({ progress: 2, target: 2, met: true });
    });
  });

  describe('spaced_days', () => {
    const rule = { kind: 'spaced_days', category: 'running', minGapDays: 1, target: 3 };

    it('counts runs where there is at least 1 rest day between each', () => {
      // Mon, Wed, Fri — gap of 2 days each ✓
      const sessions = [
        rawSession('running', '2026-05-25'), // Mon
        rawSession('running', '2026-05-27'), // Wed (gap=2) ✓
        rawSession('running', '2026-05-29'), // Fri (gap=2) ✓
      ];
      expect(evaluateChallenge(rule, ctx(sessions))).toEqual({ progress: 3, target: 3, met: true });
    });

    it('skips days that are too close to the previous selected run', () => {
      // Mon→selected, Tue→gap=1 skipped, Wed→gap=2 ✓ selected, Thu→gap=1 skipped
      const sessions = [
        rawSession('running', '2026-05-25'), // Mon → count=1, prev=Mon
        rawSession('running', '2026-05-26'), // Tue → gap=1, not > 1, skipped
        rawSession('running', '2026-05-27'), // Wed → gap=2, selected (count=2, prev=Wed)
        rawSession('running', '2026-05-28'), // Thu → gap=1 from Wed, skipped
      ];
      expect(evaluateChallenge(rule, ctx(sessions)).progress).toBe(2);
    });
  });

  describe('step_window', () => {
    it('counts days where midday steps meet threshold', () => {
      const rule = { kind: 'step_window', window: 'midday', threshold: 2000, target: 3 };
      const windows = [
        { date: '2026-05-25', before_9am: 0, midday_12_14: 2500, after_6pm: 0 },
        { date: '2026-05-26', before_9am: 0, midday_12_14: 1999, after_6pm: 0 }, // below
        { date: '2026-05-27', before_9am: 0, midday_12_14: 2000, after_6pm: 0 },
        { date: '2026-05-28', before_9am: 0, midday_12_14: 3000, after_6pm: 0 },
      ];
      expect(evaluateChallenge(rule, ctx([], windows))).toEqual({ progress: 3, target: 3, met: true });
    });

    it('counts days where morning steps meet threshold', () => {
      const rule = { kind: 'step_window', window: 'morning', threshold: 3000, target: 1 };
      const windows = [
        { date: '2026-05-25', before_9am: 3000, midday_12_14: 0, after_6pm: 0 },
      ];
      expect(evaluateChallenge(rule, ctx([], windows))).toEqual({ progress: 1, target: 1, met: true });
    });

    it('counts days where evening steps meet threshold', () => {
      const rule = { kind: 'step_window', window: 'evening', threshold: 3000, target: 2 };
      const windows = [
        { date: '2026-05-25', before_9am: 0, midday_12_14: 0, after_6pm: 3000 },
        { date: '2026-05-26', before_9am: 0, midday_12_14: 0, after_6pm: 2999 }, // below
        { date: '2026-05-27', before_9am: 0, midday_12_14: 0, after_6pm: 5000 },
      ];
      expect(evaluateChallenge(rule, ctx([], windows))).toEqual({ progress: 2, target: 2, met: true });
    });
  });

  it('returns {progress:0, met:false} for unknown rule kinds', () => {
    const r = evaluateChallenge({ kind: 'unknown_future_rule', target: 1 }, ctx([]));
    expect(r).toEqual({ progress: 0, target: 1, met: false });
  });
});

// ── getActiveChallengesForWeek ────────────────────────────────────────────────

describe('getActiveChallengesForWeek', () => {
  it('returns exactly 5 challenges (one per category)', () => {
    const active = getActiveChallengesForWeek('2026-W22');
    expect(active).toHaveLength(5);
  });

  it('returns one challenge per category in order', () => {
    const active = getActiveChallengesForWeek('2026-W22');
    const cats = active.map((c: any) => c.category);
    expect(cats).toEqual(['gym', 'walking', 'running', 'cycling', 'multi']);
  });

  it('never selects a supported:false entry', () => {
    // gym-double-day has supported:false — should never appear
    for (let w = 1; w <= 53; w++) {
      const week = `2026-W${String(w).padStart(2, '0')}`;
      const active = getActiveChallengesForWeek(week);
      expect(active.find((c: any) => c.id === 'gym-double-day')).toBeUndefined();
    }
  });

  it('advances to a different challenge in the next week', () => {
    const w1 = getActiveChallengesForWeek('2026-W22').map((c: any) => c.id);
    const w2 = getActiveChallengesForWeek('2026-W23').map((c: any) => c.id);
    // At least one category should have rotated
    const changed = w1.filter((id: string, i: number) => id !== w2[i]).length;
    expect(changed).toBeGreaterThan(0);
  });

  it('is deterministic — same week always returns same challenges', () => {
    const a = getActiveChallengesForWeek('2026-W22').map((c: any) => c.id);
    const b = getActiveChallengesForWeek('2026-W22').map((c: any) => c.id);
    expect(a).toEqual(b);
  });

  it('uses a custom catalog when provided', () => {
    const miniCatalog = [
      { id: 'custom-gym',  category: 'gym',     tier: 'easy', title: 'Custom Gym',  description: '', points: 10, rule: { kind: 'session_count', category: 'gym', target: 1 } },
      { id: 'custom-walk', category: 'walking', tier: 'easy', title: 'Custom Walk', description: '', points: 10, rule: { kind: 'session_count', category: 'walking', target: 1 } },
      { id: 'custom-run',  category: 'running', tier: 'easy', title: 'Custom Run',  description: '', points: 10, rule: { kind: 'session_count', category: 'running', target: 1 } },
      { id: 'custom-cyc',  category: 'cycling', tier: 'easy', title: 'Custom Cyc',  description: '', points: 10, rule: { kind: 'session_count', category: 'cycling', target: 1 } },
      { id: 'custom-multi',category: 'multi',   tier: 'easy', title: 'Custom Multi', description: '', points: 10, rule: { kind: 'session_count', target: 1 } },
    ];
    const active = getActiveChallengesForWeek('2026-W22', miniCatalog);
    expect(active.map((c: any) => c.id)).toEqual(['custom-gym', 'custom-walk', 'custom-run', 'custom-cyc', 'custom-multi']);
  });
});

// ── parseChallengeCatalog ─────────────────────────────────────────────────────

describe('parseChallengeCatalog', () => {
  it('returns bundled catalog when value is null', () => {
    expect(parseChallengeCatalog(null)).toBe(CATALOG);
  });

  it('returns bundled catalog for invalid JSON', () => {
    expect(parseChallengeCatalog('not-json{')).toBe(CATALOG);
  });

  it('returns bundled catalog when parsed array is missing required fields', () => {
    expect(parseChallengeCatalog('[{"id":"x"}]')).toBe(CATALOG);
  });

  it('accepts a valid JSON catalog string', () => {
    const custom = [{ id: 'x', category: 'gym', rule: { kind: 'session_count', target: 1 } }];
    const result = parseChallengeCatalog(JSON.stringify(custom));
    expect(result).toEqual(custom);
  });

  it('accepts a pre-parsed array', () => {
    const custom = [{ id: 'x', category: 'gym', rule: { kind: 'session_count', target: 1 } }];
    expect(parseChallengeCatalog(custom)).toEqual(custom);
  });
});

// ── computeExpiresIn ─────────────────────────────────────────────────────────

describe('computeExpiresIn', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-29T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns empty string for null/undefined', () => {
    expect(computeExpiresIn(null)).toBe('');
    expect(computeExpiresIn(undefined)).toBe('');
    expect(computeExpiresIn('')).toBe('');
  });

  it('returns "Expired" for a past timestamp', () => {
    expect(computeExpiresIn('2026-05-28T00:00:00Z')).toBe('Expired');
  });

  it('formats days remaining', () => {
    // 2 days and 0 hours left
    const ts = new Date('2026-05-31T12:00:00Z').toISOString();
    expect(computeExpiresIn(ts)).toBe('2d left');
  });

  it('formats days + hours when hours are non-zero', () => {
    // 2 days and 6 hours left → 2026-05-31T18:00:00Z
    const ts = new Date('2026-05-31T18:00:00Z').toISOString();
    expect(computeExpiresIn(ts)).toBe('2d 6h left');
  });

  it('formats hours + minutes when less than a day', () => {
    // 3 hours and 30 minutes → 2026-05-29T15:30:00Z
    const ts = new Date('2026-05-29T15:30:00Z').toISOString();
    expect(computeExpiresIn(ts)).toBe('3h 30m left');
  });

  it('formats hours only when minutes are zero', () => {
    const ts = new Date('2026-05-29T15:00:00Z').toISOString();
    expect(computeExpiresIn(ts)).toBe('3h left');
  });

  it('formats minutes only when less than an hour', () => {
    const ts = new Date('2026-05-29T12:45:00Z').toISOString();
    expect(computeExpiresIn(ts)).toBe('45m left');
  });
});

// ── getISOWeek / weekNumber ───────────────────────────────────────────────────

describe('getISOWeek', () => {
  it('identifies the correct ISO week for known dates', () => {
    expect(getISOWeek(new Date('2026-05-25'))).toBe('2026-W22');
    expect(getISOWeek(new Date('2026-01-01'))).toBe('2026-W01');
  });
});

describe('weekNumber', () => {
  it('is monotonically increasing week over week', () => {
    const w22 = weekNumber('2026-W22');
    const w23 = weekNumber('2026-W23');
    expect(w23).toBeGreaterThan(w22);
  });

  it('returns 0 for invalid input', () => {
    expect(weekNumber('')).toBe(0);
    expect(weekNumber(null as any)).toBe(0);
  });
});

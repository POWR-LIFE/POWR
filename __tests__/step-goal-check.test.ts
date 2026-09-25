// The walkers' evening "X steps to go" nudge. Built 2026-07-23 on
// expo-background-fetch alone, which never runs in the field, so nobody ever
// received one; from 2026-09-25 it rides the beacon wake and the app-background
// transition. These tests pin the gate as it must behave on that wake:
//
//   • no auth client — the reads go through lib/backgroundRest, and a SPENT
//     token (null auth) degrades the reads instead of muting the nudge
//   • the preference mirror is honoured when the server is unreachable
//   • one health read per 20 minutes, one nudge per local day

jest.mock('expo-background-fetch', () => ({
  registerTaskAsync: jest.fn(),
  BackgroundFetchResult: { NewData: 1, NoData: 2, Failed: 3 },
}));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/lib/taskFinishGuard', () => ({ defineTask: jest.fn() }));

// The real ladder, inlined: the module under test must not drag lib/api/activity's
// supabase client into a headless-path test.
jest.mock('@/lib/api/activity', () => ({
  WALKING_DAILY_CAP: 5,
  nextStepThreshold: (steps: number) =>
    steps >= 10000 ? null : steps >= 8000 ? 10000 : steps >= 6000 ? 8000 : steps >= 4000 ? 6000 : 4000,
  stepTierPoints: (steps: number) =>
    steps >= 10000 ? 5 : steps >= 8000 ? 4 : steps >= 6000 ? 3 : steps >= 4000 ? 2 : 0,
}));

const mockSteps = jest.fn<Promise<number>, []>();
jest.mock('@/lib/health/walkingSync', () => ({ getStepsToday: () => mockSteps() }));

const mockNotify = jest.fn<Promise<boolean>, [unknown]>();
jest.mock('@/lib/notifications', () => ({ notifyStepGoal: (o: unknown) => mockNotify(o) }));

const mockAuth = jest.fn<Promise<unknown>, []>();
const mockSelect = jest.fn<Promise<unknown>, [string, string, unknown]>();
jest.mock('@/lib/backgroundRest', () => ({
  readBackgroundAuth: () => mockAuth(),
  bgSelect: (t: string, q: string, a: unknown) => mockSelect(t, q, a),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  runStepGoalCheck,
  runStepGoalCheckFromWake,
  STEP_GOAL_CHECKED_AT_KEY,
  STEP_GOAL_FIRED_DAY_KEY,
} from '@/lib/stepGoalNotifyTask';
import { STEP_GOAL_PREF_CACHE_KEY } from '@/lib/stepGoalPrefCache';

const AUTH = { accessToken: 'jwt', userId: 'user-1' };

/** Fake only the clock — AsyncStorage's mock and the async plumbing keep real timers. */
function atLocal(hour: number, minute = 0) {
  jest.useFakeTimers({
    now: new Date(2026, 8, 25, hour, minute, 0),
    doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'nextTick', 'queueMicrotask'],
  });
}

/** Non-manual sessions at local noon on each of the given days-ago. */
function sessionsOnDaysAgo(daysAgo: number[]): { started_at: string }[] {
  return daysAgo.map(n => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(12, 0, 0, 0);
    return { started_at: d.toISOString() };
  });
}

function serverPrefs(
  enabled: boolean | null,
  banked: number[] = [],
  opts: { streakDaysAgo?: number[]; streakPref?: boolean; minStreak?: string } = {},
) {
  mockSelect.mockImplementation(async (table: string, query: string) => {
    if (table === 'notification_preferences') {
      return {
        data: enabled === null ? [] : [{ step_goal_nudge: enabled, streak_at_risk: opts.streakPref ?? true }],
        error: null,
      };
    }
    if (table === 'system_config') {
      return { data: [{ value: opts.minStreak ?? '3' }], error: null };
    }
    if (table === 'activity_sessions' && query.includes('type=eq.walking')) {
      return {
        data: banked.length
          ? [{ point_transactions: banked.map(amount => ({ amount, type: 'earn' })) }]
          : [],
        error: null,
      };
    }
    if (table === 'activity_sessions' && query.includes('verification=neq.manual')) {
      return { data: sessionsOnDaysAgo(opts.streakDaysAgo ?? []), error: null };
    }
    return { data: null, error: { message: `unexpected query ${table}?${query}` } };
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockNotify.mockResolvedValue(true);
  mockAuth.mockResolvedValue(AUTH);
  serverPrefs(true);
  atLocal(18, 30);
});

afterEach(() => { jest.useRealTimers(); });

describe('runStepGoalCheck — the walkers\' evening nudge', () => {
  it('fires with the server-exact promise when the token is live', async () => {
    mockSteps.mockResolvedValue(5000);
    serverPrefs(true, []);           // nothing banked yet today

    await expect(runStepGoalCheck()).resolves.toBe(true);

    expect(mockNotify).toHaveBeenCalledWith({ stepsToNext: 1000, bonusPoints: 3 });
    expect(await AsyncStorage.getItem(STEP_GOAL_FIRED_DAY_KEY)).toBe('2026-09-25');
    // The mirror is refreshed from the server read.
    expect(await AsyncStorage.getItem(STEP_GOAL_PREF_CACHE_KEY)).toBe('1');
  });

  it('subtracts what today has already banked', async () => {
    mockSteps.mockResolvedValue(7100);
    serverPrefs(true, [2, 1]);       // 4k and 6k tiers already paid

    await runStepGoalCheck();

    expect(mockNotify).toHaveBeenCalledWith({ stepsToNext: 900, bonusPoints: 1 });
  });

  // THE GATE THAT MUTED EVERY POCKETED PHONE. A spent token used to end the
  // check; on a wake it is spent most evenings.
  it('still fires on a spent token — mirror for the pref, ladder for the promise', async () => {
    mockAuth.mockResolvedValue(null);
    mockSteps.mockResolvedValue(5000);

    await expect(runStepGoalCheck()).resolves.toBe(true);

    expect(mockSelect).not.toHaveBeenCalled();
    // tier(6000) − tier(5000) = 3 − 2: the least the next tier can pay.
    expect(mockNotify).toHaveBeenCalledWith({ stepsToNext: 1000, bonusPoints: 1 });
  });

  it('honours an OFF toggle from the mirror when the server is out of reach', async () => {
    mockAuth.mockResolvedValue(null);
    await AsyncStorage.setItem(STEP_GOAL_PREF_CACHE_KEY, '0');
    mockSteps.mockResolvedValue(5000);

    await expect(runStepGoalCheck()).resolves.toBe(false);

    expect(mockSteps).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('honours an OFF toggle from the server and writes it to the mirror', async () => {
    serverPrefs(false);
    mockSteps.mockResolvedValue(5000);

    await expect(runStepGoalCheck()).resolves.toBe(false);

    expect(mockNotify).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(STEP_GOAL_PREF_CACHE_KEY)).toBe('0');
  });

  it('never CALLS the supabase client (loading the module is fine; entering its lock is not)', () => {
    // A static guarantee on this file's own reads: no direct supabase import
    // and none of the client-backed helpers. Transitive module LOADS remain —
    // lib/api/activity and lib/backgroundRest both import the client — and
    // that is acceptable: the headless entry loads it anyway, and the freeze
    // class is a getSession()/query CALL, which the reads above never make.
    const src = require('fs').readFileSync(require.resolve('@/lib/stepGoalNotifyTask'), 'utf8');
    expect(src).not.toMatch(/from '@\/lib\/supabase'/);
    expect(src).not.toMatch(/getNotificationPreferences|fetchTodayWalkingPoints|getSessionUser|supabase\./);
  });

  // The server's nudge budget cannot see a local notification. When the phone
  // can see that tonight's streak_at_risk push will fire, it yields the slot.
  describe('yielding to tonight\'s streak_at_risk push', () => {
    it('defers when the user has a qualifying streak and nothing logged today', async () => {
      mockSteps.mockResolvedValue(5000);
      serverPrefs(true, [], { streakDaysAgo: [1, 2, 3] });

      await expect(runStepGoalCheck()).resolves.toBe(false);

      expect(mockNotify).not.toHaveBeenCalled();
      expect(await AsyncStorage.getItem(STEP_GOAL_FIRED_DAY_KEY)).toBeNull();
    });

    it('fires when something was already logged today (no streak push tonight)', async () => {
      mockSteps.mockResolvedValue(5000);
      serverPrefs(true, [], { streakDaysAgo: [0, 1, 2, 3] });
      await expect(runStepGoalCheck()).resolves.toBe(true);
    });

    it('fires when the streak is below the min-streak floor', async () => {
      mockSteps.mockResolvedValue(5000);
      serverPrefs(true, [], { streakDaysAgo: [1, 2] });
      await expect(runStepGoalCheck()).resolves.toBe(true);
    });

    it('honours the admin min-streak knob', async () => {
      mockSteps.mockResolvedValue(5000);
      serverPrefs(true, [], { streakDaysAgo: [1, 2], minStreak: '2' });
      await expect(runStepGoalCheck()).resolves.toBe(false);
    });

    it('fires when the user has the streak push switched off', async () => {
      mockSteps.mockResolvedValue(5000);
      serverPrefs(true, [], { streakDaysAgo: [1, 2, 3], streakPref: false });
      await expect(runStepGoalCheck()).resolves.toBe(true);
    });

    it('cannot decide on a spent token, so it fires', async () => {
      mockAuth.mockResolvedValue(null);
      mockSteps.mockResolvedValue(5000);
      await expect(runStepGoalCheck()).resolves.toBe(true);
    });
  });

  it('does nothing outside the 17:00–20:59 local window', async () => {
    atLocal(12, 0);
    mockSteps.mockResolvedValue(5000);

    await expect(runStepGoalCheck()).resolves.toBe(false);

    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockSteps).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(STEP_GOAL_CHECKED_AT_KEY)).toBeNull();
  });

  it('closes at 21:00', async () => {
    atLocal(21, 0);
    mockSteps.mockResolvedValue(5000);
    await expect(runStepGoalCheck()).resolves.toBe(false);
    expect(mockSteps).not.toHaveBeenCalled();
  });

  it('stays quiet below 2,000 steps and beyond the top tier', async () => {
    mockSteps.mockResolvedValueOnce(1900);
    await expect(runStepGoalCheck()).resolves.toBe(false);

    await AsyncStorage.removeItem(STEP_GOAL_CHECKED_AT_KEY);
    mockSteps.mockResolvedValueOnce(10200);
    await expect(runStepGoalCheck()).resolves.toBe(false);

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('stays quiet when today\'s walking points are already capped', async () => {
    mockSteps.mockResolvedValue(9000);
    serverPrefs(true, [5]);

    await expect(runStepGoalCheck()).resolves.toBe(false);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  // The wake lands every ~5-6 minutes; the health store is read at most every 20.
  it('reads the health store at most once per 20 minutes, stamping BEFORE the read', async () => {
    mockSteps.mockResolvedValue(1900);   // below the floor, so nothing fires

    await runStepGoalCheck();
    await runStepGoalCheck();
    await runStepGoalCheck();

    expect(mockSteps).toHaveBeenCalledTimes(1);
    const stamped = Number(await AsyncStorage.getItem(STEP_GOAL_CHECKED_AT_KEY));
    expect(Number.isFinite(stamped) && stamped > 0).toBe(true);
  });

  it('checks again once the 20 minutes have passed', async () => {
    mockSteps.mockResolvedValue(1900);
    await runStepGoalCheck();
    atLocal(18, 55);
    await runStepGoalCheck();
    expect(mockSteps).toHaveBeenCalledTimes(2);
  });

  it('fires once per local day, however many wakes follow', async () => {
    mockSteps.mockResolvedValue(5000);
    await expect(runStepGoalCheck()).resolves.toBe(true);

    atLocal(19, 30);                  // past the throttle
    await expect(runStepGoalCheck()).resolves.toBe(false);

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockSteps).toHaveBeenCalledTimes(1);
  });

  it('does not stamp the day when the presenter declined (budget spent elsewhere)', async () => {
    mockSteps.mockResolvedValue(5000);
    mockNotify.mockResolvedValue(false);

    await expect(runStepGoalCheck()).resolves.toBe(false);
    expect(await AsyncStorage.getItem(STEP_GOAL_FIRED_DAY_KEY)).toBeNull();
  });

  it('treats an unreadable health store as "not today"', async () => {
    mockSteps.mockRejectedValue(new Error('HealthKit denied'));
    await expect(runStepGoalCheck()).resolves.toBe(false);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('runStepGoalCheckFromWake', () => {
  it('never rejects, whatever fails underneath', async () => {
    mockAuth.mockRejectedValue(new Error('keystore hang'));
    await expect(runStepGoalCheckFromWake()).resolves.toBeUndefined();
  });
});

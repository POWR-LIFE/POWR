/**
 * A claim attempt that dies WITHOUT an outcome must never strand the session.
 *
 * Field capture 2026-07-14: sessionRecorded=true is persisted before claim-points
 * is invoked, RN's Android fetch has no timeout, and the invoke hung forever —
 * leaving {sessionRecorded, no sessionId, no pointsPending}, a state every later
 * tick and beacon wake silently skipped. The claim only resurfaced at EXIT, and a
 * session ending between the 30- and 40-min tiers would have earned nothing.
 *
 * These tests pin the two defenses:
 *   1. withNetworkTimeout — a hung claim-points call becomes outcome 'error',
 *      which queues the ordinary pointsPending retry.
 *   2. the claimAttemptAt lease — an orphaned attempt (stale lease, no outcome)
 *      is handed back to the retry path; a FRESH attempt is left alone so a
 *      concurrent tick can't double-claim.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { runVisitCheck, ACTIVE_GEOFENCE_KEY } from '@/context/GeofenceContext';

jest.mock('expo-task-manager', () => {
  const registry: Record<string, unknown> = {};
  return {
    __registry: registry,
    defineTask: jest.fn((name: string, fn: unknown) => { registry[name] = fn; }),
    isTaskRegisteredAsync: jest.fn().mockResolvedValue(true),
  };
});

jest.mock('expo-background-fetch', () => ({
  BackgroundFetchResult: { NewData: 'new-data', Failed: 'failed' },
  registerTaskAsync: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 2 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  hasStartedGeofencingAsync: jest.fn().mockResolvedValue(true),
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(true),
  startGeofencingAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopGeofencingAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));

jest.mock('@/lib/device', () => ({ getDeviceId: jest.fn().mockResolvedValue('device-1') }));

jest.mock('@/lib/gymDwellConfig', () => ({
  getGymDwellMinutes: () => 30,
  getGymUpgradeMinutes: () => 40,
  primeGymDwellMinutes: jest.fn().mockResolvedValue(30),
  refreshGymDwellMinutes: jest.fn().mockResolvedValue(30),
}));

jest.mock('@/lib/notifications', () => ({
  notifyCheckInAvailable: jest.fn().mockResolvedValue(undefined),
  notifySessionCompleted: jest.fn().mockResolvedValue(undefined),
  notifySessionUpgraded: jest.fn().mockResolvedValue(undefined),
  scheduleRewardWithinReach: jest.fn().mockResolvedValue(undefined),
}));

const mockRpc = jest.fn().mockResolvedValue({ data: null, error: null });
const mockInvoke = jest.fn().mockResolvedValue({
  data: { earned: 30, push_delivered: true, within_reach: null },
  error: null,
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-1', email: 'jamiemasonwright@gmail.com' }, access_token: 't' } },
        error: null,
      }),
    },
    rpc: (...a: any[]) => (mockRpc as jest.Mock)(...a),
    from: () => {
      const builder: any = {
        select: () => builder,
        insert: () => builder,
        update: () => builder,
        eq: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        single: async () => ({ data: { id: 'session-abc' }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: null, count: 0, error: null }).then(res, rej),
      };
      return builder;
    },
    functions: { invoke: (...a: any[]) => (mockInvoke as jest.Mock)(...a) },
  },
}));

const GYM = { lat: 51.5, lng: -0.12, radius: 25 };
const getFix = Location.getCurrentPositionAsync as jest.Mock;

/** A visit past the 30-min threshold, in the given claim state. */
async function seedVisit(extra: Record<string, unknown> = {}) {
  await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
    partnerId: 'partner-1',
    partnerName: 'Xtreme Gym',
    regionId: 'partner-1-0',
    visitId: 'visit-1',
    entryTimestamp: Date.now() - 35 * 60 * 1000,
    latitude: GYM.lat,
    longitude: GYM.lng,
    radius: GYM.radius,
    ...extra,
  }));
}

const readState = async () => JSON.parse((await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY))!);
const claimed = () => mockInvoke.mock.calls.some(c => c[0] === 'claim-points');

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (globalThis as any).__DEV__ = false;
  // These tests pin the FOREGROUND claim path (direct claim-points invoke) —
  // backgrounded claims ride the REST relay instead (geofence-claim-relay.test.ts).
  (AppState as any).currentState = 'active';
  getFix.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 10 } });
  mockInvoke.mockResolvedValue({ data: { earned: 30, push_delivered: true }, error: null });
  mockRpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  (globalThis as any).__DEV__ = true;
  jest.useRealTimers();
});

describe('claim attempt left no outcome — the lease heals it', () => {
  it('heals an orphaned attempt and retries within the SAME wake', async () => {
    await seedVisit({ sessionRecorded: true, claimAttemptAt: Date.now() - 3 * 60 * 1000 });

    await runVisitCheck('dwell');

    // A wake window is the one moment the radio is provably up — the heal
    // retries immediately instead of waiting for the next (out-of-phase) tick,
    // which lost wakes #2–#4 on 2026-07-14.
    expect(claimed()).toBe(true);
    expect((await readState()).sessionId).toBe('session-abc');
  });

  it('the re-queued claim then lands on the next tick', async () => {
    await seedVisit({ sessionRecorded: true, claimAttemptAt: Date.now() - 3 * 60 * 1000 });

    await runVisitCheck('dwell'); // heal → pointsPending
    await runVisitCheck('dwell'); // retry → claim

    expect(claimed()).toBe(true);
    expect((await readState()).sessionId).toBe('session-abc');
  });

  it('leaves a FRESH in-flight attempt alone (no double-claim from a racing tick)', async () => {
    await seedVisit({ sessionRecorded: true, claimAttemptAt: Date.now() - 10_000 });

    await runVisitCheck('dwell');

    expect(claimed()).toBe(false);
    expect((await readState()).pointsPending).toBeFalsy();
  });

  it('never disturbs a completed session (sessionId + tierUpgraded)', async () => {
    await seedVisit({
      sessionRecorded: true,
      sessionId: 'session-abc',
      tierUpgraded: true,
      claimAttemptAt: Date.now() - 3 * 60 * 1000,
    });

    await runVisitCheck('dwell');

    expect(claimed()).toBe(false);
    expect((await readState()).pointsPending).toBeFalsy();
  });
});

describe('a hung attempt cannot hold the claim lock forever', () => {
  // RN dispatches setTimeout off the UI frame clock, so with the app backgrounded
  // the withNetworkTimeout race may never fire: a hung attempt then holds the
  // in-flight lock and every tick's retry bounces off it (the 2026-07-14
  // livelock, visit 329f4a72). jest.setSystemTime advances the CLOCK without
  // running timers — exactly the frozen-timer world — so this pins the lease
  // steal, not the timeout.
  it('steals a stale lock after the lease expires and completes the claim', async () => {
    jest.useFakeTimers();
    await seedVisit();
    mockInvoke.mockImplementationOnce(() => new Promise(() => { /* hung; timers frozen */ }));

    const hung = runVisitCheck('dwell');            // persists sessionRecorded, hangs at the invoke
    await jest.advanceTimersByTimeAsync(0);         // reach the invoke without firing any timer

    jest.setSystemTime(Date.now() + 3 * 60 * 1000); // clock moves, timers stay frozen

    await runVisitCheck('dwell');                   // heal: stale claimAttemptAt → pointsPending
    await runVisitCheck('dwell');                   // retry: lease expired → steals lock → claims

    const state = await readState();
    expect(state.sessionId).toBe('session-abc');
    expect(mockInvoke.mock.calls.filter(c => c[0] === 'claim-points').length).toBe(2);
    void hung; // zombie stays pending; its fenced release cannot free the thief's lock
  });
});

describe('a hung claim-points call cannot strand the session', () => {
  it('times out into the ordinary retry path instead of a silent dead-end', async () => {
    jest.useFakeTimers();
    await seedVisit(); // initial claim path — nothing recorded yet
    mockInvoke.mockImplementation((name: string) =>
      name === 'claim-points'
        ? new Promise(() => { /* hangs forever — the 2026-07-14 field failure */ })
        : Promise.resolve({ data: {}, error: null }));

    const run = runVisitCheck('dwell');
    await jest.advanceTimersByTimeAsync(31_000); // past NETWORK_TIMEOUT_MS
    await run;

    const state = await readState();
    expect(state.sessionRecorded).toBe(true);
    // The hang became outcome 'error' → queued for retry, exactly like any failure.
    expect(state.pointsPending).toBe(true);
  });
});

/**
 * Background claims/upgrades must ride the REST relay, never functions.invoke.
 *
 * Field truth (six captures, 2026-07-14): while the app is backgrounded on
 * Android, REST/RPC requests reach the server but a client call to
 * /functions/v1/* NEVER arrives — the 30-min claim and 40-min upgrade only
 * completed on app-open. The fix relays the trigger through SECURITY DEFINER
 * RPCs (relay_gym_claim / relay_gym_upgrade) on the proven REST path; pg_net
 * invokes the edge function server-to-server.
 *
 * These tests pin the routing and the resolution loop:
 *   - backgrounded → relay RPC, and the doomed invoke is never attempted;
 *   - 'accepted' keeps pointsPending so a later tick re-checks;
 *   - the later tick's 'already_claimed' / 'already_done' finalizes the state;
 *   - foreground keeps the direct invoke (its rich response drives the
 *     within-reach nudge + local push fallback);
 *   - the wake handler prefers a ≤60 s cached fix (a fresh GPS acquisition
 *     outlives the ~10 s execution window an FCM wake grants mid-Doze).
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

const mockRpc = jest.fn();
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
const getCached = Location.getLastKnownPositionAsync as jest.Mock;

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
const invoked = (fn: string) => mockInvoke.mock.calls.some(c => c[0] === fn);
const relayCalls = (fn: string) => mockRpc.mock.calls.filter(c => c[0] === fn);

/** rpc mock: relay answers per `relays`, every other RPC (confirm/tick/mark) no-ops. */
function armRpc(relays: Record<string, unknown>) {
  mockRpc.mockImplementation((fn: string) =>
    Promise.resolve(fn in relays ? { data: relays[fn], error: null } : { data: null, error: null }));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (globalThis as any).__DEV__ = false;
  (AppState as any).currentState = 'background';
  getFix.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 10 } });
  getCached.mockResolvedValue(null);
  armRpc({});
});

afterEach(() => {
  (globalThis as any).__DEV__ = true;
  (AppState as any).currentState = 'active';
});

describe('backgrounded claim rides the relay, never the invoke', () => {
  it("relays through relay_gym_claim and keeps pointsPending until it's proven", async () => {
    await seedVisit();
    armRpc({ relay_gym_claim: { status: 'accepted' } });

    await runVisitCheck('dwell');

    expect(invoked('claim-points')).toBe(false);
    expect(relayCalls('relay_gym_claim')).toEqual([
      ['relay_gym_claim', { p_session_id: 'session-abc', p_visit_id: 'visit-1' }],
    ]);
    const state = await readState();
    expect(state.sessionRecorded).toBe(true);
    expect(state.pointsPending).toBe(true); // resolved by a later tick's relay
  });

  it("a later tick's 'already_claimed' finalizes the session", async () => {
    await seedVisit({ sessionRecorded: true, pointsPending: true });
    armRpc({ relay_gym_claim: { status: 'already_claimed' } });

    await runVisitCheck('dwell');

    expect(invoked('claim-points')).toBe(false);
    const state = await readState();
    expect(state.sessionId).toBe('session-abc');
    expect(state.pointsPending).toBe(false);
  });

  it('a relay failure falls back to the ordinary retry queue', async () => {
    await seedVisit();
    mockRpc.mockImplementation((fn: string) =>
      Promise.resolve(fn === 'relay_gym_claim'
        ? { data: null, error: { message: 'boom' } }
        : { data: null, error: null }));

    await runVisitCheck('dwell');

    expect((await readState()).pointsPending).toBe(true);
  });
});

describe('backgrounded upgrade rides the relay', () => {
  it("'accepted' leaves tierUpgraded unset; the next tick's 'already_done' completes it", async () => {
    await seedVisit({
      sessionRecorded: true,
      sessionId: 'session-abc',
      entryTimestamp: Date.now() - 45 * 60 * 1000,
    });
    armRpc({ relay_gym_upgrade: { status: 'accepted' } });

    await runVisitCheck('upgrade');
    expect(invoked('upgrade-gym-tier')).toBe(false);
    expect(relayCalls('relay_gym_upgrade').length).toBe(1);
    expect((await readState()).tierUpgraded).toBeFalsy();

    armRpc({ relay_gym_upgrade: { status: 'already_done' } });
    await runVisitCheck('upgrade');
    expect((await readState()).tierUpgraded).toBe(true);
  });
});

describe('foreground keeps the direct invoke', () => {
  it('claims via claim-points when the app is active', async () => {
    (AppState as any).currentState = 'active';
    await seedVisit();

    await runVisitCheck('dwell');

    expect(invoked('claim-points')).toBe(true);
    expect(relayCalls('relay_gym_claim').length).toBe(0);
    expect((await readState()).sessionId).toBe('session-abc');
  });
});

describe('the wake handler is cached-fix-first', () => {
  it('uses a fresh cached fix without acquiring GPS', async () => {
    await seedVisit({ sessionRecorded: true, sessionId: 'session-abc', tierUpgraded: true });
    getCached.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 20 } });

    await runVisitCheck('dwell');

    expect(getCached).toHaveBeenCalledWith({ maxAge: 60_000 });
    expect(getFix).not.toHaveBeenCalled();
  });

  it('falls back to a fresh acquisition when nothing is cached', async () => {
    await seedVisit({ sessionRecorded: true, sessionId: 'session-abc', tierUpgraded: true });
    getCached.mockResolvedValue(null);

    await runVisitCheck('dwell');

    expect(getFix).toHaveBeenCalled();
  });
});

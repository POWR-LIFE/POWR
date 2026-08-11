/**
 * Every flag writer on ACTIVE_GEOFENCE_KEY must read-modify-write CURRENT state,
 * never persist a pre-await snapshot.
 *
 * Field captures, 2026-08-11 (both the same `{ ...active }` spread, aimed two ways):
 *   - The background check-in stamped visitId onto the stored session, then the
 *     dwell machine's claim writers persisted a snapshot taken BEFORE the stamp —
 *     erasing the id. Every subsequent wake swept `visit: null` and re-resolved
 *     (`reused`), and only the #364/#375 guardrails kept that from minting a
 *     duplicate visit. Foreground was fine purely by snapshot timing.
 *   - After the exit closed the visit, a claim writer holding a pre-finalize
 *     snapshot wrote it back — RESURRECTING the key, so the exit backstop kept
 *     running against a visit the server had already closed.
 *
 * These tests interleave the concurrent write inside the claim/upgrade network
 * await (where the stale window actually was) and assert the writers merge onto
 * what is stored NOW — or refuse outright when the key is gone.
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
  getLocationCloseMode: () => 'on',
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

const readState = async () => {
  const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
  return raw ? JSON.parse(raw) : null;
};

/** Runs `write` the moment the named function invoke starts — inside the claim's
 *  network await, which is exactly where the stale-snapshot window was. */
function interceptInvoke(name: string, write: () => Promise<void>) {
  mockInvoke.mockImplementation(async (fn: string) => {
    if (fn === name) await write();
    return { data: { earned: 30, push_delivered: true, within_reach: null }, error: null };
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (globalThis as any).__DEV__ = false;
  (AppState as any).currentState = 'active';
  getFix.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 10 } });
  mockInvoke.mockResolvedValue({ data: { earned: 30, push_delivered: true }, error: null });
  mockRpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  (globalThis as any).__DEV__ = true;
});

describe('claim writers merge onto CURRENT stored state', () => {
  it('a visitId stamped during the claim round-trip survives the outcome write', async () => {
    // The background check-in's stamp landed between this tick's snapshot and
    // its post-claim write; the old spread erased it (field 2026-08-11).
    await seedVisit({ visitId: undefined });
    interceptInvoke('claim-points', async () => {
      const cur = JSON.parse((await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY))!);
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...cur, visitId: 'visit-9' }));
    });

    await runVisitCheck('dwell');

    const state = await readState();
    expect(state.sessionId).toBe('session-abc'); // the claim's own outcome landed
    expect(state.visitId).toBe('visit-9');       // and the concurrent stamp survived it
  });

  it('a session finalized during the claim round-trip is NOT resurrected', async () => {
    await seedVisit();
    interceptInvoke('claim-points', async () => {
      // finalizeActiveGeofence completed while the claim was in flight.
      await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);
    });

    await runVisitCheck('dwell');

    // The points banked server-side; the local record must stay gone, or the
    // exit backstop keeps chasing a visit the server already closed.
    expect(mockInvoke.mock.calls.some(c => c[0] === 'claim-points')).toBe(true);
    expect(await readState()).toBeNull();
  });

  it('a session finalized during the tier upgrade is NOT resurrected', async () => {
    await seedVisit({
      entryTimestamp: Date.now() - 45 * 60 * 1000,
      sessionRecorded: true,
      sessionId: 'session-abc',
    });
    interceptInvoke('upgrade-gym-tier', async () => {
      await AsyncStorage.removeItem(ACTIVE_GEOFENCE_KEY);
    });

    await runVisitCheck('dwell');

    expect(mockInvoke.mock.calls.some(c => c[0] === 'upgrade-gym-tier')).toBe(true);
    expect(await readState()).toBeNull();
  });

  it("never bleeds one session's flags into a NEW session at another region", async () => {
    await seedVisit();
    interceptInvoke('claim-points', async () => {
      // Old session finalized AND a new one checked in elsewhere, all mid-claim.
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
        partnerId: 'partner-2',
        partnerName: 'Other Gym',
        regionId: 'partner-2-0',
        entryTimestamp: Date.now(),
      }));
    });

    await runVisitCheck('dwell');

    const state = await readState();
    expect(state.regionId).toBe('partner-2-0');
    expect(state.sessionId).toBeUndefined();       // old session's claim outcome refused
    expect(state.sessionRecorded).toBeUndefined(); // old session's flags refused
  });
});

/**
 * The beacon's trust model: the SERVER never credits on a timer — it can only wake
 * the device and ask. runVisitCheck is where that promise is kept, so these tests
 * pin the gate itself:
 *
 *   fresh fix inside the radius  → claim (the normal dwell machine runs)
 *   fresh fix outside the radius → no claim; the visit is finalized as an exit
 *   no fix at all                → no claim, nothing lost (visit stays open for the
 *                                  next nudge / the existing exit path)
 *
 * If any of these invert, the server could credit a user who is not at the gym.
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

/** A visit that is already past the 30-min dwell threshold. */
async function seedActiveVisit() {
  await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
    partnerId: 'partner-1',
    partnerName: 'Xtreme Gym',
    regionId: 'partner-1-0',
    visitId: 'visit-1',
    entryTimestamp: Date.now() - 35 * 60 * 1000,
    latitude: GYM.lat,
    longitude: GYM.lng,
    radius: GYM.radius,
  }));
}

// A wake runs with the app backgrounded, where claims ride the REST relay
// (relay_gym_claim → pg_net → claim-points server-to-server) — a direct
// functions.invoke never arrives from a backgrounded Android app (2026-07-14).
const claimed = () => mockRpc.mock.calls.some(c => c[0] === 'relay_gym_claim');
const rpcCalls = (name: string) => mockRpc.mock.calls.filter(c => c[0] === name);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (globalThis as any).__DEV__ = false;
  (AppState as any).currentState = 'background'; // a beacon wake = backgrounded app
  mockInvoke.mockResolvedValue({ data: { earned: 30, push_delivered: true }, error: null });
  mockRpc.mockImplementation((fn: string) =>
    Promise.resolve(fn === 'relay_gym_claim' ? { data: { status: 'accepted' }, error: null } : { data: null, error: null }));
});

afterEach(() => {
  (globalThis as any).__DEV__ = true;
  (AppState as any).currentState = 'active';
});

describe('runVisitCheck — the server wakes us, the device decides', () => {
  it('claims when a fresh fix proves the user is still inside the gym', async () => {
    await seedActiveVisit();
    getFix.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 10 } });

    await runVisitCheck('dwell');

    expect(claimed()).toBe(true);
    // The device reports what it saw; the server only records it.
    // The single confirm round-trip also asks the server to credit the visit —
    // the wake window fits ~one round-trip, and this is it (2026-07-14).
    expect(rpcCalls('confirm_gym_visit_v2')[0][1]).toMatchObject({ p_visit_id: 'visit-1', p_inside: true, p_request_credit: true });
  });

  it('does NOT claim when the fix shows the user has left — it closes the visit', async () => {
    await seedActiveVisit();
    // ~1.3 km away: well outside the radius + hysteresis.
    getFix.mockResolvedValue({ coords: { latitude: 51.512, longitude: GYM.lng, accuracy: 10 } });

    await runVisitCheck('dwell');

    // No credit request on an outside confirm — no fix inside, no credit.
    expect(rpcCalls('confirm_gym_visit_v2')[0][1]).toMatchObject({ p_inside: false, p_request_credit: false });
    // Left the gym → the visit is finalized rather than credited on a timer.
    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).toBeNull();
  });

  it('credits nothing when no fix can be taken — no proof, no points', async () => {
    await seedActiveVisit();
    getFix.mockRejectedValue(new Error('location unavailable'));

    await runVisitCheck('dwell');

    expect(claimed()).toBe(false);
    expect(rpcCalls('confirm_gym_visit_v2')[0][1]).toMatchObject({ p_inside: false, p_detail: { reason: 'no_fix' }, p_request_credit: false });
    // Visit stays open: the next nudge or the exit path still resolves it.
    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
  });

  // ── The late-open retry, and the stamp that has to survive it ──────────────
  //
  // A check-in whose openGymVisit response is lost (routine on Android while
  // auth is wedged) leaves an active session with no visit id, and every wake
  // re-resolves it. If the resolved id is then DISCARDED, the client keeps
  // asking — and once the server closes that visit, the next ask is a request to
  // re-open an ended check-in. That is how duplicate a635617c was minted on
  // 2026-08-10, backdated 95 minutes to a visit that had closed 23 minutes
  // earlier. The stamp is what stops the asking.
  describe('late-open stamping', () => {
    async function seedUnstampedVisit() {
      await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
        partnerId: 'partner-1',
        partnerName: 'Xtreme Gym',
        regionId: 'partner-1-0',
        entryTimestamp: Date.now() - 35 * 60 * 1000,
        latitude: GYM.lat,
        longitude: GYM.lng,
        radius: GYM.radius,
      }));
    }

    /** Simulates the concurrent check-in path rewriting the stored record while
     *  open_gym_visit is in flight — the race that made the old strict
     *  `entryTimestamp ===` guard fail on every Android check-in. */
    function rewriteActiveDuringOpen(patch: Record<string, unknown>) {
      mockRpc.mockImplementation(async (fn: string) => {
        if (fn === 'open_gym_visit') {
          const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
          await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({ ...JSON.parse(raw!), ...patch }));
          return { data: 'visit-late', error: null };
        }
        return { data: fn === 'relay_gym_claim' ? { status: 'accepted' } : null, error: null };
      });
    }

    it('stamps the resolved id even when a concurrent path moved the entry timestamp', async () => {
      await seedUnstampedVisit();
      rewriteActiveDuringOpen({ entryTimestamp: Date.now() - 34 * 60 * 1000 });
      getFix.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 10 } });

      await runVisitCheck('dwell');

      const stored = JSON.parse((await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY))!);
      expect(stored.visitId).toBe('visit-late');
    });

    it('refuses to stamp a visit onto a session at a different region', async () => {
      await seedUnstampedVisit();
      rewriteActiveDuringOpen({ regionId: 'partner-2-0' });
      getFix.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 10 } });

      await runVisitCheck('dwell');

      const stored = JSON.parse((await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY))!);
      expect(stored.visitId).toBeUndefined();
    });

    it('never overwrites an id the session already has', async () => {
      await seedActiveVisit(); // already carries visit-1
      mockRpc.mockImplementation(async (fn: string) => ({
        data: fn === 'open_gym_visit' ? 'visit-late'
          : fn === 'relay_gym_claim' ? { status: 'accepted' } : null,
        error: null,
      }));
      getFix.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 10 } });

      await runVisitCheck('dwell');

      const stored = JSON.parse((await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY))!);
      expect(stored.visitId).toBe('visit-1');
      // ...and with an id in hand there is nothing to re-resolve.
      expect(rpcCalls('open_gym_visit')).toHaveLength(0);
    });
  });

  it('ignores a wake-up when no visit is active', async () => {
    getFix.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 10 } });

    await runVisitCheck('dwell');

    expect(claimed()).toBe(false);
    expect(getFix).not.toHaveBeenCalled();
  });
});

/**
 * The acquire rung reported a fix age it never measured (2026-08-17).
 *
 * `fixAgeMs = fresh ? 0 : null` was a literal standing in for a measurement, on
 * the premise — written into the comment above it — that "`acquired` is fresh by
 * construction". It is not: Balanced accuracy is allowed to satisfy a request
 * from cache, so a 6 ms "acquisition" is a fused-provider replay.
 *
 * Caught live on visit 9346e8d2: the 19:01:03 confirm reported fix_source
 * 'acquired' / acquire 6 ms / fix_age_ms 0 while the SAME wake's sweep measured
 * that fix at 130 s and rejected it (stale_age_s 130). Seven of that visit's
 * thirteen accepted proof stamps came off this rung wearing a zero, and across
 * the whole history of the table the rung has reported a non-zero age ZERO times
 * (21 of 21 since instrumentation) while stream_cache and last_known both
 * measure. That is what stamped last_proven_at at the wrong moment.
 *
 * runVisitCheck is exercised directly — it is exported for exactly this.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

const LOCATION_TRACKING_TASK = 'POWR_LOCATION_TRACKING';
const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const VISIT_TICK_KEY = '@powr/last_visit_tick';

const GYM = { lat: 52.1244, lng: -1.764, radius: 25 };

jest.mock('expo-task-manager', () => {
  const registry: Record<string, (body: any) => Promise<unknown>> = {};
  return {
    __registry: registry,
    defineTask: jest.fn((name: string, fn: (body: any) => Promise<unknown>) => { registry[name] = fn; }),
    isTaskRegisteredAsync: jest.fn().mockResolvedValue(true),
  };
});
const mockTasks = (jest.requireMock('expo-task-manager') as any).__registry as
  Record<string, (body: any) => Promise<unknown>>;

jest.mock('expo-background-fetch', () => ({
  BackgroundFetchResult: { NewData: 'new-data', Failed: 'failed' },
  registerTaskAsync: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 2 },
  ActivityType: { Other: 1, AutomotiveNavigation: 2, Fitness: 3, OtherNavigation: 4, Airborne: 5 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue(null),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  hasStartedGeofencingAsync: jest.fn().mockResolvedValue(true),
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(true),
  startGeofencingAsync: jest.fn().mockResolvedValue(undefined),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  stopGeofencingAsync: jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
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
  notifyCheckInAvailable:    jest.fn().mockResolvedValue(undefined),
  notifySessionCompleted:    jest.fn().mockResolvedValue(undefined),
  notifySessionUpgraded:     jest.fn().mockResolvedValue(undefined),
  scheduleRewardWithinReach: jest.fn().mockResolvedValue(undefined),
}));

const mockConfirmGymVisit = jest.fn(async () => ({ ok: true, triggered: null }));
const mockLogGymVisitTick = jest.fn(async () => {});
jest.mock('@/lib/gymVisits', () => ({
  confirmGymVisit:            (...a: any[]) => (mockConfirmGymVisit as jest.Mock)(...a),
  confirmGymVisitViaNonce:    jest.fn(async () => ({ ok: true, triggered: null })),
  openGymVisit:               jest.fn(async () => null),
  closeGymVisit:              jest.fn(async () => {}),
  logGymVisitTick:            (...a: any[]) => (mockLogGymVisitTick as jest.Mock)(...a),
  logGymWakeReceived:         jest.fn(async () => {}),
  logGymWakeReceivedViaNonce: jest.fn(async () => {}),
  logGeofenceRegionEvent:     jest.fn(async () => {}),
}));

const mockRpc = jest.fn(async () => ({ data: null, error: null }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-1', email: 'test@example.com' } } },
        error: null,
      }),
    },
    from: () => {
      const builder: any = { then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r) };
      ['select', 'insert', 'update', 'eq', 'gte', 'order', 'limit'].forEach(m => { builder[m] = jest.fn(() => builder); });
      builder.single = jest.fn(async () => ({ data: null, error: null }));
      builder.maybeSingle = jest.fn(async () => ({ data: null, error: null }));
      return builder;
    },
    rpc: (...a: any[]) => (mockRpc as jest.Mock)(...a),
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
  },
}));

const mockLocation = Location as jest.Mocked<typeof Location>;

import { runVisitCheck } from '@/context/GeofenceContext';

const seedActiveVisit = () => AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
  regionId:       'partner-home-0',
  partnerId:      'partner-home',
  visitId:        'visit-1',
  latitude:       GYM.lat,
  longitude:      GYM.lng,
  radius:         GYM.radius,
  entryTimestamp: Date.now() - 35 * 60_000,
}));

/** Empty the two rungs above `acquire` so the ladder falls through to it. */
const forceAcquireRung = () => {
  mockLocation.getLastKnownPositionAsync.mockResolvedValue(null as any);
};

const confirmDetail = () => (mockConfirmGymVisit.mock.calls[0] as any[])[2];

describe('runVisitCheck — the acquire rung reports a MEASURED fix age', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (globalThis as any).__DEV__ = false;
    forceAcquireRung();
  });

  it('reports the fix’s real age when the "acquisition" was served from cache', async () => {
    // The 2026-08-17 shape exactly: the provider answers instantly with a fix it
    // took 130 s ago. Before this change the confirm claimed fix_age_s 0 and the
    // server banked it as proof of the present.
    mockLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 20 },
      timestamp: Date.now() - 130_000,
    } as any);
    await seedActiveVisit();

    await runVisitCheck('dwell');

    expect(mockConfirmGymVisit).toHaveBeenCalled();
    expect(confirmDetail().fix_age_s).toBe(130);
    expect(confirmDetail().trace.fix_source).toBe('acquired');
  });

  it('still reports 0 for a genuinely fresh acquisition — no over-correction', async () => {
    mockLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 20 },
      timestamp: Date.now(),
    } as any);
    await seedActiveVisit();

    await runVisitCheck('dwell');

    expect(confirmDetail().fix_age_s).toBe(0);
  });

  it('reports null, not 0, when the platform omits the timestamp', async () => {
    // Android's LocationResults omits the key entirely when Location.getTime()
    // is null. "Unknown" and "zero" must not be the same answer — null is what
    // both the local credit floor and the server treat as unknown-but-acceptable,
    // and it is the only way the field can tell the two apart.
    mockLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 20 },
    } as any);
    await seedActiveVisit();

    await runVisitCheck('dwell');

    expect(confirmDetail().fix_age_s).toBeNull();
    expect(confirmDetail().trace.fix_age_ms).toBeUndefined();
  });

  it('never reports a negative age when the fused clock runs ahead of us', async () => {
    // Android's Location.getTime() is wall-clock and non-monotonic; it can land
    // microseconds ahead of Date.now(). A negative age is a lie in the other
    // direction, and it would sail through every `<= 120` gate.
    mockLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 20 },
      timestamp: Date.now() + 5_000,
    } as any);
    await seedActiveVisit();

    await runVisitCheck('dwell');

    expect(confirmDetail().fix_age_s).toBe(0);
  });
});

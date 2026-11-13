/**
 * Late-open retry budget (2026-11-13).
 *
 * Field, visit dc01c3fc (Android): the server closed the visit at 22:57, the
 * phone (100 m coarse fixes, 5 m from the venue) never saw an exit, and with no
 * visitId stamped every stream tick late-opened — 62 attempts in 10 h, each
 * answered server-side with `stale_entry_replayed`, and not one reply reached
 * JS. The budget is counted BEFORE the call, so a lost reply still counts.
 *
 * Harness copied from geofence-heartbeat-proof.test.ts: heartbeatVisitStream is
 * module-private and is driven through the registered location task.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

const LOCATION_TRACKING_TASK = 'POWR_LOCATION_TRACKING';
const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const LAST_WAKE_AT_KEY = '@powr/last_wake_processed_at';
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

// The iOS finish-hold sleeps after every task delivery; 20 ticks would time out.
jest.mock('@/lib/taskFinishGuard', () => {
  const actual = jest.requireActual('@/lib/taskFinishGuard');
  const tm = jest.requireMock('expo-task-manager') as any;
  return { ...actual, holdUntilQuiet: async () => {}, defineTask: (name: string, fn: any) => tm.defineTask(name, fn) };
});

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
const mockOpenGymVisit = jest.fn(async (..._a: any[]) => null);
const mockLogRegion = jest.fn(async (..._a: any[]) => {});
jest.mock('@/lib/gymVisits', () => ({
  confirmGymVisit:            (...a: any[]) => (mockConfirmGymVisit as jest.Mock)(...a),
  confirmGymVisitViaNonce:    jest.fn(async () => ({ ok: true, triggered: null })),
  openGymVisit:               (...a: any[]) => (mockOpenGymVisit as jest.Mock)(...a),
  closeGymVisit:              jest.fn(async () => {}),
  logGymVisitTick:            (...a: any[]) => (mockLogGymVisitTick as jest.Mock)(...a),
  logGymWakeReceived:         jest.fn(async () => {}),
  logGymWakeReceivedViaNonce: jest.fn(async () => {}),
  logGeofenceRegionEvent:     (...a: any[]) => (mockLogRegion as jest.Mock)(...a),
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

import { resetSelfPollThrottleForTests, resetVisitTickThrottleForTests } from '@/context/GeofenceContext';

const ENTRY = Date.now() - 6 * 60 * 60_000;

const seedUnstampedVisit = (entryTimestamp = ENTRY) => AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
  regionId:       'partner-home-0',
  partnerId:      'partner-home',
  latitude:       GYM.lat,
  longitude:      GYM.lng,
  radius:         GYM.radius,
  entryTimestamp,
}));

/** One stream tick. The throttle is reset so every call is a real tick, the
 *  way the 5-min cadence makes each one in the field. */
const tick = async () => {
  resetVisitTickThrottleForTests();
  resetSelfPollThrottleForTests();
  await mockTasks[LOCATION_TRACKING_TASK]({
    data: { locations: [{ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 100 }, timestamp: Date.now() }] },
    error: null,
  });
  // logRegionEvent is fire-and-forget through a dynamic import.
  await new Promise<void>(r => setImmediate(r));
};

const gaveUpRows = () => mockLogRegion.mock.calls.filter((c: any[]) => c[1] === 'late_open_gave_up');

describe('late-open retry budget', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (globalThis as any).__DEV__ = false;
    await AsyncStorage.setItem(LAST_WAKE_AT_KEY, String(Date.now()));
    await seedUnstampedVisit();
  });

  it('stops late-opening one session after 12 unresolved attempts, and says so once', async () => {
    for (let i = 0; i < 20; i++) await tick();

    expect(mockOpenGymVisit).toHaveBeenCalledTimes(12);
    expect(gaveUpRows()).toHaveLength(1);
    expect(gaveUpRows()[0][2]).toMatchObject({ source: 'stream_late_open', tries: 12, opened_entry: ENTRY });
  });

  it('gives a NEW session a fresh budget', async () => {
    for (let i = 0; i < 13; i++) await tick();
    expect(mockOpenGymVisit).toHaveBeenCalledTimes(12);

    await seedUnstampedVisit(Date.now() - 5 * 60_000);
    await tick();
    expect(mockOpenGymVisit).toHaveBeenCalledTimes(13);
  });

  it('runs nothing that needs a visit id once the budget is spent', async () => {
    for (let i = 0; i < 14; i++) await tick();
    expect(mockConfirmGymVisit).not.toHaveBeenCalled();
  });
});

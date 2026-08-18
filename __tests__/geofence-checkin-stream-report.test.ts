/**
 * A refused dwell switch at CHECK-IN must say so (2026-08-17).
 *
 * setActiveAndNotify discarded setLocationStreamMode's result, so the only trace
 * of a refusal was a `stream_switch_deferred` row on the generic 'stream' key —
 * nothing tied it to check-in, and nothing tied it to the visit's region. It took
 * a direct database query to convict.
 *
 * Field 08-17, visit 9346e8d2: the deferral fired 51 ms after check-in
 * (18:26:53.727, {"to":"dwell","from":"passive"}) and the visit then ran all 47
 * minutes on `passive` — distanceInterval 50, which a stationary lifter never
 * trips. stream_fix_age_s climbed 550 → 2412 with exactly one stream tick.
 *
 * This pins the REPORT, not a fix. The switch genuinely cannot land from a
 * background context: expo-location throws from its own JS-facing
 * startLocationUpdatesAsync whenever the app is backgrounded and the options
 * carry a foregroundService block (LocationModule.kt:258-260), and
 * DWELL_LOCATION_OPTIONS carries one.
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

const mockLogRegionEvent = jest.fn(async () => {});
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
  logGeofenceRegionEvent:     (...a: any[]) => (mockLogRegionEvent as jest.Mock)(...a),
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

import { Platform, AppState } from 'react-native';

const PARTNER_MAP_KEY = '@powr/partner_map';
const STREAM_MODE_KEY = '@powr/stream_mode';
const PARTNER_MAP_META_KEY = '@powr/partner_map_meta';

require('@/context/GeofenceContext');

/** logRegionEvent rides a fire-and-forget dynamic import — flush it. */
async function flushTelemetry() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const regionEvents = (event: string) =>
  (mockLogRegionEvent.mock.calls as any[][])
    .filter(([, e]) => e === event)
    .map(([regionId, , detail]) => ({ regionId, detail }));

/** Drive a clean fix onto a seeded gym with NO active session → check-in. */
const driveCheckIn = () =>
  mockTasks[LOCATION_TRACKING_TASK]({
    data: { locations: [{
      coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 20 },
      timestamp: Date.now(),
    }] },
    error: null,
  });

describe('check-in reports a dwell stream it could not start', () => {
  let restorePlatform: PropertyDescriptor | undefined;
  let restoreAppState: PropertyDescriptor | undefined;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (globalThis as any).__DEV__ = false;
    // The refusal is Android's, from a background context — the only shape in
    // which an unaided check-in ever happens.
    restorePlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');
    restoreAppState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
    await AsyncStorage.setItem(PARTNER_MAP_KEY, JSON.stringify({
      'partner-home-0': { dbId: 'partner-home', name: 'Home Gym', lat: GYM.lat, lng: GYM.lng, radius: GYM.radius },
    }));
    await AsyncStorage.setItem(PARTNER_MAP_META_KEY, JSON.stringify({ fetchedAt: Date.now() }));
    // The pre-check-in state on Android: a live baseline stream in `passive`.
    // Without this the mode is INFERRED from the active-session key that
    // setActiveAndNotify writes one line earlier, comes back 'dwell', and the
    // same-mode no-op returns before the guard is ever consulted.
    await AsyncStorage.setItem(STREAM_MODE_KEY, 'passive');
  });

  afterEach(() => {
    if (restorePlatform) Object.defineProperty(Platform, 'OS', restorePlatform);
    if (restoreAppState) Object.defineProperty(AppState, 'currentState', restoreAppState);
  });

  it('logs stream_start_failed against the VISIT’s region when the switch does not land', async () => {
    // A live stream in the wrong mode: the background guard refuses the switch,
    // so the returned mode is not 'dwell'.
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(true as any);

    await driveCheckIn();
    await flushTelemetry();

    const failures = regionEvents('stream_start_failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].regionId).toBe('partner-home-0');   // NOT the generic 'stream' key
    expect(failures[0].detail.at).toBe('check_in');
    expect(failures[0].detail.mode).toBe('dwell');
    expect(failures[0].detail.got).not.toBe('dwell');
  });

  it('stays silent when the dwell stream actually starts', async () => {
    // Foregrounded: the guard does not apply and the switch lands.
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(false as any);

    await driveCheckIn();
    await flushTelemetry();

    expect(regionEvents('stream_start_failed')).toHaveLength(0);
  });
});

/**
 * Regression guards for the 2026-08-04 field failure: a backgrounded phone sat
 * 17 m from its own gym all morning and never checked in.
 *
 * Three compounding defects, each pinned here:
 *
 * 1. THE PHANTOM ARM — the startup/sentinel arm fixes were read at Accuracy.Low
 *    ("city level", served from cell/IP positioning), which placed a stationary
 *    user 13 km away. The watch list was built around the wrong town and the
 *    user's own gym missed the nearest-49 cut (rank 65). Arm fixes now come from
 *    getArmFix(), which screens EVERY source to ≤1 km and never reads at Low.
 *
 * 2. THE UNCORRECTABLE ARM — with the set mis-centred, every later indoor fix
 *    was >100 m accuracy and evaluateLocationFix returned before the drift
 *    re-arm, so nothing could ever re-target the set. A coarse-but-≤1 km fix now
 *    still drives the km-scale drift re-arm (it remains barred from ENTER/EXIT).
 *
 * 3. THE SELF-INFLICTED STREAM DEATH — setLocationStreamMode did stop→start even
 *    when the requested mode was already running. On Android 12+ the start can
 *    be REFUSED from a background context, so a redundant "switch" killed the
 *    baseline stream mid-morning and it stayed dead until app-open. Same-mode
 *    calls are now no-ops, and a refused start restores the previous stream.
 *
 * Tasks are driven through the REAL callbacks captured from
 * TaskManager.defineTask — the same entry points the OS uses when the app is
 * backgrounded, which is where all of this failed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { getArmFix, setLocationStreamMode } from '@/context/GeofenceContext';

const GEOFENCE_TASK_NAME = 'GEOFENCE_CHECK_IN';
const LOCATION_TRACKING_TASK = 'POWR_LOCATION_TRACKING';
const SENTINEL_REGION_ID = 'POWR_REARM_SENTINEL';
const PARTNER_MAP_KEY = '@powr/partner_map';
const PARTNER_MAP_META_KEY = '@powr/partner_map_meta';
const ARM_META_KEY = '@powr/geofence_arm_meta';
const LAST_STREAM_FIX_KEY = '@powr/last_stream_fix';

// A small nationwide-ish map: one gym at the user's real location, a cluster in
// a "town" ~13 km away (the phantom arm centred here on 2026-08-04).
const HOME_GYM = { dbId: 'partner-home', name: 'Home Gym', lat: 52.1244, lng: -1.764, radius: 25 };
const TOWN_GYMS = Object.fromEntries(
  Array.from({ length: 5 }, (_, i) => [
    `partner-town-${i}-0`,
    { dbId: `partner-town-${i}`, name: `Town Gym ${i}`, lat: 52.19 + i * 0.001, lng: -1.7, radius: 25 },
  ]),
);
const PHANTOM_CENTER = { lat: 52.19, lng: -1.7 };

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
  GeofencingEventType: { Enter: 1, Exit: 2 },
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue(null),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  hasStartedGeofencingAsync: jest.fn().mockResolvedValue(true),
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(false),
  startGeofencingAsync: jest.fn().mockResolvedValue(undefined),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  stopGeofencingAsync: jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/device', () => ({ getDeviceId: jest.fn().mockResolvedValue('device-1') }));
jest.mock('@/lib/gymDwellConfig', () => ({
  getGymDwellMinutes: () => 30,
  getGymUpgradeMinutes: () => 40,
  primeGymDwellMinutes: jest.fn().mockResolvedValue(30),
  refreshGymDwellMinutes: jest.fn().mockResolvedValue(30),
}));
jest.mock('@/lib/notifications', () => ({
  notifyCheckInAvailable:    jest.fn().mockResolvedValue(undefined),
  notifySessionCompleted:    jest.fn().mockResolvedValue(undefined),
  notifySessionUpgraded:     jest.fn().mockResolvedValue(undefined),
  scheduleRewardWithinReach: jest.fn().mockResolvedValue(undefined),
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

const driveSentinelExit = () =>
  mockTasks[GEOFENCE_TASK_NAME]({ data: { eventType: 2, region: { identifier: SENTINEL_REGION_ID } }, error: null });

const driveLocationFix = (coords: object) =>
  mockTasks[LOCATION_TRACKING_TASK]({ data: { locations: [{ coords }] }, error: null });

/** logRegionEvent rides a fire-and-forget dynamic import — flush it. */
async function flushTelemetry() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const regionEvents = () =>
  mockRpc.mock.calls
    .filter(([fn]: any[]) => fn === 'log_geofence_region_event')
    .map(([, args]: any[]) => args.p_event);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await AsyncStorage.setItem(PARTNER_MAP_KEY, JSON.stringify({ 'partner-home-0': HOME_GYM, ...TOWN_GYMS }));
  await AsyncStorage.setItem(PARTNER_MAP_META_KEY, JSON.stringify({ fetchedAt: Date.now() }));
});

describe('getArmFix — the arm centre must be trustworthy', () => {
  it('rejects a city-level live read instead of arming around it (the 13 km phantom)', async () => {
    mockLocation.getCurrentPositionAsync.mockResolvedValueOnce(
      { coords: { latitude: PHANTOM_CENTER.lat, longitude: PHANTOM_CENTER.lng, accuracy: 8_000 } } as any,
    );

    expect(await getArmFix()).toBeNull();

    // And the read it did make was Balanced — never Accuracy.Low, whose
    // city-level answers are what produced the phantom in the first place.
    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced });
  });

  it('screens the OS cache with requiredAccuracy, not just age', async () => {
    await getArmFix();
    expect(mockLocation.getLastKnownPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ requiredAccuracy: 1_000 }),
    );
  });

  it('prefers the persisted stream fix and then touches no location API at all', async () => {
    await AsyncStorage.setItem(LAST_STREAM_FIX_KEY, JSON.stringify({
      latitude: HOME_GYM.lat, longitude: HOME_GYM.lng, accuracy: 25, at: Date.now() - 60_000,
    }));

    const fix = await getArmFix();

    expect(fix).toMatchObject({ latitude: HOME_GYM.lat, longitude: HOME_GYM.lng, src: 'stream_cache' });
    expect(mockLocation.getLastKnownPositionAsync).not.toHaveBeenCalled();
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('ignores a stream fix that is itself too coarse', async () => {
    await AsyncStorage.setItem(LAST_STREAM_FIX_KEY, JSON.stringify({
      latitude: PHANTOM_CENTER.lat, longitude: PHANTOM_CENTER.lng, accuracy: 5_000, at: Date.now(),
    }));

    expect(await getArmFix()).toBeNull();
  });

  it('is bounded: a GPS read that never settles resolves null instead of hanging the task', async () => {
    jest.useFakeTimers();
    try {
      mockLocation.getCurrentPositionAsync.mockReturnValueOnce(new Promise(() => {}) as any);
      const pending = getArmFix();
      await jest.advanceTimersByTimeAsync(8_000);
      expect(await pending).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('sentinel EXIT — re-arm must be observable and never centred on a guess', () => {
  it('re-arms from the persisted stream fix and reports both the exit and the arm', async () => {
    await AsyncStorage.setItem(LAST_STREAM_FIX_KEY, JSON.stringify({
      latitude: HOME_GYM.lat, longitude: HOME_GYM.lng, accuracy: 30, at: Date.now() - 30_000,
    }));

    await driveSentinelExit();
    await flushTelemetry();

    expect(mockLocation.startGeofencingAsync).toHaveBeenCalledTimes(1);
    const regions = (mockLocation.startGeofencingAsync.mock.calls[0] as any[])[1];
    const sentinel = regions.find((r: any) => r.identifier === SENTINEL_REGION_ID);
    expect(sentinel).toMatchObject({ latitude: HOME_GYM.lat, longitude: HOME_GYM.lng });
    // No live acquisition happened at all — the crossing's own fix was in hand.
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(regionEvents()).toEqual(expect.arrayContaining(['sentinel_exit', 'armed']));
  });

  it('with no trusted fix anywhere, keeps the current set and says so', async () => {
    // OS cache empty, live read answers at city level — the exact 2026-08-04 inputs.
    mockLocation.getCurrentPositionAsync.mockResolvedValueOnce(
      { coords: { latitude: PHANTOM_CENTER.lat, longitude: PHANTOM_CENTER.lng, accuracy: 8_000 } } as any,
    );

    await driveSentinelExit();
    await flushTelemetry();

    expect(mockLocation.startGeofencingAsync).not.toHaveBeenCalled();
    expect(regionEvents()).toEqual(expect.arrayContaining(['sentinel_exit', 'rearm_skipped']));
  });
});

describe('coarse-fix drift re-arm — a mis-centred set must be correctable', () => {
  const armedAroundPhantom = () => AsyncStorage.setItem(ARM_META_KEY, JSON.stringify({
    centerLat: PHANTOM_CENTER.lat, centerLng: PHANTOM_CENTER.lng,
    sentinelRadius: 5_000, armedAt: Date.now() - 10 * 60_000,
  }));

  it('a 300 m fix from outside the sentinel re-targets the armed set', async () => {
    await armedAroundPhantom();

    // 300 m accuracy: barred from ENTER/EXIT (>100 m) but plenty to see the set
    // is centred 13 km away. Position: near home, far outside the phantom sentinel.
    await driveLocationFix({ latitude: 52.13, longitude: -1.76, accuracy: 300 });

    expect(mockLocation.startGeofencingAsync).toHaveBeenCalledTimes(1);
    const regions = (mockLocation.startGeofencingAsync.mock.calls[0] as any[])[1];
    expect(regions.map((r: any) => r.identifier)).toContain('partner-home-0');
  });

  it('but a fix coarser than 1 km still cannot move the set', async () => {
    await armedAroundPhantom();

    await driveLocationFix({ latitude: 52.13, longitude: -1.76, accuracy: 5_000 });

    expect(mockLocation.startGeofencingAsync).not.toHaveBeenCalled();
  });
});

describe('setLocationStreamMode — a live stream must never be restarted into the void', () => {
  it('same-mode call is a no-op (no stop, no start)', async () => {
    // First call records 'passive' as the running mode.
    await setLocationStreamMode('passive');
    expect(mockLocation.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(true);

    await setLocationStreamMode('passive');

    // The old code stop→started here; on Android 12+ in the background the start
    // can be refused, which is how the baseline stream died on 2026-08-04.
    expect(mockLocation.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(mockLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('a refused start restores the previous stream instead of leaving none', async () => {
    await setLocationStreamMode('passive');
    jest.clearAllMocks();
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    mockLocation.startLocationUpdatesAsync
      .mockRejectedValueOnce(new Error('ForegroundServiceStartNotAllowedException'))
      .mockResolvedValueOnce(undefined as any);

    await setLocationStreamMode('dwell');
    await flushTelemetry();

    // Stopped once for the switch, then started twice: the refused dwell start,
    // then the restore of the previous (passive/baseline) options.
    expect(mockLocation.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(mockLocation.startLocationUpdatesAsync).toHaveBeenCalledTimes(2);
    const restoreOpts = (mockLocation.startLocationUpdatesAsync.mock.calls[1] as any[])[1];
    expect(restoreOpts.distanceInterval).toBe(50); // baseline options, not dwell's 0
    const failures = (mockRpc.mock.calls as any[][]).filter(([fn, args]) =>
      fn === 'log_geofence_region_event' && args?.p_event === 'stream_start_failed');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.[1]?.p_detail).toMatchObject({ mode: 'dwell', restored: true });
  });
});

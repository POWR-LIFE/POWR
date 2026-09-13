/**
 * The check-in's openGymVisit is BOUNDED, and a late answer still stamps (2026-09-06).
 *
 * Field 08-18: the check-in open hung 50 min 45 s on Android and 33.8 min on iOS —
 * the one visit call with no time-box. In the 14 days to 09-06, 11 iOS check-in
 * opens never resolved inside 30 s while 204 took p50 0.7 s. While it hangs the
 * phone holds a session with no visit id and re-resolves it on every wake.
 *
 * Pins three things:
 *   1. a check-in whose open never answers still completes inside the bound and
 *      says so (`check_in_open_deferred`), with the session persisted and unstamped;
 *   2. when that open finally resolves, the id is stamped onto the SAME session;
 *   3. an open that answers in time stamps immediately and logs no deferral.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

const LOCATION_TRACKING_TASK = 'POWR_LOCATION_TRACKING';
const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';

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
  getLocationCloseMode: () => 'on',
  primeGymDwellMinutes: jest.fn().mockResolvedValue(30),
  refreshGymDwellMinutes: jest.fn().mockResolvedValue(30),
}));
jest.mock('@/lib/notifications', () => ({
  notifyCheckInAvailable:    jest.fn().mockResolvedValue('scheduled'),
  notifySessionCompleted:    jest.fn().mockResolvedValue(undefined),
  notifySessionUpgraded:     jest.fn().mockResolvedValue(undefined),
  scheduleRewardWithinReach: jest.fn().mockResolvedValue(undefined),
}));

const mockLogRegionEvent = jest.fn(async () => {});
const mockOpenGymVisit = jest.fn(async (): Promise<string | null> => null);
jest.mock('@/lib/gymVisits', () => ({
  confirmGymVisit:            jest.fn(async () => ({ ok: true, triggered: null })),
  confirmGymVisitViaNonce:    jest.fn(async () => ({ ok: true, triggered: null })),
  openGymVisit:               (...a: any[]) => (mockOpenGymVisit as jest.Mock)(...a),
  closeGymVisit:              jest.fn(async () => {}),
  logGymVisitTick:            jest.fn(async () => {}),
  logGymWakeReceived:         jest.fn(async () => {}),
  logGymWakeReceivedViaNonce: jest.fn(async () => {}),
  logGeofenceRegionEvent:     (...a: any[]) => (mockLogRegionEvent as jest.Mock)(...a),
}));

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
    rpc: jest.fn(async () => ({ data: null, error: null })),
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
  },
}));

import { Platform, AppState } from 'react-native';
import { CHECK_IN_OPEN_BOUND_MS, buildCheckInFix } from '@/context/GeofenceContext';

const PARTNER_MAP_KEY = '@powr/partner_map';
const PARTNER_MAP_META_KEY = '@powr/partner_map_meta';

/** Fire-and-forget telemetry rides a dynamic import — give the microtask queue room. */
async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

const regionEvents = (event: string) =>
  (mockLogRegionEvent.mock.calls as any[][])
    .filter(([, e]) => e === event)
    .map(([regionId, , detail]) => ({ regionId, detail }));

const readActive = async () => {
  const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
  return raw ? JSON.parse(raw) as { regionId?: string; visitId?: string | null; entryTimestamp: number } : null;
};

/** A clean fix on the seeded gym with no active session → check-in. */
const driveCheckIn = () =>
  mockTasks[LOCATION_TRACKING_TASK]({
    data: { locations: [{
      coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 20 },
      timestamp: Date.now(),
    }] },
    error: null,
  });

describe('the check-in open is bounded, and a late answer still stamps', () => {
  let restorePlatform: PropertyDescriptor | undefined;
  let restoreAppState: PropertyDescriptor | undefined;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (globalThis as any).__DEV__ = false;
    restorePlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');
    restoreAppState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
    await AsyncStorage.setItem(PARTNER_MAP_KEY, JSON.stringify({
      'partner-home-0': { dbId: 'partner-home', name: 'Home Gym', lat: GYM.lat, lng: GYM.lng, radius: GYM.radius },
    }));
    await AsyncStorage.setItem(PARTNER_MAP_META_KEY, JSON.stringify({ fetchedAt: Date.now() }));
  });

  afterEach(() => {
    jest.useRealTimers();
    if (restorePlatform) Object.defineProperty(Platform, 'OS', restorePlatform);
    if (restoreAppState) Object.defineProperty(AppState, 'currentState', restoreAppState);
  });

  it('completes the check-in inside the bound when the open never answers, then stamps the late id', async () => {
    jest.useFakeTimers();
    let resolveOpen!: (id: string | null) => void;
    mockOpenGymVisit.mockImplementationOnce(() => new Promise<string | null>((r) => { resolveOpen = r; }));

    const run = driveCheckIn();
    await jest.advanceTimersByTimeAsync(CHECK_IN_OPEN_BOUND_MS + 50);
    await run;
    await flush();

    // 1. the session exists and is unstamped, and the deferral is on record
    const before = await readActive();
    expect(before?.regionId).toBe('partner-home-0');
    expect(before?.visitId ?? null).toBeNull();
    expect(regionEvents('check_in_open_deferred')).toHaveLength(1);
    expect(regionEvents('check_in_open_deferred')[0].detail.bound_ms).toBe(CHECK_IN_OPEN_BOUND_MS);

    // 2. the open resolves eventually — same session, now stamped
    resolveOpen('visit-late');
    await jest.advanceTimersByTimeAsync(10);
    await flush();

    const after = await readActive();
    expect(after?.regionId).toBe('partner-home-0');
    expect(after?.entryTimestamp).toBe(before?.entryTimestamp);
    expect(after?.visitId).toBe('visit-late');
  });

  it('stamps immediately and logs no deferral when the open answers in time', async () => {
    mockOpenGymVisit.mockImplementationOnce(async () => 'visit-fast');

    await driveCheckIn();
    await flush();

    const active = await readActive();
    expect(active?.visitId).toBe('visit-fast');
    expect(regionEvents('check_in_open_deferred')).toHaveLength(0);
  });

  // 2026-09-06: the fix that decided the check-in rides the open, so the visit
  // starts with a proof clock. 23 of 77 real iOS sessions in the prior 30 days
  // closed with none, and the beacon's settle refuses a NULL clock — so a phone
  // that never answers a wake was paid only on app-open.
  it('carries the entry fix on the open — distance, accuracy, trust and age, never coordinates', async () => {
    mockOpenGymVisit.mockImplementationOnce(async () => 'visit-fixed');
    const taken = Date.now() - 4_000;

    await mockTasks[LOCATION_TRACKING_TASK]({
      data: { locations: [{ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 20 }, timestamp: taken }] },
      error: null,
    });
    await flush();

    expect(mockOpenGymVisit).toHaveBeenCalledTimes(1);
    const [partnerId, regionId, entryTs, fix] = mockOpenGymVisit.mock.calls[0] as unknown as
      [string, string, number, Record<string, unknown>];
    expect(partnerId).toBe('partner-home');
    expect(regionId).toBe('partner-home-0');
    expect(typeof entryTs).toBe('number');
    expect(fix).toEqual({
      distance_m:  0,
      accuracy_m:  20,
      fix_trusted: true,
      fix_age_s:   expect.any(Number),
    });
    expect((fix.fix_age_s as number)).toBeGreaterThanOrEqual(3);
    expect((fix.fix_age_s as number)).toBeLessThanOrEqual(6);
    expect(Object.keys(fix).sort()).toEqual(['accuracy_m', 'distance_m', 'fix_age_s', 'fix_trusted']);
    expect(regionEvents('visit_open_attempt')[0].detail.fix_carried).toBe(true);
  });
});

describe('buildCheckInFix', () => {
  const gym = { lat: GYM.lat, lng: GYM.lng };

  it('returns null when the check-in had no fix (native enter without a position)', () => {
    expect(buildCheckInFix(gym, undefined)).toBeNull();
  });

  it('marks a coarse fix untrusted so the server never stamps proof from it', () => {
    const fix = buildCheckInFix(gym, { coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 150 } as any, timestamp: 1_000 }, 5_000);
    expect(fix).toMatchObject({ fix_trusted: false, accuracy_m: 150, fix_age_s: 4 });
  });

  it('reports an unknown age as null rather than zero', () => {
    const fix = buildCheckInFix(gym, { coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 10 } as any });
    expect(fix?.fix_age_s).toBeNull();
  });
});

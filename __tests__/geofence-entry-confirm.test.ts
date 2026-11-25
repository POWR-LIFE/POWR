/**
 * The front door (2026-11-25): nearest venue, a fresh slow reading, and a SECOND
 * reading before a visit opens — and a re-entry minutes after a close resumes the
 * visit instead of starting it again.
 *
 * Why. 30 days to 11-25, real members: 41 % of iPhone visits and 75 % of Android
 * visits lasted under two minutes — drive-bys and walk-pasts opened on ONE fix.
 * That fix could be ten minutes old (the wake sweep's cache) or of any age at all
 * (the foreground check), and the venue it opened was the first circle the loop
 * reached, in partner-id order, with 1,614 locations overlapping another. And a
 * false exit split a continuous 52-minute session into 24 + 15½ (11-16): no
 * check-in, no gym credit.
 *
 * The pure rule is pinned in geofence-zone.test.ts. This file drives the REAL
 * stream task, so it pins the wiring: what gets stored, what gets opened, what
 * the server is told, and what the member is (not) notified of.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const LOCATION_TRACKING_TASK = 'POWR_LOCATION_TRACKING';
const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const ENTRY_CANDIDATE_KEY = '@powr/entry_candidate';
const LAST_CLOSED_VISIT_KEY = '@powr/last_closed_visit';
const PARTNER_MAP_KEY = '@powr/partner_map';
const PARTNER_MAP_META_KEY = '@powr/partner_map_meta';

jest.mock('@/lib/taskFinishGuard', () => ({
  defineTask: (name: string, fn: (body: any) => Promise<unknown>) =>
    (jest.requireMock('expo-task-manager') as any).defineTask(name, fn),
}));

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

const mockNotifyCheckIn = jest.fn(async () => 'scheduled');
jest.mock('@/lib/notifications', () => ({
  notifyCheckInAvailable:    (...a: any[]) => (mockNotifyCheckIn as jest.Mock)(...a),
  notifySessionCompleted:    jest.fn().mockResolvedValue(undefined),
  notifySessionUpgraded:     jest.fn().mockResolvedValue(undefined),
  scheduleRewardWithinReach: jest.fn().mockResolvedValue(undefined),
  cancelPendingCheckInBanner: jest.fn().mockResolvedValue('not_pending'),
  clearCheckInCooldown:       jest.fn().mockResolvedValue(undefined),
  CHECK_IN_BANNER_DELAY_S:    75,
}));

const mockLogRegionEvent = jest.fn(async () => {});
const mockOpenGymVisit = jest.fn(async (): Promise<string | null> => 'visit-new');
jest.mock('@/lib/gymVisits', () => ({
  confirmGymVisit:            jest.fn(async () => ({ ok: true, triggered: null })),
  confirmGymVisitViaNonce:    jest.fn(async () => ({ ok: true, triggered: null })),
  openGymVisit:               (...a: any[]) => (mockOpenGymVisit as jest.Mock)(...a),
  closeGymVisit:              jest.fn(async () => true),
  logGymVisitTick:            jest.fn(async () => {}),
  logGymWakeReceived:         jest.fn(async () => {}),
  logGymWakeReceivedViaNonce: jest.fn(async () => {}),
  markGymVisitProgress:       jest.fn(async () => true),
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

import * as Location from 'expo-location';
import { AppState, Platform } from 'react-native';
import { ENTRY_SEEK, finalizeActiveGeofence, resetEntrySeekForTests } from '@/context/GeofenceContext';

const mockLocation = Location as jest.Mocked<typeof Location>;

// ~111,195 m per degree of latitude.
const north = (m: number) => m / 111_195;
const GYM = { lat: 52.1244, lng: -1.764, radius: 25 };
const REGION = 'partner-home-0';
const inside = { latitude: GYM.lat, longitude: GYM.lng, accuracy: 12 };

const driveFix = (coords: Record<string, unknown>, timestamp: number = Date.now()) =>
  mockTasks[LOCATION_TRACKING_TASK]({ data: { locations: [{ coords, timestamp }] }, error: null });

const readJson = async (key: string) => {
  const raw = await AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
};

async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

const events = (event: string) =>
  (mockLogRegionEvent.mock.calls as any[][])
    .filter(([, e]) => e === event)
    .map(([regionId, , detail]) => ({ regionId, detail }));

let restorePlatform: PropertyDescriptor | undefined;
let restoreAppState: PropertyDescriptor | undefined;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetEntrySeekForTests();
  (globalThis as any).__DEV__ = false;
  // Off unless a test is ABOUT the loop: it waits on real timers.
  ENTRY_SEEK.attempts = 0;
  restorePlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');
  restoreAppState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
  mockLocation.getCurrentPositionAsync.mockResolvedValue(null as never);
  mockOpenGymVisit.mockImplementation(async () => 'visit-new');
  await AsyncStorage.setItem(PARTNER_MAP_KEY, JSON.stringify({
    [REGION]: { dbId: 'partner-home', name: 'Home Gym', lat: GYM.lat, lng: GYM.lng, radius: GYM.radius },
  }));
  await AsyncStorage.setItem(PARTNER_MAP_META_KEY, JSON.stringify({ fetchedAt: Date.now() }));
});

afterEach(() => {
  jest.useRealTimers();
  ENTRY_SEEK.attempts = 3;
  (globalThis as any).__DEV__ = true;
  if (restorePlatform) Object.defineProperty(Platform, 'OS', restorePlatform);
  if (restoreAppState) Object.defineProperty(AppState, 'currentState', restoreAppState);
});

describe('one reading is a candidate, two are a visit', () => {
  it('a single inside reading opens nothing and tells nobody', async () => {
    await driveFix(inside);
    await flush();

    expect(await readJson(ACTIVE_GEOFENCE_KEY)).toBeNull();
    expect(mockOpenGymVisit).not.toHaveBeenCalled();
    expect(mockNotifyCheckIn).not.toHaveBeenCalled();
    expect(await readJson(ENTRY_CANDIDATE_KEY)).toMatchObject({ regionId: REGION, readings: 1 });
    expect(events('entry_candidate')[0]).toMatchObject({ regionId: REGION, detail: { outcome: 'first', via: 'stream' } });
  });

  it('a second reading 40 s later opens the visit, backdated to the first', async () => {
    const t0 = Date.now() - 40_000;
    await driveFix(inside, t0);
    await driveFix(inside, Date.now());
    await flush();

    const active = await readJson(ACTIVE_GEOFENCE_KEY);
    expect(active).toMatchObject({ partnerId: 'partner-home', regionId: REGION });
    expect(active.entryTimestamp).toBe(t0);
    expect(await readJson(ENTRY_CANDIDATE_KEY)).toBeNull();
    expect(mockNotifyCheckIn).toHaveBeenCalledWith('Home Gym', REGION);
    // The server is told the same start, so its dwell clock agrees with the phone's.
    expect((mockOpenGymVisit.mock.calls[0] as unknown[])[2]).toBe(t0);
    expect(events('entry_candidate').map(e => e.detail.outcome)).toEqual(['first', 'confirmed']);
  });

  it('a second reading only 10 s later is still waiting', async () => {
    await driveFix(inside, Date.now() - 10_000);
    await driveFix(inside, Date.now());

    expect(await readJson(ACTIVE_GEOFENCE_KEY)).toBeNull();
    expect(await readJson(ENTRY_CANDIDATE_KEY)).toMatchObject({ regionId: REGION, readings: 2 });
  });

  it('a reading that describes five minutes ago is refused and stores nothing', async () => {
    await driveFix(inside, Date.now() - 5 * 60_000);
    await flush();

    expect(await readJson(ACTIVE_GEOFENCE_KEY)).toBeNull();
    expect(await readJson(ENTRY_CANDIDATE_KEY)).toBeNull();
    expect(events('entry_rejected')[0]).toMatchObject({ regionId: REGION, detail: { reason: 'stale' } });
  });

  it('a reading taken at 30 mph is refused — a car clipping the circle is not an arrival', async () => {
    await driveFix({ ...inside, speed: 13.4 }, Date.now() - 40_000);
    await driveFix({ ...inside, speed: 13.4 }, Date.now());
    await flush();

    expect(await readJson(ACTIVE_GEOFENCE_KEY)).toBeNull();
    expect(await readJson(ENTRY_CANDIDATE_KEY)).toBeNull();
    expect(events('entry_rejected')[0].detail).toMatchObject({ reason: 'too_fast', speed_mps: 13.4 });
  });

  it('a first reading is dropped when the next fix is clearly somewhere else', async () => {
    await driveFix(inside, Date.now() - 40_000);
    await driveFix({ latitude: GYM.lat + north(400), longitude: GYM.lng, accuracy: 10 }, Date.now());
    await flush();

    expect(await readJson(ENTRY_CANDIDATE_KEY)).toBeNull();
    expect(await readJson(ACTIVE_GEOFENCE_KEY)).toBeNull();
    expect(events('entry_candidate').map(e => e.detail.outcome)).toEqual(['first', 'left']);
  });

  it('a first reading survives a wobble just outside the circle', async () => {
    await driveFix(inside, Date.now() - 50_000);
    // 40 m out: outside the 25 m circle, well short of the exit bound.
    await driveFix({ latitude: GYM.lat + north(40), longitude: GYM.lng, accuracy: 10 }, Date.now() - 20_000);
    expect(await readJson(ENTRY_CANDIDATE_KEY)).toMatchObject({ regionId: REGION });
    await driveFix(inside, Date.now());

    expect(await readJson(ACTIVE_GEOFENCE_KEY)).toMatchObject({ regionId: REGION });
  });
});

describe('the nearest venue wins', () => {
  it('checks in to the nearer of two overlapping gyms, not the first in the map', async () => {
    // A second gym 30 m north whose circle overlaps. The map lists the FAR one first.
    await AsyncStorage.setItem(PARTNER_MAP_KEY, JSON.stringify({
      [REGION]:        { dbId: 'partner-home', name: 'Home Gym', lat: GYM.lat, lng: GYM.lng, radius: 25 },
      'partner-next-0': { dbId: 'partner-next', name: 'Next Door', lat: GYM.lat + north(30), lng: GYM.lng, radius: 25 },
    }));
    await AsyncStorage.setItem(PARTNER_MAP_META_KEY, JSON.stringify({ fetchedAt: Date.now() + 1 }));
    // 22 m north of Home Gym = 8 m from Next Door, inside both circles.
    const fix = { latitude: GYM.lat + north(22), longitude: GYM.lng, accuracy: 6 };

    await driveFix(fix, Date.now() - 40_000);
    await driveFix(fix, Date.now());

    expect(await readJson(ACTIVE_GEOFENCE_KEY)).toMatchObject({ partnerId: 'partner-next', regionId: 'partner-next-0' });
  });
});

describe('the engine goes and gets the second reading', () => {
  it('waits out the gap, takes a fresh fix and checks in — no second stream fix required', async () => {
    // A member who walks in and stands still: the displacement-gated stream
    // delivers nothing more, so a first reading left to wait would wait forever.
    jest.useFakeTimers();
    ENTRY_SEEK.attempts = 1;
    mockLocation.getCurrentPositionAsync.mockImplementation(async () => ({
      coords: inside, timestamp: Date.now(),
    }) as never);

    const first = driveFix(inside, Date.now());
    await jest.advanceTimersByTimeAsync(20_000);
    expect(await readJson(ACTIVE_GEOFENCE_KEY)).toBeNull();   // still inside the gap
    await jest.advanceTimersByTimeAsync(15_000);
    await first;

    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalled();
    expect(await readJson(ACTIVE_GEOFENCE_KEY)).toMatchObject({ regionId: REGION });
    expect(events('entry_candidate').map(e => e.detail)).toEqual([
      expect.objectContaining({ outcome: 'first', via: 'stream' }),
      expect.objectContaining({ outcome: 'confirmed', via: 'confirm' }),
    ]);
  });

  it('leaves the first reading stored when no fix can be had', async () => {
    jest.useFakeTimers();
    ENTRY_SEEK.attempts = 1;
    mockLocation.getCurrentPositionAsync.mockResolvedValue(null as never);

    const first = driveFix(inside, Date.now());
    await jest.advanceTimersByTimeAsync(60_000);
    await first;

    expect(await readJson(ACTIVE_GEOFENCE_KEY)).toBeNull();
    expect(await readJson(ENTRY_CANDIDATE_KEY)).toMatchObject({ regionId: REGION });
  });
});

describe('a coarse fix near a venue earns one precise reading', () => {
  it('re-reads at high accuracy instead of discarding, and that reading goes through the front door', async () => {
    // Android's modal fix: exactly 100 m, right on top of the pin.
    mockLocation.getCurrentPositionAsync.mockImplementation(async () => ({
      coords: { ...inside, accuracy: 9 }, timestamp: Date.now(),
    }) as never);

    await driveFix({ ...inside, accuracy: 100 });
    await flush();

    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 4 }); // High
    expect(await readJson(ENTRY_CANDIDATE_KEY)).toMatchObject({ regionId: REGION, readings: 1 });
    expect(events('entry_candidate')[0].detail).toMatchObject({ outcome: 'first', via: 'precise', acc_m: 9 });
  });

  it('does not wake the GPS for a coarse fix nowhere near a venue', async () => {
    await driveFix({ latitude: GYM.lat + north(5_000), longitude: GYM.lng, accuracy: 100 });
    await flush();

    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('is throttled — a stream of coarse fixes costs one precise read a minute, not one each', async () => {
    mockLocation.getCurrentPositionAsync.mockResolvedValue(null as never);

    await driveFix({ ...inside, accuracy: 100 });
    await driveFix({ ...inside, accuracy: 100 });
    await driveFix({ ...inside, accuracy: 100 });

    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  });
});

describe('a re-entry minutes after a close resumes the visit', () => {
  const min = 60_000;

  it('finalize remembers what just ended', async () => {
    const entry = Date.now() - 24 * min;
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
      partnerId: 'partner-home', partnerName: 'Home Gym', regionId: REGION, entryTimestamp: entry,
      latitude: GYM.lat, longitude: GYM.lng, radius: 25, visitId: 'visit-1', userId: 'user-1',
    }));

    await finalizeActiveGeofence();

    expect(await readJson(ACTIVE_GEOFENCE_KEY)).toBeNull();
    const closed = await readJson(LAST_CLOSED_VISIT_KEY);
    expect(closed).toMatchObject({ partnerId: 'partner-home', entryTimestamp: entry, visitId: 'visit-1' });
    expect(closed.endedAtMs).toBeGreaterThanOrEqual(entry + 24 * min);
  });

  it('the 2026-11-16 shape: 24 minutes, a false exit, back 12 minutes later', async () => {
    const now = Date.now();
    await AsyncStorage.setItem(LAST_CLOSED_VISIT_KEY, JSON.stringify({
      partnerId: 'partner-home', regionId: REGION, visitId: 'visit-1', userId: null,
      entryTimestamp: now - 36 * min, endedAtMs: now - 12 * min,
    }));

    const first = now - 40_000;
    await driveFix(inside, first);
    await driveFix(inside, Date.now());
    await flush();

    const active = await readJson(ACTIVE_GEOFENCE_KEY);
    // Time away = first reading − close = 12 min − 40 s. The old start moves
    // forward by exactly that, so the visit is 24 minutes old, not zero.
    const gap = first - (now - 12 * min);
    expect(active.entryTimestamp).toBe(now - 36 * min + gap);
    expect(Math.round((first - active.entryTimestamp) / min)).toBe(24);
    expect(active.resumeOf).toBe('visit-1');
    // The server is asked to re-open THAT visit, at the same shifted start.
    const call = mockOpenGymVisit.mock.calls[0] as unknown[];
    expect(call[2]).toBe(active.entryTimestamp);
    expect(call[4]).toBe('visit-1');
    // Already told once — no second "You're in".
    expect(mockNotifyCheckIn).not.toHaveBeenCalled();
    expect(events('visit_resumed')[0].detail).toMatchObject({ visit: 'visit-1', prior_min: 24 });
    // One use: the snapshot is gone.
    expect(await readJson(LAST_CLOSED_VISIT_KEY)).toBeNull();
  });

  it('carries what the first leg had already earned, so nothing is claimed twice', async () => {
    const now = Date.now();
    await AsyncStorage.setItem(LAST_CLOSED_VISIT_KEY, JSON.stringify({
      partnerId: 'partner-home', regionId: REGION, visitId: 'visit-1', userId: null,
      entryTimestamp: now - 35 * min, endedAtMs: now - 3 * min,
      sessionRecorded: true, sessionId: 'session-1', tierUpgraded: false,
    }));

    await driveFix(inside, now - 40_000);
    await driveFix(inside, Date.now());

    expect(await readJson(ACTIVE_GEOFENCE_KEY)).toMatchObject({
      sessionRecorded: true, sessionId: 'session-1', tierUpgraded: false, resumeOf: 'visit-1',
    });
  });

  it('is a NEW visit twenty minutes later, and the stale snapshot is cleared', async () => {
    const now = Date.now();
    await AsyncStorage.setItem(LAST_CLOSED_VISIT_KEY, JSON.stringify({
      partnerId: 'partner-home', regionId: REGION, visitId: 'visit-1', userId: null,
      entryTimestamp: now - 60 * min, endedAtMs: now - 20 * min,
    }));

    const first = now - 40_000;
    await driveFix(inside, first);
    await driveFix(inside, Date.now());

    const active = await readJson(ACTIVE_GEOFENCE_KEY);
    expect(active.entryTimestamp).toBe(first);
    expect(active.resumeOf).toBeUndefined();
    expect(mockNotifyCheckIn).toHaveBeenCalled();
    expect((mockOpenGymVisit.mock.calls[0] as unknown[])[4]).toBeNull();
    expect(await readJson(LAST_CLOSED_VISIT_KEY)).toBeNull();
  });

  it('never resumes a visit at a different venue', async () => {
    const now = Date.now();
    await AsyncStorage.setItem(LAST_CLOSED_VISIT_KEY, JSON.stringify({
      partnerId: 'partner-other', regionId: 'partner-other-0', visitId: 'visit-9', userId: null,
      entryTimestamp: now - 30 * min, endedAtMs: now - 2 * min,
    }));

    await driveFix(inside, now - 40_000);
    await driveFix(inside, Date.now());

    expect((await readJson(ACTIVE_GEOFENCE_KEY)).resumeOf).toBeUndefined();
  });
});

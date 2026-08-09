/**
 * Pins the location-off session close (2026-08-09).
 *
 * A session and the location permission feeding it are one mechanism. Turn
 * location off mid-visit and the dwell stream stops delivering fixes, ticks stop
 * advancing, no EXIT can ever fire — the visit stayed open until the 12 h server
 * reaper (which duplicates the visit on Android) and its duration tracked the
 * wall clock until then. That is the 12-hour-row failure mode.
 *
 * What must never regress:
 *  1. Every way location can go away closes the session: revoked, downgraded to
 *     "While Using" (geofencing is dead), or Services off device-wide.
 *  2. It ends at the last PROVEN-inside moment (VISIT_TICK_KEY), never at
 *     discovery — this runs on foreground, potentially hours late.
 *  3. It TRUNCATES, it does not VOID: an already-earned session still reaches
 *     the claim path with the truncated duration.
 *  4. It fails CLOSED. A transient native error must never end a real session.
 *  5. It announces the outcome, and the banner names the fix, not the points.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const VISIT_TICK_KEY = '@powr/last_visit_tick';
const PENDING_CLAIMS_KEY = '@powr/pending_claims';

jest.mock('expo-task-manager', () => {
  const registry: Record<string, (body: unknown) => Promise<unknown>> = {};
  return {
    __registry: registry,
    defineTask: jest.fn((name: string, fn: (body: unknown) => Promise<unknown>) => { registry[name] = fn; }),
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
  hasServicesEnabledAsync: jest.fn().mockResolvedValue(true),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
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

const mockNotifyLocationOff = jest.fn(async (..._args: unknown[]) => {});
jest.mock('@/lib/notifications', () => ({
  notifyCheckInAvailable: jest.fn().mockResolvedValue(true),
  notifySessionCompleted: jest.fn().mockResolvedValue(undefined),
  notifySessionUpgraded: jest.fn().mockResolvedValue(undefined),
  notifyLocationOffSessionEnded: (...args: unknown[]) => mockNotifyLocationOff(...args),
  scheduleRewardWithinReach: jest.fn().mockResolvedValue(undefined),
}));

const mockCloseGymVisit = jest.fn(async (..._args: unknown[]) => true);
const mockLogRegionEvent = jest.fn(async (..._args: unknown[]) => {});
jest.mock('@/lib/gymVisits', () => ({
  closeGymVisit: (...args: unknown[]) => mockCloseGymVisit(...args),
  openGymVisit: jest.fn(async () => null),
  confirmGymVisit: jest.fn(async () => null),
  confirmGymVisitViaNonce: jest.fn(async () => null),
  logGymWakeReceived: jest.fn(async () => {}),
  logGymWakeReceivedViaNonce: jest.fn(async () => {}),
  logGeofenceRegionEvent: (...args: unknown[]) => mockLogRegionEvent(...args),
}));

jest.mock('@/lib/authFresh', () => ({
  ensureFreshSession: jest.fn(async () => null),
  callWithAuthRetry: jest.fn(async (factory: () => Promise<unknown>) => factory()),
}));

jest.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://test-ref.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-123',
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-1', email: 'test@example.com' } } },
        error: null,
      }),
    },
    from: () => {
      const builder: Record<string, unknown> = {
        then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r),
      };
      ['select', 'insert', 'update', 'eq', 'gte', 'order', 'limit'].forEach(m => {
        builder[m] = jest.fn(() => builder);
      });
      builder.single = jest.fn(async () => ({ data: null, error: null }));
      builder.maybeSingle = jest.fn(async () => ({ data: null, error: null }));
      return builder;
    },
    rpc: jest.fn(async () => ({ data: null, error: null })),
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
  },
}));

import { finalizeSessionIfLocationRevoked } from '@/context/GeofenceContext';

const mockLocation = Location as jest.Mocked<typeof Location>;

const GYM = { latitude: 52.1244, longitude: -1.764, radius: 25 };

function seedActive(overrides: Record<string, unknown> = {}) {
  return AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
    partnerId: 'partner-1',
    partnerName: 'Home Gym',
    regionId: 'partner-1-0',
    entryTimestamp: Date.now() - 90 * 60_000,
    visitId: 'v-revoked',
    userId: 'user-1',
    ...GYM,
    ...overrides,
  }));
}

/** Location on, permission 'always' — the healthy baseline. Resets call history
 *  too, so "never even asked" assertions cannot be satisfied by a previous test. */
function locationHealthy() {
  mockLocation.hasServicesEnabledAsync.mockReset().mockResolvedValue(true);
  mockLocation.getForegroundPermissionsAsync.mockReset().mockResolvedValue({ status: 'granted' } as never);
  mockLocation.getBackgroundPermissionsAsync.mockReset().mockResolvedValue({ status: 'granted' } as never);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCloseGymVisit.mockClear().mockResolvedValue(true);
  mockNotifyLocationOff.mockClear();
  mockLogRegionEvent.mockClear();
  locationHealthy();
});

describe('finalizeSessionIfLocationRevoked', () => {
  it('closes the session at the last proven-inside tick, not at discovery time', async () => {
    // Entered 90 min ago, last proved inside 60 min ago, only noticed now.
    const tickAt = Date.now() - 60 * 60_000;
    await seedActive();
    await AsyncStorage.setItem(VISIT_TICK_KEY, String(tickAt));
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);

    expect(await finalizeSessionIfLocationRevoked()).toBe(true);

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).toBeNull();
    // THE bound. Closing at `now` would bank 60 unwitnessed minutes into the very
    // row we are closing because it can no longer be witnessed.
    expect(mockCloseGymVisit).toHaveBeenCalledWith('v-revoked', tickAt);
  });

  it('closes when the permission is downgraded to While Using — geofencing is dead', async () => {
    const tickAt = Date.now() - 40 * 60_000;
    await seedActive();
    await AsyncStorage.setItem(VISIT_TICK_KEY, String(tickAt));
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);

    expect(await finalizeSessionIfLocationRevoked()).toBe(true);
    expect(mockCloseGymVisit).toHaveBeenCalledWith('v-revoked', tickAt);
    expect(mockLogRegionEvent).toHaveBeenCalledWith(
      'partner-1-0', 'location_revoked', expect.objectContaining({ reason: 'permission_downgraded' }),
    );
  });

  it('closes when Location Services are switched off device-wide', async () => {
    const tickAt = Date.now() - 40 * 60_000;
    await seedActive();
    await AsyncStorage.setItem(VISIT_TICK_KEY, String(tickAt));
    mockLocation.hasServicesEnabledAsync.mockResolvedValue(false);

    expect(await finalizeSessionIfLocationRevoked()).toBe(true);
    expect(mockCloseGymVisit).toHaveBeenCalledWith('v-revoked', tickAt);
    expect(mockLogRegionEvent).toHaveBeenCalledWith(
      'partner-1-0', 'location_revoked', expect.objectContaining({ reason: 'services_disabled' }),
    );
  });

  it('truncates but does not void — an earned session still reaches the claim path', async () => {
    // 45 min of witnessed dwell: past the 30-min threshold, so the claim is owed.
    const entryAt = Date.now() - 90 * 60_000;
    const tickAt = entryAt + 45 * 60_000;
    await seedActive({ entryTimestamp: entryAt });
    await AsyncStorage.setItem(VISIT_TICK_KEY, String(tickAt));
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);

    expect(await finalizeSessionIfLocationRevoked()).toBe(true);

    const queued = JSON.parse((await AsyncStorage.getItem(PENDING_CLAIMS_KEY)) ?? '[]');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ visitId: 'v-revoked', endedAtMs: tickAt });
  });

  it('ends at entry when no tick was ever written — one proven instant, nothing more', async () => {
    const entryAt = Date.now() - 20 * 60_000;
    await seedActive({ entryTimestamp: entryAt, visitId: 'v-no-tick' });
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);

    expect(await finalizeSessionIfLocationRevoked()).toBe(true);

    expect(mockCloseGymVisit).toHaveBeenCalledWith('v-no-tick', entryAt);
    // Zero witnessed dwell is below the threshold, so nothing is claimed.
    expect(await AsyncStorage.getItem(PENDING_CLAIMS_KEY)).toBeNull();
  });

  it('announces the outcome, naming the gym and never the points', async () => {
    await seedActive();
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);

    await finalizeSessionIfLocationRevoked();

    expect(mockNotifyLocationOff).toHaveBeenCalledWith('Home Gym', 'v-revoked');
  });

  it('announces BEFORE the network — the banner survives a close that never settles', async () => {
    // The background-freeze class: on a wake, closeGymVisit/openGymVisit/the claim
    // are frames this codebase has repeatedly seen hang forever. A banner queued
    // after them is lost exactly on the sweep path, where the user has least idea
    // anything happened.
    await seedActive();
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
    let release: ((v: boolean) => void) | undefined;
    mockCloseGymVisit.mockImplementation(() => new Promise<boolean>(r => { release = r; }));

    const pending = finalizeSessionIfLocationRevoked();
    await new Promise(resolve => setImmediate(resolve)); // drain microtasks; the close still hangs

    expect(mockCloseGymVisit).toHaveBeenCalled();
    expect(mockNotifyLocationOff).toHaveBeenCalledWith('Home Gym', 'v-revoked');

    release?.(true); // let it settle so the re-entrancy lease is released
    await pending;
  });

  it('leaves a healthy session completely alone', async () => {
    await seedActive();

    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
    expect(mockNotifyLocationOff).not.toHaveBeenCalled();
  });

  it('fails CLOSED — a throwing permission read never ends a real session', async () => {
    await seedActive();
    mockLocation.hasServicesEnabledAsync.mockRejectedValue(new Error('native bridge died'));

    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
  });

  it('fails CLOSED when the permission read itself errors, not just Services', async () => {
    await seedActive();
    mockLocation.getForegroundPermissionsAsync.mockRejectedValue(new Error('nope'));

    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
  });

  it('is a no-op with no session — and never even asks about permissions', async () => {
    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(mockLocation.hasServicesEnabledAsync).not.toHaveBeenCalled();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
  });
});

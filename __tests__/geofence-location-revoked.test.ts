/**
 * Pins the location-off session close (2026-08-09) and the staging that guards it.
 *
 * A session and the location permission feeding it are one mechanism. Turn
 * location off mid-visit and the dwell stream stops delivering fixes, ticks stop
 * advancing, no EXIT can ever fire — the visit stayed open until the 12 h server
 * reaper (which duplicates the visit on Android) and its duration tracked the
 * wall clock until then. That is the 12-hour-row failure mode.
 *
 * But this is the first thing in the geofence that ENDS a session on evidence the
 * user never sees, so more than half of these tests are about NOT acting:
 *
 *  1. Every way location can go away closes the session: revoked, downgraded to
 *     "While Using" (geofencing is dead), or Services off device-wide.
 *  2. It ends at the last PROVEN-inside moment (VISIT_TICK_KEY), never at
 *     discovery — this runs on foreground, potentially hours late.
 *  3. It TRUNCATES, it does not VOID: an already-earned session still reaches
 *     the claim path with the truncated duration.
 *  4. ⚠ TWO sightings, spaced in time, before anything ends. One read is not
 *     evidence — cold launch is exactly when a native read is least reliable.
 *  5. ⚠ 'undetermined' is NOT 'denied'. It means the read did not answer.
 *  6. It fails CLOSED everywhere. A transient error never ends a real session.
 *  7. The rollout flag is obeyed: 'off' does nothing, 'observe' logs its verdict
 *     and closes nothing, only 'on' acts.
 *  8. It announces the outcome before the network, never after.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const VISIT_TICK_KEY = '@powr/last_visit_tick';
const PENDING_CLAIMS_KEY = '@powr/pending_claims';
const LOCATION_LOSS_KEY = '@powr/location_loss_pending';
const CONFIRM_MS = 3 * 60 * 1000;

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

// Mutable so each test can pick its rollout stage. `mock`-prefixed so the jest
// factory below may close over it.
let mockCloseMode: 'off' | 'observe' | 'on' = 'on';
jest.mock('@/lib/gymDwellConfig', () => ({
  getGymDwellMinutes: () => 30,
  getGymUpgradeMinutes: () => 40,
  getLocationCloseMode: () => mockCloseMode,
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

const revokePermission = () =>
  mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);

/** Age the pending marker so the NEXT call sees a loss that has persisted past
 *  the confirmation window — the second of the two required sightings. */
async function ageMarkerPastConfirmWindow() {
  const raw = await AsyncStorage.getItem(LOCATION_LOSS_KEY);
  if (!raw) throw new Error('expected a pending marker to age');
  const marker = JSON.parse(raw);
  marker.firstSeenAtMs -= CONFIRM_MS + 1_000;
  await AsyncStorage.setItem(LOCATION_LOSS_KEY, JSON.stringify(marker));
}

/** Drive the detector to a confirmed verdict: sighting, wait, sighting. */
async function confirmLoss(): Promise<boolean> {
  await finalizeSessionIfLocationRevoked();
  await ageMarkerPastConfirmWindow();
  return finalizeSessionIfLocationRevoked();
}

const revokedRows = () => mockLogRegionEvent.mock.calls.filter(c => c[1] === 'location_revoked');

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCloseGymVisit.mockClear().mockResolvedValue(true);
  mockNotifyLocationOff.mockClear();
  mockLogRegionEvent.mockClear();
  mockCloseMode = 'on';
  locationHealthy();
});

describe('confirmation — two sightings, never one', () => {
  it('does NOT close on the first sighting; it records a marker and waits', async () => {
    await seedActive();
    revokePermission();

    expect(await finalizeSessionIfLocationRevoked()).toBe(false);

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
    expect(mockNotifyLocationOff).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(LOCATION_LOSS_KEY)).not.toBeNull();
  });

  it('does NOT close while the loss is younger than the confirmation window', async () => {
    await seedActive();
    revokePermission();

    await finalizeSessionIfLocationRevoked();
    expect(await finalizeSessionIfLocationRevoked()).toBe(false); // immediately again

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
  });

  it('closes once the loss has persisted across the window', async () => {
    await seedActive();
    revokePermission();

    expect(await confirmLoss()).toBe(true);
    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).toBeNull();
  });

  it('location recovering wipes the marker, so a blip can never combine into a verdict', async () => {
    await seedActive();
    revokePermission();
    await finalizeSessionIfLocationRevoked();          // sighting 1
    expect(await AsyncStorage.getItem(LOCATION_LOSS_KEY)).not.toBeNull();

    locationHealthy();                                  // the blip passes
    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(await AsyncStorage.getItem(LOCATION_LOSS_KEY)).toBeNull();

    // A fresh loss now starts from zero rather than inheriting the old timestamp.
    revokePermission();
    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
  });

  it('a marker from a previous session cannot condemn the current one', async () => {
    // Marker left behind by an older session, already well past the window.
    await AsyncStorage.setItem(LOCATION_LOSS_KEY, JSON.stringify({
      reason: 'permission_denied',
      firstSeenAtMs: Date.now() - 60 * 60_000,
      entryTimestamp: Date.now() - 5 * 60 * 60_000, // a different session
    }));
    await seedActive();
    revokePermission();

    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
  });
});

describe('rollout flag', () => {
  it("'off' is a true kill switch — it does not even look at the session", async () => {
    mockCloseMode = 'off';
    await seedActive();
    revokePermission();

    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(await AsyncStorage.getItem(LOCATION_LOSS_KEY)).toBeNull();
    expect(mockLocation.hasServicesEnabledAsync).not.toHaveBeenCalled();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
  });

  it("'observe' reaches a verdict, logs it, and closes NOTHING", async () => {
    mockCloseMode = 'observe';
    await seedActive();
    revokePermission();

    expect(await confirmLoss()).toBe(false);

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
    expect(mockNotifyLocationOff).not.toHaveBeenCalled();
    expect(revokedRows()).toHaveLength(1);
    expect(revokedRows()[0][2]).toMatchObject({
      mode: 'observe',
      would_close: true,
      closed: false,
      reason: 'permission_denied',
    });
  });

  it("'observe' logs its verdict ONCE, not once per sweep", async () => {
    mockCloseMode = 'observe';
    await seedActive();
    revokePermission();

    await confirmLoss();
    await finalizeSessionIfLocationRevoked();
    await finalizeSessionIfLocationRevoked();

    // Otherwise the counts would measure sweep cadence, not incidence.
    expect(revokedRows()).toHaveLength(1);
  });

  it("'on' records that it actually closed", async () => {
    await seedActive();
    revokePermission();

    await confirmLoss();

    expect(revokedRows()[0][2]).toMatchObject({ mode: 'on', would_close: true, closed: true });
  });
});

describe('what counts as a loss', () => {
  it('closes at the last proven-inside tick, not at discovery time', async () => {
    // Entered 90 min ago, last proved inside 60 min ago, only noticed now.
    const tickAt = Date.now() - 60 * 60_000;
    await seedActive();
    await AsyncStorage.setItem(VISIT_TICK_KEY, String(tickAt));
    revokePermission();

    expect(await confirmLoss()).toBe(true);

    // THE bound. Closing at `now` would bank 60 unwitnessed minutes into the very
    // row we are closing because it can no longer be witnessed.
    expect(mockCloseGymVisit).toHaveBeenCalledWith('v-revoked', tickAt);
  });

  it('closes when the permission is downgraded to While Using — geofencing is dead', async () => {
    const tickAt = Date.now() - 40 * 60_000;
    await seedActive();
    await AsyncStorage.setItem(VISIT_TICK_KEY, String(tickAt));
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);

    expect(await confirmLoss()).toBe(true);
    expect(mockCloseGymVisit).toHaveBeenCalledWith('v-revoked', tickAt);
    expect(revokedRows()[0][2]).toMatchObject({ reason: 'permission_downgraded' });
  });

  it('closes when Location Services are switched off device-wide', async () => {
    const tickAt = Date.now() - 40 * 60_000;
    await seedActive();
    await AsyncStorage.setItem(VISIT_TICK_KEY, String(tickAt));
    mockLocation.hasServicesEnabledAsync.mockResolvedValue(false);

    expect(await confirmLoss()).toBe(true);
    expect(revokedRows()[0][2]).toMatchObject({ reason: 'services_disabled' });
  });

  it('⚠ NEVER closes on `undetermined` — that is an unanswered read, not a revocation', async () => {
    // The cold-launch false-close: iOS can report .notDetermined before its
    // location manager has initialised, which is exactly when the mount check runs.
    await seedActive();
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);

    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(await AsyncStorage.getItem(LOCATION_LOSS_KEY)).toBeNull(); // not even a marker
    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
  });
});

describe('honesty of the close', () => {
  it('truncates but does not void — an earned session still reaches the claim path', async () => {
    // 45 min of witnessed dwell: past the 30-min threshold, so the claim is owed.
    const entryAt = Date.now() - 90 * 60_000;
    const tickAt = entryAt + 45 * 60_000;
    await seedActive({ entryTimestamp: entryAt });
    await AsyncStorage.setItem(VISIT_TICK_KEY, String(tickAt));
    revokePermission();

    expect(await confirmLoss()).toBe(true);

    const queued = JSON.parse((await AsyncStorage.getItem(PENDING_CLAIMS_KEY)) ?? '[]');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ visitId: 'v-revoked', endedAtMs: tickAt });
  });

  it('ends at entry when no tick was ever written — one proven instant, nothing more', async () => {
    const entryAt = Date.now() - 20 * 60_000;
    await seedActive({ entryTimestamp: entryAt, visitId: 'v-no-tick' });
    revokePermission();

    expect(await confirmLoss()).toBe(true);

    expect(mockCloseGymVisit).toHaveBeenCalledWith('v-no-tick', entryAt);
    // Zero witnessed dwell is below the threshold, so nothing is claimed.
    expect(await AsyncStorage.getItem(PENDING_CLAIMS_KEY)).toBeNull();
  });

  it('announces the outcome, naming the gym and never the points', async () => {
    await seedActive();
    revokePermission();

    await confirmLoss();

    expect(mockNotifyLocationOff).toHaveBeenCalledWith('Home Gym', 'v-revoked');
  });

  it('announces BEFORE the network — the banner survives a close that never settles', async () => {
    // The background-freeze class: on a wake, closeGymVisit/openGymVisit/the claim
    // are frames this codebase has repeatedly seen hang forever. A banner queued
    // after them is lost exactly on the sweep path, where the user has least idea
    // anything happened.
    await seedActive();
    revokePermission();
    let release: ((v: boolean) => void) | undefined;
    mockCloseGymVisit.mockImplementation(() => new Promise<boolean>(r => { release = r; }));

    await finalizeSessionIfLocationRevoked();
    await ageMarkerPastConfirmWindow();
    const pending = finalizeSessionIfLocationRevoked();
    await new Promise(resolve => setImmediate(resolve)); // drain microtasks; the close still hangs

    expect(mockCloseGymVisit).toHaveBeenCalled();
    expect(mockNotifyLocationOff).toHaveBeenCalledWith('Home Gym', 'v-revoked');

    release?.(true); // let it settle so the re-entrancy lease is released
    await pending;
  });
});

describe('failing closed', () => {
  it('leaves a healthy session completely alone', async () => {
    await seedActive();

    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
    expect(mockNotifyLocationOff).not.toHaveBeenCalled();
  });

  it('a throwing Services read never ends a real session', async () => {
    await seedActive();
    mockLocation.hasServicesEnabledAsync.mockRejectedValue(new Error('native bridge died'));

    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(await AsyncStorage.getItem(LOCATION_LOSS_KEY)).toBeNull();
  });

  it('a throwing permission read never ends a real session', async () => {
    await seedActive();
    mockLocation.getForegroundPermissionsAsync.mockRejectedValue(new Error('nope'));

    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
  });

  it('is a no-op with no session, and clears any stale marker', async () => {
    await AsyncStorage.setItem(LOCATION_LOSS_KEY, JSON.stringify({
      reason: 'permission_denied', firstSeenAtMs: Date.now() - 60 * 60_000, entryTimestamp: 1,
    }));

    expect(await finalizeSessionIfLocationRevoked()).toBe(false);
    expect(await AsyncStorage.getItem(LOCATION_LOSS_KEY)).toBeNull();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
  });
});

/**
 * The LOCAL 12 h backstop (2026-11-14).
 *
 * Field 2026-11-12→14: an Android user ~6 m from a partner gym, every fix ±100 m.
 * Coarse fixes skip the exit geometry by design, the sweep closes only on an
 * unambiguous outside fix, and the visit id was never stamped — so the session
 * lived 34 hours and every 5-min stream tick re-ran the late-open with the dead
 * entry: 283 open_gym_visit calls, each answered `stale_entry_replayed`.
 *
 *  1. Past MAX_GYM_SESSION_SEC the session is finalized — from the stream fix
 *     (the coarse branch is the one that kept it alive) and from the sweep.
 *  2. ⚠ The stream tick no longer late-opens a dead entry.
 *  3. It ends at the last PROVEN-inside moment, never at discovery, and an
 *     earned session still reaches the claim path.
 *  4. Inside the backstop, nothing changes.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const LOCATION_TRACKING_TASK = 'POWR_LOCATION_TRACKING';
const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const VISIT_TICK_KEY = '@powr/last_visit_tick';
const PENDING_CLAIMS_KEY = '@powr/pending_claims';
const LAST_WAKE_AT_KEY = '@powr/last_wake_processed_at';
const HOUR = 60 * 60_000;

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

const mockOpenGymVisit = jest.fn(async (..._args: unknown[]) => null as string | null);
const mockCloseGymVisit = jest.fn(async (..._args: unknown[]) => true);
const mockLogRegionEvent = jest.fn(async (..._args: unknown[]) => {});
jest.mock('@/lib/gymVisits', () => ({
  closeGymVisit: (...args: unknown[]) => mockCloseGymVisit(...args),
  openGymVisit: (...args: unknown[]) => mockOpenGymVisit(...args),
  logGymVisitTick: jest.fn(async () => {}),
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

import {
  resetSelfPollThrottleForTests,
  resetVisitTickThrottleForTests,
  sweepForMissedCheckInFromWake,
} from '@/context/GeofenceContext';

const mockTasks = (jest.requireMock('expo-task-manager') as { __registry: Record<string, (b: unknown) => Promise<unknown>> }).__registry;

const GYM = { latitude: 51.4014, longitude: -1.3231, radius: 25 };

function seedActive(overrides: Record<string, unknown> = {}) {
  return AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
    partnerId: 'partner-1',
    partnerName: 'Next Door Gym',
    regionId: 'partner-1-0',
    entryTimestamp: Date.now() - 34 * HOUR,
    userId: 'user-1',
    ...GYM,
    ...overrides,
  }));
}

/** The field fix: 6 m from the gym, reporting the ±100 m sentinel. */
const driveCoarseFix = () => mockTasks[LOCATION_TRACKING_TASK]({
  data: { locations: [{
    coords: { latitude: GYM.latitude + 0.00005, longitude: GYM.longitude, accuracy: 100 },
    timestamp: Date.now() - 5_000,
  }] },
  error: null,
});

const expiredRows = () => mockLogRegionEvent.mock.calls.filter(c => c[1] === 'session_expired');
const lateOpens = () => mockLogRegionEvent.mock.calls.filter(
  c => c[1] === 'visit_open_attempt' && (c[2] as { source?: string })?.source === 'stream_late_open',
);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetVisitTickThrottleForTests();
  resetSelfPollThrottleForTests();
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  mockCloseGymVisit.mockResolvedValue(true);
  mockOpenGymVisit.mockResolvedValue(null);
  // A recent wake keeps the wake-starvation watchdog out of these cases.
  await AsyncStorage.setItem(LAST_WAKE_AT_KEY, String(Date.now()));
});

describe('stream fix — the path that kept the field session alive', () => {
  it('finalizes a 34 h unstamped session instead of late-opening it again', async () => {
    await seedActive();

    await driveCoarseFix();

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).toBeNull();
    expect(lateOpens()).toHaveLength(0);
    expect(expiredRows()).toHaveLength(1);
    expect(expiredRows()[0][2]).toMatchObject({ via: 'stream_fix', had_tick: false, dwell_min: 0, visit: null });
    expect((expiredRows()[0][2] as { age_min: number }).age_min).toBeGreaterThanOrEqual(34 * 60);
  });

  it('is idempotent — the next tick finds nothing to expire and nothing to open', async () => {
    await seedActive();
    await driveCoarseFix();
    resetVisitTickThrottleForTests();
    mockLogRegionEvent.mockClear();

    await driveCoarseFix();

    expect(expiredRows()).toHaveLength(0);
    expect(lateOpens()).toHaveLength(0);
  });

  it('leaves a session inside the backstop exactly as it was', async () => {
    await seedActive({ entryTimestamp: Date.now() - 11 * HOUR });

    await driveCoarseFix();

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(expiredRows()).toHaveLength(0);
    // …and the late-open retry it exists for still runs.
    expect(lateOpens()).toHaveLength(1);
  });
});

describe('sweep — a device whose stream is dead still gets the backstop', () => {
  it('finalizes on the fence_refresh sweep', async () => {
    await seedActive({ visitId: 'v-old' });

    await sweepForMissedCheckInFromWake();

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).toBeNull();
    expect(expiredRows()).toHaveLength(1);
    expect(expiredRows()[0][2]).toMatchObject({ via: 'sweep', visit: 'v-old' });
    expect(mockLogRegionEvent.mock.calls.some(
      c => c[1] === 'sweep' && (c[2] as { outcome?: string })?.outcome === 'session_active',
    )).toBe(false);
  });
});

describe('honesty of the close', () => {
  it('ends at the last proven-inside moment, and an earned session is still claimed', async () => {
    const entryAt = Date.now() - 20 * HOUR;
    const tickAt = entryAt + 50 * 60_000;
    await seedActive({ entryTimestamp: entryAt, visitId: 'v-earned' });
    await AsyncStorage.setItem(VISIT_TICK_KEY, String(tickAt));

    await sweepForMissedCheckInFromWake();

    expect(mockCloseGymVisit).toHaveBeenCalledWith('v-earned', tickAt);
    const queued = JSON.parse((await AsyncStorage.getItem(PENDING_CLAIMS_KEY)) ?? '[]');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ visitId: 'v-earned', endedAtMs: tickAt });
  });

  it('ends at entry when nothing was ever proven — no claim for unwitnessed hours', async () => {
    const entryAt = Date.now() - 34 * HOUR;
    await seedActive({ entryTimestamp: entryAt, visitId: 'v-never' });

    await sweepForMissedCheckInFromWake();

    expect(mockCloseGymVisit).toHaveBeenCalledWith('v-never', entryAt);
    expect(await AsyncStorage.getItem(PENDING_CLAIMS_KEY)).toBeNull();
  });

  it('never banks past the backstop, even on a tick that outlived it', async () => {
    const entryAt = Date.now() - 30 * HOUR;
    await seedActive({ entryTimestamp: entryAt, visitId: 'v-cap' });
    await AsyncStorage.setItem(VISIT_TICK_KEY, String(entryAt + 20 * HOUR));

    await sweepForMissedCheckInFromWake();

    expect(mockCloseGymVisit).toHaveBeenCalledWith('v-cap', entryAt + 12 * HOUR);
  });
});

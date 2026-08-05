/**
 * Pins the zombie-session reconciler (2026-08-05 night).
 *
 * The walk-killer: a swiped-away phone misses its walk-out EXIT (mute
 * geofencer), the persisted session stays active forever, and the enter
 * handler then refuses every REAL arrival — "Enter ignored — session already
 * active". One missed exit silently ate check-ins for whole days of field
 * walks. reconcileActiveSessionFromWake runs on the beacon's visit-less
 * fence-refresh pings and repairs exactly that state.
 *
 * What must never regress:
 *  1. Only a FIX may finalize — no fix, no guess, session kept.
 *  2. The fix's own accuracy is the buffer: a coarse fix self-gates to a no-op.
 *  3. endedAt is the last PROVEN-inside moment (VISIT_TICK_KEY), never "now" —
 *     a zombie found late must not claim minutes nobody witnessed.
 *  4. A young session is untouchable (boundary-wobble grace).
 *  5. A proven-inside session is untouched except for a fresh evidence stamp.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const VISIT_TICK_KEY = '@powr/last_visit_tick';

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
  cancelSessionMarkNotifications: jest.fn().mockResolvedValue(undefined),
  scheduleSessionMarkNotifications: jest.fn().mockResolvedValue(undefined),
  notifyCheckInAvailable: jest.fn().mockResolvedValue(true),
  notifySessionCompleted: jest.fn().mockResolvedValue(undefined),
  notifySessionUpgraded: jest.fn().mockResolvedValue(undefined),
  scheduleRewardWithinReach: jest.fn().mockResolvedValue(undefined),
}));

const mockCloseGymVisit = jest.fn(async (..._args: unknown[]) => {});
jest.mock('@/lib/gymVisits', () => ({
  closeGymVisit: (...args: unknown[]) => mockCloseGymVisit(...args),
  openGymVisit: jest.fn(async () => null),
  confirmGymVisit: jest.fn(async () => null),
  confirmGymVisitViaNonce: jest.fn(async () => null),
  logGymWakeReceived: jest.fn(async () => {}),
  logGymWakeReceivedViaNonce: jest.fn(async () => {}),
  logGeofenceRegionEvent: jest.fn(async () => {}),
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

import { reconcileActiveSessionFromWake } from '@/context/GeofenceContext';

const mockLocation = Location as jest.Mocked<typeof Location>;

// Session geometry: the gym at (52.1244, -1.7640), 25 m radius.
const GYM = { latitude: 52.1244, longitude: -1.764, radius: 25 };
// ~620 m north of the gym — unambiguously outside any sane buffer.
const OUTSIDE = { latitude: 52.13, longitude: -1.764 };

function seedActive(overrides: Record<string, unknown> = {}) {
  return AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
    partnerId: 'partner-1',
    partnerName: 'Home Gym',
    regionId: 'partner-1-0',
    entryTimestamp: Date.now() - 45 * 60_000,
    visitId: 'v-zombie',
    userId: 'user-1',
    ...GYM,
    ...overrides,
  }));
}

const osFix = (coords: { latitude: number; longitude: number }, accuracy: number) => ({
  coords: { ...coords, accuracy },
  timestamp: Date.now(),
});

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCloseGymVisit.mockClear();
  mockLocation.getLastKnownPositionAsync.mockReset().mockResolvedValue(null);
  mockLocation.getCurrentPositionAsync.mockReset().mockResolvedValue(null as never);
});

describe('reconcileActiveSessionFromWake', () => {
  it('finalizes a zombie session when the fix shows the device outside, ending it at the last inside-evidence', async () => {
    const tickAt = Date.now() - 30 * 60_000;
    await seedActive();
    await AsyncStorage.setItem(VISIT_TICK_KEY, String(tickAt));
    mockLocation.getLastKnownPositionAsync.mockResolvedValue(osFix(OUTSIDE, 15) as never);

    await reconcileActiveSessionFromWake();

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).toBeNull();
    // The honesty bound: ended at the tick, NOT at discovery time.
    expect(mockCloseGymVisit).toHaveBeenCalledWith('v-zombie', tickAt);
  });

  it('keeps the session and refreshes the evidence stamp when the fix shows inside', async () => {
    const before = Date.now();
    await seedActive();
    mockLocation.getLastKnownPositionAsync.mockResolvedValue(osFix(GYM, 15) as never);

    await reconcileActiveSessionFromWake();

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
    expect(Number(await AsyncStorage.getItem(VISIT_TICK_KEY))).toBeGreaterThanOrEqual(before);
  });

  it('does nothing without a usable fix — no fix, no guess', async () => {
    await seedActive();

    await reconcileActiveSessionFromWake();

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
  });

  it('never touches a young session (boundary-wobble grace)', async () => {
    await seedActive({ entryTimestamp: Date.now() - 5 * 60_000 });
    mockLocation.getLastKnownPositionAsync.mockResolvedValue(osFix(OUTSIDE, 15) as never);

    await reconcileActiveSessionFromWake();

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
    // Age-gated before any location work.
    expect(mockLocation.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });

  it('a coarse fix self-gates: 300 m away at 800 m accuracy is not proof of anything', async () => {
    await seedActive();
    mockLocation.getLastKnownPositionAsync.mockResolvedValue(
      osFix({ latitude: 52.1271, longitude: -1.764 }, 800) as never, // ~300 m north
    );

    await reconcileActiveSessionFromWake();

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).not.toBeNull();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
  });

  it('is a no-op when no session is active', async () => {
    await reconcileActiveSessionFromWake();
    expect(mockCloseGymVisit).not.toHaveBeenCalled();
  });
});

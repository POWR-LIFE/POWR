/**
 * The approach backstop: a high-accuracy approach stream with no session behind
 * it must not outlive any real walk-in, even when every fix is coarse.
 * See expireStaleApproach in context/GeofenceContext.tsx.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { expireStaleApproach, APPROACH_MAX_MS } from '@/context/GeofenceContext';

const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const APPROACH_STATE_KEY = '@powr/approach_state';

// The finish-hold guard (lib/taskFinishGuard) sleeps on REAL timers after each
// task body; under this file's fake timers that sleep never resolves. Its own
// behaviour is covered in task-finish-guard.test.ts — here we want the raw
// task body, exactly as before the guard existed.
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

/** The OS EXIT, delivered exactly as the geofencing task receives it. */

/** logRegionEvent rides a fire-and-forget dynamic import — flush it. */
async function flushTelemetry() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
const regionRows = (event: string) =>
  (mockRpc.mock.calls as any[][])
    .filter(([fn, args]) => fn === 'log_geofence_region_event' && args?.p_event === event)
    .map(([, args]) => args);

const approach = (ageMs: number) =>
  AsyncStorage.setItem(APPROACH_STATE_KEY, JSON.stringify({ regionId: 'gym-a-0', since: Date.now() - ageMs }));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('expireStaleApproach — the approach backstop (2026-11-28)', () => {
  it('stands down an approach older than APPROACH_MAX_MS with no session behind it', async () => {
    // Field shape: approach flag stamped at a 16:37 entry, visit reaped at 20:29,
    // stream still escalated at 08:03 the next morning.
    await approach(55_550 * 1000);

    expect(await expireStaleApproach('stream_fix')).toBe(true);
    await flushTelemetry();

    expect(await AsyncStorage.getItem(APPROACH_STATE_KEY)).toBeNull();
    const rows = regionRows('approach_expired');
    expect(rows).toHaveLength(1);
    expect(rows[0].p_region_id).toBe('gym-a-0');
    expect(rows[0].p_detail).toMatchObject({ via: 'stream_fix', approach_age_s: 55_550 });
  });

  it('leaves a fresh approach alone — a real walk-in resolves in seconds', async () => {
    await approach(APPROACH_MAX_MS - 60_000);

    expect(await expireStaleApproach('stream_fix')).toBe(false);
    expect(await AsyncStorage.getItem(APPROACH_STATE_KEY)).not.toBeNull();
  });

  it('never touches an approach behind a live session — that is the check-in stream', async () => {
    await approach(3 * 60 * 60_000);
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
      partnerId: 'partner-1', partnerName: 'Test Gym', regionId: 'gym-a-0',
      entryTimestamp: Date.now() - 3 * 60 * 60_000, latitude: 51.5, longitude: -0.12, radius: 25,
    }));

    expect(await expireStaleApproach('stream_fix')).toBe(false);
    expect(await AsyncStorage.getItem(APPROACH_STATE_KEY)).not.toBeNull();
  });

  it('treats an approach with no readable `since` as stale rather than immortal', async () => {
    await AsyncStorage.setItem(APPROACH_STATE_KEY, JSON.stringify({ regionId: 'gym-a-0' }));

    expect(await expireStaleApproach('stream_fix')).toBe(true);
    expect(await AsyncStorage.getItem(APPROACH_STATE_KEY)).toBeNull();
  });

  it('is a no-op with no approach at all', async () => {
    expect(await expireStaleApproach('stream_fix')).toBe(false);
    await flushTelemetry();
    expect(regionRows('approach_expired')).toHaveLength(0);
  });
});

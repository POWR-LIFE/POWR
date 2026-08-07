/**
 * Pins the presence-sweep telemetry (2026-08-07).
 *
 * sweepForMissedCheckIn is the one entry detector that does not involve native
 * fences at all, and its docstring claimed "it fails visibly — every ping either
 * produces a row or does not". That was false: it emitted nothing, so 290
 * accepted fence_refresh pings produced zero evidence, and its four exits were
 * one indistinguishable silence.
 *
 * What must never regress:
 *  1. EVERY exit emits exactly one 'sweep' row naming its outcome.
 *  2. The handoff row is written BEFORE evaluateLocationFix, so a freeze inside
 *     setActiveAndNotify (twice recorded in this codebase) still leaves evidence.
 *     A `finally` would lose the row on exactly the failure it exists to catch.
 *  3. The telemetry GATES NOTHING — the permission refusal stays a hard return
 *     (failing open would start sessions a "While Using" device cannot close),
 *     and no partner-map gate is introduced.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const PARTNER_MAP_KEY = '@powr/partner_map';
// fetchedAt bumps invalidate readPartnerMap's in-context parse memo, which is
// module-level and therefore survives AsyncStorage.clear(). Seeding a fresh
// value per test is how production invalidates it, and it keeps these tests
// order-independent.
const PARTNER_MAP_META_KEY = '@powr/partner_map_meta';
let fetchedAtSeq = 1;

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
  notifyCheckInAvailable: jest.fn().mockResolvedValue(true),
  notifySessionCompleted: jest.fn().mockResolvedValue(undefined),
  notifySessionUpgraded: jest.fn().mockResolvedValue(undefined),
  scheduleRewardWithinReach: jest.fn().mockResolvedValue(undefined),
}));

const mockLogRegionEvent = jest.fn(async (..._args: unknown[]) => {});
jest.mock('@/lib/gymVisits', () => ({
  closeGymVisit: jest.fn(async () => {}),
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

import { sweepForMissedCheckInFromWake } from '@/context/GeofenceContext';

const mockLocation = Location as jest.Mocked<typeof Location>;

// The gym at (52.1244, -1.7640), 25 m radius — matches the reconcile suite.
const GYM = { lat: 52.1244, lng: -1.764, radius: 25 };
// ~620 m north of the gym: outside every circle, but a real place.
const OUTSIDE = { latitude: 52.13, longitude: -1.764 };

function fixAt(c: { latitude: number; longitude: number }, accuracy = 12, ageMs = 0) {
  return {
    coords: { ...c, accuracy, altitude: null, heading: null, speed: null, altitudeAccuracy: null },
    timestamp: Date.now() - ageMs,
  } as unknown as Location.LocationObject;
}

/** Every 'sweep' row emitted this test, in order. */
function sweepRows(): Array<Record<string, unknown>> {
  return mockLogRegionEvent.mock.calls
    .filter(c => c[1] === 'sweep')
    .map(c => c[2] as Record<string, unknown>);
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
  mockLocation.getLastKnownPositionAsync.mockResolvedValue(null as never);
  await seedPartnerMap({
    'partner-1-0': { name: 'The Gym', dbId: 'partner-1', lat: GYM.lat, lng: GYM.lng, radius: GYM.radius },
  });
});

async function seedPartnerMap(map: Record<string, unknown>) {
  await AsyncStorage.setItem(PARTNER_MAP_KEY, JSON.stringify(map));
  await AsyncStorage.setItem(PARTNER_MAP_META_KEY, JSON.stringify({ fetchedAt: fetchedAtSeq++ }));
}

describe('presence sweep telemetry', () => {
  it('names a stored session as the blocker, and whether the reconcile could clear it', async () => {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
      partnerId: 'partner-1',
      partnerName: 'The Gym',
      entryTimestamp: Date.now() - 45 * 60_000,
      // No latitude/longitude/radius: the shape the reconcile can never finalize.
    }));

    await sweepForMissedCheckInFromWake();

    const rows = sweepRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'session_active',
      partner: 'The Gym',
      has_geom: false,
      age_min: 45,
    });
  });

  it('records a refused background permission instead of returning silently', async () => {
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);

    await sweepForMissedCheckInFromWake();

    expect(sweepRows()).toEqual([{ outcome: 'no_permission', perm_bg: 'denied' }]);
    // Still a hard return: no fix is ever read on a device without permission.
    expect(mockLocation.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });

  it('records an empty OS location cache — the prime suspect on a swiped iPhone', async () => {
    mockLocation.getLastKnownPositionAsync.mockResolvedValue(null as never);

    await sweepForMissedCheckInFromWake();

    expect(sweepRows()).toEqual([{ outcome: 'no_fix' }]);
  });

  it('writes the handoff row BEFORE evaluateLocationFix, so a freeze still leaves evidence', async () => {
    mockLocation.getLastKnownPositionAsync.mockResolvedValue(fixAt(OUTSIDE, 12, 30_000) as never);

    await sweepForMissedCheckInFromWake();

    const rows = sweepRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'handoff', acc_m: 12, nearest_id: 'partner-1-0' });
    // The one number that separates "outside every circle" from "inside one and
    // the gate refused it". ~620 m north of the gym.
    expect(rows[0].nearest_m as number).toBeGreaterThan(500);
    expect(rows[0].age_s as number).toBeGreaterThanOrEqual(29);
    // Outside every radius, so no session and therefore no checked_in row.
    expect(mockLogRegionEvent.mock.calls.filter(c => c[1] === 'checked_in')).toHaveLength(0);
  });

  it('still emits a handoff row when the map yields no geometry — it gates nothing', async () => {
    await seedPartnerMap({});
    mockLocation.getLastKnownPositionAsync.mockResolvedValue(fixAt(OUTSIDE) as never);

    await sweepForMissedCheckInFromWake();

    const rows = sweepRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'handoff', nearest_m: null, nearest_id: null });
  });
});

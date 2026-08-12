import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import {
  finalizeActiveGeofence,
  nativeExitRefuted,
  ACTIVE_GEOFENCE_KEY,
  LAST_WAKE_AT_KEY,
} from '@/context/GeofenceContext';
import { LAST_WAKE_AT_KEY as WAKE_TASK_LAST_WAKE_AT_KEY } from '@/lib/backgroundNotificationTask';

jest.mock('expo-background-fetch', () => ({
  BackgroundFetchResult: { NewData: 'new-data', Failed: 'failed' },
  registerTaskAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 2 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  getBackgroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  hasStartedGeofencingAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  startGeofencingAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopGeofencingAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  },
}));

const PENDING_CLAIMS_KEY = '@powr/pending_claims';

function activeSession(regionId: string) {
  return {
    partnerId: 'partner-1',
    partnerName: 'Test Gym',
    regionId,
    entryTimestamp: Date.now() - 31 * 60 * 1000,
    latitude: 51.5,
    longitude: -0.12,
    radius: 25,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('wake-starvation watchdog key', () => {
  it('GeofenceContext and the wake task agree on LAST_WAKE_AT_KEY', () => {
    // The string is duplicated on purpose (boot-path isolation — see both
    // declarations). This is the pin that keeps the mirror honest.
    expect(LAST_WAKE_AT_KEY).toBe(WAKE_TASK_LAST_WAKE_AT_KEY);
  });
});

describe('nativeExitRefuted', () => {
  // The 2026-08-12 field case: iOS fired a region EXIT off a wandering 2243 m
  // cell pin 12 minutes into a live visit; a sweep 8 s later measured 4 m from
  // centre at 11 m accuracy. A pre-upgrade native exit must survive one bounded
  // verification before it may finalize.
  const freshInsideFix = (accuracy: number) => ({
    coords: { latitude: 51.5, longitude: -0.12, accuracy },
    timestamp: Date.now(),
  });

  it('refutes a pre-upgrade exit when a fresh trusted fix places us inside', async () => {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify(activeSession('gym-a-0')));
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(freshInsideFix(15));

    await expect(nativeExitRefuted('gym-a-0')).resolves.toBe(true);
  });

  it('honors the exit when the only fix is coarse — weak evidence cannot veto the OS', async () => {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify(activeSession('gym-a-0')));
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(freshInsideFix(250));

    await expect(nativeExitRefuted('gym-a-0')).resolves.toBe(false);
  });

  it('honors the exit when no fix can be obtained at all', async () => {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify(activeSession('gym-a-0')));
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue(null);

    await expect(nativeExitRefuted('gym-a-0')).resolves.toBe(false);
  });

  it('honors the exit when the "fresh" fix is actually stale (the 08-11 cached-pin lesson)', async () => {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify(activeSession('gym-a-0')));
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 51.5, longitude: -0.12, accuracy: 15 },
      timestamp: Date.now() - 5 * 60 * 1000,
    });

    await expect(nativeExitRefuted('gym-a-0')).resolves.toBe(false);
  });

  it('never verifies past the upgrade threshold — the proven 08-11 PM exit path stays untouched', async () => {
    const active = { ...activeSession('gym-a-0'), entryTimestamp: Date.now() - 65 * 60 * 1000 };
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify(active));
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(freshInsideFix(15));

    await expect(nativeExitRefuted('gym-a-0')).resolves.toBe(false);
    expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });

  it('ignores exits for a region other than the active one', async () => {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify(activeSession('gym-a-0')));

    await expect(nativeExitRefuted('gym-b-0')).resolves.toBe(false);
    expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });

  it('is a no-op with no active session', async () => {
    await expect(nativeExitRefuted('gym-a-0')).resolves.toBe(false);
  });
});

describe('finalizeActiveGeofence', () => {
  it('does not let a neighboring native-region exit end the active gym session', async () => {
    const active = activeSession('gym-a-0');
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify(active));

    await expect(finalizeActiveGeofence('gym-b-0')).resolves.toBe(false);

    expect(JSON.parse((await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY))!)).toEqual(active);
    expect(await AsyncStorage.getItem(PENDING_CLAIMS_KEY)).toBeNull();
  });

  it('writes an eligible exit to the durable queue before removing active state', async () => {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify(activeSession('gym-a-0')));

    await expect(finalizeActiveGeofence('gym-a-0')).resolves.toBe(true);

    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).toBeNull();
    const pending = JSON.parse((await AsyncStorage.getItem(PENDING_CLAIMS_KEY))!);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ partnerId: 'partner-1', regionId: 'gym-a-0' });
    expect(pending[0].endedAtMs).toEqual(expect.any(Number));
  });
});
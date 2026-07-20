import AsyncStorage from '@react-native-async-storage/async-storage';
import { finalizeActiveGeofence, ACTIVE_GEOFENCE_KEY } from '@/context/GeofenceContext';

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
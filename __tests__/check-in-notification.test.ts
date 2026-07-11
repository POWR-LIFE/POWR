import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { notifyCheckInAvailable } from '@/lib/notifications';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
}));

jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('@/lib/gymDwellConfig', () => ({ getGymUpgradeMinutes: () => 40 }));

const LOCATION_ID = 'partner-1-0';
const COOLDOWN_KEY = `@powr/check_in_last_fired/${LOCATION_ID}`;

const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const schedule = Notifications.scheduleNotificationAsync as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  getPermissions.mockResolvedValue({ granted: true });
});

describe('notifyCheckInAvailable', () => {
  it('does not consume the cooldown when notification permission is unavailable', async () => {
    getPermissions.mockResolvedValue({ granted: false, ios: { status: 0 } });

    await notifyCheckInAvailable('Test Gym', LOCATION_ID);

    expect(schedule).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(COOLDOWN_KEY)).toBeNull();
  });

  it('only stamps the cooldown after an immediate notification is scheduled', async () => {
    schedule.mockRejectedValueOnce(new Error('notification service unavailable'));

    await expect(notifyCheckInAvailable('Test Gym', LOCATION_ID)).rejects.toThrow('notification service unavailable');
    expect(await AsyncStorage.getItem(COOLDOWN_KEY)).toBeNull();

    schedule.mockResolvedValueOnce('notification-id');
    await notifyCheckInAvailable('Test Gym', LOCATION_ID);

    expect(schedule).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem(COOLDOWN_KEY)).toEqual(expect.any(String));
  });
});
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { notifyCheckInAvailable, cancelPendingCheckInBanner, CHECK_IN_BANNER_DELAY_S } from '@/lib/notifications';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
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

  // Live Ops 2026-08-19→26: 21 of 23 sub-two-minute drive-by visits drew the
  // banner. The announcement now waits on an OS timer the finalize can cancel.
  it('defers the banner on an OS time-interval trigger rather than drawing immediately', async () => {
    schedule.mockResolvedValueOnce('notification-id');

    const result = await notifyCheckInAvailable('Test Gym', LOCATION_ID);

    expect(result).toBe('scheduled');
    expect(schedule).toHaveBeenCalledTimes(1);
    const call = schedule.mock.calls[0][0];
    expect(call.identifier).toBe(`powr-check_in_reminder-${LOCATION_ID}`);
    expect(call.trigger).toEqual(expect.objectContaining({
      type: 'timeInterval',
      seconds: CHECK_IN_BANNER_DELAY_S,
      repeats: false,
    }));
    expect(CHECK_IN_BANNER_DELAY_S).toBeGreaterThanOrEqual(60);
  });

  it('cancels the pending banner by the same identifier the schedule used, and says it was still pending', async () => {
    const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
    const scheduled = Notifications.getAllScheduledNotificationsAsync as jest.Mock;
    cancel.mockResolvedValueOnce(undefined);
    scheduled.mockResolvedValueOnce([{ identifier: `powr-check_in_reminder-${LOCATION_ID}` }]);

    const outcome = await cancelPendingCheckInBanner(LOCATION_ID);

    expect(cancel).toHaveBeenCalledWith(`powr-check_in_reminder-${LOCATION_ID}`);
    expect(outcome).toBe('cancelled');
  });

  it('reports not_pending when nothing was waiting — the banner had already drawn', async () => {
    const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
    const scheduled = Notifications.getAllScheduledNotificationsAsync as jest.Mock;
    cancel.mockResolvedValueOnce(undefined);
    scheduled.mockResolvedValueOnce([{ identifier: 'powr-session_mark-something-else' }]);

    await expect(cancelPendingCheckInBanner(LOCATION_ID)).resolves.toBe('not_pending');
    // Still withdraws, in case the list and the scheduler disagree.
    expect(cancel).toHaveBeenCalledWith(`powr-check_in_reminder-${LOCATION_ID}`);
  });

  it('never lets a cancel failure escape — the finalize must not pay for a banner', async () => {
    const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
    const scheduled = Notifications.getAllScheduledNotificationsAsync as jest.Mock;
    scheduled.mockRejectedValueOnce(new Error('no scheduler in this context'));
    cancel.mockRejectedValueOnce(new Error('already delivered'));

    await expect(cancelPendingCheckInBanner(LOCATION_ID)).resolves.toBe('unknown');
  });
});
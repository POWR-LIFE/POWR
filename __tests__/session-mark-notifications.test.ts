// Pins the iOS session-mark contract: at check-in we pre-schedule the 30/40
// minute banners (Apple delivers scheduled locals to force-quit apps — the only
// at-the-mark channel a swiped-away iPhone has), and the exit path cancels the
// marks the user left before earning. Android must never schedule these — its
// background pushes are reliable and carry the real points copy.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  cancelSessionMarkNotifications,
  notifyCheckInAvailable,
  scheduleSessionMarkNotifications,
} from '@/lib/notifications';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
}));

jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('@/lib/gymDwellConfig', () => ({ getGymUpgradeMinutes: () => 40 }));

const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;

const SESSION_KEY = '1754400000000';
const baseOpts = {
  sessionKey: SESSION_KEY,
  partnerName: 'POWR Gym',
  dwellMinutes: 30,
  upgradeMinutes: 40,
};

const originalOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  getPermissions.mockResolvedValue({ granted: true });
  schedule.mockResolvedValue('id');
  cancel.mockResolvedValue(undefined);
});

afterAll(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

describe('scheduleSessionMarkNotifications', () => {
  it('schedules both marks at entry+30 and entry+40 with stable visit-scoped identifiers', async () => {
    const entry = Date.now();
    await scheduleSessionMarkNotifications({ ...baseOpts, entryTimestampMs: entry });

    expect(schedule).toHaveBeenCalledTimes(2);
    const [dwellCall, upgradeCall] = schedule.mock.calls.map(c => c[0]);

    expect(dwellCall.identifier).toBe(`powr-session_mark-dwell-${SESSION_KEY}`);
    expect(upgradeCall.identifier).toBe(`powr-session_mark-upgrade-${SESSION_KEY}`);
    expect(dwellCall.trigger.date.getTime()).toBe(entry + 30 * 60_000);
    expect(upgradeCall.trigger.date.getTime()).toBe(entry + 40 * 60_000);
    expect(dwellCall.content.title).toContain('Session recorded');
    expect(upgradeCall.content.title).toContain('Bonus unlocked');
  });

  it('skips marks whose threshold has already passed (late/backdated check-in)', async () => {
    const entry = Date.now() - 35 * 60_000; // 35 min ago: dwell passed, upgrade pending
    await scheduleSessionMarkNotifications({ ...baseOpts, entryTimestampMs: entry });

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0][0].identifier).toBe(`powr-session_mark-upgrade-${SESSION_KEY}`);
  });

  it('never schedules on Android — server pushes own the marks there', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    await scheduleSessionMarkNotifications({ ...baseOpts, entryTimestampMs: Date.now() });
    expect(schedule).not.toHaveBeenCalled();
  });

  it('does nothing without notification permission', async () => {
    getPermissions.mockResolvedValue({ granted: false, ios: { status: 0 } });
    await scheduleSessionMarkNotifications({ ...baseOpts, entryTimestampMs: Date.now() });
    expect(schedule).not.toHaveBeenCalled();
  });

  it('a failure on one mark does not prevent the other (and is not silent)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    schedule.mockRejectedValueOnce(new Error('nope'));

    await scheduleSessionMarkNotifications({ ...baseOpts, entryTimestampMs: Date.now() });

    expect(schedule).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('cancelSessionMarkNotifications', () => {
  it("cancels both marks when the user left before the dwell threshold ('all')", async () => {
    await cancelSessionMarkNotifications(SESSION_KEY, 'all');
    expect(cancel.mock.calls.map(c => c[0]).sort()).toEqual([
      `powr-session_mark-dwell-${SESSION_KEY}`,
      `powr-session_mark-upgrade-${SESSION_KEY}`,
    ]);
  });

  it("cancels only the upgrade mark when they left between thresholds ('upgrade_only')", async () => {
    await cancelSessionMarkNotifications(SESSION_KEY, 'upgrade_only');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(`powr-session_mark-upgrade-${SESSION_KEY}`);
  });

  it('is a no-op on Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    await cancelSessionMarkNotifications(SESSION_KEY, 'all');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('tolerates cancelling marks that were never scheduled on this runtime', async () => {
    cancel.mockRejectedValue(new Error('not found'));
    await expect(cancelSessionMarkNotifications(SESSION_KEY, 'all')).resolves.toBeUndefined();
  });
});

describe('notifyCheckInAvailable return contract (announce dedupe)', () => {
  // The boolean feeds mark_gym_visit_announced: true = "user was told locally,
  // suppress the server copy"; false = "not told — let the beacon announce".
  beforeEach(async () => { await AsyncStorage.clear(); });

  it('returns true after displaying', async () => {
    await expect(notifyCheckInAvailable('POWR Gym', 'r-1')).resolves.toBe(true);
    expect(schedule).toHaveBeenCalled();
  });

  it('returns true within the cooldown (already told recently — no server copy either)', async () => {
    await notifyCheckInAvailable('POWR Gym', 'r-1');
    schedule.mockClear();
    await expect(notifyCheckInAvailable('POWR Gym', 'r-1')).resolves.toBe(true);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('returns false when permission is missing (server announce should cover)', async () => {
    getPermissions.mockResolvedValue({ granted: false, ios: { status: 0 } });
    await expect(notifyCheckInAvailable('POWR Gym', 'r-1')).resolves.toBe(false);
  });

  it('propagates a scheduling failure rather than reporting shown', async () => {
    schedule.mockRejectedValueOnce(new Error('notification service unavailable'));
    await expect(notifyCheckInAvailable('POWR Gym', 'r-1')).rejects.toThrow();
  });
});

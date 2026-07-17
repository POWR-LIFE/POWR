// The silent-wake task binding dies when the JS context changes under a live
// process (OTA reload / headless-born start) — field-proven 2026-07-17: the OS
// dispatched every beacon wake, the task never ran, and only a cold start
// healed it. The cure is to REBIND (unregister → register) instead of trusting
// registerTaskAsync's "already registered" no-op. These tests pin that order
// and that the rebind never throws into its callers.

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
}));

const mockCalls: string[] = [];
const mockUnregister = jest.fn(async (_name: string) => { mockCalls.push('unregister'); return null; });
const mockRegister = jest.fn(async (_name: string) => { mockCalls.push('register'); });

jest.mock('expo-notifications', () => ({
  unregisterTaskAsync: (name: string) => mockUnregister(name),
  registerTaskAsync: (name: string) => mockRegister(name),
}));

import {
  BACKGROUND_NOTIFICATION_TASK,
  registerBackgroundNotificationTask,
} from '@/lib/backgroundNotificationTask';

beforeEach(() => {
  mockCalls.length = 0;
  mockUnregister.mockClear();
  mockRegister.mockClear();
});

describe('registerBackgroundNotificationTask', () => {
  it('drops the existing native binding before registering (unregister → register)', async () => {
    await registerBackgroundNotificationTask();

    expect(mockUnregister).toHaveBeenCalledWith(BACKGROUND_NOTIFICATION_TASK);
    expect(mockRegister).toHaveBeenCalledWith(BACKGROUND_NOTIFICATION_TASK);
    expect(mockCalls).toEqual(['unregister', 'register']);
  });

  it('still registers when there was nothing to unregister', async () => {
    mockUnregister.mockRejectedValueOnce(new Error('task not registered'));

    await registerBackgroundNotificationTask();

    expect(mockRegister).toHaveBeenCalledWith(BACKGROUND_NOTIFICATION_TASK);
  });

  it('never throws when registration is unsupported (Expo Go)', async () => {
    mockRegister.mockRejectedValueOnce(new Error('unsupported in Expo Go'));

    await expect(registerBackgroundNotificationTask()).resolves.toBeUndefined();
  });
});

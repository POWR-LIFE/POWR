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

import { BACKGROUND_NOTIFICATION_TASK } from '@/lib/backgroundNotificationTask';

// The rebind is deliberately ONCE PER JS CONTEXT — that bound is the fix for the
// crash where an FCM message arriving during the unregister → register gap killed
// the process (field 2026-08-03). The latch is module state, so each case must get
// a fresh module instance or the first call would satisfy every later one. Reloading
// the module here is precisely what a new JS context does on device.
function freshContext(): typeof import('@/lib/backgroundNotificationTask') {
  let mod!: typeof import('@/lib/backgroundNotificationTask');
  jest.isolateModules(() => { mod = require('@/lib/backgroundNotificationTask'); });
  return mod;
}

beforeEach(() => {
  mockCalls.length = 0;
  mockUnregister.mockClear();
  mockRegister.mockClear();
});

describe('registerBackgroundNotificationTask', () => {
  it('drops the existing native binding before registering (unregister → register)', async () => {
    await freshContext().registerBackgroundNotificationTask();

    expect(mockUnregister).toHaveBeenCalledWith(BACKGROUND_NOTIFICATION_TASK);
    expect(mockRegister).toHaveBeenCalledWith(BACKGROUND_NOTIFICATION_TASK);
    expect(mockCalls).toEqual(['unregister', 'register']);
  });

  it('still registers when there was nothing to unregister', async () => {
    mockUnregister.mockRejectedValueOnce(new Error('task not registered'));

    await freshContext().registerBackgroundNotificationTask();

    expect(mockRegister).toHaveBeenCalledWith(BACKGROUND_NOTIFICATION_TASK);
  });

  it('never throws when registration is unsupported (Expo Go)', async () => {
    mockRegister.mockRejectedValueOnce(new Error('unsupported in Expo Go'));

    await expect(freshContext().registerBackgroundNotificationTask()).resolves.toBeUndefined();
  });

  // The crash guard: rebinding on every foreground reopened the null window at the
  // exact moment queued pushes are delivered, and an FCM message landing in it took
  // down the whole process.
  it('rebinds only ONCE per JS context, however often it is called', async () => {
    const mod = freshContext();
    await mod.registerBackgroundNotificationTask();   // UI mount
    await mod.registerBackgroundNotificationTask();   // foreground
    await mod.registerBackgroundNotificationTask();   // foreground again

    expect(mockUnregister).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockCalls).toEqual(['unregister', 'register']);
  });

  // A transient failure must not latch the context out of ever binding.
  it('retries after a failed registration', async () => {
    const mod = freshContext();
    mockRegister.mockRejectedValueOnce(new Error('transient'));

    await mod.registerBackgroundNotificationTask();
    await mod.registerBackgroundNotificationTask();

    expect(mockRegister).toHaveBeenCalledTimes(2);
  });
});

// A location permission grant kills the native binding IN PLACE — same process,
// same JS context — so the once-per-context latch (correctly) refuses the routine
// re-take and every wake is delivered and dropped. Field 2026-08-12: 100 minutes
// of wakes eaten at 27-62 ms each; the fg-service kept the broken process alive
// through swipe-aways, so only a force-stop healed it. forceRebind is the ONE
// sanctioned latch bypass, wired to armAfterPermissionGrant.
describe('forceRebindBackgroundNotificationTask', () => {
  it('rebinds again even after the once-per-context latch is satisfied', async () => {
    const mod = freshContext();
    await mod.registerBackgroundNotificationTask();       // onboarding UI mount
    await mod.forceRebindBackgroundNotificationTask();    // permission grant

    expect(mockCalls).toEqual(['unregister', 'register', 'unregister', 'register']);
  });

  it('serializes behind an in-flight bind — the unregister→register crash window is never doubled', async () => {
    const mod = freshContext();
    let releaseFirst!: () => void;
    mockUnregister.mockImplementationOnce(async (_name: string) => {
      mockCalls.push('unregister');
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return null;
    });

    const first = mod.registerBackgroundNotificationTask();
    const forced = mod.forceRebindBackgroundNotificationTask();
    releaseFirst();
    await first;
    await forced;

    // Strict interleaving-free order: the forced pass starts only after the
    // first bind fully completes.
    expect(mockCalls).toEqual(['unregister', 'register', 'unregister', 'register']);
  });

  it('a later routine register shares the forced bind instead of re-taking it', async () => {
    const mod = freshContext();
    await mod.registerBackgroundNotificationTask();
    await mod.forceRebindBackgroundNotificationTask();
    await mod.registerBackgroundNotificationTask();       // foreground after grant

    expect(mockRegister).toHaveBeenCalledTimes(2);        // mount + forced, nothing more
  });
});

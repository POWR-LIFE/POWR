// The iOS wake must settle inside Apple's 30 s completion window even when the
// work behind it hangs: expo-task-manager calls the push completion handler
// only when the JS task settles, and an app that overruns it gets fewer
// background pushes. See IOS_WAKE_DEADLINE_MS in lib/backgroundNotificationTask.

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-notifications', () => ({
  unregisterTaskAsync: jest.fn(async () => null),
  registerTaskAsync: jest.fn(async () => {}),
}));

import { IOS_WAKE_DEADLINE_MS, runWithIosDeadline } from '@/lib/backgroundNotificationTask';
import { MAX_HOLD_MS } from '@/lib/taskFinishGuard';

describe('runWithIosDeadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps deadline + finish hold under Apple\'s 30 s', () => {
    expect(IOS_WAKE_DEADLINE_MS + MAX_HOLD_MS).toBeLessThan(30_000);
  });

  it('settles at the deadline when the work hangs, and reports the late finish', async () => {
    let finish!: () => void;
    const work = new Promise<void>((r) => { finish = r; });
    const settled = jest.fn();
    const late = jest.fn();
    let resolved = false;
    const p = runWithIosDeadline(work, true, settled, late, 1_000).then(() => { resolved = true; });

    await jest.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toHaveBeenCalledWith('deadline', expect.any(Number));
    expect(late).not.toHaveBeenCalled();

    finish();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('settles as soon as fast work finishes, without a late report', async () => {
    const settled = jest.fn();
    const late = jest.fn();
    await runWithIosDeadline(Promise.resolve(), true, settled, late, 1_000);
    expect(settled).toHaveBeenCalledWith('done', expect.any(Number));
    await jest.advanceTimersByTimeAsync(2_000);
    expect(late).not.toHaveBeenCalled();
  });

  it('is a plain await on Android, with no deadline', async () => {
    let finish!: () => void;
    const work = new Promise<void>((r) => { finish = r; });
    const settled = jest.fn();
    let resolved = false;
    const p = runWithIosDeadline(work, false, settled, jest.fn(), 1_000).then(() => { resolved = true; });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(resolved).toBe(false);
    finish();
    await p;
    expect(settled).not.toHaveBeenCalled();
  });
});

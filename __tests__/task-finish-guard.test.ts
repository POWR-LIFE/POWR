/**
 * Pins lib/taskFinishGuard: on iOS an executor's settlement is held until
 * QUIET_MS after the LAST task delivery (any task), capped at MAX_HOLD_MS —
 * so expo-task-manager's notifyTaskFinishedAsync (module queue) never runs
 * while a delivery burst is still doing addObject on main. See the module
 * docstring for the EXTaskService race this defuses (Sentry POWR-G).
 */
import { Platform } from 'react-native';

import { __resetForTests, defineTask, MAX_HOLD_MS, QUIET_MS } from '@/lib/taskFinishGuard';

// jest.mock is hoisted above the imports by babel-jest, so the guard sees this mock.
jest.mock('expo-task-manager', () => {
  const registry: Record<string, (body: unknown) => Promise<unknown>> = {};
  return {
    __registry: registry,
    defineTask: jest.fn((name: string, fn: (body: unknown) => Promise<unknown>) => {
      registry[name] = fn;
    }),
  };
});

const registry = (jest.requireMock('expo-task-manager') as {
  __registry: Record<string, (body: unknown) => Promise<unknown>>;
}).__registry;

/** Fire a wrapped task and expose whether it has settled yet. */
function deliver(name: string) {
  let settled: 'pending' | 'fulfilled' | 'rejected' = 'pending';
  let value: unknown;
  const promise = registry[name]({ data: {}, error: null, executionInfo: { eventId: 'e', taskName: name } })
    .then((v) => { settled = 'fulfilled'; value = v; }, (e) => { settled = 'rejected'; value = e; });
  return { promise, state: () => settled, value: () => value };
}

const originalOS = Platform.OS;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(100_000);
  __resetForTests();
  Platform.OS = 'ios';
});

afterEach(() => {
  Platform.OS = originalOS;
  jest.useRealTimers();
});

describe('taskFinishGuard.defineTask (iOS)', () => {
  it('runs the executor immediately but holds settlement for QUIET_MS after delivery', async () => {
    const executor = jest.fn(async () => 'result');
    defineTask('T', executor);

    const run = deliver('T');
    await jest.advanceTimersByTimeAsync(0);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(run.state()).toBe('pending');

    await jest.advanceTimersByTimeAsync(QUIET_MS - 1);
    expect(run.state()).toBe('pending');

    await jest.advanceTimersByTimeAsync(1);
    expect(run.state()).toBe('fulfilled');
    expect(run.value()).toBe('result');
  });

  it('a later delivery of ANY task pushes an in-flight hold out to QUIET_MS after it', async () => {
    defineTask('A', async () => 'a');
    defineTask('B', async () => 'b');

    const a = deliver('A');
    await jest.advanceTimersByTimeAsync(1_000);
    expect(a.state()).toBe('pending');

    const b = deliver('B'); // burst continues at t=1000
    await jest.advanceTimersByTimeAsync(QUIET_MS - 1_000); // t = QUIET_MS: A alone would settle here
    expect(a.state()).toBe('pending');
    expect(b.state()).toBe('pending');

    await jest.advanceTimersByTimeAsync(1_000); // t = 1000 + QUIET_MS
    expect(a.state()).toBe('fulfilled');
    expect(b.state()).toBe('fulfilled');
  });

  it('a stream that never goes quiet still settles at MAX_HOLD_MS', async () => {
    defineTask('S', async () => 's');
    const first = deliver('S');
    const step = 500;
    let elapsed = 0;
    while (elapsed < MAX_HOLD_MS - step) {
      await jest.advanceTimersByTimeAsync(step);
      elapsed += step;
      deliver('S'); // keeps lastDeliveryAt fresh
      expect(first.state()).toBe('pending');
    }
    await jest.advanceTimersByTimeAsync(step + 1);
    expect(first.state()).toBe('fulfilled');
  });

  it('a throwing executor still rejects (expo finishes the task in `finally`) — after the hold', async () => {
    const boom = new Error('boom');
    defineTask('X', async () => { throw boom; });
    const run = deliver('X');
    await jest.advanceTimersByTimeAsync(QUIET_MS - 1);
    expect(run.state()).toBe('pending');
    await jest.advanceTimersByTimeAsync(1);
    expect(run.state()).toBe('rejected');
    expect(run.value()).toBe(boom);
  });
});

describe('taskFinishGuard.defineTask (other platforms)', () => {
  it('does not hold on Android — the Kotlin TaskService has no such race', async () => {
    Platform.OS = 'android';
    defineTask('T', async () => 'r');
    const run = deliver('T');
    await jest.advanceTimersByTimeAsync(0);
    expect(run.state()).toBe('fulfilled');
  });
});

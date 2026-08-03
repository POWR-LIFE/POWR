// The wake task has to do two things before it hands off to the presence check:
// record that the push actually reached JS, and pass the SERVER's visit id through.
//
// Both come from the same 2026-08-01 audit:
//  • Until `wake_received` existed the only evidence of a wake was confirmed_*,
//    written by the very RPC being observed — so "the task never ran" and "the task
//    ran and its round-trip failed" were indistinguishable. That blind spot let a
//    dead iOS wake path survive 17 days and 175 pushes.
//  • payload.visit_id was declared and then dropped on the floor, so runVisitCheck
//    resolved the visit purely from AsyncStorage. On 2026-07-16 all four nudges for
//    live visit 793e434a were answered by confirms written to the DEAD 2fa4e05d.
//
// These tests pin the ordering (telemetry BEFORE the presence check) and the
// threading, so neither can be quietly removed again.

// The holder lives INSIDE the factory: jest.mock is hoisted above the imports that
// trigger it, so a module-scope `let` would still be in its temporal dead zone when
// defineTask runs. Handing it back on the mocked module is the way to reach it.
jest.mock('expo-task-manager', () => {
  const holder: { fn: ((body: { data?: unknown; error?: unknown }) => Promise<void>) | null } = { fn: null };
  return {
    defineTask: jest.fn((_name: string, fn: (body: { data?: unknown; error?: unknown }) => Promise<void>) => {
      holder.fn = fn;
    }),
    __holder: holder,
  };
});

jest.mock('expo-notifications', () => ({
  unregisterTaskAsync: jest.fn(async () => null),
  registerTaskAsync: jest.fn(async () => {}),
}));

const callOrder: string[] = [];
const mockLogWakeReceived = jest.fn(async (...args: unknown[]) => { callOrder.push(`wake:${JSON.stringify(args)}`); });
const mockRunVisitCheck = jest.fn(async (...args: unknown[]) => { callOrder.push(`check:${JSON.stringify(args)}`); });

jest.mock('@/lib/gymVisits', () => ({
  logGymWakeReceived: (...args: unknown[]) => mockLogWakeReceived(...args),
}));

jest.mock('@/context/GeofenceContext', () => ({
  runVisitCheck: (...args: unknown[]) => mockRunVisitCheck(...args),
}));

import * as TaskManager from 'expo-task-manager';
import '@/lib/backgroundNotificationTask';

const capturedTask = (TaskManager as unknown as {
  __holder: { fn: (body: { data?: unknown; error?: unknown }) => Promise<void> };
}).__holder.fn;

const VISIT = '793e434a-9ed3-41f2-bc7a-f44e54a04c45';

beforeEach(() => {
  callOrder.length = 0;
  mockLogWakeReceived.mockClear();
  mockRunVisitCheck.mockClear();
});

/** The Expo APNs envelope shape — the one whose `??` match cost us the iOS path. */
const iosWake = (stage: string, visitId?: string) => ({
  data: {
    body: { type: 'gym_visit_check', stage, ...(visitId ? { visit_id: visitId } : {}) },
    dataString: '{}',
    scopeKey: '@powr/app',
  },
});

/** Direct FCM v1 puts our keys at data verbatim. */
const androidWake = (stage: string, visitId?: string) => ({
  data: { type: 'gym_visit_check', stage, ...(visitId ? { visit_id: visitId } : {}) },
});

describe('background wake task telemetry + visit threading', () => {
  it('registers a task at module scope', () => {
    expect(capturedTask).toBeInstanceOf(Function);
  });

  it('logs wake_received BEFORE running the presence check (iOS envelope)', async () => {
    await capturedTask({ data: iosWake('dwell', VISIT) });

    expect(mockLogWakeReceived).toHaveBeenCalledWith(VISIT, 'dwell', { source: 'background_task' });
    expect(mockRunVisitCheck).toHaveBeenCalledWith('dwell', VISIT);
    // Ordering is the point: telemetry must land even if the presence check dies.
    expect(callOrder[0]).toContain('wake:');
    expect(callOrder[1]).toContain('check:');
  });

  it('threads the server visit id through on Android too, and honours the stage', async () => {
    await capturedTask({ data: androidWake('upgrade', VISIT) });

    expect(mockLogWakeReceived).toHaveBeenCalledWith(VISIT, 'upgrade', { source: 'background_task' });
    expect(mockRunVisitCheck).toHaveBeenCalledWith('upgrade', VISIT);
  });

  it('still runs the presence check when the payload carries no visit id', async () => {
    await capturedTask({ data: androidWake('dwell') });

    expect(mockLogWakeReceived).not.toHaveBeenCalled();
    expect(mockRunVisitCheck).toHaveBeenCalledWith('dwell', undefined);
  });

  it('ignores a payload that is not ours, without logging or checking', async () => {
    await capturedTask({ data: { data: { type: 'something_else', visit_id: VISIT } } });

    expect(mockLogWakeReceived).not.toHaveBeenCalled();
    expect(mockRunVisitCheck).not.toHaveBeenCalled();
  });

  it('does not run the presence check when the task is handed an error', async () => {
    await capturedTask({ error: new Error('boom') });

    expect(mockLogWakeReceived).not.toHaveBeenCalled();
    expect(mockRunVisitCheck).not.toHaveBeenCalled();
  });

  // THE REGRESSION THIS FILE NOW EXISTS FOR. Awaiting this telemetry ate every wake
  // for three days: the row reached the database in ~1 s while the client-side
  // promise never settled, so runVisitCheck was never entered — 0 breadcrumbs across
  // every wake of four field sessions (2026-08-03). Ordering below is still pinned;
  // what must never come back is WAITING on it.
  it('runs the presence check even if the wake telemetry never settles', async () => {
    mockLogWakeReceived.mockImplementationOnce(() => new Promise<void>(() => { /* never settles */ }));

    await capturedTask({ data: iosWake('dwell', VISIT) });

    expect(mockRunVisitCheck).toHaveBeenCalledWith('dwell', VISIT);
  });

  it('never throws when the presence check fails — a wake must not crash the task', async () => {
    mockRunVisitCheck.mockRejectedValueOnce(new Error('no fix'));

    await expect(capturedTask({ data: iosWake('dwell', VISIT) })).resolves.toBeUndefined();
    expect(mockLogWakeReceived).toHaveBeenCalled();
  });
});

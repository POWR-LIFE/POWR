// The walkers' evening step nudge rides the beacon wake, LAST in the self-heal
// chain, after the walking sync it depends on. It lived on expo-background-fetch
// alone from 2026-07-23 to 2026-09-25 and never fired for anyone — that
// scheduler has never delivered a run in the field. These tests pin the hook
// and its place in the order, so it cannot be quietly dropped or moved ahead
// of the self-heal steps the wake exists for.

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
const mockRunVisitCheck = jest.fn(async () => { callOrder.push('check'); });
const mockRearm = jest.fn(async () => { callOrder.push('rearm'); });
const mockReconcile = jest.fn(async () => { callOrder.push('reconcile'); });
const mockSweep = jest.fn(async () => { callOrder.push('sweep'); });
const mockWalk = jest.fn(async () => { callOrder.push('walk'); });
const mockStepGoal = jest.fn(async () => { callOrder.push('stepgoal'); });

jest.mock('@/lib/gymVisits', () => ({
  logGymWakeReceived: jest.fn(async () => {}),
  logGeofenceRegionEvent: jest.fn(async () => {}),
}));

jest.mock('@/context/GeofenceContext', () => ({
  runVisitCheck: () => mockRunVisitCheck(),
  rearmFencesFromWake: () => mockRearm(),
  reconcileActiveSessionFromWake: () => mockReconcile(),
  sweepForMissedCheckInFromWake: () => mockSweep(),
  flushPendingOutboxesFromWake: jest.fn(async () => {}),
}));

jest.mock('@/lib/health/walkingSync', () => ({
  syncWalkingFromWake: () => mockWalk(),
}));

jest.mock('@/lib/stepGoalNotifyTask', () => ({
  runStepGoalCheckFromWake: () => mockStepGoal(),
}));

import * as TaskManager from 'expo-task-manager';
import '@/lib/backgroundNotificationTask';

const capturedTask = (TaskManager as unknown as {
  __holder: { fn: (body: { data?: unknown; error?: unknown }) => Promise<void> };
}).__holder.fn;

/** The beacon's visit-less fence_refresh ping as the task receives it: the
 *  TaskManager body's `data` is the notification, whose own `data` holds our
 *  keys verbatim (direct FCM v1). */
const fenceRefresh = () => ({ data: { data: { type: 'gym_visit_check', stage: 'dwell' } } });

beforeEach(() => {
  callOrder.length = 0;
  jest.clearAllMocks();
});

describe('background wake → evening step nudge', () => {
  it('runs the step-goal check on every fence_refresh wake, after the walking sync', async () => {
    await capturedTask(fenceRefresh());

    expect(mockStepGoal).toHaveBeenCalledTimes(1);
    const walkIdx = callOrder.indexOf('walk');
    const stepIdx = callOrder.indexOf('stepgoal');
    expect(walkIdx).toBeGreaterThanOrEqual(0);
    expect(stepIdx).toBeGreaterThan(walkIdx);
  });

  it('sits LAST — after re-arm, reconcile and the missed-check-in sweep', async () => {
    await capturedTask(fenceRefresh());

    const stepIdx = callOrder.indexOf('stepgoal');
    for (const step of ['rearm', 'reconcile', 'sweep', 'walk']) {
      expect(callOrder.indexOf(step)).toBeGreaterThanOrEqual(0);
      expect(stepIdx).toBeGreaterThan(callOrder.indexOf(step));
    }
  });

  it('a failing step check never costs the wake its presence check', async () => {
    mockStepGoal.mockRejectedValueOnce(new Error('health store hung'));

    await expect(capturedTask(fenceRefresh())).resolves.toBeUndefined();

    expect(mockRunVisitCheck).toHaveBeenCalledTimes(1);
  });

  it('does not run for a payload that is not ours', async () => {
    await capturedTask({ data: { data: { type: 'something_else' } } });

    expect(mockStepGoal).not.toHaveBeenCalled();
    expect(mockWalk).not.toHaveBeenCalled();
  });
});

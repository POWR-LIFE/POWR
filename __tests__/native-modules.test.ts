// The two local native modules (modules/powr-visits, modules/powr-battery-state)
// are optional by design: each exists on one platform only, so every other
// runtime must see a quiet no-op, never a throw.

const mockRequireOptional = jest.fn();
jest.mock('expo', () => ({ requireOptionalNativeModule: (name: string) => mockRequireOptional(name) }));

function loadVisits() {
  let mod: typeof import('@/modules/powr-visits');
  jest.isolateModules(() => { mod = require('@/modules/powr-visits'); });
  return mod!;
}

function loadBattery() {
  let mod: typeof import('@/modules/powr-battery-state');
  jest.isolateModules(() => { mod = require('@/modules/powr-battery-state'); });
  return mod!;
}

beforeEach(() => mockRequireOptional.mockReset());

describe('powr-visits', () => {
  it('is a no-op where the native module is absent (Android, web, pre-1.6 binaries)', async () => {
    mockRequireOptional.mockReturnValue(null);
    const visits = loadVisits();
    expect(visits.isVisitMonitoringAvailable).toBe(false);
    await expect(visits.startVisitMonitoringAsync('t')).resolves.toBe(false);
    await expect(visits.stopVisitMonitoringAsync('t')).resolves.toBeUndefined();
    await expect(visits.hasStartedVisitMonitoringAsync('t')).resolves.toBe(false);
  });

  it('passes the task name through to the native module', async () => {
    const native = {
      startVisitMonitoringAsync: jest.fn().mockResolvedValue(undefined),
      stopVisitMonitoringAsync: jest.fn().mockResolvedValue(undefined),
      hasStartedVisitMonitoringAsync: jest.fn().mockResolvedValue(true),
    };
    mockRequireOptional.mockReturnValue(native);
    const visits = loadVisits();

    expect(mockRequireOptional).toHaveBeenCalledWith('PowrVisits');
    expect(visits.isVisitMonitoringAvailable).toBe(true);
    await expect(visits.startVisitMonitoringAsync('visit-task')).resolves.toBe(true);
    expect(native.startVisitMonitoringAsync).toHaveBeenCalledWith('visit-task');
    await expect(visits.hasStartedVisitMonitoringAsync('visit-task')).resolves.toBe(true);
    await visits.stopVisitMonitoringAsync('visit-task');
    expect(native.stopVisitMonitoringAsync).toHaveBeenCalledWith('visit-task');
  });
});

describe('powr-battery-state', () => {
  it('returns null where the native module is absent (iOS, web, pre-1.6 binaries)', () => {
    mockRequireOptional.mockReturnValue(null);
    expect(loadBattery().getBatteryState()).toBeNull();
  });

  it('returns the native state as-is', () => {
    const state = { ignoringBatteryOptimizations: false, backgroundRestricted: null, standbyBucket: 40, powerSaveMode: true };
    mockRequireOptional.mockReturnValue({ getState: () => state });
    const battery = loadBattery();
    expect(mockRequireOptional).toHaveBeenCalledWith('PowrBatteryState');
    expect(battery.getBatteryState()).toEqual(state);
  });

  it('never throws when the native call does', () => {
    mockRequireOptional.mockReturnValue({ getState: () => { throw new Error('boom'); } });
    expect(loadBattery().getBatteryState()).toBeNull();
  });
});

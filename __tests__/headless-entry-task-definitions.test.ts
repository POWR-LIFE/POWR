/**
 * Pins the headless-entry contract (fix/headless-entry-task-definitions):
 *
 * 1. Importing lib/headlessTasks alone — no React render, exactly what a
 *    headless boot executes — must define EVERY background task the native
 *    side has persisted. If a defineTask ever moves behind a component or
 *    provider import again, a swiped-away app boots, runs the bundle, defines
 *    nothing, and Android kills the "empty" process ~90 s later with the
 *    queued task events unflushed (bench-proven 2026-08-04).
 *
 * 2. index.ts must import lib/headlessTasks BEFORE expo-router/entry, and
 *    package.json "main" must point at index.ts — otherwise the shim exists
 *    but nothing executes it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('expo-task-manager', () => {
  const registry: Record<string, (body: unknown) => Promise<unknown>> = {};
  return {
    __registry: registry,
    defineTask: jest.fn((name: string, fn: (body: unknown) => Promise<unknown>) => {
      registry[name] = fn;
    }),
    isTaskRegisteredAsync: jest.fn().mockResolvedValue(true),
    unregisterTaskAsync: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('expo-background-fetch', () => ({
  BackgroundFetchResult: { NewData: 'new-data', NoData: 'no-data', Failed: 'failed' },
  registerTaskAsync: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 2 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue(null),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  hasStartedGeofencingAsync: jest.fn().mockResolvedValue(false),
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(false),
  startGeofencingAsync: jest.fn().mockResolvedValue(undefined),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  stopGeofencingAsync: jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  registerTaskAsync: jest.fn(),
  unregisterTaskAsync: jest.fn(),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3 },
  AndroidNotificationPriority: { HIGH: 'high', MAX: 'max', DEFAULT: 'default' },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    rpc: jest.fn(async () => ({ data: null, error: null })),
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
  },
  getSessionUser: jest.fn().mockResolvedValue(null),
}));

describe('headless entry task definitions', () => {
  it('importing lib/headlessTasks alone defines every persisted background task', () => {
    require('@/lib/headlessTasks');
    const registry = (jest.requireMock('expo-task-manager') as { __registry: Record<string, unknown> })
      .__registry;

    // The exact set TaskService restores natively on a headless boot
    // ("Registered task with name '…'" in logcat). Update BOTH this list and
    // lib/headlessTasks.ts when adding a task.
    expect(Object.keys(registry).sort()).toEqual(
      [
        'GEOFENCE_CHECK_IN',
        'POWR_BACKGROUND_NOTIFICATION',
        'POWR_GEOFENCE_BOOT_REARM',
        'POWR_LOCATION_TRACKING',
        'POWR_PLACEMENT_NOTIFY',
        'POWR_STEP_GOAL_NOTIFY',
        'powr-walking-sync',
      ].sort(),
    );
  });

  it('index.ts is the entry and imports headlessTasks before expo-router/entry', () => {
    const root = join(__dirname, '..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.main).toBe('index.ts');

    const entry = readFileSync(join(root, 'index.ts'), 'utf8');
    const headlessAt = entry.indexOf("import './lib/headlessTasks'");
    const routerAt = entry.indexOf("import 'expo-router/entry'");
    expect(headlessAt).toBeGreaterThanOrEqual(0);
    expect(routerAt).toBeGreaterThanOrEqual(0);
    expect(headlessAt).toBeLessThan(routerAt);
  });
});

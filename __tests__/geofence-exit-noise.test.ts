/**
 * Arm-burst exit noise must stop reaching geofence_region_events (2026-08-13).
 *
 * Measured in prod on the day of this change: 26,689 rows in the table, 21,895
 * of them (82%) `exit` rows for regions the user was never inside — Google Play
 * Services reporting INITIAL STATE for all ~50 fences within ~10 s of every arm.
 * Every consumer already discarded them at read time (scripts/e2e-watch.sh pairs
 * exits against a prior enter; shared/liveops.ts collapses the arm burst), so
 * they were written, stored, purged and re-filtered for nobody.
 *
 * The two properties this file pins:
 *
 *   1. WE STILL SEE THE EXITS THAT MEAN SOMETHING — an exit for the region of an
 *      active session, or for the region we are approaching — and we still see,
 *      in aggregate, how many we threw away. "The OS never delivered an exit" and
 *      "we suppressed a meaningless one" must never become the same silence; that
 *      exact ambiguity hid a dead iOS wake path for 17 days.
 *
 *   2. PROCESSING IS UNTOUCHED. exitApproach / nativeExitRefuted /
 *      finalizeActiveGeofence run on exactly the conditions they ran on before.
 *      This is a telemetry change; a suppressed row must never cost a departure.
 *
 * Driven through the REAL callback captured from TaskManager.defineTask — the
 * same entry point the OS uses headlessly, which is the only place this fires.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { resetNativeEventDebounceForTests, rearmFencesFromWake } from '@/context/GeofenceContext';

const GEOFENCE_TASK_NAME = 'GEOFENCE_CHECK_IN';
const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const APPROACH_STATE_KEY = '@powr/approach_state';
const PENDING_CLAIMS_KEY = '@powr/pending_claims';
const EXIT_NOISE_KEY = '@powr/exit_noise_tally';

// The finish-hold guard (lib/taskFinishGuard) sleeps on REAL timers after each
// task body; under this file's fake timers that sleep never resolves. Its own
// behaviour is covered in task-finish-guard.test.ts — here we want the raw
// task body, exactly as before the guard existed.
jest.mock('@/lib/taskFinishGuard', () => ({
  defineTask: (name: string, fn: (body: any) => Promise<unknown>) =>
    (jest.requireMock('expo-task-manager') as any).defineTask(name, fn),
}));

jest.mock('expo-task-manager', () => {
  const registry: Record<string, (body: any) => Promise<unknown>> = {};
  return {
    __registry: registry,
    defineTask: jest.fn((name: string, fn: (body: any) => Promise<unknown>) => { registry[name] = fn; }),
    isTaskRegisteredAsync: jest.fn().mockResolvedValue(true),
  };
});
const mockTasks = (jest.requireMock('expo-task-manager') as any).__registry as
  Record<string, (body: any) => Promise<unknown>>;

jest.mock('expo-background-fetch', () => ({
  BackgroundFetchResult: { NewData: 'new-data', Failed: 'failed' },
  registerTaskAsync: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 2 },
  ActivityType: { Other: 1, AutomotiveNavigation: 2, Fitness: 3, OtherNavigation: 4, Airborne: 5 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue(null),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  hasStartedGeofencingAsync: jest.fn().mockResolvedValue(true),
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(false),
  startGeofencingAsync: jest.fn().mockResolvedValue(undefined),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  stopGeofencingAsync: jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/device', () => ({ getDeviceId: jest.fn().mockResolvedValue('device-1') }));
jest.mock('@/lib/gymDwellConfig', () => ({
  getGymDwellMinutes: () => 30,
  getGymUpgradeMinutes: () => 40,
  getLocationCloseMode: () => 'on',
  primeGymDwellMinutes: jest.fn().mockResolvedValue(30),
  refreshGymDwellMinutes: jest.fn().mockResolvedValue(30),
}));
jest.mock('@/lib/notifications', () => ({
  notifyCheckInAvailable:    jest.fn().mockResolvedValue(undefined),
  notifySessionCompleted:    jest.fn().mockResolvedValue(undefined),
  notifySessionUpgraded:     jest.fn().mockResolvedValue(undefined),
  scheduleRewardWithinReach: jest.fn().mockResolvedValue(undefined),
}));

const mockRpc = jest.fn(async () => ({ data: null, error: null }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-1', email: 'test@example.com' } } },
        error: null,
      }),
    },
    from: () => {
      const builder: any = { then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r) };
      ['select', 'insert', 'update', 'eq', 'gte', 'order', 'limit'].forEach(m => { builder[m] = jest.fn(() => builder); });
      builder.single = jest.fn(async () => ({ data: null, error: null }));
      builder.maybeSingle = jest.fn(async () => ({ data: null, error: null }));
      return builder;
    },
    rpc: (...a: any[]) => (mockRpc as jest.Mock)(...a),
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
  },
}));

/** The OS EXIT, delivered exactly as the geofencing task receives it. */
const driveExit = (regionId: string) =>
  mockTasks[GEOFENCE_TASK_NAME]({ data: { eventType: 2, region: { identifier: regionId } }, error: null });

/** logRegionEvent rides a fire-and-forget dynamic import — flush it. */
async function flushTelemetry() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const regionRows = (event: string) =>
  (mockRpc.mock.calls as any[][])
    .filter(([fn, args]) => fn === 'log_geofence_region_event' && args?.p_event === event)
    .map(([, args]) => args);

/** A session already past the upgrade threshold, so nativeExitRefuted's bounded
 *  verification never runs and the exit path stays deterministic. */
function activeSession(regionId: string) {
  return {
    partnerId: 'partner-1',
    partnerName: 'Test Gym',
    regionId,
    entryTimestamp: Date.now() - 65 * 60 * 1000,
    latitude: 51.5,
    longitude: -0.12,
    radius: 25,
  };
}

const tally = async () => JSON.parse((await AsyncStorage.getItem(EXIT_NOISE_KEY)) ?? 'null');

beforeEach(async () => {
  jest.clearAllMocks();
  resetNativeEventDebounceForTests();
  await AsyncStorage.clear();
});

describe('meaningful exits are still logged, and still processed', () => {
  it('an exit for the ACTIVE session\'s own region logs the row and ends the visit', async () => {
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify(activeSession('gym-a-0')));

    await driveExit('gym-a-0');
    await flushTelemetry();

    // (a) the row survives — this is the departure, the one exit anyone reads.
    const rows = regionRows('exit');
    expect(rows).toHaveLength(1);
    expect(rows[0].p_region_id).toBe('gym-a-0');
    expect(await AsyncStorage.getItem(EXIT_NOISE_KEY)).toBeNull();

    // (c) processing: finalizeActiveGeofence ran to completion — active state
    // cleared and the close queued durably, exactly as before the change.
    expect(await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY)).toBeNull();
    const pending = JSON.parse((await AsyncStorage.getItem(PENDING_CLAIMS_KEY))!);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ partnerId: 'partner-1', regionId: 'gym-a-0' });
  });

  it('an exit for the region we are APPROACHING logs the row and leaves the ring', async () => {
    // Walked up, never checked in, turned around. No session exists, so the only
    // thing that makes this exit informative is the approach state — stored by
    // enterApproach as { regionId, since }.
    await AsyncStorage.setItem(APPROACH_STATE_KEY, JSON.stringify({ regionId: 'gym-a-0', since: Date.now() - 60_000 }));

    await driveExit('gym-a-0');
    await flushTelemetry();

    expect(regionRows('exit')).toHaveLength(1);
    // Processing: exitApproach cleared the ring and returned the stream to baseline.
    expect(await AsyncStorage.getItem(APPROACH_STATE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(EXIT_NOISE_KEY)).toBeNull();
  });

  it('an unreadable active-session blob logs rather than suppresses', async () => {
    // A row we cannot justify is far cheaper than a departure we cannot see.
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, '{not json');

    await driveExit('gym-a-0');
    await flushTelemetry();

    expect(regionRows('exit')).toHaveLength(1);
    expect(await AsyncStorage.getItem(EXIT_NOISE_KEY)).toBeNull();
  });
});

describe('arm-burst exits are suppressed, and change nothing else', () => {
  it('an exit with no session and no approach writes no row at all', async () => {
    await driveExit('gym-far-away-0');
    await flushTelemetry();

    // (b) the 82% case: nothing written.
    expect(regionRows('exit')).toHaveLength(0);
    // But counted, so "suppressed" never masquerades as "never delivered".
    expect(await tally()).toMatchObject({ count: 1 });
  });

  it('a neighbouring region\'s initial-state exit is suppressed WITHOUT touching the live visit', async () => {
    // The real field shape: a session is open at gym-a-0 and the arm burst
    // delivers exits for the other 49 fences. Suppression must not change one
    // byte of what those events DO.
    const active = activeSession('gym-a-0');
    await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify(active));
    await AsyncStorage.setItem(APPROACH_STATE_KEY, JSON.stringify({ regionId: 'gym-a-0', since: Date.now() }));

    await driveExit('gym-b-0');
    await flushTelemetry();

    expect(regionRows('exit')).toHaveLength(0);
    expect(await tally()).toMatchObject({ count: 1 });

    // (c) processing, unchanged: finalizeActiveGeofence('gym-b-0') refuses to end
    // another region's session, and exitApproach('gym-b-0') refuses to clear
    // another region's ring. Both are the pre-existing guards, still firing.
    expect(JSON.parse((await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY))!)).toEqual(active);
    expect(await AsyncStorage.getItem(PENDING_CLAIMS_KEY)).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(APPROACH_STATE_KEY))!)).toMatchObject({ regionId: 'gym-a-0' });
  });

  it('a whole 5-fence burst produces zero rows while it is arriving', async () => {
    for (let i = 0; i < 5; i++) await driveExit(`gym-burst-${i}-0`);
    await flushTelemetry();

    expect(regionRows('exit')).toHaveLength(0);
    // Throttled: nothing shipped mid-storm, one running tally instead.
    expect(regionRows('exit_noise_suppressed')).toHaveLength(0);
    expect(await tally()).toMatchObject({ count: 5 });
  });
});

describe('the tally ships as exactly one summary row', () => {
  it('the next arm attempt drains the burst into a single exit_noise_suppressed row', async () => {
    for (let i = 0; i < 5; i++) await driveExit(`gym-burst-${i}-0`);
    await flushTelemetry();
    jest.clearAllMocks();

    // Any arm attempt drains — including one the background rule refuses, which
    // is why the flush sits above every early return in armNativeRegions.
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    try {
      await rearmFencesFromWake();
      await flushTelemetry();
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
    }

    const rows = regionRows('exit_noise_suppressed');
    expect(rows).toHaveLength(1);
    expect(rows[0].p_region_id).toBe('arm');
    expect(rows[0].p_detail).toMatchObject({ count: 5 });
    expect(rows[0].p_detail.window_s).toEqual(expect.any(Number));
    expect(await AsyncStorage.getItem(EXIT_NOISE_KEY)).toBeNull();
  });

  it('an aged tally ships on the next suppressed exit, and a fresh window starts', async () => {
    jest.useFakeTimers();
    try {
      for (let i = 0; i < 3; i++) await driveExit(`gym-burst-${i}-0`);
      await flushTelemetry();
      expect(regionRows('exit_noise_suppressed')).toHaveLength(0);

      await jest.advanceTimersByTimeAsync(61_000);
      await driveExit('gym-later-0');
      await flushTelemetry();

      const rows = regionRows('exit_noise_suppressed');
      expect(rows).toHaveLength(1);
      // The aged batch, not the event that shipped it — that one opens the
      // next window, so window_s always describes the burst it counts.
      expect(rows[0].p_detail).toMatchObject({ count: 3, window_s: 61 });
      expect(await tally()).toMatchObject({ count: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  // ⚠ THE FIELD BUG THIS AGGREGATION WAS SUPPOSED TO PREVENT, 2026-08-17.
  //
  // Every other case in this file awaits each exit in turn, so none of them ever
  // exercised the way the EXIT branch actually calls this:
  // `void noteSuppressedExit(regionId)`. Concurrently, all N callers read the same
  // aged tally and all N shipped it — **17 identical `{count: 4, window_s: 1243}`
  // rows in 3 seconds** on one arm burst, with all 17 increments lost. The row
  // count is the assertion that matters: aggregate telemetry that duplicates is
  // worse than none, because a server-side exit accelerator would read this table
  // as truth.
  it('a burst of UNAWAITED exits against an aged tally still ships exactly one row', async () => {
    jest.useFakeTimers();
    try {
      for (let i = 0; i < 4; i++) await driveExit(`gym-burst-${i}-0`);
      await flushTelemetry();
      expect(regionRows('exit_noise_suppressed')).toHaveLength(0);

      await jest.advanceTimersByTimeAsync(61_000);

      // Fire them all off without awaiting between — the real call shape.
      const inFlight = Array.from({ length: 17 }, (_, i) => driveExit(`gym-storm-${i}-0`));
      await Promise.all(inFlight);
      // The handler itself calls `void noteSuppressedExit(...)`, so awaiting the
      // handlers does NOT await the tally writes — they are still queued on the
      // serialising chain. Drain generously: 17 chained storage round-trips.
      for (let i = 0; i < 500; i++) await Promise.resolve();
      await flushTelemetry();

      const rows = regionRows('exit_noise_suppressed');
      expect(rows).toHaveLength(1);
      expect(rows[0].p_detail).toMatchObject({ count: 4 });
      // And not one of the 17 was dropped on the floor while they raced.
      expect(await tally()).toMatchObject({ count: 17 });
    } finally {
      jest.useRealTimers();
    }
  });
});

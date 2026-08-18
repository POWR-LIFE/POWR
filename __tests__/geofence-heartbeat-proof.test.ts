/**
 * The stream heartbeat is now a PROOF writer (2026-08-17 PM).
 *
 * Field run 08-17: both platforms froze their proof clocks while their location
 * streams were still holding creditable fixes, because every writer of
 * last_proven_at sat downstream of a DELIVERED push — and on iOS nothing was
 * delivered for eleven minutes. close_gym_visit then clamped ended_at to the
 * frozen clock: iOS 44.8 min recorded against ~54.8 elapsed.
 *
 * The heartbeat was already making one round-trip every 5 minutes and spending
 * it on `stream_tick`, a row that says only "the stream is alive". When the fix
 * would credit presence, that same round-trip is now a confirm — the device-side
 * proof writer the system has never had, at zero extra cost, bounding the tail
 * loss at 5 minutes instead of leaving it unbounded.
 *
 * heartbeatVisitStream is module-private, so it is driven the way the OS drives
 * it: through the registered POWR_LOCATION_TRACKING callback.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

const LOCATION_TRACKING_TASK = 'POWR_LOCATION_TRACKING';
const ACTIVE_GEOFENCE_KEY = '@powr/active_geofence';
const LAST_WAKE_AT_KEY = '@powr/last_wake_processed_at';
const VISIT_TICK_KEY = '@powr/last_visit_tick';

const GYM = { lat: 52.1244, lng: -1.764, radius: 25 };

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
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(true),
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

const mockConfirmGymVisit = jest.fn(async () => ({ ok: true, triggered: null }));
const mockLogGymVisitTick = jest.fn(async () => {});
jest.mock('@/lib/gymVisits', () => ({
  confirmGymVisit:            (...a: any[]) => (mockConfirmGymVisit as jest.Mock)(...a),
  confirmGymVisitViaNonce:    jest.fn(async () => ({ ok: true, triggered: null })),
  openGymVisit:               jest.fn(async () => null),
  closeGymVisit:              jest.fn(async () => {}),
  logGymVisitTick:            (...a: any[]) => (mockLogGymVisitTick as jest.Mock)(...a),
  logGymWakeReceived:         jest.fn(async () => {}),
  logGymWakeReceivedViaNonce: jest.fn(async () => {}),
  logGeofenceRegionEvent:     jest.fn(async () => {}),
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

const mockLocation = Location as jest.Mocked<typeof Location>;

// The credit test is spied through its real implementation — test 14 is about
// what it RECEIVES. This works only because jest.config.js compiles dynamic
// imports to require(), so the `await import(...)` inside the heartbeat resolves
// to this mock.
const mockFixCreditsPresence = jest.fn();
jest.mock('@/lib/health/gymPresence', () => {
  const actual = jest.requireActual('@/lib/health/gymPresence');
  return { ...actual, fixCreditsPresence: (...a: any[]) => mockFixCreditsPresence(...a) };
});

import { resetSelfPollThrottleForTests, resetVisitTickThrottleForTests } from '@/context/GeofenceContext';

const seedActiveVisit = () => AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
  regionId:       'partner-home-0',
  partnerId:      'partner-home',
  visitId:        'visit-1',
  latitude:       GYM.lat,
  longitude:      GYM.lng,
  radius:         GYM.radius,
  entryTimestamp: Date.now() - 35 * 60_000,
}));

const driveStreamFix = (accuracy: number, ageMs: number) =>
  mockTasks[LOCATION_TRACKING_TASK]({
    data: { locations: [{
      coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy },
      timestamp: Date.now() - ageMs,
    }] },
    error: null,
  });

describe('heartbeatVisitStream — the stream tick that proves presence', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    // ⚠ BOTH halves of the throttle, or the second case in any run silently
    // returns before anything observable happens (and the bare catch hides it).
    resetVisitTickThrottleForTests();
    resetSelfPollThrottleForTests();
    (globalThis as any).__DEV__ = false;
    const actual = jest.requireActual('@/lib/health/gymPresence');
    mockFixCreditsPresence.mockImplementation(actual.fixCreditsPresence);
    // A recent wake, so selfPollIfWakeStarved stays out of the way. Without it
    // this fixture (35 min in, no wake ever recorded) IS the starved case and
    // that watchdog fires its own confirm alongside the heartbeat's.
    await AsyncStorage.setItem(LAST_WAKE_AT_KEY, String(Date.now()));
    await seedActiveVisit();
  });

  it('spends its round-trip on a confirm when the fix credits presence', async () => {
    await driveStreamFix(20, 10_000);

    expect(mockConfirmGymVisit).toHaveBeenCalledTimes(1);
    const [visitId, inside, detail] = mockConfirmGymVisit.mock.calls[0] as any[];
    expect(visitId).toBe('visit-1');
    expect(inside).toBe(true);
    expect(detail.stage).toBe('stream');
    expect(detail.source).toBe('heartbeat');
    expect(detail.fix_age_s).toBe(10);
    // The server reads `fix_age_s`. `fix_age_ms` is silently ignored, which is
    // how a sibling path bypassed the freshness gate entirely for weeks.
    expect(detail).not.toHaveProperty('fix_age_ms');
    // One writer per tick, not two.
    expect(mockLogGymVisitTick).not.toHaveBeenCalled();
  });

  it('never relays a claim — request_credit stays false', async () => {
    await driveStreamFix(20, 10_000);

    expect((mockConfirmGymVisit.mock.calls[0] as any[])[3]).toBe(false);
  });

  it('keeps the liveness row on a fix that cannot prove anything', async () => {
    // Coarse (300 m) — the stream IS alive, and that is the one thing the server
    // cannot otherwise see, so the tick must survive on this branch.
    await driveStreamFix(300, 10_000);

    expect(mockLogGymVisitTick).toHaveBeenCalledTimes(1);
    expect(mockConfirmGymVisit).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(VISIT_TICK_KEY)).toBeNull();
  });

  it('passes a MEASURED age to the credit test, which previously had none', async () => {
    // This call site was the only fixCreditsPresence caller in the repo omitting
    // the age — so the local credit floor had no freshness test at all, the exact
    // defect closed server-side on 2026-08-10 and left open here.
    await driveStreamFix(20, 10_000);

    expect(mockFixCreditsPresence).toHaveBeenCalledWith(
      expect.objectContaining({ fixAgeMs: expect.any(Number) }),
    );
    const { fixAgeMs } = (mockFixCreditsPresence.mock.calls[0] as any[])[0];
    expect(fixAgeMs).toBeGreaterThanOrEqual(10_000);
  });

  it('refuses to bank a batched fix older than the credit window', async () => {
    // A batched OS delivery can hand JS a fix minutes old. Precise and nearby
    // describes the FIX; only its age says when that was true. 219 s is the
    // 2026-08-10 number — proof stamped four minutes after the user left.
    await driveStreamFix(20, 219_000);

    expect(mockConfirmGymVisit).not.toHaveBeenCalled();
    expect(mockLogGymVisitTick).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(VISIT_TICK_KEY)).toBeNull();
  });

  it('stamps the local credit floor only on the crediting branch', async () => {
    await driveStreamFix(20, 10_000);

    expect(await AsyncStorage.getItem(VISIT_TICK_KEY)).not.toBeNull();
  });
});

describe('selfPollIfWakeStarved — the watchdog measures its fix too', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    resetVisitTickThrottleForTests();
    resetSelfPollThrottleForTests();
    (globalThis as any).__DEV__ = false;
    const actual = jest.requireActual('@/lib/health/gymPresence');
    mockFixCreditsPresence.mockImplementation(actual.fixCreditsPresence);
    // No LAST_WAKE_AT_KEY: 35 minutes in with no wake ever processed is the
    // starved case this watchdog exists for.
    await seedActiveVisit();
  });

  it('sends fix_age_s, the key the server actually reads', async () => {
    // It used to send `fix_age_ms: 0` — a key confirm_gym_visit_v2 does not read,
    // so v_fix_age_s was always NULL and the 120 s gate never fired once, on the
    // single writer that also asks the server to relay a claim.
    await driveStreamFix(20, 10_000);

    const selfPoll = (mockConfirmGymVisit.mock.calls as any[][])
      .find(([, , d]) => d?.source === 'wake_starved_self_poll');
    expect(selfPoll).toBeDefined();
    expect(selfPoll![2].fix_age_s).toBe(10);
    expect(selfPoll![2]).not.toHaveProperty('fix_age_ms');
    // This one DOES relay credit — that is its whole job.
    expect(selfPoll![3]).toBe(true);
  });

  it('refuses to self-poll on a batched fix older than the credit window', async () => {
    // ⚠ THIS TEST WAS VACUOUS UNTIL resetSelfPollThrottleForTests EXISTED. The
    // preceding case stamps `_lastSelfPollAt`, whose 10-minute gate sits 23 lines
    // ABOVE the age check — so without the reset this passed identically with the
    // age gate deleted. Guarded now by the sibling case below: flip the age and
    // the watchdog must fire, or this one is proving nothing again.
    await driveStreamFix(20, 219_000);

    expect((mockConfirmGymVisit.mock.calls as any[][])
      .some(([, , d]) => d?.source === 'wake_starved_self_poll')).toBe(false);
  });

  it('DOES self-poll on a fresh fix — the control that keeps the case above honest', async () => {
    await driveStreamFix(20, 10_000);

    expect((mockConfirmGymVisit.mock.calls as any[][])
      .some(([, , d]) => d?.source === 'wake_starved_self_poll')).toBe(true);
  });
});

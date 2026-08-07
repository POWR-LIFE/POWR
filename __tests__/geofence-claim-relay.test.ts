/**
 * Background claims/upgrades must ride the REST relay, never functions.invoke.
 *
 * Field truth (six captures, 2026-07-14): while the app is backgrounded on
 * Android, REST/RPC requests reach the server but a client call to
 * /functions/v1/* NEVER arrives — the 30-min claim and 40-min upgrade only
 * completed on app-open. The fix relays the trigger through SECURITY DEFINER
 * RPCs (relay_gym_claim / relay_gym_upgrade) on the proven REST path; pg_net
 * invokes the edge function server-to-server.
 *
 * These tests pin the routing and the resolution loop:
 *   - backgrounded → relay RPC, and the doomed invoke is never attempted;
 *   - 'accepted' keeps pointsPending so a later tick re-checks;
 *   - the later tick's 'already_claimed' / 'already_done' finalizes the state;
 *   - foreground keeps the direct invoke (its rich response drives the
 *     within-reach nudge + local push fallback);
 *   - the wake handler prefers a ≤60 s cached fix (a fresh GPS acquisition
 *     outlives the ~10 s execution window an FCM wake grants mid-Doze).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { runVisitCheck, ACTIVE_GEOFENCE_KEY } from '@/context/GeofenceContext';

jest.mock('expo-task-manager', () => {
  const registry: Record<string, unknown> = {};
  return {
    __registry: registry,
    defineTask: jest.fn((name: string, fn: unknown) => { registry[name] = fn; }),
    isTaskRegisteredAsync: jest.fn().mockResolvedValue(true),
  };
});

jest.mock('expo-background-fetch', () => ({
  BackgroundFetchResult: { NewData: 'new-data', Failed: 'failed' },
  registerTaskAsync: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 2 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  hasStartedGeofencingAsync: jest.fn().mockResolvedValue(true),
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(true),
  startGeofencingAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopGeofencingAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));

jest.mock('@/lib/device', () => ({ getDeviceId: jest.fn().mockResolvedValue('device-1') }));

jest.mock('@/lib/gymDwellConfig', () => ({
  getGymDwellMinutes: () => 30,
  getGymUpgradeMinutes: () => 40,
  primeGymDwellMinutes: jest.fn().mockResolvedValue(30),
  refreshGymDwellMinutes: jest.fn().mockResolvedValue(30),
}));

jest.mock('@/lib/notifications', () => ({
  notifyCheckInAvailable: jest.fn().mockResolvedValue(undefined),
  notifySessionCompleted: jest.fn().mockResolvedValue(undefined),
  notifySessionUpgraded: jest.fn().mockResolvedValue(undefined),
  scheduleRewardWithinReach: jest.fn().mockResolvedValue(undefined),
}));

const mockRpc = jest.fn();
/** activity_sessions behaviour, per test. Defaults reproduce a clean insert. */
const mockSessionTable: { insertError: unknown; existingRow: Record<string, unknown> | null } = {
  insertError: null,
  existingRow: { id: 'session-abc' },
};
const mockSessionUpdate = jest.fn();
const mockInvoke = jest.fn().mockResolvedValue({
  data: { earned: 30, push_delivered: true, within_reach: null },
  error: null,
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-1', email: 'jamiemasonwright@gmail.com' }, access_token: 't' } },
        error: null,
      }),
    },
    rpc: (...a: any[]) => (mockRpc as jest.Mock)(...a),
    from: () => {
      const builder: any = {
        select: () => builder,
        insert: () => { builder.__insert = true; return builder; },
        update: (patch: unknown) => { mockSessionUpdate(patch); return builder; },
        eq: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        single: async () => (builder.__insert && mockSessionTable.insertError
          ? { data: null, error: mockSessionTable.insertError }
          : { data: mockSessionTable.existingRow, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: null, count: 0, error: null }).then(res, rej),
      };
      return builder;
    },
    functions: { invoke: (...a: any[]) => (mockInvoke as jest.Mock)(...a) },
  },
}));

const GYM = { lat: 51.5, lng: -0.12, radius: 25 };
const getFix = Location.getCurrentPositionAsync as jest.Mock;
const getCached = Location.getLastKnownPositionAsync as jest.Mock;

async function seedVisit(extra: Record<string, unknown> = {}) {
  await AsyncStorage.setItem(ACTIVE_GEOFENCE_KEY, JSON.stringify({
    partnerId: 'partner-1',
    partnerName: 'Xtreme Gym',
    regionId: 'partner-1-0',
    visitId: 'visit-1',
    entryTimestamp: Date.now() - 35 * 60 * 1000,
    latitude: GYM.lat,
    longitude: GYM.lng,
    radius: GYM.radius,
    ...extra,
  }));
}

const readState = async () => JSON.parse((await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY))!);
const invoked = (fn: string) => mockInvoke.mock.calls.some(c => c[0] === fn);
const relayCalls = (fn: string) => mockRpc.mock.calls.filter(c => c[0] === fn);

/** rpc mock: relay answers per `relays`, every other RPC (confirm/tick/mark) no-ops. */
function armRpc(relays: Record<string, unknown>) {
  mockRpc.mockImplementation((fn: string) =>
    Promise.resolve(fn in relays ? { data: relays[fn], error: null } : { data: null, error: null }));
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockSessionTable.insertError = null;
  mockSessionTable.existingRow = { id: 'session-abc' };
  await AsyncStorage.clear();
  (globalThis as any).__DEV__ = false;
  (AppState as any).currentState = 'background';
  getFix.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 10 } });
  getCached.mockResolvedValue(null);
  armRpc({});
});

afterEach(() => {
  (globalThis as any).__DEV__ = true;
  (AppState as any).currentState = 'active';
  jest.useRealTimers();
});

describe('backgrounded claim rides the relay, never the invoke', () => {
  it("relays through relay_gym_claim and keeps pointsPending until it's proven", async () => {
    await seedVisit();
    armRpc({ relay_gym_claim: { status: 'accepted' } });

    await runVisitCheck('dwell');

    expect(invoked('claim-points')).toBe(false);
    expect(relayCalls('relay_gym_claim')).toEqual([
      ['relay_gym_claim', { p_session_id: 'session-abc', p_visit_id: 'visit-1' }],
    ]);
    const state = await readState();
    expect(state.sessionRecorded).toBe(true);
    expect(state.pointsPending).toBe(true); // resolved by a later tick's relay
  });

  it("a later tick's 'already_claimed' finalizes the session", async () => {
    await seedVisit({ sessionRecorded: true, pointsPending: true });
    armRpc({ relay_gym_claim: { status: 'already_claimed' } });

    await runVisitCheck('dwell');

    expect(invoked('claim-points')).toBe(false);
    const state = await readState();
    expect(state.sessionId).toBe('session-abc');
    expect(state.pointsPending).toBe(false);
  });

  it('a relay failure falls back to the ordinary retry queue', async () => {
    await seedVisit();
    mockRpc.mockImplementation((fn: string) =>
      Promise.resolve(fn === 'relay_gym_claim'
        ? { data: null, error: { message: 'boom' } }
        : { data: null, error: null }));

    await runVisitCheck('dwell');

    expect((await readState()).pointsPending).toBe(true);
  });
});

// One gym session per user per UTC day is a unique index, so a second visit and
// every stale retry all land on the SAME row. Last-writer-wins turned that into a
// wedge on 2026-08-06: an exited 29m51s attempt kept relaying its own frozen
// length, rewriting the row below the 30-minute eligibility minimum every few
// minutes, and the server answered 422 every time — while a live 43-minute visit
// sat unclaimable behind it. The day's row must describe the LONGEST verified
// stay, not the most recent writer.
describe("the day's session row only ever grows", () => {
  it('extends the existing row when this stay is longer', async () => {
    mockSessionTable.insertError = { code: '23505', message: 'duplicate key' };
    mockSessionTable.existingRow = { id: 'session-abc', duration_sec: 1791 };
    await seedVisit(); // 35 minutes, i.e. longer than the 29m51s already stored
    armRpc({ relay_gym_claim: { status: 'accepted' } });

    await runVisitCheck('dwell');

    expect(mockSessionUpdate).toHaveBeenCalledTimes(1);
    expect(mockSessionUpdate.mock.calls[0][0].duration_sec).toBeGreaterThan(1791);
    expect(relayCalls('relay_gym_claim')).toHaveLength(1);
  });

  it('leaves a longer row alone when a stale short retry lands on it', async () => {
    mockSessionTable.insertError = { code: '23505', message: 'duplicate key' };
    mockSessionTable.existingRow = { id: 'session-abc', duration_sec: 43 * 60 };
    // The zombie: exited at 29m51s, its end time frozen, retrying forever.
    const entry = Date.now() - 120 * 60 * 1000;
    await seedVisit({ entryTimestamp: entry, endedAtMs: entry + 1791 * 1000 });
    armRpc({ relay_gym_claim: { status: 'accepted' } });

    await runVisitCheck('dwell');

    expect(mockSessionUpdate).not.toHaveBeenCalled();
    // Still claims the row — it is eligible on its own merits now.
    expect(relayCalls('relay_gym_claim')).toEqual([
      ['relay_gym_claim', { p_session_id: 'session-abc', p_visit_id: 'visit-1' }],
    ]);
  });
});

// The presence-sweep ping borrows the nonce field ('fence-refresh') purely to
// select the auth-free wake path — it is not scoped to any visit. Confirming a
// locally-stored visit with it is guaranteed to fail, and did: two
// `confirm_gym_visit_v3 400 invalid or expired wake nonce` per iPhone per ping
// once a session was live (field 2026-08-07). It must be treated as a wake, not
// a ticket — and dropping it must NOT re-open the awaited-auth door, because a
// wake that awaits auth is the original freeze class.
describe('the sweep ping is a wake, not a ticket', () => {
  it('never confirms a visit with the placeholder nonce', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }));
    const priorFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = fetchSpy;
    await seedVisit();
    armRpc({});

    try {
      await runVisitCheck('dwell', undefined, 'fence-refresh');
    } finally {
      (globalThis as any).fetch = priorFetch;
    }

    const confirms = fetchSpy.mock.calls.filter(([url]: any[]) => String(url).includes('confirm_gym_visit'));
    expect(confirms).toHaveLength(0);
    // The auth half of this guard (isSweepPing must also suppress the awaited
    // ensureFreshSession) is enforced in the source and reviewed there; this
    // suite does not mock authFresh, so asserting it here would be theatre.
  });

  it('still confirms normally when the nonce is a real ticket', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }));
    const priorFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = fetchSpy;
    await seedVisit();
    armRpc({});

    try {
      await runVisitCheck('dwell', 'visit-1', 'a-real-ticket');
    } finally {
      (globalThis as any).fetch = priorFetch;
    }

    const confirms = fetchSpy.mock.calls.filter(([url]: any[]) => String(url).includes('confirm_gym_visit'));
    expect(confirms.length).toBeGreaterThan(0);
  });
});

describe('backgrounded upgrade rides the relay', () => {
  it("'accepted' leaves tierUpgraded unset; the next tick's 'already_done' completes it", async () => {
    await seedVisit({
      sessionRecorded: true,
      sessionId: 'session-abc',
      entryTimestamp: Date.now() - 45 * 60 * 1000,
    });
    armRpc({ relay_gym_upgrade: { status: 'accepted' } });

    await runVisitCheck('upgrade');
    expect(invoked('upgrade-gym-tier')).toBe(false);
    expect(relayCalls('relay_gym_upgrade').length).toBe(1);
    expect((await readState()).tierUpgraded).toBeFalsy();

    armRpc({ relay_gym_upgrade: { status: 'already_done' } });
    await runVisitCheck('upgrade');
    expect((await readState()).tierUpgraded).toBe(true);
  });
});

describe('a wake window is never wasted on a pre-window zombie', () => {
  // Field capture 2026-07-14 evening: cron wakes (:01) and stream ticks (:32)
  // are permanently out of phase — every wake found a <2-min-old hung attempt
  // from the previous tick, honoured its lease/grace, and left empty-handed;
  // the retry it queued then ran on the next tick, outside any radio window.
  // Wakes #2–#4 were all lost this way. Inside a wake window the lease AND the
  // no-outcome grace shrink to seconds, and the heal retries immediately.
  it('heals a 30s-old no-outcome attempt and relays inside the SAME wake', async () => {
    jest.useFakeTimers();
    await seedVisit();
    // Wake 1: the relay call hangs forever (radio died mid-request) — leaving
    // sessionRecorded, a fresh claimAttemptAt, and a held lock.
    mockRpc.mockImplementation((fn: string) =>
      fn === 'relay_gym_claim'
        ? new Promise(() => { /* hung; timers frozen while backgrounded */ })
        : Promise.resolve({ data: null, error: null }));
    const hung = runVisitCheck('dwell');
    await jest.advanceTimersByTimeAsync(0);

    // 30 s later the next wake arrives (clock moves, timers stay frozen).
    jest.setSystemTime(Date.now() + 30_000);
    armRpc({ relay_gym_claim: { status: 'accepted' } });
    await runVisitCheck('dwell');

    // Under the old 2-min lease/grace this wake would have skipped entirely.
    expect(relayCalls('relay_gym_claim').length).toBe(2);
    expect((await readState()).pointsPending).toBe(true); // resolved by a later relay
    void hung; // zombie stays pending; its fenced release cannot free the thief's lock
  });
});

describe('foreground keeps the direct invoke', () => {
  it('claims via claim-points when the app is active', async () => {
    (AppState as any).currentState = 'active';
    await seedVisit();

    await runVisitCheck('dwell');

    expect(invoked('claim-points')).toBe(true);
    expect(relayCalls('relay_gym_claim').length).toBe(0);
    expect((await readState()).sessionId).toBe('session-abc');
  });
});

describe('the wake handler is cached-fix-first', () => {
  it('uses a fresh cached fix without acquiring GPS', async () => {
    await seedVisit({ sessionRecorded: true, sessionId: 'session-abc', tierUpgraded: true });
    getCached.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 20 } });

    await runVisitCheck('dwell');

    expect(getCached).toHaveBeenCalledWith({ maxAge: 60_000 });
    expect(getFix).not.toHaveBeenCalled();
  });

  it('falls back to a fresh acquisition when nothing is cached', async () => {
    await seedVisit({ sessionRecorded: true, sessionId: 'session-abc', tierUpgraded: true });
    getCached.mockResolvedValue(null);

    await runVisitCheck('dwell');

    expect(getFix).toHaveBeenCalled();
  });
});

const LAST_STREAM_FIX_KEY = '@powr/last_stream_fix';
const STREAM_FIX_MAX_AGE_MS = 5 * 60 * 1000;

describe('the wake handler prefers the stream-persisted fix (stream-fix-first)', () => {
  it('uses a fresh stream fix without calling expo-location at all', async () => {
    await seedVisit({ sessionRecorded: true, sessionId: 'session-abc', tierUpgraded: true });
    await AsyncStorage.setItem(LAST_STREAM_FIX_KEY, JSON.stringify({
      latitude: GYM.lat,
      longitude: GYM.lng,
      accuracy: 15,
      at: Date.now() - 30_000, // 30 s old — well within STREAM_FIX_MAX_AGE_MS
    }));

    await runVisitCheck('dwell');

    expect(getCached).not.toHaveBeenCalled();
    expect(getFix).not.toHaveBeenCalled();
  });

  it('falls back to lastKnown when the stream fix is stale', async () => {
    await seedVisit({ sessionRecorded: true, sessionId: 'session-abc', tierUpgraded: true });
    await AsyncStorage.setItem(LAST_STREAM_FIX_KEY, JSON.stringify({
      latitude: GYM.lat,
      longitude: GYM.lng,
      accuracy: 15,
      at: Date.now() - (STREAM_FIX_MAX_AGE_MS + 10_000), // older than the cutoff
    }));
    getCached.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 20 } });

    await runVisitCheck('dwell');

    expect(getCached).toHaveBeenCalled();
  });

  it('falls back to lastKnown when the stream fix is absent', async () => {
    await seedVisit({ sessionRecorded: true, sessionId: 'session-abc', tierUpgraded: true });
    // No LAST_STREAM_FIX_KEY in AsyncStorage (cleared by beforeEach).
    getCached.mockResolvedValue({ coords: { latitude: GYM.lat, longitude: GYM.lng, accuracy: 20 } });

    await runVisitCheck('dwell');

    expect(getCached).toHaveBeenCalled();
    expect(getFix).not.toHaveBeenCalled();
  });
});

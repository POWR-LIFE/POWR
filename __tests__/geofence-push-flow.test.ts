/**
 * End-to-end cover for the geofence → notification chain: the native ENTER wake,
 * the 25 m check-in ("You're in" — LOCAL), the in-gym dwell claim that hands the
 * "Session recorded" push to the server, the on-device fallback when the server
 * says it could not deliver, and the EXIT that closes the visit.
 *
 * The test drives the REAL background task callbacks (captured from
 * TaskManager.defineTask) rather than calling internals, so it exercises the same
 * entry points the OS uses when the app is closed — which is exactly where the
 * missed-notification reports come from.
 *
 * The signed-in user is jamiemasonwright@gmail.com on purpose: that address is in
 * GeofenceContext's DEV_TEST_EMAILS, so the once-per-day check-in guard is
 * bypassed and the flow can be replayed on demand during a real field test.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { ACTIVE_GEOFENCE_KEY, CHECKIN_POLL, resetNativeEventDebounceForTests } from '@/context/GeofenceContext';

// The ENTER branch awaits pollForCheckIn — deliberately, so the OS holds the task
// open while the user walks the last stretch to the 25 m radius. Drive it with zero
// waits here: the behaviour under test is the check-in decision, not the pacing,
// and the real ~90 s would blow Jest's timeout.
CHECKIN_POLL.intervalMs = 0;
CHECKIN_POLL.fixTimeoutMs = 0;

const GEOFENCE_TASK_NAME = 'GEOFENCE_CHECK_IN';
const LOCATION_TRACKING_TASK = 'POWR_LOCATION_TRACKING';
const PARTNER_MAP_KEY = '@powr/partner_map';
const PARTNER_MAP_META_KEY = '@powr/partner_map_meta';

const GYM = { dbId: 'partner-1', name: 'Xtreme Gym', lat: 51.5, lng: -0.12, radius: 25 };
const REGION_ID = 'partner-1-0';
const SESSION_ID = 'session-abc';

// The registry lives INSIDE the factory: GeofenceContext registers its tasks at
// import time, which runs before any const in this file is initialized.
jest.mock('expo-task-manager', () => {
  const registry: Record<string, (body: any) => Promise<unknown>> = {};
  return {
    __registry: registry,
    defineTask: jest.fn((name: string, fn: (body: any) => Promise<unknown>) => { registry[name] = fn; }),
    isTaskRegisteredAsync: jest.fn().mockResolvedValue(true),
  };
});

// Captured task callbacks, keyed by the name the module registers them under.
const mockTasks = (jest.requireMock('expo-task-manager') as any).__registry as
  Record<string, (body: any) => Promise<unknown>>;

jest.mock('expo-background-fetch', () => ({
  BackgroundFetchResult: { NewData: 'new-data', Failed: 'failed' },
  registerTaskAsync: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 2 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue(null),
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
  getLocationCloseMode: () => 'on',
  primeGymDwellMinutes: jest.fn().mockResolvedValue(30),
  refreshGymDwellMinutes: jest.fn().mockResolvedValue(30),
}));

const mockNotifyCheckIn = jest.fn().mockResolvedValue(undefined);
const mockNotifySessionCompleted = jest.fn().mockResolvedValue(undefined);
const mockNotifySessionUpgraded = jest.fn().mockResolvedValue(undefined);
const mockScheduleWithinReach = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/notifications', () => ({
  notifyCheckInAvailable:    (...a: unknown[]) => mockNotifyCheckIn(...a),
  notifySessionCompleted:    (...a: unknown[]) => mockNotifySessionCompleted(...a),
  notifySessionUpgraded:     (...a: unknown[]) => mockNotifySessionUpgraded(...a),
  scheduleRewardWithinReach: (...a: unknown[]) => mockScheduleWithinReach(...a),
}));

// claim-points' reply. Tests override this to model the server's push outcome.
let mockClaimResponse: { data: unknown; error: unknown } = {
  data: { earned: 30, push_delivered: true, within_reach: null },
  error: null,
};
const mockInvoke = jest.fn(async () => mockClaimResponse);

// The REST relay's replies, keyed by RPC name. Background claims/upgrades ride
// relay_gym_claim / relay_gym_upgrade (a functions.invoke never arrives from a
// backgrounded Android app — 2026-07-14); every other RPC (visit confirms,
// heartbeats, progress marks) is best-effort and no-ops here.
let mockRelayReplies: Record<string, unknown> = {};
const mockRpc = jest.fn(async (fn: string) =>
  fn in mockRelayReplies ? { data: mockRelayReplies[fn], error: null } : { data: null, error: null });

// Minimal PostgREST-style builder: chainable, and thenable so a query that ends
// without .single()/.maybeSingle() still resolves.
function mockQueryBuilder(table: string) {
  const state = { table, inserted: false };
  const result = () => {
    if (state.table === 'activity_sessions') {
      return state.inserted
        ? { data: { id: SESSION_ID }, error: null }
        : { data: null, count: 0, error: null }; // no gym session logged today
    }
    if (state.table === 'user_streaks') return { data: { current_streak: 12 }, error: null };
    return { data: null, error: null };
  };
  const builder: any = {
    select: jest.fn(() => builder),
    insert: jest.fn((payload: unknown) => { state.inserted = true; mockInserts.push({ table, payload }); return builder; }),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    gte: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    single: jest.fn(async () => result()),
    maybeSingle: jest.fn(async () => result()),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
  };
  return builder;
}

let mockInserts: { table: string; payload: any }[] = [];

// A healthy device carries a VALID persisted session through every wake — the
// storage-first auth contract (2026-08-12: rotation is foreground-only, so a
// background path that cannot read auth from storage now defers instead of
// rotating). Seeding it here is what a real signed-in device looks like.
const mockStoredSession = JSON.stringify({
  access_token: 't',
  refresh_token: 'rt',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'user-1', email: 'jamiemasonwright@gmail.com' },
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-1', email: 'jamiemasonwright@gmail.com' } } },
        error: null,
      }),
    },
    from: (table: string) => mockQueryBuilder(table),
    rpc: (...a: any[]) => (mockRpc as jest.Mock)(...a),
    functions: { invoke: (...a: any[]) => (mockInvoke as jest.Mock)(...a) },
  },
  authStorage: {
    getItem: jest.fn(async () => mockStoredSession),
    setItem: jest.fn(async () => {}),
    removeItem: jest.fn(async () => {}),
  },
  AUTH_STORAGE_KEY: 'sb-test-auth-token',
}));

const fixInside = { latitude: GYM.lat, longitude: GYM.lng, accuracy: 8 };
const fixFarAway = { latitude: 51.6, longitude: -0.3, accuracy: 8 };

const driveLocationFix = (coords: object) =>
  mockTasks[LOCATION_TRACKING_TASK]({ data: { locations: [{ coords }] }, error: null });

const driveNativeGeofence = (eventType: 1 | 2) =>
  mockTasks[GEOFENCE_TASK_NAME]({ data: { eventType, region: { identifier: REGION_ID } }, error: null });

const readActive = async () => {
  const raw = await AsyncStorage.getItem(ACTIVE_GEOFENCE_KEY);
  return raw ? JSON.parse(raw) : null;
};

/** Rewinds the live visit's entry time to simulate `minutes` spent in the gym. */
async function simulateDwell(minutes: number) {
  const active = await readActive();
  await AsyncStorage.setItem(
    ACTIVE_GEOFENCE_KEY,
    JSON.stringify({ ...active, entryTimestamp: Date.now() - minutes * 60 * 1000 }),
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  // The storage-first auth contract routes background RPCs over raw REST
  // (bgRpc) instead of supabase.rpc. Route those calls into the SAME mockRpc so
  // every assertion stays transport-agnostic — what matters is which RPC ran,
  // not which pipe carried it.
  (globalThis as any).fetch = jest.fn(async (url: unknown, init?: { body?: string }) => {
    const m = String(url).match(/\/rest\/v1\/rpc\/([a-z_0-9]+)/);
    const args = init?.body ? JSON.parse(init.body) : {};
    if (m) {
      const { data, error } = await (mockRpc as jest.Mock)(m[1], args);
      return {
        ok: !error,
        status: error ? 500 : 200,
        text: async () => JSON.stringify(data ?? null),
        json: async () => data ?? null,
      };
    }
    // Table REST (bgInsert/bgSelect/bgUpdate): the raw-fetch twins of the
    // supabase builders, feeding the SAME mockInserts fixture so each invariant
    // is asserted once, whichever pipe carries it.
    const table = String(url).match(/\/rest\/v1\/([a-z_]+)/)?.[1] ?? '';
    const method = (init as { method?: string } | undefined)?.method ?? 'GET';
    if (table === 'activity_sessions') {
      if (method === 'POST') {
        mockInserts.push({ table, payload: args });
        const row = { id: SESSION_ID, ...args };
        return { ok: true, status: 201, text: async () => JSON.stringify([row]), json: async () => [row] };
      }
      if (method === 'PATCH') {
        return { ok: true, status: 204, text: async () => '', json: async () => null };
      }
      return { ok: true, status: 200, text: async () => '[]', json: async () => [] };
    }
    const generic = table && method !== 'GET' ? [{ id: `test-${table}-row`, ...args }] : [];
    return {
      ok: true,
      status: method === 'POST' ? 201 : 200,
      text: async () => JSON.stringify(generic),
      json: async () => generic,
    };
  });
  resetNativeEventDebounceForTests();
  await AsyncStorage.clear();
  mockInserts = [];
  mockClaimResponse = { data: { earned: 30, push_delivered: true, within_reach: null }, error: null };
  // Production dwell thresholds (30/40 min). Under __DEV__ the check-in claim
  // drops to 30 s, which would not exercise the real timings.
  (globalThis as any).__DEV__ = false;
  // These tests drive the REAL background task callbacks, so the app is
  // backgrounded unless a test says otherwise — claims ride the REST relay there.
  (AppState as any).currentState = 'background';
  mockRelayReplies = { relay_gym_claim: { status: 'accepted' } };
  await AsyncStorage.setItem(PARTNER_MAP_KEY, JSON.stringify({ [REGION_ID]: GYM }));
  await AsyncStorage.setItem(PARTNER_MAP_META_KEY, JSON.stringify({ fetchedAt: Date.now() }));
});

afterEach(() => {
  (globalThis as any).__DEV__ = true;
  (AppState as any).currentState = 'active';
});

describe('geofence → notification flow', () => {
  it('checks the user in with a LOCAL notification only once a fix reaches the true radius', async () => {
    await driveNativeGeofence(1); // native ENTER = the 120 m approach ring, not a check-in
    expect(mockNotifyCheckIn).not.toHaveBeenCalled();
    expect(await readActive()).toBeNull();

    await driveLocationFix(fixInside);

    expect(mockNotifyCheckIn).toHaveBeenCalledWith(GYM.name, REGION_ID);
    expect(await readActive()).toMatchObject({ partnerId: GYM.dbId, regionId: REGION_ID });
    expect(mockInvoke).not.toHaveBeenCalled(); // nothing claimed yet — the dwell hasn't run
  });

  it('claims in the background at the dwell threshold and leaves the push to the server', async () => {
    await driveLocationFix(fixInside);
    await simulateDwell(35);

    await driveLocationFix(fixInside); // still inside — advances the dwell state machine

    expect(mockInserts).toHaveLength(1);
    expect(mockInserts[0]).toMatchObject({
      table: 'activity_sessions',
      payload: { type: 'gym', verification: 'geofence', partner_id: GYM.dbId },
    });
    // Backgrounded → the claim rides the REST relay; the doomed direct invoke is
    // never attempted. The server completes the claim and sends the push.
    expect(mockRpc).toHaveBeenCalledWith('relay_gym_claim', { p_session_id: SESSION_ID, p_visit_id: null });
    expect(mockInvoke).not.toHaveBeenCalled();

    // claim-points fires the single "Session recorded" push server-side. Firing a
    // local one here too would double-buzz the user.
    expect(mockNotifySessionCompleted).not.toHaveBeenCalled();

    // 'accepted' is not proof — the claim stays pending until the next tick's
    // relay answers 'already_claimed', which finalizes the session id.
    expect(await readActive()).toMatchObject({ sessionRecorded: true, pointsPending: true });
    mockRelayReplies = { relay_gym_claim: { status: 'already_claimed' } };
    await driveLocationFix(fixInside);
    expect(await readActive()).toMatchObject({ sessionRecorded: true, sessionId: SESSION_ID });
  });

  it('fires the local fallback when the server reports the push could not be delivered', async () => {
    // The fallback contract lives on the FOREGROUND claim path (the direct invoke
    // returns push_delivered) — relayed background claims leave the push entirely
    // to the server.
    (AppState as any).currentState = 'active';
    mockClaimResponse = { data: { earned: 30, push_delivered: false, within_reach: null }, error: null };

    await driveLocationFix(fixInside);
    await simulateDwell(35);
    await driveLocationFix(fixInside);

    expect(mockNotifySessionCompleted).toHaveBeenCalledWith(GYM.name, SESSION_ID, 30, 12);
  });

  it('closes the visit on native EXIT without re-claiming an already-claimed session', async () => {
    (AppState as any).currentState = 'active'; // claim completes directly, sessionId lands
    await driveLocationFix(fixInside);
    await simulateDwell(35);
    await driveLocationFix(fixInside);
    mockInvoke.mockClear();
    mockRpc.mockClear();
    (AppState as any).currentState = 'background';

    await driveNativeGeofence(2);

    expect(await readActive()).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled(); // no duplicate claim, no duplicate push
    expect(mockRpc).not.toHaveBeenCalledWith('relay_gym_claim', expect.anything());
    expect(await AsyncStorage.getItem('@powr/pending_claims')).toBeNull();
  });

  it('claims on exit when the dwell was never advanced in the background', async () => {
    await driveLocationFix(fixInside);
    await simulateDwell(35);

    // No in-gym fix ever landed (the closed-app starvation case) — the EXIT is the
    // first chance to claim, and it must still produce the session + a claim
    // trigger. Backgrounded, that trigger is the REST relay.
    await driveNativeGeofence(2);

    expect(mockRpc).toHaveBeenCalledWith('relay_gym_claim', { p_session_id: SESSION_ID, p_visit_id: null });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(await readActive()).toBeNull();
    // 'accepted' is not proof: the durable entry is RETAINED until a later flush's
    // relay answers 'already_claimed' — a lost pg_net request must not lose points.
    expect(await AsyncStorage.getItem('@powr/pending_claims')).not.toBeNull();
  });

  it('leaving before the threshold claims nothing and notifies nothing', async () => {
    await driveLocationFix(fixInside);
    await simulateDwell(12);

    await driveLocationFix(fixFarAway); // location-detected exit

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockNotifySessionCompleted).not.toHaveBeenCalled();
    expect(await readActive()).toBeNull();
  });
});

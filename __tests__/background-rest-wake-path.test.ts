// Pins the wake-path transport (lib/backgroundRest.ts) — the fix for the class
// that lost two field sessions on 2026-08-06.
//
// WHAT HAPPENED: every background wake starts a cold JS runtime, so authFresh's
// remembered refresh token is null by definition and EVERY first call takes the
// resync branch. setSession() then writes the Keystore (and may refresh over the
// network), and with the screen off that can hang forever — RN's setTimeout is
// off the UI frame clock, so withNetworkTimeout's own race freezes with it. Both
// captures ended on the resync line: the entry never opened a visit, and the
// dwell claim (plus the zombie-heal retry six minutes later) never returned.
//
// The invariants below are the whole cure, so none of them may quietly regress:
//   1. NO AUTH MACHINERY: the wake presents the persisted access token over a
//      raw fetch. supabase.auth is never touched.
//   2. NEVER REFRESH IN BACKGROUND: a spent token yields null, not a rotation —
//      rotating from a background runtime revokes the whole token family
//      (the silent-401 outage of 2026-08-05).
//   3. IT IS THE USER'S TOKEN, NOT THE ANON KEY: these writes are RLS-scoped to
//      the signed-in user. The anon key rides along only as the apikey header.
//   4. POSTGREST ERRORS PASS THROUGH INTACT: the claim path branches on
//      `code === '23505'`, so the shape must survive the transport swap.
//   5. FOREGROUND IS UNCHANGED: it keeps supabase-js, the only context allowed
//      to rotate a token.

const mockStorage: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockSupabaseRpc = jest.fn();
const mockAuthTouched = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockSupabaseRpc(...args),
    get auth() { mockAuthTouched(); return {}; },
  },
  authStorage: {
    getItem: (k: string) => Promise.resolve(mockStorage[k] ?? null),
    setItem: (k: string, v: string) => { mockStorage[k] = v; return Promise.resolve(); },
    removeItem: (k: string) => { delete mockStorage[k]; return Promise.resolve(); },
  },
  AUTH_STORAGE_KEY: 'sb-test-auth-token',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
}));

const mockCallWithAuthRetry = jest.fn(async (make: () => unknown, _label: string) => make());
jest.mock('@/lib/authFresh', () => ({
  callWithAuthRetry: (make: () => unknown, label: string) => mockCallWithAuthRetry(make, label),
}));

let mockAppState = 'background';
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  get AppState() { return { currentState: mockAppState }; },
}));

import { bgInsert, bgRpc, bgSelect, readBackgroundAuth } from '@/lib/backgroundRest';

const KEY = 'sb-test-auth-token';
const nowS = () => Math.floor(Date.now() / 1000);

/** The shape supabase-js persists: full session object, tokens + expiry + user. */
function persistSession(overrides: Record<string, unknown> = {}): void {
  mockStorage[KEY] = JSON.stringify({
    access_token: 'user-jwt',
    refresh_token: 'rt-1',
    expires_at: nowS() + 3600,
    user: { id: 'user-123' },
    ...overrides,
  });
}

const fetchMock = jest.fn();

beforeEach(() => {
  Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
  fetchMock.mockReset();
  mockSupabaseRpc.mockReset();
  mockAuthTouched.mockReset();
  mockCallWithAuthRetry.mockClear();
  mockAppState = 'background';
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function okJson(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe('readBackgroundAuth', () => {
  it('returns the persisted token and user without touching supabase.auth', async () => {
    persistSession();

    await expect(readBackgroundAuth()).resolves.toEqual({ accessToken: 'user-jwt', userId: 'user-123' });
    // INVARIANT 1. Reading the Keystore is the half proven to work on a wake;
    // everything past supabase.auth is the half that freezes.
    expect(mockAuthTouched).not.toHaveBeenCalled();
  });

  it('reads the legacy { currentSession } wrapper too', async () => {
    mockStorage[KEY] = JSON.stringify({
      currentSession: { access_token: 'legacy-jwt', expires_at: nowS() + 900, user: { id: 'user-9' } },
    });

    await expect(readBackgroundAuth()).resolves.toEqual({ accessToken: 'legacy-jwt', userId: 'user-9' });
  });

  // INVARIANT 2 — the one that must never be "improved" into a refresh.
  it('returns null for a spent token rather than refreshing it', async () => {
    persistSession({ expires_at: nowS() + 5 });

    await expect(readBackgroundAuth()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockAuthTouched).not.toHaveBeenCalled();
  });

  it('returns null when signed out, and never throws on a corrupt store', async () => {
    await expect(readBackgroundAuth()).resolves.toBeNull();

    mockStorage[KEY] = 'not json{';
    await expect(readBackgroundAuth()).resolves.toBeNull();

    mockStorage[KEY] = JSON.stringify({ access_token: 'jwt' }); // no user id
    await expect(readBackgroundAuth()).resolves.toBeNull();
  });

  it('treats a session with no expiry as usable — real sessions always carry one', async () => {
    persistSession({ expires_at: undefined });

    await expect(readBackgroundAuth()).resolves.toEqual({ accessToken: 'user-jwt', userId: 'user-123' });
  });
});

describe('bg transport', () => {
  const auth = { accessToken: 'user-jwt', userId: 'user-123' };

  // INVARIANT 3. Sending the anon key as the bearer would make these writes
  // anonymous, and RLS would reject every one of them.
  it('presents the USER token as the bearer and the anon key as the apikey', async () => {
    fetchMock.mockResolvedValueOnce(okJson('visit-1'));

    await bgRpc('open_gym_visit', { p_partner_id: 'p1' }, auth);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test.supabase.co/rest/v1/rpc/open_gym_visit');
    expect(init.headers.Authorization).toBe('Bearer user-jwt');
    expect(init.headers.apikey).toBe('anon-key');
    expect(JSON.parse(init.body)).toEqual({ p_partner_id: 'p1' });
  });

  it('unwraps the single inserted row PostgREST returns as an array', async () => {
    fetchMock.mockResolvedValueOnce(okJson([{ id: 'session-1' }], 201));

    const { data, error } = await bgInsert<{ id: string }>('activity_sessions', { type: 'gym' }, auth);

    expect(error).toBeNull();
    expect(data).toEqual({ id: 'session-1' });
    // Without this header PostgREST answers 201 with an empty body and the
    // claim would have no session id to relay.
    expect(fetchMock.mock.calls[0][1].headers.Prefer).toBe('return=representation');
  });

  // INVARIANT 4. recordDwellSession's same-day recovery branch keys off this
  // exact code; losing it turns a recoverable collision into a dropped claim.
  it('passes a PostgREST error through with its code intact', async () => {
    fetchMock.mockResolvedValueOnce(okJson(
      { code: '23505', message: 'duplicate key value violates unique constraint' }, 409,
    ));

    const { data, error } = await bgInsert('activity_sessions', { type: 'gym' }, auth);

    expect(data).toBeNull();
    expect(error?.code).toBe('23505');
    expect(error?.status).toBe(409);
  });

  it('turns a thrown network failure into an error result, never a rejection', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network request failed'));

    const { data, error } = await bgRpc('relay_gym_claim', {}, auth);

    expect(data).toBeNull();
    expect(error?.message).toMatch(/Network request failed/);
  });

  it('builds a select from the caller-supplied PostgREST query', async () => {
    fetchMock.mockResolvedValueOnce(okJson([{ id: 'existing-1' }]));

    const { data } = await bgSelect<{ id: string }>('activity_sessions', 'select=id&type=eq.gym', auth);

    expect(fetchMock.mock.calls[0][0])
      .toBe('https://test.supabase.co/rest/v1/activity_sessions?select=id&type=eq.gym');
    expect(data).toEqual([{ id: 'existing-1' }]);
  });
});

describe('openGymVisit transport selection', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { openGymVisit } = require('@/lib/gymVisits');

  it('opens the visit over raw REST when backgrounded — the freeze-proof path', async () => {
    persistSession();
    fetchMock.mockResolvedValueOnce(okJson('visit-42'));

    await expect(openGymVisit('partner-1', 'region-1', 1_700_000_000_000)).resolves.toBe('visit-42');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockSupabaseRpc).not.toHaveBeenCalled();
  });

  // A raw-fetch failure means the network is genuinely unreachable. Retrying it
  // through the auth path cannot do better and can freeze the wake instead, so
  // the next wake's late-open retry owns the recovery.
  it('does not fall back to the auth path when the raw call fails', async () => {
    persistSession();
    fetchMock.mockResolvedValueOnce(okJson({ message: 'boom' }, 500));

    await expect(openGymVisit('partner-1', 'region-1', 1_700_000_000_000)).resolves.toBeNull();
    expect(mockSupabaseRpc).not.toHaveBeenCalled();
  });

  it('falls back to the ordinary path when no usable token is persisted', async () => {
    persistSession({ expires_at: nowS() + 5 });
    mockSupabaseRpc.mockResolvedValueOnce({ data: 'visit-fallback', error: null });

    await expect(openGymVisit('partner-1', 'region-1', 1_700_000_000_000)).resolves.toBe('visit-fallback');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSupabaseRpc).toHaveBeenCalledTimes(1);
  });

  // The EXIT is a background event by definition — the user has walked off with
  // the phone pocketed. A frozen close leaves the visit open forever: the beacon
  // keeps nudging it and the "Session complete" push never fires.
  it('closes the visit over raw REST when backgrounded', async () => {
    const { closeGymVisit } = require('@/lib/gymVisits');
    persistSession();
    fetchMock.mockResolvedValueOnce(okJson(null, 204));

    await closeGymVisit('visit-42', 1_700_000_000_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/rpc/close_gym_visit');
    expect(mockSupabaseRpc).not.toHaveBeenCalled();
  });

  it('marks claim progress over raw REST when backgrounded', async () => {
    const { markGymVisitProgress } = require('@/lib/gymVisits');
    persistSession();
    fetchMock.mockResolvedValueOnce(okJson(null, 204));

    await markGymVisitProgress('visit-42', 'claimed', 'session-1');

    expect(fetchMock.mock.calls[0][0]).toContain('/rpc/mark_gym_visit_progress');
    expect(mockSupabaseRpc).not.toHaveBeenCalled();
  });

  it('closes through supabase-js in the foreground', async () => {
    const { closeGymVisit } = require('@/lib/gymVisits');
    mockAppState = 'active';
    persistSession();
    mockSupabaseRpc.mockResolvedValueOnce({ data: null, error: null });

    await closeGymVisit('visit-42');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSupabaseRpc).toHaveBeenCalledTimes(1);
  });

  // INVARIANT 5.
  it('uses supabase-js in the foreground even with a healthy token', async () => {
    mockAppState = 'active';
    persistSession();
    mockSupabaseRpc.mockResolvedValueOnce({ data: 'visit-fg', error: null });

    await expect(openGymVisit('partner-1', 'region-1', 1_700_000_000_000)).resolves.toBe('visit-fg');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSupabaseRpc).toHaveBeenCalledTimes(1);
  });
});

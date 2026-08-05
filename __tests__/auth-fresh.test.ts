// Pins the background-auth freshness contract (lib/authFresh.ts) — the fix for
// the 2026-08-05 silent-401 class, where a long-lived runtime's stale in-memory
// refresh token tripped GoTrue reuse-detection and revoked the whole session
// family, killing every background write until app-open.
//
// The invariants that must never regress:
//   1. RESYNC: when storage holds a NEWER token pair than this runtime believes,
//      ensureFreshSession adopts it via setSession — it must NOT lazily refresh
//      off the stale in-memory token (that is the family-killer).
//   2. SINGLE-FLIGHT: concurrent callers share one freshness pass.
//   3. PROACTIVE: a token inside the expiry slack is refreshed before use; a
//      fresh token is returned untouched.
//   4. RETRY-ONCE: callWithAuthRetry re-runs an auth-rejected RPC exactly once
//      after a forced refresh, and does not retry non-auth errors.
//   5. NEVER-THROW: auth failure yields null (and a breadcrumb), not an
//      exception — a wake must not be crashable by its auth layer.

const mockStorage: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const authState = {
  onChange: [] as Array<(evt: string, session: unknown) => void>,
  session: null as Record<string, unknown> | null,
};

const mockAuth = {
  onAuthStateChange: jest.fn((cb: (evt: string, session: unknown) => void) => {
    authState.onChange.push(cb);
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  }),
  getSession: jest.fn(async () => ({ data: { session: authState.session }, error: null })),
  setSession: jest.fn(async (pair: { access_token: string; refresh_token: string }) => {
    authState.session = { ...pair, expires_at: nowS() + 3600, user: { id: 'u1' } };
    authState.onChange.forEach(cb => cb('TOKEN_REFRESHED', authState.session));
    return { data: { session: authState.session }, error: null };
  }),
  refreshSession: jest.fn(async () => {
    authState.session = {
      access_token: 'at-rotated',
      refresh_token: 'rt-rotated',
      expires_at: nowS() + 3600,
      user: { id: 'u1' },
    };
    authState.onChange.forEach(cb => cb('TOKEN_REFRESHED', authState.session));
    return { data: { session: authState.session }, error: null };
  }),
};

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: mockAuth },
  authStorage: {
    getItem: (k: string) => Promise.resolve(mockStorage[k] ?? null),
    setItem: (k: string, v: string) => { mockStorage[k] = v; return Promise.resolve(); },
    removeItem: (k: string) => { delete mockStorage[k]; return Promise.resolve(); },
  },
  AUTH_STORAGE_KEY: 'sb-test-auth-token',
}));

// gymVisits is dynamically imported by the breadcrumb flusher; stub it so a
// flush can never pull the real module graph into this focused test.
jest.mock('@/lib/gymVisits', () => ({
  logGeofenceRegionEvent: jest.fn(async () => {}),
}));

const nowS = () => Math.floor(Date.now() / 1000);

function seedPersisted(pair: { access_token: string; refresh_token: string }) {
  mockStorage['sb-test-auth-token'] = JSON.stringify(pair);
}

function seedMemory(session: { access_token: string; refresh_token: string; lifeS: number }) {
  authState.session = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: nowS() + session.lifeS,
    user: { id: 'u1' },
  };
  // The module tracks its runtime's belief via onAuthStateChange.
  authState.onChange.forEach(cb => cb('INITIAL_SESSION', authState.session));
}

// authFresh keeps module state (subscription, in-flight latch, memRefreshToken),
// so every test gets a virgin copy via isolateModules.
function loadAuthFresh() {
  let mod: typeof import('@/lib/authFresh');
  jest.isolateModules(() => { mod = require('@/lib/authFresh'); });
  return mod!;
}

beforeEach(() => {
  jest.clearAllMocks();
  authState.onChange.length = 0;
  authState.session = null;
  Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
});

describe('ensureFreshSession', () => {
  it('resyncs to the persisted pair when storage rotated under this runtime — and never refreshes off the stale token', async () => {
    const { ensureFreshSession } = loadAuthFresh();
    // Runtime believes rt-old (needs one call to subscribe + learn it)…
    seedMemory({ access_token: 'at-old', refresh_token: 'rt-old', lifeS: 3600 });
    await ensureFreshSession('warmup');
    // …then another runtime rotates: storage now holds rt-new.
    seedPersisted({ access_token: 'at-new', refresh_token: 'rt-new' });

    await ensureFreshSession('test');

    expect(mockAuth.setSession).toHaveBeenCalledWith(
      expect.objectContaining({ refresh_token: 'rt-new' }));
    expect(mockAuth.refreshSession).not.toHaveBeenCalled();
  });

  it('proactively refreshes a token inside the expiry slack', async () => {
    const { ensureFreshSession } = loadAuthFresh();
    seedMemory({ access_token: 'at', refresh_token: 'rt', lifeS: 30 });   // < 120s slack
    seedPersisted({ access_token: 'at', refresh_token: 'rt' });           // no divergence

    const session = await ensureFreshSession('test');

    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(1);
    expect((session as { refresh_token?: string })?.refresh_token).toBe('rt-rotated');
  });

  it('returns the session untouched when it is fresh and in sync', async () => {
    const { ensureFreshSession } = loadAuthFresh();
    seedMemory({ access_token: 'at', refresh_token: 'rt', lifeS: 3600 });
    seedPersisted({ access_token: 'at', refresh_token: 'rt' });

    const session = await ensureFreshSession('test');

    expect(mockAuth.refreshSession).not.toHaveBeenCalled();
    expect(mockAuth.setSession).not.toHaveBeenCalled();
    expect((session as { access_token?: string })?.access_token).toBe('at');
  });

  it('single-flights concurrent callers', async () => {
    const { ensureFreshSession } = loadAuthFresh();
    seedMemory({ access_token: 'at', refresh_token: 'rt', lifeS: 30 });
    seedPersisted({ access_token: 'at', refresh_token: 'rt' });

    await Promise.all([
      ensureFreshSession('a'), ensureFreshSession('b'), ensureFreshSession('c'),
    ]);

    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('returns null (never throws) when refresh fails — the revoked-family case', async () => {
    const { ensureFreshSession } = loadAuthFresh();
    seedMemory({ access_token: 'at', refresh_token: 'rt', lifeS: 30 });
    seedPersisted({ access_token: 'at', refresh_token: 'rt' });
    mockAuth.refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Invalid Refresh Token: Already Used', status: 400 },
    } as never);

    await expect(ensureFreshSession('test')).resolves.toBeNull();
  });

  it('returns null when signed out', async () => {
    const { ensureFreshSession } = loadAuthFresh();
    await expect(ensureFreshSession('test')).resolves.toBeNull();
    expect(mockAuth.refreshSession).not.toHaveBeenCalled();
  });
});

describe('callWithAuthRetry', () => {
  it('retries exactly once after an auth rejection, with a forced refresh between', async () => {
    const { callWithAuthRetry } = loadAuthFresh();
    seedMemory({ access_token: 'at', refresh_token: 'rt', lifeS: 3600 });
    seedPersisted({ access_token: 'at', refresh_token: 'rt' });

    const make = jest.fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } })
      .mockResolvedValueOnce({ data: 'ok', error: null });

    const res = await callWithAuthRetry(make, 'test_rpc');

    expect(make).toHaveBeenCalledTimes(2);
    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(1); // the forced one
    expect(res.data).toBe('ok');
  });

  it('does not retry non-auth errors', async () => {
    const { callWithAuthRetry } = loadAuthFresh();
    seedMemory({ access_token: 'at', refresh_token: 'rt', lifeS: 3600 });
    seedPersisted({ access_token: 'at', refresh_token: 'rt' });

    const make = jest.fn().mockResolvedValue({
      data: null, error: { code: '23505', message: 'duplicate key value' },
    });

    const res = await callWithAuthRetry(make, 'test_rpc');

    expect(make).toHaveBeenCalledTimes(1);
    expect((res.error as { code: string }).code).toBe('23505');
  });

  it('surfaces the original auth error when the forced refresh cannot produce a session', async () => {
    const { callWithAuthRetry } = loadAuthFresh();
    seedMemory({ access_token: 'at', refresh_token: 'rt', lifeS: 3600 });
    seedPersisted({ access_token: 'at', refresh_token: 'rt' });
    mockAuth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid Refresh Token: Already Used', status: 400 },
    } as never);

    const make = jest.fn().mockResolvedValue({
      data: null, error: { code: 'PGRST301', message: 'JWT expired' },
    });

    const res = await callWithAuthRetry(make, 'test_rpc');

    expect(make).toHaveBeenCalledTimes(1); // no session → no second attempt
    expect((res.error as { code: string }).code).toBe('PGRST301');
  });
});

describe('isAuthError', () => {
  it('recognises the shapes our stack produces and rejects the rest', () => {
    const { isAuthError } = loadAuthFresh();
    expect(isAuthError({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
    expect(isAuthError({ status: 401, message: 'Invalid JWT' })).toBe(true);
    expect(isAuthError({ message: 'Invalid Refresh Token: Already Used' })).toBe(true);
    expect(isAuthError({ message: 'P0001: not authenticated' })).toBe(true);
    expect(isAuthError({ code: '23505', message: 'duplicate key value' })).toBe(false);
    expect(isAuthError(new Error('network request failed'))).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});

// Pins the fix for the iOS load hang (root-caused 2026-08-07).
//
// THE BUG: a push arrives while the phone is locked in a pocket. Because
// UIBackgroundModes includes remote-notification, iOS launches the app into the
// BACKGROUND — RN boots the bundle and mounts the React tree invisibly. The
// auth bootstrap's keychain read throws errSecInteractionNotAllowed ("User
// interaction is not allowed"), supabase-js propagates it (auth-js's own
// getItemAsync is a bare `await storage.getItem`, and __loadSession /
// _useSession / getSession are all try/FINALLY with no catch), and
// AuthContext's `.then()` never runs. `loading` stays true for the life of the
// runtime. The user then unlocks, taps the notification, and foregrounds INTO
// that already-wedged runtime: app/index.tsx renders its ActivityIndicator
// forever. Force-quitting is the only cure, because that is a fresh runtime.
//
// Nothing throws where anyone can see it, so lib/crashHandler recorded nothing
// fatal for either field occurrence — which is exactly why this needs a test
// rather than vigilance.
//
// The invariants:
//   1. A keychain read that THROWS reads as signed out (null), never as a
//      rejection escaping into supabase-js.
//   2. The accessibility option and the fire-and-forget heal survive the catch.
//   3. The bootstrap SETTLES on every path — resolve, reject, and never-settle
//      — because setLoading(false) in context/AuthContext.tsx is the only one in
//      the app and app/index.tsx is a bare spinner until it runs.

const LOCKED = new Error(
  "Calling the 'getValueWithKeyAsync' function has failed → Caused by: User interaction is not allowed.",
);

const mockSecureStore = {
  getItemAsync: jest.fn(async (_key: string, _opts?: unknown) => null as string | null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
  AFTER_FIRST_UNLOCK: 'afterFirstUnlock',
};

jest.mock('expo-secure-store', () => mockSecureStore);
// lib/supabase imports this for its side effect; the mocked react-native below
// has no BlobModule for it to patch, and Node's own URL is what the test needs.
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({ auth: {} })) }));

function loadAuthStorage() {
  let mod: typeof import('@/lib/supabase');
  jest.isolateModules(() => { mod = require('@/lib/supabase'); });
  return mod!.authStorage;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

describe('a locked keychain reads as signed out, never as a throw', () => {
  it('resolves to null instead of rejecting when the read throws', async () => {
    mockSecureStore.getItemAsync.mockRejectedValueOnce(LOCKED);
    // The assertion that matters: RESOLVES. A rejection here is what pinned
    // `loading` true forever, because AuthContext had no catch to receive it.
    await expect(loadAuthStorage().getItem('sb-x-auth-token')).resolves.toBeNull();
  });

  it('still returns the value, and migrates it, on a successful read', async () => {
    // ⚠ REWRITTEN 2026-08-17. This used to assert the in-place heal:
    //   setItemAsync('k', value, { keychainAccessible })
    // That call existed and healed NOTHING — expo-secure-store degrades an add
    // on an existing key to SecItemUpdate, which writes kSecValueData only and
    // leaves kSecAttrAccessible alone. So this test was green while every
    // already-signed-in iOS device stayed unreadable in the background. The
    // migration now copies to a separate keychainService, which is the only
    // write path that can apply the attribute. See lib/secureKeychain.ts and
    // __tests__/keychain-accessibility-migration.test.ts.
    mockSecureStore.getItemAsync
      .mockResolvedValueOnce(null)                      // migrated service: not there yet
      .mockResolvedValueOnce('{"access_token":"a"}');   // legacy service: the old item
    const storage = loadAuthStorage();

    await expect(storage.getItem('k')).resolves.toBe('{"access_token":"a"}');

    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'k', '{"access_token":"a"}',
      { keychainAccessible: 'afterFirstUnlock', keychainService: expect.any(String) },
    );
    // …and under a service that is NOT the default, or the add would collide
    // with the legacy item and fall back to the accessibility-preserving update.
    const [, , opts] = mockSecureStore.setItemAsync.mock.calls[0] as unknown as [
      string, string, { keychainService?: string },
    ];
    expect(opts.keychainService).toBeTruthy();
  });

  it('passes AFTER_FIRST_UNLOCK on the read itself', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    await loadAuthStorage().getItem('k');
    // The legacy probe carries the accessibility option too — it is the read
    // that has to survive a locked device on a not-yet-migrated install.
    expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith(
      'k', { keychainAccessible: 'afterFirstUnlock' },
    );
  });

  it('does not let a failed read poison later reads', async () => {
    const storage = loadAuthStorage();
    mockSecureStore.getItemAsync.mockRejectedValueOnce(LOCKED);
    await expect(storage.getItem('k')).resolves.toBeNull();

    // Device unlocked since — the adapter must recover, not latch the failure.
    mockSecureStore.getItemAsync.mockResolvedValueOnce('{"access_token":"b"}');
    await expect(storage.getItem('k')).resolves.toBe('{"access_token":"b"}');
  });
});

describe('the auth bootstrap always settles', () => {
  // Mirrors context/AuthContext.tsx's bootstrap. getSession() can fail two ways
  // that look identical from the caller: it can REJECT (case 1 above), or it can
  // NEVER SETTLE — on React Native there is no navigator.locks, so auth-js falls
  // back to lockNoOp and `lockAcquireTimeout` is dead code, while _acquireLock's
  // re-entrancy queue still makes every caller `await` the previous in-lock
  // operation with no bound. One frozen background auth call jams every later
  // auth call in the runtime, permanently. Only a timeout covers that.
  const AUTH_BOOTSTRAP_TIMEOUT_MS = 8_000;

  function bootstrap(getSession: () => Promise<{ data: { session: unknown } }>) {
    const seen: unknown[] = [];
    let settled = false;
    const settle = (s: unknown) => { if (settled) return; settled = true; seen.push(s); };
    const timer = setTimeout(() => settle(null), AUTH_BOOTSTRAP_TIMEOUT_MS);
    const done = getSession()
      .then(({ data: { session } }) => settle(session))
      .catch(() => settle(null))
      .finally(() => clearTimeout(timer));
    return { seen, done, isSettled: () => settled };
  }

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('settles with the session when getSession resolves', async () => {
    const b = bootstrap(async () => ({ data: { session: { user: { id: 'u1' } } } }));
    await b.done;
    expect(b.isSettled()).toBe(true);
    expect(b.seen).toEqual([{ user: { id: 'u1' } }]);
  });

  it('settles signed-out when getSession REJECTS — the locked-keychain case', async () => {
    const b = bootstrap(() => Promise.reject(LOCKED));
    await b.done;
    expect(b.isSettled()).toBe(true);
    expect(b.seen).toEqual([null]);
  });

  it('settles signed-out when getSession NEVER SETTLES — the jammed-lock case', async () => {
    const b = bootstrap(() => new Promise(() => { /* never */ }));
    expect(b.isSettled()).toBe(false);

    jest.advanceTimersByTime(AUTH_BOOTSTRAP_TIMEOUT_MS);
    await Promise.resolve();

    // Without the timer this is the hang: a spinner with no error and no way out.
    expect(b.isSettled()).toBe(true);
    expect(b.seen).toEqual([null]);
  });

  it('settles exactly once when a slow getSession lands after the timeout', async () => {
    let release!: (v: { data: { session: unknown } }) => void;
    const b = bootstrap(() => new Promise((res) => { release = res; }));

    jest.advanceTimersByTime(AUTH_BOOTSTRAP_TIMEOUT_MS);
    await Promise.resolve();

    release({ data: { session: { user: { id: 'late' } } } });
    await b.done;

    // The late arrival must not re-fire setState. INITIAL_SESSION is what
    // delivers a genuinely-late session, not this path.
    expect(b.seen).toEqual([null]);
  });
});

describe('the fail-open correction: a late session must fix the ROUTE too', () => {
  // Field 2026-08-09 (iOS). After a session of headless wakes the app reopened
  // on the Train/Earn/Repeat landing, and pressing Login walked straight in with
  // no credentials — the giveaway that the session had been valid all along.
  //
  // The block above is why setSession self-corrects. This block is why that was
  // not enough. app/index.tsx latches `didRedirect` on the first non-loading
  // render and immediately router.replace's, so index is UNMOUNTED before
  // INITIAL_SESSION lands and its effect can never run again. State recovered;
  // navigation did not; the user only ever sees navigation.
  //
  // Mirrors context/AuthContext.tsx: bootstrap + listener + one-shot correction.
  const AUTH_BOOTSTRAP_TIMEOUT_MS = 8_000;

  type Sess = { user: { id: string; user_metadata?: { onboarding_complete?: boolean } } } | null;

  function makeAuth(getSession: () => Promise<{ data: { session: Sess } }>) {
    const routes: string[] = [];
    const router = { replace: (r: string) => routes.push(r) };

    let settled = false;
    let failedOpen = false;
    let latest: Sess = null;
    const sessions: Sess[] = [];

    const settle = (s: Sess) => { if (settled) return; settled = true; sessions.push(s); };

    const timer = setTimeout(() => {
      if (settled) return;
      if (latest) { settle(latest); } else { failedOpen = true; settle(null); }
    }, AUTH_BOOTSTRAP_TIMEOUT_MS);

    const done = getSession()
      .then(({ data: { session } }) => settle(session))
      // A REJECTION is the locked-keychain case, and it fails open exactly like
      // the timeout does — so it arms the correction too. Mirrors the real
      // catch; omitting the flag here is what made this model disagree with the
      // implementation on first run.
      .catch(() => { failedOpen = true; settle(null); })
      .finally(() => clearTimeout(timer));

    /** The onAuthStateChange body, in the order AuthContext runs it. */
    const emit = (event: string, session: Sess) => {
      latest = session;
      if (session && event === 'INITIAL_SESSION' && failedOpen) {
        failedOpen = false;
        router.replace(session.user.user_metadata?.onboarding_complete ? '/(tabs)' : '/onboarding-permission');
      }
    };

    return { routes, done, emit, sessions, isSettled: () => settled };
  }

  const ONBOARDED: Sess = { user: { id: 'u1', user_metadata: { onboarding_complete: true } } };
  const MID_ONBOARDING: Sess = { user: { id: 'u2', user_metadata: {} } };

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('routes into the app when INITIAL_SESSION lands after a failed-open bootstrap', async () => {
    const a = makeAuth(() => new Promise(() => { /* jammed lock */ }));
    jest.advanceTimersByTime(AUTH_BOOTSTRAP_TIMEOUT_MS);
    await Promise.resolve();
    expect(a.sessions).toEqual([null]); // index has already sent them to /onboarding

    a.emit('INITIAL_SESSION', ONBOARDED);

    // Without this the user sits on the landing page holding a valid session.
    expect(a.routes).toEqual(['/(tabs)']);
  });

  it('returns a half-onboarded user to onboarding, not into the tabs', async () => {
    const a = makeAuth(() => Promise.reject(LOCKED));
    await a.done;
    a.emit('INITIAL_SESSION', MID_ONBOARDING);
    expect(a.routes).toEqual(['/onboarding-permission']);
  });

  it('does NOT navigate when the bootstrap was healthy — index already routed', async () => {
    const a = makeAuth(async () => ({ data: { session: ONBOARDED } }));
    await a.done;
    a.emit('INITIAL_SESSION', ONBOARDED);
    // Firing here would fight app/index.tsx for the route on every cold start.
    expect(a.routes).toEqual([]);
  });

  it('does NOT navigate when there is genuinely no session', async () => {
    const a = makeAuth(() => new Promise(() => { /* jammed */ }));
    jest.advanceTimersByTime(AUTH_BOOTSTRAP_TIMEOUT_MS);
    await Promise.resolve();
    a.emit('INITIAL_SESSION', null);
    expect(a.routes).toEqual([]);
  });

  it('is one-shot — a later TOKEN_REFRESHED cannot yank the user around', async () => {
    const a = makeAuth(() => new Promise(() => { /* jammed */ }));
    jest.advanceTimersByTime(AUTH_BOOTSTRAP_TIMEOUT_MS);
    await Promise.resolve();

    a.emit('INITIAL_SESSION', ONBOARDED);
    a.emit('TOKEN_REFRESHED', ONBOARDED);
    a.emit('INITIAL_SESSION', ONBOARDED);

    expect(a.routes).toEqual(['/(tabs)']);
  });

  it('never settles null OVER a session the listener already delivered', async () => {
    // INITIAL_SESSION is emitted during initialization, so a getSession jammed on
    // the auth lock can be outrun by its own event. settle(null) there would sign
    // out a working account — worse than the hang it replaces.
    const a = makeAuth(() => new Promise(() => { /* jammed */ }));
    a.emit('INITIAL_SESSION', ONBOARDED);

    jest.advanceTimersByTime(AUTH_BOOTSTRAP_TIMEOUT_MS);
    await Promise.resolve();

    expect(a.sessions).toEqual([ONBOARDED]);
    expect(a.routes).toEqual([]); // never failed open, so nothing to correct
  });
});

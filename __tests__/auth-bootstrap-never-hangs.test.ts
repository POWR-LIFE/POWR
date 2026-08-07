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

  it('still returns the value, and heals accessibility, on a successful read', async () => {
    mockSecureStore.getItemAsync.mockResolvedValueOnce('{"access_token":"a"}');
    const storage = loadAuthStorage();

    await expect(storage.getItem('k')).resolves.toBe('{"access_token":"a"}');

    // The heal is what fixes installs whose token predates AFTER_FIRST_UNLOCK.
    // It must survive the try/catch added around the read.
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'k', '{"access_token":"a"}', { keychainAccessible: 'afterFirstUnlock' },
    );
  });

  it('passes AFTER_FIRST_UNLOCK on the read itself', async () => {
    mockSecureStore.getItemAsync.mockResolvedValueOnce(null);
    await loadAuthStorage().getItem('k');
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

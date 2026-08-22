/**
 * Pins the SIGNED_OUT synthetic-restore against a persisted pair the SERVER has
 * retired.
 *
 * THE LOOP (field 2026-08-18 12:08Z): auth-js refreshes with the persisted pair
 * → GoTrue 400 refresh_token_not_found (enforceOneSession's signOut(scope:
 * 'others') from another device had deleted the session) → auth-js
 * _removeSession() → the erase gate in lib/supabase.ts BLOCKS the keychain wipe
 * → auth-js emits SIGNED_OUT → AuthContext sees a "surviving" stored session
 * and restores it with setSession(pair) → the restore refreshes with the SAME
 * dead pair → 400 → _removeSession → blocked → SIGNED_OUT → restore → …
 * ~10 POST /token per second for 70 s from one Expo Go runtime, until GoTrue
 * rate-limited the IP and every password login on the network answered 429.
 *
 * The invariant: a pair that comes back rejected twice is dead, not raced. It
 * gets erased (the one machinery path allowed to) and the user is signed out
 * for real — one restore attempt, never a loop. A rotation race, where storage
 * holds a NEWER pair than the one that failed, still restores and stays quiet.
 *
 * The auth fake below reproduces auth-js's re-entrancy exactly: setSession on
 * a rejected pair emits SIGNED_OUT to the listeners BEFORE it resolves, which
 * is what turned "restore once" into "restore forever".
 */

import { render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

const jwt = (sessionId: string) =>
  `x.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64')}.y`;

const STORAGE_KEY = 'sb-test-auth-token';

/** What the keychain currently holds; null = erased. */
let mockStored: { access_token: string; refresh_token: string; user: { id: string } } | null = null;

type Listener = (event: string, session: unknown) => void | Promise<void>;
let listeners: Listener[] = [];
const emit = async (event: string, session: unknown) => {
  for (const l of listeners) await l(event, session);
};

/** How the fake GoTrue answers a refresh with a given refresh token. */
let mockServerVerdict: (refreshToken: string) => 'dead' | { rotatedTo: string } | 'adopt-local' = () => 'dead';

const mockSupabase = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: null } })),
    onAuthStateChange: jest.fn((cb: Listener) => {
      listeners.push(cb);
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
    signOut: jest.fn(async () => ({ error: null })),
    // Faithful to auth-js: a non-retryable refresh error runs _removeSession(),
    // which notifies SIGNED_OUT to every listener BEFORE setSession resolves.
    setSession: jest.fn(async (pair: { access_token: string; refresh_token: string }) => {
      const verdict = mockServerVerdict(pair.refresh_token);
      if (verdict === 'dead') {
        await emit('SIGNED_OUT', null);
        return { data: { session: null, user: null }, error: { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' } };
      }
      if (verdict === 'adopt-local') {
        // Access token unexpired: no round-trip, same pair, SIGNED_IN.
        const session = { ...pair, user: { id: 'u-1', user_metadata: { onboarding_complete: true } } };
        await emit('SIGNED_IN', session);
        return { data: { session, user: session.user }, error: null };
      }
      const session = { access_token: jwt('s-new'), refresh_token: verdict.rotatedTo, user: { id: 'u-1', user_metadata: { onboarding_complete: true } } };
      mockStored = { access_token: session.access_token, refresh_token: session.refresh_token, user: { id: 'u-1' } };
      await emit('SIGNED_IN', session);
      return { data: { session, user: session.user }, error: null };
    }),
    getUser: jest.fn(async () => ({ data: { user: null }, error: null })),
    updateUser: jest.fn(async () => ({ data: { user: null }, error: null })),
  },
  from: jest.fn(() => ({ upsert: jest.fn(async () => ({ error: null })) })),
  channel: jest.fn(() => {
    const ch: any = { on: () => ch, subscribe: () => ch, unsubscribe: async () => 'ok' };
    return ch;
  }),
  getChannels: jest.fn(() => []),
  removeChannel: jest.fn(async () => 'ok'),
};

const mockAuthorizeSessionErase = jest.fn();
const mockRemoveItem = jest.fn(async (key: string) => { if (key === STORAGE_KEY) mockStored = null; });

jest.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  authorizeSessionErase: mockAuthorizeSessionErase,
  authStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: mockRemoveItem },
  AUTH_STORAGE_KEY: STORAGE_KEY,
  EMAIL_CONFIRM_REDIRECT: 'powr://confirm',
}));
jest.mock('@/lib/backgroundRest', () => ({
  clearDeviceWakeTicket: jest.fn(async () => {}),
  ensureDeviceWakeTicket: jest.fn(async () => {}),
  readStoredSession: jest.fn(async () => mockStored),
}));
jest.mock('@/lib/deviceLock', () => ({
  claimDevice: jest.fn(async () => ({ status: 'ok' })),
  confirmDeviceTransfer: jest.fn(async () => ({ status: 'ok' })),
  getDeviceId: jest.fn(async () => 'device-1'),
}));
// Resolves like the real one: AuthContext chains the returned fix into the
// country derivation, so a mock that returns undefined would throw inside
// the auth listener — a failure mode the real module cannot have.
jest.mock('@/lib/locationPermission', () => ({ reportLocationPermission: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/country', () => ({ reportUserCountry: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/context/GeofenceContext', () => ({
  reconcileActiveOnLogin: jest.fn(async () => {}),
  clearGeofenceStateOnSignOut: jest.fn(async () => {}),
}));
jest.mock('@/components/TransferDeviceSheet', () => () => null);
jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: jest.fn(async () => false) }));
jest.mock('expo-linking', () => ({
  createURL: jest.fn(() => 'powr://'),
  parse: jest.fn(() => ({})),
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })) }));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: mockReplace, push: jest.fn() } }));

// require, not import: babel hoists `import` above the const declarations the
// jest.mock factories close over.
const { AuthProvider } = require('@/context/AuthContext') as typeof import('@/context/AuthContext');

const DEAD_PAIR = { access_token: jwt('s-dead'), refresh_token: 'rt-dead', user: { id: 'u-1' } };

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  listeners = [];
  mockStored = { ...DEAD_PAIR };
  mockServerVerdict = () => 'dead';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

async function mountProvider() {
  render(<AuthProvider><></></AuthProvider>);
  await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
}

describe('synthetic sign-out restore is bounded', () => {
  it('a pair the server rejects twice is erased and torn down — ONE restore, no loop', async () => {
    await mountProvider();

    // auth-js's own refresh failed on the persisted pair: erase blocked, SIGNED_OUT.
    await emit('SIGNED_OUT', null);

    // Exactly one restore attempt was made with the surviving pair …
    expect(mockSupabase.auth.setSession).toHaveBeenCalledTimes(1);
    expect(mockSupabase.auth.setSession).toHaveBeenCalledWith({
      access_token: DEAD_PAIR.access_token,
      refresh_token: DEAD_PAIR.refresh_token,
    });
    // … its rejection (the re-entrant SIGNED_OUT, delivered while the restore
    // is still in flight — the restore is fire-and-forget) erased the dead pair …
    await waitFor(() => expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY));
    expect(mockAuthorizeSessionErase).toHaveBeenCalledTimes(1);
    expect(mockStored).toBeNull();
    // … and the user was signed out for real, with an explanation.
    expect(mockReplace).toHaveBeenCalledWith('/onboarding');
    expect(alertSpy).toHaveBeenCalledWith('Signed out', expect.stringMatching(/no longer valid/));
    // Still exactly one restore — the second SIGNED_OUT did NOT restore again.
    expect(mockSupabase.auth.setSession).toHaveBeenCalledTimes(1);
  });

  it('a rotation race — storage holds a NEWER pair — still restores and stays quiet', async () => {
    mockServerVerdict = () => ({ rotatedTo: 'rt-newer-2' });
    await mountProvider();

    await emit('SIGNED_OUT', null);

    expect(mockSupabase.auth.setSession).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeSessionErase).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('a restore that only adopts an unexpired JWT locally does not reset the strike count', async () => {
    // First SIGNED_OUT: the refresh token is dead but the access token still has
    // life, so setSession adopts it with no round-trip and re-emits SIGNED_IN
    // carrying the SAME refresh token. Nothing was proven.
    mockServerVerdict = () => 'adopt-local';
    await mountProvider();
    await emit('SIGNED_OUT', null);
    expect(mockSupabase.auth.setSession).toHaveBeenCalledTimes(1);
    expect(mockRemoveItem).not.toHaveBeenCalled();

    // Next auto-refresh tick fails on that same pair → SIGNED_OUT again. Second
    // strike on the same pair: dead, erase, tear down — no third restore.
    mockServerVerdict = () => 'dead';
    await emit('SIGNED_OUT', null);
    await waitFor(() => expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY));
    expect(mockSupabase.auth.setSession).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeSessionErase).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/onboarding');
  });

  it('a genuinely rotated session clears the ledger, so a later unrelated race restores again', async () => {
    mockServerVerdict = () => ({ rotatedTo: 'rt-newer-2' });
    await mountProvider();
    await emit('SIGNED_OUT', null);           // race #1: restored, rotated to rt-newer-2
    expect(mockSupabase.auth.setSession).toHaveBeenCalledTimes(1);

    // Much later, another runtime rotates again; storage now holds rt-newer-3
    // and this runtime's stale refresh fails → SIGNED_OUT. Different pair from
    // the ledger → restore is allowed (and succeeds).
    mockStored = { access_token: jwt('s-3'), refresh_token: 'rt-newer-3', user: { id: 'u-1' } };
    mockServerVerdict = () => ({ rotatedTo: 'rt-newer-4' });
    await emit('SIGNED_OUT', null);
    expect(mockSupabase.auth.setSession).toHaveBeenCalledTimes(2);
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('user-initiated sign-out never restores and never touches the ledger path', async () => {
    await mountProvider();
    // The user's own signOut() sets userSignOutRef + authorizes the erase; the
    // keychain is already empty by the time SIGNED_OUT lands.
    mockStored = null;
    await emit('SIGNED_OUT', null);
    expect(mockSupabase.auth.setSession).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/onboarding');
  });
});

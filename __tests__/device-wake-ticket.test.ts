// The device-scoped wake ticket — the credential the background path can hold
// when nothing else works.
//
// WHY IT EXISTS. Every wake-path call that needs the user's identity used the
// persisted access token, and that token is missing in the two states every real
// gym visit is in:
//   • pocketed for an hour — Supabase access tokens live 60 minutes, and we
//     refuse to refresh in the background (rotating from a background runtime is
//     what revokes the whole token family). Field 2026-08-07: a phone swiped
//     away at 08:50 had no usable token by 09:46, and every close, region event
//     and tick behind it fell back to supabase-js and timed out at 30 s.
//   • locked iPhone — the token is in the keychain and a locked device refuses
//     the read.
// What kept working both mornings was the confirms, because they ride the
// beacon's visit nonce. The ticket generalises that to the device.
//
// The invariants below are the whole design; none may quietly regress:
//   1. MINTED IN THE FOREGROUND, SPENT IN THE BACKGROUND. Minting is the one
//      step that needs a live session, and it happens where one is guaranteed.
//   2. NOT IN THE KEYCHAIN. AsyncStorage is the point — a locked device can
//      read it. That is only acceptable because of invariant 4.
//   3. PREFERRED OVER THE TOKEN, BUT NEVER A DEAD END. Ticket → persisted token
//      → supabase-js. A ticket the server refuses falls through rather than
//      failing the call.
//   4. ⚠ IT CAN NEVER AWARD A POINT. Five verbs: open a visit, close a visit,
//      three kinds of telemetry. No ticket path to confirm/claim/upgrade, so
//      credit still requires a GPS confirm carrying the server's own nonce.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const mockStorage: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k: string) => Promise.resolve(mockStorage[k] ?? null)),
  setItem: jest.fn((k: string, v: string) => { mockStorage[k] = v; return Promise.resolve(); }),
  removeItem: jest.fn((k: string) => { delete mockStorage[k]; return Promise.resolve(); }),
}));

const mockSupabaseRpc = jest.fn();
const mockAuthTouched = jest.fn();
const mockKeychainRead = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockSupabaseRpc(...args),
    get auth() { mockAuthTouched(); return {}; },
  },
  authStorage: {
    getItem: (k: string) => { mockKeychainRead(k); return Promise.resolve(mockKeychain[k] ?? null); },
    setItem: (k: string, v: string) => { mockKeychain[k] = v; return Promise.resolve(); },
    removeItem: (k: string) => { delete mockKeychain[k]; return Promise.resolve(); },
  },
  AUTH_STORAGE_KEY: 'sb-test-auth-token',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
}));

const mockKeychain: Record<string, string> = {};

jest.mock('@/lib/authFresh', () => ({
  callWithAuthRetry: (make: () => unknown) => make(),
}));

let mockAppState = 'background';
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  get AppState() { return { currentState: mockAppState }; },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearDeviceWakeTicket,
  ensureDeviceWakeTicket,
  isTicketRejection,
  readDeviceTicket,
  ticketRpc,
} from '@/lib/backgroundRest';

const TICKET_KEY = 'POWR_DEVICE_WAKE_TICKET_V1';
const AUTH_KEY = 'sb-test-auth-token';
const DAY = 24 * 60 * 60 * 1000;

const fetchMock = jest.fn();

function okJson(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

/** A healthy ticket for (user-123, device-abc), a month out. */
function storeTicket(overrides: Record<string, unknown> = {}): void {
  mockStorage[TICKET_KEY] = JSON.stringify({
    ticket: 'raw-secret',
    deviceId: 'device-abc',
    userId: 'user-123',
    expiresAt: Date.now() + 30 * DAY,
    ...overrides,
  });
}

/** The shape supabase-js persists into the keychain. */
function persistSession(overrides: Record<string, unknown> = {}): void {
  mockKeychain[AUTH_KEY] = JSON.stringify({
    access_token: 'user-jwt',
    refresh_token: 'rt-1',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-123' },
    ...overrides,
  });
}

beforeEach(() => {
  Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
  Object.keys(mockKeychain).forEach(k => delete mockKeychain[k]);
  fetchMock.mockReset();
  mockSupabaseRpc.mockReset();
  mockAuthTouched.mockReset();
  mockKeychainRead.mockReset();
  mockAppState = 'background';
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => { jest.restoreAllMocks(); });

describe('readDeviceTicket', () => {
  // INVARIANT 2. AsyncStorage, not the keychain — a locked iPhone can read one
  // and not the other, and the wake path only ever happens on a pocketed phone.
  it('reads the ticket from AsyncStorage without touching the keychain', async () => {
    storeTicket();

    await expect(readDeviceTicket()).resolves.toEqual({
      ticket: 'raw-secret',
      deviceId: 'device-abc',
      userId: 'user-123',
      expiresAt: expect.any(Number),
    });
    expect(mockKeychainRead).not.toHaveBeenCalled();
    expect(mockAuthTouched).not.toHaveBeenCalled();
  });

  it('returns null for an expired ticket rather than presenting a dead one', async () => {
    storeTicket({ expiresAt: Date.now() - 1000 });

    await expect(readDeviceTicket()).resolves.toBeNull();
  });

  it('returns null when absent or corrupt, and never throws', async () => {
    await expect(readDeviceTicket()).resolves.toBeNull();

    mockStorage[TICKET_KEY] = 'not json{';
    await expect(readDeviceTicket()).resolves.toBeNull();

    mockStorage[TICKET_KEY] = JSON.stringify({ ticket: 'x' }); // no deviceId
    await expect(readDeviceTicket()).resolves.toBeNull();
  });
});

describe('ticketRpc', () => {
  const ticket = { ticket: 'raw-secret', deviceId: 'device-abc', userId: 'user-123', expiresAt: Date.now() + DAY };

  // The ticket IS the authority; there is no user JWT in the request at all.
  // Same shape as the visit-nonce wake path, which is the one thing that kept
  // working through every freeze and every expiry.
  it('sends the anon key as both apikey and bearer, with the ticket in the body', async () => {
    fetchMock.mockResolvedValueOnce(okJson('visit-1'));

    await ticketRpc('open_gym_visit_by_ticket', { p_partner_id: 'p1' }, ticket);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test.supabase.co/rest/v1/rpc/open_gym_visit_by_ticket');
    expect(init.headers.apikey).toBe('anon-key');
    expect(init.headers.Authorization).toBe('Bearer anon-key');
    expect(JSON.parse(init.body)).toEqual({
      p_partner_id: 'p1',
      p_ticket: 'raw-secret',
      p_device_id: 'device-abc',
    });
    expect(mockAuthTouched).not.toHaveBeenCalled();
  });

  it('recognises the server refusing the ticket, and only that', () => {
    // SQLSTATE 28000 — PostgREST answers 403 with the code intact.
    expect(isTicketRejection({ code: '28000', message: 'invalid or expired device ticket' })).toBe(true);
    expect(isTicketRejection({ message: 'invalid or expired device ticket', status: 403 })).toBe(true);
    // A failure of the WORK is not a failure of the credential: retrying these
    // with another transport would just repeat them.
    expect(isTicketRejection({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isTicketRejection({ message: 'Network request failed' })).toBe(false);
    expect(isTicketRejection(null)).toBe(false);
  });
});

describe('ensureDeviceWakeTicket', () => {
  // Minting only ever happens in the foreground — see the background test below.
  beforeEach(() => { mockAppState = 'active'; });

  // INVARIANT 1. Minting is the one step that needs a live session, so it runs
  // in the foreground through supabase-js — the only context allowed to refresh.
  it('mints through supabase-js and stores the secret', async () => {
    mockSupabaseRpc.mockResolvedValueOnce({
      data: { ticket: 'fresh-secret', device_id: 'device-abc', expires_at: new Date(Date.now() + 30 * DAY).toISOString() },
      error: null,
    });

    await ensureDeviceWakeTicket('user-123', 'device-abc', 'ios');

    expect(mockSupabaseRpc).toHaveBeenCalledWith('mint_device_wake_ticket', {
      p_device_id: 'device-abc',
      p_platform: 'ios',
    });
    expect(JSON.parse(mockStorage[TICKET_KEY])).toEqual({
      ticket: 'fresh-secret',
      deviceId: 'device-abc',
      userId: 'user-123',
      expiresAt: expect.any(Number),
    });
    // The raw secret never goes near the keychain, and minting is not an auth op.
    expect(mockKeychainRead).not.toHaveBeenCalled();
  });

  // A push launches the app into the BACKGROUND with the phone still locked, and
  // INITIAL_SESSION fires there like anywhere else. Minting on that launch would
  // do the two things this module exists to avoid — a keychain read and an
  // authenticated round-trip on a wake — and would bind the ticket to whatever
  // fallback id a locked keychain produced. The next foreground pass mints.
  it('refuses to mint in the background, however loudly it is asked', async () => {
    mockAppState = 'background';

    await ensureDeviceWakeTicket('user-123', 'device-abc', 'ios');

    expect(mockSupabaseRpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockStorage[TICKET_KEY]).toBeUndefined();
  });

  it('is a no-op when this device already holds a healthy ticket', async () => {
    storeTicket();

    await ensureDeviceWakeTicket('user-123', 'device-abc', 'ios');

    expect(mockSupabaseRpc).not.toHaveBeenCalled();
  });

  // One live ticket per physical device: the account that just signed in owns
  // the wake path, exactly as it owns the device lock.
  it('re-mints when the stored ticket belongs to a different account', async () => {
    storeTicket({ userId: 'someone-else' });
    mockSupabaseRpc.mockResolvedValueOnce({
      data: { ticket: 's2', device_id: 'device-abc', expires_at: new Date(Date.now() + 30 * DAY).toISOString() },
      error: null,
    });

    await ensureDeviceWakeTicket('user-123', 'device-abc', 'ios');

    expect(mockSupabaseRpc).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockStorage[TICKET_KEY]).userId).toBe('user-123');
  });

  it('renews inside the renewal window, so a ticket never expires in a pocket', async () => {
    storeTicket({ expiresAt: Date.now() + 2 * DAY }); // inside the 7-day window
    mockSupabaseRpc.mockResolvedValueOnce({
      data: { ticket: 's3', device_id: 'device-abc', expires_at: new Date(Date.now() + 30 * DAY).toISOString() },
      error: null,
    });

    await ensureDeviceWakeTicket('user-123', 'device-abc', 'ios');

    expect(JSON.parse(mockStorage[TICKET_KEY]).ticket).toBe('s3');
  });

  it('leaves the old ticket in place when minting fails', async () => {
    storeTicket({ expiresAt: Date.now() + 2 * DAY });
    mockSupabaseRpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });

    await ensureDeviceWakeTicket('user-123', 'device-abc', 'ios');

    expect(JSON.parse(mockStorage[TICKET_KEY]).ticket).toBe('raw-secret');
  });
});

describe('clearDeviceWakeTicket', () => {
  // Revoked with the TICKET, not a session: sign-out is exactly when the session
  // may already be gone (forced sign-out, revoked family, locked keychain), and
  // a credential you can only retire while signed in never gets retired.
  it('revokes server-side with the ticket itself, then drops the local copy', async () => {
    storeTicket();
    fetchMock.mockResolvedValueOnce(okJson(null, 204));

    await clearDeviceWakeTicket();

    expect(fetchMock.mock.calls[0][0]).toContain('/rpc/revoke_device_wake_ticket');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      p_ticket: 'raw-secret',
      p_device_id: 'device-abc',
    });
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(TICKET_KEY);
    expect(mockStorage[TICKET_KEY]).toBeUndefined();
  });

  it('drops the local copy even when the revoke call fails', async () => {
    storeTicket();
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await clearDeviceWakeTicket();

    expect(mockStorage[TICKET_KEY]).toBeUndefined();
  });
});

describe('the wake path prefers the ticket', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { closeGymVisit, openGymVisit, logGeofenceRegionEvent, logGymVisitTick, markGymVisitProgress } = require('@/lib/gymVisits');

  // INVARIANT 3, and THE CASE THAT MOTIVATED ALL OF THIS. An exit comes at the
  // end of a session, so the phone has been pocketed for the whole of it — the
  // token is spent by definition. On 2026-08-07 every walk-out close fell back
  // to supabase-js and timed out, leaving the visit open forever: the beacon
  // kept nudging it and "Session complete" never fired.
  it('closes the visit on an EXPIRED token, because the ticket does not care', async () => {
    storeTicket();
    persistSession({ expires_at: Math.floor(Date.now() / 1000) + 5 }); // spent
    fetchMock.mockResolvedValueOnce(okJson(null, 204));

    await closeGymVisit('visit-42', 1_700_000_000_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/rpc/close_gym_visit_by_ticket');
    expect(mockSupabaseRpc).not.toHaveBeenCalled();
  });

  // INVARIANT 2, at the level that matters: with a ticket in hand the wake never
  // reaches for the keychain at all, so a locked iPhone is no longer a dead end.
  it('never reads the keychain when a ticket is available', async () => {
    storeTicket();
    persistSession();
    fetchMock.mockResolvedValueOnce(okJson('visit-42'));

    await expect(openGymVisit('partner-1', 'region-1', 1_700_000_000_000)).resolves.toBe('visit-42');

    expect(fetchMock.mock.calls[0][0]).toContain('/rpc/open_gym_visit_by_ticket');
    expect(mockKeychainRead).not.toHaveBeenCalled();
    expect(mockAuthTouched).not.toHaveBeenCalled();
    // PostgREST resolves an RPC by its argument NAMES, so these have to match
    // the wrapper's signature exactly or the call 404s at runtime — something
    // no amount of type-checking on this side would catch.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      p_ticket: 'raw-secret',
      p_device_id: 'device-abc',
      p_partner_id: 'partner-1',
      p_region_id: 'region-1',
      p_started_at: new Date(1_700_000_000_000).toISOString(),
      p_platform: 'ios',
    });
  });

  it('carries the region-event and tick telemetry too — the trail that went blank', async () => {
    storeTicket();
    fetchMock.mockResolvedValue(okJson(null, 204));

    await logGeofenceRegionEvent('region-1', 'enter', { via: 'test' });
    await logGymVisitTick('visit-42', { fix: 'coarse' });
    await markGymVisitProgress('visit-42', 'claimed', 'session-1');

    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      expect.stringContaining('/rpc/log_geofence_region_event_by_ticket'),
      expect.stringContaining('/rpc/log_gym_visit_tick_by_ticket'),
      expect.stringContaining('/rpc/mark_gym_visit_progress_by_ticket'),
    ]);
    expect(mockSupabaseRpc).not.toHaveBeenCalled();
  });

  // A stale ticket must never be worse than no ticket.
  it('falls back to the persisted token when the server refuses the ticket', async () => {
    storeTicket();
    persistSession();
    fetchMock
      .mockResolvedValueOnce(okJson({ code: '28000', message: 'invalid or expired device ticket' }, 403))
      .mockResolvedValueOnce(okJson(null, 204));

    await closeGymVisit('visit-42');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('/rpc/close_gym_visit');
    expect(fetchMock.mock.calls[1][0]).not.toContain('_by_ticket');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer user-jwt');
  });

  // A failure of the WORK is not a failure of the credential — retrying it on
  // another transport would only repeat it.
  it('does not retry on the token path when the ticketed call itself fails', async () => {
    storeTicket();
    persistSession();
    fetchMock.mockResolvedValueOnce(okJson({ message: 'boom' }, 500));

    await expect(openGymVisit('partner-1', 'region-1', 1_700_000_000_000)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The pre-ticket behaviour, unchanged, for installs that have not had a
  // foreground pass since this shipped.
  it('uses the persisted token when there is no ticket', async () => {
    persistSession();
    fetchMock.mockResolvedValueOnce(okJson('visit-42'));

    await expect(openGymVisit('partner-1', 'region-1', 1_700_000_000_000)).resolves.toBe('visit-42');

    expect(fetchMock.mock.calls[0][0]).toContain('/rpc/open_gym_visit');
    expect(fetchMock.mock.calls[0][0]).not.toContain('_by_ticket');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer user-jwt');
  });

  it('falls through to supabase-js only when it has neither', async () => {
    mockSupabaseRpc.mockResolvedValueOnce({ data: 'visit-fallback', error: null });

    await expect(openGymVisit('partner-1', 'region-1', 1_700_000_000_000)).resolves.toBe('visit-fallback');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSupabaseRpc).toHaveBeenCalledTimes(1);
  });

  // INVARIANT 1's other half: the foreground has a live session and is the only
  // context allowed to refresh, so it keeps supabase-js.
  it('leaves the foreground on supabase-js even with a ticket in hand', async () => {
    mockAppState = 'active';
    storeTicket();
    mockSupabaseRpc.mockResolvedValueOnce({ data: 'visit-fg', error: null });

    await expect(openGymVisit('partner-1', 'region-1', 1_700_000_000_000)).resolves.toBe('visit-fg');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSupabaseRpc).toHaveBeenCalledTimes(1);
  });
});

// INVARIANT 4 — the one that makes the rest of this safe.
//
// The ticket lives in AsyncStorage, which is weaker at rest than the keychain.
// That is only a fair trade while the ticket is worth much less than a session,
// and "much less" has to be enforced by the schema rather than by the client
// behaving itself. These two tests are that enforcement: the server grants a
// ticket five verbs, none of which can move a point, and credit keeps requiring
// a GPS confirm carrying the server's own visit nonce.
describe('a ticket can never award a point', () => {
  const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
  const ALLOWED = [
    'open_gym_visit_by_ticket',
    'close_gym_visit_by_ticket',
    'log_gym_visit_tick_by_ticket',
    'log_geofence_region_event_by_ticket',
    'mark_gym_visit_progress_by_ticket',
  ].sort();

  /** Every ticket wrapper any migration has ever granted to a client role. */
  function grantedTicketFunctions(): string[] {
    const found = new Set<string>();
    for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql'))) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      for (const m of sql.matchAll(/grant\s+execute\s+on\s+function\s+public\.(\w*_by_ticket)\s*\(/gi)) {
        found.add(m[1]);
      }
    }
    return [...found].sort();
  }

  it('grants exactly the five verbs the wake path needs, and no others', () => {
    expect(grantedTicketFunctions()).toEqual(ALLOWED);
  });

  // Belt and braces, and the more durable half: a future wrapper could be named
  // anything, but a CREDITING one will be named after what it credits.
  it('has no ticket wrapper for anything that moves points', () => {
    const forbidden = /confirm|claim|credit|point|upgrade|reward|redeem|spend|streak|transaction/i;
    expect(grantedTicketFunctions().filter(fn => forbidden.test(fn))).toEqual([]);
  });

  it('keeps the crediting confirm on the server-minted visit nonce', () => {
    const gymVisits = readFileSync(join(__dirname, '..', 'lib', 'gymVisits.ts'), 'utf8');
    // Credit is requested through confirm_gym_visit_v2/v3 only, and v3's
    // authority is the nonce the SERVER minted for that visit — a question the
    // device can only answer, never ask.
    expect(gymVisits).toContain('confirm_gym_visit_v3');
    expect(gymVisits).not.toMatch(/confirm_gym_visit\w*_by_ticket/);
  });
});

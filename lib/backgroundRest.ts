// Wake-path REST: the user's own token, none of the auth machinery.
//
// THE CLASS THIS DEFEATS (field-proven three times, 2026-08-05 and 2026-08-06):
// in a screen-off background process, any path through supabase-js auth can
// freeze the wake forever. lib/authFresh.ts resyncs a cold headless runtime to
// the persisted pair via setSession(), and setSession() both writes the Keystore
// and may refresh over the network — either half can hang with no recovery,
// because RN's setTimeout is off the UI frame clock, so withNetworkTimeout's own
// race freezes alongside it (see lib/networkTimeout.ts). Two captures on
// 2026-08-06 read identically:
//
//     [authFresh] open_gym_visit: runtime session is stale — resyncing…   ← last line
//     [authFresh] background_wake_warm: …stale vs storage — resyncing…    ← last line
//
// Nothing after either line ever ran: no visit opened, no claim landed, and the
// zombie-heal retry queued behind the same wall. Note the trigger — a cold
// headless runtime has memRefreshToken === null, so EVERY first call in EVERY
// new wake context takes the resync branch. This is not an edge case; it is the
// normal path.
//
// The nonce wake path (lib/gymVisits.ts) already proved the cure: raw fetch,
// anon key, zero auth work — those confirms land in milliseconds on the very
// wakes where the client path hangs. This module generalises that to calls that
// need the USER's identity rather than a visit ticket, by reading the persisted
// access token and presenting it directly.
//
// WHAT IT DELIBERATELY WILL NOT DO: refresh. A background refresh rotates the
// refresh token, and any runtime still holding the old one gets the whole token
// family revoked by GoTrue's reuse detection — the silent-401 outage of
// 2026-08-05. So when the persisted token is spent, this module returns null and
// the caller keeps today's behaviour; it never trades a frozen wake for a
// logged-out device.
//
// AND WHAT THAT LEAVES OPEN, which the DEVICE TICKET at the bottom of this file
// now closes: the persisted token is unusable in the two states every real gym
// visit is in — pocketed for an hour (Supabase access tokens live 60 minutes,
// and we may not refresh), or on a locked iPhone (the keychain refuses the
// read). Both were field-proven on 2026-08-07.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { withNetworkTimeout } from '@/lib/networkTimeout';
import { AUTH_STORAGE_KEY, SUPABASE_ANON_KEY, SUPABASE_URL, authStorage, supabase } from '@/lib/supabase';

/** Don't set out with a token that expires mid-flight. Generous because the
 *  cost of skipping is only a fallback, while a 401 mid-wake is a lost session. */
const MIN_TOKEN_LIFE_S = 60;

export interface BackgroundAuth {
  accessToken: string;
  userId: string;
}

/** PostgREST's own error shape, passed through untouched so existing call sites
 *  can keep checking `error.code === '23505'` and friends. */
export interface BgError {
  code?: string;
  message: string;
  details?: string;
  hint?: string;
  status?: number;
}

export interface BgResult<T> {
  data: T | null;
  error: BgError | null;
}

/**
 * The persisted identity, read without touching supabase-js.
 *
 * Only the READ half of the Keystore is used, which is the half proven to work
 * on a wake: both frozen captures printed their "resyncing" line, which is
 * emitted AFTER the storage read returns and BEFORE setSession is called.
 *
 * Returns null — never throws, never refreshes — when there is no session, when
 * the token is spent, or when the stored shape is unfamiliar. A null answer
 * means "use the ordinary path", not "the user is signed out".
 */
export async function readBackgroundAuth(): Promise<BackgroundAuth | null> {
  try {
    const raw = await authStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const session = parsed?.currentSession ?? parsed;

    const accessToken = session?.access_token;
    const userId = session?.user?.id;
    const expiresAt = session?.expires_at;
    // Both fields are written by supabase-js on every persist. Requiring them
    // (rather than decoding the JWT) keeps this module free of any base64
    // dependency, and an unfamiliar shape simply defers to the normal path.
    if (typeof accessToken !== 'string' || typeof userId !== 'string') return null;

    if (typeof expiresAt === 'number' && expiresAt - Math.floor(Date.now() / 1000) < MIN_TOKEN_LIFE_S) {
      console.warn('[bgRest] Persisted access token is spent — deferring to the auth path (no background refresh: it revokes the family).');
      return null;
    }

    return { accessToken, userId };
  } catch {
    return null;
  }
}

/**
 * The persisted SESSION, read without touching supabase-js — for seeding
 * launch-time state (which stack to show, whose account this is), never for
 * authenticating a request (that is readBackgroundAuth's job).
 *
 * Deliberately NO expiry gate, unlike readBackgroundAuth: an access token that
 * expired in a pocket still names a signed-in user — the refresh token beside
 * it is the durable credential, and only the auth machinery may spend it. A
 * genuinely signed-out device has nothing at this key (sign-out clears it), so
 * a stored session ≈ a signed-in user, however stale the token.
 *
 * Why it exists (field 2026-08-11, iOS): a wake-jammed auth lock made the
 * launch getSession() time out, the bootstrap failed open to signed-out, and
 * INITIAL_SESSION — queued behind the same lock — never arrived to correct the
 * route. The user reopened onto Get Started with a valid session in storage
 * the whole time. This read is what lets the launch route answer from storage
 * while the machinery stays the eventual authority.
 */
export async function readStoredSession(): Promise<Session | null> {
  try {
    const raw = await authStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const session = parsed?.currentSession ?? parsed;
    if (typeof session?.access_token !== 'string' || typeof session?.user?.id !== 'string') return null;
    return session as Session;
  } catch {
    return null;
  }
}

function headers(auth: BackgroundAuth, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${auth.accessToken}`,
    ...extra,
  };
}

/** Turns any transport outcome into PostgREST's {data, error} contract, so a
 *  call site reads the same whichever transport carried it. */
async function run<T>(url: string, init: RequestInit, label: string): Promise<BgResult<T>> {
  try {
    const res = await withNetworkTimeout(fetch(url, init), label);
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      let parsed: Partial<BgError> = {};
      try { parsed = text ? JSON.parse(text) : {}; } catch { /* non-JSON body */ }
      return {
        data: null,
        error: {
          code: parsed.code,
          message: parsed.message ?? `${label} ${res.status}`,
          details: parsed.details,
          hint: parsed.hint,
          status: res.status,
        },
      };
    }
    if (!text) return { data: null, error: null };
    try { return { data: JSON.parse(text) as T, error: null }; } catch { return { data: null, error: null }; }
  } catch (err) {
    return { data: null, error: { message: String((err as Error)?.message ?? err) } };
  }
}

/** Insert one row and return it — the raw-fetch twin of
 *  `.insert(row).select().single()`. PostgREST answers an array; unwrapping here
 *  keeps the call site identical. */
export async function bgInsert<T>(table: string, row: Record<string, unknown>, auth: BackgroundAuth): Promise<BgResult<T>> {
  const res = await run<T[]>(
    `${SUPABASE_URL}/rest/v1/${table}`,
    { method: 'POST', headers: headers(auth, { Prefer: 'return=representation' }), body: JSON.stringify(row) },
    `bg insert ${table}`,
  );
  if (res.error) return { data: null, error: res.error };
  const rows = res.data;
  return { data: Array.isArray(rows) ? (rows[0] ?? null) : (rows as T | null), error: null };
}

/** Select with a PostgREST query string already built by the caller
 *  (e.g. `select=id&user_id=eq.…&order=started_at.desc&limit=1`). */
export async function bgSelect<T>(table: string, query: string, auth: BackgroundAuth): Promise<BgResult<T[]>> {
  return run<T[]>(
    `${SUPABASE_URL}/rest/v1/${table}?${query}`,
    { method: 'GET', headers: headers(auth) },
    `bg select ${table}`,
  );
}

/** Patch the rows matched by `query`. */
export async function bgUpdate(table: string, query: string, patch: Record<string, unknown>, auth: BackgroundAuth): Promise<BgResult<null>> {
  return run<null>(
    `${SUPABASE_URL}/rest/v1/${table}?${query}`,
    { method: 'PATCH', headers: headers(auth), body: JSON.stringify(patch) },
    `bg update ${table}`,
  );
}

/** Call a SECURITY DEFINER RPC as the signed-in user. */
export async function bgRpc<T>(fn: string, args: Record<string, unknown>, auth: BackgroundAuth): Promise<BgResult<T>> {
  return run<T>(
    `${SUPABASE_URL}/rest/v1/rpc/${fn}`,
    { method: 'POST', headers: headers(auth), body: JSON.stringify(args) },
    `bg rpc ${fn}`,
  );
}

// ===========================================================================
// THE DEVICE TICKET — a credential the wake path can actually hold.
//
// Everything above depends on the persisted access token, and that token is
// missing in exactly the conditions a gym visit happens in:
//
//   POCKETED AN HOUR. Access tokens live 60 minutes and we refuse to refresh in
//   the background (see the header). Field, 2026-08-07, Android swiped away
//   since 08:50, at 09:46: "Persisted access token is spent — deferring to the
//   auth path". Every call behind it fell through to supabase-js and timed out
//   at 30 s. The close, the region events, the ticks: all lost, all morning.
//
//   LOCKED iPHONE. The token lives in the keychain and a locked device refuses
//   the read. Since the loading-spinner fix that read returns null instead of
//   throwing — correct, and still no credential.
//
// What kept working on both those mornings is the confirms, because they ride
// the beacon's visit nonce rather than a token. The ticket generalises that:
// mint it in the FOREGROUND, where auth is guaranteed to work; bind it to
// (user_id, device_id); keep it in AsyncStorage, which a backgrounded, locked
// device can read; present it over raw fetch with the anon key exactly as the
// nonce does.
//
// ⚠ IT MUST NEVER BECOME A SESSION. The server grants a ticket five verbs and
// no more — open a visit, close a visit, and three kinds of telemetry — and
// there is deliberately no ticket path to confirm_gym_visit, claim-points or
// upgrade-gym-tier. Credit still requires a GPS confirm carrying the server's
// own visit nonce, so no ticket can manufacture a point. (Since 2026-09-06 the
// open may CARRY the fix that decided the check-in; the server judges it under
// the confirm rule with credit disabled, and the resulting proof clock is what
// the beacon's settle later acts on — the verbs, and the boundary, are unchanged.) That boundary lives in
// the migration (20260807150000_device_wake_ticket.sql), is asserted by
// __tests__/device-wake-ticket.test.ts, and is the reason storing this in
// AsyncStorage rather than the keychain is a fair trade.
// ===========================================================================

const TICKET_KEY = 'POWR_DEVICE_WAKE_TICKET_V1';

/** Renewed on any foreground pass inside this window, so a phone that opens the
 *  app even monthly never reaches the wake path without a ticket. */
const TICKET_RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

/** Same reasoning as MIN_TOKEN_LIFE_S: don't set out on a credential that
 *  expires mid-flight when a fallback is one line away. */
const TICKET_MIN_LIFE_MS = 60 * 1000;

export interface DeviceTicket {
  /** The raw secret. Returned by the server once, at mint; only its hash is stored. */
  ticket: string;
  deviceId: string;
  /** Who it was minted for — so a device that changes hands mints a new one. */
  userId: string;
  /** Epoch ms. */
  expiresAt: number;
}

/**
 * The ticket for this device, or null.
 *
 * AsyncStorage on purpose: it is the one credential store a backgrounded,
 * locked device is guaranteed to be able to read. Never throws — a wake with no
 * ticket falls back, it does not fail.
 */
export async function readDeviceTicket(): Promise<DeviceTicket | null> {
  try {
    const raw = await AsyncStorage.getItem(TICKET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeviceTicket>;
    if (typeof parsed?.ticket !== 'string' || typeof parsed?.deviceId !== 'string') return null;

    const expiresAt =
      typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt) ? parsed.expiresAt : 0;

    if (expiresAt && expiresAt - Date.now() < TICKET_MIN_LIFE_MS) {
      console.warn('[bgRest] Device wake ticket has expired — the next foreground pass will mint a fresh one.');
      return null;
    }

    return {
      ticket: parsed.ticket,
      deviceId: parsed.deviceId,
      userId: typeof parsed.userId === 'string' ? parsed.userId : '',
      expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Mint a ticket if this device hasn't got a usable one. FOREGROUND ONLY.
 *
 * This is the single moment in the ticket's life that needs a live session, and
 * it is the moment we are certain of one: the app is open, the keychain is
 * readable, supabase-js may refresh freely. Everything the wake path does
 * afterwards is paid for here.
 *
 * Re-mints when the ticket is missing, belongs to another account or another
 * device, or is inside its renewal window. Best-effort throughout: a device that
 * fails to mint simply keeps today's behaviour.
 *
 * ⚠ REFUSES TO RUN IN THE BACKGROUND, and that guard is load-bearing. A push
 * launches the app into the background with the phone still locked (it is what
 * pinned the app on its loading spinner on 2026-08-07), and AuthContext's
 * INITIAL_SESSION fires there like anywhere else. Minting on that launch would
 * do exactly the two things this whole module exists to avoid — a keychain read
 * and an authenticated round-trip on a wake — and getDeviceId would be reading a
 * locked keychain, so it would bind the ticket to a throwaway fallback id. The
 * next real foreground pass mints; nothing is lost by waiting for one.
 */
export async function ensureDeviceWakeTicket(userId: string, deviceId: string, platform?: string): Promise<void> {
  if (AppState.currentState !== 'active') return;

  try {
    const existing = await readDeviceTicket();
    const usable = existing
      && existing.deviceId === deviceId
      && existing.userId === userId
      && existing.expiresAt - Date.now() > TICKET_RENEW_WITHIN_MS;
    if (usable) return;

    const { data, error } = await supabase.rpc('mint_device_wake_ticket', {
      p_device_id: deviceId,
      p_platform: platform ?? null,
    });
    if (error) {
      console.warn('[bgRest] mint_device_wake_ticket failed:', error.message);
      return;
    }

    const minted = data as { ticket?: string; device_id?: string; expires_at?: string } | null;
    if (!minted?.ticket || !minted?.device_id) {
      console.warn('[bgRest] mint_device_wake_ticket returned an unfamiliar shape — no ticket stored.');
      return;
    }

    const next: DeviceTicket = {
      ticket: minted.ticket,
      deviceId: minted.device_id,
      userId,
      expiresAt: minted.expires_at ? Date.parse(minted.expires_at) : 0,
    };
    await AsyncStorage.setItem(TICKET_KEY, JSON.stringify(next));
    console.log('[bgRest] Device wake ticket minted — the wake path no longer needs a live token.');
  } catch (err) {
    console.warn('[bgRest] ensureDeviceWakeTicket threw:', err);
  }
}

/**
 * Retire this device's ticket on sign-out.
 *
 * Revoked with the TICKET itself rather than a session, because sign-out is
 * precisely when the session may already be gone — a forced sign-out, a revoked
 * token family, a locked keychain. A credential you can only retire while you
 * still hold a working session is a credential that never gets retired.
 *
 * The local copy is dropped even if the server call fails: the ticket is bound
 * to a user, and leaving one behind for the departing account is the worse of
 * the two failures. It expires on its own regardless.
 */
export async function clearDeviceWakeTicket(): Promise<void> {
  try {
    const existing = await readDeviceTicket();
    if (existing) {
      await ticketRpc('revoke_device_wake_ticket', {}, existing);
    }
    await AsyncStorage.removeItem(TICKET_KEY);
  } catch (err) {
    console.warn('[bgRest] clearDeviceWakeTicket threw:', err);
  }
}

/**
 * Call a ticket-authenticated RPC. No user JWT anywhere: the anon key is the
 * apikey AND the bearer, and the ticket in the body is the authority — the same
 * shape the visit-nonce wake path has used since 2026-08-05.
 */
export async function ticketRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  ticket: DeviceTicket,
): Promise<BgResult<T>> {
  return run<T>(
    `${SUPABASE_URL}/rest/v1/rpc/${fn}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ ...args, p_ticket: ticket.ticket, p_device_id: ticket.deviceId }),
    },
    `ticket rpc ${fn}`,
  );
}

/**
 * Did the server refuse the TICKET, as opposed to failing the work?
 *
 * The wrappers raise SQLSTATE 28000 (invalid_authorization_specification) for an
 * expired, revoked or unknown ticket, which PostgREST answers 403 with the code
 * intact. Worth distinguishing: a refused ticket is worth retrying with the
 * persisted token, whereas a failed open is not worth retrying at all.
 */
export function isTicketRejection(error: BgError | null): boolean {
  if (!error) return false;
  return error.code === '28000' || /expired device ticket/i.test(error.message ?? '');
}

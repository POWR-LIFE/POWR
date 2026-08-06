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

import { withNetworkTimeout } from '@/lib/networkTimeout';
import { AUTH_STORAGE_KEY, SUPABASE_ANON_KEY, SUPABASE_URL, authStorage } from '@/lib/supabase';

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

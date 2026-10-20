// Garmin Connect Developer Program — OAuth 2.0 PKCE and the user endpoints.
// Server side only: Garmin offers no secretless flow, and the token exchange
// and refresh must never run on a phone (OAuth2 PKCE spec, steps 2 and 3).
//
// Uses only Web Crypto and fetch, so it runs in Deno and the PKCE helpers can
// be tested from jest (Node 18+ has globalThis.crypto).

export const GARMIN_AUTHORIZE_URL = 'https://connect.garmin.com/oauth2Confirm';
export const GARMIN_TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
const GARMIN_USER_URL = 'https://apis.garmin.com/partner-gateway/rest/user';

/** Garmin recommends refreshing at least 600 s before the stated expiry. */
export const REFRESH_MARGIN_SEC = 600;

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random URL-safe string from `byteLength` random bytes. */
export function randomUrlSafe(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/**
 * A PKCE code verifier: 43–128 characters from [A-Za-z0-9-._~]. 48 random
 * bytes encode to 64 base64url characters, inside both bounds.
 */
export function newCodeVerifier(): string {
  return randomUrlSafe(48);
}

/** base64url(sha256(verifier)) — the S256 code challenge. */
export async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(params: {
  clientId: string; codeChallenge: string; redirectUri: string; state: string;
}): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: params.redirectUri,
    state: params.state,
  });
  return `${GARMIN_AUTHORIZE_URL}?${q.toString()}`;
}

export type GarminTokens = {
  access_token: string;
  refresh_token: string;
  /** Seconds. 86400 in Garmin's examples. */
  expires_in: number;
  /** Seconds. About 90 days. */
  refresh_token_expires_in?: number;
};

export class GarminApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'GarminApiError';
  }
}

async function tokenRequest(form: Record<string, string>): Promise<GarminTokens> {
  const res = await fetch(GARMIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok || !body?.access_token || !body?.refresh_token) {
    throw new GarminApiError(res.status, `token request failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return body as GarminTokens;
}

/** Step 2: swap the one-time authorization code for tokens. */
export function exchangeCode(p: {
  clientId: string; clientSecret: string; code: string; codeVerifier: string; redirectUri: string;
}): Promise<GarminTokens> {
  return tokenRequest({
    grant_type: 'authorization_code',
    client_id: p.clientId,
    client_secret: p.clientSecret,
    code: p.code,
    code_verifier: p.codeVerifier,
    redirect_uri: p.redirectUri,
  });
}

/** A new access token. Garmin rotates the refresh token too — store the new one. */
export function refreshTokens(p: {
  clientId: string; clientSecret: string; refreshToken: string;
}): Promise<GarminTokens> {
  return tokenRequest({
    grant_type: 'refresh_token',
    client_id: p.clientId,
    client_secret: p.clientSecret,
    refresh_token: p.refreshToken,
  });
}

async function userCall(accessToken: string, path: string, method = 'GET'): Promise<Response> {
  return await fetch(`${GARMIN_USER_URL}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/** The Garmin API user id — stable across reconnects; every push carries it. */
export async function fetchUserId(accessToken: string): Promise<string> {
  const res = await userCall(accessToken, 'id');
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.userId !== 'string' || !body.userId) {
    throw new GarminApiError(res.status, `user id lookup failed: ${res.status}`);
  }
  return body.userId;
}

/**
 * The permissions the user ticked on Garmin's consent screen. The spec shows
 * two response shapes ({ permissions: [...] } and a bare list), so accept both.
 */
export async function fetchPermissions(accessToken: string): Promise<string[]> {
  const res = await userCall(accessToken, 'permissions');
  if (!res.ok) throw new GarminApiError(res.status, `permissions lookup failed: ${res.status}`);
  const body = await res.json().catch(() => null);
  const list = Array.isArray(body) ? body : body?.permissions;
  return Array.isArray(list) ? list.filter((p: unknown) => typeof p === 'string') : [];
}

/**
 * Remove the user from our program at Garmin. Garmin REQUIRES this whenever
 * the app offers a disconnect or delete-account path of its own. 204 on
 * success; Garmin then sends a final deregistration push.
 */
export async function deleteRegistration(accessToken: string): Promise<void> {
  const res = await userCall(accessToken, 'registration', 'DELETE');
  if (res.status !== 204 && !res.ok) {
    throw new GarminApiError(res.status, `delete registration failed: ${res.status}`);
  }
}

/** Expiry instants for a fresh token response, as ISO strings. */
export function expiriesFrom(tokens: GarminTokens, nowMs: number = Date.now()) {
  return {
    access_expires_at: new Date(nowMs + tokens.expires_in * 1000).toISOString(),
    refresh_expires_at: tokens.refresh_token_expires_in != null
      ? new Date(nowMs + tokens.refresh_token_expires_in * 1000).toISOString()
      : null,
  };
}

/** True when an access token expiring at `expiresAtIso` should be refreshed now. */
export function needsRefresh(expiresAtIso: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!expiresAtIso) return true;
  const t = Date.parse(expiresAtIso);
  if (Number.isNaN(t)) return true;
  return t - nowMs <= REFRESH_MARGIN_SEC * 1000;
}

/**
 * The return address the app asked for, if it is one we will send a user to:
 * the app's own scheme, or Expo Go's during development. Anything else (an
 * https page, a typo) falls back to the app — never an open redirect.
 */
export function safeReturnTo(raw: unknown, fallback = 'powr://garmin-callback'): string {
  if (typeof raw !== 'string') return fallback;
  const v = raw.trim();
  if (/^powr:\/\/garmin-callback(\?|$)/.test(v)) return v;
  if (/^exps?:\/\/[^\s]+\/--\/garmin-callback(\?|$)/.test(v)) return v;
  return fallback;
}

/** Append query params to a return address that may already carry some. */
export function withParams(url: string, params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return url.includes('?') ? `${url}&${q}` : `${url}?${q}`;
}

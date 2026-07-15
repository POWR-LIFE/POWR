// @ts-nocheck — Deno runtime, not Node.
// Direct FCM v1 sender for ANDROID silent wakes.
//
// WHY: Android never delivered the beacon's data-only wake when routed through
// Expo's push service — "accepted" tickets, clean receipts, nothing on the
// device (field matrix 2026-07-13/14: visible pushes fine, data-only to a
// BACKGROUNDED app never). Sent directly via FCM v1 with android.priority HIGH,
// the same wake reached the background task in ~1 s (proven live 2026-07-14).
// High-priority FCM also grants the app a short execution window, which is what
// lets the woken claim chain actually run mid-Doze.
//
// Auth: OAuth2 JWT-bearer assertion signed with the Firebase service account.
// FCM_SERVICE_ACCOUNT secret = the service-account JSON, verbatim. The minted
// access token is cached at module scope (~1 h validity, refreshed 5 min early).
// If the secret is absent or minting fails, callers fall back to the Expo path —
// unsetting the secret is the rollback switch.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let _cached: { token: string; projectId: string; expiresAtMs: number } | null = null;

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function mintedToken(): Promise<{ token: string; projectId: string } | null> {
  if (_cached && Date.now() < _cached.expiresAtMs - 5 * 60 * 1000) {
    return { token: _cached.token, projectId: _cached.projectId };
  }
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    const enc = new TextEncoder();
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const claims = b64url(enc.encode(JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })));
    const unsigned = `${header}.${claims}`;
    const key = await crypto.subtle.importKey(
      'pkcs8',
      pemToPkcs8(sa.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned)));
    const assertion = `${unsigned}.${b64url(sig)}`;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const json = await res.json();
    if (!res.ok || !json?.access_token) {
      console.error('[fcmV1] token exchange failed', res.status, json?.error ?? '');
      return null;
    }
    _cached = { token: json.access_token, projectId: sa.project_id, expiresAtMs: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return { token: _cached.token, projectId: _cached.projectId };
  } catch (err) {
    console.error('[fcmV1] token mint failed', err);
    return null;
  }
}

export interface FcmSendOutcome {
  ok: boolean;
  messageName?: string;   // FCM's message id — stored as the log ticket
  error?: string;
  unregistered?: boolean; // token is dead — safe to prune
  unavailable?: boolean;  // no credentials / mint failed — caller should fall back to Expo
}

/** Sends one data-only, HIGH-priority FCM v1 message. All data values must be
 *  strings (FCM contract). Never throws. */
export async function sendFcmDataMessage(
  deviceToken: string,
  data: Record<string, string>,
  ttlSeconds: number,
): Promise<FcmSendOutcome> {
  const auth = await mintedToken();
  if (!auth) return { ok: false, unavailable: true, error: 'fcm_credentials_unavailable' };
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${auth.projectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          data,
          android: { priority: 'HIGH', ttl: `${ttlSeconds}s` },
        },
      }),
    });
    const json = await res.json().catch(() => null);
    if (res.ok) return { ok: true, messageName: json?.name };
    const errCode = json?.error?.details?.find?.((d) => d?.errorCode)?.errorCode
      ?? json?.error?.status ?? `http_${res.status}`;
    return {
      ok: false,
      error: String(errCode),
      unregistered: res.status === 404 || errCode === 'UNREGISTERED',
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

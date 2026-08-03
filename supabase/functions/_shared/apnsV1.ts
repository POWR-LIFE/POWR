// @ts-nocheck — Deno runtime, not Node.
// Direct APNs sender for iOS silent wakes.
//
// WHY: the iOS leg of the beacon's silent wake goes through Expo's push
// service, and for real users it is effectively dead — fleet 07-20→08-03: of
// 16 dwell-nudged real-user visits, exactly ONE ever landed a wake_received,
// while Expo reported every send "accepted" with clean receipts. This is the
// same blindness that hid the Android failure (fixed 2026-07-14 by sending
// direct via FCM v1 — wakes then arrived in ~1 s). Sending straight to APNs
// gives us the delivery attributes Apple documents for background pushes
// (apns-push-type: background, apns-priority: 5) and Apple's own per-device
// verdict per send, instead of a proxy's "accepted".
//
// Auth: ES256 JWT signed with the team's APNs auth key (.p8). Secrets:
//   APNS_AUTH_KEY  — the .p8 file contents, verbatim
//   APNS_KEY_ID    — the key's ID
//   APNS_TEAM_ID   — the Apple developer team ID
//   APNS_BUNDLE_ID — the app's bundle id (apns-topic)
// The minted token is cached at module scope (Apple accepts tokens up to 1 h
// old; refreshed at 50 min). If any secret is absent or minting fails, callers
// fall back to the Expo path — unsetting APNS_AUTH_KEY is the rollback switch,
// exactly like FCM_SERVICE_ACCOUNT on the Android side.

const APNS_HOST = 'https://api.push.apple.com';
const TOKEN_LIFETIME_MS = 50 * 60 * 1000;

let _cached: { jwt: string; mintedAtMs: number } | null = null;

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

async function mintedJwt(): Promise<string | null> {
  if (_cached && Date.now() - _cached.mintedAtMs < TOKEN_LIFETIME_MS) return _cached.jwt;
  const pem = Deno.env.get('APNS_AUTH_KEY');
  const keyId = Deno.env.get('APNS_KEY_ID');
  const teamId = Deno.env.get('APNS_TEAM_ID');
  if (!pem || !keyId || !teamId) return null;
  try {
    const enc = new TextEncoder();
    const header = b64url(enc.encode(JSON.stringify({ alg: 'ES256', kid: keyId })));
    const claims = b64url(enc.encode(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) })));
    const unsigned = `${header}.${claims}`;
    const key = await crypto.subtle.importKey(
      'pkcs8',
      pemToPkcs8(pem),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    // WebCrypto ECDSA emits the raw r||s form, which is exactly what JOSE
    // ES256 wants — no DER re-encoding needed.
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)));
    const jwt = `${unsigned}.${b64url(sig)}`;
    _cached = { jwt, mintedAtMs: Date.now() };
    return jwt;
  } catch (err) {
    console.error('[apnsV1] token mint failed', err);
    return null;
  }
}

export interface ApnsSendOutcome {
  ok: boolean;
  apnsId?: string;        // Apple's apns-id header — stored as the log ticket
  error?: string;
  unregistered?: boolean; // token is dead at APNs — safe to prune
  unavailable?: boolean;  // no credentials / mint failed — caller should fall back to Expo
}

/** Sends one background (content-available) APNs push. Apple REQUIRES
 *  priority 5 and apns-push-type: background for these — priority 10 with
 *  content-available is a policy violation Apple may punish with throttling.
 *  Never throws. */
export async function sendApnsBackgroundPush(
  deviceToken: string,
  data: Record<string, unknown>,
  ttlSeconds: number,
): Promise<ApnsSendOutcome> {
  const jwt = await mintedJwt();
  const topic = Deno.env.get('APNS_BUNDLE_ID');
  if (!jwt || !topic) return { ok: false, unavailable: true, error: 'apns_credentials_unavailable' };
  try {
    const res = await fetch(`${APNS_HOST}/3/device/${deviceToken}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-topic': topic,
        'apns-push-type': 'background',
        'apns-priority': '5',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + ttlSeconds),
      },
      body: JSON.stringify({ aps: { 'content-available': 1 }, ...data }),
    });
    const apnsId = res.headers.get('apns-id') ?? undefined;
    if (res.ok) return { ok: true, apnsId };
    const json = await res.json().catch(() => null);
    const reason = json?.reason ?? `http_${res.status}`;
    if (reason === 'ExpiredProviderToken') _cached = null; // re-mint on next call
    return {
      ok: false,
      apnsId,
      error: String(reason),
      // 410 Unregistered = the device token is gone for this topic.
      // BadDeviceToken usually means an environment mismatch (sandbox token
      // against production) — prune it the same way; it will never deliver.
      unregistered: res.status === 410 || reason === 'BadDeviceToken',
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

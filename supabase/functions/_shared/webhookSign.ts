// @ts-nocheck — Deno runtime
// Signing + hashing helpers shared by the partner developer API surface:
// partner-api (key hashing), partner-webhook-dispatch + manage-partner-api
// (delivery signatures), redeem-reward (JIT mint requests).
//
// Signature scheme (Stripe-style):
//   X-POWR-Signature: t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<raw body>">
// Receivers recompute the HMAC with their endpoint/mint secret and compare.

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(message: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(message)));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

// Headers for an outbound signed POST (webhook delivery or JIT mint request).
export async function signedHeaders(secret: string, body: string, extra: Record<string, string> = {}) {
  const t = Math.floor(Date.now() / 1000);
  const sig = await hmacSha256Hex(secret, `${t}.${body}`);
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'POWR-Webhooks/1.0',
    'X-POWR-Signature': `t=${t},v1=${sig}`,
    ...extra,
  };
}

// Random hex token, e.g. API keys and webhook secrets.
export function randomHex(bytes = 20): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// POST with a hard timeout; returns { ok, status, error } and never throws.
export async function signedPost(url: string, secret: string, body: string, opts: { timeoutMs?: number; extraHeaders?: Record<string, string> } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: await signedHeaders(secret, body, opts.extraHeaders ?? {}),
      body,
      signal: controller.signal,
    });
    let text = '';
    try { text = (await res.text()).slice(0, 500); } catch { /* body unavailable */ }
    return { ok: res.ok, status: res.status, body: text, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, status: 0, body: '', error: aborted ? 'timeout' : String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

// Terra webhook signature verification. Pure + uses Web Crypto (globalThis.crypto),
// so it runs in both Deno (edge function) and Node (Jest) without any Deno APIs.
//
// Terra signs each webhook with header:
//   terra-signature: t=<unix>,v1=<hex hmac-sha256>
// where the signed message is `${t}.${rawBody}` keyed by the endpoint signing
// secret. Verification REQUIRES the raw, unaltered request body.

const enc = new TextEncoder();

export function parseTerraSignature(header: string | null): { t: string; v1: string } | null {
  if (!header) return null;
  const parts: Record<string, string> = {};
  for (const kv of header.split(',')) {
    const [k, v] = kv.split('=').map((s) => s.trim());
    if (k && v) parts[k] = v;
  }
  if (!parts['t'] || !parts['v1']) return null;
  return { t: parts['t'], v1: parts['v1'] };
}

/** Constant-time string compare to avoid leaking timing information. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compute the expected v1 hex HMAC for a (timestamp, rawBody, secret) tuple. */
export async function computeTerraSignature(t: string, rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when the terra-signature header is a valid HMAC of the raw body. */
export async function verifyTerraSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  const parsed = parseTerraSignature(header);
  if (!parsed) return false;
  const expected = await computeTerraSignature(parsed.t, rawBody, secret);
  return constantTimeEqual(expected, parsed.v1.toLowerCase());
}

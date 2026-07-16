// @ts-nocheck — Deno runtime
// Diagnostic probe for a brand's JIT mint endpoint, shared by partner-api
// (POST /v1/test/mint) and manage-partner-api (test_mint portal action).
// Sends a signed code.mint_request with test:true and grades the response
// against the same contract redeem-reward enforces — WITHOUT storing a code
// or touching the mint circuit breaker, and it works before mint_enabled is
// switched on (that's the point: verify first, enable after).

import { signedPost } from './webhookSign.ts';

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,62}[A-Z0-9]$/;

// integration: { brand_name, mint_url, mint_secret }
// Returns { ok, stage, status, elapsed_ms, error, warning, code_preview }
//   stage on failure: 'config' | 'request' | 'parse' | 'code'
export async function testMintEndpoint(integration) {
  if (!integration?.mint_url || !integration?.mint_secret) {
    return { ok: false, stage: 'config', error: 'No mint endpoint URL is configured yet' };
  }

  const body = JSON.stringify({
    type: 'code.mint_request',
    test: true,
    request_id: crypto.randomUUID(),
    brand_name: integration.brand_name,
    reward_id: '00000000-0000-0000-0000-000000000000',
    reward_title: 'Connection test (no code will be issued)',
    expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
  });

  const started = Date.now();
  const res = await signedPost(integration.mint_url, integration.mint_secret, body, {
    timeoutMs: 3000,
    extraHeaders: { 'X-POWR-Event': 'code.mint_request' },
  });
  const elapsed = Date.now() - started;

  if (!res.ok) {
    return {
      ok: false, stage: 'request', status: res.status, elapsed_ms: elapsed,
      error: res.error === 'timeout'
        ? 'Endpoint did not respond within the 3s mint budget'
        : `Endpoint returned ${res.status || 'no response'} (${res.error})`,
    };
  }

  let code = null;
  try { code = String(JSON.parse(res.body)?.code ?? '').trim().toUpperCase(); } catch { code = null; }
  if (code === null) {
    return { ok: false, stage: 'parse', status: res.status, elapsed_ms: elapsed, error: 'Response body is not valid JSON with a "code" field' };
  }
  if (!code || !CODE_RE.test(code)) {
    return { ok: false, stage: 'code', status: res.status, elapsed_ms: elapsed, error: 'The "code" value must be 4–64 letters/digits/hyphens' };
  }

  return {
    ok: true, status: res.status, elapsed_ms: elapsed,
    code_preview: code.length > 8 ? `${code.slice(0, 8)}…` : code,
    warning: elapsed > 2000 ? 'Response took over 2s — live mints are cut off at 3s, so add headroom' : null,
  };
}

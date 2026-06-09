// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Terra auth broker. Called by a logged-in user to connect or disconnect a
// provider. Keeps TERRA_DEV_ID / TERRA_API_KEY server-side.
//
// Connect (default): uses Terra's Custom-UI auth (authenticateUser) so the
//   connection screen is POWR's own native provider list — the user goes
//   straight to the chosen provider's login, with no Terra-hosted widget page.
//   reference_id = the caller's Supabase user id, so the terra-webhook `auth`
//   event maps the new Terra user back to this POWR user.
//   Input:  { resource: <Terra cloud-provider slug, see ALLOWED below> }
//   Output: { url }  — the provider auth URL to open in a system auth session.
//
// Deauth: revokes a connection at Terra.
//   Input:  { action: 'deauth', terra_user_id }
//   Output: { ok: true }
import { createClient } from '@supabase/supabase-js';

// authenticateUser takes `resource` as a query param; the rest go in the JSON body.
const AUTH_API = 'https://api.tryterra.co/v2/auth/authenticateUser';
const DEAUTH_API = 'https://api.tryterra.co/v2/auth/deauthenticateUser';
const DEV_ID = Deno.env.get('TERRA_DEV_ID')!;
const API_KEY = Deno.env.get('TERRA_API_KEY')!;
const TERRA_HEADERS = { 'dev-id': DEV_ID, 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

// Providers we route through Terra (cloud OAuth wearables only).
const ALLOWED = new Set([
  'WHOOP', 'OURA', 'GARMIN', 'POLAR', 'FITBIT', 'STRAVA', 'HUAWEI', 'WITHINGS', 'PELOTON', 'ZEPP', 'TECHNOGYM',
  'COROS', 'SUUNTO', 'WAHOO', 'ZWIFT', 'CONCEPT2', 'IFIT', 'UNDERARMOUR',
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization' }, 401);

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  );
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const { data: { user }, error: authError } = await userClient.auth.getUser(jwt);
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  let body: { action?: string; resource?: string; terra_user_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  // ── Deauth ──────────────────────────────────────────────────────────────────
  if (body.action === 'deauth') {
    if (!body.terra_user_id) return json({ error: 'terra_user_id required' }, 400);
    const res = await fetch(`${DEAUTH_API}?user_id=${encodeURIComponent(body.terra_user_id)}`, {
      method: 'DELETE',
      headers: TERRA_HEADERS,
    });
    // Terra returns 200 on success; treat 404 (already gone) as success too.
    return json({ ok: res.ok || res.status === 404 }, res.ok || res.status === 404 ? 200 : res.status);
  }

  // ── Connect (per-provider auth URL for POWR's native UI) ──────────────────────
  const resource = (body.resource ?? '').toUpperCase();
  if (!ALLOWED.has(resource)) return json({ error: 'Unsupported resource' }, 400);

  const res = await fetch(`${AUTH_API}?resource=${encodeURIComponent(resource)}`, {
    method: 'POST',
    headers: TERRA_HEADERS,
    body: JSON.stringify({
      reference_id: user.id,
      auth_success_redirect_url: 'powr://terra-callback',
      auth_failure_redirect_url: 'powr://terra-callback?error=1',
      language: 'en',
    }),
  });

  const data = await res.json().catch(() => ({}));
  // Log the full Terra response so connect failures can be traced (status + body).
  console.log(`[terra-auth] authenticateUser ${resource} → ${res.status}:`, JSON.stringify(data));
  if (!res.ok || !data?.auth_url) {
    return json({ error: 'Terra auth failed', detail: data }, res.ok ? 502 : res.status);
  }
  return json({ url: data.auth_url });
});

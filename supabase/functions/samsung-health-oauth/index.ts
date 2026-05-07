// @ts-nocheck — Deno runtime
// Samsung Health OAuth broker: keeps SAMSUNG_HEALTH_CLIENT_SECRET server-side.
// Deployed with verify_jwt = false (see supabase/config.toml) because this
// function is called during onboarding before the user necessarily has a
// Supabase session. Security rests on the PKCE code_verifier + one-time code
// issued by Samsung.
// Two actions:
//   { action: "exchange", code, code_verifier, redirect_uri }
//   { action: "refresh",  refresh_token }
// Returns Samsung's JSON token payload unchanged on success.
//
// TODO: verify exact token endpoint URL against developer.samsung.com/health
// once credentials are approved — the endpoint below is for Samsung Health
// Data Service (SHDS). If Samsung provides a different URL in the dev portal,
// update TOKEN_URL accordingly.

const CLIENT_ID = Deno.env.get('SAMSUNG_HEALTH_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('SAMSUNG_HEALTH_CLIENT_SECRET')!;
const TOKEN_URL = 'https://account.samsung.com/accounts/v1/SHDS/token';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function postForm(params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  if (body.action === 'exchange') {
    const { code, code_verifier, redirect_uri } = body;
    if (!code || !code_verifier || !redirect_uri) {
      return json({ error: 'code, code_verifier, redirect_uri required' }, 400);
    }
    const r = await postForm({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      code_verifier,
      redirect_uri,
    });
    return json(r.data, r.ok ? 200 : r.status);
  }

  if (body.action === 'refresh') {
    const { refresh_token } = body;
    if (!refresh_token) return json({ error: 'refresh_token required' }, 400);
    const r = await postForm({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token,
    });
    return json(r.data, r.ok ? 200 : r.status);
  }

  return json({ error: 'Unknown action' }, 400);
});

// @ts-nocheck — Deno runtime
// Whoop OAuth broker: keeps WHOOP_CLIENT_SECRET server-side.
// Deployed with verify_jwt = false (see supabase/config.toml) because this
// function is called during onboarding before the user necessarily has a
// Supabase session. Security rests on the PKCE code_verifier + one-time code
// issued by Whoop.
// Two actions:
//   { action: "exchange", code, code_verifier, redirect_uri }
//   { action: "refresh",  refresh_token }
// Returns Whoop's JSON token payload unchanged on success.

const CLIENT_ID = Deno.env.get('WHOOP_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('WHOOP_CLIENT_SECRET')!;
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

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
    if (!code || !redirect_uri) {
      return json({ error: 'code, redirect_uri required' }, 400);
    }
    const params: Record<string, string> = {
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri,
    };
    if (code_verifier) params.code_verifier = code_verifier;
    const r = await postForm(params);
    return json(r.data, r.ok ? 200 : r.status);
  }

  if (body.action === 'refresh') {
    const { refresh_token } = body;
    if (!refresh_token) return json({ error: 'refresh_token required' }, 400);
    const r = await postForm({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token,
    });
    return json(r.data, r.ok ? 200 : r.status);
  }

  return json({ error: 'Unknown action' }, 400);
});

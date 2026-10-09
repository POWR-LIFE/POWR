// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Disconnects every live Terra connection — the last, one-way step of pausing
// Terra (see _shared/terraPause.ts for the switch that comes first).
//
// Why disconnect at all once the switch is on: an active connection still
// costs Terra credits, and the profile still names the wearable as the user's
// source, so app builds without the switch keep native workout and sleep sync
// off. Disconnecting moves every user back to their phone's health store on
// any app version.
//
// Input:  { dry_run?: boolean (default TRUE), providers?: string[] }
//   dry_run — lists who would be disconnected and touches nothing.
//   providers — Terra slugs ('WHOOP', 'GARMIN'…) to limit the run; all if omitted.
// Per connection: DELETE at Terra (404 = already gone), then record it here
// the way terra-webhook's deauth handler does (deauthed_at + profileAfterDeauth)
// so the result doesn't wait on Terra's deauth event, which lands as a no-op.
//
// Refuses unless 'terra_paused' is on: disconnecting while Terra is live would
// only make people reconnect. Users must reconnect when Terra comes back either
// way — Garmin issues a fresh connection per user after its approval.
//
// Security: verify_jwt=false; gated by the shared x-resolve-token cron secret
// (verify_resolve_token, Vault), same as terra-poll. Never exposed to the app.
import { createClient } from '@supabase/supabase-js';
import { isTerraPaused } from '../_shared/terraPause.ts';
import { profileAfterDeauth } from '../_shared/terraDeauth.ts';

const DEAUTH_API = 'https://api.tryterra.co/v2/auth/deauthenticateUser';
const DEV_ID = Deno.env.get('TERRA_DEV_ID')!;
const API_KEY = Deno.env.get('TERRA_API_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const token = req.headers.get('x-resolve-token') ?? '';
  const { data: valid } = await supabase.rpc('verify_resolve_token', { p_token: token });
  if (valid !== true) return new Response('forbidden', { status: 403 });

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run !== false;
  const only = Array.isArray(body?.providers)
    ? new Set(body.providers.map((p: unknown) => String(p).toUpperCase()))
    : null;

  const paused = await isTerraPaused(supabase);
  if (!dryRun && !paused) {
    return json({ error: "Turn 'terra_paused' on first — disconnecting while Terra is live only makes people reconnect." }, 409);
  }

  const { data: conns, error } = await supabase
    .from('terra_connections')
    .select('terra_user_id, provider, user_id')
    .is('deauthed_at', null);
  if (error) return json({ error: error.message }, 500);

  const targets = (conns ?? []).filter(c => !only || only.has(String(c.provider).toUpperCase()));
  const rows: Record<string, string>[] = [];

  for (const c of targets) {
    const row = { provider: c.provider, user: String(c.user_id).slice(0, 8), terra_user: String(c.terra_user_id).slice(0, 8), result: 'would disconnect' };
    if (!dryRun) {
      try {
        const res = await fetch(`${DEAUTH_API}?user_id=${encodeURIComponent(c.terra_user_id)}`, {
          method: 'DELETE',
          headers: { 'dev-id': DEV_ID, 'x-api-key': API_KEY },
        });
        if (!res.ok && res.status !== 404) {
          row.result = `terra ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`;
          rows.push(row);
          continue;
        }
        await supabase.from('terra_connections')
          .update({ deauthed_at: new Date().toISOString() })
          .eq('terra_user_id', c.terra_user_id);
        const { data: prof } = await supabase
          .from('profiles').select('health_provider_connections, active_health_provider')
          .eq('id', c.user_id).maybeSingle();
        if (prof) {
          await supabase.from('profiles')
            .update(profileAfterDeauth(prof.health_provider_connections ?? {}, prof.active_health_provider ?? null, c.provider))
            .eq('id', c.user_id);
        }
        row.result = res.status === 404 ? 'already gone at Terra; recorded' : 'disconnected';
      } catch (e) {
        row.result = `threw: ${e?.message ?? e}`;
      }
    }
    rows.push(row);
  }

  console.log(`[terra-deauth-all] ${dryRun ? 'dry run' : 'run'}: ${rows.length} connection(s), paused=${paused}`);
  return json({ dry_run: dryRun, paused, count: rows.length, rows });
});

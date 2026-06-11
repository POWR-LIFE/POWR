// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Freshness loop for Terra wearable data. Terra's auto-push has proven
// unreliable (2026-06-10: connections sat with sleep in Terra that never
// reached terra-webhook — only auth events were delivered). A pg_cron job
// (migration 20260610000001) POSTs here every 30 minutes; for every active
// connection with no webhook delivery in the last STALE_AFTER_MIN minutes we
// ask Terra to (re)send the recent window with to_webhook=true. Terra then
// POSTs the data to terra-webhook as if it had auto-pushed.
//
// Efficiency properties:
//   - terra-webhook is idempotent (per-type-per-day unique index + steps-delta
//     merge), so re-delivery costs nothing but the request.
//   - terra-webhook stamps terra_connections.last_event_at on every data
//     payload, so connections Terra IS pushing for are skipped entirely. If
//     Terra's auto-push gets fixed, this loop converges to a no-op.
//
// Security: verify_jwt=false (pg_net is not a Supabase user); access is gated
// by the x-poll-token shared secret, which lives only in the cron job's
// definition and here.
import { createClient } from '@supabase/supabase-js';

const DEV_ID = Deno.env.get('TERRA_DEV_ID')!;
const API_KEY = Deno.env.get('TERRA_API_KEY')!;
const POLL_TOKEN = '06190b613be962a04476271cb6dc8c7fbb0a13758edd178b';

/** No webhook data for this long ⇒ ask Terra to resend the recent window.
 *  Kept below the 30-min cron cadence so every cycle re-asks: a delivery
 *  stamps last_event_at, and a 90-min threshold was observed to stretch the
 *  effective per-connection cadence to ~2h (fresh stamp ⇒ skipped cycles).
 *  Cost: 3 light Terra GETs per active connection per 30 min. */
const STALE_AFTER_MIN = 25;
/** Resources worth polling. Gym/HIIT are geofence-verified, never Terra. */
const RESOURCES = ['sleep', 'daily', 'activity'];
/** Safety cap per run; the cron retries every 30 min so backlog drains fast. */
const MAX_CONNECTIONS_PER_RUN = 100;

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (req.headers.get('x-poll-token') !== POLL_TOKEN) return new Response('forbidden', { status: 403 });

  // Debug passthrough: { debug_user_id } fetches synchronously (to_webhook=false)
  // and returns Terra's raw responses, so provider-side failures (which are
  // swallowed by the async to_webhook=true path) become visible.
  const body = await req.json().catch(() => ({}));
  if (body?.debug_user_id) {
    const start = isoDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
    const end = isoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const out: Record<string, string> = {};
    for (const r of RESOURCES) {
      const url = `https://api.tryterra.co/v2/${r}?user_id=${encodeURIComponent(body.debug_user_id)}`
        + `&start_date=${start}&end_date=${end}&to_webhook=false`;
      try {
        const res = await fetch(url, { headers: { 'dev-id': DEV_ID, 'x-api-key': API_KEY } });
        out[r] = `${res.status} ${(await res.text().catch(() => '')).slice(0, 600)}`;
      } catch (e) {
        out[r] = `threw: ${e?.message ?? e}`;
      }
    }
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const staleBefore = new Date(Date.now() - STALE_AFTER_MIN * 60 * 1000).toISOString();
  const { data: stale, error } = await supabase
    .from('terra_connections')
    .select('terra_user_id, provider')
    .is('deauthed_at', null)
    .or(`last_event_at.is.null,last_event_at.lt.${staleBefore}`)
    .limit(MAX_CONNECTIONS_PER_RUN);
  if (error) {
    console.error('[terra-poll] stale query failed:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // Window: 2 days back to tomorrow (inclusive) — covers overnight sleep and
  // timezones either side of UTC. Terra includes sessions overlapping the range.
  const start = isoDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
  const end = isoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

  let requested = 0, failed = 0;
  const detail: Record<string, string> = {};
  for (const conn of stale ?? []) {
    for (const r of RESOURCES) {
      const url = `https://api.tryterra.co/v2/${r}?user_id=${encodeURIComponent(conn.terra_user_id)}`
        + `&start_date=${start}&end_date=${end}&to_webhook=true`;
      try {
        const res = await fetch(url, { headers: { 'dev-id': DEV_ID, 'x-api-key': API_KEY } });
        const body = await res.text().catch(() => '');
        detail[`${conn.provider}:${r}`] = `${res.status} ${body.slice(0, 300)}`;
        if (res.ok) requested++;
        else { failed++; console.warn(`[terra-poll] ${conn.provider} ${r} → ${res.status}: ${body.slice(0, 300)}`); }
      } catch (e) {
        failed++;
        detail[`${conn.provider}:${r}`] = `threw: ${e?.message ?? e}`;
        console.warn(`[terra-poll] ${conn.provider} ${r} threw:`, e?.message ?? e);
      }
    }
  }

  console.log(`[terra-poll] ${stale?.length ?? 0} stale connection(s): ${requested} requests ok, ${failed} failed`);
  return new Response(
    JSON.stringify({ connections: stale?.length ?? 0, requested, failed, detail }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});

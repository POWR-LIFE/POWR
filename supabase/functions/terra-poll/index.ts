// @ts-nocheck — Deno runtime, not Node. Types enforced at deploy time.
// Freshness loop for Terra wearable data. Terra's auto-push has proven
// unreliable (2026-06-10: connections sat with sleep in Terra that never
// reached terra-webhook — only auth events were delivered). A pg_cron job
// (migration 20260610000001) POSTs here every 30 minutes; for every active
// connection with no webhook delivery in the last STALE_AFTER_MIN minutes we
// ask Terra to (re)send the recent window with to_webhook=true. Terra then
// POSTs the data to terra-webhook as if it had auto-pushed. `daily` (steps) is
// requested for EVERY active connection each cycle, not just stale ones — see
// ALWAYS_RESOURCES.
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

/** No sleep/activity webhook data for this long ⇒ ask Terra to resend the
 *  recent window. Set just ABOVE the 30-min cron cadence: a connection that
 *  received sleep/activity data (organic auto-push OR a poll-triggered
 *  delivery) in the previous cycle stamps last_event_at and is then skipped
 *  next cycle, so a working connection settles to ~one poll/hour instead of
 *  one every 30 min. A genuinely quiet connection (no push, no recent
 *  delivery) is still re-polled within ~60 min, well inside the ≤90-min
 *  freshness target — so users never lose data, worst case it lands one cycle
 *  later. Lower again toward the cadence only if auto-push regresses and
 *  tighter freshness is worth the extra Terra GETs. */
const STALE_AFTER_MIN = 35;
/** Stale-gated resources. Gym/HIIT are geofence-verified, never Terra. */
const STALE_RESOURCES = ['sleep', 'activity'];
/** Requested for EVERY active connection each cycle: several providers (Whoop)
 *  never auto-push daily, so steps would otherwise only ever come from the
 *  phone's health store. Cheap — one GET per connection — and terra-webhook
 *  deliberately does NOT stamp last_event_at on daily deliveries, so this
 *  unconditional request can't mask a broken sleep/activity push. */
const ALWAYS_RESOURCES = ['daily'];
/** Everything the debug passthrough fetches. */
const RESOURCES = [...STALE_RESOURCES, ...ALWAYS_RESOURCES];
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
        out[r] = `${res.status} ${(await res.text().catch(() => '')).slice(0, 6000)}`;
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

  const { data: conns, error } = await supabase
    .from('terra_connections')
    .select('terra_user_id, provider, last_event_at')
    .is('deauthed_at', null)
    .limit(MAX_CONNECTIONS_PER_RUN);
  if (error) {
    console.error('[terra-poll] connections query failed:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // Window: 2 days back to tomorrow (inclusive) — covers overnight sleep and
  // timezones either side of UTC. Terra includes sessions overlapping the range.
  const start = isoDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
  const end = isoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

  const staleBefore = Date.now() - STALE_AFTER_MIN * 60 * 1000;
  let staleCount = 0, requested = 0, failed = 0;
  const detail: Record<string, string> = {};
  for (const conn of conns ?? []) {
    const isStale = !conn.last_event_at || new Date(conn.last_event_at).getTime() < staleBefore;
    if (isStale) staleCount++;
    const resources = isStale ? [...STALE_RESOURCES, ...ALWAYS_RESOURCES] : ALWAYS_RESOURCES;
    for (const r of resources) {
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

  console.log(`[terra-poll] ${conns?.length ?? 0} connection(s) (${staleCount} stale): ${requested} requests ok, ${failed} failed`);
  return new Response(
    JSON.stringify({ connections: conns?.length ?? 0, stale: staleCount, requested, failed, detail }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});

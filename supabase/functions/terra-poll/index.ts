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
// by the shared x-resolve-token cron secret, validated through the
// verify_resolve_token RPC against Vault — the same gate every other
// cron-invoked function uses. It previously used a bespoke x-poll-token
// hardcoded both here and in the cron job; that literal leaked to the public
// repo (GitGuardian 33876862), and a hardcoded constant cannot be rotated
// without a redeploy. Vault can: both sides read it live, so
// `vault.update_secret` rotates the gate with no deploy and no 403 window.
import { createClient } from '@supabase/supabase-js';

const DEV_ID = Deno.env.get('TERRA_DEV_ID')!;
const API_KEY = Deno.env.get('TERRA_API_KEY')!;

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
/** Safety cap per run; the cron retries every 30 min so backlog drains fast. */
const MAX_CONNECTIONS_PER_RUN = 100;

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const token = req.headers.get('x-resolve-token') ?? '';
  const { data: valid } = await supabase.rpc('verify_resolve_token', { p_token: token });
  if (valid !== true) return new Response('forbidden', { status: 403 });

  // NB: a { debug_user_id } passthrough used to live here — it fetched Terra
  // with to_webhook=false and returned the RAW provider response (6000 chars of
  // sleep/activity) for any terra_user_id the caller named. Behind a leaked
  // token that was an arbitrary-user health-data read, so it is gone rather
  // than re-gated. Reach for the Terra dashboard or a local script holding
  // TERRA_DEV_ID/TERRA_API_KEY if you need that visibility again.
  //
  // Backfill mode is different in kind from that: { days: N, terra_user_id? }
  // only WIDENS the re-request window (and skips the staleness gate) — the data
  // still flows to_webhook through the HMAC-signed terra-webhook like every
  // other delivery, and nothing raw is returned to the caller. Added 2026-08-21
  // to recover the nights the sleep day-bucket collision silently dropped
  // (migration 20260821140000): terra-webhook is idempotent, so a wide window
  // re-lands what was lost and heals the rest at +0 points. Clamped to Terra's
  // 28-day synchronous maximum; wider than that needs their async large-request
  // flow, which nothing here speaks.
  const body = await req.json().catch(() => ({}));
  const backfillDays = Math.min(28, Math.max(0, Math.trunc(Number(body?.days) || 0)));
  const targetTerraUserId =
    typeof body?.terra_user_id === 'string' && body.terra_user_id ? body.terra_user_id : null;

  let connQuery = supabase
    .from('terra_connections')
    .select('terra_user_id, provider, last_event_at')
    .is('deauthed_at', null)
    .limit(MAX_CONNECTIONS_PER_RUN);
  if (targetTerraUserId) connQuery = connQuery.eq('terra_user_id', targetTerraUserId);
  const { data: conns, error } = await connQuery;
  if (error) {
    console.error('[terra-poll] connections query failed:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // Window: 2 days back to tomorrow (inclusive) — covers overnight sleep and
  // timezones either side of UTC. Terra includes sessions overlapping the range.
  // A backfill run widens the lookback to the requested days.
  const lookbackDays = backfillDays > 0 ? backfillDays : 2;
  const start = isoDate(new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000));
  const end = isoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

  const staleBefore = Date.now() - STALE_AFTER_MIN * 60 * 1000;
  let staleCount = 0, requested = 0, failed = 0;
  const detail: Record<string, string> = {};
  for (const conn of conns ?? []) {
    const isStale = !conn.last_event_at || new Date(conn.last_event_at).getTime() < staleBefore;
    if (isStale) staleCount++;
    // A backfill run asks for everything regardless of freshness — the point is
    // re-delivery of history, not detecting a quiet connection.
    const resources = (isStale || backfillDays > 0)
      ? [...STALE_RESOURCES, ...ALWAYS_RESOURCES]
      : ALWAYS_RESOURCES;
    for (const r of resources) {
      const url = `https://api.tryterra.co/v2/${r}?user_id=${encodeURIComponent(conn.terra_user_id)}`
        + `&start_date=${start}&end_date=${end}&to_webhook=true`;
      try {
        const res = await fetch(url, { headers: { 'dev-id': DEV_ID, 'x-api-key': API_KEY } });
        const resBody = await res.text().catch(() => '');
        detail[`${conn.provider}:${conn.terra_user_id.slice(0, 8)}:${r}`] = `${res.status} ${resBody.slice(0, 300)}`;
        if (res.ok) requested++;
        else { failed++; console.warn(`[terra-poll] ${conn.provider} ${r} → ${res.status}: ${resBody.slice(0, 300)}`); }
      } catch (e) {
        failed++;
        detail[`${conn.provider}:${conn.terra_user_id.slice(0, 8)}:${r}`] = `threw: ${e?.message ?? e}`;
        console.warn(`[terra-poll] ${conn.provider} ${r} threw:`, e?.message ?? e);
      }
    }
  }

  console.log(`[terra-poll] ${conns?.length ?? 0} connection(s) (${staleCount} stale${backfillDays > 0 ? `, backfill ${backfillDays}d` : ''}): ${requested} requests ok, ${failed} failed`);
  return new Response(
    JSON.stringify({ connections: conns?.length ?? 0, stale: staleCount, requested, failed, detail }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});

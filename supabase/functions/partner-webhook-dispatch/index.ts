// @ts-nocheck — Deno runtime
// Outbound webhook dispatcher (pg_cron, every minute). Token-gated by the
// same x-resolve-token cron secret as the other cron functions.
//
// Drains the reward_brand_webhook_deliveries outbox: claims due rows via
// claim_due_webhook_deliveries (SKIP LOCKED — overlapping runs never
// double-send; the claim itself counts the attempt), POSTs each payload to
// its endpoint signed Stripe-style (X-POWR-Signature: t=…,v1=hmac-sha256 of
// "t.body"), then settles the row:
//   2xx                → delivered (endpoint failure streak resets)
//   anything else      → retry with backoff (1m, 5m, 30m, 2h, 6h), then failed
// An endpoint that fails MAX_ENDPOINT_FAILURES deliveries in a row is
// auto-disabled; the brand re-enables it from the portal (which resets the
// streak). Also prunes expired idempotency-cache rows as housekeeping.

import { createClient } from '@supabase/supabase-js';
import { signedPost } from '../_shared/webhookSign.ts';

const MAX_ATTEMPTS = 6;
const MAX_ENDPOINT_FAILURES = 30;
const CONCURRENCY = 10;
// Delay AFTER attempt n (1-indexed); attempts happen at claim time.
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const token = req.headers.get('x-resolve-token') ?? '';
  const { data: valid } = await admin.rpc('verify_resolve_token', { p_token: token });
  if (valid !== true) return new Response('forbidden', { status: 403 });

  const stats = { claimed: 0, delivered: 0, retrying: 0, failed: 0, skipped: 0, disabled_endpoints: 0 };

  const { data: due, error: claimErr } = await admin.rpc('claim_due_webhook_deliveries', { p_limit: 50 });
  if (claimErr) {
    console.error('[webhook-dispatch] claim failed', claimErr);
    return new Response(JSON.stringify({ error: claimErr.message }), { status: 500 });
  }
  stats.claimed = due?.length ?? 0;

  // One endpoint fetch per distinct endpoint, not per delivery.
  const endpointIds = [...new Set((due ?? []).map((d) => d.endpoint_id))];
  const endpoints = new Map();
  if (endpointIds.length > 0) {
    const { data: eps } = await admin
      .from('reward_brand_webhook_endpoints')
      .select('id, url, secret, active, consecutive_failures')
      .in('id', endpointIds);
    for (const ep of eps ?? []) endpoints.set(ep.id, ep);
  }

  const settle = async (delivery) => {
    const ep = endpoints.get(delivery.endpoint_id);

    if (!ep || !ep.active) {
      stats.skipped++;
      await admin.from('reward_brand_webhook_deliveries')
        .update({ status: 'skipped', last_error: 'endpoint inactive' })
        .eq('id', delivery.id);
      return;
    }

    const body = JSON.stringify(delivery.payload);
    const result = await signedPost(ep.url, ep.secret, body, {
      timeoutMs: 8000,
      extraHeaders: {
        'X-POWR-Event': delivery.event_type,
        'X-POWR-Delivery': delivery.id,
      },
    });

    if (result.ok) {
      stats.delivered++;
      await admin.from('reward_brand_webhook_deliveries')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          last_response_status: result.status,
          last_error: null,
        })
        .eq('id', delivery.id);
      if (ep.consecutive_failures > 0) {
        await admin.from('reward_brand_webhook_endpoints')
          .update({ consecutive_failures: 0 })
          .eq('id', ep.id);
        ep.consecutive_failures = 0;
      }
      return;
    }

    // Failure — retry with backoff or give up.
    const exhausted = delivery.attempts >= MAX_ATTEMPTS;
    const delayMin = BACKOFF_MINUTES[Math.min(delivery.attempts, BACKOFF_MINUTES.length) - 1]
      ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1];
    if (exhausted) stats.failed++; else stats.retrying++;

    await admin.from('reward_brand_webhook_deliveries')
      .update({
        status: exhausted ? 'failed' : 'pending',
        next_attempt_at: new Date(Date.now() + delayMin * 60_000).toISOString(),
        last_response_status: result.status || null,
        last_error: result.error,
      })
      .eq('id', delivery.id);

    // Endpoint failure streak — mutate the cached row so several failures for
    // the same endpoint in this run accumulate.
    ep.consecutive_failures += 1;
    const disable = ep.consecutive_failures >= MAX_ENDPOINT_FAILURES;
    if (disable) stats.disabled_endpoints++;
    await admin.from('reward_brand_webhook_endpoints')
      .update({
        consecutive_failures: ep.consecutive_failures,
        ...(disable ? {
          active: false,
          disabled_at: new Date().toISOString(),
          disabled_reason: `Auto-disabled after ${ep.consecutive_failures} consecutive failed deliveries`,
        } : {}),
      })
      .eq('id', ep.id);
    if (disable) ep.active = false;
  };

  // Deliveries to the SAME endpoint run sequentially (ordered chunks would
  // reorder events); distinct endpoints run in parallel.
  const byEndpoint = new Map();
  for (const d of due ?? []) {
    if (!byEndpoint.has(d.endpoint_id)) byEndpoint.set(d.endpoint_id, []);
    byEndpoint.get(d.endpoint_id).push(d);
  }
  const lanes = [...byEndpoint.values()];
  for (let i = 0; i < lanes.length; i += CONCURRENCY) {
    await Promise.all(
      lanes.slice(i, i + CONCURRENCY).map(async (lane) => {
        for (const d of lane) await settle(d);
      }),
    );
  }

  // Housekeeping: idempotency replay cache only needs to cover retry windows.
  await admin.from('reward_brand_api_idempotency')
    .delete()
    .lt('created_at', new Date(Date.now() - 48 * 3600_000).toISOString());

  return new Response(JSON.stringify(stats), {
    headers: { 'Content-Type': 'application/json' },
  });
});

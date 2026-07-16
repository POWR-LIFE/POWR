// @ts-nocheck — Deno runtime
// SHOPIFY WEBHOOK RECEIVER — the automatic-reconciliation leg of the
// connector. Shopify is not a Supabase user, so platform JWT verification is
// off; security rests on the X-Shopify-Hmac-Sha256 check (base64 HMAC of the
// raw body with the app client secret), mirroring terra-webhook.
//
//   orders/create   → any discount code on the order that matches one of the
//                     brand's member-assigned (reserved) codes is reconciled
//                     to 'used' — which also fires the code.used webhook.
//   app/uninstalled → mark the connection uninstalled and stop JIT minting.
//   customers/data_request, customers/redact, shop/redact → mandatory GDPR
//                     compliance topics. POWR stores no Shopify customer data
//                     (orders are read only for their discount codes), so the
//                     customer topics acknowledge with nothing to return, and
//                     shop/redact scrubs the store's connection row.

import { createClient } from '@supabase/supabase-js';

const encoder = new TextEncoder();

async function hmacBase64(secret, bytes) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, bytes);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const secret = Deno.env.get('SHOPIFY_CLIENT_SECRET');
  if (!secret) return new Response('not configured', { status: 500 });

  const raw = new Uint8Array(await req.arrayBuffer());
  const given = req.headers.get('X-Shopify-Hmac-Sha256') ?? '';
  const expected = await hmacBase64(secret, raw);
  if (!given || given !== expected) return new Response('unauthorized', { status: 401 });

  const topic = (req.headers.get('X-Shopify-Topic') ?? '').toLowerCase();
  const shop = (req.headers.get('X-Shopify-Shop-Domain') ?? '').toLowerCase();
  let body;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { body = {}; }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Mandatory GDPR compliance topics ─────────────────────────────────────
  // Handled BEFORE the connected-row lookup: shop/redact arrives ~48h after
  // uninstall, when no connected row exists any more.
  if (topic === 'customers/data_request' || topic === 'customers/redact') {
    // POWR stores no Shopify customer data — orders are read only for their
    // discount codes and never persisted. Nothing to return or erase.
    console.log('compliance ack', topic, shop);
    return new Response('ok');
  }
  if (topic === 'shop/redact') {
    // Scrub every non-connected trace of the store (tokens are already null
    // after uninstall; this clears the domain + any stray pending rows).
    await admin.from('reward_brand_shopify')
      .update({
        shop_domain: null,
        access_token: null,
        access_token_expires_at: null,
        refresh_token: null,
        refresh_token_expires_at: null,
        state_token: null,
        updated_at: new Date().toISOString(),
      })
      .ilike('shop_domain', shop)
      .neq('status', 'connected');
    return new Response('ok');
  }

  // connected-only: an abandoned 'pending' connect attempt for the same
  // domain must not make maybeSingle() see two rows and silently drop the
  // event (bit us 2026-07-16 — orders stopped reconciling for two hours).
  const { data: shopRow } = await admin
    .from('reward_brand_shopify')
    .select('brand_name, status')
    .ilike('shop_domain', shop)
    .eq('status', 'connected')
    .maybeSingle();
  // Always 200 unknown shops/topics — Shopify retries non-2xx and would
  // eventually punish the endpoint for rows we simply don't track.
  if (!shopRow) return new Response('ok');

  if (topic === 'app/uninstalled') {
    await admin.from('reward_brand_shopify')
      .update({
        status: 'uninstalled',
        access_token: null,
        access_token_expires_at: null,
        refresh_token: null,
        refresh_token_expires_at: null,
        uninstalled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('brand_name', shopRow.brand_name);
    await admin.from('reward_brand_integrations')
      .update({ mint_enabled: false })
      .ilike('brand_name', shopRow.brand_name);
    return new Response('ok');
  }

  if (topic === 'orders/create') {
    const codes = [...new Set((body.discount_codes ?? [])
      .map((d) => String(d?.code ?? '').trim().toUpperCase())
      .filter(Boolean))];
    if (codes.length === 0) return new Response('ok');

    // Only this brand's member-assigned codes are reconcilable; group by
    // reward because the RPC is per-reward.
    const { data: matches } = await admin
      .from('redemption_codes')
      .select('code, reward_id, rewards!inner(brand_name)')
      .in('code', codes)
      .eq('status', 'reserved')
      .ilike('rewards.brand_name', shopRow.brand_name);

    const byReward = new Map();
    for (const m of matches ?? []) {
      if (!byReward.has(m.reward_id)) byReward.set(m.reward_id, []);
      byReward.get(m.reward_id).push(m.code);
    }
    const usedAt = body.created_at ?? new Date().toISOString();
    for (const [rewardId, rewardCodes] of byReward) {
      const { error } = await admin.rpc('reconcile_brand_redemption_codes', {
        p_brand_name: shopRow.brand_name,
        p_reward_id: rewardId,
        p_codes: rewardCodes,
        p_used_at: usedAt,
      });
      if (error) console.error('shopify reconcile failed', rewardId, error.message);
    }
    return new Response('ok');
  }

  return new Response('ok');
});

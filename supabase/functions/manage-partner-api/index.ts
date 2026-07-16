// @ts-nocheck — Deno runtime
// Manages a reward brand's developer-integration surface from the portal:
// API keys, webhook endpoints, and JIT-mint settings. Brands are identified
// by rewards.brand_name (never the partners table).
//
// Auth mirrors manage-partner-user: admins act on any brand (body.brand_name);
// a brand's own portal users are server-forced to THEIR brand. Reads of
// endpoints/deliveries/integration rows are also possible client-side via RLS
// — this function owns every WRITE (secrets are generated server-side).
//
// Actions:
//   list_keys | create_key { label } | revoke_key { key_id }
//   create_endpoint { url, events } | update_endpoint { endpoint_id, url?, events?, active? }
//   delete_endpoint { endpoint_id } | test_endpoint { endpoint_id }
//   redeliver { delivery_id }
//   get_integration | set_integration { mint_url?, mint_enabled?, pool_low_threshold?, rotate_secret?, delivery_method? }
//   resolve_delivery_method — chosen method, inferring + persisting one for
//     brands that integrated before the chooser existed

import { createClient } from '@supabase/supabase-js';
import { randomHex, sha256Hex, signedPost } from '../_shared/webhookSign.ts';
import { testMintEndpoint } from '../_shared/mintTest.ts';

const MAX_KEYS = 5;
const MAX_ENDPOINTS = 5;
const ALLOWED_EVENTS = ['code.assigned', 'code.used', 'pool.low'];
const DELIVERY_METHODS = ['api', 'shopify', 'manual'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const sameBrand = (a, b) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// Webhook / mint URLs must be public https endpoints — the dispatcher POSTs
// to them from our infrastructure, so refuse anything that smells internal.
function validateUrl(raw) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch { return 'Enter a valid URL'; }
  if (u.protocol !== 'https:') return 'URL must use https://';
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') ||
    /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1'
  ) return 'URL must be publicly reachable';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization' }, 401);

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const { data: adminRow } = await adminClient
    .from('admin_roles')
    .select('user_id')
    .eq('user_id', user.id)
    .single();
  const isAdmin = !!adminRow;

  // Non-admins must be a portal user of some brand; every action below is then
  // forced to that brand regardless of what the request body claims.
  let brand = null;
  if (isAdmin) {
    brand = String(body.brand_name ?? '').trim();
    if (!brand) return json({ error: 'brand_name is required' }, 400);
  } else {
    const { data: brandRow } = await adminClient
      .from('reward_brand_users')
      .select('brand_name')
      .eq('user_id', user.id)
      .single();
    brand = brandRow?.brand_name ?? null;
    if (!brand) return json({ error: 'Forbidden' }, 403);
  }

  const audit = async (action, metadata = {}) => {
    if (!isAdmin) return;
    await adminClient.from('admin_audit_log').insert({
      admin_id: user.id,
      action,
      target_type: 'reward_brand',
      target_id: null,
      metadata: { brand_name: brand, ...metadata },
    });
  };

  // ══════════════════════════════════════════════════════════════════════════
  // API keys
  // ══════════════════════════════════════════════════════════════════════════

  if (body.action === 'list_keys') {
    const { data, error } = await adminClient
      .from('reward_brand_api_keys')
      .select('id, label, key_prefix, scopes, created_at, last_used_at, revoked_at')
      .ilike('brand_name', brand)
      .order('created_at', { ascending: false });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, keys: data ?? [] });
  }

  if (body.action === 'create_key') {
    const label = String(body.label ?? '').trim().slice(0, 60) || 'API key';

    const { count } = await adminClient
      .from('reward_brand_api_keys')
      .select('id', { count: 'exact', head: true })
      .ilike('brand_name', brand)
      .is('revoked_at', null);
    if ((count ?? 0) >= MAX_KEYS) {
      return json({ error: `A brand can hold at most ${MAX_KEYS} active keys — revoke one first` }, 400);
    }

    const plaintext = `powr_sk_live_${randomHex(20)}`;
    const { data: row, error } = await adminClient
      .from('reward_brand_api_keys')
      .insert({
        brand_name: brand,
        label,
        key_prefix: plaintext.slice(0, 20),
        key_hash: await sha256Hex(plaintext),
        created_by: user.id,
      })
      .select('id, label, key_prefix, scopes, created_at')
      .single();
    if (error) return json({ error: error.message }, 400);

    await audit('partner_api_create_key', { key_id: row.id, label });
    // The plaintext key is returned exactly once and never stored.
    return json({ ok: true, key: plaintext, row });
  }

  if (body.action === 'revoke_key') {
    if (!body.key_id) return json({ error: 'key_id is required' }, 400);
    const { data: row } = await adminClient
      .from('reward_brand_api_keys')
      .select('id, brand_name, revoked_at')
      .eq('id', body.key_id)
      .single();
    if (!row || !sameBrand(row.brand_name, brand)) return json({ error: 'Forbidden' }, 403);
    if (row.revoked_at) return json({ ok: true });

    const { error } = await adminClient
      .from('reward_brand_api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) return json({ error: error.message }, 400);

    await audit('partner_api_revoke_key', { key_id: row.id });
    return json({ ok: true });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Webhook endpoints
  // ══════════════════════════════════════════════════════════════════════════

  if (body.action === 'create_endpoint') {
    const urlErr = validateUrl(body.url);
    if (urlErr) return json({ error: urlErr }, 400);

    const events = Array.isArray(body.events)
      ? body.events.filter((e) => ALLOWED_EVENTS.includes(e))
      : ALLOWED_EVENTS;
    if (events.length === 0) return json({ error: 'Subscribe to at least one event' }, 400);

    const { count } = await adminClient
      .from('reward_brand_webhook_endpoints')
      .select('id', { count: 'exact', head: true })
      .ilike('brand_name', brand);
    if ((count ?? 0) >= MAX_ENDPOINTS) {
      return json({ error: `A brand can hold at most ${MAX_ENDPOINTS} endpoints — delete one first` }, 400);
    }

    const { data: row, error } = await adminClient
      .from('reward_brand_webhook_endpoints')
      .insert({
        brand_name: brand,
        url: String(body.url).trim(),
        secret: `whsec_${randomHex(24)}`,
        events,
        created_by: user.id,
      })
      .select('*')
      .single();
    if (error) return json({ error: error.message }, 400);

    await audit('partner_api_create_endpoint', { endpoint_id: row.id, url: row.url });
    return json({ ok: true, endpoint: row });
  }

  if (body.action === 'update_endpoint') {
    if (!body.endpoint_id) return json({ error: 'endpoint_id is required' }, 400);
    const { data: row } = await adminClient
      .from('reward_brand_webhook_endpoints')
      .select('id, brand_name')
      .eq('id', body.endpoint_id)
      .single();
    if (!row || !sameBrand(row.brand_name, brand)) return json({ error: 'Forbidden' }, 403);

    const patch = {};
    if (body.url !== undefined) {
      const urlErr = validateUrl(body.url);
      if (urlErr) return json({ error: urlErr }, 400);
      patch.url = String(body.url).trim();
    }
    if (body.events !== undefined) {
      const events = Array.isArray(body.events)
        ? body.events.filter((e) => ALLOWED_EVENTS.includes(e))
        : [];
      if (events.length === 0) return json({ error: 'Subscribe to at least one event' }, 400);
      patch.events = events;
    }
    if (body.active !== undefined) {
      patch.active = !!body.active;
      if (patch.active) {
        // Re-enabling wipes the failure history so deliveries resume cleanly.
        patch.consecutive_failures = 0;
        patch.disabled_at = null;
        patch.disabled_reason = null;
      }
    }
    if (Object.keys(patch).length === 0) return json({ error: 'Nothing to update' }, 400);

    const { data: updated, error } = await adminClient
      .from('reward_brand_webhook_endpoints')
      .update(patch)
      .eq('id', row.id)
      .select('*')
      .single();
    if (error) return json({ error: error.message }, 400);

    await audit('partner_api_update_endpoint', { endpoint_id: row.id, patch: Object.keys(patch) });
    return json({ ok: true, endpoint: updated });
  }

  if (body.action === 'delete_endpoint') {
    if (!body.endpoint_id) return json({ error: 'endpoint_id is required' }, 400);
    const { data: row } = await adminClient
      .from('reward_brand_webhook_endpoints')
      .select('id, brand_name, url')
      .eq('id', body.endpoint_id)
      .single();
    if (!row || !sameBrand(row.brand_name, brand)) return json({ error: 'Forbidden' }, 403);

    const { error } = await adminClient
      .from('reward_brand_webhook_endpoints')
      .delete()
      .eq('id', row.id);
    if (error) return json({ error: error.message }, 400);

    await audit('partner_api_delete_endpoint', { endpoint_id: row.id, url: row.url });
    return json({ ok: true });
  }

  if (body.action === 'test_endpoint') {
    if (!body.endpoint_id) return json({ error: 'endpoint_id is required' }, 400);
    const { data: ep } = await adminClient
      .from('reward_brand_webhook_endpoints')
      .select('id, brand_name, url, secret')
      .eq('id', body.endpoint_id)
      .single();
    if (!ep || !sameBrand(ep.brand_name, brand)) return json({ error: 'Forbidden' }, 403);

    const payload = JSON.stringify({
      id: crypto.randomUUID(),
      type: 'webhook.test',
      created_at: new Date().toISOString(),
      data: { brand_name: ep.brand_name, note: 'Test delivery from the POWR partner portal' },
    });
    const result = await signedPost(ep.url, ep.secret, payload, {
      timeoutMs: 8000,
      extraHeaders: { 'X-POWR-Event': 'webhook.test' },
    });
    return json({ ok: result.ok, status: result.status, error: result.error, body: result.body });
  }

  if (body.action === 'redeliver') {
    if (!body.delivery_id) return json({ error: 'delivery_id is required' }, 400);
    const { data: row } = await adminClient
      .from('reward_brand_webhook_deliveries')
      .select('id, brand_name, status')
      .eq('id', body.delivery_id)
      .single();
    if (!row || !sameBrand(row.brand_name, brand)) return json({ error: 'Forbidden' }, 403);
    if (row.status === 'pending') return json({ ok: true });

    const { error } = await adminClient
      .from('reward_brand_webhook_deliveries')
      .update({ status: 'pending', attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null })
      .eq('id', row.id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // JIT-mint integration settings
  // ══════════════════════════════════════════════════════════════════════════

  if (body.action === 'test_mint') {
    const { data: integration } = await adminClient
      .from('reward_brand_integrations')
      .select('brand_name, mint_url, mint_secret')
      .ilike('brand_name', brand)
      .maybeSingle();
    return json(await testMintEndpoint(integration));
  }

  if (body.action === 'get_integration') {
    const { data } = await adminClient
      .from('reward_brand_integrations')
      .select('*')
      .ilike('brand_name', brand)
      .maybeSingle();
    return json({ ok: true, integration: data ?? null });
  }

  if (body.action === 'resolve_delivery_method') {
    const { data: integ } = await adminClient
      .from('reward_brand_integrations')
      .select('brand_name, delivery_method, mint_url')
      .ilike('brand_name', brand)
      .maybeSingle();
    if (integ?.delivery_method) {
      return json({ ok: true, method: integ.delivery_method, inferred: false });
    }

    // Brands that integrated before the chooser existed must never see the
    // first-run screen — infer their method from what they already use and
    // persist it so the answer is stable from then on.
    let method = null;

    const { data: shop } = await adminClient
      .from('reward_brand_shopify')
      .select('status')
      .ilike('brand_name', brand)
      .maybeSingle();
    // 'uninstalled' still means they chose Shopify — the portal nags them to
    // reconnect. 'disconnected' was deliberate, so it doesn't count.
    if (shop && ['connected', 'uninstalled'].includes(shop.status)) method = 'shopify';

    if (!method) {
      const [keysRes, epsRes] = await Promise.all([
        adminClient
          .from('reward_brand_api_keys')
          .select('id', { count: 'exact', head: true })
          .ilike('brand_name', brand)
          .is('revoked_at', null),
        adminClient
          .from('reward_brand_webhook_endpoints')
          .select('id', { count: 'exact', head: true })
          .ilike('brand_name', brand),
      ]);
      if ((keysRes.count ?? 0) > 0 || (epsRes.count ?? 0) > 0 || integ?.mint_url) method = 'api';
    }

    if (!method) {
      const { count } = await adminClient
        .from('redemption_codes')
        .select('id, rewards!inner(brand_name)', { count: 'exact', head: true })
        .ilike('rewards.brand_name', brand);
      if ((count ?? 0) > 0) method = 'manual';
    }

    if (method) {
      await adminClient
        .from('reward_brand_integrations')
        .upsert({
          brand_name: integ?.brand_name ?? brand,
          delivery_method: method,
          delivery_method_set_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'brand_name' });
    }
    return json({ ok: true, method, inferred: !!method });
  }

  if (body.action === 'set_integration') {
    const { data: existing } = await adminClient
      .from('reward_brand_integrations')
      .select('*')
      .ilike('brand_name', brand)
      .maybeSingle();

    const row = {
      // Reuse the stored casing so the lower(brand_name) unique index never
      // sees two variants of the same brand.
      brand_name: existing?.brand_name ?? brand,
      mint_url: existing?.mint_url ?? null,
      mint_secret: existing?.mint_secret ?? null,
      mint_enabled: existing?.mint_enabled ?? false,
      pool_low_threshold: existing?.pool_low_threshold ?? 10,
      updated_at: new Date().toISOString(),
    };

    if (body.mint_url !== undefined) {
      if (body.mint_url === null || body.mint_url === '') {
        row.mint_url = null;
        row.mint_enabled = false;
      } else {
        const urlErr = validateUrl(body.mint_url);
        if (urlErr) return json({ error: urlErr }, 400);
        row.mint_url = String(body.mint_url).trim();
      }
    }
    if (row.mint_url && (!row.mint_secret || body.rotate_secret)) {
      row.mint_secret = `whsec_${randomHex(24)}`;
    }
    if (body.mint_enabled !== undefined) {
      if (body.mint_enabled && !row.mint_url) {
        return json({ error: 'Set a mint endpoint URL before enabling JIT minting' }, 400);
      }
      row.mint_enabled = !!body.mint_enabled;
    }
    if (body.pool_low_threshold !== undefined) {
      const n = parseInt(body.pool_low_threshold, 10);
      if (isNaN(n) || n < 0 || n > 10000) return json({ error: 'pool_low_threshold must be between 0 and 10,000' }, 400);
      row.pool_low_threshold = n;
    }
    if (body.delivery_method !== undefined) {
      if (body.delivery_method !== null && !DELIVERY_METHODS.includes(body.delivery_method)) {
        return json({ error: 'delivery_method must be api, shopify, or manual' }, 400);
      }
      row.delivery_method = body.delivery_method;
      row.delivery_method_set_at = body.delivery_method ? new Date().toISOString() : null;
    }
    // Any settings change resets the mint circuit breaker.
    row.mint_consecutive_failures = 0;
    row.mint_disabled_until = null;

    const { data: saved, error } = await adminClient
      .from('reward_brand_integrations')
      .upsert(row, { onConflict: 'brand_name' })
      .select('*')
      .single();
    if (error) return json({ error: error.message }, 400);

    await audit('partner_api_set_integration', {
      mint_enabled: saved.mint_enabled,
      has_mint_url: !!saved.mint_url,
      pool_low_threshold: saved.pool_low_threshold,
      delivery_method: saved.delivery_method,
    });
    return json({ ok: true, integration: saved });
  }

  return json({ error: 'Unknown action' }, 400);
});

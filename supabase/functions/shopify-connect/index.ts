// @ts-nocheck — Deno runtime
// SHOPIFY CONNECTOR — control plane. Lets a reward brand connect their
// Shopify store so codes mint into Shopify at redemption time and usage
// reconciles automatically. Rides the partner developer API primitives:
// the brand's JIT mint_url is pointed at THIS function's /mint route, so
// redeem-reward's existing machinery treats Shopify like any partner system.
//
// Routes (platform JWT verification is OFF; each route enforces its own auth):
//   POST {action:'start', shop_domain}    JWT (brand user / admin+brand_name)
//   GET  /install?shop=x.myshopify.com    public — App Store install entry:
//                                         immediate OAuth, claimed later in portal
//   GET  /callback?shop&code&state&hmac   public — Shopify OAuth redirect
//   POST {action:'status'}                JWT → connection + mappings
//   POST {action:'list_discounts'}        JWT → active code discounts in the shop
//   POST {action:'map_reward', reward_id, discount_gid}  JWT
//   POST {action:'unmap_reward', reward_id}              JWT
//   POST {action:'create_test_code', reward_id?}         JWT — mint one labelled
//                                         single-use code through the production
//                                         rails (portal + app-review self-test)
//   POST {action:'disconnect'}            JWT
//   POST /mint                            signed with the brand's mint_secret
//                                         (same X-POWR-Signature scheme JIT uses)

import { createClient } from '@supabase/supabase-js';
import { hmacSha256Hex, randomHex } from '../_shared/webhookSign.ts';

const API_VERSION = '2026-07';
// read_products exists solely so map_reward can read a template's item
// restrictions (products AND collections — Shopify has no read_collections
// scope; collections ride on read_products) and clone them onto minted
// codes. Without it, product-limited discounts can't be used as templates.
const SCOPES = 'write_discounts,read_orders,read_products';
const CALLBACK_URL = 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/shopify-connect/callback';
const WEBHOOK_URL = 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/shopify-webhook';
// OAuth-return landing. Deliberately the LEGACY portal route: it exists on
// every deployed frontend (pre-restructure it's the Developers page with the
// ?shopify= toast; post-restructure it 301s to the Shopify integration page
// with the query preserved) — so the redirect never races a web deploy.
const PORTAL_URL = 'https://powr.life/partner/developers';
const MINT_URL = 'https://wjvvujnicwkruaeibttt.supabase.co/functions/v1/shopify-connect/mint';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });

const sameBrand = (a, b) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

const validShop = (raw) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(String(raw ?? '').trim().toLowerCase());

// Shopify Admin GraphQL call. Returns { data, errors }.
async function shopifyGraphql(shop, token, query, variables = {}) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { errors: [{ message: `HTTP ${res.status}` }] };
  return body;
}

// Shared GraphQL fragment for the customerGets shape. Item __typename only —
// reading the actual product/collection nodes needs read_products /
// read_collections scopes the app may not hold, and an ACCESS_DENIED on a
// nested field nulls the whole query.
const CUSTOMER_GETS_FRAGMENT = `
  customerGets {
    value {
      __typename
      ... on DiscountPercentage { percentage }
      ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
    }
    items { __typename }
  }`;

// Normalise the VALUE side of a DiscountCodeBasic (percentage / fixed amount).
// Returns null for shapes we can't clone.
function normaliseValue(codeDiscount) {
  if (codeDiscount?.__typename !== 'DiscountCodeBasic') return null;
  const value = codeDiscount.customerGets?.value;
  if (value?.__typename === 'DiscountPercentage') {
    return { type: 'percentage', percentage: value.percentage };
  }
  if (value?.__typename === 'DiscountAmount') {
    return { type: 'amount', amount: value.amount?.amount, appliesOnEachItem: !!value.appliesOnEachItem };
  }
  return null;
}

// Fetch the product/collection restriction of a template discount so minted
// codes are never MORE generous than the template. Requires read_products /
// read_collections — under minimal scopes this returns an explanatory error
// string instead, and starts working automatically if scopes are expanded.
async function fetchItemRestrictions(shop, token, gid, itemsTypename) {
  const field = itemsTypename === 'DiscountProducts' ? 'products' : 'collections';
  const { data, errors } = await shopifyGraphql(shop, token, `
    query($id: ID!) {
      codeDiscountNode(id: $id) {
        codeDiscount {
          ... on DiscountCodeBasic {
            customerGets {
              items {
                ... on Discount${itemsTypename === 'DiscountProducts' ? 'Products' : 'Collections'} {
                  ${field}(first: 100) { nodes { id } pageInfo { hasNextPage } }
                }
              }
            }
          }
        }
      }
    }`, { id: gid });
  if (errors?.length) {
    return { error: 'This discount is limited to specific products, which needs the app’s product-access permission. Use an order-wide discount as the template for now.' };
  }
  const conn = data?.codeDiscountNode?.codeDiscount?.customerGets?.items?.[field];
  if (!conn?.nodes) return { error: 'Could not read the discount’s product restrictions — try an order-wide discount.' };
  if (conn.pageInfo?.hasNextPage) return { error: 'This discount is limited to more than 100 items — too broad to clone faithfully. Use an order-wide or smaller template.' };
  return { applies: { [field]: conn.nodes.map((n) => n.id) } };
}

// now + seconds → ISO, with a safety margin (default 60s) so we refresh
// slightly BEFORE Shopify's clock says expired. Null-safe for legacy
// non-expiring exchanges that omit the field.
const tokenExpiry = (seconds, marginSeconds = 60) =>
  seconds ? new Date(Date.now() + Math.max(seconds - marginSeconds, 30) * 1000).toISOString() : null;

// Returns a shop row whose access_token is usable, refreshing and persisting
// it first if the 1-hour expiry has passed. Refresh tokens ROTATE on every
// use, so the new pair is written back before any Admin API call. If the
// refresh fails (e.g. a concurrent worker rotated it first), the row is
// re-read once and reused when that worker left a fresh token; otherwise the
// stale row is returned and the caller's probe surfaces the reconnect banner.
async function ensureFreshToken(admin, shopRow, clientId, clientSecret) {
  if (!shopRow?.access_token || shopRow.status !== 'connected') return shopRow;
  const exp = shopRow.access_token_expires_at ? new Date(shopRow.access_token_expires_at).getTime() : null;
  if (!exp || exp > Date.now()) return shopRow; // legacy token, or still fresh
  if (!shopRow.refresh_token) return shopRow;

  // Unlike the code exchange (which accepts JSON), the refresh grant REQUIRES
  // form-urlencoding — JSON gets 401 invalid_request. Reuse within ~1h of a
  // refresh returns the same pair, so concurrent refreshes are harmless.
  const res = await fetch(`https://${shopRow.shop_domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: shopRow.refresh_token,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || !body.access_token) {
    const { data: fresh } = await admin
      .from('reward_brand_shopify').select('*')
      .eq('brand_name', shopRow.brand_name).maybeSingle();
    const freshExp = fresh?.access_token_expires_at ? new Date(fresh.access_token_expires_at).getTime() : null;
    if (freshExp && freshExp > Date.now()) return fresh;
    console.error('shopify token refresh failed', shopRow.shop_domain, res.status, JSON.stringify(body).slice(0, 300));
    // Carried into status.health so the failure reason is observable from
    // the portal/API instead of only in function logs.
    return { ...shopRow, _refresh_error: `HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}` };
  }

  const patch = {
    access_token: body.access_token,
    access_token_expires_at: tokenExpiry(body.expires_in),
    refresh_token: body.refresh_token ?? shopRow.refresh_token,
    refresh_token_expires_at: body.refresh_token_expires_in
      ? tokenExpiry(body.refresh_token_expires_in, 0)
      : shopRow.refresh_token_expires_at,
    updated_at: new Date().toISOString(),
  };
  await admin.from('reward_brand_shopify').update(patch).eq('brand_name', shopRow.brand_name);
  return { ...shopRow, ...patch };
}

const CROCKFORD = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
function mintCode(prefix = 'POWR-', len = 8) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let suffix = '';
  for (const b of bytes) suffix += CROCKFORD[b % CROCKFORD.length];
  return `${prefix}${suffix}`;
}

// Create a single-use DiscountCodeBasic in the brand's store cloned from a
// mapping's stored config. Shared by /mint (member redemptions) and
// create_test_code (portal self-test). Returns true on success.
async function createClonedDiscount(shopRow, cfg, title, code, endsAt) {
  const value = cfg.type === 'percentage'
    ? { percentage: cfg.percentage }
    : { discountAmount: { amount: cfg.amount, appliesOnEachItem: !!cfg.appliesOnEachItem } };
  // Carry the template's product/collection restrictions into the minted code.
  const mintItems = cfg.applies?.products?.length
    ? { products: { productsToAdd: cfg.applies.products } }
    : cfg.applies?.collections?.length
      ? { collections: { add: cfg.applies.collections } }
      : { all: true };

  const { data, errors } = await shopifyGraphql(shopRow.shop_domain, shopRow.access_token, `
    mutation($discount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $discount) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }`, {
    discount: {
      title,
      code,
      startsAt: new Date().toISOString(),
      endsAt: endsAt ?? null,
      usageLimit: 1,
      appliesOncePerCustomer: true,
      customerSelection: { all: true },
      customerGets: { value, items: mintItems },
    },
  });
  const errs = errors ?? data?.discountCodeBasicCreate?.userErrors;
  if (errs?.length || !data?.discountCodeBasicCreate?.codeDiscountNode?.id) {
    console.error('shopify discount create failed', JSON.stringify(errs ?? data));
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const clientId = Deno.env.get('SHOPIFY_CLIENT_ID');
  const clientSecret = Deno.env.get('SHOPIFY_CLIENT_SECRET');
  if (!clientId || !clientSecret) return json({ error: 'Shopify app credentials are not configured' }, 500);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/shopify-connect/, '') || '/';

  // ══════════════════════════════════════════════════════════════════════════
  // GET /install — App Store / automated-review entry point. Portal-initiated
  // connects never hit this (the start action binds OAuth to a brand); a
  // direct install must authenticate immediately, so the attempt is parked on
  // a PENDING:<shop> row and sent straight to OAuth. After approval the
  // callback routes the merchant to the portal to claim the store from their
  // brand account — that claim re-runs OAuth, which is instant since the app
  // is already installed.
  // ══════════════════════════════════════════════════════════════════════════
  if (req.method === 'GET' && path === '/install') {
    const shop = (url.searchParams.get('shop') ?? '').toLowerCase();
    if (!validShop(shop)) return json({ error: 'invalid shop parameter' }, 400);
    const state = randomHex(24);
    await admin.from('reward_brand_shopify').upsert({
      brand_name: `PENDING:${shop}`,
      shop_domain: shop,
      // Never 'connected': the webhook's connected-only lookup and the
      // unique connected-domain index both rely on parking rows staying out
      // of the connected state.
      status: 'pending',
      state_token: state,
      state_expires: new Date(Date.now() + 15 * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'brand_name' });
    const authorize = `https://${shop}/admin/oauth/authorize?client_id=${clientId}` +
      `&scope=${encodeURIComponent(SCOPES)}&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&state=${state}`;
    return Response.redirect(authorize, 302);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET /callback — Shopify OAuth redirect (public; HMAC + state are the auth)
  // ══════════════════════════════════════════════════════════════════════════
  if (req.method === 'GET' && path === '/callback') {
    const back = (reason) =>
      Response.redirect(`${PORTAL_URL}?shopify=${reason ? `error&reason=${encodeURIComponent(reason)}` : 'connected'}`, 302);

    const shop = (url.searchParams.get('shop') ?? '').toLowerCase();
    const code = url.searchParams.get('code') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const hmac = url.searchParams.get('hmac') ?? '';
    if (!validShop(shop) || !code || !state || !hmac) return back('bad_request');

    // Verify Shopify's HMAC over the sorted query string (minus hmac).
    const params = [...url.searchParams.entries()]
      .filter(([k]) => k !== 'hmac')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const expected = await hmacSha256Hex(clientSecret, params);
    if (expected !== hmac) return back('bad_hmac');

    const { data: row } = await admin
      .from('reward_brand_shopify')
      .select('brand_name, state_token, state_expires')
      .eq('state_token', state)
      .maybeSingle();
    if (!row || (row.state_expires && new Date(row.state_expires) < new Date())) return back('state_expired');

    // Exchange the grant for an EXPIRING offline Admin API token (expiring=1).
    // Shopify rejects non-expiring tokens for public apps created after
    // 2026-04-01: access tokens live 1h, refresh tokens 90d and rotate.
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, expiring: 1 }),
    });
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenBody.access_token) return back('token_exchange_failed');

    // Direct App Store install (no brand yet): the exchange above completed
    // the install; park it — no tokens kept — and send the merchant to the
    // portal to claim the store from their brand account.
    if (row.brand_name.startsWith('PENDING:')) {
      await admin.from('reward_brand_shopify')
        .update({ state_token: null, state_expires: null, updated_at: new Date().toISOString() })
        .eq('brand_name', row.brand_name);
      return Response.redirect('https://powr.life/partner/login?shopify=installed', 302);
    }

    await admin.from('reward_brand_shopify')
      .update({
        shop_domain: shop,
        access_token: tokenBody.access_token,
        access_token_expires_at: tokenExpiry(tokenBody.expires_in),
        refresh_token: tokenBody.refresh_token ?? null,
        refresh_token_expires_at: tokenExpiry(tokenBody.refresh_token_expires_in, 0),
        scopes: tokenBody.scope ?? SCOPES,
        status: 'connected',
        state_token: null,
        state_expires: null,
        connected_at: new Date().toISOString(),
        uninstalled_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('brand_name', row.brand_name);

    // Any direct-install parking row for this shop is superseded the moment
    // a real brand connects it.
    await admin.from('reward_brand_shopify')
      .delete()
      .eq('brand_name', `PENDING:${shop}`);

    // Register the webhooks that make reconciliation automatic. Failures are
    // logged, not fatal — status surfaces them and mapping re-attempts.
    for (const topic of ['ORDERS_CREATE', 'APP_UNINSTALLED']) {
      const { data, errors } = await shopifyGraphql(shop, tokenBody.access_token, `
        mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
            userErrors { field message }
          }
        }`, { topic, sub: { callbackUrl: WEBHOOK_URL, format: 'JSON' } });
      const errs = errors ?? data?.webhookSubscriptionCreate?.userErrors;
      if (errs?.length) console.error('webhook subscribe failed', topic, JSON.stringify(errs));
    }

    // Point the brand's JIT machinery at our mint adapter (secret generated
    // if the brand never had one). Minting only turns ON when a reward is
    // mapped to a discount.
    const { data: integ } = await admin
      .from('reward_brand_integrations')
      .select('brand_name, mint_secret')
      .ilike('brand_name', row.brand_name)
      .maybeSingle();
    await admin.from('reward_brand_integrations').upsert({
      brand_name: integ?.brand_name ?? row.brand_name,
      mint_url: MINT_URL,
      mint_secret: integ?.mint_secret ?? `whsec_${randomHex(24)}`,
      mint_consecutive_failures: 0,
      mint_disabled_until: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'brand_name' });

    return back(null);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // POST /mint — the JIT adapter. redeem-reward signs with the brand's
  // mint_secret; we verify, then create a single-use discount code in the
  // brand's Shopify store cloned from the mapped discount's config.
  // ══════════════════════════════════════════════════════════════════════════
  if (req.method === 'POST' && path === '/mint') {
    const raw = await req.text();
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'invalid json' }, 400); }

    const sig = req.headers.get('X-POWR-Signature') ?? '';
    const parts = Object.fromEntries(sig.split(',').map((p) => p.split('=')));
    if (!parts.t || !parts.v1) return json({ error: 'missing signature' }, 401);
    if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return json({ error: 'stale signature' }, 401);

    const { data: integ } = await admin
      .from('reward_brand_integrations')
      .select('mint_secret')
      .ilike('brand_name', body.brand_name ?? '')
      .maybeSingle();
    if (!integ?.mint_secret) return json({ error: 'unknown brand' }, 401);
    const expected = await hmacSha256Hex(integ.mint_secret, `${parts.t}.${raw}`);
    if (expected !== parts.v1) return json({ error: 'bad signature' }, 401);

    // Test probes get a synthetic (never-stored) code so partners can run the
    // connection test without touching the store.
    if (body.test === true) return json({ code: mintCode() });

    const [{ data: shopRowRaw }, { data: mapping }] = await Promise.all([
      admin.from('reward_brand_shopify')
        .select('*')
        .ilike('brand_name', body.brand_name)
        .maybeSingle(),
      admin.from('reward_shopify_discounts')
        .select('config, discount_title')
        .eq('reward_id', body.reward_id ?? '')
        .maybeSingle(),
    ]);
    if (shopRowRaw?.status !== 'connected') return json({ error: 'shop not connected' }, 409);
    if (!mapping) return json({ error: 'reward not mapped to a discount' }, 409);
    const shopRow = await ensureFreshToken(admin, shopRowRaw, clientId, clientSecret);

    const code = mintCode();
    const ok = await createClonedDiscount(
      shopRow, mapping.config ?? {},
      `POWR · ${mapping.discount_title} · ${code}`, code, body.expires_at ?? null,
    );
    if (!ok) return json({ error: 'shopify discount create failed' }, 502);

    return json({ code });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // JWT actions — brand portal user (forced to own brand) or admin+brand_name
  // ══════════════════════════════════════════════════════════════════════════
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization' }, 401);
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const { data: adminRow } = await admin
    .from('admin_roles').select('user_id').eq('user_id', user.id).single();
  const isAdmin = !!adminRow;
  let brand = null;
  if (isAdmin) {
    brand = String(body.brand_name ?? '').trim();
    if (!brand) return json({ error: 'brand_name is required' }, 400);
  } else {
    const { data: brandRow } = await admin
      .from('reward_brand_users').select('brand_name').eq('user_id', user.id).single();
    brand = brandRow?.brand_name ?? null;
    if (!brand) return json({ error: 'Forbidden' }, 403);
  }

  const getShop = async () => {
    const { data } = await admin
      .from('reward_brand_shopify')
      .select('*')
      .ilike('brand_name', brand)
      .maybeSingle();
    // Hourly-expiring tokens are refreshed just-in-time, so every action
    // below can treat shop.access_token as live.
    return ensureFreshToken(admin, data, clientId, clientSecret);
  };

  // ── start: mint the OAuth authorize URL ────────────────────────────────────
  if (body.action === 'start') {
    const shop = String(body.shop_domain ?? '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!validShop(shop)) {
      return json({ error: 'Enter your store domain like your-store.myshopify.com' }, 400);
    }
    const existing = await getShop();
    const state = randomHex(24);
    await admin.from('reward_brand_shopify').upsert({
      brand_name: existing?.brand_name ?? brand,
      shop_domain: shop,
      status: existing?.status === 'connected' ? 'connected' : 'pending',
      state_token: state,
      state_expires: new Date(Date.now() + 15 * 60_000).toISOString(),
      created_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'brand_name' });

    const authorize = `https://${shop}/admin/oauth/authorize?client_id=${clientId}` +
      `&scope=${encodeURIComponent(SCOPES)}&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&state=${state}`;
    return json({ ok: true, authorize_url: authorize });
  }

  // ── status ──────────────────────────────────────────────────────────────────
  // Beyond connection state, this PROBES the store: is the token still valid,
  // and are our webhooks registered? Missing subscriptions are re-created on
  // the spot (they fail silently at connect time when the app hasn't been
  // granted protected-customer-data access yet — the exact gap that made the
  // first E2E order go unreconciled).
  if (body.action === 'status') {
    const shop = await getShop();
    const { data: mappings } = await admin
      .from('reward_shopify_discounts')
      .select('reward_id, discount_gid, discount_title, config, updated_at')
      .ilike('brand_name', brand);

    let health = null;
    if (shop?.status === 'connected') {
      const { data, errors } = await shopifyGraphql(shop.shop_domain, shop.access_token, `
        { shop { name } webhookSubscriptions(first: 20) { nodes { topic } } }`);
      if (errors?.length || !data?.shop) {
        health = { token_ok: false, orders_webhook: false, refresh_error: shop._refresh_error ?? null };
      } else {
        const topics = new Set((data.webhookSubscriptions?.nodes ?? []).map((n) => n.topic));
        for (const topic of ['ORDERS_CREATE', 'APP_UNINSTALLED']) {
          if (topics.has(topic)) continue;
          const { data: sub, errors: subErrs } = await shopifyGraphql(shop.shop_domain, shop.access_token, `
            mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
              webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
                webhookSubscription { id }
                userErrors { message }
              }
            }`, { topic, sub: { callbackUrl: WEBHOOK_URL, format: 'JSON' } });
          const errs = subErrs ?? sub?.webhookSubscriptionCreate?.userErrors;
          if (!errs?.length && sub?.webhookSubscriptionCreate?.webhookSubscription?.id) {
            topics.add(topic);
          } else {
            console.error('webhook self-heal failed', topic, JSON.stringify(errs));
          }
        }
        health = { token_ok: true, orders_webhook: topics.has('ORDERS_CREATE') };
      }
    }

    // Has the full loop ever run for this brand — a code minted through the
    // Shopify rails that came back marked used? The portal used to answer
    // this from component state, so proof evaporated on every reload. Only
    // PARTNER_API codes are minted (pool uploads can't prove minting), and
    // 'used' is only ever set by the orders webhook reconciling a real spend.
    const { count: provenCount } = await admin
      .from('redemption_codes')
      .select('id, rewards!inner(brand_name)', { count: 'exact', head: true })
      .eq('source', 'PARTNER_API')
      .eq('status', 'used')
      .ilike('rewards.brand_name', brand);

    return json({
      ok: true,
      connected: shop?.status === 'connected',
      status: shop?.status ?? null,
      shop_domain: shop?.shop_domain ?? null,
      scopes: shop?.scopes ?? null,
      connected_at: shop?.connected_at ?? null,
      mappings: mappings ?? [],
      loop_proven: (provenCount ?? 0) > 0,
      health,
    });
  }

  // ── list_discounts: active code discounts we can clone from ────────────────
  if (body.action === 'list_discounts') {
    const shop = await getShop();
    if (shop?.status !== 'connected') return json({ error: 'Connect your Shopify store first' }, 409);
    const { data, errors } = await shopifyGraphql(shop.shop_domain, shop.access_token, `
      query {
        codeDiscountNodes(first: 50, query: "status:active") {
          nodes {
            id
            codeDiscount {
              __typename
              ... on DiscountCodeBasic {
                title
                summary
                appliesOncePerCustomer
                ${CUSTOMER_GETS_FRAGMENT}
              }
            }
          }
        }
      }`);
    if (errors?.length) return json({ error: errors[0]?.message ?? 'Shopify query failed' }, 502);

    const discounts = (data?.codeDiscountNodes?.nodes ?? [])
      // Codes WE minted are themselves active discounts ("POWR · <template> ·
      // <code>") — hide them or they'd swamp the template picker after a few
      // dozen redemptions and invite mapping a single-use code as a template.
      .filter((n) => !/^POWR( TEST)? · /.test(n.codeDiscount?.title ?? ''))
      .map((n) => {
        const kind = normaliseValue(n.codeDiscount);
        return {
          gid: n.id,
          title: n.codeDiscount?.title ?? '(unsupported discount type)',
          summary: n.codeDiscount?.summary ?? null,
          cloneable: !!kind,
          restricted: kind ? n.codeDiscount?.customerGets?.items?.__typename !== 'AllDiscountItems' : false,
        };
      });
    return json({ ok: true, discounts });
  }

  // ── map_reward: choose the discount a reward mints from ────────────────────
  if (body.action === 'map_reward') {
    const { reward_id, discount_gid } = body;
    if (!reward_id || !discount_gid) return json({ error: 'reward_id and discount_gid are required' }, 400);

    const shop = await getShop();
    if (shop?.status !== 'connected') return json({ error: 'Connect your Shopify store first' }, 409);

    const { data: reward } = await admin
      .from('rewards')
      .select('id, title, brand_name, integration_type')
      .eq('id', reward_id)
      .maybeSingle();
    if (!reward || !sameBrand(reward.brand_name, brand)) return json({ error: 'No such reward for this brand' }, 404);

    const { data, errors } = await shopifyGraphql(shop.shop_domain, shop.access_token, `
      query($id: ID!) {
        codeDiscountNode(id: $id) {
          id
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              title
              appliesOncePerCustomer
              ${CUSTOMER_GETS_FRAGMENT}
            }
          }
        }
      }`, { id: discount_gid });
    if (errors?.length) return json({ error: errors[0]?.message ?? 'Shopify query failed' }, 502);

    const node = data?.codeDiscountNode;
    const kind = normaliseValue(node?.codeDiscount);
    if (!kind) {
      return json({ error: 'Only basic percentage or fixed-amount code discounts can be used as templates' }, 400);
    }

    // Carry the template's item restrictions so minted codes are never more
    // generous than what the partner configured.
    const itemsType = node.codeDiscount.customerGets?.items?.__typename;
    let applies;
    if (itemsType === 'AllDiscountItems') {
      applies = { all: true };
    } else if (itemsType === 'DiscountProducts' || itemsType === 'DiscountCollections') {
      const res = await fetchItemRestrictions(shop.shop_domain, shop.access_token, discount_gid, itemsType);
      if (res.error) return json({ error: res.error }, 400);
      applies = res.applies;
    } else {
      return json({ error: 'This discount’s item targeting can’t be cloned — use an order-wide discount as the template' }, 400);
    }

    const cfg = {
      ...kind,
      applies,
      appliesOncePerCustomer: !!node.codeDiscount.appliesOncePerCustomer,
      title: node.codeDiscount.title,
    };

    await admin.from('reward_shopify_discounts').upsert({
      reward_id: reward.id,
      brand_name: brand,
      discount_gid,
      discount_title: node.codeDiscount.title,
      config: cfg,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'reward_id' });

    // The mapped reward now mints at redemption time; enable the JIT wiring.
    if (reward.integration_type !== 'API_VALIDATED') {
      await admin.from('rewards').update({ integration_type: 'API_VALIDATED' }).eq('id', reward.id);
    }
    await admin.from('reward_brand_integrations')
      .update({ mint_enabled: true, mint_consecutive_failures: 0, mint_disabled_until: null })
      .ilike('brand_name', brand);

    if (isAdmin) {
      await admin.from('admin_audit_log').insert({
        admin_id: user.id, action: 'shopify_map_reward', target_type: 'reward_brand',
        target_id: null, metadata: { brand_name: brand, reward_id: reward.id, discount_gid },
      });
    }
    return json({ ok: true, config: cfg });
  }

  // ── unmap_reward ────────────────────────────────────────────────────────────
  if (body.action === 'unmap_reward') {
    if (!body.reward_id) return json({ error: 'reward_id is required' }, 400);
    const { data: mapping } = await admin
      .from('reward_shopify_discounts')
      .select('reward_id, brand_name')
      .eq('reward_id', body.reward_id)
      .maybeSingle();
    if (!mapping || !sameBrand(mapping.brand_name, brand)) return json({ error: 'Forbidden' }, 403);
    await admin.from('reward_shopify_discounts').delete().eq('reward_id', body.reward_id);
    // The reward keeps API_VALIDATED + pool fallback; flipping back to POOL is
    // a deliberate admin call since it changes member-facing behaviour.
    return json({ ok: true });
  }

  // ── create_test_code: one labelled single-use code through the production
  //    rails — cloned from the mapped template and tracked as 'reserved', so
  //    spending it at checkout flips it to 'used' via the orders webhook.
  //    Lets partners (and Shopify app review) verify the full loop without a
  //    member redemption. reward_id optional; defaults to the latest mapping.
  if (body.action === 'create_test_code') {
    const shop = await getShop();
    if (shop?.status !== 'connected') return json({ error: 'Connect your Shopify store first' }, 409);

    let mq = admin.from('reward_shopify_discounts')
      .select('reward_id, discount_title, config')
      .ilike('brand_name', brand);
    if (body.reward_id) mq = mq.eq('reward_id', body.reward_id);
    const { data: mappings } = await mq.order('updated_at', { ascending: false }).limit(1);
    const mapping = mappings?.[0];
    if (!mapping) return json({ error: 'Map a reward to a discount first' }, 409);

    const code = mintCode('POWR-TEST-', 6);
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const ok = await createClonedDiscount(
      shop, mapping.config ?? {},
      `POWR TEST · ${mapping.discount_title} · ${code}`, code, expiresAt,
    );
    if (!ok) return json({ error: 'Shopify discount create failed — check the store connection above' }, 502);

    // Tracked like a member-held code (minus the member) so reconciliation
    // treats it identically. No redemption ledger row — it isn't one.
    const { error: insErr } = await admin.from('redemption_codes').insert({
      reward_id: mapping.reward_id,
      code,
      source: 'PARTNER_API',
      status: 'reserved',
      assigned_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
    if (insErr) {
      return json({ error: `The code ${code} was created in Shopify but POWR couldn't track it (${insErr.message}) — delete it in your store and try again` }, 500);
    }

    if (isAdmin) {
      await admin.from('admin_audit_log').insert({
        admin_id: user.id, action: 'shopify_create_test_code', target_type: 'reward_brand',
        target_id: null, metadata: { brand_name: brand, reward_id: mapping.reward_id, code },
      });
    }
    return json({ ok: true, code, reward_id: mapping.reward_id, expires_at: expiresAt });
  }

  // ── disconnect ──────────────────────────────────────────────────────────────
  if (body.action === 'disconnect') {
    const shop = await getShop();
    if (!shop) return json({ ok: true });
    await admin.from('reward_brand_shopify')
      .update({
        status: 'disconnected',
        access_token: null,
        access_token_expires_at: null,
        refresh_token: null,
        refresh_token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('brand_name', shop.brand_name);
    await admin.from('reward_brand_integrations')
      .update({ mint_enabled: false })
      .ilike('brand_name', brand);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});

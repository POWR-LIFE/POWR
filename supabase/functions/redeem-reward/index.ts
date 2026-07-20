// @ts-nocheck — Deno runtime
import { createClient } from '@supabase/supabase-js';
import { signedPost } from '../_shared/webhookSign.ts';

const CROCKFORD = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateToken(len = 6): string {
  let out = '';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) out += CROCKFORD[bytes[i] % CROCKFORD.length];
  return out;
}

function generateCode(partnerCode: string): string {
  return `POWR-${partnerCode.toUpperCase()}-${generateToken(6)}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// pool.low fires when a POOL reward's claimable stock dips to/below the
// brand's threshold — at most once per reward per 24h.
async function maybeEnqueuePoolLow(admin, reward) {
  const { data: integ } = await admin
    .from('reward_brand_integrations')
    .select('pool_low_threshold')
    .ilike('brand_name', reward.brand_name)
    .maybeSingle();
  const threshold = integ?.pool_low_threshold ?? 10;
  if (threshold <= 0) return;

  const { count } = await admin
    .from('redemption_codes')
    .select('id', { count: 'exact', head: true })
    .eq('reward_id', reward.id)
    .eq('status', 'available')
    .gt('expires_at', new Date().toISOString());
  if ((count ?? 0) > threshold) return;

  const { data: recent } = await admin
    .from('reward_brand_webhook_deliveries')
    .select('id')
    .eq('event_type', 'pool.low')
    .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    .filter('payload->data->>reward_id', 'eq', reward.id)
    .limit(1);
  if (recent?.length) return;

  await admin.rpc('enqueue_brand_webhook', {
    p_brand_name: reward.brand_name,
    p_event_type: 'pool.low',
    p_payload: {
      brand_name: reward.brand_name,
      reward_id: reward.id,
      reward_title: reward.title,
      available: count ?? 0,
      threshold,
    },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing authorization' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  );

  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const { data: { user }, error: authErr } = await userClient.auth.getUser(jwt);
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  let body: { reward_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body.reward_id) return json({ error: 'reward_id required' }, 400);

  // 1. Load reward + partner
  const { data: reward, error: rErr } = await admin
    .from('rewards')
    .select('id, partner_id, title, powr_cost, active, integration_type, code_expiry_days, max_redemptions_per_user, url, promo_code, image_url, hero_image_url, brand_name, partners(partner_code, checkout_url_template, name, logo_url)')
    .eq('id', body.reward_id)
    .single();

  if (rErr || !reward) return json({ error: 'REWARD_NOT_FOUND' }, 404);
  if (!reward.active) return json({ error: 'REWARD_INACTIVE' }, 422);

  const partner = Array.isArray(reward.partners) ? reward.partners[0] : reward.partners;

  // Snapshot fields stored on every redemption so the wallet renders a complete
  // receipt even if the reward/partner is later deactivated or edited.
  const receiptFields = {
    reward_title: reward.title,
    partner_name: partner?.name ?? reward.brand_name ?? null,
    reward_image_url: reward.image_url ?? partner?.logo_url ?? null,
    reward_hero_image_url: reward.hero_image_url ?? null,
  };

  // API_VALIDATED rewards mint a code at redemption time — preferably
  // just-in-time from the brand's own system (reward_brand_integrations),
  // falling back to buffer pool stock, else the legacy POWR self-mint
  // (which needs a linked partner_code).
  let integration = null;
  if (reward.integration_type === 'API_VALIDATED') {
    if (reward.brand_name) {
      const { data } = await admin
        .from('reward_brand_integrations')
        .select('brand_name, mint_url, mint_secret, mint_enabled, mint_consecutive_failures, mint_disabled_until')
        .ilike('brand_name', reward.brand_name)
        .maybeSingle();
      integration = data;
    }
    if (!integration?.mint_enabled && !partner?.partner_code) {
      return json({ error: 'PARTNER_MISCONFIGURED' }, 500);
    }
  }

  // Affiliate links and explicitly shared promo codes are reusable offers, so
  // return an existing active receipt instead of charging points a second time.
  if (reward.integration_type === 'AFFILIATE' || reward.promo_code?.trim()) {
    const { data: existing } = await admin
      .from('redemptions')
      .select('id, code, checkout_url, expires_at, integration_type')
      .eq('user_id', user.id)
      .eq('reward_id', reward.id)
      .eq('status', 'active')
      .gte('expires_at', new Date().toISOString())
      .order('redeemed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      return json({
        ok: true,
        code: existing.code,
        checkout_url: existing.checkout_url,
        expires_at: existing.expires_at,
        redemption_id: existing.id,
        integration_type: existing.integration_type,
      });
    }
  }

  // 2a. Check per-user redemption limit
  if (reward.max_redemptions_per_user !== null && reward.max_redemptions_per_user !== undefined) {
    const { count, error: limitErr } = await admin
      .from('redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('reward_id', reward.id)
      .neq('status', 'refunded');
    if (!limitErr && count !== null && count >= reward.max_redemptions_per_user) {
      return json({ error: 'REDEMPTION_LIMIT_REACHED' }, 422);
    }
  }

  // 2b. Check balance via point_transactions sum
  const { data: txs } = await admin
    .from('point_transactions')
    .select('amount')
    .eq('user_id', user.id);
  const balance = (txs ?? []).reduce((s: number, t: { amount: number }) => s + t.amount, 0);
  if (balance < reward.powr_cost) {
    return json({ error: 'INSUFFICIENT_POINTS', balance, required: reward.powr_cost }, 422);
  }

  // 3. Acquire a code based on integration type
  const expiresAt = new Date(Date.now() + reward.code_expiry_days * 86400_000).toISOString();

  // AFFILIATE: no unique code — just deduct points and return the shared URL.
  if (reward.integration_type === 'AFFILIATE') {
    const checkoutUrl = reward.url || partner?.checkout_url_template || null;
    if (!checkoutUrl) return json({ error: 'PARTNER_MISCONFIGURED' }, 500);
    const receiptId = `POWR-AFF-${generateToken(8)}`;
    const { error: spendErr } = await admin.rpc('spend_points', {
      p_user_id: user.id,
      p_amount: reward.powr_cost,
      p_description: `Redeemed: ${reward.title}`,
    });
    if (spendErr) {
      return json({ error: String(spendErr.message).includes('INSUFFICIENT_POINTS') ? 'INSUFFICIENT_POINTS' : 'TX_FAILED' }, 422);
    }
    const { data: redemption } = await admin.from('redemptions').insert({
      user_id: user.id,
      reward_id: reward.id,
      code: receiptId,
      integration_type: 'AFFILIATE',
      powr_spent: reward.powr_cost,
      status: 'active',
      expires_at: expiresAt,
      checkout_url: checkoutUrl,
      ...receiptFields,
    }).select('id').single();
    return json({
      ok: true,
      code: receiptId,
      checkout_url: checkoutUrl,
      expires_at: expiresAt,
      redemption_id: redemption?.id ?? null,
      integration_type: 'AFFILIATE',
    });
  }

  // A configured promo_code is intentionally shared by every member. It is a
  // wallet receipt, not a code-pool entry, so it must bypass pool depletion.
  const sharedCode = reward.promo_code?.trim();
  if (sharedCode) {
    const checkoutUrl = partner?.checkout_url_template
      ? partner.checkout_url_template.replace('{code}', sharedCode)
      : (reward.url || null);
    const { error: spendErr } = await admin.rpc('spend_points', {
      p_user_id: user.id,
      p_amount: reward.powr_cost,
      p_description: `Redeemed: ${reward.title}`,
    });
    if (spendErr) {
      return json({ error: String(spendErr.message).includes('INSUFFICIENT_POINTS') ? 'INSUFFICIENT_POINTS' : 'TX_FAILED' }, 422);
    }
    const { data: redemption } = await admin.from('redemptions').insert({
      user_id: user.id,
      reward_id: reward.id,
      code: sharedCode,
      integration_type: reward.integration_type,
      powr_spent: reward.powr_cost,
      status: 'active',
      expires_at: expiresAt,
      checkout_url: checkoutUrl,
      ...receiptFields,
    }).select('id').single();
    return json({
      ok: true,
      code: sharedCode,
      checkout_url: checkoutUrl,
      expires_at: expiresAt,
      redemption_id: redemption?.id ?? null,
      integration_type: reward.integration_type,
    });
  }

  let codeRow: { id: string; code: string } | null = null;

  if (reward.integration_type === 'POOL') {
    // Atomic claim via RPC-style update with returning
    const { data: claimed, error: claimErr } = await admin.rpc('claim_pool_code', {
      p_reward_id: reward.id,
      p_user_id: user.id,
      p_expires_at: expiresAt,
    });
    if (claimErr) {
      // Fallback if RPC not deployed: optimistic update — retry up to 5 times
      // in case two requests race for the same row (the loser's update returns
      // 0 rows because status is no longer 'available').
      let attempts = 0;
      while (attempts < 5 && !codeRow) {
        const { data: picked } = await admin
          .from('redemption_codes')
          .select('id, code')
          .eq('reward_id', reward.id)
          .eq('status', 'available')
          .limit(1)
          .maybeSingle();
        if (!picked) break; // genuinely out of stock
        const { data: upd } = await admin
          .from('redemption_codes')
          .update({ status: 'reserved', assigned_user_id: user.id, assigned_at: new Date().toISOString(), expires_at: expiresAt })
          .eq('id', picked.id)
          .eq('status', 'available') // only succeeds if we won the race
          .select('id, code')
          .maybeSingle();
        if (upd) codeRow = upd;
        attempts++;
      }
      if (!codeRow) return json({ error: 'OUT_OF_STOCK' }, 422);
    } else if (!claimed || !claimed.length) {
      return json({ error: 'OUT_OF_STOCK' }, 422);
    } else {
      codeRow = { id: claimed[0].id, code: claimed[0].code };
    }
  } else {
    // API_VALIDATED — mint a new code at redemption time.
    const jitReady = !!(integration?.mint_enabled && integration?.mint_url && integration?.mint_secret
      && (!integration.mint_disabled_until || new Date(integration.mint_disabled_until).getTime() <= Date.now()));

    // 1) Just-in-time: ask the brand's own system for a fresh single-use code.
    //    Strict 3s budget — a slow partner must never stall the member.
    if (jitReady) {
      const mintBody = JSON.stringify({
        type: 'code.mint_request',
        request_id: crypto.randomUUID(),
        brand_name: integration.brand_name,
        reward_id: reward.id,
        reward_title: reward.title,
        expires_at: expiresAt,
      });
      const res = await signedPost(integration.mint_url, integration.mint_secret, mintBody, {
        timeoutMs: 3000,
        extraHeaders: { 'X-POWR-Event': 'code.mint_request' },
      });

      let minted = null;
      if (res.ok) {
        try { minted = String(JSON.parse(res.body)?.code ?? '').trim().toUpperCase(); } catch { minted = null; }
        if (minted && !/^[A-Z0-9][A-Z0-9-]{2,62}[A-Z0-9]$/.test(minted)) minted = null;
      }
      if (minted) {
        // A unique-violation (partner re-issued a code) falls through as a
        // mint failure rather than surfacing someone else's code.
        const { data: inserted } = await admin
          .from('redemption_codes')
          .insert({
            reward_id: reward.id,
            code: minted,
            source: 'PARTNER_API',
            status: 'reserved',
            assigned_user_id: user.id,
            assigned_at: new Date().toISOString(),
            expires_at: expiresAt,
          })
          .select('id, code')
          .maybeSingle();
        if (inserted) codeRow = inserted;
      }

      // Circuit breaker: 3 consecutive failures pause JIT for 10 minutes so a
      // partner outage degrades to the pool fallback instead of 3s stalls.
      if (codeRow) {
        if (integration.mint_consecutive_failures > 0) {
          await admin.from('reward_brand_integrations')
            .update({ mint_consecutive_failures: 0, mint_disabled_until: null })
            .eq('brand_name', integration.brand_name);
        }
      } else {
        const failures = (integration.mint_consecutive_failures ?? 0) + 1;
        await admin.from('reward_brand_integrations')
          .update({
            mint_consecutive_failures: failures,
            mint_disabled_until: failures >= 3 ? new Date(Date.now() + 10 * 60_000).toISOString() : null,
          })
          .eq('brand_name', integration.brand_name);
        console.error('JIT mint failed', { brand: integration.brand_name, reward_id: reward.id, error: res.error ?? 'invalid mint response' });
      }
    }

    // 2) Buffer pool — JIT brands can keep emergency stock pre-loaded.
    if (!codeRow) {
      const { data: claimed } = await admin.rpc('claim_pool_code', {
        p_reward_id: reward.id,
        p_user_id: user.id,
        p_expires_at: expiresAt,
      });
      if (claimed?.length) codeRow = { id: claimed[0].id, code: claimed[0].code };
    }

    // JIT brand with no buffer stock: fail cleanly — no points were charged.
    if (!codeRow && integration?.mint_enabled) {
      return json({ error: 'REWARD_TEMPORARILY_UNAVAILABLE' }, 503);
    }

    // 3) Legacy POWR self-mint (pre-JIT behaviour, unchanged).
    if (!codeRow) {
      let attempts = 0;
      while (attempts < 5 && !codeRow) {
        const code = generateCode(partner.partner_code);
        const { data: inserted, error: insErr } = await admin
          .from('redemption_codes')
          .insert({
            reward_id: reward.id,
            code,
            source: 'POWR_GENERATED',
            status: 'reserved',
            assigned_user_id: user.id,
            assigned_at: new Date().toISOString(),
            expires_at: expiresAt,
          })
          .select('id, code')
          .single();
        if (!insErr && inserted) {
          codeRow = inserted;
          break;
        }
        attempts++;
      }
      if (!codeRow) return json({ error: 'CODE_GENERATION_FAILED' }, 500);
    }
  }

  // Resolve the checkout URL now so it can be stored on the receipt and returned.
  const checkoutUrl = partner?.checkout_url_template
    ? partner.checkout_url_template.replace('{code}', codeRow.code)
    : (reward.url || null);

  // 4. Deduct points atomically — balance check + debit under a per-user lock.
  const { error: spendErr } = await admin.rpc('spend_points', {
    p_user_id: user.id,
    p_amount: reward.powr_cost,
    p_description: `Redeemed: ${reward.title}`,
  });
  if (spendErr) {
    // Release the code we reserved/minted for this attempt.
    await admin.from('redemption_codes')
      .update({ status: 'available', assigned_user_id: null, assigned_at: null })
      .eq('id', codeRow.id);
    return json({ error: String(spendErr.message).includes('INSUFFICIENT_POINTS') ? 'INSUFFICIENT_POINTS' : 'TX_FAILED' }, 422);
  }

  // 5. The code stays 'reserved' while the member holds it in their wallet.
  //    It becomes 'used' only when the brand confirms real-world usage
  //    (portal or API reconciliation) — that flip fires the code.used
  //    webhook. (Until 2026-07 this flipped to 'used' immediately, which
  //    made partner reconciliation a no-op.)

  // 6. Insert redemption ledger row
  const { data: redemption, error: redErr } = await admin
    .from('redemptions')
    .insert({
      user_id: user.id,
      reward_id: reward.id,
      code_id: codeRow.id,
      code: codeRow.code,
      integration_type: reward.integration_type,
      powr_spent: reward.powr_cost,
      status: 'active',
      expires_at: expiresAt,
      checkout_url: checkoutUrl,
      ...receiptFields,
    })
    .select('id')
    .single();

  if (redErr) {
    console.error('Redemption insert failed', redErr);
  }

  // 7. Notify the brand's systems (fire-and-forget — never blocks or fails
  //    the member's redemption). enqueue_brand_webhook no-ops for brands
  //    without active endpoints; the cheap existence probe skips the
  //    per-event queries entirely for non-integrated brands.
  try {
    if (reward.brand_name) {
      const { data: hasEndpoint } = await admin
        .from('reward_brand_webhook_endpoints')
        .select('id')
        .ilike('brand_name', reward.brand_name)
        .eq('active', true)
        .limit(1);
      if (hasEndpoint?.length) {
        await admin.rpc('enqueue_brand_webhook', {
          p_brand_name: reward.brand_name,
          p_event_type: 'code.assigned',
          p_payload: {
            brand_name: reward.brand_name,
            reward_id: reward.id,
            reward_title: reward.title,
            code_id: codeRow.id,
            code: codeRow.code,
            assigned_at: new Date().toISOString(),
            expires_at: expiresAt,
          },
        });
        if (reward.integration_type === 'POOL') {
          await maybeEnqueuePoolLow(admin, reward);
        }
      }
    }
  } catch (whErr) {
    console.error('webhook enqueue failed', whErr);
  }

  return json({
    ok: true,
    code: codeRow.code,
    checkout_url: checkoutUrl,
    expires_at: expiresAt,
    redemption_id: redemption?.id ?? null,
    integration_type: reward.integration_type,
  });
});

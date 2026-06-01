// @ts-nocheck — Deno runtime
import { createClient } from '@supabase/supabase-js';

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
    .select('id, partner_id, title, powr_cost, active, integration_type, code_expiry_days, max_redemptions_per_user, url, partners(partner_code, checkout_url_template, name)')
    .eq('id', body.reward_id)
    .single();

  if (rErr || !reward) return json({ error: 'REWARD_NOT_FOUND' }, 404);
  if (!reward.active) return json({ error: 'REWARD_INACTIVE' }, 422);

  const partner = Array.isArray(reward.partners) ? reward.partners[0] : reward.partners;

  // API_VALIDATED rewards need a partner_code to mint codes; POOL rewards use pre-loaded codes
  if (reward.integration_type === 'API_VALIDATED' && !partner?.partner_code) {
    return json({ error: 'PARTNER_MISCONFIGURED' }, 500);
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

  // AFFILIATE: no unique code — just deduct points and return the reward URL
  if (reward.integration_type === 'AFFILIATE') {
    const receiptId = `POWR-AFF-${generateToken(8)}`;
    const { error: txErr } = await admin.from('point_transactions').insert({
      user_id: user.id,
      amount: -reward.powr_cost,
      type: 'redeem',
      description: `Redeemed: ${reward.title}`,
    });
    if (txErr) return json({ error: 'TX_FAILED' }, 500);
    const { data: redemption } = await admin.from('redemptions').insert({
      user_id: user.id,
      reward_id: reward.id,
      code: receiptId,
      integration_type: 'AFFILIATE',
      powr_spent: reward.powr_cost,
      status: 'active',
      expires_at: expiresAt,
    }).select('id').single();
    return json({
      ok: true,
      code: receiptId,
      checkout_url: reward.url,
      expires_at: expiresAt,
      redemption_id: redemption?.id ?? null,
      integration_type: 'AFFILIATE',
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
    // API_VALIDATED — mint a new code
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

  // 4. Deduct points via point_transactions (service role bypasses RLS)
  const { error: txErr } = await admin.from('point_transactions').insert({
    user_id: user.id,
    amount: -reward.powr_cost,
    type: 'redeem',
    description: `Redeemed: ${reward.title}`,
  });
  if (txErr) {
    // Release the code
    await admin.from('redemption_codes')
      .update({ status: 'available', assigned_user_id: null, assigned_at: null })
      .eq('id', codeRow.id);
    return json({ error: 'TX_FAILED' }, 500);
  }

  // 5. Mark code as used now that points are deducted
  await admin
    .from('redemption_codes')
    .update({ status: 'used', used_at: new Date().toISOString() })
    .eq('id', codeRow.id);

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
    })
    .select('id')
    .single();

  if (redErr) {
    console.error('Redemption insert failed', redErr);
  }

  const checkoutUrl = partner?.checkout_url_template
    ? partner.checkout_url_template.replace('{code}', codeRow.code)
    : (reward.url || null);

  return json({
    ok: true,
    code: codeRow.code,
    checkout_url: checkoutUrl,
    expires_at: expiresAt,
    redemption_id: redemption?.id ?? null,
    integration_type: reward.integration_type,
  });
});

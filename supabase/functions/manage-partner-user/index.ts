// @ts-nocheck — Deno runtime
// Manages reward-brand portal accounts. Brands are identified by
// rewards.brand_name — the partners table (gym locations) is never touched.
//
// PUBLIC actions (no auth — the invite token is the credential):
//   validate_invite { token }                          → brand context for the setup page
//   redeem_invite   { token, email, password, contact_name? }
//                                                      → creates the auth user + reward_brand_users
//                                                        row and burns the token
//
// ADMIN actions (caller must be in admin_roles):
//   create_invite { brand_name }          → mints a tokenized setup link (no email needed)
//   revoke_invite { invite_id }           → revokes an unused setup link
//   invite        { brand_name, email }   → email invite via Supabase (needs SMTP configured)
//   list          { brand_name }          → portal users + open setup invites for a brand
//   remove        { user_id }             → removes portal access (keeps auth user)

import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Latest logo for a brand, from its rewards (brands have no table of their own)
async function brandLogo(adminClient, brandName) {
  const { data } = await adminClient
    .from('rewards')
    .select('image_url')
    .ilike('brand_name', brandName)
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0]?.image_url ?? null;
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

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC: setup-link validation + redemption (token is the credential)
  // ══════════════════════════════════════════════════════════════════════════

  if (body.action === 'validate_invite') {
    const { token } = body;
    if (!token) return json({ ok: false, reason: 'invalid' });

    const { data: inv } = await adminClient
      .from('reward_brand_invites')
      .select('status, brand_name')
      .eq('invite_token', token)
      .single();

    if (!inv) return json({ ok: false, reason: 'invalid' });
    if (inv.status !== 'invited') return json({ ok: false, reason: inv.status === 'used' ? 'used' : 'invalid' });

    return json({
      ok: true,
      brand: {
        name: inv.brand_name,
        logo_url: await brandLogo(adminClient, inv.brand_name),
      },
    });
  }

  if (body.action === 'redeem_invite') {
    const { token, email, password, contact_name } = body;
    if (!token) return json({ ok: false, reason: 'invalid' });

    const cleanEmail = String(email ?? '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return json({ error: 'Enter a valid email address' }, 400);
    if (String(password ?? '').length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);

    const { data: inv } = await adminClient
      .from('reward_brand_invites')
      .select('id, brand_name, status, created_by')
      .eq('invite_token', token)
      .single();

    if (!inv) return json({ ok: false, reason: 'invalid' });
    if (inv.status !== 'invited') return json({ ok: false, reason: inv.status === 'used' ? 'used' : 'invalid' });

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: contact_name?.trim() || '' },
    });
    if (createErr) {
      const msg = /already.*(registered|exists)/i.test(createErr.message)
        ? 'An account with this email already exists. Contact POWR to link it to your brand.'
        : createErr.message;
      return json({ error: msg }, 400);
    }

    const userId = created.user.id;

    const { error: linkErr } = await adminClient
      .from('reward_brand_users')
      .upsert(
        { user_id: userId, brand_name: inv.brand_name, created_by: inv.created_by },
        { onConflict: 'user_id' },
      );
    if (linkErr) {
      // Roll back the orphaned auth user so the invite can be retried cleanly
      await adminClient.auth.admin.deleteUser(userId);
      return json({ error: linkErr.message }, 400);
    }

    await adminClient
      .from('reward_brand_invites')
      .update({ status: 'used', used_at: new Date().toISOString(), used_by: userId })
      .eq('id', inv.id);

    return json({ ok: true });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN: everything below requires a logged-in admin
  // ══════════════════════════════════════════════════════════════════════════

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
  if (!adminRow) return json({ error: 'Forbidden' }, 403);

  const siteUrl = Deno.env.get('SITE_URL') ?? 'https://powr.life';

  // ── create_invite: mint a tokenized setup link (no email needed) ───────────
  if (body.action === 'create_invite') {
    const brandName = String(body.brand_name ?? '').trim();
    if (!brandName) return json({ error: 'brand_name is required' }, 400);

    const token = crypto.randomUUID();
    const { error: invErr } = await adminClient
      .from('reward_brand_invites')
      .insert({ invite_token: token, brand_name: brandName, created_by: user.id });
    if (invErr) return json({ error: invErr.message }, 400);

    await adminClient.from('admin_audit_log').insert({
      admin_id: user.id,
      action: 'create_brand_setup_link',
      target_type: 'reward_brand',
      target_id: null,
      metadata: { brand_name: brandName },
    });

    return json({ ok: true, token, url: `${siteUrl}/partner/setup/${token}` });
  }

  // ── revoke_invite ───────────────────────────────────────────────────────────
  if (body.action === 'revoke_invite') {
    const { invite_id } = body;
    if (!invite_id) return json({ error: 'invite_id is required' }, 400);

    const { error: revErr } = await adminClient
      .from('reward_brand_invites')
      .update({ status: 'revoked' })
      .eq('id', invite_id)
      .eq('status', 'invited');
    if (revErr) return json({ error: revErr.message }, 400);

    return json({ ok: true });
  }

  // ── invite: email invite via Supabase (requires working SMTP) ──────────────
  if (body.action === 'invite') {
    const brandName = String(body.brand_name ?? '').trim();
    const { email } = body;
    if (!brandName || !email) return json({ error: 'brand_name and email are required' }, 400);

    const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
      email.toLowerCase().trim(),
      { redirectTo: `${siteUrl}/partner` },
    );
    if (inviteErr) return json({ error: inviteErr.message }, 400);

    const newUserId = invited.user.id;

    const { error: linkErr } = await adminClient
      .from('reward_brand_users')
      .upsert(
        { user_id: newUserId, brand_name: brandName, created_by: user.id },
        { onConflict: 'user_id' },
      );
    if (linkErr) return json({ error: linkErr.message }, 400);

    await adminClient.from('admin_audit_log').insert({
      admin_id: user.id,
      action: 'invite_brand_user',
      target_type: 'reward_brand',
      target_id: null,
      metadata: { brand_name: brandName, email },
    });

    return json({ ok: true, user_id: newUserId });
  }

  // ── list: portal users + open setup invites for a brand ────────────────────
  if (body.action === 'list') {
    const brandName = String(body.brand_name ?? '').trim();
    if (!brandName) return json({ error: 'brand_name is required' }, 400);

    const [{ data: rows, error: listErr }, { data: invites }] = await Promise.all([
      adminClient
        .from('reward_brand_users')
        .select('id, user_id, created_at')
        .ilike('brand_name', brandName)
        .order('created_at', { ascending: true }),
      adminClient
        .from('reward_brand_invites')
        .select('id, invite_token, created_at')
        .ilike('brand_name', brandName)
        .eq('status', 'invited')
        .order('created_at', { ascending: false }),
    ]);
    if (listErr) return json({ error: listErr.message }, 400);

    const users = await Promise.all(
      (rows ?? []).map(async (row) => {
        const { data } = await adminClient.auth.admin.getUserById(row.user_id);
        return {
          id: row.id,
          user_id: row.user_id,
          created_at: row.created_at,
          email: data?.user?.email ?? '—',
          last_sign_in: data?.user?.last_sign_in_at ?? null,
          confirmed: !!data?.user?.email_confirmed_at,
        };
      }),
    );

    const openInvites = (invites ?? []).map((i) => ({
      id: i.id,
      created_at: i.created_at,
      token: i.invite_token,
      url: `${siteUrl}/partner/setup/${i.invite_token}`,
    }));

    return json({ ok: true, users, invites: openInvites });
  }

  // ── remove ──────────────────────────────────────────────────────────────────
  if (body.action === 'remove') {
    const { user_id } = body;
    if (!user_id) return json({ error: 'user_id is required' }, 400);

    const { error: removeErr } = await adminClient
      .from('reward_brand_users')
      .delete()
      .eq('user_id', user_id);
    if (removeErr) return json({ error: removeErr.message }, 400);

    await adminClient.from('admin_audit_log').insert({
      admin_id: user.id,
      action: 'remove_brand_user',
      target_type: 'reward_brand',
      target_id: null,
      metadata: { user_id },
    });

    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});

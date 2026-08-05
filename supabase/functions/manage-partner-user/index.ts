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
// AUTHENTICATED actions — admins act on any brand; a brand's own portal users
// can also call these, server-forced to THEIR brand (so partners can manage
// their own team from /partner/settings):
//   create_invite { brand_name, email? }  → mints a tokenized setup link. With an
//                                            email, also sends the brand that link
//                                            via Mailgun; without one it's copy-link
//                                            only. The link is identical either way.
//   revoke_invite { invite_id }           → revokes an unused setup link
//   list          { brand_name }          → portal users + open setup invites for a brand
//   remove        { user_id }             → removes portal access (keeps auth user);
//                                            partners cannot remove themselves
//
// ADMIN-only:
//   invite        { brand_name, email }   → email invite via Supabase (needs SMTP configured)

import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../_shared/mailgun.ts';
import { brandInviteEmail } from '../_shared/emails/brand-invite.ts';
import { partnerWelcomeEmail } from '../_shared/emails/partner-welcome.ts';

const REPLY_TO = 'support@powr.life';

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

    // Post-setup welcome — best-effort; a send failure must not fail the setup.
    try {
      const tpl = partnerWelcomeEmail({ brandName: inv.brand_name, contactName: contact_name?.trim() || null });
      await sendEmail({ to: cleanEmail, subject: tpl.subject, html: tpl.html, text: tpl.text, replyTo: REPLY_TO });
    } catch (err) {
      console.error('redeem_invite: welcome email failed:', err);
    }

    return json({ ok: true });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AUTHENTICATED: everything below requires a logged-in admin, or a brand
  // portal user acting on their own brand
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
  const isAdmin = !!adminRow;

  // Non-admins must be a portal user of some brand; every action below is then
  // forced to that brand regardless of what the request body claims.
  let callerBrand = null;
  if (!isAdmin) {
    const { data: brandRow } = await adminClient
      .from('reward_brand_users')
      .select('brand_name')
      .eq('user_id', user.id)
      .single();
    callerBrand = brandRow?.brand_name ?? null;
    if (!callerBrand) return json({ error: 'Forbidden' }, 403);
  }

  const sameBrand = (a, b) =>
    String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

  const siteUrl = Deno.env.get('SITE_URL') ?? 'https://powr.life';

  // ── create_invite: mint a tokenized setup link, optionally email it ─────────
  // The link (/partner/setup/{token}) is the credential. Pass an `email` to send
  // the brand that same link via Mailgun; omit it for copy-link-only.
  if (body.action === 'create_invite') {
    const brandName = isAdmin ? String(body.brand_name ?? '').trim() : callerBrand;
    if (!brandName) return json({ error: 'brand_name is required' }, 400);

    const email = String(body.email ?? '').toLowerCase().trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Enter a valid email address' }, 400);
    }

    const token = crypto.randomUUID();
    const { error: invErr } = await adminClient
      .from('reward_brand_invites')
      .insert({ invite_token: token, brand_name: brandName, created_by: user.id, email: email || null });
    if (invErr) return json({ error: invErr.message }, 400);

    const setupLink = `${siteUrl}/partner/setup/${token}`;

    // Email the link if one was given. A send failure must NOT lose the invite —
    // the row is already saved, so we surface the error and let the admin copy
    // the link instead.
    let emailed = false;
    if (email) {
      try {
        const tpl = brandInviteEmail({ brandName, setupUrl: setupLink, logoUrl: await brandLogo(adminClient, brandName) });
        await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, replyTo: REPLY_TO });
        emailed = true;
      } catch (err) {
        console.error('create_invite: failed to email setup link:', err);
        return json({ ok: true, token, url: setupLink, emailed: false, email_error: 'Link created, but the email could not be sent — copy it below instead.' });
      }
    }

    if (isAdmin) {
      await adminClient.from('admin_audit_log').insert({
        admin_id: user.id,
        action: emailed ? 'email_brand_setup_link' : 'create_brand_setup_link',
        target_type: 'reward_brand',
        target_id: null,
        metadata: { brand_name: brandName, email: email || null, emailed },
      });
    }

    return json({ ok: true, token, url: setupLink, emailed });
  }

  // ── revoke_invite ───────────────────────────────────────────────────────────
  if (body.action === 'revoke_invite') {
    const { invite_id } = body;
    if (!invite_id) return json({ error: 'invite_id is required' }, 400);

    if (!isAdmin) {
      const { data: inv } = await adminClient
        .from('reward_brand_invites')
        .select('brand_name')
        .eq('id', invite_id)
        .single();
      if (!inv || !sameBrand(inv.brand_name, callerBrand)) return json({ error: 'Forbidden' }, 403);
    }

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
    if (!isAdmin) return json({ error: 'Forbidden' }, 403);
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
    const brandName = isAdmin ? String(body.brand_name ?? '').trim() : callerBrand;
    if (!brandName) return json({ error: 'brand_name is required' }, 400);

    const [{ data: rows, error: listErr }, { data: invites }] = await Promise.all([
      adminClient
        .from('reward_brand_users')
        .select('id, user_id, created_at')
        .ilike('brand_name', brandName)
        .order('created_at', { ascending: true }),
      adminClient
        .from('reward_brand_invites')
        .select('id, invite_token, created_at, email')
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
      email: i.email ?? null,
      url: `${siteUrl}/partner/setup/${i.invite_token}`,
    }));

    return json({ ok: true, users, invites: openInvites });
  }

  // ── remove ──────────────────────────────────────────────────────────────────
  if (body.action === 'remove') {
    const { user_id } = body;
    if (!user_id) return json({ error: 'user_id is required' }, 400);

    if (!isAdmin) {
      // A partner can't remove themselves — the brand always keeps ≥1 login
      if (user_id === user.id) return json({ error: "You can't remove your own access" }, 400);
      const { data: target } = await adminClient
        .from('reward_brand_users')
        .select('brand_name')
        .eq('user_id', user_id)
        .single();
      if (!target || !sameBrand(target.brand_name, callerBrand)) return json({ error: 'Forbidden' }, 403);
    }

    const { error: removeErr } = await adminClient
      .from('reward_brand_users')
      .delete()
      .eq('user_id', user_id);
    if (removeErr) return json({ error: removeErr.message }, 400);

    if (isAdmin) {
      await adminClient.from('admin_audit_log').insert({
        admin_id: user.id,
        action: 'remove_brand_user',
        target_type: 'reward_brand',
        target_id: null,
        metadata: { user_id },
      });
    }

    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});

// @ts-nocheck — Deno runtime
// Who can act for a gym in the gym portal (powr.life/venue). Gyms are
// partners rows; access is gym_staff (partner_id, user_id, role owner|staff).
// Every read the portal itself makes goes through the gym_* SQL functions —
// this function only owns logins and invites, which need the service role.
//
// PUBLIC (the invite token is the credential; only its sha256 is stored):
//   validate_invite { token }              → gym name/logo + role, for the setup page
//   redeem_invite   { token, email, password, contact_name? }
//                                          → NEW account: creates the auth user,
//                                            links it, burns the token
//
// SIGNED IN:
//   accept_invite   { token }              → links the CALLER's existing account
//                                            (someone who already uses the app)
//
// SIGNED IN — admins on any gym, owners on their own (staff can only list):
//   create_invite { partner_id, role?, email? }
//                                          → mints a setup link; with an email, also
//                                            sends it. Owners can only invite staff.
//   revoke_invite { invite_id }
//   list          { partner_id }           → team + open invites (emails of the
//                                            gym's own team only)
//   remove        { partner_id, user_id }  → admins: anyone but the last owner;
//                                            owners: staff only

import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../_shared/mailgun.ts';
import { gymInviteEmail } from '../_shared/emails/gym-invite.ts';

const REPLY_TO = 'support@powr.life';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// An open invite for this token: exists, unused, unrevoked, unexpired.
async function openInvite(adminClient, token) {
  if (!token || typeof token !== 'string' || token.length < 16) return { reason: 'invalid' };
  const { data: inv } = await adminClient
    .from('gym_staff_invites')
    .select('id, partner_id, role, status, expires_at, created_by, email')
    .eq('token_hash', await sha256Hex(token))
    .maybeSingle();
  if (!inv) return { reason: 'invalid' };
  if (inv.status === 'used') return { reason: 'used' };
  if (inv.status !== 'invited') return { reason: 'invalid' };
  if (new Date(inv.expires_at).getTime() < Date.now()) return { reason: 'expired' };
  return { inv };
}

async function gymLook(adminClient, partnerId) {
  const { data } = await adminClient
    .from('partners')
    .select('id, name, logo_url, logo_bg, active')
    .eq('id', partnerId)
    .maybeSingle();
  return data;
}

// Owner beats staff: accepting a staff invite never demotes an owner.
async function linkStaff(adminClient, partnerId, userId, role, createdBy) {
  const { data: existing } = await adminClient
    .from('gym_staff')
    .select('role')
    .eq('partner_id', partnerId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing) {
    if (existing.role === 'staff' && role === 'owner') {
      return adminClient.from('gym_staff').update({ role: 'owner' }).eq('partner_id', partnerId).eq('user_id', userId);
    }
    return { error: null };
  }
  return adminClient.from('gym_staff').insert({ partner_id: partnerId, user_id: userId, role, created_by: createdBy ?? null });
}

// Claim the invite BEFORE creating or linking anything, so two people racing
// the same link can't both get in. Returns false when someone else got it.
async function claimInvite(adminClient, inviteId, userId) {
  const { data } = await adminClient
    .from('gym_staff_invites')
    .update({ status: 'used', used_at: new Date().toISOString(), used_by: userId ?? null })
    .eq('id', inviteId)
    .eq('status', 'invited')
    .select('id');
  return (data ?? []).length === 1;
}

// Hand a claimed invite back when the step after the claim failed.
async function releaseInvite(adminClient, inviteId) {
  await adminClient
    .from('gym_staff_invites')
    .update({ status: 'invited', used_at: null, used_by: null })
    .eq('id', inviteId)
    .eq('status', 'used');
}

async function audit(adminClient, actorId, action, partnerId, metadata) {
  await adminClient.from('admin_audit_log').insert({
    admin_id: actorId, action, target_type: 'partner', target_id: partnerId, metadata,
  });
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

  const siteUrl = Deno.env.get('SITE_URL') ?? 'https://powr.life';

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC
  // ══════════════════════════════════════════════════════════════════════════

  if (body.action === 'validate_invite') {
    const { inv, reason } = await openInvite(adminClient, body.token);
    if (!inv) return json({ ok: false, reason });
    const gym = await gymLook(adminClient, inv.partner_id);
    if (!gym?.active) return json({ ok: false, reason: 'invalid' });
    return json({ ok: true, role: inv.role, gym: { name: gym.name, logo_url: gym.logo_url, logo_bg: gym.logo_bg } });
  }

  if (body.action === 'redeem_invite') {
    const cleanEmail = String(body.email ?? '').toLowerCase().trim();
    if (!EMAIL_RE.test(cleanEmail)) return json({ error: 'Enter a valid email address' }, 400);
    if (String(body.password ?? '').length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);

    const { inv, reason } = await openInvite(adminClient, body.token);
    if (!inv) return json({ ok: false, reason });
    if (!(await claimInvite(adminClient, inv.id, null))) return json({ ok: false, reason: 'used' });

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: String(body.contact_name ?? '').trim() },
    });
    if (createErr) {
      await releaseInvite(adminClient, inv.id);
      // Someone who already uses the app: they sign in and accept instead.
      if (/already.*(registered|exists)/i.test(createErr.message)) {
        return json({ error: 'You already have a POWR account with this email — sign in with it below and the invite will be added to it.', code: 'account_exists' }, 400);
      }
      return json({ error: createErr.message }, 400);
    }

    const userId = created.user.id;
    const { error: linkErr } = await linkStaff(adminClient, inv.partner_id, userId, inv.role, inv.created_by);
    if (linkErr) {
      await adminClient.auth.admin.deleteUser(userId);
      await releaseInvite(adminClient, inv.id);
      return json({ error: linkErr.message }, 400);
    }
    await adminClient.from('gym_staff_invites').update({ used_by: userId }).eq('id', inv.id);
    await audit(adminClient, userId, 'gym_staff_joined', inv.partner_id, { by: 'gym', role: inv.role, via: 'new_account' });
    return json({ ok: true });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SIGNED IN
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

  if (body.action === 'accept_invite') {
    const { inv, reason } = await openInvite(adminClient, body.token);
    if (!inv) return json({ ok: false, reason });
    if (!(await claimInvite(adminClient, inv.id, user.id))) return json({ ok: false, reason: 'used' });
    const { error: linkErr } = await linkStaff(adminClient, inv.partner_id, user.id, inv.role, inv.created_by);
    if (linkErr) {
      await releaseInvite(adminClient, inv.id);
      return json({ error: linkErr.message }, 400);
    }
    await audit(adminClient, user.id, 'gym_staff_joined', inv.partner_id, { by: 'gym', role: inv.role, via: 'existing_account' });
    return json({ ok: true, partner_id: inv.partner_id });
  }

  const { data: adminRow } = await adminClient
    .from('admin_roles')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const isAdmin = !!adminRow;

  // The caller's role at a gym, with the same conditions as _gym_role():
  // portal on, not suspended, partner active.
  const roleAt = async (partnerId) => {
    if (isAdmin) return 'admin';
    const { data: staff } = await adminClient
      .from('gym_staff')
      .select('role')
      .eq('partner_id', partnerId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!staff) return null;
    const [{ data: settings }, gym] = await Promise.all([
      adminClient.from('gym_portal_settings').select('enabled, suspended_at').eq('partner_id', partnerId).maybeSingle(),
      gymLook(adminClient, partnerId),
    ]);
    if (!settings?.enabled || settings.suspended_at || !gym?.active) return null;
    return staff.role;
  };

  // ── create_invite ──────────────────────────────────────────────────────────
  if (body.action === 'create_invite') {
    const partnerId = String(body.partner_id ?? '');
    if (!UUID_RE.test(partnerId)) return json({ error: 'partner_id is required' }, 400);
    const role = await roleAt(partnerId);
    if (role !== 'admin' && role !== 'owner') return json({ error: 'Forbidden' }, 403);

    const inviteRole = body.role === 'owner' ? 'owner' : 'staff';
    if (inviteRole === 'owner' && role !== 'admin') return json({ error: 'Only POWR can add another owner' }, 403);

    const email = String(body.email ?? '').toLowerCase().trim();
    if (email && !EMAIL_RE.test(email)) return json({ error: 'Enter a valid email address' }, 400);

    const gym = await gymLook(adminClient, partnerId);
    if (!gym) return json({ error: 'Gym not found' }, 404);

    const token = newToken();
    const { data: row, error: invErr } = await adminClient
      .from('gym_staff_invites')
      .insert({ partner_id: partnerId, token_hash: await sha256Hex(token), role: inviteRole, email: email || null, created_by: user.id })
      .select('id, expires_at')
      .single();
    if (invErr) return json({ error: invErr.message }, 400);

    const url = `${siteUrl}/venue/setup/${token}`;

    let emailed = false;
    let emailError = null;
    if (email) {
      try {
        const inviterName = role === 'owner'
          ? String(user.user_metadata?.full_name ?? '').trim().split(/\s+/)[0] || null
          : null;
        const tpl = gymInviteEmail({ gymName: gym.name, setupUrl: url, role: inviteRole, logoUrl: gym.logo_url, inviterName });
        await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text, replyTo: REPLY_TO, tag: 'gym-invite' });
        emailed = true;
      } catch (err) {
        console.error('create_invite: email failed:', err);
        emailError = 'Link created, but the email could not be sent — copy it instead.';
      }
    }

    await audit(adminClient, user.id, 'gym_staff_invited', partnerId, {
      by: role === 'admin' ? 'admin' : 'gym', role: inviteRole, email: email || null, emailed,
    });
    // The raw token exists only in this response and in the email.
    return json({ ok: true, id: row.id, url, token, expires_at: row.expires_at, emailed, email_error: emailError });
  }

  // ── revoke_invite ──────────────────────────────────────────────────────────
  if (body.action === 'revoke_invite') {
    const inviteId = String(body.invite_id ?? '');
    if (!UUID_RE.test(inviteId)) return json({ error: 'invite_id is required' }, 400);
    const { data: inv } = await adminClient
      .from('gym_staff_invites')
      .select('partner_id, role')
      .eq('id', inviteId)
      .maybeSingle();
    if (!inv) return json({ error: 'Invite not found' }, 404);
    const role = await roleAt(inv.partner_id);
    if (role !== 'admin' && role !== 'owner') return json({ error: 'Forbidden' }, 403);
    if (inv.role === 'owner' && role !== 'admin') return json({ error: 'Forbidden' }, 403);

    const { error: revErr } = await adminClient
      .from('gym_staff_invites')
      .update({ status: 'revoked' })
      .eq('id', inviteId)
      .eq('status', 'invited');
    if (revErr) return json({ error: revErr.message }, 400);
    await audit(adminClient, user.id, 'gym_staff_invite_revoked', inv.partner_id, { by: role === 'admin' ? 'admin' : 'gym' });
    return json({ ok: true });
  }

  // ── list ───────────────────────────────────────────────────────────────────
  if (body.action === 'list') {
    const partnerId = String(body.partner_id ?? '');
    if (!UUID_RE.test(partnerId)) return json({ error: 'partner_id is required' }, 400);
    const role = await roleAt(partnerId);
    if (!role) return json({ error: 'Forbidden' }, 403);

    const [{ data: rows, error: listErr }, { data: invites }] = await Promise.all([
      adminClient
        .from('gym_staff')
        .select('user_id, role, created_at')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: true }),
      adminClient
        .from('gym_staff_invites')
        .select('id, role, email, created_at, expires_at')
        .eq('partner_id', partnerId)
        .eq('status', 'invited')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
    ]);
    if (listErr) return json({ error: listErr.message }, 400);

    const ids = (rows ?? []).map((r) => r.user_id);
    const { data: profiles } = ids.length
      ? await adminClient.from('profiles').select('id, display_name, username, avatar_url').in('id', ids)
      : { data: [] };
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

    const team = await Promise.all((rows ?? []).map(async (r) => {
      const { data } = await adminClient.auth.admin.getUserById(r.user_id);
      const p = byId.get(r.user_id);
      return {
        user_id: r.user_id,
        role: r.role,
        added_at: r.created_at,
        email: data?.user?.email ?? null,
        name: p?.display_name || data?.user?.user_metadata?.full_name || null,
        username: p?.username ?? null,
        avatar_url: p?.avatar_url ?? null,
        last_sign_in: data?.user?.last_sign_in_at ?? null,
      };
    }));

    // Staff see who's on the team; managing it (and the open links) is the owner's.
    const canManage = role === 'admin' || role === 'owner';
    return json({
      ok: true,
      role,
      can_manage: canManage,
      team,
      invites: canManage
        ? (invites ?? []).filter((i) => role === 'admin' || i.role === 'staff')
        : [],
    });
  }

  // ── remove ─────────────────────────────────────────────────────────────────
  if (body.action === 'remove') {
    const partnerId = String(body.partner_id ?? '');
    const targetId = String(body.user_id ?? '');
    if (!UUID_RE.test(partnerId) || !UUID_RE.test(targetId)) return json({ error: 'partner_id and user_id are required' }, 400);
    const role = await roleAt(partnerId);
    if (role !== 'admin' && role !== 'owner') return json({ error: 'Forbidden' }, 403);

    const { data: target } = await adminClient
      .from('gym_staff')
      .select('role')
      .eq('partner_id', partnerId)
      .eq('user_id', targetId)
      .maybeSingle();
    if (!target) return json({ error: 'Not on this gym’s team' }, 404);
    if (target.role === 'owner' && role !== 'admin') return json({ error: 'Only POWR can remove an owner' }, 403);
    if (target.role === 'owner') {
      const { count } = await adminClient
        .from('gym_staff')
        .select('user_id', { count: 'exact', head: true })
        .eq('partner_id', partnerId)
        .eq('role', 'owner');
      if ((count ?? 0) <= 1) return json({ error: 'A gym always keeps one owner — add the new owner first' }, 400);
    }

    const { error: removeErr } = await adminClient
      .from('gym_staff')
      .delete()
      .eq('partner_id', partnerId)
      .eq('user_id', targetId);
    if (removeErr) return json({ error: removeErr.message }, 400);
    await audit(adminClient, user.id, 'gym_staff_removed', partnerId, {
      by: role === 'admin' ? 'admin' : 'gym', user_id: targetId, role: target.role,
    });
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});

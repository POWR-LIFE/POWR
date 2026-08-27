import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Creator portal account management. Mirrors manage-partner-user, because the
 * brand portal's invite lifecycle is proven and there is no reason to invent a
 * second one.
 *
 * PUBLIC actions (no auth — the invite token IS the credential):
 *   validate_invite { token }
 *   redeem_invite   { token, email, password, contact_name? }
 *
 * ADMIN actions (require an admin_roles row):
 *   create_creator / update_creator / create_invite / revoke_invite / list / remove
 *
 * Why admin writes live HERE rather than in the client: the migration grants
 * `authenticated` UPDATE on only (display_name, avatar_url, bio, shipping_*)
 * of `creators`. An RLS policy cannot restrict columns, so without that grant a
 * creator could set their own payout rate or un-pause themselves. Admins are
 * also the `authenticated` role, so they are caught by the same fence — by
 * design. The service-role client below is the intended way through it.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
// Must stay in step with the creators.code CHECK and, more importantly, with
// AuthContext's /[?&]ref=([A-Z0-9]{6,10})/i deep-link capture. A code outside
// this range is silently dropped by every already-shipped client.
const CODE_RE = /^[A-Z0-9]{6,10}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const creatorCard = (c: Record<string, unknown>) => ({
    id: c.id,
    handle: c.handle,
    display_name: c.display_name,
    avatar_url: c.avatar_url,
  });

  // ════════════════════════════════════════════════════════════════════════
  // PUBLIC: setup-link validation + redemption
  // ════════════════════════════════════════════════════════════════════════

  if (body.action === "validate_invite") {
    const { token } = body;
    if (!token) return json({ ok: false, reason: "invalid" });

    const { data: inv } = await adminClient
      .from("creator_invites")
      .select("status, creator_id, creators(id, handle, display_name, avatar_url)")
      .eq("invite_token", token)
      .single();

    if (!inv) return json({ ok: false, reason: "invalid" });
    if (inv.status !== "invited") {
      return json({ ok: false, reason: inv.status === "used" ? "used" : "invalid" });
    }

    return json({ ok: true, creator: inv.creators ? creatorCard(inv.creators) : null });
  }

  if (body.action === "redeem_invite") {
    const { token, email, password, contact_name } = body;
    if (!token) return json({ ok: false, reason: "invalid" });

    const cleanEmail = String(email ?? "").toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return json({ error: "Enter a valid email address" }, 400);
    }
    if (String(password ?? "").length < 8) {
      return json({ error: "Password must be at least 8 characters" }, 400);
    }

    const { data: inv } = await adminClient
      .from("creator_invites")
      .select("id, creator_id, status")
      .eq("invite_token", token)
      .single();

    if (!inv) return json({ ok: false, reason: "invalid" });
    if (inv.status !== "invited") {
      return json({ ok: false, reason: inv.status === "used" ? "used" : "invalid" });
    }

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: contact_name?.trim() || "" },
    });
    if (createErr) {
      const msg = /already.*(registered|exists)/i.test(createErr.message)
        ? "An account with this email already exists. Contact POWR to link it to your affiliate profile."
        : createErr.message;
      return json({ error: msg }, 400);
    }

    const userId = created.user.id;

    const { error: linkErr } = await adminClient
      .from("creator_users")
      .upsert({ user_id: userId, creator_id: inv.creator_id }, { onConflict: "user_id" });

    if (linkErr) {
      // Roll back the orphaned auth user so the invite can be retried cleanly.
      await adminClient.auth.admin.deleteUser(userId);
      return json({ error: linkErr.message }, 400);
    }

    await adminClient
      .from("creator_invites")
      .update({ status: "used", used_at: new Date().toISOString(), used_by: userId })
      .eq("id", inv.id);

    return json({ ok: true });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ADMIN ONLY below this line
  // ════════════════════════════════════════════════════════════════════════

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: adminRow } = await adminClient
    .from("admin_roles")
    .select("user_id")
    .eq("user_id", user.id)
    .single();

  // Invite-only means there is no self-serve path in here at all. Unlike the
  // brand portal, a creator has nothing to administer — not even their own
  // invites — so this is a flat admin gate rather than admin-or-own-brand.
  if (!adminRow) return json({ error: "Forbidden" }, 403);

  const siteUrl = Deno.env.get("SITE_URL") ?? "https://powr.life";

  // ── create_creator ────────────────────────────────────────────────────────
  if (body.action === "create_creator") {
    const handle = String(body.handle ?? "").trim().toLowerCase();
    let code = String(body.code ?? "").trim().toUpperCase();
    const displayName = String(body.display_name ?? "").trim();
    const memberUserId = body.member_user_id || null;

    // Creators are app users first (Jamie, 2026-08-25). Their share code IS
    // their POWR ID, so with no explicit vanity code we reuse it — one code
    // per person, exactly as the POWR ID rule wants.
    if (!code && memberUserId) {
      const { data: prof } = await adminClient
        .from("profiles").select("referral_code").eq("id", memberUserId).maybeSingle();
      code = String(prof?.referral_code ?? "").toUpperCase();
    }

    if (!HANDLE_RE.test(handle)) {
      return json({ error: "Handle must be 2–30 chars: lowercase letters, numbers or hyphens, starting with a letter or number." }, 400);
    }
    if (!CODE_RE.test(code)) {
      return json({ error: "Code must be 6–10 characters, A–Z and 0–9 only. Shorter codes are silently dropped by already-installed apps." }, 400);
    }
    if (!displayName) return json({ error: "Display name is required" }, 400);

    // A code that collides with ANOTHER member's POWR ID would be resolved as
    // the creator (alias wins) and quietly steal that member's invites. Their
    // OWN POWR ID is fine — that's the default.
    const { data: clash } = await adminClient
      .from("profiles")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle();
    if (clash && clash.id !== memberUserId) {
      return json({ error: `${code} is already another member's POWR ID. Pick a different code.` }, 400);
    }

    const { data: creator, error } = await adminClient
      .from("creators")
      .insert({
        handle,
        code,
        display_name: displayName,
        avatar_url: body.avatar_url || null,
        bio: body.bio || null,
        member_user_id: memberUserId,
        program_id: body.program_id || null,
        conversion_points: body.conversion_points ?? null,
        created_by: user.id,
        notes: body.notes || null,
      })
      .select()
      .single();

    if (error) {
      const msg = /creators_handle_key/.test(error.message)
        ? `The handle "${handle}" is taken.`
        : /creators_code_key/.test(error.message)
        ? `The code ${code} is taken.`
        : error.message;
      return json({ error: msg }, 400);
    }

    // An app user gets portal access with the login they already have — no
    // setup link needed. Best-effort: a failure here leaves the creator
    // created and the admin can still mint a link.
    if (memberUserId) {
      const { error: linkErr } = await adminClient
        .from("creator_users")
        .upsert({ user_id: memberUserId, creator_id: creator.id }, { onConflict: "user_id" });
      if (linkErr) console.error("create_creator: portal link failed", linkErr);
    }

    return json({ ok: true, creator, portal_linked: !!memberUserId });
  }

  // ── update_creator ────────────────────────────────────────────────────────
  if (body.action === "update_creator") {
    const { creator_id } = body;
    if (!creator_id) return json({ error: "creator_id is required" }, 400);

    const patch: Record<string, unknown> = {};
    if (body.display_name !== undefined) patch.display_name = String(body.display_name).trim();
    if (body.avatar_url !== undefined) patch.avatar_url = body.avatar_url || null;
    if (body.bio !== undefined) patch.bio = body.bio || null;
    if (body.notes !== undefined) patch.notes = body.notes || null;
    if (body.member_user_id !== undefined) patch.member_user_id = body.member_user_id || null;
    // Which rule set applies. Null = the Default programme.
    if (body.program_id !== undefined) patch.program_id = body.program_id || null;
    if (body.conversion_points !== undefined) {
      patch.conversion_points = body.conversion_points === null || body.conversion_points === ""
        ? null
        : Number(body.conversion_points);
    }

    if (body.status !== undefined) {
      if (!["active", "paused", "terminated"].includes(body.status)) {
        return json({ error: "Invalid status" }, 400);
      }
      patch.status = body.status;
      patch.paused_at = body.status === "active" ? null : new Date().toISOString();
    }

    if (body.code !== undefined) {
      const code = String(body.code).trim().toUpperCase();
      if (!CODE_RE.test(code)) {
        return json({ error: "Code must be 6–10 characters, A–Z and 0–9 only." }, 400);
      }
      const { data: clash } = await adminClient
        .from("profiles").select("id").eq("referral_code", code).maybeSingle();
      const { data: own } = await adminClient
        .from("creators").select("member_user_id").eq("id", creator_id).maybeSingle();
      if (clash && clash.id !== own?.member_user_id) {
        return json({ error: `${code} is already another member's POWR ID.` }, 400);
      }
      patch.code = code;
    }

    if (body.handle !== undefined) {
      const handle = String(body.handle).trim().toLowerCase();
      if (!HANDLE_RE.test(handle)) return json({ error: "Invalid handle" }, 400);
      patch.handle = handle;
    }

    if (Object.keys(patch).length === 0) return json({ error: "Nothing to update" }, 400);

    const { data: creator, error } = await adminClient
      .from("creators").update(patch).eq("id", creator_id).select().single();

    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, creator });
  }

  // ── create_invite — the link (/affiliate/setup/{token}) IS the credential ──
  if (body.action === "create_invite") {
    const { creator_id, email } = body;
    if (!creator_id) return json({ error: "creator_id is required" }, 400);

    const token = crypto.randomUUID();
    const { error } = await adminClient.from("creator_invites").insert({
      invite_token: token,
      creator_id,
      created_by: user.id,
      email: email || null,
    });
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, token, url: `${siteUrl}/affiliate/setup/${token}` });
  }

  // ── revoke_invite ─────────────────────────────────────────────────────────
  if (body.action === "revoke_invite") {
    const { invite_id } = body;
    if (!invite_id) return json({ error: "invite_id is required" }, 400);

    const { error } = await adminClient
      .from("creator_invites")
      .update({ status: "revoked" })
      .eq("id", invite_id)
      .eq("status", "invited");

    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (body.action === "list") {
    const { creator_id } = body;
    if (!creator_id) return json({ error: "creator_id is required" }, 400);

    const [{ data: links }, { data: invites }] = await Promise.all([
      adminClient.from("creator_users").select("user_id, created_at").eq("creator_id", creator_id),
      adminClient
        .from("creator_invites")
        .select("id, email, status, created_at, used_at")
        .eq("creator_id", creator_id)
        .order("created_at", { ascending: false }),
    ]);

    // Emails live in auth.users, which PostgREST can't join.
    const users = [];
    for (const link of links ?? []) {
      const { data: u } = await adminClient.auth.admin.getUserById(link.user_id);
      users.push({
        user_id: link.user_id,
        email: u?.user?.email ?? null,
        created_at: link.created_at,
      });
    }

    return json({ ok: true, users, invites: invites ?? [] });
  }

  // ── remove — unlinks portal access. The auth user is deliberately left
  // alone: they may be a POWR member too, and deleting the account would take
  // their workouts with it.
  if (body.action === "remove") {
    const { user_id } = body;
    if (!user_id) return json({ error: "user_id is required" }, 400);

    const { error } = await adminClient.from("creator_users").delete().eq("user_id", user_id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});

// Level-up email — fires when a member reaches a new level.
//
// Invoked by the notify_level_up_email() DB trigger (pg_net) whenever the
// Vault banks a level_up deposit, with { user_id, level, bonus, total_earned }.
// Security: verify_jwt=false (pg_net is not a Supabase user); access is gated
// by the x-resolve-token shared secret, validated via the verify_resolve_token
// RPC against Vault (same pattern as the other cron/trigger functions).
//
// Idempotent per (user, level): the level_up_email_log table dedupes, so
// re-fires (e.g. points reversed and re-earned across a threshold) can't
// double-send. Respects notification_preferences.email_level_up.
//
// Sample mode for design QA: { sample: true, only_email } renders representative
// data to that one address and touches nothing. It needs the resolve token like
// every other call — fire it from SQL with the vault subselect (see
// docs/email-previews.md); the anon key is public and never authorises a send.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/mailgun.ts";
import { levelUpEmail } from "../_shared/emails/level-up.ts";
import { levelDef, levelImageUrl, LEVELS, TIER_COLOR, TIER_LABEL } from "../_shared/levels.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sample = body?.sample === true;

  const token = req.headers.get("x-resolve-token") ?? "";
  let authed = false;
  if (token) {
    const { data: valid } = await admin.rpc("verify_resolve_token", { p_token: token });
    authed = valid === true;
  }
  if (!authed) return new Response("forbidden", { status: 403 });

  if (sample) {
    const onlyEmail = typeof body?.only_email === "string" ? (body.only_email as string) : null;
    if (!onlyEmail) {
      return new Response(JSON.stringify({ error: "only_email required for sample" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    const def = levelDef(6)!;
    const email = levelUpEmail({
      name: "Jamie Wright",
      level: def.level,
      levelName: def.name,
      tierLabel: TIER_LABEL[def.tier],
      tierColor: TIER_COLOR[def.tier],
      totalEarned: 7040,
      vaultBonus: 50,
      levelImageUrl: levelImageUrl(def.level),
      nextLevelName: "Iron Lungs",
      nextLevelAt: 10000,
    });
    await sendEmail({ to: onlyEmail, subject: email.subject, html: email.html, text: email.text, tag: "level-up-sample" });
    return new Response(JSON.stringify({ ok: true, mode: "sample", to: onlyEmail }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = typeof body?.user_id === "string" ? (body.user_id as string) : null;
  const level = Number.isInteger(body?.level) ? (body.level as number) : null;
  const bonus = Number.isInteger(body?.bonus) ? (body.bonus as number) : null;
  const totalEarned = Number.isInteger(body?.total_earned) ? (body.total_earned as number) : null;

  const def = level != null ? levelDef(level) : null;
  if (!userId || !def) {
    return new Response(JSON.stringify({ error: "user_id and a valid level are required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // Preference check — default opted-in when no row exists.
  const { data: prefs } = await admin
    .from("notification_preferences")
    .select("email_level_up")
    .eq("user_id", userId)
    .maybeSingle();
  if (prefs && prefs.email_level_up === false) {
    return new Response(JSON.stringify({ ok: true, skipped: "opted_out" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Dedupe — first writer wins; a conflict means this level was already emailed.
  const { data: claimed, error: claimErr } = await admin
    .from("level_up_email_log")
    .upsert({ user_id: userId, level }, { onConflict: "user_id,level", ignoreDuplicates: true })
    .select("level");
  if (claimErr) {
    console.error("level_up_email_log claim failed:", claimErr);
    return new Response(JSON.stringify({ error: "dedupe_failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  if (!claimed || claimed.length === 0) {
    return new Response(JSON.stringify({ ok: true, skipped: "already_sent" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  // profiles carries no email — auth is the source of truth for addresses.
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const email = authUser?.user?.email ?? null;
  if (!email) {
    return new Response(JSON.stringify({ ok: true, skipped: "no_email" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const next = LEVELS.find((l) => l.level === def.level + 1) ?? null;
  const { data: vaultAccess } = await admin.rpc("vault_has_access", { p_user: userId });
  const vaultVisible = vaultAccess === true;
  const rendered = levelUpEmail({
    name: profile?.display_name ?? null,
    level: def.level,
    levelName: def.name,
    tierLabel: TIER_LABEL[def.tier],
    tierColor: TIER_COLOR[def.tier],
    // The trigger sends the exact level basis; fall back to the threshold floor.
    totalEarned: totalEarned ?? def.xpMin,
    // The Vault is a gated rollout — never tell a member to "open the Vault" when
    // they have no Vault to open. The bonus still banks; it just isn't named here.
    vaultBonus: vaultVisible ? bonus : null,
    levelImageUrl: levelImageUrl(def.level),
    nextLevelName: next?.name ?? null,
    nextLevelAt: next?.xpMin ?? null,
  });

  try {
    await sendEmail({ to: email, subject: rendered.subject, html: rendered.html, text: rendered.text, tag: "level-up" });
  } catch (err) {
    // Free the dedupe slot so a retry can send.
    await admin.from("level_up_email_log").delete().eq("user_id", userId).eq("level", level);
    console.error(`level-up email send failed for ${userId} L${level}:`, err);
    return new Response(JSON.stringify({ error: "send_failed" }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, sent: true, level }), {
    headers: { "Content-Type": "application/json" },
  });
});

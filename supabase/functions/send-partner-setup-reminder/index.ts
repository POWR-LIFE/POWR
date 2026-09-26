// Partner setup reminder — daily sweep for brands that stalled after the
// invite / approval email.
//
// Invoked by pg_cron (partner-setup-reminder, daily 09:30 UTC). Who is due is
// decided in SQL (get_partner_setup_reminder_candidates: 5 days, one email per
// brand per stage). Two stages:
//   invite   — setup link never used → resend the SAME still-valid link
//   delivery — login exists, reward approved, no code route → point at the
//              Integration tab
// This function renders, claims the partner_setup_reminder_log slot, and sends.
//
// Security: verify_jwt=false; gated by x-resolve-token (verify_resolve_token).
//
// Modes (every one needs the token — fire previews from SQL with the vault
// subselect, see docs/email-previews.md):
//   {}                                          → real run
//   { dry_run: true }                           → who would get what, sends nothing
//   { sample: true, only_email, stage?: "invite"|"delivery" }
//                                               → representative renders to one address

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/mailgun.ts";
import { brandInviteEmail } from "../_shared/emails/brand-invite.ts";

const CONCURRENCY = 3;
const REPLY_TO = "support@powr.life";
const AFTER_DAYS = 5;

interface Candidate {
  brand_name: string;
  brand_key: string;
  stage: "invite" | "delivery";
  email: string;
  contact_name: string | null;
  invite_token: string | null;
  reward_title: string | null;
  logo_url: string | null;
  brand_color: string | null;
  days_since: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://powr.life";

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const token = req.headers.get("x-resolve-token") ?? "";
  let authed = false;
  if (token) {
    const { data: valid } = await admin.rpc("verify_resolve_token", { p_token: token });
    authed = valid === true;
  }
  if (!authed) return new Response("forbidden", { status: 403 });

  const render = (c: Candidate) =>
    brandInviteEmail({
      brandName: c.brand_name,
      setupUrl: c.stage === "invite" && c.invite_token
        ? `${siteUrl}/partner/setup/${c.invite_token}`
        : `${siteUrl}/partner/integration`,
      logoUrl: c.logo_url,
      brandColor: c.brand_color,
      contactName: c.contact_name,
      rewardTitle: c.reward_title,
      deliveryMethod: null,
      reminder: c.stage,
      daysSince: c.days_since,
    });

  if (body?.sample === true) {
    const onlyEmail = typeof body?.only_email === "string" ? (body.only_email as string) : null;
    if (!onlyEmail) return json({ error: "only_email required for sample" }, 400);
    const stages: Candidate["stage"][] = body?.stage === "invite" || body?.stage === "delivery"
      ? [body.stage as Candidate["stage"]]
      : ["invite", "delivery"];
    const sent: string[] = [];
    for (const stage of stages) {
      const email = render({
        brand_name: "Healthspan Elite",
        brand_key: "healthspan elite",
        stage,
        email: onlyEmail,
        contact_name: "Cara James",
        invite_token: "sample-token-not-valid",
        reward_title: "Fuel Up for 25% Less",
        logo_url: "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-submissions/logos/1789985967117-km17c8.png",
        brand_color: "#c6a13e",
        days_since: AFTER_DAYS,
      });
      await sendEmail({ to: onlyEmail, subject: `[${stage}] ${email.subject}`, html: email.html, text: email.text, replyTo: REPLY_TO, tag: "partner-setup-reminder-sample" });
      sent.push(stage);
    }
    return json({ ok: true, mode: "sample", to: onlyEmail, sent });
  }

  const { data, error } = await admin.rpc("get_partner_setup_reminder_candidates", { p_days: AFTER_DAYS });
  if (error) {
    console.error("send-partner-setup-reminder: candidates rpc error", error);
    return json({ error: "candidates_failed" }, 500);
  }
  const candidates = (data ?? []) as Candidate[];

  if (body?.dry_run === true) {
    return json({
      ok: true,
      mode: "dry_run",
      total: candidates.length,
      due: candidates.map((c) => ({ brand: c.brand_name, stage: c.stage, email: c.email, days_since: c.days_since, reward: c.reward_title })),
    });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    await Promise.all(candidates.slice(i, i + CONCURRENCY).map(async (c) => {
      // Claim first — a concurrent run conflicts here instead of double-sending.
      const { data: claimed, error: claimErr } = await admin
        .from("partner_setup_reminder_log")
        .upsert(
          { brand_key: c.brand_key, stage: c.stage, email: c.email },
          { onConflict: "brand_key,stage", ignoreDuplicates: true },
        )
        .select("stage");
      if (claimErr || !claimed?.length) {
        if (claimErr) console.error("send-partner-setup-reminder: claim failed for", c.brand_key, claimErr);
        skipped++;
        return;
      }

      const email = render(c);
      try {
        await sendEmail({ to: c.email, subject: email.subject, html: email.html, text: email.text, replyTo: REPLY_TO, tag: `partner-setup-reminder-${c.stage}` });
        sent++;
      } catch (e) {
        failed++;
        // Free the slot so tomorrow's run retries.
        await admin.from("partner_setup_reminder_log").delete()
          .eq("brand_key", c.brand_key).eq("stage", c.stage);
        console.error("send-partner-setup-reminder: send failed for", c.email, e);
      }
    }));
  }

  console.log(`send-partner-setup-reminder: sent=${sent} failed=${failed} skipped=${skipped} candidates=${candidates.length}`);
  return json({ ok: true, sent, failed, skipped });
});

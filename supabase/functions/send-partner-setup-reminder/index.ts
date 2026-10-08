// Partner setup reminder — a weekly email to every reward brand whose side of
// getting a reward live is unfinished.
//
// Invoked by pg_cron (partner-setup-reminder, daily 09:30 UTC). Who is due is
// decided in SQL (get_partner_setup_reminder_candidates): the first email 5
// days after the brand started waiting, then every 7 days, at most 8, and only
// while the brand's next step is its own:
//   login    — setup link never used → resend the SAME still-valid link
//   submit   — logged in, no approved reward → Rewards
//   choose   — approved, no way for codes to reach members → Integration
//   connect  — way chosen, no code can reach a member yet → that route's page
// Each email goes to everyone on the brand's side (logins, invite addresses,
// submission contact). This function renders, claims the brand's next
// partner_setup_reminder_log slot, and sends.
//
// Security: verify_jwt=false; gated by x-resolve-token (verify_resolve_token).
//
// Modes (every one needs the token — fire previews from SQL with the vault
// subselect, see docs/email-previews.md):
//   {}                                  → real run
//   { brand: "Healthspan Elite" }       → real run for that brand only, and
//                                         only if it is due today
//   { dry_run: true }                   → who would get what, sends nothing
//   { sample: true, only_email, step?: "login"|"submit"|"choose"|"connect" }
//                                       → representative renders to one address

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/mailgun.ts";
import {
  type DeliveryMethod,
  partnerSetupReminderEmail,
  type SetupStep,
} from "../_shared/emails/partner-setup-reminder.ts";

const CONCURRENCY = 3;
const REPLY_TO = "support@powr.life";
const FIRST_AFTER_DAYS = 5;
const EVERY_DAYS = 7;
const MAX_REMINDERS = 8;
const STEPS: SetupStep[] = ["login", "submit", "choose", "connect"];

interface Candidate {
  brand_name: string;
  brand_key: string;
  step: SetupStep;
  recipients: string[];
  login_emails: string[];
  contact_name: string | null;
  invite_token: string | null;
  reward_title: string | null;
  logo_url: string | null;
  brand_color: string | null;
  method: DeliveryMethod | null;
  draft_title: string | null;
  draft_is_edit: boolean | null;
  waiting_since: string;
  reminder_number: number;
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
    partnerSetupReminderEmail({
      brandName: c.brand_name,
      step: c.step,
      contactName: c.contact_name,
      rewardTitle: c.reward_title,
      logoUrl: c.logo_url,
      brandColor: c.brand_color,
      method: c.method,
      inviteToken: c.invite_token,
      loginEmails: c.login_emails,
      draftTitle: c.draft_title,
      draftIsEdit: c.draft_is_edit,
      siteUrl,
    });

  if (body?.sample === true) {
    const onlyEmail = typeof body?.only_email === "string" ? (body.only_email as string) : null;
    if (!onlyEmail) return json({ error: "only_email required for sample" }, 400);
    const steps = STEPS.includes(body?.step as SetupStep) ? [body.step as SetupStep] : STEPS;
    const sent: string[] = [];
    for (const step of steps) {
      const email = render({
        brand_name: "Healthspan Elite",
        brand_key: "healthspan elite",
        step,
        recipients: [onlyEmail],
        login_emails: step === "login" ? [] : ["healthspandigital@gmail.com"],
        contact_name: "Cara James",
        invite_token: "sample-token-not-valid",
        reward_title: step === "submit" ? null : "Fuel Up for 25% Less",
        logo_url: "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-submissions/logos/1789985967117-km17c8.png",
        brand_color: "#c6a13e",
        method: step === "connect" ? "manual" : null,
        draft_title: "Fuel Up for 25% Less",
        draft_is_edit: step !== "submit",
        waiting_since: new Date().toISOString(),
        reminder_number: 1,
      });
      await sendEmail({ to: onlyEmail, subject: `[${step}] ${email.subject}`, html: email.html, text: email.text, replyTo: REPLY_TO, tag: "partner-setup-reminder-sample" });
      sent.push(step);
    }
    return json({ ok: true, mode: "sample", to: onlyEmail, sent });
  }

  const { data, error } = await admin.rpc("get_partner_setup_reminder_candidates", {
    p_first_after_days: FIRST_AFTER_DAYS,
    p_every_days: EVERY_DAYS,
    p_max: MAX_REMINDERS,
  });
  if (error) {
    console.error("send-partner-setup-reminder: candidates rpc error", error);
    return json({ error: "candidates_failed" }, 500);
  }
  const onlyBrand = typeof body?.brand === "string" ? body.brand.trim().toLowerCase() : null;
  const candidates = ((data ?? []) as Candidate[])
    .filter((c) => c.recipients?.length && (!onlyBrand || c.brand_key === onlyBrand));

  if (body?.dry_run === true) {
    return json({
      ok: true,
      mode: "dry_run",
      total: candidates.length,
      due: candidates.map((c) => ({
        brand: c.brand_name,
        step: c.step,
        to: c.recipients,
        reminder: c.reminder_number,
        waiting_since: c.waiting_since,
        reward: c.reward_title,
        subject: render(c).subject,
      })),
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
          { brand_key: c.brand_key, seq: c.reminder_number, stage: c.step, email: c.recipients[0], recipients: c.recipients },
          { onConflict: "brand_key,seq", ignoreDuplicates: true },
        )
        .select("seq");
      if (claimErr || !claimed?.length) {
        if (claimErr) console.error("send-partner-setup-reminder: claim failed for", c.brand_key, claimErr);
        skipped++;
        return;
      }

      const email = render(c);
      try {
        // One email to the brand's whole side, so they can see who else has it.
        await sendEmail({ to: c.recipients.join(", "), subject: email.subject, html: email.html, text: email.text, replyTo: REPLY_TO, tag: `partner-setup-reminder-${c.step}` });
        sent++;
      } catch (e) {
        failed++;
        // Free the slot so tomorrow's run retries.
        await admin.from("partner_setup_reminder_log").delete()
          .eq("brand_key", c.brand_key).eq("seq", c.reminder_number);
        console.error("send-partner-setup-reminder: send failed for", c.brand_key, e);
      }
    }));
  }

  console.log(`send-partner-setup-reminder: sent=${sent} failed=${failed} skipped=${skipped} candidates=${candidates.length}`);
  return json({ ok: true, sent, failed, skipped });
});

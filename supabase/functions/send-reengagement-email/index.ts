// Re-engagement email — daily sweep for members who have gone quiet.
//
// Invoked by pg_cron (reengagement-email, daily 09:00 UTC). Who is due what is
// decided in SQL (get_reengagement_candidates: lapsed 7/21 days, never started
// 3/14 days, 7-day minimum gap, email_inactivity_nudge respected). This
// function renders, claims the reengagement_email_log slot, and sends.
//
// Security: verify_jwt=false; gated by x-resolve-token (verify_resolve_token).
//
// Modes (every one needs the token — fire previews from SQL with the vault
// subselect, see docs/email-previews.md):
//   {}                                  → real run
//   { dry_run: true }                   → who would get what, sends nothing
//   { sample: true, only_email, variant?: "lapsed"|"never_started"|"all", stage?: 1|2 }
//                                       → representative renders to one address

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/mailgun.ts";
import { reEngagementEmail, type ReEngagementData } from "../_shared/emails/re-engagement.ts";
import type { WeeklyRewardTile } from "../_shared/emails/weekly-summary.ts";
import { loadRewardCatalogue, rewardsReadyFor } from "../_shared/reward-catalogue.ts";
import { wearableLabel } from "../_shared/wearable-label.ts";

const CONCURRENCY = 5;

interface Candidate {
  user_id: string;
  email: string;
  display_name: string | null;
  variant: "lapsed" | "never_started";
  stage: 1 | 2;
  lapse_anchor: string;
  days_away: number;
  balance: number;
  lifetime_earned: number;
  location_granted: boolean;
  wearable: string | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

  const { byCost } = await loadRewardCatalogue(admin);
  const closestFor = (bal: number): WeeklyRewardTile | null => byCost.find((r) => r.cost > bal) ?? null;

  if (sample) {
    const onlyEmail = typeof body?.only_email === "string" ? (body.only_email as string) : null;
    if (!onlyEmail) return json({ error: "only_email required for sample" }, 400);
    const which = body?.variant === "lapsed" || body?.variant === "never_started" ? [body.variant as string] : ["lapsed", "never_started"];
    const stages = body?.stage === 1 || body?.stage === 2 ? [body.stage as 1 | 2] : [1, 2] as (1 | 2)[];
    const sent: string[] = [];
    for (const variant of which) {
      for (const stage of stages) {
        const lapsed = variant === "lapsed";
        const balance = lapsed ? 611 : 40;
        const data: ReEngagementData = {
          name: "Jamie Wright",
          variant: variant as ReEngagementData["variant"],
          stage,
          daysAway: lapsed ? (stage === 1 ? 8 : 23) : (stage === 1 ? 3 : 14),
          balance,
          lifetimeEarned: lapsed ? 1840 : 40,
          rewardsReady: rewardsReadyFor(byCost, balance),
          closestReward: closestFor(balance),
          locationGranted: lapsed,
          wearable: lapsed ? "Whoop" : null,
        };
        const email = reEngagementEmail(data);
        await sendEmail({ to: onlyEmail, subject: `[${variant} ${stage}] ${email.subject}`, html: email.html, text: email.text, tag: "reengagement-sample" });
        sent.push(`${variant}:${stage}`);
      }
    }
    return json({ ok: true, mode: "sample", to: onlyEmail, sent });
  }

  const { data, error } = await admin.rpc("get_reengagement_candidates");
  if (error) {
    console.error("send-reengagement-email: candidates rpc error", error);
    return json({ error: "candidates_failed" }, 500);
  }
  const candidates = (data ?? []) as Candidate[];

  if (body?.dry_run === true) {
    return json({
      ok: true,
      mode: "dry_run",
      total: candidates.length,
      by: candidates.reduce<Record<string, number>>((acc, c) => {
        const k = `${c.variant}:${c.stage}`;
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    await Promise.all(candidates.slice(i, i + CONCURRENCY).map(async (c) => {
      // Claim first — a concurrent run conflicts here instead of double-sending.
      const { data: claimed, error: claimErr } = await admin
        .from("reengagement_email_log")
        .upsert(
          { user_id: c.user_id, lapse_anchor: c.lapse_anchor, stage: c.stage, variant: c.variant },
          { onConflict: "user_id,lapse_anchor,stage", ignoreDuplicates: true },
        )
        .select("stage");
      if (claimErr || !claimed?.length) {
        if (claimErr) console.error("send-reengagement-email: claim failed for", c.user_id, claimErr);
        skipped++;
        return;
      }

      const email = reEngagementEmail({
        name: c.display_name,
        variant: c.variant,
        stage: c.stage,
        daysAway: c.days_away,
        balance: c.balance,
        lifetimeEarned: c.lifetime_earned,
        rewardsReady: rewardsReadyFor(byCost, c.balance),
        closestReward: closestFor(c.balance),
        locationGranted: c.location_granted,
        wearable: wearableLabel(c.wearable),
      });
      try {
        await sendEmail({ to: c.email, subject: email.subject, html: email.html, text: email.text, tag: `reengagement-${c.variant}-${c.stage}` });
        sent++;
      } catch (e) {
        failed++;
        // Free the slot so tomorrow's run retries.
        await admin.from("reengagement_email_log").delete()
          .eq("user_id", c.user_id).eq("lapse_anchor", c.lapse_anchor).eq("stage", c.stage);
        console.error("send-reengagement-email: send failed for", c.email, e);
      }
    }));
  }

  console.log(`send-reengagement-email: sent=${sent} failed=${failed} skipped=${skipped} candidates=${candidates.length}`);
  return json({ ok: true, sent, failed, skipped });
});

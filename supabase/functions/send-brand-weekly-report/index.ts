// Weekly brand report — sends every reward-brand portal user a Monday-morning
// digest of their brand's week: redemptions (with week-over-week), POWR spent,
// live rewards, most-redeemed list, low code stock and pending submissions.
//
// Triggered by the `brand-weekly-report-email` pg_cron job every Monday
// 09:00 UTC. The function resolves the completed Mon–Sun window, calls
// get_brand_weekly_report() for per-portal-user aggregates, then renders the
// partner weekly summary template and sends.
//
// Security: verify_jwt=false (pg_net is not a Supabase user); access is gated
// by the x-resolve-token shared secret, validated via the verify_resolve_token
// RPC against Vault (same pattern as the other cron functions).
//
// Operational body params (all optional):
//   { dry_run, only_email, deliver_to, week_start, limit, sample }
//   - deliver_to redirects delivery and is honoured only alongside only_email,
//     so a full run can never be re-routed to a single inbox by accident.
//   - sample renders representative data to only_email (anon-key Bearer allowed).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/mailgun.ts";
import {
  partnerWeeklySummaryEmail,
  type PartnerWeeklySummaryData,
} from "../_shared/emails/partner-weekly-summary.ts";

const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const REPLY_TO = "support@powr.life";
const DAY_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 5;

/** Most recent Monday 00:00 UTC. */
function mostRecentMondayUTC(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

/** "9–15 Jun" or "30 Jun – 6 Jul" for the [since, untilExclusive) window. */
function formatWeekLabel(since: Date, untilExclusive: Date): string {
  const end = new Date(untilExclusive.getTime() - DAY_MS);
  const mon = (dt: Date) => dt.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const ds = since.getUTCDate();
  const de = end.getUTCDate();
  return mon(since) === mon(end)
    ? `${ds}–${de} ${mon(end)}`
    : `${ds} ${mon(since)} – ${de} ${mon(end)}`;
}

interface BrandReportRow {
  brand_name: string;
  portal_email: string;
  redemptions: number;
  prev_redemptions: number;
  powr_spent: number;
  live_rewards: number;
  top_rewards: { title: string; count: number; value_label: string | null }[] | null;
  low_stock: { title: string; remaining: number }[] | null;
  pending_submissions: number;
}

function rowToEmailData(row: BrandReportRow, weekLabel: string): PartnerWeeklySummaryData {
  return {
    brandName: row.brand_name,
    weekLabel,
    redemptions: row.redemptions,
    prevRedemptions: row.prev_redemptions,
    powrSpent: row.powr_spent,
    liveRewards: row.live_rewards,
    topRewards: (row.top_rewards ?? []).map((r) => ({
      title: r.title,
      count: r.count,
      valueLabel: r.value_label,
    })),
    lowStock: row.low_stock ?? [],
    pendingSubmissions: row.pending_submissions,
  };
}

/** Sample data for design QA (send to a single address via `sample: true`). */
function sampleData(weekLabel: string): PartnerWeeklySummaryData {
  return {
    brandName: "Forge Athletics",
    weekLabel,
    redemptions: 23,
    prevRedemptions: 17,
    powrSpent: 9660,
    liveRewards: 4,
    topRewards: [
      { title: "20% off everything", count: 12, valueLabel: "20% OFF" },
      { title: "Free shaker with any order", count: 8, valueLabel: "FREE GIFT" },
      { title: "£15 off orders over £60", count: 3, valueLabel: "£15 OFF" },
    ],
    lowStock: [{ title: "Free shaker with any order", remaining: 9 }],
    pendingSubmissions: 1,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body?.dry_run === true;
  const sample = body?.sample === true;

  const token = req.headers.get("x-resolve-token") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let authed = false;
  if (token) {
    const { data: valid } = await admin.rpc("verify_resolve_token", { p_token: token });
    authed = valid === true;
  }
  // Anon key is public — safe as a bypass for sample-only sends to an explicit address.
  if (!authed && sample && ANON_KEY && bearer === ANON_KEY) authed = true;
  if (!authed) return new Response("forbidden", { status: 403 });

  const onlyEmail = typeof body?.only_email === "string" ? (body.only_email as string).toLowerCase() : null;
  const limit = Number.isInteger(body?.limit) ? (body.limit as number) : null;
  const deliverTo = onlyEmail && typeof body?.deliver_to === "string" ? (body.deliver_to as string) : null;
  const weekStart = typeof body?.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.week_start)
    ? (body.week_start as string)
    : null;

  const now = new Date();
  const since = weekStart
    ? new Date(`${weekStart}T00:00:00Z`)
    : new Date(mostRecentMondayUTC(now).getTime() - 7 * DAY_MS);
  const until = new Date(since.getTime() + 7 * DAY_MS);
  const prevSince = new Date(since.getTime() - 7 * DAY_MS);
  const weekLabel = formatWeekLabel(since, until);

  if (sample) {
    if (!onlyEmail) {
      return new Response(JSON.stringify({ error: "only_email required for sample" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    const rendered = partnerWeeklySummaryEmail(sampleData(weekLabel));
    if (!dryRun) {
      await sendEmail({ to: onlyEmail, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo: REPLY_TO });
    }
    return new Response(JSON.stringify({ sent: dryRun ? 0 : 1, dry_run: dryRun, mode: "sample", to: onlyEmail }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: rows, error: rpcErr } = await admin.rpc("get_brand_weekly_report", {
    p_since: since.toISOString(),
    p_until: until.toISOString(),
    p_prev_since: prevSince.toISOString(),
  }) as { data: BrandReportRow[] | null; error: unknown };

  if (rpcErr) {
    console.error("get_brand_weekly_report error:", rpcErr);
    return new Response(JSON.stringify({ error: "rpc_failed", detail: String(rpcErr) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  let recipients = rows ?? [];
  if (onlyEmail) recipients = recipients.filter((r) => r.portal_email.toLowerCase() === onlyEmail);
  if (limit !== null) recipients = recipients.slice(0, limit);

  const results: { email: string; brand: string; ok: boolean; error?: string }[] = [];
  let sent = 0;

  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    const batch = recipients.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        const to = deliverTo ?? row.portal_email;
        const rendered = partnerWeeklySummaryEmail(rowToEmailData(row, weekLabel));
        try {
          if (!dryRun) {
            await sendEmail({ to, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo: REPLY_TO });
          }
          results.push({ email: to, brand: row.brand_name, ok: true });
          sent++;
        } catch (err) {
          console.error(`Failed to send brand weekly report to ${to} (${row.brand_name}):`, err);
          results.push({ email: to, brand: row.brand_name, ok: false, error: String(err) });
        }
      }),
    );
  }

  return new Response(
    JSON.stringify({ week: weekLabel, total_recipients: recipients.length, sent, dry_run: dryRun, results }),
    { headers: { "Content-Type": "application/json" } },
  );
});

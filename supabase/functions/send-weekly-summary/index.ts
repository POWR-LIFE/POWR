// Weekly summary email — sends each active user a recap of the week just gone.
//
// Triggered by a pg_cron job (migration 20260618000001) every Monday 08:00 UTC,
// which POSTs here with the x-weekly-token shared secret. The function resolves
// the completed Mon–Sun window, asks get_weekly_summary_recipients() for every
// eligible/active user's aggregates in one query, then renders and sends.
//
// Security: verify_jwt=false (pg_net is not a Supabase user); access is gated by
// the x-weekly-token shared secret, which lives only in the cron job definition
// and here — mirroring the terra-poll pattern.
//
// Operational body params (all optional): { dry_run, only_email, limit } — for
// safe manual runs and previews.
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../_shared/mailgun.ts";
import { weeklySummaryEmail, type WeeklySummaryData } from "../_shared/emails/weekly-summary.ts";

const WEEKLY_TOKEN = "77f969448b906d79a482dfe7777513e6da50c321b938eb3b";
const DAY_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 5;

/** Most recent Monday 00:00 UTC (start of the current week / exclusive end of last). */
function mostRecentMondayUTC(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0
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

interface RecipientRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  referral_code: string | null;
  points: number;
  prev_points: number;
  workouts: number;
  active_days: number;
  distance_m: number;
  steps: number;
  top_type: string | null;
  top_count: number;
  current_streak: number;
  weekly_rank: number | null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (req.headers.get("x-weekly-token") !== WEEKLY_TOKEN) {
    return new Response("forbidden", { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body?.dry_run === true;
  const onlyEmail = typeof body?.only_email === "string" ? (body.only_email as string).toLowerCase() : null;
  const limit = Number.isInteger(body?.limit) ? (body.limit as number) : null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const until = mostRecentMondayUTC(now);
  const since = new Date(until.getTime() - 7 * DAY_MS);
  const prevSince = new Date(since.getTime() - 7 * DAY_MS);
  const weekLabel = formatWeekLabel(since, until);

  const { data, error } = await supabase.rpc("get_weekly_summary_recipients", {
    p_since: since.toISOString(),
    p_until: until.toISOString(),
    p_prev_since: prevSince.toISOString(),
  });
  if (error) {
    console.error("send-weekly-summary: rpc error", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let recipients = (data ?? []) as RecipientRow[];
  if (onlyEmail) recipients = recipients.filter((r) => (r.email ?? "").toLowerCase() === onlyEmail);
  if (limit !== null) recipients = recipients.slice(0, limit);

  if (dryRun) {
    return new Response(
      JSON.stringify({
        ok: true,
        week: weekLabel,
        recipients: recipients.length,
        sample: recipients.slice(0, 3).map((r) => ({ email: r.email, points: r.points, workouts: r.workouts })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    const batch = recipients.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (r) => {
        if (!r.email) return;
        const payload: WeeklySummaryData = {
          name: r.display_name,
          weekLabel,
          pointsThisWeek: r.points ?? 0,
          pointsLastWeek: r.prev_points ?? 0,
          workouts: r.workouts ?? 0,
          activeDays: r.active_days ?? 0,
          currentStreak: r.current_streak ?? 0,
          topActivity: r.top_type ? { type: r.top_type, count: r.top_count ?? 0 } : null,
          distanceKm: r.distance_m ? Math.round((r.distance_m / 1000) * 10) / 10 : null,
          steps: r.steps && r.steps > 0 ? r.steps : null,
          weeklyRank: r.weekly_rank,
          referralCode: r.referral_code,
        };
        const email = weeklySummaryEmail(payload);
        try {
          await sendEmail({ to: r.email, subject: email.subject, html: email.html, text: email.text });
          sent++;
        } catch (e) {
          failed++;
          console.error("send-weekly-summary: send failed for", r.email, e);
        }
      }),
    );
  }

  return new Response(JSON.stringify({ ok: true, week: weekLabel, sent, failed }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

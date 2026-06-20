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
import { weeklySummaryEmail, type WeeklyActivityStat, type WeeklyRewardTile, type WeeklySummaryData } from "../_shared/emails/weekly-summary.ts";
import { getChallengeById } from "../_shared/challenges.ts";

// Health-provider / wearable slug → display label. Mirrors the connect screen.
const WEARABLE_LABELS: Record<string, string> = {
  "apple-health": "Apple Health",
  "health-connect": "Health Connect",
  "google-fit": "Google Fit",
  "samsung-health": "Samsung Health",
  whoop: "Whoop",
  garmin: "Garmin",
  fitbit: "Fitbit",
  oura: "Oura",
  strava: "Strava",
  polar: "Polar",
  coros: "Coros",
  suunto: "Suunto",
};

function wearableLabel(slug: string | null): string | null {
  if (!slug) return null;
  return WEARABLE_LABELS[slug.toLowerCase()] ?? slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Strip trailing zeros: 15.00 → "15", 12.50 → "12.5". */
function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(/\.?0+$/, "");
}

/** Reward discount badge, mirroring the app's RewardCard buildDiscountLabel. */
function discountLabel(
  r: { value_label?: string | null; discount_type?: string | null; discount_value?: number | string | null },
): string {
  const v = r.discount_value != null && r.discount_value !== "" ? Number(r.discount_value) : null;
  if (r.discount_type === "percentage" && v != null && !Number.isNaN(v)) return `${trimNum(v)}% OFF`;
  if (r.discount_type === "fixed_amount" && v != null && !Number.isNaN(v)) return `£${trimNum(v)} OFF`;
  return (r.value_label ?? "").trim();
}

/** Resolve completed challenge ids to their catalog titles (deduped, in order). */
function challengeTitles(ids: string[] | null): string[] {
  if (!ids?.length) return [];
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const title = getChallengeById(id)?.title;
    if (title) titles.push(title);
  }
  return titles;
}

// Shared secret gating the cron trigger (verify_jwt=false). Set as a function
// secret — `supabase secrets set WEEKLY_TOKEN=…` — and store the matching value
// in Vault (secret name 'weekly_token') so the cron job sends it. Never hardcode.
const WEEKLY_TOKEN = Deno.env.get("WEEKLY_TOKEN") ?? "";
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
  prev_steps: number;
  activities: WeeklyActivityStat[] | null;
  top_type: string | null;
  top_count: number;
  current_streak: number;
  weekly_rank: number | null;
  longest_sec: number | null;
  longest_type: string | null;
  longest_partner: string | null;
  gyms: { name: string; count: number }[] | null;
  wearable: string | null;
  challenges: number;
  challenge_ids: string[] | null;
  balance: number;
  reward_title: string | null;
  reward_brand: string | null;
  reward_cost: number | null;
  reward_image: string | null;
  reward_value: string | null;
}

/** Representative data for previewing the design via { sample: true }. */
function sampleWeeklyData(weekLabel: string): WeeklySummaryData {
  return {
    name: "Jamie",
    weekLabel,
    pointsThisWeek: 1240,
    pointsLastWeek: 980,
    workouts: 6,
    activeDays: 5,
    currentStreak: 12,
    topActivity: { type: "gym", count: 4 },
    distanceKm: 18.4,
    steps: 52340,
    prevSteps: 47100,
    activities: [
      { type: "gym", count: 4, prevCount: 2 },
      { type: "running", count: 2, prevCount: 3 },
      { type: "cycling", count: 1, prevCount: 1 },
      { type: "hiit", count: 1, prevCount: 0 },
    ],
    weeklyRank: 7,
    referralCode: "JAMIE20",
    longestSession: { type: "gym", durationSec: 4920, partner: "PureGym Holborn" },
    gyms: [
      { name: "PureGym Holborn", count: 3 },
      { name: "The Gym Group Old Street", count: 2 },
      { name: "F45 Shoreditch", count: 1 },
    ],
    wearable: "Whoop",
    challengesCompleted: 3,
    challengeTitles: ["No Days Off", "5 Days Active", "3km Run"],
    // Mid-tier balance so the preview shows the featured card with progress + sessions.
    balance: 250,
    topRewards: [
      { brand: "MATHAN", cost: 300, valueLabel: "£15 OFF", image: "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-submissions/logos/1780493633701-o9l9sp.png", hero: "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/heroes/1780820340343-3z0403.jpeg" },
      { brand: "Tribe", cost: 220, valueLabel: "50% OFF", image: "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/rewards/1776850967371-0q1bco.png", hero: "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/heroes/1780820340343-3z0403.jpeg" },
      { brand: "OMNITY", cost: 210, valueLabel: "20% OFF", image: "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/rewards/1781177374575-acu6oe.png", hero: "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/heroes/1780820340343-3z0403.jpeg" },
    ],
    closestReward: { brand: "MATHAN", title: "MATHAN", cost: 300, valueLabel: "£15 OFF", image: "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-submissions/logos/1780493633701-o9l9sp.png", hero: "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/reward-images/heroes/1780820340343-3z0403.jpeg" },
    upcomingRewards: [],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!WEEKLY_TOKEN || req.headers.get("x-weekly-token") !== WEEKLY_TOKEN) {
    return new Response("forbidden", { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body?.dry_run === true;
  const sample = body?.sample === true;
  const onlyEmail = typeof body?.only_email === "string" ? (body.only_email as string).toLowerCase() : null;
  const limit = Number.isInteger(body?.limit) ? (body.limit as number) : null;
  // Test/preview only: redirect delivery to one address. Honoured only alongside
  // only_email, so a real run can never be re-routed to a single inbox by accident.
  const deliverTo = onlyEmail && typeof body?.deliver_to === "string" ? (body.deliver_to as string) : null;
  // Optional window override (YYYY-MM-DD Monday) for backfills / targeted re-sends.
  // Defaults to the most recently completed Mon–Sun week (what the cron uses).
  const weekStart = typeof body?.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.week_start)
    ? (body.week_start as string)
    : null;

  const now = new Date();
  // since = Monday 00:00 of the target week; until is its exclusive Sunday-night end.
  const since = weekStart
    ? new Date(`${weekStart}T00:00:00Z`)
    : new Date(mostRecentMondayUTC(now).getTime() - 7 * DAY_MS);
  const until = new Date(since.getTime() + 7 * DAY_MS);
  const prevSince = new Date(since.getTime() - 7 * DAY_MS);
  const weekLabel = formatWeekLabel(since, until);

  // Sample preview: render the template with representative data and send to a
  // SINGLE address. Bypasses the recipient query entirely, so it can never reach
  // real users. Requires only_email so the target is always explicit.
  if (sample) {
    if (!onlyEmail) {
      return new Response(JSON.stringify({ error: "sample requires only_email" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const email = weeklySummaryEmail(sampleWeeklyData(weekLabel));
    try {
      await sendEmail({ to: onlyEmail, subject: email.subject, html: email.html, text: email.text });
      return new Response(JSON.stringify({ ok: true, sample: true, sent_to: onlyEmail }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      console.error("send-weekly-summary: sample send failed", e);
      return new Response(JSON.stringify({ ok: false, error: String(e) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Active rewards for the "rewards in reach" section. Fetched once and shared:
  // the top 3 (by value) are the same for everyone; the "closest reward" and the
  // low-balance ladder are derived per-user from their balance.
  const { data: rewardRows } = await supabase
    .from("rewards")
    .select("brand_name, title, powr_cost, image_url, hero_image_url, value_label, discount_type, discount_value, stock, expires_at")
    .eq("active", true)
    .gt("powr_cost", 0)
    .order("powr_cost", { ascending: true });
  const nowMs = Date.now();
  const allRewards: WeeklyRewardTile[] = (rewardRows ?? [])
    .filter((r) =>
      r.powr_cost != null &&
      (r.stock == null || r.stock > 0) &&
      (r.expires_at == null || new Date(r.expires_at).getTime() > nowMs)
    )
    .map((r) => ({
      brand: (r.brand_name ?? null) as string | null,
      title: (r.title ?? null) as string | null,
      cost: r.powr_cost as number,
      image: (r.image_url ?? r.hero_image_url ?? null) as string | null, // logo
      hero: (r.hero_image_url ?? r.image_url ?? null) as string | null,   // cover
      valueLabel: discountLabel(r),
    }));
  // Top 3 highest-value rewards, deduped by brand (the showcase logo tiles).
  const topRewards: WeeklyRewardTile[] = [];
  const seenTop = new Set<string>();
  for (const r of [...allRewards].sort((a, b) => b.cost - a.cost)) {
    const key = (r.brand ?? r.title ?? String(r.cost)).toLowerCase();
    if (seenTop.has(key)) continue;
    seenTop.add(key);
    topRewards.push(r);
    if (topRewards.length >= 3) break;
  }
  // Ascending, brand-deduped — for picking the closest reward / cheapest ladder.
  const dedupAsc: WeeklyRewardTile[] = [];
  const seenAsc = new Set<string>();
  for (const r of allRewards) {
    const key = (r.brand ?? r.title ?? String(r.cost)).toLowerCase();
    if (seenAsc.has(key)) continue;
    seenAsc.add(key);
    dedupAsc.push(r);
  }
  const cheapestCost = dedupAsc[0]?.cost ?? Infinity;
  // The single reward to feature: cheapest one above balance (next milestone),
  // or — if they can already afford everything — the most valuable one (claimable).
  const closestRewardFor = (bal: number): WeeklyRewardTile | null =>
    dedupAsc.find((r) => r.cost > bal) ?? dedupAsc[dedupAsc.length - 1] ?? null;
  // When the balance can't unlock anything yet, surface the 3 cheapest (low→high).
  const ladderFor = (bal: number): WeeklyRewardTile[] =>
    bal < cheapestCost ? dedupAsc.slice(0, 3) : [];

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
        sample: recipients.slice(0, 3).map((r) => ({
          email: r.email,
          points: r.points,
          workouts: r.workouts,
          gyms: r.gyms,
          longest_sec: r.longest_sec,
          wearable: r.wearable,
          challenges: r.challenges,
          balance: r.balance,
          closest_reward: closestRewardFor(r.balance ?? 0),
          ladder: ladderFor(r.balance ?? 0),
        })),
        top_rewards: topRewards,
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
          prevSteps: r.prev_steps ?? 0,
          activities: r.activities ?? null,
          weeklyRank: r.weekly_rank,
          referralCode: r.referral_code,
          longestSession: r.longest_sec && r.longest_sec > 0
            ? { type: r.longest_type ?? "workout", durationSec: r.longest_sec, partner: r.longest_partner }
            : null,
          gyms: r.gyms?.length ? r.gyms : null,
          wearable: wearableLabel(r.wearable),
          challengesCompleted: r.challenges ?? 0,
          challengeTitles: challengeTitles(r.challenge_ids),
          balance: r.balance ?? 0,
          topRewards,
          closestReward: closestRewardFor(r.balance ?? 0),
          upcomingRewards: ladderFor(r.balance ?? 0),
        };
        const email = weeklySummaryEmail(payload);
        try {
          await sendEmail({ to: deliverTo ?? r.email, subject: email.subject, html: email.html, text: email.text });
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

import { ctaButton, emailShell, esc, FONT, GOLD, sectionLabel } from "./layout.ts";

export interface WeeklySummaryTopActivity {
  /** Activity type key, e.g. "gym", "running". */
  type: string;
  count: number;
}

export interface WeeklyActivityStat {
  /** Activity type key, e.g. "gym", "running". */
  type: string;
  /** This week's session count for this activity. */
  count: number;
  /** Previous week's count, for the week-over-week up/down indicator. */
  prevCount?: number | null;
}

export interface WeeklyGym {
  name: string;
  count: number;
}

export interface WeeklyLongestSession {
  /** Activity type key, e.g. "gym", "running". */
  type: string;
  durationSec: number;
  /** Gym name, if it was a partner check-in. */
  partner?: string | null;
}

export interface WeeklyRewardTile {
  brand?: string | null;
  title?: string | null;
  /** POWR cost of the reward. */
  cost: number;
  /** Brand logo / reward image (the small mark). */
  image?: string | null;
  /** Hero / cover image (the wide background, app-card style). */
  hero?: string | null;
  /** Discount badge text, e.g. "£15 OFF" / "20% OFF". */
  valueLabel?: string | null;
}

export interface WeeklyDay {
  /** Calendar day in the member's own timezone, "YYYY-MM-DD". */
  date: string;
  /** POWR earned that day. */
  points: number;
  /** Any non-sleep activity logged that day. */
  active: boolean;
}

export interface WeeklyLevel {
  level: number;
  name: string;
  tierLabel: string;
  /** Email-safe hex. */
  tierColor: string;
  /** Lifetime POWR — the basis levels are computed from. */
  totalEarned: number;
  /** Lifetime POWR at which this level started. */
  levelAt: number;
  nextName?: string | null;
  nextAt?: number | null;
  imageUrl?: string | null;
}

export interface WeeklySummaryData {
  name: string | null;
  /** Human label for the week being summarised, e.g. "9–15 Jun". */
  weekLabel: string;
  pointsThisWeek: number;
  /** Previous week's points, for the week-over-week delta. */
  pointsLastWeek?: number | null;
  /** Number of workouts (sessions excluding sleep & walking). */
  workouts: number;
  /** Distinct active days (any non-sleep activity), 0–7. */
  activeDays: number;
  currentStreak: number;
  topActivity?: WeeklySummaryTopActivity | null;
  distanceKm?: number | null;
  steps?: number | null;
  /** Previous week's total steps, for the steps-row up/down indicator. */
  prevSteps?: number | null;
  /** Per-activity session counts this week (+ prev week) for the "how you moved"
   *  breakdown rows. Excludes walking & sleep (walking → the steps row). */
  activities?: WeeklyActivityStat[] | null;
  /** League position for the week, within the user's cohort. */
  weeklyRank?: number | null;
  referralCode?: string | null;
  /** Longest single workout of the week. */
  longestSession?: WeeklyLongestSession | null;
  /** Gyms visited this week, most-visited first. */
  gyms?: WeeklyGym[] | null;
  /** Connected wearable / health source, display label e.g. "Whoop". */
  wearable?: string | null;
  /** Weekly challenges completed. */
  challengesCompleted?: number;
  /** Titles of the challenges completed (for chips). */
  challengeTitles?: string[] | null;
  /** Current spendable POWR balance. */
  balance?: number | null;
  /** Up to 3 highest-value active rewards, shown as brand logo tiles. */
  topRewards?: WeeklyRewardTile[] | null;
  /** The reward to feature (app-style card): cheapest above balance, or the top
   *  reward if the user can already afford everything. */
  closestReward?: WeeklyRewardTile | null;
  /** Set only when the balance can't unlock anything yet — the 3 cheapest rewards
   *  (low→high) shown as an attainable ladder instead of the single featured card. */
  upcomingRewards?: WeeklyRewardTile[] | null;
  /** Rewards the balance already covers, best value first (max 3 rendered).
   *  When present the section leads with redeeming, not with a progress bar. */
  rewardsReady?: WeeklyRewardTile[] | null;
  /** How many distinct rewards the balance covers right now. */
  affordableCount?: number | null;
  /** The seven days of the week, Monday first, in the member's timezone. */
  days?: WeeklyDay[] | null;
  /** Level + progress to the next one. */
  level?: WeeklyLevel | null;
  /** Joined during (or just before) this week — no "last week" to compare with. */
  isFirstWeek?: boolean;
  /** Unreleased Vault POWR. Pass ONLY for members who can see the Vault. */
  vaultBanked?: number | null;
}

// League / weekly leaderboard isn't live yet — hide the "League finish" section
// (both the HTML block and the plain-text line). Flip to true to re-enable.
const SHOW_LEAGUE_FINISH = false;

// Rough POWR per workout, for "≈ N workouts away" on rewards. Matches the base
// award for the main activities (gym/run/cycle/HIIT) in _shared/points.ts.
const POINTS_PER_SESSION = 10;

/** Whole workouts still needed to afford a reward (0 once it's affordable). */
function sessionsAway(cost: number, balance: number): number {
  return Math.max(0, Math.ceil((cost - balance) / POINTS_PER_SESSION));
}
function sessionsLabel(n: number): string {
  return `${n} ${n === 1 ? "workout" : "workouts"}`;
}

// type → display label. Mirrors constants/activities.ts (kept inline so the
// edge runtime has no app imports).
const ACTIVITY_LABELS: Record<string, string> = {
  walking: "Walking",
  running: "Running",
  cycling: "Cycling",
  swimming: "Swimming",
  gym: "Gym",
  hiit: "HIIT / Classes",
  sports: "Sports",
  yoga: "Yoga / Pilates",
  dance: "Dance",
  sleep: "Sleep",
};

// Premium monoline activity icons (Phosphor "light", off-white). Hosted as PNGs
// — email clients (Gmail/Outlook) don't render SVG — alongside the logo in the
// landing-page-assets bucket. Regenerate via landing-page/scripts/gen-email-icons.mjs.
const ICON_BASE =
  "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/email-icons/";
const ICON_TYPES = new Set([
  "walking", "running", "cycling", "swimming", "gym",
  "hiit", "sports", "yoga", "dance", "sleep",
]);

/** URL of the activity icon PNG, falling back to a generic pulse mark. */
function activityIconUrl(type: string): string {
  return `${ICON_BASE}${ICON_TYPES.has(type) ? type : "fallback"}.png`;
}

function activityLabel(type: string): string {
  return ACTIVITY_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

/** Up/down chip vs the previous week. `abs` shows the count delta (▲2), `pct`
 *  the percentage delta (▲12%); new-this-week shows a gold NEW tag. */
function deltaChip(curr: number, prev: number | null | undefined, mode: "abs" | "pct"): string {
  const base = `font-family:${FONT};white-space:nowrap;`;
  if (prev == null || prev <= 0) {
    return mode === "abs" && curr > 0
      ? `<span style="font-size:9px;font-weight:700;letter-spacing:1px;color:${GOLD};${base}">NEW</span>`
      : "";
  }
  if (curr === prev) {
    return `<span style="font-size:13px;color:#555555;${base}">&ndash;</span>`;
  }
  const up = curr > prev;
  const mag = mode === "pct"
    ? `${Math.round(Math.abs((curr - prev) / prev) * 100)}%`
    : `${Math.abs(curr - prev)}`;
  return `<span style="font-size:12px;font-weight:700;color:${up ? GOLD : "#888888"};${base}">${up ? "&#9650;" : "&#9660;"}&nbsp;${mag}</span>`;
}

/** Plain-text counterpart of deltaChip, e.g. " (+2)" / " (-12%)" / " (new)". */
function deltaTextPart(curr: number, prev: number | null | undefined, mode: "abs" | "pct"): string {
  if (prev == null || prev <= 0) return mode === "abs" && curr > 0 ? " (new)" : "";
  if (curr === prev) return "";
  const sign = curr > prev ? "+" : "-";
  const mag = mode === "pct"
    ? `${Math.round(Math.abs((curr - prev) / prev) * 100)}%`
    : `${Math.abs(curr - prev)}`;
  return ` (${sign}${mag})`;
}

function formatDuration(sec: number): string {
  const mins = Math.max(1, Math.round(sec / 60));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

// Reward images are user-uploaded and can be huge (multiple MB, 8000px wide),
// which email clients (and Gmail's image proxy) refuse to load — and at native
// aspect ratio they render as giant blocks. Route Supabase storage objects
// through the on-the-fly image transform so we only ever send a small, fixed-
// size version. Non-Supabase URLs are left untouched.
function optimizeImage(
  url: string,
  opts: { width?: number; height?: number; resize?: "cover" | "contain" } = {},
): string {
  const marker = "/storage/v1/object/public/";
  if (!url.includes(marker)) return url;
  const base = url.split("?")[0].replace(marker, "/storage/v1/render/image/public/");
  const { width = 600, height, resize } = opts;
  let q = `?width=${width}&quality=75`;
  if (height) q += `&height=${height}`;
  if (resize) q += `&resize=${resize}`;
  return `${base}${q}`;
}

// A "longest session" over these bounds is a tracking artefact (a gym visit whose
// exit never fired pins at the 12 h backstop), not an achievement — never feature it.
const MAX_FEATURED_GYM_SEC = 4 * 3600;
const MAX_FEATURED_SESSION_SEC = 8 * 3600;
function plausibleLongest(ls: WeeklyLongestSession | null | undefined): WeeklyLongestSession | null {
  if (!ls || !(ls.durationSec > 0)) return null;
  const max = ls.type === "gym" ? MAX_FEATURED_GYM_SEC : MAX_FEATURED_SESSION_SEC;
  return ls.durationSec <= max ? ls : null;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Weekday name of a "YYYY-MM-DD" calendar date (no timezone maths — it's already local). */
function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay()];
}

function statCell(value: string, label: string): string {
  return `
                <td width="33.33%" style="padding:0 6px;vertical-align:top;text-align:center;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#111111;border:1px solid #222222;border-radius:12px;">
                    <tr>
                      <td style="padding:18px 8px;text-align:center;">
                        <span class="statnum" style="display:block;font-size:30px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;line-height:1;font-family:${FONT};">${value}</span>
                        <span style="display:block;margin-top:8px;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#666666;font-family:${FONT};">${label}</span>
                      </td>
                    </tr>
                  </table>
                </td>`;
}

export function weeklySummaryEmail(data: WeeklySummaryData): { subject: string; html: string; text: string } {
  const firstName = esc(data.name?.trim().split(" ")[0] || "there");
  const points = data.pointsThisWeek;
  const lastWeek = data.pointsLastWeek ?? null;

  // Day strip + best day (member-local calendar days, Monday first).
  const days = (data.days ?? []).slice(0, 7);
  const bestDay = days.reduce<WeeklyDay | null>(
    (best, d) => (d.points > 0 && (!best || d.points > best.points) ? d : best),
    null,
  );

  // Week-over-week delta line. Most weeks are lighter than the one before, so a
  // down week leads with what held (streak / active days / best day) and keeps
  // the comparison as a quiet second clause — never a grey "▼ 30%" headline.
  let deltaHtml = "";
  let deltaText = "";
  if (lastWeek !== null && lastWeek > 0) {
    const pct = Math.round(((points - lastWeek) / lastWeek) * 100);
    if (pct > 0) {
      deltaHtml = `<span style="color:${GOLD};">&#9650; ${pct}%</span> vs last week`;
      deltaText = `Up ${pct}% vs last week.`;
    } else if (pct < 0) {
      const held = data.currentStreak >= 3
        ? `${data.currentStreak}-day streak, still standing.`
        : data.activeDays >= 4
        ? `Active ${data.activeDays} of 7 days.`
        : bestDay
        ? `${weekdayOf(bestDay.date)} was your best day.`
        : "";
      deltaHtml = `${held ? `<span style="color:#e8e8e8;">${held}</span> ` : ""}A lighter week than last (${lastWeek.toLocaleString()}).`;
      deltaText = `${held ? held + " " : ""}A lighter week than last (${lastWeek.toLocaleString()}).`;
    } else {
      deltaHtml = `Level with last week`;
      deltaText = `Level with last week.`;
    }
  } else if (points > 0 && data.isFirstWeek) {
    deltaHtml = `<span style="color:${GOLD};">Your first week.</span> It starts here.`;
    deltaText = `Your first week. It starts here.`;
  } else if (points > 0 && lastWeek === 0) {
    deltaHtml = `<span style="color:${GOLD};">Back in action</span>`;
    deltaText = `Back in action this week.`;
  }

  // ── The week at a glance: M T W T F S S, gold = active that day ──
  const dayStripHtml = days.length === 7
    ? (() => {
        const cells = days.map((d) => {
          const letter = weekdayOf(d.date).charAt(0);
          const isBest = bestDay?.date === d.date;
          const dot = d.active || d.points > 0
            ? `background-color:${GOLD};border:1px solid ${GOLD};color:#080808;font-weight:700;`
            : `background-color:#0e0e0e;border:1px solid #2a2a2a;color:#666666;font-weight:400;`;
          return `
                <td align="center" valign="top" style="padding:0 2px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
                    <tr><td width="34" height="34" align="center" valign="middle" style="width:34px;height:34px;border-radius:17px;font-size:12px;line-height:34px;text-align:center;font-family:${FONT};${dot}">${letter}</td></tr>
                  </table>
                  <span style="display:block;margin-top:7px;font-size:10px;font-weight:${isBest ? 700 : 400};color:${isBest ? GOLD : "#666666"};font-family:${FONT};">${d.points > 0 ? d.points.toLocaleString() : "&ndash;"}</span>
                </td>`;
        }).join("");
        const bestLine = bestDay
          ? `<p style="margin:16px 0 0;font-size:13px;font-weight:300;color:#999999;text-align:center;font-family:${FONT};">Best day: <span style="color:#e8e8e8;font-weight:500;">${weekdayOf(bestDay.date)}</span> &middot; <span style="color:${GOLD};font-weight:600;">${bestDay.points.toLocaleString()} POWR</span></p>`
          : "";
        return `
        <tr>
          <td class="sec" style="background-color:#080808;padding:26px 40px 24px;border-bottom:1px solid #111111;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout:fixed;">
              <tr>${cells}</tr>
            </table>
            ${bestLine}
          </td>
        </tr>`;
      })()
    : "";

  // ── How you moved: one row per activity (icon + count + up/down delta), plus
  //    a steps row. Replaces the old combined "Gym ×5 · 55,919 steps" line. ──
  const activities = data.activities ?? [];
  const hasSteps = !!(data.steps && data.steps > 0);
  const hasDistance = !!(data.distanceKm && data.distanceKm >= 0.5);
  const activityBreakdownHtml = activities.length || hasSteps || hasDistance
    ? (() => {
        const row = (iconUrl: string, label: string, value: string, unit: string, delta: string) => `
                  <tr>
                    <td width="46" valign="middle" style="padding:12px 0;border-bottom:1px solid #161616;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="background-color:#141414;border:1px solid #242424;border-radius:10px;">
                        <tr><td width="38" height="38" align="center" valign="middle" style="width:38px;height:38px;text-align:center;"><img src="${iconUrl}" width="22" height="22" alt="" style="display:block;width:22px;height:22px;margin:0 auto;"></td></tr>
                      </table>
                    </td>
                    <td valign="middle" style="padding:12px 14px;border-bottom:1px solid #161616;font-size:15px;font-weight:400;color:#e8e8e8;font-family:${FONT};">${label}</td>
                    <td align="right" valign="middle" style="padding:12px 0;border-bottom:1px solid #161616;white-space:nowrap;font-family:${FONT};">
                      <span style="font-size:15px;font-weight:400;color:#F2F2F2;">${value}</span><span style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#666666;">&nbsp;${unit}</span>${delta ? `&nbsp;&nbsp;&nbsp;${delta}` : ""}
                    </td>
                  </tr>`;
        const rows = activities.map((a) =>
          row(
            activityIconUrl(a.type),
            activityLabel(a.type),
            String(a.count),
            a.count === 1 ? "session" : "sessions",
            deltaChip(a.count, a.prevCount, "abs"),
          )
        );
        if (hasSteps) {
          rows.push(
            row(
              activityIconUrl("walking"),
              "Steps",
              data.steps!.toLocaleString(),
              "steps",
              deltaChip(data.steps!, data.prevSteps, "pct"),
            ),
          );
        }
        if (hasDistance) {
          rows.push(row(activityIconUrl("running"), "Distance", data.distanceKm!.toLocaleString(), "km", ""));
        }
        // Where the numbers came from — or, with nothing connected, the one nudge
        // that makes every later email richer.
        const sourceLine = data.wearable
          ? `<p style="margin:14px 0 0;font-size:12px;font-weight:300;color:#777777;font-family:${FONT};"><span style="color:${GOLD};">&#9679;</span>&nbsp; Synced from ${esc(data.wearable)}</p>`
          : `<p style="margin:14px 0 0;font-size:12px;font-weight:300;color:#999999;font-family:${FONT};">No wearable connected yet. <a href="https://powr.life/app?to=wearables" style="color:${GOLD};text-decoration:underline;">Connect one</a> and every workout counts automatically.</p>`;
        return `
        <tr>
          <td class="sec" style="background-color:#080808;padding:26px 40px 28px;border-bottom:1px solid #111111;">
            ${sectionLabel("How you moved")}
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:6px;">
              ${rows.join("")}
            </table>
            ${sourceLine}
          </td>
        </tr>`;
      })()
    : "";

  // ── Longest session feature ────────────────────────────────────
  const longest = plausibleLongest(data.longestSession);
  const longestHtml = longest
    ? (() => {
        const ls = longest;
        const iconUrl = activityIconUrl(ls.type);
        const sub = ls.partner
          ? `${activityLabel(ls.type)} &middot; ${esc(ls.partner)}`
          : activityLabel(ls.type);
        return `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:30px 40px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="vertical-align:middle;">
                  ${sectionLabel("Longest session")}
                  <span style="display:block;margin-top:10px;font-size:40px;font-weight:200;color:#F2F2F2;letter-spacing:-1.5px;line-height:1;font-family:${FONT};">${formatDuration(ls.durationSec)}</span>
                  <span style="display:block;margin-top:8px;font-size:14px;font-weight:300;color:#999999;font-family:${FONT};">${sub}</span>
                </td>
                <td width="52" style="vertical-align:middle;text-align:right;"><img src="${iconUrl}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;margin-left:auto;"></td>
              </tr>
            </table>
          </td>
        </tr>`;
      })()
    : "";

  // ── Where you trained (gyms) ───────────────────────────────────
  const gymsHtml = data.gyms && data.gyms.length
    ? (() => {
        const rows = data.gyms!
          .map(
            (g) => `
                  <tr>
                    <td style="padding:11px 0;border-bottom:1px solid #161616;font-size:15px;font-weight:400;color:#e8e8e8;font-family:${FONT};">
                      <span style="color:${GOLD};">&#9679;</span>&nbsp;&nbsp;${esc(g.name)}
                    </td>
                    <td align="right" style="padding:11px 0;border-bottom:1px solid #161616;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#777777;font-family:${FONT};white-space:nowrap;">${g.count}&nbsp;${g.count === 1 ? "visit" : "visits"}</td>
                  </tr>`,
          )
          .join("");
        return `
        <tr>
          <td class="sec" style="background-color:#080808;padding:30px 40px;border-bottom:1px solid #111111;">
            ${sectionLabel("Where you trained")}
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">
              ${rows}
            </table>
          </td>
        </tr>`;
      })()
    : "";

  // ── Challenges completed ───────────────────────────────────────
  const challengeCount = data.challengesCompleted ?? 0;
  const challengesHtml = challengeCount > 0
    ? (() => {
        const titles = data.challengeTitles ?? [];
        const shown = titles.slice(0, 4);
        const extra = titles.length - shown.length;
        const chips = shown
          .map(
            (t) =>
              `<span style="display:inline-block;margin:4px 6px 4px 0;padding:7px 14px;border:1px solid #2e2c12;border-radius:20px;background-color:#13130c;font-size:12px;font-weight:600;color:${GOLD};font-family:${FONT};">${esc(t)}</span>`,
          )
          .join("");
        const more = extra > 0
          ? `<span style="display:inline-block;margin:4px 6px 4px 0;padding:7px 14px;font-size:12px;font-weight:600;color:#777777;font-family:${FONT};">+${extra} more</span>`
          : "";
        return `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:30px 40px;border-bottom:1px solid #161616;">
            ${sectionLabel("Challenges completed")}
            <span style="display:block;margin-top:10px;font-size:30px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;line-height:1;font-family:${FONT};">${challengeCount} ${challengeCount === 1 ? "challenge" : "challenges"} <span style="color:#666666;">completed</span></span>
            ${chips ? `<div style="margin-top:14px;">${chips}${more}</div>` : ""}
          </td>
        </tr>`;
      })()
    : "";

  // ── Rewards in reach: logo tiles + featured "closest reward" card ──
  const balance = data.balance ?? 0;
  const topRewards = data.topRewards ?? [];
  const closestReward = data.closestReward ?? null;
  const upcomingRewards = data.upcomingRewards ?? [];
  // Can't afford anything yet → feature the cheapest and list the next two (a
  // low→high ladder); otherwise just feature the single closest reward.
  // Most members already hold enough for a reward, so "N workouts away" is the
  // wrong story for them. With rewardsReady the section leads with redeeming:
  // balance headline, best-value reward featured, then the rest + what's next.
  const rewardsReady = data.rewardsReady ?? [];
  const readyMode = rewardsReady.length > 0;
  const affordableCount = Math.max(data.affordableCount ?? 0, rewardsReady.length);
  const nextUp = readyMode && closestReward && closestReward.cost > balance ? closestReward : null;
  const featuredReward = readyMode
    ? rewardsReady[0]
    : upcomingRewards.length ? upcomingRewards[0] : closestReward;
  const ladderRest = readyMode
    ? rewardsReady.slice(1, 3)
    : upcomingRewards.length ? upcomingRewards.slice(1, 3) : [];

  const rewardLogo = (r: WeeklyRewardTile): string | null => r.image ?? r.hero ?? null;
  const rewardInitial = (r: WeeklyRewardTile): string => esc((r.brand ?? "?").trim().charAt(0).toUpperCase());
  const brandValue = (r: WeeklyRewardTile): string => {
    const v = (r.valueLabel ?? "").trim();
    return v ? `${esc(r.brand)}${r.brand ? " &middot; " : ""}${esc(v)}` : esc(r.brand);
  };

  const rewardHtml = (topRewards.length || featuredReward || readyMode)
    ? (() => {
        // Three showcase logo tiles — logo contained in a fixed box + a reach line.
        const tiles = topRewards.slice(0, 3).map((r) => {
          const logo = rewardLogo(r);
          const inner = logo
            ? `<img src="${optimizeImage(logo, { width: 200, height: 200, resize: "contain" })}" alt="${esc(r.brand ?? "Reward")}" style="display:block;max-width:58px;max-height:58px;width:auto;height:auto;margin:0 auto;">`
            : `<span style="display:block;font-size:24px;font-weight:700;color:#444444;font-family:${FONT};">${rewardInitial(r)}</span>`;
          const reach = balance >= r.cost
            ? `<span style="display:block;margin-top:4px;font-size:10px;font-weight:700;letter-spacing:0.5px;color:${GOLD};font-family:${FONT};">&#10003; Ready</span>`
            : `<span style="display:block;margin-top:4px;font-size:10px;font-weight:400;color:#777777;font-family:${FONT};">${sessionsLabel(sessionsAway(r.cost, balance))} away</span>`;
          return `
                <td width="33.33%" align="center" valign="top" style="padding:0 6px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;background-color:#141414;border:1px solid #242424;border-radius:14px;">
                    <tr>
                      <td width="84" height="84" align="center" valign="middle" style="width:84px;height:84px;text-align:center;">
                        ${inner}
                      </td>
                    </tr>
                  </table>
                  <span style="display:block;margin-top:9px;font-size:11px;font-weight:600;color:#dddddd;line-height:1.3;font-family:${FONT};">${esc(r.brand)}</span>
                  <span style="display:block;margin-top:2px;font-size:11px;font-weight:700;color:${GOLD};font-family:${FONT};">${r.cost.toLocaleString()} POWR</span>
                  ${reach}
                </td>`;
        }).join("");
        const tilesHtml = tiles
          ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout:fixed;margin-top:16px;"><tr>${tiles}</tr></table>`
          : "";

        // Featured app-style card: cover image on top, then logo + discount + a
        // progress bar and "≈ N workouts away" (or "ready") line below.
        const featuredCard = (r: WeeklyRewardTile): string => {
          const affordable = balance >= r.cost;
          const toGo = Math.max(0, r.cost - balance);
          const pct = Math.max(3, Math.min(100, Math.round((balance / r.cost) * 100)));
          const cover = (r.hero ?? r.image)
            ? `<img src="${optimizeImage((r.hero ?? r.image)!, { width: 1040, height: 380, resize: "cover" })}" alt="${esc(r.brand ?? "Reward")}" width="520" style="display:block;width:100%;height:auto;border-radius:14px 14px 0 0;">`
            : "";
          const logoSrc = rewardLogo(r);
          const logo = logoSrc
            ? `<img src="${optimizeImage(logoSrc, { width: 120, height: 120, resize: "contain" })}" alt="${esc(r.brand ?? "Reward")}" style="display:block;max-width:36px;max-height:36px;width:auto;height:auto;margin:0 auto;">`
            : `<span style="display:block;font-size:18px;font-weight:700;color:#666666;font-family:${FONT};">${rewardInitial(r)}</span>`;
          const status = affordable
            ? `<span style="display:block;margin-top:11px;font-size:12px;font-weight:700;color:${GOLD};font-family:${FONT};">&#10003; You can unlock this now</span>`
            : `<span style="display:block;margin-top:11px;font-size:12px;font-weight:300;color:#999999;font-family:${FONT};"><span style="color:${GOLD};font-weight:600;">${toGo.toLocaleString()} POWR</span> &middot; about ${sessionsLabel(sessionsAway(r.cost, balance))} away</span>`;
          return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;background-color:#0f0f0a;border:1px solid #2a2814;border-radius:14px;">
              <tr><td style="padding:0;font-size:0;line-height:0;">${cover}</td></tr>
              <tr>
                <td style="padding:16px 18px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td width="56" valign="middle">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="background-color:#161610;border:1px solid #2a2814;border-radius:10px;">
                          <tr><td width="44" height="44" align="center" valign="middle" style="width:44px;height:44px;text-align:center;">${logo}</td></tr>
                        </table>
                      </td>
                      <td valign="middle" style="padding-left:12px;">
                        <span style="display:block;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${GOLD};font-family:${FONT};">${affordable ? (readyMode ? "Best value in reach" : "Ready to unlock") : "Closest reward"}</span>
                        <span style="display:block;margin-top:4px;font-size:15px;font-weight:500;color:#F2F2F2;font-family:${FONT};">${brandValue(r)}</span>
                      </td>
                      <td align="right" valign="middle" style="white-space:nowrap;">
                        <span style="font-size:18px;font-weight:300;color:${GOLD};letter-spacing:-0.5px;font-family:${FONT};">${r.cost.toLocaleString()}</span><span style="font-size:9px;font-weight:700;letter-spacing:1px;color:#A89900;font-family:${FONT};"> POWR</span>
                      </td>
                    </tr>
                  </table>
                  ${affordable ? "" : `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px;background-color:#26261a;border-radius:3px;">
                    <tr>
                      <td width="${pct}%" style="background-color:${GOLD};height:5px;line-height:5px;font-size:0;border-radius:3px;">&nbsp;</td>
                      <td style="height:5px;line-height:5px;font-size:0;">&nbsp;</td>
                    </tr>
                  </table>`}
                  ${status}
                </td>
              </tr>
            </table>`;
        };

        // Compact rows for the 2nd & 3rd rungs of the low-balance ladder.
        const compactRow = (r: WeeklyRewardTile): string => {
          const logoSrc = rewardLogo(r);
          const logo = logoSrc
            ? `<img src="${optimizeImage(logoSrc, { width: 100, height: 100, resize: "contain" })}" alt="${esc(r.brand ?? "Reward")}" style="display:block;max-width:28px;max-height:28px;width:auto;height:auto;margin:0 auto;">`
            : `<span style="display:block;font-size:14px;font-weight:700;color:#666666;font-family:${FONT};">${rewardInitial(r)}</span>`;
          return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px;background-color:#0c0c0c;border:1px solid #1c1c1c;border-radius:12px;">
              <tr>
                <td width="56" valign="middle" style="padding:10px 0 10px 12px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="background-color:#161616;border:1px solid #242424;border-radius:8px;">
                    <tr><td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;text-align:center;">${logo}</td></tr>
                  </table>
                </td>
                <td valign="middle" style="padding:10px 12px;">
                  <span style="display:block;font-size:13px;font-weight:500;color:#e8e8e8;font-family:${FONT};">${brandValue(r)}</span>
                  <span style="display:block;margin-top:2px;font-size:11px;font-weight:${balance >= r.cost ? 700 : 300};color:${balance >= r.cost ? GOLD : "#888888"};font-family:${FONT};">${balance >= r.cost ? "&#10003; Ready" : `${sessionsLabel(sessionsAway(r.cost, balance))} away`}</span>
                </td>
                <td align="right" valign="middle" style="padding:10px 14px 10px 0;white-space:nowrap;">
                  <span style="font-size:13px;font-weight:700;color:${GOLD};font-family:${FONT};">${r.cost.toLocaleString()} POWR</span>
                </td>
              </tr>
            </table>`;
        };

        const featuredHtml = featuredReward ? featuredCard(featuredReward) : "";
        const ladderHtml = ladderRest.map(compactRow).join("");

        if (readyMode) {
          const nextHtml = nextUp
            ? `<p style="margin:16px 0 0;font-size:12px;font-weight:300;color:#999999;text-align:center;font-family:${FONT};">Next up: <span style="color:#e8e8e8;font-weight:500;">${brandValue(nextUp)}</span> &middot; about ${sessionsLabel(sessionsAway(nextUp.cost, balance))} away</p>`
            : "";
          return `
        <tr>
          <td class="sec" bgcolor="#080808" style="background-color:#080808;padding:30px 40px;border-bottom:1px solid #111111;">
            ${sectionLabel("Ready to redeem")}
            <span style="display:block;margin-top:10px;font-size:30px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;line-height:1.15;font-family:${FONT};"><span style="color:${GOLD};">${balance.toLocaleString()} POWR</span> in your balance</span>
            <span style="display:block;margin-top:8px;font-size:14px;font-weight:300;color:#999999;line-height:1.5;font-family:${FONT};">Enough for ${affordableCount === 1 ? "a reward" : `${affordableCount} rewards`} right now. Earned, not given &mdash; spend it.</span>
            ${featuredHtml}
            ${ladderHtml}
            <div style="margin-top:22px;">${ctaButton("Redeem a reward", "https://powr.life/app?to=rewards", "ghost")}</div>
            ${nextHtml}
          </td>
        </tr>`;
        }

        return `
        <tr>
          <td class="sec" bgcolor="#080808" style="background-color:#080808;padding:30px 40px;border-bottom:1px solid #111111;">
            ${sectionLabel("Rewards in reach")}
            ${tilesHtml}
            ${featuredHtml}
            ${ladderHtml}
          </td>
        </tr>`;
      })()
    : "";

  // ── Level progress (+ Vault, for members who can see it) ─────────
  const lvl = data.level ?? null;
  const vaultBanked = data.vaultBanked ?? 0;
  const levelHtml = lvl
    ? (() => {
        const span = lvl.nextAt != null ? Math.max(1, lvl.nextAt - lvl.levelAt) : 0;
        const pct = lvl.nextAt != null
          ? Math.max(3, Math.min(100, Math.round(((lvl.totalEarned - lvl.levelAt) / span) * 100)))
          : 100;
        const toGo = lvl.nextAt != null ? Math.max(0, lvl.nextAt - lvl.totalEarned) : 0;
        const art = lvl.imageUrl
          ? `<td width="76" valign="middle"><img src="${lvl.imageUrl}" width="64" alt="" style="display:block;width:64px;height:auto;"></td>`
          : "";
        const nextLine = lvl.nextName && lvl.nextAt != null
          ? `<span style="color:${GOLD};font-weight:600;">${toGo.toLocaleString()} POWR</span> to ${esc(lvl.nextName)}`
          : `Top of the ladder.`;
        const vaultLine = vaultBanked > 0
          ? `<p style="margin:14px 0 0;font-size:12px;font-weight:300;color:#999999;font-family:${FONT};"><span style="color:${GOLD};font-weight:600;">${vaultBanked.toLocaleString()} POWR</span> banked in your <a href="https://powr.life/app?to=vault" style="color:#cccccc;text-decoration:underline;">Vault</a> &mdash; already counting toward your level.</p>`
          : "";
        return `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:30px 40px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                ${art}
                <td valign="middle">
                  ${sectionLabel(`Level ${lvl.level} &middot; ${esc(lvl.tierLabel)}`, lvl.tierColor === GOLD ? undefined : lvl.tierColor)}
                  <span style="display:block;margin-top:6px;font-size:22px;font-weight:300;color:#F2F2F2;letter-spacing:-0.3px;line-height:1.2;font-family:${FONT};">${esc(lvl.name)}</span>
                </td>
                <td align="right" valign="middle" style="white-space:nowrap;">
                  <span style="font-size:18px;font-weight:300;color:#F2F2F2;letter-spacing:-0.5px;font-family:${FONT};">${lvl.totalEarned.toLocaleString()}</span><span style="font-size:9px;font-weight:700;letter-spacing:1px;color:#777777;font-family:${FONT};"> ALL&nbsp;TIME</span>
                </td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;background-color:#26261a;border-radius:3px;">
              <tr>
                <td width="${pct}%" style="background-color:${GOLD};height:5px;line-height:5px;font-size:0;border-radius:3px;">&nbsp;</td>
                ${pct < 100 ? `<td style="height:5px;line-height:5px;font-size:0;">&nbsp;</td>` : ""}
              </tr>
            </table>
            <p style="margin:11px 0 0;font-size:12px;font-weight:300;color:#999999;font-family:${FONT};">${nextLine}</p>
            ${vaultLine}
          </td>
        </tr>`;
      })()
    : "";

  const rankHtml = SHOW_LEAGUE_FINISH && data.weeklyRank
    ? `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:28px 40px;border-bottom:1px solid #161616;text-align:center;">
            <span style="display:block;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#555555;font-family:${FONT};">League finish</span>
            <span style="display:block;margin-top:8px;font-size:34px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;font-family:${FONT};">#${data.weeklyRank}</span>
            <span style="display:block;margin-top:6px;font-size:13px;font-weight:300;color:#888888;font-family:${FONT};">where you ranked this week</span>
          </td>
        </tr>`
    : "";

  const preheader =
    points > 0
      ? `You earned ${points.toLocaleString()} POWR this week${deltaText ? " — " + deltaText : "."}`
      : `Your POWR week in review.`;

  const referralUrl = data.referralCode ? `https://powr.life/?ref=${encodeURIComponent(data.referralCode)}` : "https://powr.life";

  const rows = `
        <!-- HERO -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:40px 40px 32px;text-align:center;border-bottom:1px solid #111111;">
            <span style="display:block;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#8F8203;font-family:${FONT};">Your week &middot; ${data.weekLabel}</span>
            <h1 class="hero-h1" style="margin:14px 0 0;font-size:34px;font-weight:200;letter-spacing:-0.5px;line-height:1.2;color:#F2F2F2;font-family:${FONT};">Here&#8217;s your week,<br>${firstName}.</h1>
          </td>
        </tr>

        <!-- POINTS -->
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:34px 40px;border-bottom:1px solid #161616;text-align:center;">
            <span class="points-num" style="display:block;font-size:72px;font-weight:200;color:${GOLD};letter-spacing:-3px;line-height:1;font-family:${FONT};">${points.toLocaleString()}</span>
            <span style="display:block;margin-top:6px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#8F8203;font-family:${FONT};">POWR earned this week</span>
            ${deltaHtml ? `<p style="margin:14px 0 0;font-size:13px;font-weight:400;color:#999999;font-family:${FONT};">${deltaHtml}</p>` : ""}
          </td>
        </tr>

${dayStripHtml}
        <!-- STAT GRID -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 34px;border-bottom:1px solid #111111;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout:fixed;">
              <tr>
                ${statCell(String(data.workouts), "Workouts")}
                ${statCell(`${data.activeDays}/7`, "Active days")}
                ${statCell(String(data.currentStreak), "Day streak")}
              </tr>
            </table>
          </td>
        </tr>
${activityBreakdownHtml}${longestHtml}${gymsHtml}${challengesHtml}${levelHtml}${rewardHtml}${rankHtml}
        <!-- CTA -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:34px 40px;text-align:center;border-bottom:1px solid #161616;">
            <p style="margin:0 0 20px;font-size:14px;font-weight:300;color:#999999;line-height:1.6;font-family:${FONT};">New week, clean slate.<br class="br-d"> Every move from here counts.</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:24px;background-color:${GOLD};">
                  <a href="https://powr.life/app" style="display:inline-block;padding:14px 32px;font-size:13px;font-weight:700;color:#080808;font-family:${FONT};text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">Start this week</a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-size:12px;font-weight:300;color:#888888;line-height:1.6;font-family:${FONT};">Bring a friend with <a href="${referralUrl}" style="color:#999999;text-decoration:underline;">your code${data.referralCode ? ` ${esc(data.referralCode)}` : ""}</a> — you both earn +20 POWR.</p>
          </td>
        </tr>`;

  const html = emailShell({ title: "Your week in POWR", preheader, rows });

  const plainName = data.name?.trim().split(" ")[0] || "there";
  const lines: string[] = [
    `Here's your week, ${plainName}. (${data.weekLabel})`,
    ``,
    `${points.toLocaleString()} POWR earned this week.${deltaText ? " " + deltaText : ""}`,
    ``,
    `Workouts: ${data.workouts}`,
    `Active days: ${data.activeDays}/7`,
    `Day streak: ${data.currentStreak}`,
  ];
  if (bestDay) {
    lines.push(`Best day: ${weekdayOf(bestDay.date)} (${bestDay.points.toLocaleString()} POWR)`);
  }
  if (activities.length || hasSteps || hasDistance) {
    lines.push("", "How you moved:");
    for (const a of activities) {
      lines.push(`  - ${activityLabel(a.type)}: ${a.count} ${a.count === 1 ? "session" : "sessions"}${deltaTextPart(a.count, a.prevCount, "abs")}`);
    }
    if (hasSteps) {
      lines.push(`  - Steps: ${data.steps!.toLocaleString()}${deltaTextPart(data.steps!, data.prevSteps, "pct")}`);
    }
    if (hasDistance) lines.push(`  - Distance: ${data.distanceKm!.toLocaleString()} km`);
    if (data.wearable) lines.push(`  Synced from ${data.wearable}`);
  }
  if (longest) {
    const ls = longest;
    const sub = ls.partner ? `${activityLabel(ls.type)} · ${ls.partner}` : activityLabel(ls.type);
    lines.push("", `Longest session: ${formatDuration(ls.durationSec)} (${sub})`);
  }
  if (data.gyms && data.gyms.length) {
    lines.push("", "Where you trained:");
    for (const g of data.gyms) lines.push(`  - ${g.name}: ${g.count} ${g.count === 1 ? "visit" : "visits"}`);
  }
  if (challengeCount > 0) {
    const titles = data.challengeTitles ?? [];
    lines.push("", `Challenges completed: ${challengeCount}${titles.length ? ` (${titles.join(", ")})` : ""}`);
  }
  if (lvl) {
    lines.push(
      "",
      `Level ${lvl.level}: ${lvl.name} (${lvl.totalEarned.toLocaleString()} POWR all time)${
        lvl.nextName && lvl.nextAt != null
          ? ` — ${Math.max(0, lvl.nextAt - lvl.totalEarned).toLocaleString()} POWR to ${lvl.nextName}`
          : ""
      }`,
    );
    if (vaultBanked > 0) lines.push(`Banked in your Vault: ${vaultBanked.toLocaleString()} POWR`);
  }
  if (readyMode) {
    lines.push(
      "",
      `Ready to redeem: ${balance.toLocaleString()} POWR in your balance — enough for ${affordableCount === 1 ? "a reward" : `${affordableCount} rewards`} right now.`,
    );
    for (const r of rewardsReady.slice(0, 3)) {
      const v = (r.valueLabel ?? "").trim();
      lines.push(`  - ${r.brand ?? "Reward"}${v ? ` · ${v}` : ""} — ${r.cost.toLocaleString()} POWR`);
    }
    lines.push("Redeem: https://powr.life/app?to=rewards");
  }
  if (!readyMode && topRewards.length) {
    lines.push("", "Rewards in reach:");
    for (const r of topRewards.slice(0, 3)) {
      const reach = balance >= r.cost ? "ready" : `${sessionsLabel(sessionsAway(r.cost, balance))} away`;
      lines.push(`  - ${r.brand ?? "Reward"} — ${r.cost.toLocaleString()} POWR (${reach})`);
    }
  }
  if (!readyMode && featuredReward) {
    const r = featuredReward;
    const v = (r.valueLabel ?? "").trim();
    const label = `${r.brand ?? ""}${v ? ` · ${v}` : ""}`;
    if (balance >= r.cost) {
      lines.push("", `Closest reward: ${label} (${r.cost.toLocaleString()} POWR) — ready to unlock.`);
    } else {
      lines.push("", `Closest reward: ${label} (${r.cost.toLocaleString()} POWR) — ${Math.max(0, r.cost - balance).toLocaleString()} to go, about ${sessionsLabel(sessionsAway(r.cost, balance))} away.`);
    }
    for (const u of ladderRest) {
      const uv = (u.valueLabel ?? "").trim();
      lines.push(`  Then: ${u.brand ?? ""}${uv ? ` · ${uv}` : ""} (${u.cost.toLocaleString()} POWR, ${sessionsLabel(sessionsAway(u.cost, balance))} away)`);
    }
  }
  if (SHOW_LEAGUE_FINISH && data.weeklyRank) {
    lines.push("", `League finish: #${data.weeklyRank} this week.`);
  }
  lines.push(
    "",
    "New week, clean slate. Start this week: https://powr.life/app",
    "",
    `Bring a friend with your code${data.referralCode ? ` ${data.referralCode}` : ""} — you both earn +20 POWR.`,
    `${referralUrl}`,
    "",
    "Every move counts.",
    "— POWR",
    "https://powr.life",
  );

  const subject =
    points > 0
      ? `Your POWR week: ${points.toLocaleString()} points${deltaText && deltaText.startsWith("Up") ? ", " + deltaText.toLowerCase().replace(".", "") : ""}`
      : `Your POWR week in review`;

  return { subject, html, text: lines.join("\n") };
}

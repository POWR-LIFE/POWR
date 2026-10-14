import { formatLocale, levelName, tEmail } from "../i18n/index.ts";
import { levelImageUrl, LEVELS, TIER_COLOR } from "../levels.ts";
import { ctaButton, emailShell, esc, FONT, GOLD, optimizeImage, sectionLabel } from "./layout.ts";
import { BR_DESKTOP, firstNameOf, fmtNum, rewardValueLabel, tierLabel } from "./member-copy.ts";

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
  /** Level name in the email's language (levelFor() fills it). */
  name: string;
  /** Tier label in the email's language. */
  tierLabel: string;
  /** Email-safe hex. */
  tierColor: string;
  /** Lifetime POWR — the basis levels are computed from. */
  totalEarned: number;
  /** Lifetime POWR at which this level started. */
  levelAt: number;
  /** Next level's name, in the email's language. */
  nextName?: string | null;
  nextAt?: number | null;
  imageUrl?: string | null;
}

export interface WeeklySummaryData {
  name: string | null;
  /** Human label for the week being summarised, e.g. "9–15 Jun" (formatWeekLabel, in the email's language). */
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

// type → display label. Mirrors the app's activities:names (the edge runtime
// has no app imports); an unknown type shows as its own key, capitalised.
function activityLabel(type: string, lang: string): string {
  switch (type) {
    case "walking":
      return tEmail(lang, "weekly.activities.walking");
    case "running":
      return tEmail(lang, "weekly.activities.running");
    case "cycling":
      return tEmail(lang, "weekly.activities.cycling");
    case "swimming":
      return tEmail(lang, "weekly.activities.swimming");
    case "gym":
      return tEmail(lang, "weekly.activities.gym");
    case "hiit":
      return tEmail(lang, "weekly.activities.hiit");
    case "sports":
      return tEmail(lang, "weekly.activities.sports");
    case "yoga":
      return tEmail(lang, "weekly.activities.yoga");
    case "dance":
      return tEmail(lang, "weekly.activities.dance");
    case "sleep":
      return tEmail(lang, "weekly.activities.sleep");
    case "workout": // send-weekly-summary's stand-in when a longest session has no type
      return tEmail(lang, "weekly.activities.workout");
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

/** Up/down chip vs the previous week. `abs` shows the count delta (▲2), `pct`
 *  the percentage delta (▲12%); new-this-week shows a gold NEW tag. */
function deltaChip(curr: number, prev: number | null | undefined, mode: "abs" | "pct", lang: string): string {
  const base = `font-family:${FONT};white-space:nowrap;`;
  if (prev == null || prev <= 0) {
    return mode === "abs" && curr > 0
      ? `<span style="font-size:9px;font-weight:700;letter-spacing:1px;color:${GOLD};${base}">${tEmail(lang, "weekly.newChip")}</span>`
      : "";
  }
  if (curr === prev) {
    return `<span style="font-size:13px;color:#555555;${base}">&ndash;</span>`;
  }
  const up = curr > prev;
  const mag = mode === "pct"
    ? tEmail(lang, "common.percent", { value: Math.round(Math.abs((curr - prev) / prev) * 100) })
    : `${Math.abs(curr - prev)}`;
  return `<span style="font-size:12px;font-weight:700;color:${up ? GOLD : "#888888"};${base}">${up ? "&#9650;" : "&#9660;"}&nbsp;${mag}</span>`;
}

/** Plain-text counterpart of deltaChip, e.g. " (+2)" / " (-12%)" / " (new)". */
function deltaTextPart(curr: number, prev: number | null | undefined, mode: "abs" | "pct", lang: string): string {
  if (prev == null || prev <= 0) return mode === "abs" && curr > 0 ? ` (${tEmail(lang, "weekly.newText")})` : "";
  if (curr === prev) return "";
  const sign = curr > prev ? "+" : "-";
  const mag = mode === "pct"
    ? tEmail(lang, "common.percent", { value: Math.round(Math.abs((curr - prev) / prev) * 100) })
    : `${Math.abs(curr - prev)}`;
  return ` (${sign}${mag})`;
}

function formatDuration(sec: number, lang: string): string {
  const mins = Math.max(1, Math.round(sec / 60));
  if (mins < 60) return tEmail(lang, "weekly.duration.minutes", { minutes: mins });
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? tEmail(lang, "weekly.duration.hoursMinutes", { hours: h, minutes: rem }) : tEmail(lang, "weekly.duration.hours", { hours: h });
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

/** Day of the week (0 = Sunday) of a "YYYY-MM-DD" calendar date (no timezone maths — it's already local). */
function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}
/** Weekday name of a calendar date, as it reads mid-sentence ("Monday", "lundi"). */
function weekdayOf(date: string, lang: string): string {
  return [
    tEmail(lang, "weekly.weekdays.sun"),
    tEmail(lang, "weekly.weekdays.mon"),
    tEmail(lang, "weekly.weekdays.tue"),
    tEmail(lang, "weekly.weekdays.wed"),
    tEmail(lang, "weekly.weekdays.thu"),
    tEmail(lang, "weekly.weekdays.fri"),
    tEmail(lang, "weekly.weekdays.sat"),
  ][weekdayIndex(date)];
}
/** The day strip's one-letter weekday. */
function weekdayLetter(date: string, lang: string): string {
  return [
    tEmail(lang, "weekly.weekdayLetters.sun"),
    tEmail(lang, "weekly.weekdayLetters.mon"),
    tEmail(lang, "weekly.weekdayLetters.tue"),
    tEmail(lang, "weekly.weekdayLetters.wed"),
    tEmail(lang, "weekly.weekdayLetters.thu"),
    tEmail(lang, "weekly.weekdayLetters.fri"),
    tEmail(lang, "weekly.weekdayLetters.sat"),
  ][weekdayIndex(date)];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "9–15 Jun" or "30 Jun – 6 Jul" for the [since, untilExclusive) window (UTC days). */
export function formatWeekLabel(since: Date, untilExclusive: Date, lang = "en"): string {
  const end = new Date(untilExclusive.getTime() - DAY_MS);
  const mon = (dt: Date) => dt.toLocaleString(formatLocale(lang), { month: "short", timeZone: "UTC" });
  const ds = since.getUTCDate();
  const de = end.getUTCDate();
  return mon(since) === mon(end)
    ? `${ds}–${de} ${mon(end)}`
    : `${ds} ${mon(since)} – ${de} ${mon(end)}`;
}

/** Level card from the canonical lifetime total (same basis as the app + level-up email), named in `lang`. */
export function levelFor(totalEarned: number, lang = "en"): WeeklyLevel {
  const def = [...LEVELS].reverse().find((l) => totalEarned >= l.xpMin) ?? LEVELS[0];
  const next = LEVELS.find((l) => l.level === def.level + 1) ?? null;
  return {
    level: def.level,
    name: levelName(lang, def.level),
    tierLabel: tierLabel(lang, def.tier),
    tierColor: TIER_COLOR[def.tier],
    totalEarned,
    levelAt: def.xpMin,
    nextName: next ? levelName(lang, next.level) : null,
    nextAt: next?.xpMin ?? null,
    imageUrl: levelImageUrl(def.level),
  };
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

export function weeklySummaryEmail(data: WeeklySummaryData, lang = "en"): { subject: string; html: string; text: string } {
  const plainName = firstNameOf(data.name, lang);
  const firstName = esc(plainName);
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
  // Set only for an up week: the subject line mentions it.
  let upPct: number | null = null;
  if (lastWeek !== null && lastWeek > 0) {
    const pct = Math.round(((points - lastWeek) / lastWeek) * 100);
    if (pct > 0) {
      upPct = pct;
      deltaHtml = tEmail(lang, "weekly.delta.upHtml", { chip: `<span style="color:${GOLD};">&#9650; ${tEmail(lang, "common.percent", { value: pct })}</span>` });
      deltaText = tEmail(lang, "weekly.delta.up", { pct });
    } else if (pct < 0) {
      const held = data.currentStreak >= 3
        ? tEmail(lang, "weekly.delta.heldStreak", { count: data.currentStreak })
        : data.activeDays >= 4
        ? tEmail(lang, "weekly.delta.heldActive", { count: data.activeDays })
        : bestDay
        ? tEmail(lang, "weekly.delta.heldBestDay", { day: weekdayOf(bestDay.date, lang) })
        : "";
      const lighter = tEmail(lang, "weekly.delta.lighter", { points: fmtNum(lastWeek, lang) });
      deltaHtml = `${held ? `<span style="color:#e8e8e8;">${held}</span> ` : ""}${lighter}`;
      deltaText = `${held ? held + " " : ""}${lighter}`;
    } else {
      deltaHtml = tEmail(lang, "weekly.delta.levelHtml");
      deltaText = tEmail(lang, "weekly.delta.level");
    }
  } else if (points > 0 && data.isFirstWeek) {
    const first = tEmail(lang, "weekly.delta.firstWeek");
    const startsHere = tEmail(lang, "weekly.delta.startsHere");
    deltaHtml = `<span style="color:${GOLD};">${first}</span> ${startsHere}`;
    deltaText = `${first} ${startsHere}`;
  } else if (points > 0 && lastWeek === 0) {
    deltaHtml = `<span style="color:${GOLD};">${tEmail(lang, "weekly.delta.backHtml")}</span>`;
    deltaText = tEmail(lang, "weekly.delta.back");
  }

  // ── The week at a glance: M T W T F S S, gold = active that day ──
  const dayStripHtml = days.length === 7
    ? (() => {
        const cells = days.map((d) => {
          const letter = weekdayLetter(d.date, lang);
          const isBest = bestDay?.date === d.date;
          const dot = d.active || d.points > 0
            ? `background-color:${GOLD};border:1px solid ${GOLD};color:#080808;font-weight:700;`
            : `background-color:#0e0e0e;border:1px solid #2a2a2a;color:#666666;font-weight:400;`;
          return `
                <td align="center" valign="top" style="padding:0 2px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
                    <tr><td width="34" height="34" align="center" valign="middle" style="width:34px;height:34px;border-radius:17px;font-size:12px;line-height:34px;text-align:center;font-family:${FONT};${dot}">${letter}</td></tr>
                  </table>
                  <span style="display:block;margin-top:7px;font-size:10px;font-weight:${isBest ? 700 : 400};color:${isBest ? GOLD : "#666666"};font-family:${FONT};">${d.points > 0 ? fmtNum(d.points, lang) : "&ndash;"}</span>
                </td>`;
        }).join("");
        const bestLine = bestDay
          ? `<p style="margin:16px 0 0;font-size:13px;font-weight:300;color:#999999;text-align:center;font-family:${FONT};">${tEmail(lang, "weekly.bestDayHtml", { day: `<span style="color:#e8e8e8;font-weight:500;">${weekdayOf(bestDay.date, lang)}</span>` })} &middot; <span style="color:${GOLD};font-weight:600;">${fmtNum(bestDay.points, lang)} POWR</span></p>`
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
            activityLabel(a.type, lang),
            String(a.count),
            tEmail(lang, "weekly.sessionUnit", { count: a.count }),
            deltaChip(a.count, a.prevCount, "abs", lang),
          )
        );
        if (hasSteps) {
          rows.push(
            row(
              activityIconUrl("walking"),
              tEmail(lang, "weekly.steps"),
              fmtNum(data.steps!, lang),
              tEmail(lang, "weekly.stepsUnit"),
              deltaChip(data.steps!, data.prevSteps, "pct", lang),
            ),
          );
        }
        if (hasDistance) {
          rows.push(row(activityIconUrl("running"), tEmail(lang, "weekly.distance"), fmtNum(data.distanceKm!, lang), "km", ""));
        }
        // Where the numbers came from — or, with nothing connected, the one nudge
        // that makes every later email richer.
        const sourceLine = data.wearable
          ? `<p style="margin:14px 0 0;font-size:12px;font-weight:300;color:#777777;font-family:${FONT};"><span style="color:${GOLD};">&#9679;</span>&nbsp; ${tEmail(lang, "weekly.syncedFrom", { wearable: esc(data.wearable) })}</p>`
          : `<p style="margin:14px 0 0;font-size:12px;font-weight:300;color:#999999;font-family:${FONT};">${tEmail(lang, "weekly.noWearableHtml", { link: `<a href="https://powr.life/app?to=wearables" style="color:${GOLD};text-decoration:underline;">`, end: "</a>" })}</p>`;
        return `
        <tr>
          <td class="sec" style="background-color:#080808;padding:26px 40px 28px;border-bottom:1px solid #111111;">
            ${sectionLabel(tEmail(lang, "weekly.howYouMoved"))}
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
          ? `${activityLabel(ls.type, lang)} &middot; ${esc(ls.partner)}`
          : activityLabel(ls.type, lang);
        return `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:30px 40px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="vertical-align:middle;">
                  ${sectionLabel(tEmail(lang, "weekly.longest"))}
                  <span style="display:block;margin-top:10px;font-size:40px;font-weight:200;color:#F2F2F2;letter-spacing:-1.5px;line-height:1;font-family:${FONT};">${formatDuration(ls.durationSec, lang)}</span>
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
                    <td align="right" style="padding:11px 0;border-bottom:1px solid #161616;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#777777;font-family:${FONT};white-space:nowrap;">${tEmail(lang, "weekly.visitsHtml", { count: g.count })}</td>
                  </tr>`,
          )
          .join("");
        return `
        <tr>
          <td class="sec" style="background-color:#080808;padding:30px 40px;border-bottom:1px solid #111111;">
            ${sectionLabel(tEmail(lang, "weekly.whereYouTrained"))}
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
          ? `<span style="display:inline-block;margin:4px 6px 4px 0;padding:7px 14px;font-size:12px;font-weight:600;color:#777777;font-family:${FONT};">${tEmail(lang, "weekly.moreChallenges", { count: extra })}</span>`
          : "";
        return `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:30px 40px;border-bottom:1px solid #161616;">
            ${sectionLabel(tEmail(lang, "weekly.challengesCompleted"))}
            <span style="display:block;margin-top:10px;font-size:30px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;line-height:1;font-family:${FONT};">${tEmail(lang, "weekly.challengesCountHtml", { count: challengeCount, dim: '<span style="color:#666666;">', end: "</span>" })}</span>
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
  const valueOf = (r: WeeklyRewardTile): string => rewardValueLabel((r.valueLabel ?? "").trim(), lang);
  const brandValue = (r: WeeklyRewardTile): string => {
    const v = valueOf(r);
    return v ? `${esc(r.brand)}${r.brand ? " &middot; " : ""}${esc(v)}` : esc(r.brand);
  };
  const rewardWord = tEmail(lang, "common.reward");

  const rewardHtml = (topRewards.length || featuredReward || readyMode)
    ? (() => {
        // Three showcase logo tiles — logo contained in a fixed box + a reach line.
        const tiles = topRewards.slice(0, 3).map((r) => {
          const logo = rewardLogo(r);
          const inner = logo
            ? `<img src="${optimizeImage(logo, { width: 200, height: 200, resize: "contain" })}" alt="${esc(r.brand ?? rewardWord)}" style="display:block;max-width:58px;max-height:58px;width:auto;height:auto;margin:0 auto;">`
            : `<span style="display:block;font-size:24px;font-weight:700;color:#444444;font-family:${FONT};">${rewardInitial(r)}</span>`;
          const reach = balance >= r.cost
            ? `<span style="display:block;margin-top:4px;font-size:10px;font-weight:700;letter-spacing:0.5px;color:${GOLD};font-family:${FONT};">&#10003; ${tEmail(lang, "weekly.ready")}</span>`
            : `<span style="display:block;margin-top:4px;font-size:10px;font-weight:400;color:#777777;font-family:${FONT};">${tEmail(lang, "weekly.workoutsAway", { count: sessionsAway(r.cost, balance) })}</span>`;
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
                  <span style="display:block;margin-top:2px;font-size:11px;font-weight:700;color:${GOLD};font-family:${FONT};">${fmtNum(r.cost, lang)} POWR</span>
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
            ? `<img src="${optimizeImage((r.hero ?? r.image)!, { width: 1040, height: 380, resize: "cover" })}" alt="${esc(r.brand ?? rewardWord)}" width="520" style="display:block;width:100%;height:auto;border-radius:14px 14px 0 0;">`
            : "";
          const logoSrc = rewardLogo(r);
          const logo = logoSrc
            ? `<img src="${optimizeImage(logoSrc, { width: 120, height: 120, resize: "contain" })}" alt="${esc(r.brand ?? rewardWord)}" style="display:block;max-width:36px;max-height:36px;width:auto;height:auto;margin:0 auto;">`
            : `<span style="display:block;font-size:18px;font-weight:700;color:#666666;font-family:${FONT};">${rewardInitial(r)}</span>`;
          const status = affordable
            ? `<span style="display:block;margin-top:11px;font-size:12px;font-weight:700;color:${GOLD};font-family:${FONT};">&#10003; ${tEmail(lang, "weekly.canUnlockNow")}</span>`
            : `<span style="display:block;margin-top:11px;font-size:12px;font-weight:300;color:#999999;font-family:${FONT};"><span style="color:${GOLD};font-weight:600;">${fmtNum(toGo, lang)} POWR</span> &middot; ${tEmail(lang, "weekly.aboutWorkoutsAway", { count: sessionsAway(r.cost, balance) })}</span>`;
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
                        <span style="display:block;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${GOLD};font-family:${FONT};">${affordable ? (readyMode ? tEmail(lang, "weekly.bestValue") : tEmail(lang, "weekly.readyToUnlock")) : tEmail(lang, "weekly.closestReward")}</span>
                        <span style="display:block;margin-top:4px;font-size:15px;font-weight:500;color:#F2F2F2;font-family:${FONT};">${brandValue(r)}</span>
                      </td>
                      <td align="right" valign="middle" style="white-space:nowrap;">
                        <span style="font-size:18px;font-weight:300;color:${GOLD};letter-spacing:-0.5px;font-family:${FONT};">${fmtNum(r.cost, lang)}</span><span style="font-size:9px;font-weight:700;letter-spacing:1px;color:#A89900;font-family:${FONT};"> POWR</span>
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
            ? `<img src="${optimizeImage(logoSrc, { width: 100, height: 100, resize: "contain" })}" alt="${esc(r.brand ?? rewardWord)}" style="display:block;max-width:28px;max-height:28px;width:auto;height:auto;margin:0 auto;">`
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
                  <span style="display:block;margin-top:2px;font-size:11px;font-weight:${balance >= r.cost ? 700 : 300};color:${balance >= r.cost ? GOLD : "#888888"};font-family:${FONT};">${balance >= r.cost ? `&#10003; ${tEmail(lang, "weekly.ready")}` : tEmail(lang, "weekly.workoutsAway", { count: sessionsAway(r.cost, balance) })}</span>
                </td>
                <td align="right" valign="middle" style="padding:10px 14px 10px 0;white-space:nowrap;">
                  <span style="font-size:13px;font-weight:700;color:${GOLD};font-family:${FONT};">${fmtNum(r.cost, lang)} POWR</span>
                </td>
              </tr>
            </table>`;
        };

        const featuredHtml = featuredReward ? featuredCard(featuredReward) : "";
        const ladderHtml = ladderRest.map(compactRow).join("");

        if (readyMode) {
          const nextHtml = nextUp
            ? `<p style="margin:16px 0 0;font-size:12px;font-weight:300;color:#999999;text-align:center;font-family:${FONT};">${tEmail(lang, "weekly.nextUpHtml", { reward: `<span style="color:#e8e8e8;font-weight:500;">${brandValue(nextUp)}</span>` })} &middot; ${tEmail(lang, "weekly.aboutWorkoutsAway", { count: sessionsAway(nextUp.cost, balance) })}</p>`
            : "";
          return `
        <tr>
          <td class="sec" bgcolor="#080808" style="background-color:#080808;padding:30px 40px;border-bottom:1px solid #111111;">
            ${sectionLabel(tEmail(lang, "common.readyToRedeem"))}
            <span style="display:block;margin-top:10px;font-size:30px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;line-height:1.15;font-family:${FONT};">${tEmail(lang, "common.inYourBalanceHtml", { amount: `<span style="color:${GOLD};">${fmtNum(balance, lang)} POWR</span>` })}</span>
            <span style="display:block;margin-top:8px;font-size:14px;font-weight:300;color:#999999;line-height:1.5;font-family:${FONT};">${tEmail(lang, "common.enoughHtml", { count: affordableCount })}</span>
            ${featuredHtml}
            ${ladderHtml}
            <div style="margin-top:22px;">${ctaButton(tEmail(lang, "common.redeemReward"), "https://powr.life/app?to=rewards", "ghost")}</div>
            ${nextHtml}
          </td>
        </tr>`;
        }

        return `
        <tr>
          <td class="sec" bgcolor="#080808" style="background-color:#080808;padding:30px 40px;border-bottom:1px solid #111111;">
            ${sectionLabel(tEmail(lang, "weekly.rewardsInReach"))}
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
          ? tEmail(lang, "weekly.toNext", { amount: `<span style="color:${GOLD};font-weight:600;">${fmtNum(toGo, lang)} POWR</span>`, name: esc(lvl.nextName) })
          : tEmail(lang, "weekly.topOfLadder");
        const vaultLine = vaultBanked > 0
          ? `<p style="margin:14px 0 0;font-size:12px;font-weight:300;color:#999999;font-family:${FONT};">${tEmail(lang, "weekly.vaultHtml", { amount: `<span style="color:${GOLD};font-weight:600;">${fmtNum(vaultBanked, lang)} POWR</span>`, link: '<a href="https://powr.life/app?to=vault" style="color:#cccccc;text-decoration:underline;">', end: "</a>" })}</p>`
          : "";
        return `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:30px 40px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                ${art}
                <td valign="middle">
                  ${sectionLabel(`${tEmail(lang, "weekly.levelN", { level: lvl.level })} &middot; ${esc(lvl.tierLabel)}`, lvl.tierColor === GOLD ? undefined : lvl.tierColor)}
                  <span style="display:block;margin-top:6px;font-size:22px;font-weight:300;color:#F2F2F2;letter-spacing:-0.3px;line-height:1.2;font-family:${FONT};">${esc(lvl.name)}</span>
                </td>
                <td align="right" valign="middle" style="white-space:nowrap;">
                  <span style="font-size:18px;font-weight:300;color:#F2F2F2;letter-spacing:-0.5px;font-family:${FONT};">${fmtNum(lvl.totalEarned, lang)}</span><span style="font-size:9px;font-weight:700;letter-spacing:1px;color:#777777;font-family:${FONT};"> ${tEmail(lang, "weekly.allTimeHtml")}</span>
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
            <span style="display:block;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#555555;font-family:${FONT};">${tEmail(lang, "weekly.league.title")}</span>
            <span style="display:block;margin-top:8px;font-size:34px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;font-family:${FONT};">#${data.weeklyRank}</span>
            <span style="display:block;margin-top:6px;font-size:13px;font-weight:300;color:#888888;font-family:${FONT};">${tEmail(lang, "weekly.league.sub")}</span>
          </td>
        </tr>`
    : "";

  const preheader =
    points > 0
      ? deltaText
        ? tEmail(lang, "weekly.preheaderDelta", { points: fmtNum(points, lang), delta: deltaText })
        : tEmail(lang, "weekly.preheader", { points: fmtNum(points, lang) })
      : tEmail(lang, "weekly.preheaderEmpty");

  const referralUrl = data.referralCode ? `https://powr.life/?ref=${encodeURIComponent(data.referralCode)}` : "https://powr.life";

  const rows = `
        <!-- HERO -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:40px 40px 32px;text-align:center;border-bottom:1px solid #111111;">
            <span style="display:block;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#8F8203;font-family:${FONT};">${tEmail(lang, "weekly.yourWeek")} &middot; ${data.weekLabel}</span>
            <h1 class="hero-h1" style="margin:14px 0 0;font-size:34px;font-weight:200;letter-spacing:-0.5px;line-height:1.2;color:#F2F2F2;font-family:${FONT};">${tEmail(lang, "weekly.heroHtml", { newline: "<br>", name: firstName })}</h1>
          </td>
        </tr>

        <!-- POINTS -->
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:34px 40px;border-bottom:1px solid #161616;text-align:center;">
            <span class="points-num" style="display:block;font-size:72px;font-weight:200;color:${GOLD};letter-spacing:-3px;line-height:1;font-family:${FONT};">${fmtNum(points, lang)}</span>
            <span style="display:block;margin-top:6px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#8F8203;font-family:${FONT};">${tEmail(lang, "weekly.pointsLabel")}</span>
            ${deltaHtml ? `<p style="margin:14px 0 0;font-size:13px;font-weight:400;color:#999999;font-family:${FONT};">${deltaHtml}</p>` : ""}
          </td>
        </tr>

${dayStripHtml}
        <!-- STAT GRID -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 34px;border-bottom:1px solid #111111;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout:fixed;">
              <tr>
                ${statCell(String(data.workouts), tEmail(lang, "weekly.stats.workouts"))}
                ${statCell(`${data.activeDays}/7`, tEmail(lang, "weekly.stats.activeDays"))}
                ${statCell(String(data.currentStreak), tEmail(lang, "weekly.stats.streak"))}
              </tr>
            </table>
          </td>
        </tr>
${activityBreakdownHtml}${longestHtml}${gymsHtml}${challengesHtml}${levelHtml}${rewardHtml}${rankHtml}
        <!-- CTA -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:34px 40px;text-align:center;border-bottom:1px solid #161616;">
            <p style="margin:0 0 20px;font-size:14px;font-weight:300;color:#999999;line-height:1.6;font-family:${FONT};">${tEmail(lang, "weekly.closingHtml", { br: BR_DESKTOP })}</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:24px;background-color:${GOLD};">
                  <a href="https://powr.life/app" style="display:inline-block;padding:14px 32px;font-size:13px;font-weight:700;color:#080808;font-family:${FONT};text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">${tEmail(lang, "weekly.cta")}</a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-size:12px;font-weight:300;color:#888888;line-height:1.6;font-family:${FONT};">${tEmail(lang, "weekly.referralHtml", { link: `<a href="${referralUrl}" style="color:#999999;text-decoration:underline;">${tEmail(lang, "weekly.yourCode")}${data.referralCode ? ` ${esc(data.referralCode)}` : ""}</a>` })}</p>
          </td>
        </tr>`;

  const html = emailShell({ title: tEmail(lang, "weekly.title"), preheader, rows, lang });

  const lines: string[] = [
    tEmail(lang, "weekly.text.hero", { name: plainName, week: data.weekLabel }),
    ``,
    `${tEmail(lang, "weekly.text.points", { points: fmtNum(points, lang) })}${deltaText ? " " + deltaText : ""}`,
    ``,
    tEmail(lang, "weekly.text.workouts", { value: data.workouts }),
    tEmail(lang, "weekly.text.activeDays", { value: data.activeDays }),
    tEmail(lang, "weekly.text.streak", { value: data.currentStreak }),
  ];
  if (bestDay) {
    lines.push(tEmail(lang, "weekly.text.bestDay", { day: weekdayOf(bestDay.date, lang), points: fmtNum(bestDay.points, lang) }));
  }
  if (activities.length || hasSteps || hasDistance) {
    lines.push("", tEmail(lang, "weekly.text.howYouMoved"));
    for (const a of activities) {
      lines.push(`  - ${tEmail(lang, "weekly.text.activity", { activity: activityLabel(a.type, lang), count: a.count })}${deltaTextPart(a.count, a.prevCount, "abs", lang)}`);
    }
    if (hasSteps) {
      lines.push(`  - ${tEmail(lang, "weekly.text.steps", { steps: fmtNum(data.steps!, lang) })}${deltaTextPart(data.steps!, data.prevSteps, "pct", lang)}`);
    }
    if (hasDistance) lines.push(`  - ${tEmail(lang, "weekly.text.distance", { km: fmtNum(data.distanceKm!, lang) })}`);
    if (data.wearable) lines.push(`  ${tEmail(lang, "weekly.syncedFrom", { wearable: data.wearable })}`);
  }
  if (longest) {
    const ls = longest;
    const sub = ls.partner ? `${activityLabel(ls.type, lang)} · ${ls.partner}` : activityLabel(ls.type, lang);
    lines.push("", tEmail(lang, "weekly.text.longest", { duration: formatDuration(ls.durationSec, lang), detail: sub }));
  }
  if (data.gyms && data.gyms.length) {
    lines.push("", tEmail(lang, "weekly.text.whereYouTrained"));
    for (const g of data.gyms) lines.push(`  - ${tEmail(lang, "weekly.text.gym", { gym: g.name, count: g.count })}`);
  }
  if (challengeCount > 0) {
    const titles = data.challengeTitles ?? [];
    lines.push("", `${tEmail(lang, "weekly.text.challenges", { value: challengeCount })}${titles.length ? ` (${titles.join(", ")})` : ""}`);
  }
  if (lvl) {
    lines.push(
      "",
      `${tEmail(lang, "weekly.text.level", { level: lvl.level, name: lvl.name, points: fmtNum(lvl.totalEarned, lang) })}${
        lvl.nextName && lvl.nextAt != null
          ? ` — ${tEmail(lang, "weekly.toNext", { amount: `${fmtNum(Math.max(0, lvl.nextAt - lvl.totalEarned), lang)} POWR`, name: lvl.nextName })}`
          : ""
      }`,
    );
    if (vaultBanked > 0) lines.push(tEmail(lang, "weekly.text.vault", { amount: fmtNum(vaultBanked, lang) }));
  }
  if (readyMode) {
    lines.push(
      "",
      tEmail(lang, "weekly.text.ready", { amount: fmtNum(balance, lang), count: affordableCount }),
    );
    for (const r of rewardsReady.slice(0, 3)) {
      const v = valueOf(r);
      lines.push(`  - ${r.brand ?? rewardWord}${v ? ` · ${v}` : ""} — ${fmtNum(r.cost, lang)} POWR`);
    }
    lines.push(tEmail(lang, "weekly.text.redeem", { url: "https://powr.life/app?to=rewards" }));
  }
  if (!readyMode && topRewards.length) {
    lines.push("", tEmail(lang, "weekly.text.rewardsInReach"));
    for (const r of topRewards.slice(0, 3)) {
      const reach = balance >= r.cost ? tEmail(lang, "weekly.text.readyWord") : tEmail(lang, "weekly.workoutsAway", { count: sessionsAway(r.cost, balance) });
      lines.push(`  - ${r.brand ?? rewardWord} — ${fmtNum(r.cost, lang)} POWR (${reach})`);
    }
  }
  if (!readyMode && featuredReward) {
    const r = featuredReward;
    const v = valueOf(r);
    const label = `${r.brand ?? ""}${v ? ` · ${v}` : ""}`;
    if (balance >= r.cost) {
      lines.push("", tEmail(lang, "weekly.text.closestReady", { label, cost: fmtNum(r.cost, lang) }));
    } else {
      lines.push("", tEmail(lang, "weekly.text.closestToGo", { label, cost: fmtNum(r.cost, lang), toGo: fmtNum(Math.max(0, r.cost - balance), lang), count: sessionsAway(r.cost, balance) }));
    }
    for (const u of ladderRest) {
      const uv = valueOf(u);
      lines.push(`  ${tEmail(lang, "weekly.text.then", { label: `${u.brand ?? ""}${uv ? ` · ${uv}` : ""}`, cost: fmtNum(u.cost, lang), count: sessionsAway(u.cost, balance) })}`);
    }
  }
  if (SHOW_LEAGUE_FINISH && data.weeklyRank) {
    lines.push("", tEmail(lang, "weekly.text.league", { rank: data.weeklyRank }));
  }
  lines.push(
    "",
    tEmail(lang, "weekly.text.closing", { url: "https://powr.life/app" }),
    "",
    tEmail(lang, "weekly.text.referral", { code: `${tEmail(lang, "weekly.yourCode")}${data.referralCode ? ` ${data.referralCode}` : ""}` }),
    `${referralUrl}`,
    "",
    tEmail(lang, "common.everyMoveCounts"),
    "— POWR",
    "https://powr.life",
  );

  const subject =
    points > 0
      ? upPct !== null
        ? tEmail(lang, "weekly.subjectUp", { count: points, points: fmtNum(points, lang), pct: upPct })
        : tEmail(lang, "weekly.subject", { count: points, points: fmtNum(points, lang) })
      : tEmail(lang, "weekly.subjectEmpty");

  return { subject, html, text: lines.join("\n") };
}

// Re-engagement email — for members who have gone quiet, or never got going.
//
// Two audiences, two stages each (see send-reengagement-email):
//   lapsed        — active before, nothing logged for 7 (stage 1) / 21 (stage 2) days
//   never_started — finished onboarding, nothing logged 3 (stage 1) / 14 (stage 2) days on
// Leads with what they already have (balance, rewards in reach), then the
// no-effort ways back in. Never guilt, never hustle — see POWR_Brand_Narrative.

import { ctaButton, emailShell, esc, FONT, GOLD, optimizeImage, sectionLabel } from "./layout.ts";
import type { WeeklyRewardTile } from "./weekly-summary.ts";

export interface ReEngagementData {
  name: string | null;
  variant: "lapsed" | "never_started";
  stage: 1 | 2;
  /** lapsed: days since last activity. never_started: days since signup. */
  daysAway: number;
  balance: number;
  /** Lifetime POWR earned (positive ledger). */
  lifetimeEarned: number;
  /** Rewards the balance covers now, best value first. */
  rewardsReady: WeeklyRewardTile[];
  /** Cheapest reward above the balance, if any. */
  closestReward: WeeklyRewardTile | null;
  locationGranted: boolean;
  /** Connected health source label ("Whoop", "Apple Health"…) or null. */
  wearable: string | null;
}

// Rough POWR per workout — same basis as the weekly's "≈ N workouts away".
const POINTS_PER_SESSION = 10;

function sessionsAway(cost: number, balance: number): number {
  return Math.max(1, Math.ceil(Math.max(0, cost - balance) / POINTS_PER_SESSION));
}

function brandValue(r: WeeklyRewardTile): string {
  const v = (r.valueLabel ?? "").trim();
  return v ? `${esc(r.brand)}${r.brand ? " &middot; " : ""}${esc(v)}` : esc(r.brand ?? r.title);
}

function brandValueText(r: WeeklyRewardTile): string {
  const v = (r.valueLabel ?? "").trim();
  return v ? `${r.brand ?? ""}${r.brand ? " · " : ""}${v}` : (r.brand ?? r.title ?? "a reward");
}

function rewardRow(r: WeeklyRewardTile, balance: number): string {
  const logoSrc = r.image ?? r.hero ?? null;
  const logo = logoSrc
    ? `<img src="${esc(optimizeImage(logoSrc, { width: 100, height: 100, resize: "contain" }))}" alt="${esc(r.brand ?? "Reward")}" style="display:block;max-width:28px;max-height:28px;width:auto;height:auto;margin:0 auto;">`
    : `<span style="display:block;font-size:14px;font-weight:700;color:#666666;font-family:${FONT};">${esc((r.brand ?? "?").trim().charAt(0).toUpperCase())}</span>`;
  const ready = balance >= r.cost;
  const status = ready
    ? `&#10003; Ready to redeem`
    : `${(r.cost - balance).toLocaleString()} POWR to go &middot; about ${sessionsAway(r.cost, balance)} sessions`;
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
                  <span style="display:block;margin-top:2px;font-size:11px;font-weight:${ready ? 700 : 300};color:${ready ? GOLD : "#888888"};font-family:${FONT};">${status}</span>
                </td>
                <td align="right" valign="middle" style="padding:10px 14px 10px 0;white-space:nowrap;">
                  <span style="font-size:13px;font-weight:700;color:${GOLD};font-family:${FONT};">${r.cost.toLocaleString()} POWR</span>
                </td>
              </tr>
            </table>`;
}

/** One "way back in" line: gold tick when already set up, hollow ring when not. */
function wayRow(done: boolean, title: string, sub: string, isLast: boolean): string {
  const marker = done
    ? `<table role="presentation" width="20" height="20" cellspacing="0" cellpadding="0" border="0" style="width:20px;height:20px;border-radius:50%;background-color:${GOLD};"><tr><td align="center" style="font-size:12px;font-weight:700;color:#080808;line-height:20px;font-family:${FONT};">&#10003;</td></tr></table>`
    : `<table role="presentation" width="20" height="20" cellspacing="0" cellpadding="0" border="0" style="width:20px;height:20px;border-radius:50%;border:1px solid #333333;"><tr><td style="font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${isLast ? "" : ' style="border-bottom:1px solid #161616;"'}>
              <tr>
                <td style="padding:14px 0;width:26px;vertical-align:middle;">${marker}</td>
                <td style="padding:14px 0 14px 14px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:500;color:${done ? "#F2F2F2" : "#cccccc"};font-family:${FONT};">${esc(title)}</p>
                  <p style="margin:2px 0 0;font-size:12px;font-weight:300;color:#888888;font-family:${FONT};">${esc(sub)}</p>
                </td>
              </tr>
            </table>`;
}

export function reEngagementEmail(data: ReEngagementData): { subject: string; html: string; text: string } {
  const plainName = data.name?.trim().split(" ")[0] || "there";
  const firstName = esc(plainName);
  const balance = Math.max(0, Math.round(data.balance));
  const ready = data.rewardsReady.slice(0, 3);
  const canRedeem = ready.length > 0;
  const featured = canRedeem ? ready[0] : data.closestReward;
  const lapsed = data.variant === "lapsed";

  // ── Copy ───────────────────────────────────────────────────────────
  // Plain text is the source; the HTML heading adds line breaks and emphasis.
  let subject: string;
  let preheader: string;
  let headingHtml: string;
  let headingText: string;
  let bodyText: string;

  if (lapsed) {
    const earned = data.lifetimeEarned.toLocaleString();
    if (data.stage === 1) {
      subject = canRedeem
        ? `${plainName}, your ${balance.toLocaleString()} POWR is ready to spend`
        : `${plainName}, your ${balance.toLocaleString()} POWR is still here`;
      headingText = `Still yours, ${plainName}.`;
      headingHtml = `Still yours,&nbsp;${firstName}.`;
      bodyText = `You've earned ${earned} POWR so far — every bit of it still in your balance. Whenever you pick things back up, it keeps building from here.`;
    } else {
      subject = `${plainName}, pick up where you left off`;
      headingText = `Pick up where you left off.`;
      headingHtml = `Pick up where<br class="br-d"> you left off.`;
      bodyText = `${data.daysAway} days since your last session. The ${earned} POWR you earned hasn't gone anywhere, and your next session counts the moment it's logged.`;
    }
    preheader = canRedeem
      ? `Enough for ${brandValueText(ready[0])} right now.`
      : featured
        ? `${(featured.cost - balance).toLocaleString()} POWR from ${brandValueText(featured)}.`
        : `Everything you've earned is still in your balance.`;
  } else {
    if (data.stage === 1) {
      subject = `${plainName}, you already move. Let it count.`;
      headingText = `You already move. Let it count.`;
      headingHtml = `You already move.<br><em style="font-style:italic;color:${GOLD};">Let it count.</em>`;
      bodyText = `Nothing's been logged yet — so the gym visits, runs and walks you're already doing aren't earning. Your first session changes that.`;
    } else {
      subject = `${plainName}, your first rewards are a few sessions away`;
      headingText = `Your first reward is closer than it looks.`;
      headingHtml = `Your first reward<br class="br-d"> is closer than it looks.`;
      bodyText = `You joined POWR ${data.daysAway} days ago. One session gets your balance moving — from there, rewards come into reach fast.`;
    }
    preheader = featured
      ? `${balance.toLocaleString()} POWR already banked. ${brandValueText(featured)} is about ${sessionsAway(featured.cost, balance)} sessions away.`
      : `Your first session is the one that gets things moving.`;
  }

  // ── Sections ───────────────────────────────────────────────────────
  const hero = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:44px 40px 36px;text-align:center;border-bottom:1px solid #111111;">
            <h1 class="hero-h1" style="margin:0;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.18;color:#F2F2F2;font-family:${FONT};">${headingHtml}</h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#999999;line-height:1.7;font-family:${FONT};">${esc(bodyText)}</p>
          </td>
        </tr>`;

  const balanceCard = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:30px 40px;border-bottom:1px solid #161616;">
            ${sectionLabel(canRedeem ? "Ready to redeem" : "Your balance")}
            <span style="display:block;margin-top:10px;font-size:30px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;line-height:1.15;font-family:${FONT};"><span style="color:${GOLD};">${balance.toLocaleString()} POWR</span> in your balance</span>
            <span style="display:block;margin-top:8px;font-size:14px;font-weight:300;color:#999999;line-height:1.5;font-family:${FONT};">${
              canRedeem
                ? `Enough for ${data.rewardsReady.length === 1 ? "a reward" : `${data.rewardsReady.length} rewards`} right now. Earned, not given &mdash; spend it.`
                : featured
                  ? `Your next reward is in reach.`
                  : `Every session adds to it.`
            }</span>
            ${canRedeem ? ready.map((r) => rewardRow(r, balance)).join("") : featured ? rewardRow(featured, balance) : ""}
            ${canRedeem ? `<div style="margin-top:22px;">${ctaButton("Redeem a reward", "https://powr.life/app?to=rewards", "ghost")}</div>` : ""}
          </td>
        </tr>`;

  // Plain text; wayRow escapes for HTML.
  const ways: { done: boolean; title: string; sub: string }[] = [
    {
      done: data.locationGranted,
      title: data.locationGranted ? "Gym visits count on their own" : "Turn on location",
      sub: data.locationGranted ? "Walk in, train, walk out — the visit is logged for you." : "So your gym visits log themselves, no tapping start.",
    },
    {
      done: !!data.wearable,
      title: data.wearable ? `Workouts sync from ${data.wearable}` : "Connect a wearable",
      sub: data.wearable ? "Anything you record there lands in POWR." : "Apple Health, Whoop, Garmin, Oura & more.",
    },
  ];
  // Steps only reach POWR through a connected health source.
  if (data.wearable) {
    ways.push({ done: true, title: "Walks count too", sub: "Your daily steps earn, whatever else the week looks like." });
  }
  const waysCard = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 12px;border-bottom:1px solid #111111;">
            ${sectionLabel(lapsed ? "The easy way back" : "How your first points land", "#777777")}
            <div style="margin-top:6px;">${ways.map((w, i) => wayRow(w.done, w.title, w.sub, i === ways.length - 1)).join("")}</div>
          </td>
        </tr>`;

  const cta = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:34px 40px;text-align:center;border-bottom:1px solid #161616;">
            ${ctaButton("Open POWR", "https://powr.life/app")}
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};">Every move counts.</p>
          </td>
        </tr>`;

  const rows = lapsed ? hero + balanceCard + waysCard + cta : hero + waysCard + balanceCard + cta;
  const html = emailShell({ title: "POWR", preheader, rows });

  // ── Plain text ─────────────────────────────────────────────────────
  const rewardLines = (canRedeem ? ready : featured ? [featured] : [])
    .map((r) => `  - ${brandValueText(r)}: ${r.cost.toLocaleString()} POWR${balance >= r.cost ? " (ready)" : ` (${(r.cost - balance).toLocaleString()} to go)`}`)
    .join("\n");
  const text = `${headingText}

${bodyText}

Balance: ${balance.toLocaleString()} POWR
${rewardLines}

${ways.map((w) => `  [${w.done ? "x" : " "}] ${w.title} — ${w.sub}`).join("\n")}

Open POWR: https://powr.life/app

Every move counts.
— POWR`;

  return { subject, html, text };
}

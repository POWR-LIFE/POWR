// Re-engagement email — for members who have gone quiet, or never got going.
//
// Two audiences, two stages each (see send-reengagement-email):
//   lapsed        — active before, nothing logged for 7 (stage 1) / 21 (stage 2) days
//   never_started — finished onboarding, nothing logged 3 (stage 1) / 14 (stage 2) days on
// Leads with what they already have (balance, rewards in reach), then the
// no-effort ways back in. Never guilt, never hustle — see POWR_Brand_Narrative.

import { tEmail } from "../i18n/index.ts";
import { ctaButton, emailShell, esc, FONT, GOLD, optimizeImage, sectionLabel } from "./layout.ts";
import { BR_DESKTOP, firstNameOf, fmtNum, rewardValueLabel } from "./member-copy.ts";
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
  /**
   * Comeback offer (lapsed only): the first N POWR they earn back count
   * double. Absent = the email renders exactly as before — nothing sends this
   * until Comeback is built server-side.
   */
  comeback?: { doubleUpTo: number; validDays: number } | null;
}

// Rough POWR per workout — same basis as the weekly's "≈ N workouts away".
const POINTS_PER_SESSION = 10;

function sessionsAway(cost: number, balance: number): number {
  return Math.max(1, Math.ceil(Math.max(0, cost - balance) / POINTS_PER_SESSION));
}

function brandValue(r: WeeklyRewardTile, lang: string): string {
  const v = rewardValueLabel((r.valueLabel ?? "").trim(), lang);
  return v ? `${esc(r.brand)}${r.brand ? " &middot; " : ""}${esc(v)}` : esc(r.brand ?? r.title);
}

function brandValueText(r: WeeklyRewardTile, lang: string): string {
  const v = rewardValueLabel((r.valueLabel ?? "").trim(), lang);
  return v ? `${r.brand ?? ""}${r.brand ? " · " : ""}${v}` : (r.brand ?? r.title ?? tEmail(lang, "reengagement.aReward"));
}

function rewardRow(r: WeeklyRewardTile, balance: number, lang: string): string {
  const logoSrc = r.image ?? r.hero ?? null;
  const logo = logoSrc
    ? `<img src="${esc(optimizeImage(logoSrc, { width: 100, height: 100, resize: "contain" }))}" alt="${esc(r.brand ?? tEmail(lang, "common.reward"))}" style="display:block;max-width:28px;max-height:28px;width:auto;height:auto;margin:0 auto;">`
    : `<span style="display:block;font-size:14px;font-weight:700;color:#666666;font-family:${FONT};">${esc((r.brand ?? "?").trim().charAt(0).toUpperCase())}</span>`;
  const ready = balance >= r.cost;
  const status = ready
    ? `&#10003; ${tEmail(lang, "reengagement.rowReady")}`
    : tEmail(lang, "reengagement.toGoHtml", { amount: fmtNum(r.cost - balance, lang), count: sessionsAway(r.cost, balance) });
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px;background-color:#0c0c0c;border:1px solid #1c1c1c;border-radius:12px;">
              <tr>
                <td width="56" valign="middle" style="padding:10px 0 10px 12px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="background-color:#161616;border:1px solid #242424;border-radius:8px;">
                    <tr><td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;text-align:center;">${logo}</td></tr>
                  </table>
                </td>
                <td valign="middle" style="padding:10px 12px;">
                  <span style="display:block;font-size:13px;font-weight:500;color:#e8e8e8;font-family:${FONT};">${brandValue(r, lang)}</span>
                  <span style="display:block;margin-top:2px;font-size:11px;font-weight:${ready ? 700 : 300};color:${ready ? GOLD : "#888888"};font-family:${FONT};">${status}</span>
                </td>
                <td align="right" valign="middle" style="padding:10px 14px 10px 0;white-space:nowrap;">
                  <span style="font-size:13px;font-weight:700;color:${GOLD};font-family:${FONT};">${fmtNum(r.cost, lang)} POWR</span>
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

export function reEngagementEmail(data: ReEngagementData, lang = "en"): { subject: string; html: string; text: string } {
  const plainName = firstNameOf(data.name, lang);
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
    const earned = fmtNum(data.lifetimeEarned, lang);
    if (data.stage === 1) {
      subject = canRedeem
        ? tEmail(lang, "reengagement.lapsed1.subjectReady", { name: plainName, balance: fmtNum(balance, lang) })
        : tEmail(lang, "reengagement.lapsed1.subject", { name: plainName, balance: fmtNum(balance, lang) });
      headingText = tEmail(lang, "reengagement.lapsed1.heading", { name: plainName });
      headingHtml = tEmail(lang, "reengagement.lapsed1.headingHtml", { name: firstName });
      bodyText = tEmail(lang, "reengagement.lapsed1.body", { earned });
    } else {
      subject = tEmail(lang, "reengagement.lapsed2.subject", { name: plainName });
      headingText = tEmail(lang, "reengagement.lapsed2.heading");
      headingHtml = tEmail(lang, "reengagement.lapsed2.headingHtml", { br: BR_DESKTOP });
      bodyText = tEmail(lang, "reengagement.lapsed2.body", { count: data.daysAway, earned });
    }
    preheader = canRedeem
      ? tEmail(lang, "reengagement.lapsedPreheader.ready", { reward: brandValueText(ready[0], lang) })
      : featured
        ? tEmail(lang, "reengagement.lapsedPreheader.closest", { amount: fmtNum(featured.cost - balance, lang), reward: brandValueText(featured, lang) })
        : tEmail(lang, "reengagement.lapsedPreheader.none");
  } else {
    if (data.stage === 1) {
      subject = tEmail(lang, "reengagement.new1.subject", { name: plainName });
      const line1 = tEmail(lang, "reengagement.new1.heading1");
      const line2 = tEmail(lang, "reengagement.new1.heading2");
      headingText = `${line1} ${line2}`;
      headingHtml = `${line1}<br><em style="font-style:italic;color:${GOLD};">${line2}</em>`;
      bodyText = tEmail(lang, "reengagement.new1.body");
    } else {
      subject = tEmail(lang, "reengagement.new2.subject", { name: plainName });
      headingText = tEmail(lang, "reengagement.new2.heading");
      headingHtml = tEmail(lang, "reengagement.new2.headingHtml", { br: BR_DESKTOP });
      bodyText = tEmail(lang, "reengagement.new2.body", { count: data.daysAway });
    }
    preheader = featured
      ? tEmail(lang, "reengagement.newPreheader.closest", { balance: fmtNum(balance, lang), reward: brandValueText(featured, lang), count: sessionsAway(featured.cost, balance) })
      : tEmail(lang, "reengagement.newPreheader.none");
  }

  // Comeback leads the email when it's on: the offer is the news, the balance
  // is the reassurance underneath it.
  const comeback = lapsed && data.comeback ? data.comeback : null;
  if (comeback) {
    subject = `${plainName}, your comeback counts double`;
    preheader = `Your first ${comeback.doubleUpTo} POWR back count twice. Any session in the next ${comeback.validDays} days starts it.`;
  }

  // ── Sections ───────────────────────────────────────────────────────
  const hero = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:44px 40px 36px;text-align:center;border-bottom:1px solid #111111;">
            <h1 class="hero-h1" style="margin:0;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.18;color:#F2F2F2;font-family:${FONT};">${headingHtml}</h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#999999;line-height:1.7;font-family:${FONT};">${esc(bodyText)}</p>
          </td>
        </tr>`;

  const comebackCard = comeback
    ? `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:32px 40px 34px;text-align:center;border-bottom:1px solid #161616;">
            ${sectionLabel("Comeback", GOLD)}
            <span style="display:block;margin-top:8px;font-size:72px;font-weight:200;color:${GOLD};letter-spacing:-2px;line-height:1.05;font-family:${FONT};">2&times;</span>
            <span style="display:block;margin-top:4px;font-size:12px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#F2F2F2;font-family:${FONT};">Your first ${comeback.doubleUpTo} POWR back</span>
            <span style="display:block;margin-top:14px;font-size:14px;font-weight:300;color:#999999;line-height:1.6;font-family:${FONT};">Any session in the next ${comeback.validDays} days starts it &mdash; a gym visit, a run, a walk.<br class="br-d"> No streak to rebuild first. Just the next move.</span>
            <div style="margin-top:24px;">${ctaButton("Start my comeback", "https://powr.life/app")}</div>
          </td>
        </tr>`
    : "";

  const balanceCard = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:30px 40px;border-bottom:1px solid #161616;">
            ${sectionLabel(canRedeem ? tEmail(lang, "common.readyToRedeem") : tEmail(lang, "reengagement.yourBalance"))}
            <span style="display:block;margin-top:10px;font-size:30px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;line-height:1.15;font-family:${FONT};">${tEmail(lang, "common.inYourBalanceHtml", { amount: `<span style="color:${GOLD};">${fmtNum(balance, lang)} POWR</span>` })}</span>
            <span style="display:block;margin-top:8px;font-size:14px;font-weight:300;color:#999999;line-height:1.5;font-family:${FONT};">${
              canRedeem
                ? tEmail(lang, "common.enoughHtml", { count: data.rewardsReady.length })
                : featured
                  ? tEmail(lang, "reengagement.nextInReach")
                  : tEmail(lang, "reengagement.everySession")
            }</span>
            ${canRedeem ? ready.map((r) => rewardRow(r, balance, lang)).join("") : featured ? rewardRow(featured, balance, lang) : ""}
            ${canRedeem ? `<div style="margin-top:22px;">${ctaButton(tEmail(lang, "common.redeemReward"), "https://powr.life/app?to=rewards", "ghost")}</div>` : ""}
          </td>
        </tr>`;

  // Plain text; wayRow escapes for HTML.
  const ways: { done: boolean; title: string; sub: string }[] = [
    {
      done: data.locationGranted,
      title: data.locationGranted ? tEmail(lang, "reengagement.ways.locationOn") : tEmail(lang, "reengagement.ways.locationOff"),
      sub: data.locationGranted ? tEmail(lang, "reengagement.ways.locationOnSub") : tEmail(lang, "reengagement.ways.locationOffSub"),
    },
    {
      done: !!data.wearable,
      title: data.wearable ? tEmail(lang, "reengagement.ways.wearableOn", { wearable: data.wearable }) : tEmail(lang, "reengagement.ways.wearableOff"),
      sub: data.wearable ? tEmail(lang, "reengagement.ways.wearableOnSub") : tEmail(lang, "reengagement.ways.wearableOffSub"),
    },
  ];
  // Steps only reach POWR through a connected health source.
  if (data.wearable) {
    ways.push({ done: true, title: tEmail(lang, "reengagement.ways.walks"), sub: tEmail(lang, "reengagement.ways.walksSub") });
  }
  const waysCard = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 12px;border-bottom:1px solid #111111;">
            ${sectionLabel(lapsed ? tEmail(lang, "reengagement.waysTitleLapsed") : tEmail(lang, "reengagement.waysTitleNew"), "#777777")}
            <div style="margin-top:6px;">${ways.map((w, i) => wayRow(w.done, w.title, w.sub, i === ways.length - 1)).join("")}</div>
          </td>
        </tr>`;

  const cta = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:34px 40px;text-align:center;border-bottom:1px solid #161616;">
            ${ctaButton(tEmail(lang, "common.openPowr"), "https://powr.life/app", comeback ? "ghost" : "primary")}
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};">${tEmail(lang, "common.everyMoveCounts")}</p>
          </td>
        </tr>`;

  const rows = lapsed ? hero + comebackCard + balanceCard + waysCard + cta : hero + waysCard + balanceCard + cta;
  const html = emailShell({ title: "POWR", preheader, rows, lang });

  // ── Plain text ─────────────────────────────────────────────────────
  const rewardLines = (canRedeem ? ready : featured ? [featured] : [])
    .map((r) => `  - ${tEmail(lang, "reengagement.text.rewardLine", {
      reward: brandValueText(r, lang),
      cost: fmtNum(r.cost, lang),
      status: balance >= r.cost ? tEmail(lang, "reengagement.text.ready") : tEmail(lang, "reengagement.text.toGo", { amount: fmtNum(r.cost - balance, lang) }),
    })}`)
    .join("\n");
  const comebackText = comeback
    ? `\nCOMEBACK: 2x your first ${comeback.doubleUpTo} POWR back. Any session in the next ${comeback.validDays} days starts it.\n`
    : "";
  const text = `${headingText}

${bodyText}
${comebackText}
${tEmail(lang, "reengagement.text.balance", { amount: fmtNum(balance, lang) })}
${rewardLines}

${ways.map((w) => `  [${w.done ? "x" : " "}] ${w.title} — ${w.sub}`).join("\n")}

${tEmail(lang, "common.text.openPowr", { url: "https://powr.life/app" })}

${tEmail(lang, "common.everyMoveCounts")}
— POWR`;

  return { subject, html, text };
}

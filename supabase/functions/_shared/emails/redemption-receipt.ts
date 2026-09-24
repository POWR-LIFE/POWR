// Redemption receipt — sent the moment a member redeems a reward, so the code
// (or shop link) lives in their inbox as well as their wallet. Transactional:
// no unsubscribe link, no preference gate.

import { ctaButton, emailShell, esc, FONT, GOLD, optimizeImage, sectionLabel } from "./layout.ts";

export interface RedemptionReceiptData {
  name: string | null;
  rewardTitle: string;
  brand: string | null;
  /** Discount badge, e.g. "£15 OFF" / "20% OFF". */
  valueLabel: string | null;
  /** AFFILIATE rewards have no code — the link is the reward. */
  integrationType: string | null;
  /** The code to use at checkout (null for affiliate links). */
  code: string | null;
  checkoutUrl: string | null;
  expiresAt: string | null;
  powrSpent: number;
  balanceAfter: number | null;
  terms: string | null;
  imageUrl: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
}

export function redemptionReceiptEmail(data: RedemptionReceiptData): { subject: string; html: string; text: string } {
  const plainName = data.name?.trim().split(" ")[0] || "there";
  const brand = data.brand?.trim() || null;
  const isLink = data.integrationType === "AFFILIATE" || !data.code;
  const offer = [brand, data.valueLabel?.trim()].filter(Boolean).join(" · ") || data.rewardTitle;
  const expires = data.expiresAt ? formatDate(data.expiresAt) : null;
  // Reward titles are often just the brand or the discount ("HUEL", "£15 off"),
  // so only show the title when it says something the offer line doesn't.
  const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9%£]/g, "");
  const showTitle = !!data.rewardTitle && !norm(offer).includes(norm(data.rewardTitle));
  // Only a checkout link built around the code actually applies it.
  const linkApplies = !!(data.checkoutUrl && data.code && data.checkoutUrl.includes(data.code));

  const subject = isLink
    ? `Your ${brand ?? "POWR"} reward is ready`
    : `Your ${brand ?? "POWR"} code: ${data.code}`;
  const preheader = isLink
    ? `${offer} — your link is inside${expires ? `, valid until ${expires}` : ""}.`
    : `${offer} — use it at checkout${expires ? ` by ${expires}` : ""}.`;

  const logo = data.imageUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 22px;background-color:#141414;border:1px solid #242424;border-radius:14px;">
              <tr><td width="72" height="72" align="center" valign="middle" style="width:72px;height:72px;text-align:center;">
                <img src="${optimizeImage(data.imageUrl, { width: 160, height: 160, resize: "contain" })}" alt="${esc(brand ?? "Reward")}" style="display:block;max-width:48px;max-height:48px;width:auto;height:auto;margin:0 auto;">
              </td></tr>
            </table>`
    : "";

  const hero = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:40px 40px 32px;text-align:center;border-bottom:1px solid #111111;">
            ${logo}
            <h1 class="hero-h1" style="margin:0;font-size:36px;font-weight:200;letter-spacing:0.5px;line-height:1.2;color:#F2F2F2;font-family:${FONT};">Earned,&nbsp;${esc(plainName)}.<br><em style="font-style:italic;color:${GOLD};">It's yours.</em></h1>
            <p style="margin:16px 0 0;font-size:15px;font-weight:500;color:#dddddd;line-height:1.6;font-family:${FONT};">${esc(offer)}</p>
            ${showTitle ? `<p style="margin:4px 0 0;font-size:13px;font-weight:300;color:#888888;font-family:${FONT};">${esc(data.rewardTitle)}</p>` : ""}
          </td>
        </tr>`;

  const codeBlock = isLink
    ? `
            <p style="margin:0 0 20px;font-size:14px;font-weight:300;color:#aaaaaa;line-height:1.6;font-family:${FONT};">Your reward is applied through your POWR link &mdash; no code to copy.</p>
            ${data.checkoutUrl ? ctaButton(`Shop ${esc(brand ?? "now")}`, data.checkoutUrl) : ""}`
    : `
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 20px;">
              <tr>
                <td style="border:1px dashed #3a3a2a;border-radius:10px;background-color:#161608;padding:16px 28px;">
                  <span style="font-size:26px;font-weight:700;letter-spacing:4px;color:${GOLD};font-family:'Courier New',Courier,monospace;">${esc(data.code)}</span>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 ${data.checkoutUrl ? "22px" : "0"};font-size:13px;font-weight:300;color:#aaaaaa;line-height:1.6;font-family:${FONT};">${
              linkApplies
                ? "Tap below and it's applied for you, or enter it at checkout."
                : `Enter it at checkout${brand ? ` on ${esc(brand)}` : ""}.`
            }</p>
            ${data.checkoutUrl ? ctaButton(linkApplies ? "Use it now" : `Shop ${esc(brand ?? "now")}`, data.checkoutUrl) : ""}`;

  const codeCard = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:32px 40px;text-align:center;border-bottom:1px solid #161616;">
            ${sectionLabel(isLink ? "Your link" : "Your code")}
            <div style="margin-top:16px;">${codeBlock}</div>
            ${expires ? `<p style="margin:18px 0 0;font-size:12px;font-weight:500;color:#999999;font-family:${FONT};">Valid until ${expires}</p>` : ""}
          </td>
        </tr>`;

  const summaryCell = (label: string, value: string) => `
                <td width="50%" align="center" valign="top" style="padding:0 6px;">
                  <span style="display:block;font-size:22px;font-weight:300;color:${GOLD};letter-spacing:-0.5px;font-family:${FONT};">${value}</span>
                  <span style="display:block;margin-top:4px;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#777777;font-family:${FONT};">${label}</span>
                </td>`;
  const summary = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px;border-bottom:1px solid #111111;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout:fixed;">
              <tr>
                ${summaryCell("POWR spent", data.powrSpent.toLocaleString())}
                ${data.balanceAfter != null ? summaryCell("Balance now", Math.max(0, data.balanceAfter).toLocaleString()) : ""}
              </tr>
            </table>
            <p style="margin:22px 0 0;font-size:13px;font-weight:300;color:#999999;line-height:1.6;text-align:center;font-family:${FONT};">It's saved in your wallet too, whenever you need it.</p>
            <div style="margin-top:16px;">${ctaButton("Open wallet", "https://powr.life/app?to=wallet", "ghost")}</div>
          </td>
        </tr>`;

  const terms = data.terms?.trim()
    ? `
        <tr>
          <td class="sec" style="background-color:#080808;padding:22px 40px;border-bottom:1px solid #111111;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};"><strong style="font-weight:600;color:#999999;">Terms.</strong> ${esc(data.terms.trim()).replace(/\n+/g, "<br>")}</p>
          </td>
        </tr>`
    : "";

  const html = emailShell({ title: "Your POWR reward", preheader, rows: hero + codeCard + summary + terms, unsubscribe: false });

  const text = `Earned, ${plainName}. It's yours.

${offer}${showTitle ? `\n${data.rewardTitle}` : ""}

${isLink ? `Your link: ${data.checkoutUrl ?? "open your wallet in the app"}` : `Your code: ${data.code}\nEnter it at checkout${data.checkoutUrl ? `: ${data.checkoutUrl}` : "."}`}${expires ? `\nValid until ${expires}` : ""}

POWR spent: ${data.powrSpent.toLocaleString()}${data.balanceAfter != null ? `\nBalance now: ${Math.max(0, data.balanceAfter).toLocaleString()}` : ""}

It's saved in your wallet too: https://powr.life/app?to=wallet
${data.terms?.trim() ? `\nTerms: ${data.terms.trim()}\n` : ""}
Every move counts.
— POWR`;

  return { subject, html, text };
}

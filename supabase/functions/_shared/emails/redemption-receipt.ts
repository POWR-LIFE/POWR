// Redemption receipt — sent the moment a member redeems a reward, so the code
// (or shop link) lives in their inbox as well as their wallet. Transactional:
// no unsubscribe link, no preference gate.

import { formatLocale, tEmail } from "../i18n/index.ts";
import { ctaButton, emailShell, esc, FONT, GOLD, optimizeImage, sectionLabel } from "./layout.ts";
import { firstNameOf, fmtNum, rewardValueLabel } from "./member-copy.ts";

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

// Dates read in London time for everyone (member timezones aren't on hand here).
function formatDate(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(lang), { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
}

export function redemptionReceiptEmail(data: RedemptionReceiptData, lang = "en"): { subject: string; html: string; text: string } {
  const plainName = firstNameOf(data.name, lang);
  const brand = data.brand?.trim() || null;
  // In store: nothing to copy. The member opens a live voucher at the till.
  const isInStore = data.integrationType === "IN_STORE";
  const isLink = !isInStore && (data.integrationType === "AFFILIATE" || !data.code);
  const storedValue = data.valueLabel?.trim() ?? "";
  const offer = [brand, rewardValueLabel(storedValue, lang)].filter(Boolean).join(" · ") || data.rewardTitle;
  const expires = data.expiresAt ? formatDate(data.expiresAt, lang) : null;
  // Reward titles are often just the brand or the discount ("HUEL", "£15 off"),
  // so only show the title when it says something the offer line doesn't.
  // Compared with the label as stored, so every language shows the same lines.
  const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9%£]/g, "");
  const storedOffer = [brand, storedValue].filter(Boolean).join(" · ") || data.rewardTitle;
  const showTitle = !!data.rewardTitle && !norm(storedOffer).includes(norm(data.rewardTitle));
  // Only a checkout link built around the code actually applies it.
  const linkApplies = !!(data.checkoutUrl && data.code && data.checkoutUrl.includes(data.code));

  const subject = isLink || isInStore
    ? tEmail(lang, "receipt.subjectLink", { brand: brand ?? "POWR" })
    : tEmail(lang, "receipt.subjectCode", { brand: brand ?? "POWR", code: data.code });
  const preheader = isInStore
    ? expires ? tEmail(lang, "receipt.preheaderInStoreBy", { offer, date: expires }) : tEmail(lang, "receipt.preheaderInStore", { offer })
    : isLink
    ? expires ? tEmail(lang, "receipt.preheaderLinkUntil", { offer, date: expires }) : tEmail(lang, "receipt.preheaderLink", { offer })
    : expires ? tEmail(lang, "receipt.preheaderCodeBy", { offer, date: expires }) : tEmail(lang, "receipt.preheaderCode", { offer });
  const shopLabel = brand ? tEmail(lang, "receipt.shopBrand", { brand: esc(brand) }) : tEmail(lang, "receipt.shopNow");

  const logo = data.imageUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 22px;background-color:#141414;border:1px solid #242424;border-radius:14px;">
              <tr><td width="72" height="72" align="center" valign="middle" style="width:72px;height:72px;text-align:center;">
                <img src="${esc(optimizeImage(data.imageUrl, { width: 160, height: 160, resize: "contain" }))}" alt="${esc(brand ?? tEmail(lang, "common.reward"))}" style="display:block;max-width:48px;max-height:48px;width:auto;height:auto;margin:0 auto;">
              </td></tr>
            </table>`
    : "";

  const hero = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:40px 40px 32px;text-align:center;border-bottom:1px solid #111111;">
            ${logo}
            <h1 class="hero-h1" style="margin:0;font-size:36px;font-weight:200;letter-spacing:0.5px;line-height:1.2;color:#F2F2F2;font-family:${FONT};">${tEmail(lang, "receipt.heroHtml", { name: esc(plainName) })}<br><em style="font-style:italic;color:${GOLD};">${tEmail(lang, "receipt.heroEm")}</em></h1>
            <p style="margin:16px 0 0;font-size:15px;font-weight:500;color:#dddddd;line-height:1.6;font-family:${FONT};">${esc(offer)}</p>
            ${showTitle ? `<p style="margin:4px 0 0;font-size:13px;font-weight:300;color:#888888;font-family:${FONT};">${esc(data.rewardTitle)}</p>` : ""}
          </td>
        </tr>`;

  const codeBlock = isInStore
    ? `
            <p style="margin:0;font-size:14px;font-weight:300;color:#aaaaaa;line-height:1.6;font-family:${FONT};">${tEmail(lang, brand ? "receipt.inStoreBodyAtHtml" : "receipt.inStoreBodyHtml", { brand: brand ? esc(brand) : "", strong: '<strong style="font-weight:600;color:#dddddd;">', end: "</strong>" })}</p>`
    : isLink
    ? `
            <p style="margin:0 0 20px;font-size:14px;font-weight:300;color:#aaaaaa;line-height:1.6;font-family:${FONT};">${tEmail(lang, "receipt.linkBodyHtml")}</p>
            ${data.checkoutUrl ? ctaButton(shopLabel, data.checkoutUrl) : ""}`
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
                ? tEmail(lang, "receipt.tapApplied")
                : brand ? tEmail(lang, "receipt.enterAtCheckoutOn", { brand: esc(brand) }) : tEmail(lang, "receipt.enterAtCheckout")
            }</p>
            ${data.checkoutUrl ? ctaButton(linkApplies ? tEmail(lang, "receipt.useItNow") : shopLabel, data.checkoutUrl) : ""}`;

  const codeCard = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:32px 40px;text-align:center;border-bottom:1px solid #161616;">
            ${sectionLabel(isInStore ? tEmail(lang, "receipt.useInStore") : isLink ? tEmail(lang, "receipt.yourLink") : tEmail(lang, "receipt.yourCode"))}
            <div style="margin-top:16px;">${codeBlock}</div>
            ${expires ? `<p style="margin:18px 0 0;font-size:12px;font-weight:500;color:#999999;font-family:${FONT};">${tEmail(lang, "receipt.validUntil", { date: expires })}</p>` : ""}
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
                ${summaryCell(tEmail(lang, "receipt.powrSpent"), fmtNum(data.powrSpent, lang))}
                ${data.balanceAfter != null ? summaryCell(tEmail(lang, "receipt.balanceNow"), fmtNum(Math.max(0, data.balanceAfter), lang)) : ""}
              </tr>
            </table>
            <p style="margin:22px 0 0;font-size:13px;font-weight:300;color:#999999;line-height:1.6;text-align:center;font-family:${FONT};">${tEmail(lang, "receipt.savedInWallet")}</p>
            <div style="margin-top:16px;">${ctaButton(tEmail(lang, "receipt.openWallet"), "https://powr.life/app?to=wallet", "ghost")}</div>
          </td>
        </tr>`;

  const terms = data.terms?.trim()
    ? `
        <tr>
          <td class="sec" style="background-color:#080808;padding:22px 40px;border-bottom:1px solid #111111;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};"><strong style="font-weight:600;color:#999999;">${tEmail(lang, "receipt.termsHtml")}</strong> ${esc(data.terms.trim()).replace(/\n+/g, "<br>")}</p>
          </td>
        </tr>`
    : "";

  const html = emailShell({ title: tEmail(lang, "receipt.title"), preheader, rows: hero + codeCard + summary + terms, unsubscribe: false, lang });

  const codeText = `${tEmail(lang, "common.text.yourCode", { code: data.code })}\n${
    data.checkoutUrl ? tEmail(lang, "receipt.text.enterAtCheckoutUrl", { url: data.checkoutUrl }) : tEmail(lang, "receipt.enterAtCheckout")
  }`;
  const text = `${tEmail(lang, "receipt.text.heading", { name: plainName })}

${offer}${showTitle ? `\n${data.rewardTitle}` : ""}

${isInStore ? tEmail(lang, "receipt.text.inStore") : isLink ? tEmail(lang, "receipt.text.yourLink", { link: data.checkoutUrl ?? tEmail(lang, "receipt.text.openWallet") }) : codeText}${expires ? `\n${tEmail(lang, "receipt.validUntil", { date: expires })}` : ""}

${tEmail(lang, "receipt.text.powrSpent", { amount: fmtNum(data.powrSpent, lang) })}${data.balanceAfter != null ? `\n${tEmail(lang, "receipt.text.balanceNow", { amount: fmtNum(Math.max(0, data.balanceAfter), lang) })}` : ""}

${tEmail(lang, "receipt.text.savedInWallet", { url: "https://powr.life/app?to=wallet" })}
${data.terms?.trim() ? `\n${tEmail(lang, "receipt.text.terms", { terms: data.terms.trim() })}\n` : ""}
${tEmail(lang, "common.everyMoveCounts")}
— POWR`;

  return { subject, html, text };
}

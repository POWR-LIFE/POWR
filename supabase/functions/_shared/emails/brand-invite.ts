import { tBusiness } from "../i18n/index.ts";
import { brandLogoImg } from "./brand-logo.ts";

export interface BrandInviteData {
  /** The reward brand the recipient is being invited to manage. */
  brandName: string;
  /** Single-use setup link — /partner/setup/{token}. The credential itself. */
  setupUrl: string;
  /** Optional brand logo (falls back to the POWR mark). */
  logoUrl?: string | null;
  /** Optional first name for the greeting ("Hi Cara,"). */
  contactName?: string | null;
  /**
   * When set, the email is the "your reward is approved" variant sent from the
   * admin Submissions queue: it names the reward and walks the partner through
   * getting it live. Without it, the generic "you're invited" variant is sent.
   */
  rewardTitle?: string | null;
  /** How the partner chose to deliver codes — shapes step 2 of the approved variant. */
  deliveryMethod?: "code_pool" | "shopify" | "api" | "affiliate" | "manual_fulfilment" | null;
  /** Brand accent (rewards.brand_color, e.g. "#c6a13e") — tints the small pill dot. CTA stays POWR gold. */
  brandColor?: string | null;
}

const GOLD = "#E8D200";
const POWR_LOGO = "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const oneLine = (s: string) =>
  s.replace(/[\r\n]+/g, " ").replace(/[\x00-\x1F\x7F]/g, " ").replace(/\s+/g, " ").trim();

interface Step { title: string; detail: string }

// Titles and details are HTML (entities allowed); the text part runs them through plain().
function stepsFor(data: BrandInviteData, lang: string): Step[] {
  if (!data.rewardTitle) {
    return [
      { title: tBusiness(lang, "brand.invite.invited.steps.createHtml"), detail: tBusiness(lang, "brand.invite.invited.steps.createDetailHtml") },
      { title: tBusiness(lang, "brand.invite.invited.steps.trackHtml"), detail: tBusiness(lang, "brand.invite.invited.steps.trackDetailHtml") },
      { title: tBusiness(lang, "brand.invite.invited.steps.reachHtml"), detail: tBusiness(lang, "brand.invite.invited.steps.reachDetailHtml") },
    ];
  }
  const supply: Step =
    data.deliveryMethod === "shopify"
      ? { title: tBusiness(lang, "brand.invite.approved.steps.shopifyHtml"), detail: tBusiness(lang, "brand.invite.approved.steps.shopifyDetailHtml") }
      : data.deliveryMethod === "api"
        ? { title: tBusiness(lang, "brand.invite.approved.steps.apiHtml"), detail: tBusiness(lang, "brand.invite.approved.steps.apiDetailHtml") }
        : data.deliveryMethod === "affiliate"
          ? { title: tBusiness(lang, "brand.invite.approved.steps.affiliateHtml"), detail: tBusiness(lang, "brand.invite.approved.steps.affiliateDetailHtml") }
          : data.deliveryMethod === "manual_fulfilment"
            ? { title: tBusiness(lang, "brand.invite.approved.steps.fulfilmentHtml"), detail: tBusiness(lang, "brand.invite.approved.steps.fulfilmentDetailHtml") }
            : { title: tBusiness(lang, "brand.invite.approved.steps.chooseHtml"), detail: tBusiness(lang, "brand.invite.approved.steps.chooseDetailHtml") };
  return [
    { title: tBusiness(lang, "brand.invite.approved.steps.loginHtml"), detail: tBusiness(lang, "brand.invite.approved.steps.loginDetailHtml") },
    supply,
    { title: tBusiness(lang, "brand.invite.approved.steps.liveHtml"), detail: tBusiness(lang, "brand.invite.approved.steps.liveDetailHtml") },
  ];
}

/** `lang`: the reader's language — the inviter's for someone who isn't a POWR user yet (see manage-partner-user). */
export function brandInviteEmail(data: BrandInviteData, lang: string = "en"): { subject: string; html: string; text: string } {
  const { brandName, setupUrl } = data;
  const approved = !!data.rewardTitle?.trim();
  const rewardTitle = (data.rewardTitle ?? "").trim();
  const safeBrandNameForHeader = oneLine(brandName);
  const safeRewardTitleForHeader = oneLine(rewardTitle);
  const firstName = (data.contactName ?? "").trim().split(/\s+/)[0] ?? "";
  const steps = stepsFor(data, lang);
  // Markup the catalog's Html keys wrap around their words.
  const em = { newline: "<br>", em: `<em style="font-style:italic;color:${GOLD};">`, end: "</em>" };
  const strong = { newline: "<br>", strong: '<strong style="font-weight:500;color:#bbbbbb;">', end: "</strong>" };

  const subject = approved
    ? tBusiness(lang, "brand.invite.approved.subject", { reward: safeRewardTitleForHeader, brand: safeBrandNameForHeader })
    : tBusiness(lang, "brand.invite.invited.subject", { brand: safeBrandNameForHeader });
  const preheader = approved
    ? tBusiness(lang, "brand.invite.approved.preheader", { reward: safeRewardTitleForHeader, brand: safeBrandNameForHeader })
    : tBusiness(lang, "brand.invite.invited.preheader", { brand: safeBrandNameForHeader });
  const pill = approved ? tBusiness(lang, "brand.invite.approved.pill") : tBusiness(lang, "brand.common.rewardsPartner");
  const heading = approved
    ? tBusiness(lang, "brand.invite.approved.headingHtml", em)
    : tBusiness(lang, "brand.invite.invited.headingHtml", { ...em, brand: escapeHtml(brandName) });
  const introVars = { ...strong, name: escapeHtml(firstName), reward: escapeHtml(rewardTitle), brand: escapeHtml(brandName) };
  const intro = approved
    ? (firstName ? tBusiness(lang, "brand.invite.approved.introNamedHtml", introVars) : tBusiness(lang, "brand.invite.approved.introHtml", introVars))
    : (firstName ? tBusiness(lang, "brand.invite.invited.introNamedHtml", introVars) : tBusiness(lang, "brand.invite.invited.introHtml", introVars));
  const stepsHeading = approved ? tBusiness(lang, "brand.invite.approved.stepsTitle") : tBusiness(lang, "brand.invite.invited.stepsTitle");
  const cta = tBusiness(lang, "brand.invite.cta");
  const footerNote = `${tBusiness(lang, "brand.invite.footerHtml")}<br>
            ${approved ? tBusiness(lang, "brand.invite.approved.questionsHtml") : tBusiness(lang, "brand.invite.invited.unexpectedHtml")}`;
  const accent = /^#[0-9a-f]{6}$/i.test(data.brandColor ?? "") ? data.brandColor! : GOLD;
  // The brand's own mark sits straight on the black hero, as it does on a
  // reward card in the app (see brand-logo.ts).
  const logo = brandLogoImg(data.logoUrl, brandName);
  const logoTile = logo
    ? `
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 26px;">
              <tr><td align="center">${logo}</td></tr>
            </table>`
    : "";

  const stepRows = steps.map((s, i) => `
              <tr>
                <td style="${i < steps.length - 1 ? "padding-bottom:18px;" : ""}vertical-align:top;width:28px;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:500;color:${GOLD};font-family:Arial,Helvetica,sans-serif;line-height:22px;">${i + 1}</span>
                </td>
                <td style="padding:0 0 ${i < steps.length - 1 ? "18px" : "0"} 12px;vertical-align:top;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">${s.title}</p>
                  <p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">${s.detail}</p>
                </td>
              </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(tBusiness(lang, "brand.invite.title"))}</title>
</head>
<body style="margin:0;padding:0;background-color:#111111;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#111111;">${escapeHtml(preheader)}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#111111;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;border:1px solid #1e1e1e;border-radius:20px;overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td style="background-color:#080808;padding:36px 40px 32px;text-align:center;border-bottom:1px solid #161616;">
            <img src="${POWR_LOGO}" alt="POWR" height="48" style="height:48px;width:auto;display:block;margin:0 auto;">
          </td>
        </tr>

        <!-- HERO -->
        <tr>
          <td style="background-color:#080808;padding:44px 40px 36px;text-align:center;border-bottom:1px solid #111111;">${logoTile}
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 28px;">
              <tr>
                <td style="border:1px solid #2a2a2a;border-radius:100px;padding:6px 14px 6px 10px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="width:6px;height:6px;background-color:${accent};border-radius:50%;vertical-align:middle;font-size:0;line-height:0;">&nbsp;</td>
                      <td style="padding-left:7px;font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:#888888;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">${escapeHtml(pill)}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <h1 style="margin:0 0 6px;font-size:40px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">${heading}</h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#777777;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">${intro}</p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="background-color:#080808;padding:8px 40px 40px;text-align:center;border-bottom:1px solid #161616;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:100px;background-color:${GOLD};">
                  <a href="${setupUrl}" target="_blank" style="display:inline-block;padding:16px 40px;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#080808;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">${cta}</a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-size:11px;font-weight:300;color:#444444;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.invite.pasteLinkHtml")}<br><span style="color:#666666;word-break:break-all;">${setupUrl}</span></p>
          </td>
        </tr>

        <!-- STEPS -->
        <tr>
          <td style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            <p style="margin:0 0 20px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#333333;font-family:Arial,Helvetica,sans-serif;">${stepsHeading}</p>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${stepRows}
            </table>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#050505;padding:32px 40px;text-align:center;">
            <img src="${POWR_LOGO}" alt="POWR" height="16" style="height:16px;width:auto;display:block;margin:0 auto 16px;opacity:0.15;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#282828;line-height:2;font-family:Arial,Helvetica,sans-serif;">
              ${footerNote}
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const plain = (s: string) => s.replace(/&mdash;/g, "—").replace(/&#8217;/g, "’").replace(/&amp;/g, "&");
  const textSteps = steps.map((s, i) => tBusiness(lang, "brand.invite.text.step", { n: i + 1, title: plain(s.title), detail: plain(s.detail) })).join("\n");
  const text = approved
    ? `${firstName ? `${tBusiness(lang, "brand.invite.approved.text.hi", { name: firstName })}\n\n` : ""}${tBusiness(lang, "brand.invite.approved.text.ready", { reward: rewardTitle })}

${tBusiness(lang, "brand.invite.approved.text.setUp", { brand: brandName })}
${setupUrl}

${stepsHeading.toUpperCase()}
${textSteps}

${tBusiness(lang, "brand.invite.approved.text.footer")}

— POWR
https://powr.life`
    : `${tBusiness(lang, "brand.invite.invited.text.welcome", { brand: brandName })}

${firstName ? tBusiness(lang, "brand.invite.invited.text.introNamed", { name: firstName, brand: brandName }) : tBusiness(lang, "brand.invite.invited.text.intro", { brand: brandName })}

${tBusiness(lang, "brand.invite.invited.text.setUp")}
${setupUrl}

${stepsHeading.toUpperCase()}
${textSteps}

${tBusiness(lang, "brand.invite.invited.text.footer")}

— POWR
https://powr.life`;

  return { subject, html, text };
}

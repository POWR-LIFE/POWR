import { tBusiness } from "../i18n/index.ts";

export interface PartnerWelcomeData {
  /** The reward brand whose portal was just set up. */
  brandName: string;
  /** Contact's name, if known. */
  contactName?: string | null;
  /** Portal URL (defaults to the live portal). */
  portalUrl?: string;
}

const GOLD = "#E8D200";
const POWR_LOGO = "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png";

/** A numbered "what happens next" row, matching the brand-invite list style. */
function stepRow(n: number, label: string, sub: string, isLast: boolean): string {
  return `
              <tr>
                <td style="${isLast ? "" : "padding-bottom:18px;"}vertical-align:top;width:28px;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:500;color:${GOLD};font-family:Arial,Helvetica,sans-serif;line-height:22px;">${n}</span>
                </td>
                <td style="padding:0 0 ${isLast ? "0" : "18px"} 12px;vertical-align:top;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">${label}</p>
                  <p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">${sub}</p>
                </td>
              </tr>`;
}

/** `lang`: the reader's language (manage-partner-user: the inviter's, as the new login has none yet). */
export function partnerWelcomeEmail(data: PartnerWelcomeData, lang: string = "en"): { subject: string; html: string; text: string } {
  const { brandName } = data;
  const firstName = data.contactName?.split(" ")[0] ?? null;
  const portalUrl = data.portalUrl ?? "https://powr.life/partner";
  const greeting = firstName ? tBusiness(lang, "brand.welcome.greetingNamed", { name: firstName }) : tBusiness(lang, "brand.welcome.greeting");
  const preheader = tBusiness(lang, "brand.welcome.preheader", { brand: brandName });
  const live = tBusiness(lang, "brand.welcome.live", { brand: brandName });
  const brandVars = { brand: brandName, newline: "<br>" };

  const html = `<!DOCTYPE html>
<html lang="${lang.replace(/[^\w-]/g, "")}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${tBusiness(lang, "brand.welcome.title", { brand: brandName })}</title>
</head>
<body style="margin:0;padding:0;background-color:#111111;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#111111;">${preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
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
          <td style="background-color:#080808;padding:44px 40px 36px;text-align:center;border-bottom:1px solid #111111;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 28px;">
              <tr>
                <td style="border:1px solid #2a2a2a;border-radius:100px;padding:6px 14px 6px 10px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="width:6px;height:6px;background-color:${GOLD};border-radius:50%;vertical-align:middle;font-size:0;line-height:0;">&nbsp;</td>
                      <td style="padding-left:7px;font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:#888888;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">${tBusiness(lang, "brand.common.rewardsPartner")}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <h1 style="margin:0 0 6px;font-size:40px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">${greeting}<br><em style="font-style:italic;color:${GOLD};">${live}</em></h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#777777;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.welcome.introHtml", brandVars)}</p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="background-color:#080808;padding:8px 40px 40px;text-align:center;border-bottom:1px solid #161616;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:100px;background-color:${GOLD};">
                  <a href="${portalUrl}" target="_blank" style="display:inline-block;padding:16px 40px;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#080808;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.common.openPortal")}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- WHAT HAPPENS NEXT -->
        <tr>
          <td style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            <p style="margin:0 0 20px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#333333;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.welcome.stepsTitle")}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
${stepRow(1, tBusiness(lang, "brand.welcome.steps.create"), tBusiness(lang, "brand.welcome.steps.createDetail"), false)}
${stepRow(2, tBusiness(lang, "brand.welcome.steps.review"), tBusiness(lang, "brand.welcome.steps.reviewDetail"), false)}
${stepRow(3, tBusiness(lang, "brand.welcome.steps.redeem"), tBusiness(lang, "brand.welcome.steps.redeemDetail"), true)}
            </table>
          </td>
        </tr>

        <!-- WEEKLY DIGEST PROMISE -->
        <tr>
          <td style="background-color:#080808;padding:28px 40px;border-bottom:1px solid #161616;text-align:center;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#444444;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.welcome.mondayTitle")}</p>
            <p style="margin:0;font-size:14px;font-weight:300;color:#999999;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">${tBusiness(lang, "brand.welcome.mondayHtml", brandVars)}</p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#050505;padding:32px 40px;text-align:center;">
            <img src="${POWR_LOGO}" alt="POWR" height="16" style="height:16px;width:auto;display:block;margin:0 auto 16px;opacity:0.15;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#282828;line-height:2;font-family:Arial,Helvetica,sans-serif;">
              ${tBusiness(lang, "brand.welcome.footerReceiving", { brand: brandName })}<br>
              ${tBusiness(lang, "brand.welcome.footerStuck")}
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = `${greeting} ${live}

${tBusiness(lang, "brand.welcome.text.intro", { brand: brandName })}

${tBusiness(lang, "brand.common.text.openPortal", { url: portalUrl })}

${tBusiness(lang, "brand.welcome.stepsTitle").toUpperCase()}
1. ${tBusiness(lang, "brand.welcome.text.create")}
2. ${tBusiness(lang, "brand.welcome.text.review")}
3. ${tBusiness(lang, "brand.welcome.text.redeem")}

${tBusiness(lang, "brand.welcome.mondayTitle").toUpperCase()}
${tBusiness(lang, "brand.welcome.text.monday", { brand: brandName })}

${tBusiness(lang, "brand.welcome.footerReceiving", { brand: brandName })} ${tBusiness(lang, "brand.welcome.footerStuck")}

— POWR
https://powr.life`;

  return {
    subject: tBusiness(lang, "brand.welcome.subject", { brand: brandName }),
    html,
    text,
  };
}

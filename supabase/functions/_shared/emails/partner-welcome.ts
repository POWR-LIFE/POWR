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

export function partnerWelcomeEmail(data: PartnerWelcomeData): { subject: string; html: string; text: string } {
  const { brandName } = data;
  const firstName = data.contactName?.split(" ")[0] ?? null;
  const portalUrl = data.portalUrl ?? "https://powr.life/partner";
  const greeting = firstName ? `You're in, ${firstName}.` : "You're in.";
  const preheader = `${brandName} is live on POWR — here's how to get your first reward in front of members.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${brandName} is live on POWR</title>
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
                      <td style="padding-left:7px;font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:#888888;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">Rewards Partner</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <h1 style="margin:0 0 6px;font-size:40px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">${greeting}<br><em style="font-style:italic;color:${GOLD};">${brandName} is live on POWR.</em></h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#777777;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">Your portal is set up and ready. From here, everything ${brandName}<br>does on POWR runs through one place.</p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="background-color:#080808;padding:8px 40px 40px;text-align:center;border-bottom:1px solid #161616;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:100px;background-color:${GOLD};">
                  <a href="${portalUrl}" target="_blank" style="display:inline-block;padding:16px 40px;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#080808;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">Open your portal</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- WHAT HAPPENS NEXT -->
        <tr>
          <td style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            <p style="margin:0 0 20px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#333333;font-family:Arial,Helvetica,sans-serif;">Your first reward, in three steps</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
${stepRow(1, "Create your first reward", "A few fields — what it is, what it's worth, how it's delivered", false)}
${stepRow(2, "We give it a quick review", "Usually same day. You'll see the status in your portal", false)}
${stepRow(3, "Members start redeeming", "Your reward goes in front of people earning points by moving", true)}
            </table>
          </td>
        </tr>

        <!-- WEEKLY DIGEST PROMISE -->
        <tr>
          <td style="background-color:#080808;padding:28px 40px;border-bottom:1px solid #161616;text-align:center;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#444444;font-family:Arial,Helvetica,sans-serif;">Every Monday</p>
            <p style="margin:0;font-size:14px;font-weight:300;color:#999999;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">We'll send you ${brandName}'s week in numbers &mdash; redemptions,<br>POWR spent on your rewards, and what's working.</p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#050505;padding:32px 40px;text-align:center;">
            <img src="${POWR_LOGO}" alt="POWR" height="16" style="height:16px;width:auto;display:block;margin:0 auto 16px;opacity:0.15;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#282828;line-height:2;font-family:Arial,Helvetica,sans-serif;">
              You're receiving this because you manage ${brandName} on POWR.<br>
              Stuck on anything? Reply to this email and we'll sort it.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = `${greeting} ${brandName} is live on POWR.

Your portal is set up and ready. From here, everything ${brandName} does on POWR runs through one place.

Open your portal: ${portalUrl}

YOUR FIRST REWARD, IN THREE STEPS
1. Create your first reward — a few fields: what it is, what it's worth, how it's delivered
2. We give it a quick review — usually same day; you'll see the status in your portal
3. Members start redeeming — your reward goes in front of people earning points by moving

EVERY MONDAY
We'll send you ${brandName}'s week in numbers — redemptions, POWR spent on your rewards, and what's working.

You're receiving this because you manage ${brandName} on POWR. Stuck on anything? Reply to this email and we'll sort it.

— POWR
https://powr.life`;

  return {
    subject: `${brandName} is live on POWR — your portal is ready`,
    html,
    text,
  };
}

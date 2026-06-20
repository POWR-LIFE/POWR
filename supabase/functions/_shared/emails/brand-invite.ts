export interface BrandInviteData {
  /** The reward brand the recipient is being invited to manage. */
  brandName: string;
  /** Single-use setup link — /partner/setup/{token}. The credential itself. */
  setupUrl: string;
  /** Optional brand logo (falls back to the POWR mark). */
  logoUrl?: string | null;
}

const GOLD = "#E8D200";
const POWR_LOGO = "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png";

export function brandInviteEmail(data: BrandInviteData): { subject: string; html: string; text: string } {
  const { brandName, setupUrl } = data;
  const preheader = `Set up your ${brandName} portal on POWR — pick your email and password, takes a minute.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>You're invited — POWR Rewards Portal</title>
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
            <h1 style="margin:0 0 6px;font-size:40px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">Welcome to the<br><em style="font-style:italic;color:${GOLD};">${brandName} portal.</em></h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#777777;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">You&#8217;ve been invited to manage ${brandName} rewards on POWR.<br>Set up your login below &mdash; it takes about a minute.</p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="background-color:#080808;padding:8px 40px 40px;text-align:center;border-bottom:1px solid #161616;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:100px;background-color:${GOLD};">
                  <a href="${setupUrl}" target="_blank" style="display:inline-block;padding:16px 40px;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#080808;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">Set up your portal</a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-size:11px;font-weight:300;color:#444444;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Or paste this link into your browser:<br><span style="color:#666666;word-break:break-all;">${setupUrl}</span></p>
          </td>
        </tr>

        <!-- WHAT YOU CAN DO -->
        <tr>
          <td style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            <p style="margin:0 0 20px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#333333;font-family:Arial,Helvetica,sans-serif;">In the portal you can</p>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding-bottom:18px;vertical-align:top;width:28px;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:500;color:${GOLD};font-family:Arial,Helvetica,sans-serif;line-height:22px;">1</span>
                </td>
                <td style="padding:0 0 18px 12px;vertical-align:top;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">Create &amp; manage your rewards</p>
                  <p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">Submit new offers and edit your listings</p>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:18px;vertical-align:top;width:28px;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:500;color:${GOLD};font-family:Arial,Helvetica,sans-serif;line-height:22px;">2</span>
                </td>
                <td style="padding:0 0 18px 12px;vertical-align:top;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">Track redemptions</p>
                  <p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">See how members are engaging with your rewards</p>
                </td>
              </tr>
              <tr>
                <td style="vertical-align:top;width:28px;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:500;color:${GOLD};font-family:Arial,Helvetica,sans-serif;line-height:22px;">3</span>
                </td>
                <td style="padding:0 0 0 12px;vertical-align:top;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">Reach active members</p>
                  <p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">Put your brand in front of people who show up</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#050505;padding:32px 40px;text-align:center;">
            <img src="${POWR_LOGO}" alt="POWR" height="16" style="height:16px;width:auto;display:block;margin:0 auto 16px;opacity:0.15;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#282828;line-height:2;font-family:Arial,Helvetica,sans-serif;">
              This invite link is single-use and tied to your brand.<br>
              Didn&#8217;t expect this? Reply to this email and we&#8217;ll sort it.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = `Welcome to the ${brandName} portal on POWR.

You've been invited to manage ${brandName} rewards on POWR. Set up your login below — it takes about a minute.

Set up your portal:
${setupUrl}

IN THE PORTAL YOU CAN
1. Create & manage your rewards — submit new offers and edit your listings
2. Track redemptions — see how members are engaging with your rewards
3. Reach active members — put your brand in front of people who show up

This invite link is single-use and tied to your brand. Didn't expect this? Reply to this email and we'll sort it.

— POWR
https://powr.life`;

  return {
    subject: `You're invited to the ${brandName} rewards portal on POWR`,
    html,
    text,
  };
}

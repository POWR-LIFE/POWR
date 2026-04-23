export interface WaitlistPartnerData {
  name: string | null;
  website: string | null;
}

export function waitlistPartnerEmail(data: WaitlistPartnerData): { subject: string; html: string; text: string } {
  const firstName = data.name?.split(" ")[0] ?? "there";
  const preheader = `Your venue is on the POWR radar, ${firstName}. We'll be in touch within 48 hours.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome, Partner — POWR</title>
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
            <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext.png?v=1.1" alt="POWR" height="48" style="height:48px;width:auto;display:block;margin:0 auto;">
          </td>
        </tr>

        <!-- HERO -->
        <tr>
          <td style="background-color:#080808;padding:44px 40px 40px;text-align:center;border-bottom:1px solid #111111;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 28px;">
              <tr>
                <td style="border:1px solid #2a2a2a;border-radius:100px;padding:6px 14px 6px 10px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="width:6px;height:6px;background-color:#E8D200;border-radius:50%;vertical-align:middle;font-size:0;line-height:0;">&nbsp;</td>
                      <td style="padding-left:7px;font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:#888888;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">Partner</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <h1 style="margin:0 0 6px;font-size:42px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">Your gym is<br><em style="font-style:italic;color:#E8D200;">on the radar.</em></h1>
            <p style="margin:16px 0 0;font-size:15px;font-weight:300;color:#555555;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">Thanks for registering as a POWR partner,&nbsp;${firstName}.<br>We&#8217;ll be in touch within 48 hours.</p>
          </td>
        </tr>

        <!-- WHAT HAPPENS NEXT -->
        <tr>
          <td style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            <p style="margin:0 0 20px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#333333;font-family:Arial,Helvetica,sans-serif;">What happens next</p>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding-bottom:20px;vertical-align:top;width:28px;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:500;color:#E8D200;font-family:Arial,Helvetica,sans-serif;line-height:22px;">1</span>
                </td>
                <td style="padding:0 0 20px 12px;vertical-align:top;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">We review your application</p>
                  <p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">Within 48 hours of sign-up</p>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:20px;vertical-align:top;width:28px;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:500;color:#E8D200;font-family:Arial,Helvetica,sans-serif;line-height:22px;">2</span>
                </td>
                <td style="padding:0 0 20px 12px;vertical-align:top;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">Our team walks you through setup</p>
                  <p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">Zero cost, zero effort on your end</p>
                </td>
              </tr>
              <tr>
                <td style="vertical-align:top;width:28px;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:500;color:#E8D200;font-family:Arial,Helvetica,sans-serif;line-height:22px;">3</span>
                </td>
                <td style="padding:0 0 0 12px;vertical-align:top;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">Go live on POWR</p>
                  <p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#555555;font-family:Arial,Helvetica,sans-serif;">Your members earn points at your venue from day one</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#050505;padding:32px 40px;text-align:center;">
            <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext.png?v=1.1" alt="POWR" height="16" style="height:16px;width:auto;display:block;margin:0 auto 16px;opacity:0.15;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#282828;line-height:2;font-family:Arial,Helvetica,sans-serif;">
              Questions? Reply to this email.<br>
              <a href="%unsubscribe_url%" style="color:#333333;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp; <a href="https://powr.life/privacy" style="color:#333333;text-decoration:none;">Privacy Policy</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = `Hey ${firstName},

Your venue is on the POWR radar.

Thanks for registering as a POWR partner. We'll be in touch within 48 hours.

WHAT HAPPENS NEXT
1. We review your application (within 48 hours)
2. Our team walks you through setup — zero cost, zero effort
3. Go live on POWR — your members start earning from day one

Questions? Reply to this email.

Every move counts.
— POWR
https://powr.life`;

  return {
    subject: `Welcome to POWR, ${firstName}.`,
    html,
    text,
  };
}

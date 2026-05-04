export interface InactivityNudgeData {
  name: string | null;
  daysInactive: number;
  currentStreak: number;
}

export function inactivityNudgeEmail(data: InactivityNudgeData): { subject: string; html: string; text: string } {
  const firstName = data.name?.split(" ")[0] ?? "there";
  const days = data.daysInactive;
  const preheader = `It's been ${days} days. Every session counts — come back and start earning again.`;

  const isLongGap = days >= 7;

  const heroHeading = isLongGap
    ? `The gym didn't stop, ${firstName}.`
    : `It's been ${days} days, ${firstName}.`;

  const heroBody = isLongGap
    ? `${days} days away. Your body is ready — and so is your next reward. Jump back in and pick up where you left off.`
    : `Even a short walk earns POWR points. Log any activity today and keep building toward your next reward.`;

  const ctaLabel = isLongGap ? "Get Back In It" : "Log Activity";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>We miss you — POWR</title>
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
            <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png" alt="POWR" height="48" style="height:48px;width:auto;display:block;margin:0 auto;">
          </td>
        </tr>

        <!-- HERO -->
        <tr>
          <td style="background-color:#080808;padding:44px 40px 40px;text-align:center;border-bottom:1px solid #111111;">
            <span style="display:block;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#555555;font-family:Arial,Helvetica,sans-serif;">${days} days since your last session</span>
            <h1 style="margin:14px 0 6px;font-size:30px;font-weight:200;letter-spacing:-0.5px;line-height:1.25;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">${heroHeading}</h1>
            <p style="margin:12px 0 0;font-size:15px;font-weight:300;color:#555555;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">${heroBody}</p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="background-color:#0a0a0a;padding:36px 40px;text-align:center;border-bottom:1px solid #161616;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:24px;background-color:#E8D200;">
                  <a href="https://powr.life/app" style="display:inline-block;padding:14px 32px;font-size:13px;font-weight:700;color:#080808;font-family:Arial,Helvetica,sans-serif;text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">${ctaLabel}</a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-size:12px;color:#333333;font-family:Arial,Helvetica,sans-serif;">Every move counts. Your rewards are waiting.</p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#050505;padding:32px 40px;text-align:center;">
            <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png" alt="POWR" height="16" style="height:16px;width:auto;display:block;margin:0 auto 16px;opacity:0.15;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#282828;line-height:2;font-family:Arial,Helvetica,sans-serif;">
              powr.life<br>
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

It's been ${days} days since your last session.

${heroBody}

Open the app: https://powr.life/app

Every move counts.
— POWR
https://powr.life`;

  return {
    subject: isLongGap
      ? `${days} days away. Ready to come back?`
      : `It's been ${days} days — your rewards are waiting.`,
    html,
    text,
  };
}

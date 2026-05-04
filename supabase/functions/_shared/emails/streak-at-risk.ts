export interface StreakAtRiskData {
  name: string | null;
  currentStreak: number;
}

export function streakAtRiskEmail(data: StreakAtRiskData): { subject: string; html: string; text: string } {
  const firstName = data.name?.split(" ")[0] ?? "there";
  const streak = data.currentStreak;
  const preheader = `Your ${streak}-day streak ends at midnight. Log any activity to save it.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your streak is at risk — POWR</title>
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
            <span style="display:block;font-size:72px;font-weight:200;color:#E8D200;letter-spacing:-3px;line-height:1;font-family:Arial,Helvetica,sans-serif;">${streak}</span>
            <span style="display:block;margin-top:6px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E8D200;font-family:Arial,Helvetica,sans-serif;opacity:0.5;">day streak</span>
            <h1 style="margin:20px 0 6px;font-size:28px;font-weight:200;letter-spacing:-0.5px;line-height:1.2;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">Don't let it die tonight,&nbsp;${firstName}.</h1>
            <p style="margin:12px 0 0;font-size:15px;font-weight:300;color:#555555;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">You've built ${streak} days in a row. Log any activity<br>before midnight to keep it alive.</p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="background-color:#0a0a0a;padding:36px 40px;text-align:center;border-bottom:1px solid #161616;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:24px;background-color:#E8D200;">
                  <a href="https://powr.life/app" style="display:inline-block;padding:14px 32px;font-size:13px;font-weight:700;color:#080808;font-family:Arial,Helvetica,sans-serif;text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">Save My Streak</a>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 0;font-size:12px;color:#333333;font-family:Arial,Helvetica,sans-serif;">Even a 10-minute walk counts. Every move earns POWR.</p>
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

Your ${streak}-day streak ends tonight.

You've built ${streak} days in a row — don't let it slip. Log any activity before midnight to keep it alive. Even a 10-minute walk counts.

Save your streak: https://powr.life/app

Every move counts.
— POWR
https://powr.life`;

  return {
    subject: `Your ${streak}-day streak ends tonight.`,
    html,
    text,
  };
}

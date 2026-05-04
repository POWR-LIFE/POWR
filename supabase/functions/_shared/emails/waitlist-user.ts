export interface WaitlistUserData {
  name: string | null;
  referralSlug?: string | null;
}

export function waitlistUserEmail(data: WaitlistUserData): { subject: string; html: string; text: string } {
  const firstName = data.name?.split(" ")[0] ?? "there";
  const referralSlug = data.referralSlug ?? null;

  const launchDate = new Date("2026-05-12");
  const today = new Date();
  const daysToLaunch = Math.max(0, Math.ceil((launchDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

  const preheader = `You're in, ${firstName}. 50 points are waiting in your account.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>You're in — POWR</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@200;300;400;500;600;700;800;900&display=swap');
body,table,td,th,p,span,a,h1,h2,h3,em,strong{font-family:'Outfit',Arial,Helvetica,sans-serif!important;}
</style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:'Outfit',Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">

<!-- Preheader -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;">${preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>

<!-- Outer -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff;">
  <tr>
    <td align="center" style="padding:40px 16px;">

      <!-- Wrapper -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;border:1px solid #1e1e1e;border-radius:20px;overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td style="background-color:#080808;padding:36px 40px 32px;text-align:center;border-bottom:1px solid #161616;">
            <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png" alt="POWR" height="96" style="height:96px;width:auto;display:block;margin:0 auto;">
          </td>
        </tr>

        <!-- HERO -->
        <tr>
          <td style="background-color:#080808;padding:44px 40px 40px;text-align:center;border-bottom:1px solid #111111;">

            <!-- Founding badge -->
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 28px;">
              <tr>
                <td style="border:1px solid #2a2a2a;border-radius:100px;padding:6px 14px 6px 10px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td width="6" height="6" style="width:6px;height:6px;min-width:6px;max-width:6px;vertical-align:middle;padding:0;">
                        <table role="presentation" width="6" height="6" cellspacing="0" cellpadding="0" border="0" style="width:6px;height:6px;min-width:6px;border-radius:50%;background-color:#E8D200;font-size:0;line-height:0;"><tr><td style="font-size:0;line-height:0;"> </td></tr></table>
                      </td>
                      <td style="padding-left:7px;font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:#888888;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">Founding Member</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <h1 style="margin:0 0 6px;font-size:42px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">You&#8217;re in.<br><em style="font-style:italic;color:#E8D200;">Every move counts.</em></h1>
            <p style="margin:16px 0 0;font-size:15px;font-weight:300;color:#555555;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">POWR launches in the UK on 12 May.<br>You&#8217;ll get access before anyone else.</p>
          </td>
        </tr>

        <!-- POINTS CARD -->
        <tr>
          <td style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#111111;border:1px solid #222222;border-radius:14px;">
              <tr>
                <td style="padding:28px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="text-align:center;width:100px;vertical-align:middle;">
                        <span style="display:block;font-size:72px;font-weight:200;color:#E8D200;letter-spacing:-3px;line-height:1;font-family:Arial,Helvetica,sans-serif;">50</span>
                        <span style="display:block;margin-top:4px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E8D200;font-family:Arial,Helvetica,sans-serif;opacity:0.5;">pts</span>
                      </td>
                      <td style="width:1px;background-color:#222222;vertical-align:middle;">&nbsp;</td>
                      <td style="padding-left:24px;vertical-align:middle;">
                        <p style="margin:0 0 8px;font-size:16px;font-weight:500;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">Waiting in your account.</p>
                        <p style="margin:0;font-size:13px;font-weight:300;color:#aaaaaa;line-height:1.65;font-family:Arial,Helvetica,sans-serif;">You earned 50 points for joining the waitlist. They&#8217;ll be waiting when the app goes live on May 12th.</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- REFER -->
        <tr>
          <td style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#111111;border:1px solid #222222;border-radius:14px;">
              <tr>
                <td style="padding:24px;">
                  <p style="margin:0 0 8px;font-size:16px;font-weight:500;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">Earn more before launch.</p>
                  <p style="margin:0 0 20px;font-size:13px;font-weight:300;color:#aaaaaa;line-height:1.65;font-family:Arial,Helvetica,sans-serif;">Refer a friend and you both get <strong style="color:#E8D200;font-weight:500;">+50 points</strong> the moment they join. Stack them before May 12th.</p>
                  ${referralSlug ? `<a href="https://powr.life/?ref=${referralSlug}" style="display:inline-block;background-color:#E8D200;color:#080808;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;text-decoration:none;border-radius:6px;padding:10px 20px;font-family:Arial,Helvetica,sans-serif;">Invite a Friend</a>` : `<a href="https://powr.life" style="display:inline-block;background-color:#E8D200;color:#080808;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;text-decoration:none;border-radius:6px;padding:10px 20px;font-family:Arial,Helvetica,sans-serif;">Join the Waitlist</a>`}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- LAUNCH DATE -->
        <tr>
          <td style="background-color:#080808;padding:32px 40px;border-bottom:1px solid #111111;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="vertical-align:middle;">
                  <p style="margin:0 0 8px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#333333;font-family:Arial,Helvetica,sans-serif;">UK Launch</p>
                  <p style="margin:0;font-size:34px;font-weight:200;color:#F2F2F2;letter-spacing:0.5px;font-family:Arial,Helvetica,sans-serif;line-height:1.1;"><strong style="font-weight:500;">12 May</strong> 2026</p>
                  <p style="margin:6px 0 0;font-size:13px;font-weight:300;color:#444444;font-family:Arial,Helvetica,sans-serif;">iOS &amp; Android</p>
                </td>
                <td style="vertical-align:middle;text-align:right;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="background-color:#111111;border:1px solid #222222;border-radius:10px;margin-left:auto;">
                    <tr>
                      <td style="padding:14px 20px;text-align:center;">
                        <span style="display:block;font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:#333333;margin-bottom:4px;font-family:Arial,Helvetica,sans-serif;">Days to go</span>
                        <strong style="display:block;font-size:28px;font-weight:200;color:#E8D200;letter-spacing:1px;font-family:Arial,Helvetica,sans-serif;">${daysToLaunch}</strong>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- HOW YOU EARN -->
        <tr>
          <td style="background-color:#080808;padding:32px 40px;border-bottom:1px solid #111111;">
            <p style="margin:0 0 20px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#333333;font-family:Arial,Helvetica,sans-serif;">How you earn</p>

            <!-- Gym row -->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding-bottom:13px;width:40px;vertical-align:middle;">
                  <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/workout_lanbding_page.png" width="40" height="40" alt="Gym" style="width:40px;height:40px;border-radius:8px;display:block;">
                </td>
                <td style="padding:0 0 13px 16px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">Gym session</p>
                  <p style="margin:2px 0 0;font-size:12px;font-weight:300;color:#aaaaaa;font-family:Arial,Helvetica,sans-serif;">GPS verified check-in</p>
                </td>
                <td style="padding-bottom:13px;vertical-align:middle;text-align:right;white-space:nowrap;">
                  <span style="font-size:15px;font-weight:500;color:#E8D200;font-family:Arial,Helvetica,sans-serif;">+20 pts</span>
                </td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #0f0f0f;">
              <!-- Cycle row -->
              <tr>
                <td style="padding:13px 0;width:40px;vertical-align:middle;">
                  <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/powr-challenge-cards/cycle-challenge-card.jpg" width="40" height="40" alt="Cycle" style="width:40px;height:40px;border-radius:8px;display:block;">
                </td>
                <td style="padding:13px 0 13px 16px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">Cycle</p>
                  <p style="margin:2px 0 0;font-size:12px;font-weight:300;color:#aaaaaa;font-family:Arial,Helvetica,sans-serif;">Tracked via wearable</p>
                </td>
                <td style="padding:13px 0;vertical-align:middle;text-align:right;white-space:nowrap;">
                  <span style="font-size:15px;font-weight:500;color:#E8D200;font-family:Arial,Helvetica,sans-serif;">+10 pts</span>
                </td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #0f0f0f;">
              <!-- Run row -->
              <tr>
                <td style="padding:13px 0;width:40px;vertical-align:middle;">
                  <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/run_landing_page.png" width="40" height="40" alt="Run" style="width:40px;height:40px;border-radius:8px;display:block;">
                </td>
                <td style="padding:13px 0 13px 16px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">Run</p>
                  <p style="margin:2px 0 0;font-size:12px;font-weight:300;color:#aaaaaa;font-family:Arial,Helvetica,sans-serif;">Tracked via wearable</p>
                </td>
                <td style="padding:13px 0;vertical-align:middle;text-align:right;white-space:nowrap;">
                  <span style="font-size:15px;font-weight:500;color:#E8D200;font-family:Arial,Helvetica,sans-serif;">+10 pts</span>
                </td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #0f0f0f;">
              <!-- Walk row -->
              <tr>
                <td style="padding-top:13px;width:40px;vertical-align:middle;">
                  <img src="https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/walk_landing_page.png" width="40" height="40" alt="Walk" style="width:40px;height:40px;border-radius:8px;display:block;">
                </td>
                <td style="padding:13px 0 0 16px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#bbbbbb;font-family:Arial,Helvetica,sans-serif;">Walk</p>
                  <p style="margin:2px 0 0;font-size:12px;font-weight:300;color:#aaaaaa;font-family:Arial,Helvetica,sans-serif;">Every step adds up</p>
                </td>
                <td style="padding-top:13px;vertical-align:middle;text-align:right;white-space:nowrap;">
                  <span style="font-size:15px;font-weight:500;color:#E8D200;font-family:Arial,Helvetica,sans-serif;">+5 pts</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- PARTNERS -->
        <tr>
          <td style="background-color:#080808;padding:28px 40px;border-bottom:1px solid #111111;text-align:center;">
            <p style="margin:0 0 20px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#333333;font-family:Arial,Helvetica,sans-serif;">Rewards from</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="padding:0 12px;"><a href="https://uk.huel.com/" style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:400;color:#ffffff;opacity:0.5;text-decoration:none;">Huel</a></td>
                <td style="width:3px;height:3px;background-color:#2a2a2a;border-radius:50%;vertical-align:middle;font-size:0;line-height:0;">&nbsp;</td>
                <td style="padding:0 12px;"><a href="https://wearetribe.co/" style="font-family:'Arial Black',Helvetica,sans-serif;font-size:15px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#ffffff;opacity:0.5;text-decoration:none;">TRIBE</a></td>
                <td style="width:3px;height:3px;background-color:#2a2a2a;border-radius:50%;vertical-align:middle;font-size:0;line-height:0;">&nbsp;</td>
                <td style="padding:0 12px;"><a href="https://eatfrank.com/" style="font-family:'Arial Black',Helvetica,sans-serif;font-size:15px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#ffffff;opacity:0.5;text-decoration:none;">FRANK</a></td>
                <td style="width:3px;height:3px;background-color:#2a2a2a;border-radius:50%;vertical-align:middle;font-size:0;line-height:0;">&nbsp;</td>
                <td style="padding:0 12px;"><a href="https://drinkrep.com/" style="font-family:'Arial Black',Helvetica,sans-serif;font-size:15px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#ffffff;opacity:0.5;text-decoration:none;">REP</a></td>
              </tr>
            </table>
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

  const text = `You're in, ${firstName}.

50 POWR points are waiting in your account.

POWR launches in the UK on 12 May 2026. You'll get access before anyone else.

HOW YOU EARN
• Gym session (GPS verified) — +20 pts
• Run (tracked via wearable) — +10 pts
• Walk (every step adds up) — +5 pts

REFER A FRIEND
You both get +50 points the moment they join.
${referralSlug ? `Your referral link: https://powr.life/?ref=${referralSlug}` : `Join the waitlist: https://powr.life`}

Every move counts.
— POWR
https://powr.life`;

  return {
    subject: `You're in, ${firstName}. Every move counts.`,
    html,
    text,
  };
}

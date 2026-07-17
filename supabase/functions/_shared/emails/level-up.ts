export interface LevelUpData {
  name: string | null;
  /** The level just reached (1–20). */
  level: number;
  /** Level display name, e.g. "Can't Sit Still". */
  levelName: string;
  /** Tier label, e.g. "ATHLETE". */
  tierLabel: string;
  /** Tier accent colour for the pill/label (email-safe hex). */
  tierColor: string;
  /** Lifetime POWR earned (what levels are computed from). */
  totalEarned: number;
  /** POWR banked into the Vault for this level-up, if any. */
  vaultBonus?: number | null;
  /** Level artwork PNG (powr-level-logo bucket). */
  levelImageUrl?: string | null;
  /** Next level teaser. */
  nextLevelName?: string | null;
  /** Lifetime POWR needed to reach the next level. */
  nextLevelAt?: number | null;
}

const GOLD = "#E8D200";
const POWR_LOGO = "https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/powrlogotext-app.png";

export function levelUpEmail(data: LevelUpData): { subject: string; html: string; text: string } {
  const firstName = data.name?.split(" ")[0] ?? "there";
  const tierColor = data.tierColor || GOLD;
  const vaultBonus = data.vaultBonus ?? 0;
  const toGo =
    data.nextLevelAt != null && data.nextLevelAt > data.totalEarned
      ? data.nextLevelAt - data.totalEarned
      : null;

  const preheader = `Level ${data.level} unlocked — you're now ${data.levelName}.`;

  const artworkHtml = data.levelImageUrl
    ? `
            <img src="${data.levelImageUrl}" alt="${data.levelName}" width="170" style="display:block;width:170px;max-width:60%;height:auto;margin:0 auto 26px;">`
    : "";

  const vaultHtml = vaultBonus > 0
    ? `
        <!-- VAULT BONUS -->
        <tr>
          <td style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#161608;border:1px dashed #3a3a2a;border-radius:14px;">
              <tr>
                <td style="padding:24px 28px;text-align:center;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#6b6420;font-family:Arial,Helvetica,sans-serif;">Banked in your vault</p>
                  <span style="display:block;font-size:44px;font-weight:200;color:${GOLD};letter-spacing:-1px;line-height:1.1;font-family:Arial,Helvetica,sans-serif;">+${vaultBonus.toLocaleString()}</span>
                  <p style="margin:8px 0 0;font-size:13px;font-weight:300;color:#999999;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Bonus POWR, vesting while you keep moving.<br>Open the Vault in the app to watch it build.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    : "";

  const nextHtml = data.nextLevelName
    ? `
        <!-- NEXT LEVEL -->
        <tr>
          <td style="background-color:#080808;padding:28px 40px;border-bottom:1px solid #161616;text-align:center;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#444444;font-family:Arial,Helvetica,sans-serif;">Up next</p>
            <p style="margin:0;font-size:16px;font-weight:400;color:#cccccc;font-family:Arial,Helvetica,sans-serif;">${data.nextLevelName}${toGo != null ? ` &mdash; <span style="color:${GOLD};font-weight:600;">${toGo.toLocaleString()} POWR</span> to go` : ""}</p>
          </td>
        </tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Level ${data.level} unlocked</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">

<!-- Preheader -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;">${preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff;">
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
          <td style="background-color:#080808;padding:44px 40px 40px;text-align:center;border-bottom:1px solid #111111;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 24px;">
              <tr>
                <td style="border:1px solid #2a2a2a;border-radius:100px;padding:6px 14px 6px 10px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="width:6px;height:6px;background-color:${tierColor};border-radius:50%;vertical-align:middle;font-size:0;line-height:0;">&nbsp;</td>
                      <td style="padding-left:7px;font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:${tierColor};vertical-align:middle;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">${data.tierLabel} tier</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            ${artworkHtml}
            <h1 style="margin:0 0 6px;font-size:42px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:Arial,Helvetica,sans-serif;">Level ${data.level} unlocked.<br><em style="font-style:italic;color:${GOLD};">${data.levelName}.</em></h1>
            <p style="margin:16px 0 0;font-size:15px;font-weight:300;color:#888888;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">Nice work, ${firstName} &mdash; ${data.totalEarned.toLocaleString()} POWR earned, all&nbsp;time.<br>That's not luck. That's showing up.</p>
          </td>
        </tr>
${vaultHtml}${nextHtml}
        <!-- CTA -->
        <tr>
          <td style="background-color:#080808;padding:36px 40px;text-align:center;border-bottom:1px solid #161616;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:24px;background-color:${GOLD};">
                  <a href="https://powr.life/app" style="display:inline-block;padding:13px 30px;font-size:12px;font-weight:700;color:#080808;font-family:Arial,Helvetica,sans-serif;text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">See your progress</a>
                </td>
              </tr>
            </table>
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#555555;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">Your level badge is on your profile &mdash; share it if you're proud of it.<br>You should be.</p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#050505;padding:32px 40px;text-align:center;">
            <img src="${POWR_LOGO}" alt="POWR" height="16" style="height:16px;width:auto;display:block;margin:0 auto 16px;opacity:0.15;">
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

  const textLines = [
    `Level ${data.level} unlocked: ${data.levelName}.`,
    "",
    `Nice work, ${firstName} — ${data.totalEarned.toLocaleString()} POWR earned, all time. That's not luck. That's showing up.`,
  ];
  if (vaultBonus > 0) {
    textLines.push(
      "",
      `BANKED IN YOUR VAULT: +${vaultBonus.toLocaleString()} POWR`,
      "Bonus POWR, vesting while you keep moving. Open the Vault in the app to watch it build.",
    );
  }
  if (data.nextLevelName) {
    textLines.push(
      "",
      `UP NEXT: ${data.nextLevelName}${toGo != null ? ` — ${toGo.toLocaleString()} POWR to go` : ""}`,
    );
  }
  textLines.push(
    "",
    "See your progress: https://powr.life/app",
    "",
    "Every move counts.",
    "— POWR",
    "https://powr.life",
  );

  return {
    subject: `Level ${data.level} unlocked: ${data.levelName}.`,
    html,
    text: textLines.join("\n"),
  };
}

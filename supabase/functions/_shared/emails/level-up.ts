import { emailShell, esc, FONT, GOLD } from "./layout.ts";

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


export function levelUpEmail(data: LevelUpData): { subject: string; html: string; text: string } {
  const plainName = data.name?.trim().split(" ")[0] || "there";
  const firstName = esc(plainName);
  const tierColor = data.tierColor || GOLD;
  const vaultBonus = data.vaultBonus ?? 0;
  const toGo =
    data.nextLevelAt != null && data.nextLevelAt > data.totalEarned
      ? data.nextLevelAt - data.totalEarned
      : null;

  const preheader = `Level ${data.level} unlocked — you're now ${data.levelName}.`;

  const artworkHtml = data.levelImageUrl
    ? `
            <img src="${data.levelImageUrl}" alt="${esc(data.levelName)}" width="170" style="display:block;width:170px;max-width:60%;height:auto;margin:0 auto 26px;">`
    : "";

  const vaultHtml = vaultBonus > 0
    ? `
        <!-- VAULT BONUS -->
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#161608;border:1px dashed #3a3a2a;border-radius:14px;">
              <tr>
                <td style="padding:24px 28px;text-align:center;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#8F8203;font-family:${FONT};">Banked in your vault</p>
                  <span style="display:block;font-size:44px;font-weight:200;color:${GOLD};letter-spacing:-1px;line-height:1.1;font-family:${FONT};">+${vaultBonus.toLocaleString()}</span>
                  <p style="margin:8px 0 0;font-size:13px;font-weight:300;color:#999999;line-height:1.6;font-family:${FONT};">Bonus POWR, vesting while you keep moving.<br class="br-d"> Open the Vault in the app to watch it build.</p>
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
          <td class="sec" style="background-color:#080808;padding:28px 40px;border-bottom:1px solid #161616;text-align:center;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#777777;font-family:${FONT};">Up next</p>
            <p style="margin:0;font-size:16px;font-weight:400;color:#cccccc;font-family:${FONT};">${data.nextLevelName}${toGo != null ? ` &mdash; <span style="color:${GOLD};font-weight:600;">${toGo.toLocaleString()} POWR</span> to go` : ""}</p>
          </td>
        </tr>`
    : "";

  const rows = `
        <!-- HERO -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:44px 40px 40px;text-align:center;border-bottom:1px solid #111111;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 24px;">
              <tr>
                <td style="border:1px solid #2a2a2a;border-radius:100px;padding:6px 14px 6px 10px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="width:6px;vertical-align:middle;font-size:0;line-height:0;"><span style="display:inline-block;width:6px;height:6px;border-radius:3px;background-color:${tierColor};font-size:0;line-height:0;">&nbsp;</span></td>
                      <td style="padding-left:7px;font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:${tierColor};vertical-align:middle;font-family:${FONT};white-space:nowrap;">${data.tierLabel} tier</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            ${artworkHtml}
            <h1 class="hero-h1" style="margin:0 0 6px;font-size:42px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:${FONT};">Level ${data.level} unlocked.<br><em style="font-style:italic;color:${GOLD};">${esc(data.levelName)}.</em></h1>
            <p style="margin:16px 0 0;font-size:15px;font-weight:300;color:#888888;line-height:1.7;font-family:${FONT};">Nice work, ${firstName} &mdash; ${data.totalEarned.toLocaleString()} POWR earned, all&nbsp;time.<br class="br-d"> That's not luck. That's showing up.</p>
          </td>
        </tr>
${vaultHtml}${nextHtml}
        <!-- CTA -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:36px 40px;text-align:center;border-bottom:1px solid #161616;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:24px;background-color:${GOLD};">
                  <a href="https://powr.life/app" style="display:inline-block;padding:13px 30px;font-size:12px;font-weight:700;color:#080808;font-family:${FONT};text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">See your progress</a>
                </td>
              </tr>
            </table>
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#888888;line-height:1.6;font-family:${FONT};">Your level badge is on your profile &mdash; share it if you're proud of it.<br class="br-d"> You should be.</p>
          </td>
        </tr>`;

  const html = emailShell({ title: `Level ${data.level} unlocked`, preheader, rows });

  const textLines = [
    `Level ${data.level} unlocked: ${data.levelName}.`,
    "",
    `Nice work, ${plainName} — ${data.totalEarned.toLocaleString()} POWR earned, all time. That's not luck. That's showing up.`,
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

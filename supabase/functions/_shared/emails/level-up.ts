import { tEmail } from "../i18n/index.ts";
import { emailShell, esc, FONT, GOLD } from "./layout.ts";
import { BR_DESKTOP, firstNameOf, fmtNum } from "./member-copy.ts";

export interface LevelUpData {
  name: string | null;
  /** The level just reached (1–20). */
  level: number;
  /** Level display name in the email's language, e.g. "Can't Sit Still" (levelName(lang, level)). */
  levelName: string;
  /** Tier label in the email's language, e.g. "Athlete" (member-copy tierLabel(lang, tier)). */
  tierLabel: string;
  /** Tier accent colour for the pill/label (email-safe hex). */
  tierColor: string;
  /** Lifetime POWR earned (what levels are computed from). */
  totalEarned: number;
  /** POWR banked into the Vault for this level-up, if any. */
  vaultBonus?: number | null;
  /** Level artwork PNG (powr-level-logo bucket). */
  levelImageUrl?: string | null;
  /** Next level teaser, in the email's language. */
  nextLevelName?: string | null;
  /** Lifetime POWR needed to reach the next level. */
  nextLevelAt?: number | null;
}


export function levelUpEmail(data: LevelUpData, lang = "en"): { subject: string; html: string; text: string } {
  const plainName = firstNameOf(data.name, lang);
  const firstName = esc(plainName);
  const tierColor = data.tierColor || GOLD;
  const vaultBonus = data.vaultBonus ?? 0;
  const toGo =
    data.nextLevelAt != null && data.nextLevelAt > data.totalEarned
      ? data.nextLevelAt - data.totalEarned
      : null;

  const preheader = tEmail(lang, "levelUp.preheader", { level: data.level, name: data.levelName });

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
                  <p style="margin:0 0 4px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#8F8203;font-family:${FONT};">${tEmail(lang, "levelUp.vault.title")}</p>
                  <span style="display:block;font-size:44px;font-weight:200;color:${GOLD};letter-spacing:-1px;line-height:1.1;font-family:${FONT};">+${fmtNum(vaultBonus, lang)}</span>
                  <p style="margin:8px 0 0;font-size:13px;font-weight:300;color:#999999;line-height:1.6;font-family:${FONT};">${tEmail(lang, "levelUp.vault.bodyHtml", { br: BR_DESKTOP })}</p>
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
            <p style="margin:0 0 6px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#777777;font-family:${FONT};">${tEmail(lang, "levelUp.next.title")}</p>
            <p style="margin:0;font-size:16px;font-weight:400;color:#cccccc;font-family:${FONT};">${toGo != null ? tEmail(lang, "levelUp.next.toGoHtml", { name: data.nextLevelName, amount: `<span style="color:${GOLD};font-weight:600;">${fmtNum(toGo, lang)} POWR</span>` }) : data.nextLevelName}</p>
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
                      <td style="padding-left:7px;font-size:11px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:${tierColor};vertical-align:middle;font-family:${FONT};white-space:nowrap;">${tEmail(lang, "levelUp.tierPill", { tier: data.tierLabel })}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            ${artworkHtml}
            <h1 class="hero-h1" style="margin:0 0 6px;font-size:42px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:${FONT};">${tEmail(lang, "levelUp.heroTitle", { level: data.level })}<br><em style="font-style:italic;color:${GOLD};">${esc(data.levelName)}.</em></h1>
            <p style="margin:16px 0 0;font-size:15px;font-weight:300;color:#888888;line-height:1.7;font-family:${FONT};">${tEmail(lang, "levelUp.bodyHtml", { name: firstName, points: fmtNum(data.totalEarned, lang), br: BR_DESKTOP })}</p>
          </td>
        </tr>
${vaultHtml}${nextHtml}
        <!-- CTA -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:36px 40px;text-align:center;border-bottom:1px solid #161616;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:24px;background-color:${GOLD};">
                  <a href="https://powr.life/app" style="display:inline-block;padding:13px 30px;font-size:12px;font-weight:700;color:#080808;font-family:${FONT};text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">${tEmail(lang, "levelUp.cta")}</a>
                </td>
              </tr>
            </table>
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#888888;line-height:1.6;font-family:${FONT};">${tEmail(lang, "levelUp.shareHtml", { br: BR_DESKTOP })}</p>
          </td>
        </tr>`;

  const html = emailShell({ title: tEmail(lang, "levelUp.title", { level: data.level }), preheader, rows, lang });

  const subject = tEmail(lang, "levelUp.subject", { level: data.level, name: data.levelName });
  const textLines = [
    subject,
    "",
    tEmail(lang, "levelUp.text.body", { name: plainName, points: fmtNum(data.totalEarned, lang) }),
  ];
  if (vaultBonus > 0) {
    textLines.push(
      "",
      tEmail(lang, "levelUp.text.vaultTitle", { amount: fmtNum(vaultBonus, lang) }),
      tEmail(lang, "levelUp.text.vaultBody"),
    );
  }
  if (data.nextLevelName) {
    textLines.push(
      "",
      toGo != null
        ? tEmail(lang, "levelUp.text.nextToGo", { name: data.nextLevelName, amount: fmtNum(toGo, lang) })
        : tEmail(lang, "levelUp.text.next", { name: data.nextLevelName }),
    );
  }
  textLines.push(
    "",
    tEmail(lang, "levelUp.text.cta", { url: "https://powr.life/app" }),
    "",
    tEmail(lang, "common.everyMoveCounts"),
    "— POWR",
    "https://powr.life",
  );

  return {
    subject,
    html,
    text: textLines.join("\n"),
  };
}

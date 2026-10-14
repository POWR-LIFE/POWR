import { tEmail } from "../i18n/index.ts";
import { emailShell, esc, FONT, GOLD } from "./layout.ts";
import { BR_DESKTOP, firstNameOf } from "./member-copy.ts";

export interface WelcomeData {
  name: string | null;
  /** The user's shareable referral / promo code (profiles.referral_code). */
  referralCode?: string | null;
  /** Whether the user granted location access during onboarding (+20 POWR). */
  locationGranted?: boolean;
  /** Whether the user connected a wearable / health source during onboarding (+20 POWR). */
  wearableConnected?: boolean;
  /** Total POWR earned during the signup journey. Falls back to a computed total. */
  pointsEarned?: number | null;
}

// Points awarded for each signup-journey action. Kept in sync with the
// award-bonus edge function's ALLOWED_BONUSES table.
const SIGNUP_BONUS = 20;
const LOCATION_BONUS = 20;
const WEARABLE_BONUS = 20;
const REFERRAL_BONUS = 20;


/** A single "what you earned" row — gold tick, label, sublabel, points. */
function earnedRow(label: string, sub: string, pts: number, isLast: boolean, lang: string): string {
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${isLast ? "" : ' style="border-bottom:1px solid #161616;"'}>
              <tr>
                <td style="padding:14px 0;width:26px;vertical-align:middle;">
                  <table role="presentation" width="20" height="20" cellspacing="0" cellpadding="0" border="0" style="width:20px;height:20px;border-radius:50%;background-color:${GOLD};">
                    <tr><td align="center" style="font-size:12px;font-weight:700;color:#080808;line-height:20px;font-family:${FONT};">&#10003;</td></tr>
                  </table>
                </td>
                <td style="padding:14px 0 14px 14px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:500;color:#F2F2F2;font-family:${FONT};">${label}</p>
                  <p style="margin:2px 0 0;font-size:12px;font-weight:300;color:#888888;font-family:${FONT};">${sub}</p>
                </td>
                <td style="padding:14px 0;vertical-align:middle;text-align:right;white-space:nowrap;">
                  <span style="font-size:15px;font-weight:600;color:${GOLD};font-family:${FONT};">${tEmail(lang, "common.plusPts", { points: pts })}</span>
                </td>
              </tr>
            </table>`;
}

/** A single "still to unlock" row — hollow marker, label, sublabel, points. */
function unlockRow(label: string, sub: string, pts: number, isLast: boolean, lang: string): string {
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${isLast ? "" : ' style="border-bottom:1px solid #161616;"'}>
              <tr>
                <td style="padding:14px 0;width:26px;vertical-align:middle;">
                  <table role="presentation" width="20" height="20" cellspacing="0" cellpadding="0" border="0" style="width:20px;height:20px;border-radius:50%;border:1px solid #333333;">
                    <tr><td style="font-size:0;line-height:0;">&nbsp;</td></tr>
                  </table>
                </td>
                <td style="padding:14px 0 14px 14px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:500;color:#cccccc;font-family:${FONT};">${label}</p>
                  <p style="margin:2px 0 0;font-size:12px;font-weight:300;color:#777777;font-family:${FONT};">${sub}</p>
                </td>
                <td style="padding:14px 0;vertical-align:middle;text-align:right;white-space:nowrap;">
                  <span style="font-size:13px;font-weight:600;color:#666666;font-family:${FONT};">${tEmail(lang, "common.plusPts", { points: pts })}</span>
                </td>
              </tr>
            </table>`;
}

export function welcomeEmail(data: WelcomeData, lang = "en"): { subject: string; html: string; text: string } {
  const plainName = firstNameOf(data.name, lang);
  const firstName = esc(plainName);
  const locationGranted = data.locationGranted ?? false;
  const wearableConnected = data.wearableConnected ?? false;
  const referralCode = data.referralCode ?? null;

  // Build the "what you earned" list — the welcome bonus is always present.
  const earned: { label: string; sub: string; pts: number }[] = [
    { label: tEmail(lang, "welcome.earned.account"), sub: tEmail(lang, "welcome.earned.accountSub"), pts: SIGNUP_BONUS },
  ];
  if (locationGranted) {
    earned.push({ label: tEmail(lang, "welcome.earned.location"), sub: tEmail(lang, "welcome.earned.locationSub"), pts: LOCATION_BONUS });
  }
  if (wearableConnected) {
    earned.push({ label: tEmail(lang, "welcome.earned.wearable"), sub: tEmail(lang, "welcome.earned.wearableSub"), pts: WEARABLE_BONUS });
  }

  // Anything not done yet becomes a value-led nudge.
  const unlock: { label: string; sub: string; pts: number }[] = [];
  if (!locationGranted) {
    unlock.push({ label: tEmail(lang, "welcome.unlock.location"), sub: tEmail(lang, "welcome.unlock.locationSub"), pts: LOCATION_BONUS });
  }
  if (!wearableConnected) {
    unlock.push({ label: tEmail(lang, "welcome.unlock.wearable"), sub: tEmail(lang, "welcome.unlock.wearableSub"), pts: WEARABLE_BONUS });
  }

  const computedTotal = earned.reduce((sum, e) => sum + e.pts, 0);
  const totalEarned = data.pointsEarned ?? computedTotal;

  const referralUrl = referralCode ? `https://powr.life/?ref=${encodeURIComponent(referralCode)}` : "https://powr.life";
  const preheader = tEmail(lang, "welcome.preheader", { name: plainName, points: totalEarned });

  const earnedRowsHtml = earned
    .map((e, i) => earnedRow(e.label, e.sub, e.pts, i === earned.length - 1, lang))
    .join("");

  const unlockSectionHtml = unlock.length
    ? `
        <!-- UNLOCK MORE -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:32px 40px;border-bottom:1px solid #111111;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#777777;font-family:${FONT};">${tEmail(lang, "welcome.unlockMore")}</p>
            <p style="margin:0 0 14px;font-size:14px;font-weight:300;color:#999999;line-height:1.6;font-family:${FONT};">${tEmail(lang, "welcome.unlockMoreBody")}</p>
            ${unlock.map((u, i) => unlockRow(u.label, u.sub, u.pts, i === unlock.length - 1, lang)).join("")}
          </td>
        </tr>`
    : "";

  const rows = `
        <!-- HERO -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:44px 40px 40px;text-align:center;border-bottom:1px solid #111111;">
            <h1 class="hero-h1" style="margin:0 0 6px;font-size:42px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:${FONT};">${tEmail(lang, "welcome.heroHtml", { name: firstName })}<br><em style="font-style:italic;color:${GOLD};">${tEmail(lang, "common.everyMoveCounts")}</em></h1>
            <p style="margin:16px 0 0;font-size:15px;font-weight:300;color:#888888;line-height:1.7;font-family:${FONT};">${tEmail(lang, "welcome.introHtml", { br: BR_DESKTOP })}</p>
          </td>
        </tr>

        <!-- POINTS TOTAL -->
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#111111;border:1px solid #222222;border-radius:14px;">
              <tr>
                <td style="padding:28px;text-align:center;">
                  <span style="display:block;font-size:72px;font-weight:200;color:${GOLD};letter-spacing:-3px;line-height:1;font-family:${FONT};">${totalEarned}</span>
                  <span style="display:block;margin-top:6px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${GOLD};font-family:${FONT};opacity:0.55;">${tEmail(lang, "welcome.pointsLabel")}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- WHAT YOU EARNED -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 8px;border-bottom:1px solid #111111;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#777777;font-family:${FONT};">${tEmail(lang, "welcome.earnedTitle")}</p>
            ${earnedRowsHtml}
          </td>
        </tr>
${unlockSectionHtml}
        <!-- REFERRAL / PROMO CODE -->
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#111111;border:1px solid #222222;border-radius:14px;">
              <tr>
                <td style="padding:26px;text-align:center;">
                  <p style="margin:0 0 6px;font-size:17px;font-weight:500;color:#F2F2F2;font-family:${FONT};">${tEmail(lang, "welcome.share.title")}</p>
                  <p style="margin:0 0 20px;font-size:13px;font-weight:300;color:#aaaaaa;line-height:1.65;font-family:${FONT};">${tEmail(lang, "welcome.share.bodyHtml", { strong: `<strong style="color:${GOLD};font-weight:600;">`, end: "</strong>", bonus: `<strong style="color:${GOLD};font-weight:600;">+${REFERRAL_BONUS} POWR</strong>` })}</p>
                  ${referralCode ? `
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 20px;">
                    <tr>
                      <td style="border:1px dashed #3a3a2a;border-radius:10px;background-color:#161608;padding:14px 26px;">
                        <span style="font-size:26px;font-weight:700;letter-spacing:6px;color:${GOLD};font-family:'Courier New',Courier,monospace;">${esc(referralCode)}</span>
                      </td>
                    </tr>
                  </table>` : ""}
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
                    <tr>
                      <td style="border-radius:24px;background-color:${GOLD};">
                        <a href="${referralUrl}" style="display:inline-block;padding:13px 30px;font-size:12px;font-weight:700;color:#080808;font-family:${FONT};text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">${tEmail(lang, "welcome.share.cta")}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td class="sec" style="background-color:#080808;padding:36px 40px;text-align:center;border-bottom:1px solid #161616;">
            <p style="margin:0 0 20px;font-size:14px;font-weight:300;color:#999999;line-height:1.6;font-family:${FONT};">${tEmail(lang, "welcome.closingHtml", { br: BR_DESKTOP })}</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="border-radius:24px;border:1px solid #333333;">
                  <a href="https://powr.life/app" style="display:inline-block;padding:13px 30px;font-size:12px;font-weight:700;color:#F2F2F2;font-family:${FONT};text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;">${tEmail(lang, "common.openPowr")}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

  const html = emailShell({ title: tEmail(lang, "welcome.title"), preheader, rows, lang });

  const earnedText = earned.map((e) => `  [x] ${e.label} — ${tEmail(lang, "common.plusPts", { points: e.pts })}`).join("\n");
  const unlockText = unlock.length
    ? `\n\n${tEmail(lang, "welcome.text.unlockTitle")}\n${unlock.map((u) => `  [ ] ${u.label} — ${tEmail(lang, "common.plusPts", { points: u.pts })}`).join("\n")}`
    : "";

  const text = `${tEmail(lang, "welcome.text.greeting", { name: plainName })}

${tEmail(lang, "welcome.text.intro")}

${tEmail(lang, "welcome.text.points", { points: totalEarned })}

${tEmail(lang, "welcome.text.earnedTitle")}
${earnedText}${unlockText}

${tEmail(lang, "welcome.text.shareTitle")}
${tEmail(lang, "welcome.text.shareBody", { bonus: REFERRAL_BONUS })}${referralCode ? `\n${tEmail(lang, "common.text.yourCode", { code: referralCode })}` : ""}
${tEmail(lang, "welcome.text.invite", { url: referralUrl })}

${tEmail(lang, "welcome.text.closing")}

${tEmail(lang, "common.text.openPowr", { url: "https://powr.life/app" })}

${tEmail(lang, "common.everyMoveCounts")}
— POWR
https://powr.life`;

  return {
    subject: tEmail(lang, "welcome.subject", { name: plainName, points: totalEarned }),
    html,
    text,
  };
}

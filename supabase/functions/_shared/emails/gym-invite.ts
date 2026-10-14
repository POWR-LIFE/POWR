// Gym portal invite — the setup link for a gym's owner or a member of their
// team (manage-gym-staff create_invite). Transactional: no unsubscribe link.
// The link itself is the credential, so the copy says it is single-use.
// Words: tBusiness "gym.invite.*", in the language of whoever sent it (the
// reader may not have a POWR account yet).

import { tBusiness } from "../i18n/index.ts";
import { ctaButton, emailShell, esc, FONT, GOLD, optimizeImage, sectionLabel } from "./layout.ts";
import { HTML_MARKUP } from "./gym-mail-parts.ts";

export interface GymInviteData {
  /** partners.name of the gym. */
  gymName: string;
  /** Single-use link — /venue/setup/{token}. */
  setupUrl: string;
  role: "owner" | "staff";
  /** Optional gym logo, shown in a white tile above the heading. */
  logoUrl?: string | null;
  /** Whoever sent it, when a gym owner invited their own team ("Sam from Stars Gym"). */
  inviterName?: string | null;
}

function steps(lang: string): Array<[string, string]> {
  return [
    [tBusiness(lang, "gym.invite.steps.board.title"), tBusiness(lang, "gym.invite.steps.board.line")],
    [tBusiness(lang, "gym.invite.steps.coming.title"), tBusiness(lang, "gym.invite.steps.coming.line")],
    [tBusiness(lang, "gym.invite.steps.team.title"), tBusiness(lang, "gym.invite.steps.team.line")],
  ];
}

/** The intro under the heading; pass names escaped for the HTML, raw for the text part. */
function introFor(owner: boolean, gym: string, inviter: string, lang: string): string {
  if (owner) return tBusiness(lang, "gym.invite.introOwner");
  return inviter ? tBusiness(lang, "gym.invite.introStaffBy", { inviter, gym }) : tBusiness(lang, "gym.invite.introStaff", { gym });
}

export function gymInviteEmail(data: GymInviteData, lang = "en"): { subject: string; html: string; text: string } {
  const gym = data.gymName.replace(/[\r\n]+/g, " ").trim();
  const owner = data.role === "owner";
  const inviter = (data.inviterName ?? "").trim();
  const all = steps(lang);
  const list = owner ? all : all.slice(0, 2);

  const subject = owner
    ? tBusiness(lang, "gym.invite.subjectOwner", { gym })
    : inviter ? tBusiness(lang, "gym.invite.subjectStaffBy", { inviter, gym }) : tBusiness(lang, "gym.invite.subjectStaff", { gym });
  const preheader = owner ? tBusiness(lang, "gym.invite.preheaderOwner") : tBusiness(lang, "gym.invite.preheaderStaff", { gym });
  const headingHtml = owner
    ? tBusiness(lang, "gym.invite.headingOwnerHtml", { ...HTML_MARKUP, gym: esc(gym) })
    : tBusiness(lang, "gym.invite.headingStaffHtml", { ...HTML_MARKUP, gym: esc(gym) });
  const intro = introFor(owner, esc(gym), esc(inviter), lang);

  const logo = (data.logoUrl ?? "").trim();
  const logoTile = /^https:\/\//.test(logo)
    ? `
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 24px;">
              <tr>
                <td style="background-color:#ffffff;border-radius:16px;padding:14px 22px;">
                  <img src="${esc(optimizeImage(logo, { width: 240, height: 112, resize: "contain" }))}" alt="${esc(gym)}" height="56" style="display:block;height:56px;max-width:120px;width:auto;margin:0 auto;">
                </td>
              </tr>
            </table>`
    : "";

  const stepRows = list.map(([title, detail], i) => `
              <tr>
                <td style="${i < list.length - 1 ? "padding-bottom:18px;" : ""}vertical-align:top;width:28px;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:500;color:${GOLD};font-family:${FONT};line-height:22px;">${i + 1}</span>
                </td>
                <td style="padding:0 0 ${i < list.length - 1 ? "18px" : "0"} 12px;vertical-align:top;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#cccccc;font-family:${FONT};">${esc(title)}</p>
                  <p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#888888;font-family:${FONT};">${esc(detail)}</p>
                </td>
              </tr>`).join("");

  const rows = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:44px 40px 32px;text-align:center;border-bottom:1px solid #111111;">${logoTile}
            ${sectionLabel(esc(owner ? tBusiness(lang, "gym.invite.labelOwner") : tBusiness(lang, "gym.invite.labelStaff")))}
            <h1 class="hero-h1" style="margin:18px 0 0;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.18;color:#F2F2F2;font-family:${FONT};">${headingHtml}</h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#999999;line-height:1.7;font-family:${FONT};">${intro}</p>
          </td>
        </tr>
        <tr>
          <td class="sec" style="background-color:#080808;padding:8px 40px 36px;text-align:center;border-bottom:1px solid #161616;">
            ${ctaButton(esc(tBusiness(lang, "gym.invite.cta")), data.setupUrl)}
            <p style="margin:18px 0 0;font-size:11px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};">${esc(tBusiness(lang, "gym.invite.pasteLink"))}<br><span style="color:#999999;word-break:break-all;">${esc(data.setupUrl)}</span></p>
          </td>
        </tr>
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            ${sectionLabel(esc(tBusiness(lang, "gym.invite.inPortal")))}
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;">${stepRows}
            </table>
            <p style="margin:24px 0 0;font-size:11px;font-weight:300;color:#777777;line-height:1.7;font-family:${FONT};">${tBusiness(lang, "gym.invite.footerHtml")}</p>
          </td>
        </tr>`;

  const html = emailShell({ title: subject, preheader, rows, unsubscribe: false, lang });

  const text = `${owner ? tBusiness(lang, "gym.invite.headingOwner", { gym }) : tBusiness(lang, "gym.invite.headingStaff", { gym })}

${introFor(owner, gym, inviter, lang)}

${tBusiness(lang, "gym.invite.ctaText")}
${data.setupUrl}

${tBusiness(lang, "gym.invite.inPortal").toUpperCase()}
${list.map(([title, line], i) => tBusiness(lang, "gym.invite.stepText", { n: i + 1, title, line })).join("\n")}

${tBusiness(lang, "gym.invite.footer")}

— POWR
https://powr.life`;

  return { subject, html, text };
}

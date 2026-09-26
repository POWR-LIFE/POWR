// Gym portal invite — the setup link for a gym's owner or a member of their
// team (manage-gym-staff create_invite). Transactional: no unsubscribe link.
// The link itself is the credential, so the copy says it is single-use.

import { ctaButton, emailShell, esc, FONT, GOLD, optimizeImage, sectionLabel } from "./layout.ts";

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

const STEPS: Array<[string, string]> = [
  ["Put your leaderboard on the gym TV", "A live weekly board of who's training at your gym, plus the Gym League against every other POWR gym"],
  ["See who's coming in", "Athletes, sessions and busiest hours, week by week"],
  ["Bring your team in", "Give the people who run the floor their own login"],
];

export function gymInviteEmail(data: GymInviteData): { subject: string; html: string; text: string } {
  const gym = data.gymName.replace(/[\r\n]+/g, " ").trim();
  const owner = data.role === "owner";
  const inviter = (data.inviterName ?? "").trim();
  const steps = owner ? STEPS : STEPS.slice(0, 2);

  const subject = owner
    ? `Set up ${gym} on POWR`
    : `${inviter ? `${inviter} added you` : "You're invited"} to the ${gym} team on POWR`;
  const preheader = owner
    ? `Your gym portal is ready: screens, insights and your team, in one place. Takes a minute to set up.`
    : `Join the ${gym} team on POWR. Takes a minute to set up.`;
  const headingHtml = owner
    ? `Run ${esc(gym)}<br><em style="font-style:italic;color:${GOLD};">on POWR.</em>`
    : `Join the<br><em style="font-style:italic;color:${GOLD};">${esc(gym)} team.</em>`;
  const intro = owner
    ? `Your gym portal is ready. Set up your login below and you're in. Already use the POWR app? Sign in with that same account.`
    : `${inviter ? `${esc(inviter)} has` : "You've been"} invited you to help run ${esc(gym)} on POWR. Set up your login below. Already use the POWR app? Sign in with that same account.`;

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

  const stepRows = steps.map(([title, detail], i) => `
              <tr>
                <td style="${i < steps.length - 1 ? "padding-bottom:18px;" : ""}vertical-align:top;width:28px;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:500;color:${GOLD};font-family:${FONT};line-height:22px;">${i + 1}</span>
                </td>
                <td style="padding:0 0 ${i < steps.length - 1 ? "18px" : "0"} 12px;vertical-align:top;">
                  <p style="margin:0;font-size:14px;font-weight:400;color:#cccccc;font-family:${FONT};">${esc(title)}</p>
                  <p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#888888;font-family:${FONT};">${esc(detail)}</p>
                </td>
              </tr>`).join("");

  const rows = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:44px 40px 32px;text-align:center;border-bottom:1px solid #111111;">${logoTile}
            ${sectionLabel(owner ? "Gym Portal" : "Gym Team")}
            <h1 class="hero-h1" style="margin:18px 0 0;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.18;color:#F2F2F2;font-family:${FONT};">${headingHtml}</h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#999999;line-height:1.7;font-family:${FONT};">${intro}</p>
          </td>
        </tr>
        <tr>
          <td class="sec" style="background-color:#080808;padding:8px 40px 36px;text-align:center;border-bottom:1px solid #161616;">
            ${ctaButton("Set up your access", data.setupUrl)}
            <p style="margin:18px 0 0;font-size:11px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};">Or paste this link into your browser:<br><span style="color:#999999;word-break:break-all;">${esc(data.setupUrl)}</span></p>
          </td>
        </tr>
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:32px 40px;border-bottom:1px solid #161616;">
            ${sectionLabel("In the portal you can")}
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;">${stepRows}
            </table>
            <p style="margin:24px 0 0;font-size:11px;font-weight:300;color:#777777;line-height:1.7;font-family:${FONT};">This link works once and expires in 14 days. Didn&#8217;t expect it? Reply to this email and we&#8217;ll sort it.</p>
          </td>
        </tr>`;

  const html = emailShell({ title: subject, preheader, rows, unsubscribe: false });

  const text = `${owner ? `Run ${gym} on POWR.` : `Join the ${gym} team on POWR.`}

${owner
    ? "Your gym portal is ready. Set up your login below and you're in. Already use the POWR app? Sign in with that same account."
    : `${inviter ? `${inviter} has` : "You've been"} invited you to help run ${gym} on POWR. Set up your login below. Already use the POWR app? Sign in with that same account.`}

Set up your access:
${data.setupUrl}

IN THE PORTAL YOU CAN
${steps.map(([t, d], i) => `${i + 1}. ${t} — ${d}`).join("\n")}

This link works once and expires in 14 days. Didn't expect it? Reply to this email and we'll sort it.

— POWR
https://powr.life`;

  return { subject, html, text };
}

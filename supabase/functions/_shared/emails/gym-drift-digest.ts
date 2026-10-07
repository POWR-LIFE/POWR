// The morning email to a gym's team when someone new starts drifting: gone
// well past their own usual gap between visits (Retention, migration
// 20261007120000). Sent by send-gym-email (kind drift_digest) from the daily
// cron, only on days with someone new, only to staff who keep the switch on
// (portal Settings, then Email). Clash Pro names them; Clash+ gets the count.
// Facts come from get_gym_drift_digests(); the words from ../retentionCopy.ts,
// the same as the portal's.

import { ctaButton, emailShell, esc, FONT, GOLD, sectionLabel } from "./layout.ts";
import { PORTAL_URL } from "./gym-weekly-recap.ts";
import { driftHeadline, patternLine, quietLabel } from "../retentionCopy.ts";

export interface GymDriftPerson {
  name: string;
  gap_days: number;
  per_week?: number | null;
  usual_gap?: number | null;
  part?: string | null;
  dows?: number[] | null;
  is_member?: boolean;
}

export interface GymDriftDigestData {
  gymName: string;
  /** Clash Pro: names. Clash+: only how many. */
  named: boolean;
  /** Started drifting since yesterday's email. */
  newCount: number;
  /** The new ones, most overdue first (named only). */
  people: GymDriftPerson[];
  /** Everyone drifting / slipping right now, new or not. */
  drifting: number;
  slipping: number;
  portalUrl?: string;
}

const SHOW = 8;
const n = (v: number) => Math.max(0, Math.round(v)).toLocaleString("en-GB");

function personRow(p: GymDriftPerson, isLast: boolean): string {
  const pattern = patternLine(p);
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${isLast ? "" : ' style="border-bottom:1px solid #161616;"'}>
              <tr>
                <td style="padding:13px 0;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:500;color:#F2F2F2;font-family:${FONT};">${esc(p.name)}</p>
                  ${pattern ? `<p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#888888;font-family:${FONT};">${esc(pattern)}</p>` : ""}
                </td>
                <td style="padding:13px 0 13px 12px;vertical-align:middle;text-align:right;white-space:nowrap;">
                  <span style="display:inline-block;padding:5px 10px;border:1px solid #5c3d12;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#F5A524;font-family:${FONT};">${esc(quietLabel(p.gap_days))}</span>
                </td>
              </tr>
            </table>`;
}

export function gymDriftDigestEmail(data: GymDriftDigestData): { subject: string; html: string; text: string } {
  const gym = data.gymName;
  const portalUrl = data.portalUrl ?? PORTAL_URL;
  const retentionUrl = `${portalUrl}/retention`;
  const people = data.named ? data.people.slice(0, SHOW) : [];
  const more = data.named ? Math.max(0, data.newCount - people.length) : 0;
  const first = data.named && data.newCount === 1 ? data.people[0]?.name : null;

  const headline = driftHeadline(data.newCount, first);
  const subject = `${headline} at ${gym}`;
  const headlineHtml = first
    ? `${esc(first)} is <em style="font-style:italic;color:${GOLD};">drifting.</em>`
    : `${n(data.newCount)} ${data.newCount === 1 ? "person is" : "people are"}<br class="br-d"> <em style="font-style:italic;color:${GOLD};">drifting.</em>`;
  const body = data.newCount === 1
    ? "They've gone well past their usual gap between visits. A call or a text from the team now is easier than winning them back later."
    : "Each has gone well past their usual gap between visits. A call or a text from the team now is easier than winning them back later.";
  const preheader = data.named && people[0]
    ? `${people[0].name}: ${quietLabel(people[0].gap_days)}. ${patternLine(people[0]) || "See who in Retention."}`
    : `${body.split(".")[0]}.`;
  const totals = `In all at ${gym} right now: ${n(data.drifting)} drifting, ${n(data.slipping)} slipping.`;

  const hero = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:40px 40px 34px;text-align:center;border-bottom:1px solid #111111;">
            <p style="margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#777777;font-family:${FONT};">${esc(gym)} &middot; Retention</p>
            <h1 class="hero-h1" style="margin:0;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.18;color:#F2F2F2;font-family:${FONT};">${headlineHtml}</h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#999999;line-height:1.7;font-family:${FONT};">${esc(body)}</p>
          </td>
        </tr>`;

  const list = data.named
    ? `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 10px;border-bottom:1px solid #111111;">
            ${sectionLabel("Newly drifting")}
            ${people.map((p, i) => personRow(p, i === people.length - 1 && more === 0)).join("")}
            ${more > 0 ? `<p style="margin:12px 0 4px;font-size:12px;font-weight:300;color:#777777;font-family:${FONT};">And ${n(more)} more in Retention.</p>` : ""}
          </td>
        </tr>`
    : `
        <tr>
          <td class="sec" style="background-color:#080808;padding:26px 40px 24px;border-bottom:1px solid #111111;">
            ${sectionLabel("Who they are")}
            <p style="margin:8px 0 0;font-size:13px;font-weight:300;color:#bbbbbb;line-height:1.6;font-family:${FONT};">Clash Pro names them, with when they usually come in and a one-tap nudge from POWR.</p>
          </td>
        </tr>`;

  const cta = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:34px 40px;text-align:center;border-bottom:1px solid #161616;">
            ${ctaButton(data.named ? "See who's drifting" : "Open Retention", retentionUrl)}
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};">${esc(totals)}</p>
          </td>
        </tr>
        <tr>
          <td class="sec" style="background-color:#080808;padding:22px 40px;text-align:center;border-bottom:1px solid #111111;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#666666;line-height:1.7;font-family:${FONT};">You get this on mornings when someone at ${esc(gym)} starts drifting. Visits only, from POWR check-ins; members can switch this off in the app. Turn these emails off under <a href="${esc(`${portalUrl}/settings`)}" style="color:#8a8a8a;text-decoration:underline;">Settings</a> in the portal.</p>
          </td>
        </tr>`;

  const html = emailShell({ title: `${headline} · ${gym}`, preheader, rows: hero + list + cta, unsubscribe: false });

  const lines = [`${gym} · Retention`, "", `${headline}.`, "", body];
  if (data.named) {
    lines.push("", "NEWLY DRIFTING");
    people.forEach((p) => {
      const pattern = patternLine(p);
      lines.push(`- ${p.name}: ${quietLabel(p.gap_days)}${pattern ? ` (${pattern})` : ""}`);
    });
    if (more > 0) lines.push(`And ${n(more)} more in Retention.`);
  } else {
    lines.push("", "Clash Pro names them, with when they usually come in and a one-tap nudge from POWR.");
  }
  lines.push(
    "", totals,
    "", `${data.named ? "See who's drifting" : "Open Retention"}: ${retentionUrl}`,
    "", `You get this on mornings when someone at ${gym} starts drifting. Turn it off under Settings in the portal: ${portalUrl}/settings`,
    "", "— POWR", "https://powr.life",
  );

  return { subject, html, text: lines.join("\n") };
}

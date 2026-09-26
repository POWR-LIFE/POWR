// The gym's team hears about its own event at the moments that need a person:
//   results_ready — the board sealed and POWR froze the results: reveal them
//                   from your phone (or POWR does, at the safety-net time)
//   approved      — POWR checked the gym's first event and it is out
//   rejected      — POWR asked for one change before it goes out
//   pulled        — POWR took a published event down, with the reason
// Sent by send-gym-email from the live_events_gym_mail trigger. Facts come
// from get_gym_event_mail(); this file is only the words.

import { ctaButton, emailShell, esc, FONT, GOLD, sectionLabel } from "./layout.ts";
import { fmtDay, lastDay, PORTAL_URL } from "./gym-weekly-recap.ts";

export type GymEventMailKind = "results_ready" | "approved" | "rejected" | "pulled";

export interface GymEventMailData {
  kind: GymEventMailKind;
  gymName: string;
  tz: string;
  event: {
    id: string;
    name: string;
    participants: number;
    window_start_at: string;
    window_end_at: string;
    doors_open_at?: string | null;
    /** When POWR reveals the winners if nobody at the gym does. */
    auto_reveal_at?: string | null;
    /** POWR's note on a rejection or a pull. */
    review_note?: string | null;
  };
  /** results_ready: the sealed podium as it stands, top three. */
  top?: { rank: number; name: string; points: number; prize?: string | null }[];
  /** approved: from now on the gym's events go straight out. */
  trusted?: boolean;
  portalUrl?: string;
}

const n = (v: number) => Math.max(0, Math.round(v)).toLocaleString("en-GB");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

function fmtDayTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
}

function podiumRow(r: { rank: number; name: string; points: number; prize?: string | null }, isLast: boolean): string {
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${isLast ? "" : ' style="border-bottom:1px solid #161616;"'}>
              <tr>
                <td style="padding:13px 0;width:30px;vertical-align:middle;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:600;color:${GOLD};font-family:${FONT};line-height:22px;">${r.rank}</span>
                </td>
                <td style="padding:13px 0 13px 12px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:500;color:#F2F2F2;font-family:${FONT};">${esc(r.name)}</p>
                  ${r.prize ? `<p style="margin:2px 0 0;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#8F8203;font-family:${FONT};">${esc(r.prize)}</p>` : ""}
                </td>
                <td style="padding:13px 0;vertical-align:middle;text-align:right;white-space:nowrap;">
                  <span style="font-size:14px;font-weight:600;color:${GOLD};font-family:${FONT};">${n(r.points)}</span>
                  <span style="font-size:11px;font-weight:300;color:#666666;font-family:${FONT};">&nbsp;POWR</span>
                </td>
              </tr>
            </table>`;
}

function quote(note: string): string {
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px;background-color:#111111;border-left:2px solid ${GOLD};border-radius:0 12px 12px 0;">
              <tr><td style="padding:14px 18px;font-size:14px;font-weight:300;font-style:italic;color:#dddddd;line-height:1.6;font-family:${FONT};">${esc(note)}</td></tr>
            </table>`;
}

export function gymEventEmail(data: GymEventMailData): { subject: string; html: string; text: string } {
  const gym = data.gymName;
  const ev = data.event;
  const portalUrl = data.portalUrl ?? PORTAL_URL;
  const eventUrl = `${portalUrl}/events/${ev.id}`;
  const top = (data.top ?? []).slice(0, 3);
  const note = (ev.review_note ?? "").trim();

  let subject: string;
  let preheader: string;
  let headingHtml: string;
  let headingText: string;
  let body: string;
  let ctaLabel: string;
  let sectionHtml = "";
  const textExtra: string[] = [];

  switch (data.kind) {
    case "results_ready": {
      subject = `${ev.name}: the results are in`;
      headingText = "The results are in.";
      headingHtml = `The results<br class="br-d"> are <em style="font-style:italic;color:${GOLD};">in.</em>`;
      const safety = ev.auto_reveal_at ? ` If nobody does, POWR reveals them ${fmtDayTime(ev.auto_reveal_at, data.tz)}.` : "";
      body = `The board for ${ev.name} sealed after ${lastDay(ev.window_end_at, data.tz)} and the results are set. Reveal the winners from your phone when you're ready: everyone in it gets a notification and your screen flips at the same moment.${safety}`;
      preheader = top[0] ? `${top[0].name} leads. Reveal from your phone when you're ready.` : `Reveal the winners from your phone when you're ready.`;
      ctaLabel = "Reveal the winners";
      if (top.length) {
        sectionHtml = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 10px;border-bottom:1px solid #111111;">
            ${sectionLabel("The podium, as it stands")}
            <p style="margin:6px 0 4px;font-size:12px;font-weight:300;color:#777777;font-family:${FONT};">Only your team can see this until you reveal it.</p>
            ${top.map((r, i) => podiumRow(r, i === top.length - 1)).join("")}
          </td>
        </tr>`;
        textExtra.push("", "THE PODIUM, AS IT STANDS (only your team can see this until you reveal it)");
        top.forEach((r) => textExtra.push(`${r.rank}. ${r.name} — ${n(r.points)} POWR${r.prize ? ` (${r.prize})` : ""}`));
      }
      break;
    }
    case "approved": {
      subject = `${ev.name} is on`;
      headingText = "It's on.";
      headingHtml = `It's <em style="font-style:italic;color:${GOLD};">on.</em>`;
      body = `POWR checked ${ev.name} and it's in the app for your members from now. Scoring starts ${fmtDay(ev.window_start_at, data.tz)}.${data.trusted ? " From here your events go straight out, no check." : ""}`;
      preheader = `${ev.name} is in the app. Scoring starts ${fmtDay(ev.window_start_at, data.tz)}.`;
      ctaLabel = "See the event";
      if (note) { sectionHtml = noteSection("A note from POWR", note); textExtra.push("", `A note from POWR: ${note}`); }
      break;
    }
    case "rejected": {
      subject = `${ev.name}: one change before it goes out`;
      headingText = "One change, then it's on.";
      headingHtml = `One change,<br class="br-d"> then it's <em style="font-style:italic;color:${GOLD};">on.</em>`;
      body = `POWR looked at ${ev.name} and asked for a change before it goes out. Edit it in the portal and send it again; it's usually approved within a day.`;
      preheader = note || `Edit ${ev.name} and send it again.`;
      ctaLabel = "Edit the event";
      sectionHtml = noteSection("What to change", note || "Open the event for the note.");
      textExtra.push("", `What to change: ${note || "open the event for the note."}`);
      break;
    }
    default: {
      subject = `${ev.name} was pulled`;
      headingText = `POWR pulled ${ev.name}.`;
      headingHtml = `POWR pulled<br class="br-d"> <em style="font-style:italic;color:${GOLD};">${esc(ev.name)}.</em>`;
      body = `It no longer shows in the app for anyone${ev.participants > 0 ? `, including the ${plural(ev.participants, "person", "people")} who had joined` : ""}. If that's a surprise, reply to this email and a person will look.`;
      preheader = note || `It no longer shows in the app. Reply if that's a surprise.`;
      ctaLabel = "Open the event";
      sectionHtml = noteSection("The reason", note || "Reply to this email and we'll explain.");
      textExtra.push("", `The reason: ${note || "reply to this email and we'll explain."}`);
      break;
    }
  }

  const hero = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:40px 40px 34px;text-align:center;border-bottom:1px solid #111111;">
            <p style="margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#777777;font-family:${FONT};">${esc(gym)} &middot; ${esc(ev.name)}</p>
            <h1 class="hero-h1" style="margin:0;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.18;color:#F2F2F2;font-family:${FONT};">${headingHtml}</h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#999999;line-height:1.7;font-family:${FONT};">${esc(body)}</p>
          </td>
        </tr>`;

  const cta = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:34px 40px;text-align:center;border-bottom:1px solid #161616;">
            ${ctaButton(ctaLabel, eventUrl)}
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};">Sent to the team at ${esc(gym)} on POWR.</p>
          </td>
        </tr>`;

  const html = emailShell({ title: `${ev.name} · ${gym}`, preheader, rows: hero + sectionHtml + cta, unsubscribe: false });

  const text = [
    `${gym} · ${ev.name}`,
    "",
    headingText,
    "",
    body,
    ...textExtra,
    "",
    `${ctaLabel}: ${eventUrl}`,
    "",
    "— POWR",
    "https://powr.life",
  ].join("\n");

  return { subject, html, text };
}

function noteSection(label: string, note: string): string {
  return `
        <tr>
          <td class="sec" style="background-color:#080808;padding:26px 40px 28px;border-bottom:1px solid #111111;">
            ${sectionLabel(label)}
            ${quote(note)}
          </td>
        </tr>`;
}

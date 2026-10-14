// The gym's team hears about its own event at the moments that need a person:
//   results_ready — the board sealed and POWR froze the results: reveal them
//                   from your phone (or POWR does, at the safety-net time)
//   approved      — POWR checked the gym's first event and it is out
//   rejected      — POWR asked for one change before it goes out
//   pulled        — POWR took a published event down, with the reason
// Sent by send-gym-email from the live_events_gym_mail trigger. Facts come
// from get_gym_event_mail(); this file is only the words, in the reader's
// language (tBusiness "gym.event.*"). POWR's note and the event's own name
// stay as written.

import { tBusiness } from "../i18n/index.ts";
import { ctaButton, emailShell, esc, FONT, GOLD, sectionLabel } from "./layout.ts";
import { PORTAL_URL } from "./gym-weekly-recap.ts";
import { fmtCount, fmtDay, fmtDayTime, HTML_MARKUP, labelValue, lastDay } from "./gym-mail-parts.ts";

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

function podiumRow(r: { rank: number; name: string; points: number; prize?: string | null }, isLast: boolean, lang = "en"): string {
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
                  <span style="font-size:14px;font-weight:600;color:${GOLD};font-family:${FONT};">${fmtCount(r.points, lang)}</span>
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

export function gymEventEmail(data: GymEventMailData, lang = "en"): { subject: string; html: string; text: string } {
  const gym = data.gymName;
  const ev = data.event;
  const portalUrl = data.portalUrl ?? PORTAL_URL;
  const eventUrl = `${portalUrl}/events/${ev.id}`;
  const top = (data.top ?? []).slice(0, 3);
  const note = (ev.review_note ?? "").trim();
  const event = ev.name;
  const markup = { ...HTML_MARKUP, event: esc(ev.name) };

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
      subject = tBusiness(lang, "gym.event.resultsReady.subject", { event });
      headingText = tBusiness(lang, "gym.event.resultsReady.heading");
      headingHtml = tBusiness(lang, "gym.event.resultsReady.headingHtml", markup);
      const safety = ev.auto_reveal_at ? ` ${tBusiness(lang, "gym.event.resultsReady.safety", { when: fmtDayTime(ev.auto_reveal_at, data.tz, lang) })}` : "";
      body = `${tBusiness(lang, "gym.event.resultsReady.body", { event, day: lastDay(ev.window_end_at, data.tz, lang) })}${safety}`;
      preheader = top[0] ? tBusiness(lang, "gym.event.resultsReady.preheaderLeader", { name: top[0].name }) : tBusiness(lang, "gym.event.resultsReady.preheader");
      ctaLabel = tBusiness(lang, "gym.event.resultsReady.cta");
      if (top.length) {
        sectionHtml = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 10px;border-bottom:1px solid #111111;">
            ${sectionLabel(esc(tBusiness(lang, "gym.event.resultsReady.podium")))}
            <p style="margin:6px 0 4px;font-size:12px;font-weight:300;color:#777777;font-family:${FONT};">${esc(tBusiness(lang, "gym.event.resultsReady.podiumSub"))}</p>
            ${top.map((r, i) => podiumRow(r, i === top.length - 1, lang)).join("")}
          </td>
        </tr>`;
        textExtra.push("", tBusiness(lang, "gym.event.resultsReady.podiumText"));
        top.forEach((r) => textExtra.push(`${r.rank}. ${r.name} — ${fmtCount(r.points, lang)} POWR${r.prize ? ` (${r.prize})` : ""}`));
      }
      break;
    }
    case "approved": {
      const day = fmtDay(ev.window_start_at, data.tz, lang);
      subject = tBusiness(lang, "gym.event.approved.subject", { event });
      headingText = tBusiness(lang, "gym.event.approved.heading");
      headingHtml = tBusiness(lang, "gym.event.approved.headingHtml", markup);
      body = `${tBusiness(lang, "gym.event.approved.body", { event, day })}${data.trusted ? ` ${tBusiness(lang, "gym.event.approved.trusted")}` : ""}`;
      preheader = tBusiness(lang, "gym.event.approved.preheader", { event, day });
      ctaLabel = tBusiness(lang, "gym.event.approved.cta");
      if (note) {
        const label = tBusiness(lang, "gym.common.noteFromPowr");
        sectionHtml = noteSection(esc(label), note);
        textExtra.push("", labelValue(label, note, lang));
      }
      break;
    }
    case "rejected": {
      subject = tBusiness(lang, "gym.event.rejected.subject", { event });
      headingText = tBusiness(lang, "gym.event.rejected.heading");
      headingHtml = tBusiness(lang, "gym.event.rejected.headingHtml", markup);
      body = tBusiness(lang, "gym.event.rejected.body", { event });
      preheader = note || tBusiness(lang, "gym.event.rejected.preheader", { event });
      ctaLabel = tBusiness(lang, "gym.event.rejected.cta");
      const label = tBusiness(lang, "gym.event.rejected.label");
      sectionHtml = noteSection(esc(label), note || tBusiness(lang, "gym.event.rejected.noNote"));
      textExtra.push("", labelValue(label, note || tBusiness(lang, "gym.event.rejected.noNoteText"), lang));
      break;
    }
    default: {
      subject = tBusiness(lang, "gym.event.pulled.subject", { event });
      headingText = tBusiness(lang, "gym.event.pulled.heading", { event });
      headingHtml = tBusiness(lang, "gym.event.pulled.headingHtml", markup);
      body = ev.participants > 0
        ? tBusiness(lang, "gym.event.pulled.bodyJoined", { count: ev.participants, n: fmtCount(ev.participants, lang) })
        : tBusiness(lang, "gym.event.pulled.body");
      preheader = note || tBusiness(lang, "gym.event.pulled.preheader");
      ctaLabel = tBusiness(lang, "gym.event.pulled.cta");
      const label = tBusiness(lang, "gym.event.pulled.label");
      sectionHtml = noteSection(esc(label), note || tBusiness(lang, "gym.event.pulled.noNote"));
      textExtra.push("", labelValue(label, note || tBusiness(lang, "gym.event.pulled.noNoteText"), lang));
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
            ${ctaButton(esc(ctaLabel), eventUrl)}
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};">${tBusiness(lang, "gym.event.sentToTeamHtml", { gym: esc(gym) })}</p>
          </td>
        </tr>`;

  const html = emailShell({ title: `${ev.name} · ${gym}`, preheader, rows: hero + sectionHtml + cta, unsubscribe: false, lang });

  const text = [
    `${gym} · ${ev.name}`,
    "",
    headingText,
    "",
    body,
    ...textExtra,
    "",
    labelValue(ctaLabel, eventUrl, lang),
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

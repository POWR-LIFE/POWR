// POWR answering a gym, by email, so the answer doesn't wait for someone to
// open the portal:
//   support_reply  POWR answered (or changed its answer to) a question the
//                  team sent from Settings, then Help. To whoever wrote it.
//   clash_night    POWR confirmed or declined a Clash Night, or called off
//                  one it had confirmed. To the owners and whoever asked.
// Sent by send-gym-email from the triggers in 20261007180000. This file is
// only the words.

import { emailShell } from "./layout.ts";
import { fmtDay, PORTAL_URL } from "./gym-weekly-recap.ts";
import { ctaRow, gold, heroRow, noteRow, quoteSection, TEXT_SIGNOFF } from "./gym-mail-parts.ts";

type Rendered = { subject: string; html: string; text: string };

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

// ── support_reply ─────────────────────────────────────────────────────────

export interface GymSupportReplyData {
  gymName: string;
  subject: string;
  /** What they wrote. gym_submit_ticket stores it as "[Topic] message". */
  message: string;
  reply: string;
  /** POWR had answered before and changed its answer. */
  updated?: boolean;
  portalUrl?: string;
}

/** "[Events] The board…" → { topic: "Events", body: "The board…" }. */
export function splitTopic(message: string): { topic: string | null; body: string } {
  const m = /^\[([^\]\n]{1,40})\]\s*/.exec(message ?? "");
  return m ? { topic: m[1].trim(), body: (message ?? "").slice(m[0].length) } : { topic: null, body: message ?? "" };
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export function gymSupportReplyEmail(data: GymSupportReplyData): Rendered {
  const gym = oneLine(data.gymName);
  const url = `${data.portalUrl ?? PORTAL_URL}/settings#help`;
  const topicSubject = oneLine(data.subject) || "Your question";
  const { topic, body } = splitTopic(data.message);
  const asked = clip(body.trim(), 600);
  const subject = `Re: ${topicSubject}`;
  const headingHtml = data.updated ? `POWR updated<br class="br-d"> its ${gold("answer.")}` : `POWR ${gold("answered.")}`;
  const headingText = data.updated ? "POWR updated its answer." : "POWR answered.";
  const lead = data.updated
    ? `We've changed our answer to "${topicSubject}". Here it is in full.`
    : `Here's our answer to "${topicSubject}".`;

  const rows = heroRow(`${gym} · POWR support`, headingHtml, lead)
    + quoteSection("Our answer", data.reply.trim())
    + quoteSection("You asked", asked, topic ?? undefined)
    + ctaRow("See it in your portal", url, "Reply to this email to carry on the conversation.");

  const text = [
    `${gym} · POWR support`, "", headingText, "", lead, "",
    "OUR ANSWER", data.reply.trim(), "",
    `YOU ASKED${topic ? ` (${topic})` : ""}`, asked, "",
    `See it in your portal: ${url}`, "", "Reply to this email to carry on the conversation.", ...TEXT_SIGNOFF,
  ];
  return {
    subject,
    html: emailShell({ title: subject, preheader: clip(oneLine(data.reply), 140), rows, unsubscribe: false }),
    text: text.join("\n"),
  };
}

// ── clash_night ───────────────────────────────────────────────────────────

export interface GymClashNightData {
  gymName: string;
  decision: "confirmed" | "declined";
  /** The status before: a declined night that was 'confirmed' was called off. */
  was: string;
  nightDate: string;      // YYYY-MM-DD, the gym's date
  startTime?: string | null; // HH:MM[:SS]
  backupDate?: string | null;
  note?: string | null;
  portalUrl?: string;
}

/** "Fri 14 Nov" for a plain date (no time zone shift). */
function plainDay(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return "";
  return fmtDay(`${ymd.slice(0, 10)}T12:00:00Z`, "UTC");
}

/** "7pm" / "7:30pm" from "19:00:00". */
export function clockTime(hms: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hms ?? "");
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  return `${h % 12 === 0 ? 12 : h % 12}${min ? `:${m[2]}` : ""}${h < 12 ? "am" : "pm"}`;
}

export function gymClashNightEmail(data: GymClashNightData): Rendered {
  const gym = oneLine(data.gymName);
  const url = `${data.portalUrl ?? PORTAL_URL}/clash-nights`;
  const day = plainDay(data.nightDate);
  const time = clockTime(data.startTime);
  const note = (data.note ?? "").trim();
  const calledOff = data.decision === "declined" && data.was === "confirmed";

  let subject: string;
  let headingHtml: string;
  let headingText: string;
  let body: string;
  let cta: string;
  if (data.decision === "confirmed") {
    subject = `Clash Night confirmed: ${day}`;
    headingText = "It's confirmed.";
    headingHtml = `It's ${gold("confirmed.")}`;
    body = `${gym}'s Clash Night is on ${day}${time ? ` from ${time}` : ""}. POWR brings the DJ, the photographer and partner prizes. We'll be in touch about the plan for the night.`;
    cta = "See your Clash Nights";
  } else if (calledOff) {
    subject = `Clash Night on ${day} is off`;
    headingText = "We've had to call it off.";
    headingHtml = `We've had to<br class="br-d"> call it ${gold("off.")}`;
    body = `POWR has called off ${gym}'s Clash Night on ${day}. We're sorry for the change. The quarter is free again: pick another date and we'll confirm it.`;
    cta = "Pick another date";
  } else {
    const backup = plainDay(data.backupDate);
    subject = `Clash Night on ${day}: pick another date`;
    headingText = "Not that night.";
    headingHtml = `Not that ${gold("night.")}`;
    body = `POWR can't do ${day}${backup ? ` or ${backup}` : ""} for ${gym}'s Clash Night. The quarter is still yours: pick another date and we'll confirm it.`;
    cta = "Pick another date";
  }

  let rows = heroRow(`${gym} · Clash Night`, headingHtml, body);
  const text = [`${gym} · Clash Night`, "", headingText, "", body];
  if (note) {
    rows += quoteSection("A note from POWR", note);
    text.push("", "A NOTE FROM POWR", note);
  }
  if (data.decision === "confirmed") {
    const prep = "Tell your members early: it's the night of the quarter. The join poster and the Studio are in your portal for exactly this.";
    rows += noteRow("Before the night", prep);
    text.push("", "BEFORE THE NIGHT", prep);
  }
  rows += ctaRow(cta, url, "Questions about the night? Reply to this email.");
  text.push("", `${cta}: ${url}`, "", "Questions about the night? Reply to this email.", ...TEXT_SIGNOFF);

  return {
    subject,
    html: emailShell({ title: subject, preheader: note ? oneLine(note).slice(0, 140) : body.slice(0, 140), rows, unsubscribe: false }),
    text: text.join("\n"),
  };
}

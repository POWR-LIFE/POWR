// POWR answering a gym, by email, so the answer doesn't wait for someone to
// open the portal:
//   support_reply  POWR answered (or changed its answer to) a question the
//                  team sent from Settings, then Help. To whoever wrote it.
//   clash_night    POWR confirmed or declined a Clash Night, or called off
//                  one it had confirmed. To the owners and whoever asked.
// Sent by send-gym-email from the triggers in 20261007180000. This file is
// only the words, in the reader's language (tBusiness "gym.support.*",
// "gym.clashNight.*"). POWR's answer and note, and what the gym wrote, stay
// as typed.

import { tBusiness } from "../i18n/index.ts";
import { emailShell, esc } from "./layout.ts";
import { PORTAL_URL } from "./gym-weekly-recap.ts";
import { ctaRow, fmtDay, HTML_MARKUP, heroRow, labelValue, noteRow, quoteSection, TEXT_SIGNOFF } from "./gym-mail-parts.ts";

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

export function gymSupportReplyEmail(data: GymSupportReplyData, lang = "en"): Rendered {
  const gym = oneLine(data.gymName);
  const url = `${data.portalUrl ?? PORTAL_URL}/settings#help`;
  const topicSubject = oneLine(data.subject) || tBusiness(lang, "gym.support.yourQuestion");
  const { topic, body } = splitTopic(data.message);
  const asked = clip(body.trim(), 600);
  // The reply prefix every mail client threads on, in every language.
  const subject = `Re: ${topicSubject}`;
  const headingHtml = data.updated ? tBusiness(lang, "gym.support.headingUpdatedHtml", HTML_MARKUP) : tBusiness(lang, "gym.support.headingHtml", HTML_MARKUP);
  const headingText = data.updated ? tBusiness(lang, "gym.support.headingUpdated") : tBusiness(lang, "gym.support.heading");
  const lead = data.updated
    ? tBusiness(lang, "gym.support.leadUpdated", { subject: topicSubject })
    : tBusiness(lang, "gym.support.lead", { subject: topicSubject });
  const eyebrow = tBusiness(lang, "gym.support.eyebrow", { gym });
  const ourAnswer = tBusiness(lang, "gym.support.ourAnswer");
  const youAsked = tBusiness(lang, "gym.support.youAsked");
  const cta = tBusiness(lang, "gym.support.cta");
  const carryOn = tBusiness(lang, "gym.support.carryOn");

  const rows = heroRow(eyebrow, headingHtml, lead)
    + quoteSection(ourAnswer, data.reply.trim())
    + quoteSection(youAsked, asked, topic ?? undefined)
    + ctaRow(esc(cta), url, carryOn);

  const text = [
    eyebrow, "", headingText, "", lead, "",
    ourAnswer.toUpperCase(), data.reply.trim(), "",
    `${youAsked.toUpperCase()}${topic ? ` (${topic})` : ""}`, asked, "",
    labelValue(cta, url, lang), "", carryOn, ...TEXT_SIGNOFF,
  ];
  return {
    subject,
    html: emailShell({ title: subject, preheader: clip(oneLine(data.reply), 140), rows, unsubscribe: false, lang }),
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
function plainDay(ymd: string | null | undefined, lang = "en"): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return "";
  return fmtDay(`${ymd.slice(0, 10)}T12:00:00Z`, "UTC", lang);
}

/** "7pm" / "7:30pm" from "19:00:00"; French and Spanish use the 24-hour clock ("19:00"). */
export function clockTime(hms: string | null | undefined, lang = "en"): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hms ?? "");
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (lang !== "en") return `${String(h).padStart(2, "0")}:${m[2]}`;
  return `${h % 12 === 0 ? 12 : h % 12}${min ? `:${m[2]}` : ""}${h < 12 ? "am" : "pm"}`;
}

export function gymClashNightEmail(data: GymClashNightData, lang = "en"): Rendered {
  const gym = oneLine(data.gymName);
  const url = `${data.portalUrl ?? PORTAL_URL}/clash-nights`;
  const day = plainDay(data.nightDate, lang);
  const time = clockTime(data.startTime, lang);
  const note = (data.note ?? "").trim();
  const calledOff = data.decision === "declined" && data.was === "confirmed";

  let subject: string;
  let headingHtml: string;
  let headingText: string;
  let body: string;
  let cta: string;
  if (data.decision === "confirmed") {
    subject = tBusiness(lang, "gym.clashNight.confirmed.subject", { day });
    headingText = tBusiness(lang, "gym.clashNight.confirmed.heading");
    headingHtml = tBusiness(lang, "gym.clashNight.confirmed.headingHtml", HTML_MARKUP);
    body = time
      ? tBusiness(lang, "gym.clashNight.confirmed.bodyTime", { gym, day, time })
      : tBusiness(lang, "gym.clashNight.confirmed.body", { gym, day });
    cta = tBusiness(lang, "gym.clashNight.confirmed.cta");
  } else if (calledOff) {
    subject = tBusiness(lang, "gym.clashNight.calledOff.subject", { day });
    headingText = tBusiness(lang, "gym.clashNight.calledOff.heading");
    headingHtml = tBusiness(lang, "gym.clashNight.calledOff.headingHtml", HTML_MARKUP);
    body = tBusiness(lang, "gym.clashNight.calledOff.body", { gym, day });
    cta = tBusiness(lang, "gym.clashNight.pickAnother");
  } else {
    const backup = plainDay(data.backupDate, lang);
    subject = tBusiness(lang, "gym.clashNight.declined.subject", { day });
    headingText = tBusiness(lang, "gym.clashNight.declined.heading");
    headingHtml = tBusiness(lang, "gym.clashNight.declined.headingHtml", HTML_MARKUP);
    body = backup
      ? tBusiness(lang, "gym.clashNight.declined.bodyBackup", { day, backup, gym })
      : tBusiness(lang, "gym.clashNight.declined.body", { day, gym });
    cta = tBusiness(lang, "gym.clashNight.pickAnother");
  }

  let rows = heroRow(`${gym} · Clash Night`, headingHtml, body);
  const text = [`${gym} · Clash Night`, "", headingText, "", body];
  if (note) {
    const label = tBusiness(lang, "gym.common.noteFromPowr");
    rows += quoteSection(label, note);
    text.push("", label.toUpperCase(), note);
  }
  if (data.decision === "confirmed") {
    const prep = tBusiness(lang, "gym.clashNight.prep");
    const before = tBusiness(lang, "gym.clashNight.before");
    rows += noteRow(before, prep);
    text.push("", before.toUpperCase(), prep);
  }
  const questions = tBusiness(lang, "gym.clashNight.questions");
  rows += ctaRow(esc(cta), url, questions);
  text.push("", labelValue(cta, url, lang), "", questions, ...TEXT_SIGNOFF);

  return {
    subject,
    html: emailShell({ title: subject, preheader: note ? oneLine(note).slice(0, 140) : body.slice(0, 140), rows, unsubscribe: false, lang }),
    text: text.join("\n"),
  };
}

// The gym's Monday recap: what its members did at the gym last week, in the
// numbers and words the portal shows. send-gym-email sends it to everyone on
// the gym's team who keeps the switch on (Settings, then Email). The numbers
// come from get_gym_weekly_recaps(); this file is only the words, in the
// reader's language (tBusiness "gymRecap.recap.*"; English byte for byte as
// before). Every function takes `lang` last, English by default.

import { formatLocale, tBusiness } from "../i18n/index.ts";
import { ctaButton, emailShell, esc, FONT, GOLD, sectionLabel } from "./layout.ts";
import { fmtCount as n, fmtDay, lastDay } from "./gym-mail-parts.ts";

// Other templates import these from here.
export { fmtDay, lastDay };

export const PORTAL_URL = "https://powr.life/venue";

export interface GymRecapEvent {
  id: string;
  name: string;
  /** scheduled | live | locked | revealed | draft */
  status: string;
  /** pending | rejected, for drafts with POWR. */
  review_status?: string | null;
  managed_by?: string | null;
  participants: number;
  window_start_at: string;
  window_end_at: string;
  revealed_at?: string | null;
}

/**
 * The members' notice (push gym_on_powr, once, when the portal went on) and
 * who has been back since: get_gym_notice_returns().
 */
export interface GymNoticeReturns {
  sentAt: string;
  told: number;
  /** Behind their own usual gap between visits that day (slipping, drifting, lapsed). */
  away: number;
  /** Not checked in there for 180 days or more, or never. */
  unseen: number;
  back: number;
  unseenBack: number;
  /** First visits back inside the recap's week. */
  backIn: number;
  unseenBackIn: number;
}

export interface GymWeeklyRecapData {
  gymName: string;
  /** "15–21 Sep": weekLabel(start, end, tz, lang). An English one is said again in the email's language. */
  weekLabel: string;
  /** The gym's time zone, for every date in the email. */
  tz: string;
  sessions: number;
  prevSessions: number;
  athletes: number;
  prevAthletes: number;
  minutes: number;
  /** Members whose first-ever session at this gym was last week. */
  newFaces: number;
  /** Members who picked this gym in the app. */
  members: number;
  /** Top of last week's board, as the gym's screen showed it. */
  top: { name: string; points: number; sessions: number }[];
  /** The day most sessions happened, or null when nothing was logged. An English day name ("Tuesday") is said in the email's language. */
  busiest: { day: string; sessions: number } | null;
  /** Members who have gone quiet; null when the package doesn't count them. */
  quiet: number | null;
  /** The package names them (Clash Pro): the line can point at Members. */
  quietNamed?: boolean;
  events: GymRecapEvent[];
  /** Shown for 12 weeks after the notice went (the caller decides). */
  notice?: GymNoticeReturns | null;
  portalUrl?: string;
}

/** The number a plural form agrees with: the one shown. */
const count = (v: number) => Math.max(0, Math.round(v));

/** "7 sessions", "1 session". */
const sessionsText = (v: number, lang: string) => tBusiness(lang, "gymRecap.recap.sessions", { count: count(v), n: n(v, lang) });

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "15–21 Sep" or "29 Sep – 5 Oct": the week's first day and its last, in the gym's time. */
export function weekLabel(startIso: string, endIso: string, tz: string, lang = "en"): string {
  const s = new Date(startIso);
  const e = new Date(new Date(endIso).getTime() - 60_000);
  const locale = formatLocale(lang);
  const day = (d: Date) => d.toLocaleDateString(locale, { day: "numeric", timeZone: tz });
  const mon = (d: Date) => d.toLocaleDateString(locale, { month: "short", timeZone: tz });
  return mon(s) === mon(e)
    ? tBusiness(lang, "gymRecap.recap.weekLabel.sameMonth", { from: day(s), to: day(e), month: mon(e) })
    : tBusiness(lang, "gymRecap.recap.weekLabel.twoMonths", { from: day(s), fromMonth: mon(s), to: day(e), toMonth: mon(e) });
}

/**
 * An English weekLabel() ("15–21 Sept", "29 Sept – 5 Oct") said again in
 * `lang`, for a sender that built the data in English. Anything else, and
 * English, comes back as given.
 */
function localWeek(label: string, lang: string): string {
  if (lang === "en" || typeof label !== "string") return label;
  const month = (m: string) => {
    const i = EN_MONTHS.indexOf(m === "Sept" ? "Sep" : m);
    return i < 0 ? "" : new Date(Date.UTC(2026, i, 15)).toLocaleDateString(formatLocale(lang), { month: "short", timeZone: "UTC" });
  };
  const one = /^(\d{1,2})–(\d{1,2}) ([A-Z][a-z]{2,3})$/.exec(label);
  if (one && month(one[3])) return tBusiness(lang, "gymRecap.recap.weekLabel.sameMonth", { from: one[1], to: one[2], month: month(one[3]) });
  const two = /^(\d{1,2}) ([A-Z][a-z]{2,3}) – (\d{1,2}) ([A-Z][a-z]{2,3})$/.exec(label);
  if (two && month(two[2]) && month(two[4])) {
    return tBusiness(lang, "gymRecap.recap.weekLabel.twoMonths", { from: two[1], fromMonth: month(two[2]), to: two[3], toMonth: month(two[4]) });
  }
  return label;
}

/** An English day name ("Tuesday") in `lang`; anything else as given. */
function localDay(day: string, lang: string): string {
  const i = EN_DAYS.indexOf(day);
  if (lang === "en" || i < 0) return day;
  return new Intl.DateTimeFormat(formatLocale(lang), { weekday: "long", timeZone: "UTC" }).format(Date.UTC(2026, 0, 5 + i));
}

/** One line under an event's name. Plain text; the caller escapes. */
export function eventLine(e: GymRecapEvent, tz: string, lang = "en"): string {
  const joined = tBusiness(lang, "gymRecap.recap.events.joined", { count: count(e.participants), n: n(e.participants, lang) });
  const line = e.status === "draft" && e.review_status === "pending" ? tBusiness(lang, "gymRecap.recap.events.pending")
    : e.status === "draft" && e.review_status === "rejected" ? tBusiness(lang, "gymRecap.recap.events.rejected")
    : e.status === "scheduled" ? tBusiness(lang, "gymRecap.recap.events.scheduled", { date: fmtDay(e.window_start_at, tz, lang), joined })
    : e.status === "live" ? tBusiness(lang, "gymRecap.recap.events.live", { joined, date: lastDay(e.window_end_at, tz, lang) })
    : e.status === "locked" ? tBusiness(lang, "gymRecap.recap.events.locked", { joined })
    : e.status === "revealed" ? tBusiness(lang, "gymRecap.recap.events.revealed", { date: fmtDay(e.revealed_at, tz, lang) })
    : joined;
  return e.managed_by === "powr" ? tBusiness(lang, "gymRecap.recap.events.runByPowr", { line }) : line;
}

function deltaChip(curr: number, prev: number | null | undefined, lang: string): string {
  if (prev == null) return "";
  const diff = curr - prev;
  if (diff === 0) return `<span style="font-size:11px;font-weight:600;color:#777777;font-family:${FONT};">${tBusiness(lang, "gymRecap.recap.tiles.levelHtml")}</span>`;
  const up = diff > 0;
  return `<span style="font-size:11px;font-weight:700;color:${up ? GOLD : "#999999"};font-family:${FONT};">${tBusiness(lang, "gymRecap.recap.tiles.deltaHtml", { arrow: up ? "&#9650;" : "&#9660;", n: n(Math.abs(diff), lang) })}</span>`;
}

function statTile(value: string, label: string, sub: string): string {
  return `
                <td width="33%" style="padding:0 5px;vertical-align:top;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#111111;border:1px solid #222222;border-radius:14px;">
                    <tr>
                      <td style="padding:20px 8px;text-align:center;">
                        <span class="statnum" style="display:block;font-size:34px;font-weight:200;color:#F2F2F2;letter-spacing:-1px;line-height:1.1;font-family:${FONT};">${value}</span>
                        <span style="display:block;margin-top:6px;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#777777;font-family:${FONT};">${label}</span>
                        <span style="display:block;margin-top:6px;line-height:1.3;">${sub}</span>
                      </td>
                    </tr>
                  </table>
                </td>`;
}

function topRow(rank: number, r: { name: string; points: number; sessions: number }, isLast: boolean, lang: string): string {
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${isLast ? "" : ' style="border-bottom:1px solid #161616;"'}>
              <tr>
                <td style="padding:13px 0;width:30px;vertical-align:middle;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:600;color:${GOLD};font-family:${FONT};line-height:22px;">${rank}</span>
                </td>
                <td style="padding:13px 0 13px 12px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:500;color:#F2F2F2;font-family:${FONT};">${esc(r.name)}</p>
                  <p style="margin:2px 0 0;font-size:11px;font-weight:300;color:#888888;font-family:${FONT};">${sessionsText(r.sessions, lang)}</p>
                </td>
                <td style="padding:13px 0;vertical-align:middle;text-align:right;white-space:nowrap;">
                  <span style="font-size:14px;font-weight:600;color:${GOLD};font-family:${FONT};">${n(r.points, lang)}</span>
                  <span style="font-size:11px;font-weight:300;color:#666666;font-family:${FONT};">&nbsp;POWR</span>
                </td>
              </tr>
            </table>`;
}

function eventRow(e: GymRecapEvent, tz: string, portalUrl: string, isLast: boolean, lang: string): string {
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${isLast ? "" : ' style="border-bottom:1px solid #161616;"'}>
              <tr>
                <td style="padding:13px 0;vertical-align:middle;">
                  <a href="${esc(`${portalUrl}/events/${e.id}`)}" style="text-decoration:none;">
                    <span style="display:block;font-size:14px;font-weight:500;color:#F2F2F2;font-family:${FONT};">${esc(e.name)}</span>
                    <span style="display:block;margin-top:2px;font-size:11px;font-weight:300;color:#888888;font-family:${FONT};">${esc(eventLine(e, tz, lang))}</span>
                  </a>
                </td>
              </tr>
            </table>`;
}

/** "Since we told your members": who has been back since the notice. */
export function noticeLines(nr: GymNoticeReturns, tz: string, gym: string, lang = "en"): { big: number | null; lead: string; lines: string[] } {
  const day = fmtDay(nr.sentAt, tz, lang);
  const awayAll = nr.away + nr.unseen;
  const backAll = nr.back + nr.unseenBack;
  const week = nr.backIn + nr.unseenBackIn;
  if (awayAll === 0) {
    return { big: null, lead: tBusiness(lang, "gymRecap.recap.notice.allRegular", { count: count(nr.told), n: n(nr.told, lang), date: day, gym }), lines: [] };
  }
  const lines: string[] = [];
  if (nr.away > 0) lines.push(tBusiness(lang, "gymRecap.recap.notice.behind", { count: count(nr.away), back: n(nr.back, lang), away: n(nr.away, lang) }));
  if (nr.unseen > 0) lines.push(tBusiness(lang, "gymRecap.recap.notice.unseen", { count: count(nr.unseen), back: n(nr.unseenBack, lang), unseen: n(nr.unseen, lang) }));
  if (week > 0) lines.push(tBusiness(lang, "gymRecap.recap.notice.lastWeek", { count: count(week), n: n(week, lang) }));
  const told = tBusiness(lang, "gymRecap.recap.notice.people", { count: count(nr.told), n: n(nr.told, lang) });
  return {
    big: backAll,
    lead: tBusiness(lang, "gymRecap.recap.notice.lead", { count: count(awayAll), n: n(awayAll, lang), told, date: day }),
    lines,
  };
}

function noteLine(text: string): string {
  return `<p style="margin:0 0 8px;font-size:13px;font-weight:300;color:#bbbbbb;line-height:1.6;font-family:${FONT};">${text}</p>`;
}

export function gymWeeklyRecapEmail(data: GymWeeklyRecapData, lang = "en"): { subject: string; html: string; text: string } {
  const gym = data.gymName;
  // Interpolated as the template literals before did: a missing name stays "null".
  const gymText = `${gym}`;
  const week = localWeek(data.weekLabel, lang);
  const portalUrl = data.portalUrl ?? PORTAL_URL;
  const top = (data.top ?? []).slice(0, 3);
  const events = (data.events ?? []).slice(0, 5);
  const quietWeek = data.sessions === 0;
  const quietNamed = data.quietNamed === true;
  const strong = { strong: '<strong style="font-weight:600;color:#F2F2F2;">', end: "</strong>" };
  const plain = { strong: "", end: "" };

  const subject = quietWeek
    ? tBusiness(lang, "gymRecap.recap.subjectQuiet", { gym: gymText })
    : tBusiness(lang, "gymRecap.recap.subject", { count: count(data.sessions), n: n(data.sessions, lang), gym: gymText });

  const athletes = { week: `${week}`, count: count(data.athletes), n: n(data.athletes, lang) };
  const preheader = quietWeek
    ? tBusiness(lang, "gymRecap.recap.preheaderQuiet", { week: `${week}`, gym: gymText })
    : (data.newFaces > 0
      ? tBusiness(lang, "gymRecap.recap.preheaderNew", { ...athletes, newFaces: data.newFaces })
      : tBusiness(lang, "gymRecap.recap.preheader", athletes)) +
      (top[0] ? ` ${tBusiness(lang, "gymRecap.recap.preheaderTop", { name: `${top[0].name}` })}` : "");

  const heroCopy = quietWeek
    ? tBusiness(lang, "gymRecap.recap.leadQuiet", { gym: esc(gym) })
    : tBusiness(lang, "gymRecap.recap.lead", { gym: esc(gym) });

  // ── Also this week: the busiest day, who's drifting ─────────────────
  const also: string[] = [];
  const alsoText: string[] = [];
  if (data.busiest && data.busiest.sessions > 0) {
    const day = localDay(data.busiest.day, lang);
    const busy = { count: count(data.busiest.sessions), n: n(data.busiest.sessions, lang) };
    also.push(noteLine(tBusiness(lang, "gymRecap.recap.also.busiestHtml", { ...busy, ...strong, day: esc(day) })));
    alsoText.push(tBusiness(lang, "gymRecap.recap.also.busiestHtml", { ...busy, ...plain, day: `${day}` }));
  }
  if (data.quiet != null) {
    if (data.quiet > 0) {
      const quiet = { count: count(data.quiet), n: n(data.quiet, lang) };
      const how = quietNamed ? ` ${tBusiness(lang, "gymRecap.common.seeWho")}` : "";
      also.push(noteLine(`${tBusiness(lang, "gymRecap.recap.also.driftingHtml", { ...quiet, ...strong })}${esc(how)}`));
      alsoText.push(`${tBusiness(lang, "gymRecap.recap.also.driftingHtml", { ...quiet, ...plain })}${how}`);
    } else {
      also.push(noteLine(tBusiness(lang, "gymRecap.recap.also.nobody")));
      alsoText.push(tBusiness(lang, "gymRecap.recap.also.nobody"));
    }
  }

  // ── Sections ────────────────────────────────────────────────────────
  const hero = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:40px 40px 34px;text-align:center;border-bottom:1px solid #111111;">
            <p style="margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#777777;font-family:${FONT};">${tBusiness(lang, "gymRecap.recap.eyebrowHtml", { week: esc(week) })}</p>
            <h1 class="hero-h1" style="margin:0 0 6px;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:${FONT};">${tBusiness(lang, "gymRecap.recap.headingHtml", { newline: "<br>", em: `<em style="font-style:italic;color:${GOLD};">`, gym: esc(gym), end: "</em>" })}</h1>
            <p style="margin:16px 0 0;font-size:14px;font-weight:300;color:#999999;line-height:1.7;font-family:${FONT};">${heroCopy}</p>
          </td>
        </tr>`;

  const tiles = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:28px 35px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
${statTile(n(data.sessions, lang), tBusiness(lang, "gymRecap.recap.tiles.sessions"), deltaChip(data.sessions, data.prevSessions, lang))}
${statTile(n(data.athletes, lang), tBusiness(lang, "gymRecap.recap.tiles.athletes"), deltaChip(data.athletes, data.prevAthletes, lang))}
${statTile(n(data.newFaces, lang), tBusiness(lang, "gymRecap.recap.tiles.newFaces"), `<span style="font-size:11px;font-weight:300;color:#777777;font-family:${FONT};">${tBusiness(lang, "gymRecap.recap.tiles.firstSession")}</span>`)}
              </tr>
            </table>
          </td>
        </tr>`;

  const topHtml = top.length
    ? `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 10px;border-bottom:1px solid #111111;">
            ${sectionLabel(tBusiness(lang, "gymRecap.recap.top.title"))}
            <p style="margin:6px 0 4px;font-size:12px;font-weight:300;color:#777777;font-family:${FONT};">${tBusiness(lang, "gymRecap.recap.top.sub")}</p>
            ${top.map((r, i) => topRow(i + 1, r, i === top.length - 1, lang)).join("")}
          </td>
        </tr>`
    : "";

  // ── Since we told your members ──────────────────────────────────────
  const nl = data.notice && data.notice.told > 0 ? noticeLines(data.notice, data.tz, gym, lang) : null;
  const noticeHtml = nl
    ? `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 24px;border-bottom:1px solid #111111;">
            ${sectionLabel(tBusiness(lang, "gymRecap.recap.notice.title"))}
            ${nl.big !== null ? `<p style="margin:14px 0 0;font-family:${FONT};"><span class="statnum" style="font-size:44px;font-weight:200;color:${GOLD};letter-spacing:-1px;line-height:1;font-family:${FONT};">${n(nl.big, lang)}</span><span style="font-size:15px;font-weight:300;color:#F2F2F2;font-family:${FONT};">&nbsp;&nbsp;${tBusiness(lang, "gymRecap.recap.notice.backLabel", { count: count(nl.big) })}</span></p>` : ""}
            <p style="margin:10px 0 0;font-size:14px;font-weight:300;color:#dddddd;line-height:1.6;font-family:${FONT};">${esc(nl.lead)}</p>
            ${nl.lines.map((l) => `<p style="margin:8px 0 0;font-size:12px;font-weight:300;color:#999999;line-height:1.5;font-family:${FONT};">&#8212;&nbsp;${esc(l)}</p>`).join("")}
            <p style="margin:16px 0 0;font-size:11px;font-weight:300;color:#666666;line-height:1.6;font-family:${FONT};">${tBusiness(lang, "gymRecap.recap.notice.footnote", { gym: esc(gym) })}</p>
          </td>
        </tr>`
    : "";

  const alsoHtml = also.length
    ? `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:26px 40px 18px;border-bottom:1px solid #161616;">
            ${sectionLabel(tBusiness(lang, "gymRecap.recap.also.title"), "#777777")}
            <div style="margin-top:10px;">${also.join("")}</div>
          </td>
        </tr>`
    : "";

  const eventsHtml = events.length
    ? `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 10px;border-bottom:1px solid #111111;">
            ${sectionLabel(tBusiness(lang, "gymRecap.recap.events.title"))}
            ${events.map((e, i) => eventRow(e, data.tz, portalUrl, i === events.length - 1, lang)).join("")}
          </td>
        </tr>`
    : "";

  const cta = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:34px 40px;text-align:center;border-bottom:1px solid #161616;">
            ${ctaButton(tBusiness(lang, "gymRecap.recap.cta.button"), portalUrl)}
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};">${tBusiness(lang, "gymRecap.recap.cta.sub")}</p>
          </td>
        </tr>
        <tr>
          <td class="sec" style="background-color:#080808;padding:22px 40px;text-align:center;border-bottom:1px solid #111111;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#666666;line-height:1.7;font-family:${FONT};">${tBusiness(lang, "gymRecap.recap.footerHtml", { gym: esc(gym), link: `<a href="${esc(`${portalUrl}/settings`)}" style="color:#8a8a8a;text-decoration:underline;">`, end: "</a>" })}</p>
          </td>
        </tr>`;

  const html = emailShell({
    title: tBusiness(lang, "gymRecap.recap.title", { gym: gymText }),
    preheader,
    rows: hero + tiles + noticeHtml + topHtml + alsoHtml + eventsHtml + cta,
    unsubscribe: false,
    lang,
  });

  // ── Plain text ──────────────────────────────────────────────────────
  const lines = [
    tBusiness(lang, "gymRecap.recap.text.heading", { gym: gymText, week: `${week}` }),
    "",
    quietWeek
      ? tBusiness(lang, "gymRecap.recap.leadQuiet", { gym: gymText })
      : tBusiness(lang, "gymRecap.recap.lead", { gym: gymText }),
    "",
    tBusiness(lang, "gymRecap.recap.text.sessions", { n: n(data.sessions, lang), prev: n(data.prevSessions, lang) }),
    tBusiness(lang, "gymRecap.recap.text.athletes", { n: n(data.athletes, lang), prev: n(data.prevAthletes, lang) }),
    tBusiness(lang, "gymRecap.recap.text.newFaces", { n: n(data.newFaces, lang) }),
  ];
  if (nl) {
    lines.push(
      "", tBusiness(lang, "gymRecap.recap.notice.title").toUpperCase(),
      ...(nl.big !== null ? [tBusiness(lang, "gymRecap.recap.notice.back", { count: count(nl.big), n: n(nl.big, lang) })] : []),
      nl.lead, ...nl.lines.map((l) => `- ${l}`),
    );
  }
  if (top.length) {
    lines.push("", tBusiness(lang, "gymRecap.recap.top.title").toUpperCase());
    top.forEach((r, i) => lines.push(tBusiness(lang, "gymRecap.recap.text.topRow", { rank: i + 1, name: `${r.name}`, points: n(r.points, lang), sessions: sessionsText(r.sessions, lang) })));
  }
  if (alsoText.length) lines.push("", ...alsoText);
  if (events.length) {
    lines.push("", tBusiness(lang, "gymRecap.recap.events.title").toUpperCase());
    events.forEach((e) => lines.push(tBusiness(lang, "gymRecap.recap.text.eventRow", { name: `${e.name}`, line: eventLine(e, data.tz, lang), url: `${portalUrl}/events/${e.id}` })));
  }
  lines.push(
    "", tBusiness(lang, "gymRecap.common.link", { label: tBusiness(lang, "gymRecap.recap.cta.button"), url: portalUrl }),
    "", tBusiness(lang, "gymRecap.recap.text.footer", { gym: gymText, url: `${portalUrl}/settings` }),
    "", "— POWR", "https://powr.life",
  );

  return { subject, html, text: lines.join("\n") };
}

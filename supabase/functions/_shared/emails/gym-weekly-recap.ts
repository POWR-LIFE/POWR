// The gym's Monday recap: what its members did at the gym last week, in the
// numbers and words the portal shows. send-gym-email sends it to everyone on
// the gym's team who keeps the switch on (Settings, then Email). The numbers
// come from get_gym_weekly_recaps(); this file is only the words.

import { ctaButton, emailShell, esc, FONT, GOLD, sectionLabel } from "./layout.ts";

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

export interface GymWeeklyRecapData {
  gymName: string;
  /** "15–21 Sep", see weekLabel(). */
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
  /** The day most sessions happened, or null when nothing was logged. */
  busiest: { day: string; sessions: number } | null;
  /** Members who have gone quiet; null when the package doesn't count them. */
  quiet: number | null;
  /** The package names them (Clash Pro): the line can point at Members. */
  quietNamed?: boolean;
  events: GymRecapEvent[];
  portalUrl?: string;
}

const n = (v: number) => Math.max(0, Math.round(v)).toLocaleString("en-GB");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

export function fmtDay(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz });
}

/** The last day of a window whose end is the midnight after it. */
export function lastDay(endIso: string, tz: string): string {
  return fmtDay(new Date(new Date(endIso).getTime() - 60_000).toISOString(), tz);
}

/** "15–21 Sep" or "29 Sep – 5 Oct": the week's first day and its last, in the gym's time. */
export function weekLabel(startIso: string, endIso: string, tz: string): string {
  const s = new Date(startIso);
  const e = new Date(new Date(endIso).getTime() - 60_000);
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", timeZone: tz });
  const mon = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", timeZone: tz });
  return mon(s) === mon(e) ? `${day(s)}–${day(e)} ${mon(e)}` : `${day(s)} ${mon(s)} – ${day(e)} ${mon(e)}`;
}

/** One line under an event's name. Plain text; the caller escapes. */
export function eventLine(e: GymRecapEvent, tz: string): string {
  const inLine = plural(e.participants, "person", "people") + " in";
  const powr = e.managed_by === "powr" ? "Run by POWR · " : "";
  if (e.status === "draft" && e.review_status === "pending") return `${powr}With POWR for a check`;
  if (e.status === "draft" && e.review_status === "rejected") return `${powr}POWR asked for a change: open it in the portal`;
  if (e.status === "scheduled") return `${powr}Starts ${fmtDay(e.window_start_at, tz)} · ${inLine}`;
  if (e.status === "live") return `${powr}Live · ${inLine} · last day ${lastDay(e.window_end_at, tz)}`;
  if (e.status === "locked") return `${powr}Board sealed · ${inLine} · reveal the winners from your phone`;
  if (e.status === "revealed") return `${powr}Winners revealed ${fmtDay(e.revealed_at, tz)} · hand over the prizes`;
  return `${powr}${inLine}`;
}

function deltaChip(curr: number, prev: number | null | undefined): string {
  if (prev == null) return "";
  const diff = curr - prev;
  if (diff === 0) return `<span style="font-size:11px;font-weight:600;color:#777777;font-family:${FONT};">&#8212; level with the week before</span>`;
  const up = diff > 0;
  return `<span style="font-size:11px;font-weight:700;color:${up ? GOLD : "#999999"};font-family:${FONT};">${up ? "&#9650;" : "&#9660;"}&nbsp;${n(Math.abs(diff))} vs the week before</span>`;
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

function topRow(rank: number, r: { name: string; points: number; sessions: number }, isLast: boolean): string {
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${isLast ? "" : ' style="border-bottom:1px solid #161616;"'}>
              <tr>
                <td style="padding:13px 0;width:30px;vertical-align:middle;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:600;color:${GOLD};font-family:${FONT};line-height:22px;">${rank}</span>
                </td>
                <td style="padding:13px 0 13px 12px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:500;color:#F2F2F2;font-family:${FONT};">${esc(r.name)}</p>
                  <p style="margin:2px 0 0;font-size:11px;font-weight:300;color:#888888;font-family:${FONT};">${plural(r.sessions, "session")}</p>
                </td>
                <td style="padding:13px 0;vertical-align:middle;text-align:right;white-space:nowrap;">
                  <span style="font-size:14px;font-weight:600;color:${GOLD};font-family:${FONT};">${n(r.points)}</span>
                  <span style="font-size:11px;font-weight:300;color:#666666;font-family:${FONT};">&nbsp;POWR</span>
                </td>
              </tr>
            </table>`;
}

function eventRow(e: GymRecapEvent, tz: string, portalUrl: string, isLast: boolean): string {
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${isLast ? "" : ' style="border-bottom:1px solid #161616;"'}>
              <tr>
                <td style="padding:13px 0;vertical-align:middle;">
                  <a href="${esc(`${portalUrl}/events/${e.id}`)}" style="text-decoration:none;">
                    <span style="display:block;font-size:14px;font-weight:500;color:#F2F2F2;font-family:${FONT};">${esc(e.name)}</span>
                    <span style="display:block;margin-top:2px;font-size:11px;font-weight:300;color:#888888;font-family:${FONT};">${esc(eventLine(e, tz))}</span>
                  </a>
                </td>
              </tr>
            </table>`;
}

function noteLine(text: string): string {
  return `<p style="margin:0 0 8px;font-size:13px;font-weight:300;color:#bbbbbb;line-height:1.6;font-family:${FONT};">${text}</p>`;
}

export function gymWeeklyRecapEmail(data: GymWeeklyRecapData): { subject: string; html: string; text: string } {
  const gym = data.gymName;
  const portalUrl = data.portalUrl ?? PORTAL_URL;
  const top = (data.top ?? []).slice(0, 3);
  const events = (data.events ?? []).slice(0, 5);
  const quietWeek = data.sessions === 0;
  const quietNamed = data.quietNamed === true;

  const subject = quietWeek
    ? `${gym} on POWR: last week`
    : `${gym} on POWR: ${plural(data.sessions, "session")} last week`;

  const preheader = quietWeek
    ? `${data.weekLabel}: nothing logged at ${gym}. The board on the TV and the poster by the door bring people back.`
    : `${data.weekLabel}: ${plural(data.athletes, "athlete")} trained here${data.newFaces > 0 ? `, ${data.newFaces} for the first time` : ""}.${top[0] ? ` ${top[0].name} topped the board.` : ""}`;

  const heroCopy = quietWeek
    ? `Nothing was logged at ${esc(gym)} last week. The board on the TV and the poster by the door are what get members checking in.`
    : `Here's what your members did at ${esc(gym)} last week.`;

  // ── Also this week: the busiest day, who has gone quiet ───────────────
  const also: string[] = [];
  const alsoText: string[] = [];
  if (data.busiest && data.busiest.sessions > 0) {
    also.push(noteLine(`Busiest day: <strong style="font-weight:600;color:#F2F2F2;">${esc(data.busiest.day)}</strong>, ${plural(data.busiest.sessions, "session")}.`));
    alsoText.push(`Busiest day: ${data.busiest.day}, ${plural(data.busiest.sessions, "session")}.`);
  }
  if (data.quiet != null) {
    if (data.quiet > 0) {
      const who = `${plural(data.quiet, "member")} ${data.quiet === 1 ? "has" : "have"} gone quiet`;
      const how = quietNamed ? " Reach out from Members." : "";
      also.push(noteLine(`<strong style="font-weight:600;color:#F2F2F2;">${who}</strong>: trained regularly, nothing in a fortnight.${esc(how)}`));
      alsoText.push(`${who}: trained regularly, nothing in a fortnight.${how}`);
    } else {
      also.push(noteLine(`Nobody has gone quiet.`));
      alsoText.push("Nobody has gone quiet.");
    }
  }

  // ── Sections ────────────────────────────────────────────────────────
  const hero = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:40px 40px 34px;text-align:center;border-bottom:1px solid #111111;">
            <p style="margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#777777;font-family:${FONT};">Your gym's week &middot; ${esc(data.weekLabel)}</p>
            <h1 class="hero-h1" style="margin:0 0 6px;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.15;color:#F2F2F2;font-family:${FONT};">Your week,<br><em style="font-style:italic;color:${GOLD};">${esc(gym)}.</em></h1>
            <p style="margin:16px 0 0;font-size:14px;font-weight:300;color:#999999;line-height:1.7;font-family:${FONT};">${heroCopy}</p>
          </td>
        </tr>`;

  const tiles = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:28px 35px;border-bottom:1px solid #161616;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
${statTile(n(data.sessions), "Sessions", deltaChip(data.sessions, data.prevSessions))}
${statTile(n(data.athletes), "Athletes", deltaChip(data.athletes, data.prevAthletes))}
${statTile(n(data.newFaces), "New faces", `<span style="font-size:11px;font-weight:300;color:#777777;font-family:${FONT};">first session here</span>`)}
              </tr>
            </table>
          </td>
        </tr>`;

  const topHtml = top.length
    ? `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 10px;border-bottom:1px solid #111111;">
            ${sectionLabel("Top of the board")}
            <p style="margin:6px 0 4px;font-size:12px;font-weight:300;color:#777777;font-family:${FONT};">As your screen showed it, Monday to Sunday.</p>
            ${top.map((r, i) => topRow(i + 1, r, i === top.length - 1)).join("")}
          </td>
        </tr>`
    : "";

  const alsoHtml = also.length
    ? `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:26px 40px 18px;border-bottom:1px solid #161616;">
            ${sectionLabel("Also last week", "#777777")}
            <div style="margin-top:10px;">${also.join("")}</div>
          </td>
        </tr>`
    : "";

  const eventsHtml = events.length
    ? `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 10px;border-bottom:1px solid #111111;">
            ${sectionLabel("Your events")}
            ${events.map((e, i) => eventRow(e, data.tz, portalUrl, i === events.length - 1)).join("")}
          </td>
        </tr>`
    : "";

  const cta = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:34px 40px;text-align:center;border-bottom:1px solid #161616;">
            ${ctaButton("Open your portal", portalUrl)}
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};">Members, events, the Studio and your screens, all in the portal.</p>
          </td>
        </tr>
        <tr>
          <td class="sec" style="background-color:#080808;padding:22px 40px;text-align:center;border-bottom:1px solid #111111;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#666666;line-height:1.7;font-family:${FONT};">You get this every Monday because you're on the team at ${esc(gym)} on POWR. Turn it off under <a href="${esc(`${portalUrl}/settings`)}" style="color:#8a8a8a;text-decoration:underline;">Settings</a> in the portal.</p>
          </td>
        </tr>`;

  const html = emailShell({
    title: `Your week at ${gym}`,
    preheader,
    rows: hero + tiles + topHtml + alsoHtml + eventsHtml + cta,
    unsubscribe: false,
  });

  // ── Plain text ──────────────────────────────────────────────────────
  const lines = [
    `Your week, ${gym} — ${data.weekLabel}`,
    "",
    quietWeek
      ? `Nothing was logged at ${gym} last week. The board on the TV and the poster by the door are what get members checking in.`
      : `Here's what your members did at ${gym} last week.`,
    "",
    `Sessions: ${n(data.sessions)} (the week before: ${n(data.prevSessions)})`,
    `Athletes: ${n(data.athletes)} (the week before: ${n(data.prevAthletes)})`,
    `New faces: ${n(data.newFaces)}`,
  ];
  if (top.length) {
    lines.push("", "TOP OF THE BOARD");
    top.forEach((r, i) => lines.push(`${i + 1}. ${r.name} — ${n(r.points)} POWR, ${plural(r.sessions, "session")}`));
  }
  if (alsoText.length) lines.push("", ...alsoText);
  if (events.length) {
    lines.push("", "YOUR EVENTS");
    events.forEach((e) => lines.push(`- ${e.name}: ${eventLine(e, data.tz)} — ${portalUrl}/events/${e.id}`));
  }
  lines.push("", `Open your portal: ${portalUrl}`, "", `You get this every Monday because you're on the team at ${gym} on POWR. Turn it off under Settings in the portal: ${portalUrl}/settings`, "", "— POWR", "https://powr.life");

  return { subject, html, text: lines.join("\n") };
}

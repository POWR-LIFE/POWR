// The morning email to a gym's team when someone new starts drifting: gone
// well past their own usual gap between visits (Retention, migration
// 20261007120000). Sent by send-gym-email (kind drift_digest) from the daily
// cron, only on days with someone new, only to staff who keep the switch on
// (portal Settings, then Email). Clash Pro names them; Clash+ gets the count.
// Facts come from get_gym_drift_digests(); the words from ../retentionCopy.ts,
// the same as the portal's. In French and Spanish the email words
// retentionCopy's *Parts the way the portal does (venueMembers retention),
// from tBusiness "gymRecap.drift.*" / "gymRecap.retention.*"; English goes
// through retentionCopy itself, byte for byte as before.

import { formatLocale, tBusiness } from "../i18n/index.ts";
import { ctaButton, emailShell, esc, FONT, GOLD, sectionLabel } from "./layout.ts";
import { fmtCount as n } from "./gym-mail-parts.ts";
import { PORTAL_URL } from "./gym-weekly-recap.ts";
import { driftHeadline, type Pattern, patternLine, patternParts, quietLabel, quietParts } from "../retentionCopy.ts";

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
/** The number a plural form agrees with: the one shown. */
const count = (v: number) => Math.max(0, Math.round(v));

/** quietLabel(): "12 days quiet", "5 weeks quiet". */
function quietText(gapDays: number | null | undefined, lang: string): string {
  if (lang === "en") return quietLabel(gapDays);
  const q = quietParts(gapDays);
  return q.id === "weeks"
    ? tBusiness(lang, "gymRecap.retention.quiet.weeks", { count: q.n })
    : tBusiness(lang, "gymRecap.retention.quiet.days", { count: q.n });
}

function dayPartText(part: string, lang: string): string {
  switch (part) {
    case "morning": return tBusiness(lang, "gymRecap.retention.dayParts.morning");
    case "midday": return tBusiness(lang, "gymRecap.retention.dayParts.midday");
    case "afternoon": return tBusiness(lang, "gymRecap.retention.dayParts.afternoon");
    default: return tBusiness(lang, "gymRecap.retention.dayParts.evening");
  }
}

/** dowList(): "Mon, Wed & Fri", with the language's short weekday names. */
function dowText(dows: number[], lang: string): string {
  const fmt = new Intl.DateTimeFormat(formatLocale(lang), { weekday: "short", timeZone: "UTC" });
  const names = dows.map((d) => fmt.format(Date.UTC(2026, 0, 4 + d)));
  if (names.length <= 1) return names.join("");
  return tBusiness(lang, "gymRecap.retention.pattern.lastDay", { rest: names.slice(0, -1).join(", "), last: names[names.length - 1] });
}

/** patternLine(): "Usually 3× a week, mornings · Mon, Wed & Fri"; empty with no pattern yet. */
function patternText(p: Pattern, lang: string): string {
  if (lang === "en") return patternLine(p);
  const parts = patternParts(p);
  if (!parts) return "";
  const f = parts.frequency;
  const frequency = f.id === "most_days" ? tBusiness(lang, "gymRecap.retention.frequency.mostDays")
    : f.id === "per_week" ? tBusiness(lang, "gymRecap.retention.frequency.perWeek", { n: f.n })
    : f.id === "weekly" ? tBusiness(lang, "gymRecap.retention.frequency.weekly")
    : tBusiness(lang, "gymRecap.retention.frequency.fortnightly");
  const head = parts.part
    ? tBusiness(lang, "gymRecap.retention.pattern.withPart", { frequency, part: dayPartText(parts.part, lang) })
    : tBusiness(lang, "gymRecap.retention.pattern.base", { frequency });
  const days = dowText(parts.dows, lang);
  return days ? `${head} · ${days}` : head;
}

/** driftHeadline(): "Callum R. is drifting", "3 people are drifting". */
function headlineText(newCount: number, first: string | null | undefined, lang: string): string {
  if (lang === "en") return driftHeadline(newCount, first);
  if (newCount === 1 && first) return tBusiness(lang, "gymRecap.drift.headlineNamed", { name: first });
  return tBusiness(lang, "gymRecap.drift.headline", { count: count(newCount), n: n(newCount, lang) });
}

function personRow(p: GymDriftPerson, isLast: boolean, lang: string): string {
  const pattern = patternText(p, lang);
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${isLast ? "" : ' style="border-bottom:1px solid #161616;"'}>
              <tr>
                <td style="padding:13px 0;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:500;color:#F2F2F2;font-family:${FONT};">${esc(p.name)}</p>
                  ${pattern ? `<p style="margin:3px 0 0;font-size:12px;font-weight:300;color:#888888;font-family:${FONT};">${esc(pattern)}</p>` : ""}
                </td>
                <td style="padding:13px 0 13px 12px;vertical-align:middle;text-align:right;white-space:nowrap;">
                  <span style="display:inline-block;padding:5px 10px;border:1px solid #5c3d12;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#F5A524;font-family:${FONT};">${esc(quietText(p.gap_days, lang))}</span>
                </td>
              </tr>
            </table>`;
}

export function gymDriftDigestEmail(data: GymDriftDigestData, lang = "en"): { subject: string; html: string; text: string } {
  const gym = data.gymName;
  // Interpolated as the template literals before did: a missing name stays "null".
  const gymText = `${gym}`;
  const portalUrl = data.portalUrl ?? PORTAL_URL;
  const retentionUrl = `${portalUrl}/retention`;
  const people = data.named ? data.people.slice(0, SHOW) : [];
  const more = data.named ? Math.max(0, data.newCount - people.length) : 0;
  const first = data.named && data.newCount === 1 ? data.people[0]?.name : null;
  const retention = tBusiness(lang, "gymRecap.common.retention");
  const em = { em: `<em style="font-style:italic;color:${GOLD};">`, end: "</em>" };

  const headline = headlineText(data.newCount, first, lang);
  const subject = tBusiness(lang, "gymRecap.drift.subject", { headline, gym: gymText });
  const headlineHtml = first
    ? tBusiness(lang, "gymRecap.drift.titleNamedHtml", { name: esc(first), ...em })
    : tBusiness(lang, "gymRecap.drift.titleHtml", { count: count(data.newCount), n: n(data.newCount, lang), br: '<br class="br-d">', ...em });
  const body = tBusiness(lang, "gymRecap.drift.body", { count: count(data.newCount) });
  const preheader = data.named && people[0]
    ? tBusiness(lang, "gymRecap.drift.preheaderNamed", {
      name: `${people[0].name}`,
      quiet: quietText(people[0].gap_days, lang),
      rest: patternText(people[0], lang) || tBusiness(lang, "gymRecap.common.seeWho"),
    })
    : tBusiness(lang, "gymRecap.drift.preheader", { count: count(data.newCount) });
  const totals = tBusiness(lang, "gymRecap.drift.totals", {
    gym: gymText,
    drifting: tBusiness(lang, "gymRecap.drift.drifting", { count: count(data.drifting), n: n(data.drifting, lang) }),
    slipping: tBusiness(lang, "gymRecap.drift.slipping", { count: count(data.slipping), n: n(data.slipping, lang) }),
  });
  const ctaLabel = data.named ? tBusiness(lang, "gymRecap.drift.ctaNamed") : tBusiness(lang, "gymRecap.drift.ctaOpen");
  const moreText = tBusiness(lang, "gymRecap.drift.more", { count: count(more), n: n(more, lang) });

  const hero = `
        <tr>
          <td class="sec" style="background-color:#080808;padding:40px 40px 34px;text-align:center;border-bottom:1px solid #111111;">
            <p style="margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#777777;font-family:${FONT};">${esc(gym)} &middot; ${retention}</p>
            <h1 class="hero-h1" style="margin:0;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.18;color:#F2F2F2;font-family:${FONT};">${headlineHtml}</h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#999999;line-height:1.7;font-family:${FONT};">${esc(body)}</p>
          </td>
        </tr>`;

  const list = data.named
    ? `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 10px;border-bottom:1px solid #111111;">
            ${sectionLabel(tBusiness(lang, "gymRecap.drift.newly"))}
            ${people.map((p, i) => personRow(p, i === people.length - 1 && more === 0, lang)).join("")}
            ${more > 0 ? `<p style="margin:12px 0 4px;font-size:12px;font-weight:300;color:#777777;font-family:${FONT};">${moreText}</p>` : ""}
          </td>
        </tr>`
    : `
        <tr>
          <td class="sec" style="background-color:#080808;padding:26px 40px 24px;border-bottom:1px solid #111111;">
            ${sectionLabel(tBusiness(lang, "gymRecap.drift.whoTitle"))}
            <p style="margin:8px 0 0;font-size:13px;font-weight:300;color:#bbbbbb;line-height:1.6;font-family:${FONT};">${tBusiness(lang, "gymRecap.drift.whoBody")}</p>
          </td>
        </tr>`;

  const cta = `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:34px 40px;text-align:center;border-bottom:1px solid #161616;">
            ${ctaButton(ctaLabel, retentionUrl)}
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};">${esc(totals)}</p>
          </td>
        </tr>
        <tr>
          <td class="sec" style="background-color:#080808;padding:22px 40px;text-align:center;border-bottom:1px solid #111111;">
            <p style="margin:0;font-size:11px;font-weight:300;color:#666666;line-height:1.7;font-family:${FONT};">${tBusiness(lang, "gymRecap.drift.footerHtml", { gym: esc(gym), link: `<a href="${esc(`${portalUrl}/settings`)}" style="color:#8a8a8a;text-decoration:underline;">`, end: "</a>" })}</p>
          </td>
        </tr>`;

  const html = emailShell({ title: `${headline} · ${gym}`, preheader, rows: hero + list + cta, unsubscribe: false, lang });

  const lines = [`${gym} · ${retention}`, "", `${headline}.`, "", body];
  if (data.named) {
    lines.push("", tBusiness(lang, "gymRecap.drift.newly").toUpperCase());
    people.forEach((p) => {
      const pattern = patternText(p, lang);
      const row = { name: `${p.name}`, quiet: quietText(p.gap_days, lang) };
      lines.push(pattern ? tBusiness(lang, "gymRecap.drift.textRowPattern", { ...row, pattern }) : tBusiness(lang, "gymRecap.drift.textRow", row));
    });
    if (more > 0) lines.push(moreText);
  } else {
    lines.push("", tBusiness(lang, "gymRecap.drift.whoBody"));
  }
  lines.push(
    "", totals,
    "", tBusiness(lang, "gymRecap.common.link", { label: ctaLabel, url: retentionUrl }),
    "", tBusiness(lang, "gymRecap.drift.textFooter", { gym: gymText, url: `${portalUrl}/settings` }),
    "", "— POWR", "https://powr.life",
  );

  return { subject, html, text: lines.join("\n") };
}

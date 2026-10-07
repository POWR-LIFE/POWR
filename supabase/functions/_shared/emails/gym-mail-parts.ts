// The rows the gym's team emails are built from (welcome, reminders, trial,
// package, support, Clash Nights). Same look as gym-event-mail.ts: a centred
// hero, then sections, then one gold button. Every helper escapes what it
// is given unless the parameter says Html.

import { ctaButton, esc, FONT, GOLD, sectionLabel } from "./layout.ts";

/** Gold italic accent for a heading word. */
export const gold = (text: string) => `<em style="font-style:italic;color:${GOLD};">${esc(text)}</em>`;

/** Plain text with its line breaks kept, escaped for HTML. */
export const multiline = (text: string) => esc(text).replace(/\r?\n/g, "<br>");

export function heroRow(eyebrow: string, headingHtml: string, body: string): string {
  return `
        <tr>
          <td class="sec" style="background-color:#080808;padding:40px 40px 34px;text-align:center;border-bottom:1px solid #111111;">
            <p style="margin:0 0 10px;font-size:11px;font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:#777777;font-family:${FONT};">${esc(eyebrow)}</p>
            <h1 class="hero-h1" style="margin:0;font-size:38px;font-weight:200;letter-spacing:0.5px;line-height:1.18;color:#F2F2F2;font-family:${FONT};">${headingHtml}</h1>
            <p style="margin:18px 0 0;font-size:15px;font-weight:300;color:#999999;line-height:1.7;font-family:${FONT};">${esc(body)}</p>
          </td>
        </tr>`;
}

export function ctaRow(label: string, href: string, small: string): string {
  return `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:34px 40px;text-align:center;border-bottom:1px solid #161616;">
            ${ctaButton(label, href)}
            <p style="margin:18px 0 0;font-size:12px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};">${esc(small)}</p>
          </td>
        </tr>`;
}

/** A quoted block (POWR's note, the gym's own question), line breaks kept. */
export function quoteSection(label: string, text: string, sub?: string): string {
  return `
        <tr>
          <td class="sec" style="background-color:#080808;padding:26px 40px 28px;border-bottom:1px solid #111111;">
            ${sectionLabel(esc(label))}
            ${sub ? `<p style="margin:6px 0 0;font-size:12px;font-weight:300;color:#777777;font-family:${FONT};">${esc(sub)}</p>` : ""}
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px;background-color:#111111;border-left:2px solid ${GOLD};border-radius:0 12px 12px 0;">
              <tr><td style="padding:14px 18px;font-size:14px;font-weight:300;color:#dddddd;line-height:1.6;font-family:${FONT};">${multiline(text)}</td></tr>
            </table>
          </td>
        </tr>`;
}

export interface Item {
  title: string;
  line: string;
  /** Optional link on the title. */
  href?: string;
}

function itemRow(marker: string, item: Item, isLast: boolean): string {
  const title = `<span style="display:block;font-size:14px;font-weight:500;color:#F2F2F2;font-family:${FONT};">${esc(item.title)}</span>`;
  return `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"${isLast ? "" : ' style="border-bottom:1px solid #161616;"'}>
              <tr>
                <td style="padding:13px 0;width:30px;vertical-align:top;">
                  <span style="display:inline-block;width:22px;height:22px;background-color:#111111;border:1px solid #222222;border-radius:50%;text-align:center;font-size:11px;font-weight:600;color:${GOLD};font-family:${FONT};line-height:22px;">${marker}</span>
                </td>
                <td style="padding:13px 0 13px 12px;vertical-align:top;">
                  ${item.href ? `<a href="${esc(item.href)}" style="text-decoration:none;">${title}</a>` : title}
                  <span style="display:block;margin-top:3px;font-size:12px;font-weight:300;color:#999999;line-height:1.55;font-family:${FONT};">${esc(item.line)}</span>
                </td>
              </tr>
            </table>`;
}

/**
 * A titled list. `marker` numbers the rows ("steps"), ticks them ("on"), or
 * crosses them ("off": what switches off).
 */
export function listSection(label: string, items: Item[], marker: "steps" | "on" | "off", sub?: string): string {
  if (items.length === 0) return "";
  const mark = (i: number) => marker === "steps" ? String(i + 1) : marker === "on" ? "&#10003;" : "&#8211;";
  return `
        <tr>
          <td class="sec" style="background-color:#080808;padding:28px 40px 10px;border-bottom:1px solid #111111;">
            ${sectionLabel(esc(label))}
            ${sub ? `<p style="margin:6px 0 4px;font-size:12px;font-weight:300;color:#777777;line-height:1.6;font-family:${FONT};">${esc(sub)}</p>` : ""}
            ${items.map((it, i) => itemRow(mark(i), it, i === items.length - 1)).join("")}
          </td>
        </tr>`;
}

/** A short grey paragraph on its own row (what carries on, a reassurance). */
export function noteRow(label: string, text: string): string {
  return `
        <tr>
          <td class="sec" style="background-color:#0a0a0a;padding:24px 40px 22px;border-bottom:1px solid #161616;">
            ${sectionLabel(esc(label), "#777777")}
            <p style="margin:10px 0 0;font-size:13px;font-weight:300;color:#bbbbbb;line-height:1.65;font-family:${FONT};">${esc(text)}</p>
          </td>
        </tr>`;
}

/** Plain-text twin of listSection. */
export function listText(label: string, items: Item[], marker: "steps" | "on" | "off"): string[] {
  if (items.length === 0) return [];
  return [
    "",
    label.toUpperCase(),
    ...items.map((it, i) => `${marker === "steps" ? `${i + 1}.` : marker === "on" ? "+" : "-"} ${it.title}: ${it.line}${it.href ? ` (${it.href})` : ""}`),
  ];
}

export const TEXT_SIGNOFF = ["", "— POWR", "https://powr.life"];

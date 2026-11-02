// Admin-authored email templates (the admin panel's Email page): merge tags,
// script stripping and the final render. Pure functions, no Deno APIs, so Jest
// covers them and the edge function stays thin.
//
// A template is HTML the team writes by hand. It may be a fragment (then the
// shared POWR shell wraps it: logo header, footer with the Mailgun unsubscribe
// link) or a complete document sent exactly as written. Either way scripts are
// removed: no mail client runs them, and a <script> in the body only hurts
// deliverability.

import { emailShell, FONT } from "./layout.ts";

export interface MergeTag {
  tag: string;
  label: string;
  hint: string;
  sample: string;
}

/** The tags the editor offers. Written in the template as {{tag}}. */
export const MERGE_TAGS: readonly MergeTag[] = [
  { tag: "first_name", label: "First name", hint: "From their display name; 'there' when unknown", sample: "Jamie" },
  { tag: "name", label: "Full name", hint: "Their display name", sample: "Jamie Wright" },
  { tag: "username", label: "Username", hint: "Without the @", sample: "jamie" },
  { tag: "email", label: "Email", hint: "The address this is sent to", sample: "jamie@powr.life" },
  { tag: "referral_code", label: "POWR ID", hint: "Their referral code", sample: "JAMIE8" },
  { tag: "balance", label: "POWR balance", hint: "Points they can spend right now", sample: "1,240" },
];

export type MergeVars = Record<(typeof MERGE_TAGS)[number]["tag"], string>;

export interface RecipientRow {
  email: string;
  display_name?: string | null;
  username?: string | null;
  referral_code?: string | null;
  balance?: number | null;
}

/** Merge values for one recipient. Plain strings: applyMerge escapes them for HTML. */
export function mergeVarsFor(row: RecipientRow): MergeVars {
  const name = (row.display_name ?? "").trim();
  return {
    first_name: name.split(/\s+/)[0] || "there",
    name: name || "there",
    username: (row.username ?? "").trim(),
    email: row.email,
    referral_code: (row.referral_code ?? "").trim(),
    balance: Number(row.balance ?? 0).toLocaleString("en-GB"),
  };
}

/** The sample recipient the preview falls back to when the admin has no profile row. */
export const SAMPLE_VARS: MergeVars = Object.fromEntries(
  MERGE_TAGS.map((t) => [t.tag, t.sample]),
) as MergeVars;

const TAG_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;
const KNOWN = new Set(MERGE_TAGS.map((t) => t.tag));

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Every {{tag}} used in `source`, in order of first appearance. */
export function listMergeTags(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(TAG_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Tags in `source` the editor does not know. Left untouched by applyMerge so the preview shows the slip. */
export function unknownMergeTags(source: string): string[] {
  return listMergeTags(source).filter((t) => !KNOWN.has(t));
}

/** Replace known {{tags}} with the recipient's values. HTML mode escapes them. */
export function applyMerge(source: string, vars: MergeVars, mode: "html" | "text"): string {
  return source.replace(TAG_RE, (whole, tag: string) => {
    if (!KNOWN.has(tag)) return whole;
    const value = vars[tag as keyof MergeVars] ?? "";
    return mode === "html" ? escapeHtml(value) : value;
  });
}

/**
 * Remove every <script> element. No regular expression touches the markup:
 * a scanner finds each "<script" opener (a real tag start is followed by
 * whitespace, ">" or "/") and its "</script" closer, which browsers accept
 * with anything before the ">" ("</script foo>", "</script\t\n>"). Runs
 * until nothing changes, so a block hidden inside another one's removal
 * ("<scr<script></script>ipt>") cannot survive a single pass. An opener with
 * no closer is dropped to the end of the document.
 */
export function stripScripts(html: string): string {
  let out = html;
  for (let i = 0; i < 20; i++) {
    const next = stripScriptsOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

const SCRIPT_OPEN = "<script";
const SCRIPT_CLOSE = "</script";

function stripScriptsOnce(html: string): string {
  let out = "";
  let pos = 0;
  while (pos < html.length) {
    const open = indexOfTag(html, SCRIPT_OPEN, pos);
    if (open === -1) {
      out += html.slice(pos);
      break;
    }
    out += html.slice(pos, open);
    const close = indexOfTag(html, SCRIPT_CLOSE, open + SCRIPT_OPEN.length);
    if (close === -1) return out;
    const gt = html.indexOf(">", close + SCRIPT_CLOSE.length);
    if (gt === -1) return out;
    pos = gt + 1;
  }
  return out;
}

/** Index of `tag` ("<script" / "</script", lower case) at or after `from`, ignoring case; -1 when absent. */
function indexOfTag(html: string, tag: string, from: number): number {
  let at = html.indexOf("<", from);
  while (at !== -1) {
    if (html.slice(at, at + tag.length).toLowerCase() === tag && endsTagName(html[at + tag.length])) return at;
    at = html.indexOf("<", at + 1);
  }
  return -1;
}

/** The character after "<script" that makes it a tag rather than a longer word ("<scripts>"). */
function endsTagName(ch: string | undefined): boolean {
  return ch === undefined || ch === ">" || ch === "/" || ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

export interface AdminTemplate {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  use_shell: boolean;
}

export interface RenderedAdminEmail {
  subject: string;
  html: string;
  text: string;
}

/** The body cell the shell gives a fragment: dark card, light readable text, POWR font. */
function shellRow(body: string): string {
  return `
        <tr>
          <td class="sec" bgcolor="#080808" style="background-color:#080808;padding:36px 40px 40px;color:#F2F2F2;font-size:15px;line-height:1.7;font-family:${FONT};">
${body}
          </td>
        </tr>`;
}

/**
 * Render one recipient's copy. Subject and preheader are merged as text (the
 * shell escapes the preheader itself); the HTML is merged with escaping, then
 * stripped of scripts. `lang` only picks the shell footer's language.
 */
export function renderAdminEmail(template: AdminTemplate, vars: MergeVars, lang = "en"): RenderedAdminEmail {
  const subject = applyMerge(template.subject, vars, "text");
  const preheader = applyMerge(template.preheader, vars, "text");
  const body = stripScripts(applyMerge(template.html, vars, "html"));
  const html = template.use_shell
    ? emailShell({ title: subject, preheader, rows: shellRow(body), lang })
    : body;
  const text = applyMerge(template.text, vars, "text");
  return { subject, html, text };
}

// ── Size: Gmail clipping and base64 images ───────────────────────────────────

/** Gmail shows "[Message clipped]" and hides the rest above this much HTML. */
export const GMAIL_CLIP_BYTES = 102 * 1024;

export interface EmbeddedImage {
  /** The whole data: URI as it appears in the HTML (what to replace). */
  uri: string;
  mime: string;
  base64: string;
  /** Decoded size. */
  bytes: number;
}

const DATA_IMAGE_RE = /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi;

/**
 * Base64 images embedded in the HTML (img src or a CSS url()), unique by
 * content. Design exports embed images this way; Gmail refuses to show them
 * and the HTML balloons past the clip limit, so the Email page offers to
 * upload them to storage and link them instead.
 */
export function findEmbeddedImages(html: string): EmbeddedImage[] {
  const seen = new Map<string, EmbeddedImage>();
  for (const m of html.matchAll(DATA_IMAGE_RE)) {
    if (seen.has(m[0])) continue;
    const base64 = m[2];
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    seen.set(m[0], {
      uri: m[0],
      mime: m[1].toLowerCase(),
      base64,
      bytes: Math.floor((base64.length * 3) / 4) - padding,
    });
  }
  return [...seen.values()];
}

export function byteLength(value: string): number {
  return typeof TextEncoder === "undefined" ? value.length : new TextEncoder().encode(value).length;
}

export function formatKB(bytes: number): string {
  return `${Math.round(bytes / 1024).toLocaleString("en-GB")} KB`;
}

/** Warnings about weight: embedded images (Gmail hides them) and the clip limit. */
export function sizeWarnings(templateHtml: string, renderedHtml: string): string[] {
  const out: string[] = [];
  const embedded = findEmbeddedImages(templateHtml);
  if (embedded.length) {
    const total = embedded.reduce((n, img) => n + img.bytes, 0);
    out.push(`${embedded.length} image${embedded.length === 1 ? "" : "s"} embedded as base64 (${formatKB(total)}) — Gmail hides base64 images; upload them to storage instead`);
  }
  const size = byteLength(renderedHtml);
  if (size > GMAIL_CLIP_BYTES) {
    out.push(`The email renders to ${formatKB(size)} — Gmail clips messages over ${formatKB(GMAIL_CLIP_BYTES)}, hiding the end (and the unsubscribe link)`);
  }
  return out;
}

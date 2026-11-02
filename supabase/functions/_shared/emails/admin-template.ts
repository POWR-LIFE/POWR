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

// ── Gmail dark mode: keep image-only blocks as designed ──────────────────────
//
// Gmail on iPhone recolours every email in dark mode (full lightness inversion)
// and ignores the color-scheme tags, so a dark design turns light and a white
// logo ends up on a light band. It leaves an element alone when the element has
// a background IMAGE, so a block painted with a same-colour gradient keeps its
// colour. Locking is only safe where nothing readable sits inside the block:
// Gmail still flips text colours, and light text on a locked dark block would
// turn dark on dark. So only blocks that hold an image and no text are locked
// (logo bands, hero art). Everything else is left for Gmail to recolour, which
// reads fine. Other clients see no change because the gradient is the colour
// the block already had.
//
// This is a scanner, not a regular expression over tags: it tokenises the
// markup, tracks open elements, and gives up (returns the input untouched) the
// moment the markup is not well formed.

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);
/** Elements whose content we cannot judge: treat them as readable content. */
const OPAQUE_TAGS = new Set([
  "svg", "picture", "video", "audio", "canvas", "object", "iframe", "button", "select", "input", "textarea", "label",
]);
const LOCKABLE_TAGS = new Set(["td", "th", "table", "div"]);

interface Tok {
  kind: "text" | "comment" | "decl" | "raw" | "start" | "end";
  raw: string;
  name: string;
  selfClose: boolean;
}

interface Attr {
  name: string;
  value: string;
  /** Value range inside the tag's raw text, quotes excluded. */
  vStart: number;
  vEnd: number;
}

const isSpace = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const isAsciiLetter = (c: string | undefined) => c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
const isTagNameChar = (c: string | undefined) =>
  c !== undefined && (isAsciiLetter(c) || (c >= "0" && c <= "9") || c === "-" || c === ":" || c === "_");

/** Index of the ">" that ends the tag starting before `from`, skipping quoted attribute values; -1 if none. */
function findTagEnd(html: string, from: number): number {
  let quote = "";
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

/** Split markup into tokens whose raw text concatenates back to the input; null if it is malformed. */
function tokenizeHtml(html: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      toks.push({ kind: "text", raw: html.slice(i), name: "", selfClose: false });
      break;
    }
    if (lt > i) toks.push({ kind: "text", raw: html.slice(i, lt), name: "", selfClose: false });
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) return null;
      toks.push({ kind: "comment", raw: html.slice(lt, end + 3), name: "", selfClose: false });
      i = end + 3;
      continue;
    }
    const second = html[lt + 1];
    if (second === "!" || second === "?") {
      const end = html.indexOf(">", lt);
      if (end === -1) return null;
      toks.push({ kind: "decl", raw: html.slice(lt, end + 1), name: "", selfClose: false });
      i = end + 1;
      continue;
    }
    const closing = second === "/";
    const nameStart = lt + (closing ? 2 : 1);
    if (!isAsciiLetter(html[nameStart])) {
      toks.push({ kind: "text", raw: "<", name: "", selfClose: false });
      i = lt + 1;
      continue;
    }
    let nameEnd = nameStart;
    while (nameEnd < html.length && isTagNameChar(html[nameEnd])) nameEnd++;
    const end = findTagEnd(html, nameEnd);
    if (end === -1) return null;
    const name = html.slice(nameStart, nameEnd).toLowerCase();
    const selfClose = !closing && html[end - 1] === "/";
    toks.push({ kind: closing ? "end" : "start", raw: html.slice(lt, end + 1), name, selfClose });
    i = end + 1;
    if (!closing && !selfClose && RAW_TEXT_TAGS.has(name)) {
      const close = indexOfTag(html, `</${name}`, i);
      if (close === -1) return null;
      toks.push({ kind: "raw", raw: html.slice(i, close), name: "", selfClose: false });
      i = close;
    }
  }
  return toks;
}

/** Attributes of a start tag, with where each value sits inside the raw text. */
function parseAttrs(raw: string): { attrs: Attr[]; nameEnd: number } {
  let i = 1;
  while (i < raw.length && isTagNameChar(raw[i])) i++;
  const nameEnd = i;
  const attrs: Attr[] = [];
  while (i < raw.length) {
    while (i < raw.length && (isSpace(raw[i]) || raw[i] === "/")) i++;
    if (i >= raw.length || raw[i] === ">") break;
    const nameStart = i;
    while (i < raw.length && !isSpace(raw[i]) && raw[i] !== "=" && raw[i] !== ">" && raw[i] !== "/") i++;
    const name = raw.slice(nameStart, i).toLowerCase();
    while (i < raw.length && isSpace(raw[i])) i++;
    if (raw[i] !== "=") {
      attrs.push({ name, value: "", vStart: i, vEnd: i });
      continue;
    }
    i++;
    while (i < raw.length && isSpace(raw[i])) i++;
    const quote = raw[i];
    let vStart: number;
    let vEnd: number;
    if (quote === '"' || quote === "'") {
      vStart = i + 1;
      vEnd = raw.indexOf(quote, vStart);
      if (vEnd === -1) vEnd = raw.length - 1;
      i = vEnd + 1;
    } else {
      vStart = i;
      while (i < raw.length && !isSpace(raw[i]) && raw[i] !== ">") i++;
      vEnd = i;
    }
    attrs.push({ name, value: raw.slice(vStart, vEnd), vStart, vEnd });
  }
  return { attrs, nameEnd };
}

/** A hex or rgb() colour exactly as written, or null for anything else (names, hsl, alpha, gradients). */
function solidColour(value: string): string | null {
  const v = value.replace(/\s*!important\s*$/i, "").trim();
  const ok = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)
    || /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(v);
  return ok ? v : null;
}

/**
 * The solid background an element declares (style beats the bgcolor attribute),
 * or null when it declares none, is unsure, or already paints an image.
 */
function declaredBackground(attrs: Attr[]): string | null {
  const find = (n: string) => attrs.find((a) => a.name === n);
  if (find("background")) return null;
  const style = find("style")?.value ?? "";
  const lower = style.toLowerCase();
  if (lower.includes("url(") || lower.includes("gradient(") || lower.includes("background-image")) return null;
  let sawBackground = false;
  let colour: string | null = null;
  for (const decl of style.split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    if (prop === "background-color" || prop === "background") {
      sawBackground = true;
      colour = solidColour(decl.slice(colon + 1));
    }
  }
  if (sawBackground) return colour;
  return solidColour(find("bgcolor")?.value ?? "");
}

/** Tracking pixels and spacer gifs do not make a block "an image block". */
function countsAsImage(attrs: Attr[]): boolean {
  const find = (n: string) => attrs.find((a) => a.name === n);
  const tiny = (v: string | undefined) => {
    if (!v) return false;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) && n <= 2;
  };
  if (tiny(find("width")?.value) || tiny(find("height")?.value)) return false;
  const style = (find("style")?.value ?? "").toLowerCase();
  return !/(?:^|;)\s*(?:width|height)\s*:\s*[0-2](?:px)?\s*(?:;|$)/.test(style);
}

/** Add the same-colour gradient to a start tag's style. Returns the tag unchanged if its style is malformed. */
function addGradientLock(raw: string, colour: string): string {
  const lock = `background-image:linear-gradient(${colour},${colour})`;
  const { attrs, nameEnd } = parseAttrs(raw);
  const style = attrs.find((a) => a.name === "style");
  if (!style) return `${raw.slice(0, nameEnd)} style="${lock}"${raw.slice(nameEnd)}`;
  const quoted = raw[style.vStart - 1] === '"' || raw[style.vStart - 1] === "'";
  if (!quoted && style.value === "") return raw;
  const before = style.value.trimEnd();
  const glue = before === "" || before.endsWith(";") ? "" : ";";
  return raw.slice(0, style.vStart) + before + glue + lock + raw.slice(style.vEnd);
}

interface OpenElement {
  name: string;
  idx: number;
  hasText: boolean;
  hasImg: boolean;
}

function lockImageOnlyBlocksUnsafe(html: string): string {
  if (!html.includes("<")) return html;
  const toks = tokenizeHtml(html);
  if (toks === null) return html;

  const stack: OpenElement[] = [];
  const locks = new Map<number, string>();
  for (let idx = 0; idx < toks.length; idx++) {
    const t = toks[idx];
    if (t.kind === "text") {
      if (t.raw.trim() !== "") for (const o of stack) o.hasText = true;
    } else if (t.kind === "start") {
      const opaque = OPAQUE_TAGS.has(t.name);
      if (t.name === "img") {
        if (countsAsImage(parseAttrs(t.raw).attrs)) for (const o of stack) o.hasImg = true;
      } else if (opaque) {
        for (const o of stack) o.hasText = true;
      }
      if (!VOID_TAGS.has(t.name) && !t.selfClose) stack.push({ name: t.name, idx, hasText: opaque, hasImg: false });
    } else if (t.kind === "end") {
      let j = stack.length - 1;
      while (j >= 0 && stack[j].name !== t.name) j--;
      if (j < 0) continue;                       // a stray end tag: ignore it
      const properlyNested = j === stack.length - 1;
      const el = stack[j];
      stack.length = j;
      if (properlyNested && LOCKABLE_TAGS.has(el.name) && el.hasImg && !el.hasText) {
        const colour = declaredBackground(parseAttrs(toks[el.idx].raw).attrs);
        if (colour) locks.set(el.idx, colour);
      }
    }
  }
  if (locks.size === 0) return html;

  let out = "";
  for (let idx = 0; idx < toks.length; idx++) {
    const colour = locks.get(idx);
    out += colour ? addGradientLock(toks[idx].raw, colour) : toks[idx].raw;
  }
  return out;
}

/**
 * Keep coloured blocks that hold only images (logo bands, hero art) as
 * designed when Gmail on iPhone recolours the email in dark mode. Blocks with
 * any text are left alone. Never throws: on anything unexpected it returns the
 * HTML as it came in.
 */
export function lockImageOnlyBlocks(html: string): string {
  try {
    return lockImageOnlyBlocksUnsafe(html);
  } catch {
    return html;
  }
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
  const html = lockImageOnlyBlocks(
    template.use_shell
      ? emailShell({ title: subject, preheader, rows: shellRow(body), lang })
      : body,
  );
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

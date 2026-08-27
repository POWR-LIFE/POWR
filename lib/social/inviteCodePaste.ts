/**
 * Paste-an-invite-code — the one-tap replacement for typing 8 characters.
 *
 * Why this exists: iOS has no reliable deferred deep link. Someone who taps a
 * creator's /join link, installs POWR from the App Store and opens it arrives
 * with nothing — the code never survives the store hop. The smart link
 * (landing-page/public/app.html) therefore puts the code on the clipboard via
 * its Copy button, and this is the other half: read it back on the code-entry
 * screens and offer it as a single tap.
 *
 * Two rules, both about not being creepy:
 *   * We only ever CHECK whether the clipboard holds text before showing the
 *     button (`hasStringAsync` — no system prompt). The read itself
 *     (`getStringAsync`) happens on the user's tap, which is the one gesture
 *     iOS treats as consent and the only moment the "pasted from" banner shows.
 *   * Anything that isn't shaped like a code is discarded, never surfaced. A
 *     clipboard full of someone's message must not end up in the input.
 *
 * Kept free of expo imports so it can be unit-tested; the screens inject the
 * real clipboard.
 */

/** Same bound as the deep-link capture in AuthContext and the creators.code CHECK. */
const CODE_RE = /^[A-Z0-9]{6,10}$/;
/** A minted POWR ID: 8 chars from the no-I/O/0/1 alphabet (see shared/memberId). */
const POWR_ID_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
/** Plausible inside a sentence: carries a digit, or is shaped exactly like a POWR ID. */
const plausible = (t: string) => CODE_RE.test(t) && (/\d/.test(t) || POWR_ID_RE.test(t));

export type ClipboardLike = {
  hasStringAsync: () => Promise<boolean>;
  getStringAsync: () => Promise<string>;
};

/**
 * Pull a code-shaped token out of arbitrary clipboard text.
 *
 * Accepts the bare code, the display form (`ABCD 2345`, `ABCD-2345`), or a
 * sentence/URL that contains one (`…use my code LUKE2026 —`, `?ref=LUKE2026`).
 * Prefers a `ref=` / `code` mention when present so a pasted smart-link URL
 * resolves to the right token rather than a random word in it.
 */
export function extractInviteCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const upper = text.toUpperCase();

  // 1. Explicit carriers: ?ref=CODE, "code CODE", "code: CODE". The token
  //    after the carrier, optionally joined to ONE following token so the
  //    display form "ABCD 2345" survives — but never a third word.
  //    "use my code tomorrow" is a sentence, not a code: after a carrier we
  //    still want a digit or the exact POWR ID shape (TOMORROW has an O; a
  //    minted ID never does).
  const explicit = upper.match(/(?:[?&]REF=|\bCODE[:\s]+)([A-Z0-9]+)(?:[ -]([A-Z0-9]+))?/);
  if (explicit) {
    const joined = explicit[1] + (explicit[2] ?? '');
    if (plausible(joined)) return joined;
    if (plausible(explicit[1])) return explicit[1];
  }

  // 2. The whole string IS a code, possibly with a display gap/hyphen. No
  //    digit required here: the POWR ID alphabet is 24 letters + 8 digits, so
  //    about one real code in ten is letters-only and must not be refused.
  const whole = upper.trim().replace(/[\s-]+/g, '');
  if (CODE_RE.test(whole)) return whole;

  // 3. Inside a longer message, only a code-shaped token WITH a digit — a
  //    sentence is full of 6–10 letter words, and offering "TOMORROW" as a
  //    code would be worse than offering nothing.
  const tokens = upper.match(/\b[A-Z0-9]{6,10}\b/g) ?? [];
  return tokens.find(plausible) ?? null;
}

/**
 * Is there something on the clipboard worth offering? Never reads the text.
 * Swallows every error — a clipboard permission quirk must not crash a signup.
 */
export async function clipboardMayHoldCode(clipboard: ClipboardLike): Promise<boolean> {
  try {
    return await clipboard.hasStringAsync();
  } catch {
    return false;
  }
}

/** Read on tap. Returns a normalised code or null; never throws. */
export async function readInviteCodeFromClipboard(clipboard: ClipboardLike): Promise<string | null> {
  try {
    const text = await clipboard.getStringAsync();
    return extractInviteCode(text);
  } catch {
    return null;
  }
}

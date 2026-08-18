/**
 * Friend-QR code parsing.
 *
 * A user's QR encodes the smart-link `https://powr.life/app?to=add-friend&ref=<code>`,
 * where <code> is their profiles.referral_code (8 uppercase chars, alphabet
 * ABCDEFGHJKLMNPQRSTUVWXYZ23456789 — see generate_referral_code()). The same
 * `ref=` param doubles as the referral attribution captured in AuthContext.
 *
 * The in-app scanner reads whatever string is in the QR and we resolve it
 * locally rather than round-tripping through the web page. We must therefore
 * accept every shape the code can legitimately arrive in:
 *   • the full https smart-link  …?to=add-friend&ref=ABC123ZZ
 *   • the custom-scheme deep link  powr://add-friend?ref=ABC123ZZ
 *   • a bare code  ABC123ZZ  (e.g. printed plainly under the QR)
 *   • the display form of the same code, ABC1 23ZZ — it is also the member's
 *     POWR ID (Settings > Account), which they may read out or paste with the gap
 *
 * STRING-SLICED / REGEX, never `new URL()` — RN's URL can't parse custom
 * schemes and the repo bans it for links (see app/+native-intent.tsx).
 */

/** Referral codes are 6–10 chars of the unambiguous uppercase alphanumeric set. */
const BARE_CODE = /^[A-Z0-9]{6,10}$/i;
/** The 8-char code in its display form — `ABC1 23ZZ` / `ABC1-23ZZ` (see shared/memberId). */
const DISPLAY_CODE = /^([A-Z0-9]{4})[\s-]([A-Z0-9]{4})$/i;
const REF_PARAM = /[?&]ref=([A-Z0-9]{6,10})/i;

/**
 * Extract the referral code from a scanned QR payload, or `null` if it isn't a
 * POWR friend code. Returned codes are upper-cased to match the stored form.
 */
export function parseReferralCode(scanned: string | null | undefined): string | null {
  const value = (scanned ?? '').trim();
  if (!value) return null;

  // A ref= param anywhere in the link (any order, http/https/powr scheme).
  const param = value.match(REF_PARAM);
  if (param) return param[1].toUpperCase();

  // Otherwise a plain code printed on its own.
  if (BARE_CODE.test(value)) return value.toUpperCase();

  // Or the same code in its display form (ABC1 23ZZ). Only that exact shape —
  // squashing arbitrary text would turn "hello world" into a code.
  const display = value.match(DISPLAY_CODE);
  if (display) return (display[1] + display[2]).toUpperCase();

  return null;
}

/**
 * Member ID — the human-readable identifier for a POWR account.
 *
 * It IS `profiles.referral_code`: 8 chars from ABCDEFGHJKLMNPQRSTUVWXYZ23456789
 * (no 0/1/I/O), UNIQUE NOT NULL, minted by trigger for every profile. One
 * string does three jobs — invite code, friend-QR payload, and the ID a
 * member reads to staff at an event or to support — so nobody ever has to
 * work out which of two codes you meant.
 *
 * Shared by the app (Settings > Account, profile chip) and the admin portal
 * (user search, event roster). The DB twin is public.normalize_member_id().
 */

/** Stored form: uppercase, no whitespace or hyphens. `null` if nothing is left. */
export function normalizeMemberId(raw: string | null | undefined): string | null {
  const v = (raw ?? '').replace(/[\s-]+/g, '').toUpperCase();
  return v.length > 0 ? v : null;
}

/**
 * Display form: `ABCD 2345`. The gap is only for reading aloud — copy, QR
 * and every lookup use the stored form. Anything that isn't a well-formed
 * 8-char code is returned as-is (uppercased) rather than mangled.
 */
export function formatMemberId(code: string | null | undefined): string {
  const v = normalizeMemberId(code);
  if (!v) return '';
  return v.length === 8 ? `${v.slice(0, 4)} ${v.slice(4)}` : v;
}

/**
 * The Pacer — an explicitly non-human pace line for solo challenge runs.
 *
 * A friendless (or friends-busy) user can already "Start solo", but a lone
 * progress bar reads as a chore list. Racing a visible pace — the fraction of
 * the challenge window that has elapsed — turns it into a chase: hold a better
 * fraction than the clock and you're ahead. Deliberately NOT a fake friend:
 * it's labelled PACER, earns nothing, pays no group bonus, and never appears
 * as a person. (A bot posing as a friend would corrupt both trust and the
 * bonus economy — see docs/shared-challenges-scope.md.)
 */

export interface PacerState {
  /** Elapsed fraction of the challenge window, 0..1 — the pace to beat. */
  fraction: number;
  /** Whole-percent form of `fraction` for bar widths. */
  pct: number;
  /** You're at or above the pace line. */
  ahead: boolean;
}

export function pacerState(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  selfProgress: number,
  now: number = Date.now(),
): PacerState | null {
  if (!startsAt || !endsAt) return null;
  const s = Date.parse(startsAt);
  const e = Date.parse(endsAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  const fraction = Math.max(0, Math.min(1, (now - s) / (e - s)));
  return { fraction, pct: Math.round(fraction * 100), ahead: selfProgress >= fraction };
}

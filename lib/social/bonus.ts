/**
 * Group-size bonus for shared ("together") challenges — the centrepiece mechanic.
 *
 * Each participant who INDIVIDUALLY completes their part earns the challenge's
 * base points PLUS a "together bonus" that scales with the number of OTHER
 * participants who also finished (co-completers). See
 * docs/shared-challenges-scope.md §6a.
 *
 *     earned = base + min(maxBonus, perHead × coCompleters)
 *
 * PURE + dependency-free so it can be shared by the UI (live preview) and,
 * eventually, mirrored server-side in the completion edge function — which is
 * the AUTHORITATIVE place this maths must run. Never trust a client total.
 */

export interface BonusConfig {
  /** Points added per co-completer (other participant who individually finished). */
  perHead: number;
  /** Hard cap on the total bonus, so a big group can't mint unbounded points. */
  maxBonus: number;
}

/**
 * v1 defaults. Tuning is open (scope §8 #1) — keep them here so there's one
 * place to change and the UI preview always matches the server award.
 * Worked example from the scope doc: base 30, perHead 5, cap 30 →
 * finish with 1 friend = 35; with 6 = 60 (bonus capped at +30).
 */
export const BONUS_DEFAULTS: BonusConfig = { perHead: 5, maxBonus: 30 };

const cfgOf = (cfg?: Partial<BonusConfig>): BonusConfig => ({ ...BONUS_DEFAULTS, ...cfg });

/**
 * The config a SPECIFIC challenge was created under.
 *
 * This matters because the server settles from the challenge row's own
 * snapshot (`bonus_per_head` / `bonus_max`, taken at creation), not from the
 * live `shared_challenge_config` row. A client reading the global config shows
 * a different number than was banked for every challenge that was already
 * running when the config was retuned. Always prefer the snapshot; fall back
 * to the global config only for rows that predate it.
 */
export function challengeBonusConfig(
  challenge: { bonusPerHead?: number | null; bonusMax?: number | null },
  fallback?: Partial<BonusConfig>,
): Partial<BonusConfig> {
  return {
    ...fallback,
    ...(typeof challenge.bonusPerHead === 'number' ? { perHead: challenge.bonusPerHead } : {}),
    ...(typeof challenge.bonusMax === 'number' ? { maxBonus: challenge.bonusMax } : {}),
  };
}

/**
 * Bonus points earned for a given number of co-completers.
 * `coCompleters` = participants EXCLUDING you who individually met their part.
 * Always ≥ 0 and ≤ maxBonus.
 */
export function groupBonus(coCompleters: number, cfg?: Partial<BonusConfig>): number {
  const { perHead, maxBonus } = cfgOf(cfg);
  const heads = Math.max(0, Math.floor(coCompleters));
  return Math.min(maxBonus, perHead * heads);
}

export interface EarnedBreakdown {
  base: number;
  bonus: number;
  total: number;
}

/**
 * Full breakdown for one participant: base + group bonus.
 * Returns base-only (bonus 0) when nobody else finished.
 */
export function earnedPoints(
  base: number,
  coCompleters: number,
  cfg?: Partial<BonusConfig>,
): EarnedBreakdown {
  const bonus = groupBonus(coCompleters, cfg);
  return { base, bonus, total: base + bonus };
}

/**
 * Best-case bonus to show in the create sheet / invite preview: "if everyone
 * finishes, +X each". For a group of `groupSize` total people, each completer
 * sees `groupSize - 1` co-completers.
 */
export function maxBonusForGroup(groupSize: number, cfg?: Partial<BonusConfig>): number {
  return groupBonus(Math.max(0, groupSize - 1), cfg);
}

/**
 * The smallest group size at which the bonus hits its cap — useful for UI copy
 * ("invite N+ friends to max your bonus") and for not over-promising.
 */
export function groupSizeAtCap(cfg?: Partial<BonusConfig>): number {
  const { perHead, maxBonus } = cfgOf(cfg);
  if (perHead <= 0) return Infinity;
  return Math.ceil(maxBonus / perHead) + 1; // +1: you, plus the co-completers
}

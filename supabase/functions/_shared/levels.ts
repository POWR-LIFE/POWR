// Server-side mirror of the POWR level ladder — names, tiers and artwork only.
// Source of truth: constants/levels.ts (client). The Vault level-bonus schedule
// is NOT mirrored here — the vault_level_up_check() trigger is authoritative for
// amounts and the trigger payload carries the banked bonus with it.
// Email-safe hex tier colours (the client uses rgba for the recruit tier).

export type LevelTier = "recruit" | "athlete" | "elite" | "legend";

export interface LevelDef {
  level: number;
  name: string;
  tier: LevelTier;
  /** Lifetime POWR at which the level starts — mirrors constants/levels.ts. */
  xpMin: number;
}

export const TIER_LABEL: Record<LevelTier, string> = {
  recruit: "Recruit",
  athlete: "Athlete",
  elite: "Elite",
  legend: "Legend",
};

export const TIER_COLOR: Record<LevelTier, string> = {
  recruit: "#999999",
  athlete: "#fb923c",
  elite: "#E8D200",
  legend: "#E8D200",
};

export const LEVELS: LevelDef[] = [
  { level: 1,  name: "Touching Grass",    tier: "recruit", xpMin: 0 },
  { level: 2,  name: "Cardio Goblin",     tier: "recruit", xpMin: 500 },
  { level: 3,  name: "Streak Freak",      tier: "recruit", xpMin: 1200 },
  { level: 4,  name: "Motion Magic",      tier: "recruit", xpMin: 2500 },
  { level: 5,  name: "Heavy Hitter",      tier: "recruit", xpMin: 4500 },
  { level: 6,  name: "Can't Sit Still",   tier: "athlete", xpMin: 7000 },
  { level: 7,  name: "Iron Lungs",        tier: "athlete", xpMin: 10000 },
  { level: 8,  name: "Pavement Predator", tier: "athlete", xpMin: 14000 },
  { level: 9,  name: "Step Collector",    tier: "athlete", xpMin: 19000 },
  { level: 10, name: "Calorie Criminal",  tier: "athlete", xpMin: 25000 },
  { level: 11, name: "Mile Muncher",      tier: "elite",   xpMin: 32500 },
  { level: 12, name: "Move Machine",      tier: "elite",   xpMin: 41000 },
  { level: 13, name: "Need New Shoes",    tier: "elite",   xpMin: 51000 },
  { level: 14, name: "Certified Weapon",  tier: "elite",   xpMin: 63000 },
  { level: 15, name: "Momentum Monster",  tier: "elite",   xpMin: 77000 },
  { level: 16, name: "Limit Breaker",     tier: "legend",  xpMin: 93000 },
  { level: 17, name: "Diesel Mode",       tier: "legend",  xpMin: 111000 },
  { level: 18, name: "Peak Condition",    tier: "legend",  xpMin: 132000 },
  { level: 19, name: "Long Hauler",       tier: "legend",  xpMin: 156000 },
  { level: 20, name: "Goggins",           tier: "legend",  xpMin: 182000 },
];

const LEVEL_IMAGE_BASE = "https://auth.powr.life/storage/v1/object/public/powr-level-logo/";
const LEVEL_IMAGE_CACHE_VERSION = "20260711";

const LEVEL_IMAGE_FILE: Partial<Record<number, string>> = {
  1: "touching-grass-1.png",
  2: "the-cardio-goblin.png",
  3: "streak-freak.png",
  4: "motion-magic.png",
  5: "heavy-hit.png",
  6: "cant-sit-still.png",
  7: "iron-lungs.png",
  8: "pavement-predator.png",
  9: "step-collector.png",
  10: "calorie-criminal.png",
  11: "mile-muncher.png",
  12: "move-machine.png",
  13: "need-new-shoes.png",
  14: "certified-weapon.png",
  15: "momentum-monster.png",
  16: "limit-breaker.png",
  17: "diesel-mode.png",
  18: "peak-condition.png",
  19: "long-hauler.png",
  20: "goggins.png",
};

export function levelDef(level: number): LevelDef | null {
  return LEVELS.find((l) => l.level === level) ?? null;
}

export function levelImageUrl(level: number): string | null {
  const file = LEVEL_IMAGE_FILE[level];
  return file ? `${LEVEL_IMAGE_BASE}${file}?v=${LEVEL_IMAGE_CACHE_VERSION}` : null;
}

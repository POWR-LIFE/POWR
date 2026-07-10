/**
 * POWR Level / Tier Definitions
 *
 * Single source of truth for the 20-level progression system.
 * Four tiers: Recruit (1-5), Athlete (6-10), Elite (11-15), Legend (16-20).
 */

export type LevelTier = 'recruit' | 'athlete' | 'elite' | 'legend';

export interface LevelDef {
  level: number;
  name: string;
  tier: LevelTier;
  xpMin: number;
  xpMax: number;
  /** Per-level accent colour for the level name (from the level artwork set). */
  textColor: string;
  pill: {
    bg: string;
    border: string;
    text: string;
  };
}

export const TIER_META: Record<LevelTier, { label: string; color: string; range: string }> = {
  recruit: { label: 'RECRUIT', color: 'rgba(255,255,255,0.55)', range: 'LEVELS 1–5' },
  athlete: { label: 'ATHLETE', color: '#fb923c',                range: 'LEVELS 6–10' },
  elite:   { label: 'ELITE',   color: '#E8D200',                range: 'LEVELS 11–15' },
  legend:  { label: 'LEGEND',  color: '#E8D200',                range: 'LEVELS 16–20' },
};

const R_PILL = { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.18)', text: 'rgba(255,255,255,0.65)' };
const A_PILL = { bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.35)',  text: '#fb923c' };
const E_PILL = { bg: 'rgba(232,210,0,0.14)',   border: 'rgba(232,210,0,0.40)',   text: '#E8D200' };
const L_PILL = { bg: 'rgba(232,210,0,0.22)',   border: 'rgba(232,210,0,0.60)',   text: '#E8D200' };

export const LEVELS: LevelDef[] = [
  { level: 1,  name: 'Touching Grass',    tier: 'recruit', xpMin: 0,      xpMax: 499,    textColor: '#FFFFFF', pill: R_PILL },
  { level: 2,  name: 'Cardio Goblin',     tier: 'recruit', xpMin: 500,    xpMax: 1199,   textColor: '#4A9EFF', pill: R_PILL },
  { level: 3,  name: 'Streak Freak',      tier: 'recruit', xpMin: 1200,   xpMax: 2499,   textColor: '#3BE0D0', pill: R_PILL },
  { level: 4,  name: 'Motion Magic',      tier: 'recruit', xpMin: 2500,   xpMax: 4499,   textColor: '#FFFFFF', pill: R_PILL },
  { level: 5,  name: 'Heavy Hitter',      tier: 'recruit', xpMin: 4500,   xpMax: 6999,   textColor: '#FF6A2C', pill: R_PILL },
  { level: 6,  name: 'Can\'t Sit Still',  tier: 'athlete', xpMin: 7000,   xpMax: 9999,   textColor: '#F2C230', pill: A_PILL },
  { level: 7,  name: 'Iron Lungs',        tier: 'athlete', xpMin: 10000,  xpMax: 13999,  textColor: '#FFFFFF', pill: A_PILL },
  { level: 8,  name: 'Pavement Predator', tier: 'athlete', xpMin: 14000,  xpMax: 18999,  textColor: '#22C7E0', pill: A_PILL },
  { level: 9,  name: 'Step Collector',    tier: 'athlete', xpMin: 19000,  xpMax: 24999,  textColor: '#E85CD8', pill: A_PILL },
  { level: 10, name: 'Calorie Criminal',  tier: 'athlete', xpMin: 25000,  xpMax: 32499,  textColor: '#FF6A2C', pill: A_PILL },
  { level: 11, name: 'Mile Muncher',      tier: 'elite',   xpMin: 32500,  xpMax: 40999,  textColor: '#4A9EFF', pill: E_PILL },
  { level: 12, name: 'Move Machine',      tier: 'elite',   xpMin: 41000,  xpMax: 50999,  textColor: '#FFFFFF', pill: E_PILL },
  { level: 13, name: 'Need New Shoes',    tier: 'elite',   xpMin: 51000,  xpMax: 62999,  textColor: '#B06AF5', pill: E_PILL },
  { level: 14, name: 'Certified Weapon',  tier: 'elite',   xpMin: 63000,  xpMax: 76999,  textColor: '#FFFFFF', pill: E_PILL },
  { level: 15, name: 'Momentum Monster',  tier: 'elite',   xpMin: 77000,  xpMax: 92999,  textColor: '#4A9EFF', pill: E_PILL },
  { level: 16, name: 'Limit Breaker',     tier: 'legend',  xpMin: 93000,  xpMax: 110999, textColor: '#FFFFFF', pill: L_PILL },
  { level: 17, name: 'Diesel Mode',       tier: 'legend',  xpMin: 111000, xpMax: 131999, textColor: '#F5334F', pill: L_PILL },
  { level: 18, name: 'Peak Condition',    tier: 'legend',  xpMin: 132000, xpMax: 155999, textColor: '#B06AF5', pill: L_PILL },
  { level: 19, name: 'Long Hauler',       tier: 'legend',  xpMin: 156000, xpMax: 181999, textColor: '#2BC4B0', pill: L_PILL },
  { level: 20, name: 'Goggins',           tier: 'legend',  xpMin: 182000, xpMax: Infinity, textColor: '#F2C230', pill: L_PILL },
];

/**
 * Per-level artwork hosted in Supabase storage (bucket: powr-level-logo).
 * When a level has an entry here the achievements UI renders the image in
 * place of the generated SVG icon; levels without an entry keep the SVG.
 *
 * Just add the filename you uploaded to the bucket — the full URL is built for
 * you. Fill in each level as its artwork lands.
 */
const LEVEL_IMAGE_BASE =
  'https://auth.powr.life/storage/v1/object/public/powr-level-logo/';

const LEVEL_IMAGE_FILE: Partial<Record<number, string>> = {
  1: 'touching-grass-1.png',
  2: 'the-cardio-goblin.png',
  3: 'streak-freak.png',
  4: 'motion-magic.png',
  5: 'heavy-hit.png',
  6: 'cant-sit-still.png',
  7: 'iron-lungs.png',
  8: 'pavement-predator.png',
  9: 'step-collector.png',
  10: 'calorie-criminal.png',
  11: 'mile-muncher.png',
  12: 'move-machine.png',
  13: 'need-new-shoes.png',
  14: 'certified-weapon.png',
  15: 'momentum-monster.png',
  16: 'limit-breaker.png',
  17: 'diesel-mode.png',
  18: 'peak-condition.png',
  19: 'long-hauler.png',
  20: 'goggins.png',
};

export const LEVEL_IMAGE: Partial<Record<number, string>> = Object.fromEntries(
  Object.entries(LEVEL_IMAGE_FILE)
    .filter(([, file]) => !!file)
    // Accept either a bare filename or a full URL pasted in.
    .map(([level, file]) => [
      level,
      /^https?:\/\//.test(file!) ? file! : LEVEL_IMAGE_BASE + file,
    ]),
);

export interface LevelInfo {
  current: LevelDef;
  next: LevelDef | undefined;
  xpIntoLevel: number;
  xpForLevel: number;
}

export function getLevelInfo(totalEarned: number): LevelInfo {
  const current = [...LEVELS].reverse().find(l => totalEarned >= l.xpMin) ?? LEVELS[0];
  const next = LEVELS.find(l => l.level === current.level + 1);
  const xpIntoLevel = totalEarned - current.xpMin;
  const xpForLevel = (next?.xpMin ?? current.xpMax + 1) - current.xpMin;
  return { current, next, xpIntoLevel, xpForLevel };
}

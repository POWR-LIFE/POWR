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
  { level: 1,  name: 'Beginner',   tier: 'recruit', xpMin: 0,      xpMax: 499,    pill: R_PILL },
  { level: 2,  name: 'Starter',    tier: 'recruit', xpMin: 500,    xpMax: 1199,   pill: R_PILL },
  { level: 3,  name: 'Contender',  tier: 'recruit', xpMin: 1200,   xpMax: 2499,   pill: R_PILL },
  { level: 4,  name: 'Climber',    tier: 'recruit', xpMin: 2500,   xpMax: 4499,   pill: R_PILL },
  { level: 5,  name: 'Grafter',    tier: 'recruit', xpMin: 4500,   xpMax: 6999,   pill: R_PILL },
  { level: 6,  name: 'Athlete',    tier: 'athlete', xpMin: 7000,   xpMax: 9999,   pill: A_PILL },
  { level: 7,  name: 'Competitor', tier: 'athlete', xpMin: 10000,  xpMax: 13999,  pill: A_PILL },
  { level: 8,  name: 'Performer',  tier: 'athlete', xpMin: 14000,  xpMax: 18999,  pill: A_PILL },
  { level: 9,  name: 'Specialist', tier: 'athlete', xpMin: 19000,  xpMax: 24999,  pill: A_PILL },
  { level: 10, name: 'Veteran',    tier: 'athlete', xpMin: 25000,  xpMax: 32499,  pill: A_PILL },
  { level: 11, name: 'Pro',        tier: 'elite',   xpMin: 32500,  xpMax: 40999,  pill: E_PILL },
  { level: 12, name: 'Operator',   tier: 'elite',   xpMin: 41000,  xpMax: 50999,  pill: E_PILL },
  { level: 13, name: 'Enforcer',   tier: 'elite',   xpMin: 51000,  xpMax: 62999,  pill: E_PILL },
  { level: 14, name: 'Titan',      tier: 'elite',   xpMin: 63000,  xpMax: 76999,  pill: E_PILL },
  { level: 15, name: 'Ironclad',   tier: 'elite',   xpMin: 77000,  xpMax: 92999,  pill: E_PILL },
  { level: 16, name: 'Champion',   tier: 'legend',  xpMin: 93000,  xpMax: 110999, pill: L_PILL },
  { level: 17, name: 'Icon',       tier: 'legend',  xpMin: 111000, xpMax: 131999, pill: L_PILL },
  { level: 18, name: 'Legend',     tier: 'legend',  xpMin: 132000, xpMax: 155999, pill: L_PILL },
  { level: 19, name: 'Immortal',   tier: 'legend',  xpMin: 156000, xpMax: 181999, pill: L_PILL },
  { level: 20, name: 'POWR',       tier: 'legend',  xpMin: 182000, xpMax: Infinity, pill: L_PILL },
];

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

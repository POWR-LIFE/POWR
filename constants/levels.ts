/**
 * POWR Level / Tier Definitions
 *
 * Single source of truth for the progression system.
 * Tier names follow the brand narrative — premium, Ruler-archetype language.
 * No hustle-culture terms (e.g. "Grinder") — see POWR_Brand_Narrative.md.
 */

export interface LevelDef {
  level: number;
  name: string;
  xpMin: number;
  xpMax: number;
  /** Pill colours */
  pill: {
    bg: string;
    border: string;
    text: string;
  };
}

// XP thresholds are designed so each tier takes roughly 2× as long as the previous.
// A dedicated gym user (max 30 pts/day) takes ~6 months to reach Champion,
// ~1 year for Elite, ~2 years for Sovereign, and Legend is a true lifetime achievement.
export const LEVELS: LevelDef[] = [
  {
    level: 1,
    name: 'Starter',
    xpMin: 0,
    xpMax: 299,
    pill: { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)', text: 'rgba(255,255,255,0.5)' },
  },
  {
    level: 2,
    name: 'Mover',
    xpMin: 300,
    xpMax: 999,
    pill: { bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.30)', text: '#4ade80' },
  },
  {
    level: 3,
    name: 'Athlete',
    xpMin: 1000,
    xpMax: 2499,
    pill: { bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.30)', text: '#38bdf8' },
  },
  {
    level: 4,
    name: 'Performer',
    xpMin: 2500,
    xpMax: 4999,
    pill: { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.30)', text: '#a855f7' },
  },
  {
    level: 5,
    name: 'Champion',
    xpMin: 5000,
    xpMax: 9999,
    pill: { bg: 'rgba(232,210,0,0.12)', border: 'rgba(232,210,0,0.30)', text: '#E8D200' },
  },
  {
    level: 6,
    name: 'Elite',
    xpMin: 10000,
    xpMax: 19999,
    pill: { bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.30)', text: '#f97316' },
  },
  {
    level: 7,
    name: 'Sovereign',
    xpMin: 20000,
    xpMax: 39999,
    pill: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.30)', text: '#ef4444' },
  },
  {
    level: 8,
    name: 'Legend',
    xpMin: 40000,
    xpMax: Infinity,
    pill: { bg: 'rgba(232,210,0,0.22)', border: 'rgba(232,210,0,0.60)', text: '#E8D200' },
  },
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

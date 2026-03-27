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

export const LEVELS: LevelDef[] = [
  {
    level: 1,
    name: 'Starter',
    xpMin: 0,
    xpMax: 499,
    pill: { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)', text: 'rgba(255,255,255,0.5)' },
  },
  {
    level: 2,
    name: 'Mover',
    xpMin: 500,
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
    name: 'Legend',
    xpMin: 10000,
    xpMax: Infinity,
    pill: { bg: 'rgba(232,210,0,0.18)', border: 'rgba(232,210,0,0.50)', text: '#E8D200' },
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

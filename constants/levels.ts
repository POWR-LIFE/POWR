/**
 * POWR Level / Tier Definitions
 *
 * Single source of truth for the progression system.
 * 20 levels: playful start, committed middle, and elite endgame.
 */

export interface LevelDef {
  level: number;
  name: string;
  stageIcon: string;
  xpMin: number;
  xpMax: number;
  /** Pill colours */
  pill: {
    bg: string;
    border: string;
    text: string;
  };
}

// XP thresholds are tuned to keep early momentum high and make higher
// levels increasingly hard-earned. Thresholds are cumulative total XP.
export const LEVELS: LevelDef[] = [
  {
    level: 1,
    name: 'Newbie',
    stageIcon: 'seedling-outline',
    xpMin: 0,
    xpMax: 149,
    pill: { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)', text: 'rgba(255,255,255,0.5)' },
  },
  {
    level: 2,
    name: 'Sofa Survivor',
    stageIcon: 'walk-outline',
    xpMin: 150,
    xpMax: 399,
    pill: { bg: '#141414', border: 'rgba(255,255,255,0.12)', text: 'rgba(255,255,255,0.5)' },
  },
  {
    level: 3,
    name: 'Accidental Athlete',
    stageIcon: 'barbell-outline',
    xpMin: 400,
    xpMax: 749,
    pill: { bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.30)', text: '#38bdf8' },
  },
  {
    level: 4,
    name: 'Showing Up',
    stageIcon: 'flash-outline',
    xpMin: 750,
    xpMax: 1199,
    pill: { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.30)', text: '#a855f7' },
  },
  {
    level: 5,
    name: 'Gym Curious',
    stageIcon: 'trophy-outline',
    xpMin: 1200,
    xpMax: 1799,
    pill: { bg: 'rgba(232,210,0,0.12)', border: 'rgba(232,210,0,0.30)', text: '#E8D200' },
  },
  {
    level: 6,
    name: 'Semi-Serious',
    stageIcon: 'diamond-outline',
    xpMin: 1800,
    xpMax: 2599,
    pill: { bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.30)', text: '#f97316' },
  },
  {
    level: 7,
    name: 'Getting There',
    stageIcon: 'shield-checkmark-outline',
    xpMin: 2600,
    xpMax: 3599,
    pill: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.30)', text: '#ef4444' },
  },
  {
    level: 8,
    name: 'Committed',
    stageIcon: 'sparkles-outline',
    xpMin: 3600,
    xpMax: 4999,
    pill: { bg: 'rgba(232,210,0,0.22)', border: 'rgba(232,210,0,0.60)', text: '#E8D200' },
  },
  {
    level: 9,
    name: 'Consistent',
    stageIcon: 'flame-outline',
    xpMin: 5000,
    xpMax: 6799,
    pill: { bg: 'rgba(34,197,94,0.16)', border: 'rgba(34,197,94,0.35)', text: '#4ade80' },
  },
  {
    level: 10,
    name: 'Dialled In',
    stageIcon: 'options-outline',
    xpMin: 6800,
    xpMax: 8999,
    pill: { bg: 'rgba(14,165,233,0.16)', border: 'rgba(14,165,233,0.35)', text: '#38bdf8' },
  },
  {
    level: 11,
    name: 'Driven',
    stageIcon: 'speedometer-outline',
    xpMin: 9000,
    xpMax: 11599,
    pill: { bg: 'rgba(6,182,212,0.16)', border: 'rgba(6,182,212,0.35)', text: '#22d3ee' },
  },
  {
    level: 12,
    name: 'Sharp',
    stageIcon: 'flash-outline',
    xpMin: 11600,
    xpMax: 14699,
    pill: { bg: 'rgba(168,85,247,0.16)', border: 'rgba(168,85,247,0.35)', text: '#c084fc' },
  },
  {
    level: 13,
    name: 'Relentless',
    stageIcon: 'rocket-outline',
    xpMin: 14700,
    xpMax: 18299,
    pill: { bg: 'rgba(239,68,68,0.16)', border: 'rgba(239,68,68,0.35)', text: '#f87171' },
  },
  {
    level: 14,
    name: 'Elite',
    stageIcon: 'diamond-outline',
    xpMin: 18300,
    xpMax: 22499,
    pill: { bg: 'rgba(245,158,11,0.16)', border: 'rgba(245,158,11,0.35)', text: '#fbbf24' },
  },
  {
    level: 15,
    name: 'Ironclad',
    stageIcon: 'shield-outline',
    xpMin: 22500,
    xpMax: 27299,
    pill: { bg: 'rgba(251,146,60,0.16)', border: 'rgba(251,146,60,0.35)', text: '#fdba74' },
  },
  {
    level: 16,
    name: 'Unstoppable',
    stageIcon: 'thunderstorm-outline',
    xpMin: 27300,
    xpMax: 32799,
    pill: { bg: 'rgba(244,63,94,0.16)', border: 'rgba(244,63,94,0.35)', text: '#fb7185' },
  },
  {
    level: 17,
    name: 'Legendary',
    stageIcon: 'medal-outline',
    xpMin: 32800,
    xpMax: 38999,
    pill: { bg: 'rgba(251,191,36,0.18)', border: 'rgba(251,191,36,0.4)', text: '#facc15' },
  },
  {
    level: 18,
    name: 'Mythic',
    stageIcon: 'planet-outline',
    xpMin: 39000,
    xpMax: 45999,
    pill: { bg: 'rgba(34,211,238,0.18)', border: 'rgba(34,211,238,0.4)', text: '#67e8f9' },
  },
  {
    level: 19,
    name: 'Immortal',
    stageIcon: 'infinite-outline',
    xpMin: 46000,
    xpMax: 53999,
    pill: { bg: 'rgba(217,70,239,0.18)', border: 'rgba(217,70,239,0.4)', text: '#e879f9' },
  },
  {
    level: 20,
    name: 'POWR',
    stageIcon: 'sparkles-outline',
    xpMin: 54000,
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

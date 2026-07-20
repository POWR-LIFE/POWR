/**
 * POWR Achievement Library
 *
 * 20 achievements focused on level progression. Each has a typed unlock condition
 * that `computeEarnedIds()` evaluates against real user stats.
 *
 * Category: level
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AchievementUnlock =
  | { type: 'total_points';        amount: number }
  | { type: 'streak_current';      days: number }
  | { type: 'streak_longest';      days: number }
  | { type: 'sessions_total';      count: number }
  | { type: 'sessions_type';       activity: string; count: number }
  | { type: 'level';               level: number }
  | { type: 'run_distance_single'; km: number }
  | { type: 'run_distance_total';  km: number }
  | { type: 'steps_single_day';    steps: number }
  | { type: 'steps_total';         steps: number };

export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type AchievementCategory =
  | 'habit'
  | 'sessions'
  | 'points'
  | 'level'
  | 'running'
  | 'gym'
  | 'cycling'
  | 'swimming'
  | 'hiit'
  | 'yoga'
  | 'sports'
  | 'walking';

export type AchievementDef = {
  id: string;
  code: string;          // short label shown in the medallion
  name: string;
  description: string;
  category: AchievementCategory;
  colour: string;        // accent colour for earned state
  icon: string;          // Ionicons name (without -outline suffix)
  rarity: AchievementRarity;
  unlock: AchievementUnlock;
};

/** Stats required to evaluate which achievements are earned. */
export type AchievementStats = {
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  level: number;
  totalSessions: number;
  sessionsPerType: Record<string, number>;
  totalRunDistanceKm: number;
  maxSingleRunKm: number;
  totalSteps: number;
  maxSingleDaySteps: number;
};

// ─── Category metadata ────────────────────────────────────────────────────────

export const CATEGORY_META: Record<
  AchievementCategory,
  { label: string; colour: string; icon: string }
> = {
  habit:    { label: 'Habit',     colour: '#f97316', icon: 'flame-outline' },
  sessions: { label: 'Sessions',  colour: '#4ade80', icon: 'checkmark-done-outline' },
  points:   { label: 'Points',    colour: '#E8D200', icon: 'star-outline' },
  level:    { label: 'Level',     colour: '#E8D200', icon: 'ribbon-outline' },
  running:  { label: 'Running',   colour: '#38bdf8', icon: 'speedometer-outline' },
  gym:      { label: 'Gym',       colour: '#E8D200', icon: 'barbell-outline' },
  cycling:  { label: 'Cycling',   colour: '#a855f7', icon: 'bicycle-outline' },
  swimming: { label: 'Swimming',  colour: '#06b6d4', icon: 'water-outline' },
  hiit:     { label: 'HIIT',      colour: '#ef4444', icon: 'flash-outline' },
  yoga:     { label: 'Yoga',      colour: '#c084fc', icon: 'leaf-outline' },
  sports:   { label: 'Sports',    colour: '#4ade80', icon: 'football-outline' },
  walking:  { label: 'Walking',   colour: '#6ee7b7', icon: 'footsteps-outline' },
};

// ─── Achievement Library ──────────────────────────────────────────────────────

export const ACHIEVEMENTS: AchievementDef[] = [
  // ── Level progression milestones ─────────────────────────────────────────

  {
    id: 'lvl-1',
    code: 'LV1',
    name: 'Touching Grass',
    description: 'Reach Level 1: Touching Grass',
    category: 'level',
    colour: '#4ade80',
    icon: 'ribbon',
    rarity: 'common',
    unlock: { type: 'level', level: 1 },
  },
  {
    id: 'lvl-2',
    code: 'LV2',
    name: 'Cardio Goblin',
    description: 'Reach Level 2: Cardio Goblin',
    category: 'level',
    colour: '#4ade80',
    icon: 'ribbon',
    rarity: 'common',
    unlock: { type: 'level', level: 2 },
  },
  {
    id: 'lvl-3',
    code: 'LV3',
    name: 'Streak Freak',
    description: 'Reach Level 3: Streak Freak',
    category: 'level',
    colour: '#38bdf8',
    icon: 'ribbon',
    rarity: 'common',
    unlock: { type: 'level', level: 3 },
  },
  {
    id: 'lvl-4',
    code: 'LV4',
    name: 'Motion Magic',
    description: 'Reach Level 4: Motion Magic',
    category: 'level',
    colour: '#a855f7',
    icon: 'ribbon',
    rarity: 'common',
    unlock: { type: 'level', level: 4 },
  },
  {
    id: 'lvl-5',
    code: 'LV5',
    name: 'Heavy Hitter',
    description: 'Reach Level 5: Heavy Hitter',
    category: 'level',
    colour: '#E8D200',
    icon: 'trophy',
    rarity: 'common',
    unlock: { type: 'level', level: 5 },
  },
  {
    id: 'lvl-6',
    code: 'LV6',
    name: 'Can\'t Sit Still',
    description: 'Reach Level 6: Can\'t Sit Still',
    category: 'level',
    colour: '#f97316',
    icon: 'trophy',
    rarity: 'rare',
    unlock: { type: 'level', level: 6 },
  },
  {
    id: 'lvl-7',
    code: 'LV7',
    name: 'Iron Lungs',
    description: 'Reach Level 7: Iron Lungs',
    category: 'level',
    colour: '#ef4444',
    icon: 'trophy',
    rarity: 'rare',
    unlock: { type: 'level', level: 7 },
  },
  {
    id: 'lvl-8',
    code: 'LV8',
    name: 'Pavement Predator',
    description: 'Reach Level 8: Pavement Predator',
    category: 'level',
    colour: '#E8D200',
    icon: 'ribbon',
    rarity: 'rare',
    unlock: { type: 'level', level: 8 },
  },
  {
    id: 'lvl-9',
    code: 'LV9',
    name: 'Step Collector',
    description: 'Reach Level 9: Step Collector',
    category: 'level',
    colour: '#22c55e',
    icon: 'ribbon',
    rarity: 'rare',
    unlock: { type: 'level', level: 9 },
  },
  {
    id: 'lvl-10',
    code: 'LV10',
    name: 'Calorie Criminal',
    description: 'Reach Level 10: Calorie Criminal',
    category: 'level',
    colour: '#0ea5e9',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'level', level: 10 },
  },
  {
    id: 'lvl-11',
    code: 'LV11',
    name: 'Mile Muncher',
    description: 'Reach Level 11: Mile Muncher',
    category: 'level',
    colour: '#06b6d4',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'level', level: 11 },
  },
  {
    id: 'lvl-12',
    code: 'LV12',
    name: 'Move Machine',
    description: 'Reach Level 12: Move Machine',
    category: 'level',
    colour: '#a855f7',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'level', level: 12 },
  },
  {
    id: 'lvl-13',
    code: 'LV13',
    name: 'Need New Shoes',
    description: 'Reach Level 13: Need New Shoes',
    category: 'level',
    colour: '#ef4444',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'level', level: 13 },
  },
  {
    id: 'lvl-14',
    code: 'LV14',
    name: 'Certified Weapon',
    description: 'Reach Level 14: Certified Weapon',
    category: 'level',
    colour: '#f59e0b',
    icon: 'medal',
    rarity: 'epic',
    unlock: { type: 'level', level: 14 },
  },
  {
    id: 'lvl-15',
    code: 'LV15',
    name: 'Momentum Monster',
    description: 'Reach Level 15: Momentum Monster',
    category: 'level',
    colour: '#f97316',
    icon: 'shield-checkmark',
    rarity: 'legendary',
    unlock: { type: 'level', level: 15 },
  },
  {
    id: 'lvl-16',
    code: 'LV16',
    name: 'Limit Breaker',
    description: 'Reach Level 16: Limit Breaker',
    category: 'level',
    colour: '#f43f5e',
    icon: 'medal',
    rarity: 'legendary',
    unlock: { type: 'level', level: 16 },
  },
  {
    id: 'lvl-17',
    code: 'LV17',
    name: 'Diesel Mode',
    description: 'Reach Level 17: Diesel Mode',
    category: 'level',
    colour: '#E8D200',
    icon: 'medal',
    rarity: 'legendary',
    unlock: { type: 'level', level: 17 },
  },
  {
    id: 'lvl-18',
    code: 'LV18',
    name: 'Peak Condition',
    description: 'Reach Level 18: Peak Condition',
    category: 'level',
    colour: '#22d3ee',
    icon: 'diamond',
    rarity: 'legendary',
    unlock: { type: 'level', level: 18 },
  },
  {
    id: 'lvl-19',
    code: 'LV19',
    name: 'Long Hauler',
    description: 'Reach Level 19: Long Hauler',
    category: 'level',
    colour: '#d946ef',
    icon: 'diamond',
    rarity: 'legendary',
    unlock: { type: 'level', level: 19 },
  },
  {
    id: 'lvl-20',
    code: 'LV20',
    name: 'Goggins',
    description: 'The summit. Reach Level 20: Goggins',
    category: 'level',
    colour: '#E8D200',
    icon: 'medal',
    rarity: 'legendary',
    unlock: { type: 'level', level: 20 },
  },
];

// ─── Rarity config ────────────────────────────────────────────────────────────

export const RARITY_META: Record<
  AchievementRarity,
  { label: string; border: string; glow: string }
> = {
  common:    { label: 'Common',    border: 'rgba(255,255,255,0.15)', glow: 'transparent' },
  rare:      { label: 'Rare',      border: 'rgba(56,189,248,0.5)',   glow: 'rgba(56,189,248,0.12)' },
  epic:      { label: 'Epic',      border: 'rgba(168,85,247,0.6)',   glow: 'rgba(168,85,247,0.15)' },
  legendary: { label: 'Legendary', border: 'rgba(232,210,0,0.7)',    glow: 'rgba(232,210,0,0.18)' },
};

// ─── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Returns the set of achievement IDs that are earned given the provided stats.
 */
export function computeEarnedIds(stats: AchievementStats): Set<string> {
  const earned = new Set<string>();

  for (const a of ACHIEVEMENTS) {
    const u = a.unlock;
    let isEarned = false;

    switch (u.type) {
      case 'total_points':
        isEarned = stats.totalPoints >= u.amount;
        break;
      case 'streak_current':
        isEarned = stats.currentStreak >= u.days;
        break;
      case 'streak_longest':
        isEarned = stats.longestStreak >= u.days;
        break;
      case 'sessions_total':
        isEarned = stats.totalSessions >= u.count;
        break;
      case 'sessions_type':
        isEarned = (stats.sessionsPerType[u.activity] ?? 0) >= u.count;
        break;
      case 'level':
        isEarned = stats.level >= u.level;
        break;
      case 'run_distance_single':
        isEarned = stats.maxSingleRunKm >= u.km;
        break;
      case 'run_distance_total':
        isEarned = stats.totalRunDistanceKm >= u.km;
        break;
      case 'steps_single_day':
        isEarned = stats.maxSingleDaySteps >= u.steps;
        break;
      case 'steps_total':
        isEarned = stats.totalSteps >= u.steps;
        break;
    }

    if (isEarned) earned.add(a.id);
  }

  return earned;
}

/**
 * Returns achievements with their earned state applied, sorted:
 * earned first (legendary → common), then locked (closest to unlock first).
 */
export type AchievementWithState = AchievementDef & { earned: boolean };

export function sortedAchievements(
  earnedIds: Set<string>,
): AchievementWithState[] {
  return ACHIEVEMENTS
    .map(a => ({ ...a, earned: earnedIds.has(a.id) }))
    .sort((a, b) => {
      if (a.unlock.type === 'level' && b.unlock.type === 'level') {
        return a.unlock.level - b.unlock.level;
      }
      return a.id.localeCompare(b.id);
    });
}

/**
 * POWR Achievement Library
 *
 * 66 achievements across 12 categories. Each has a typed unlock condition
 * that `computeEarnedIds()` evaluates against real user stats.
 *
 * Categories: habit · sessions · points · level · running · gym
 *             cycling · swimming · hiit · yoga · sports · walking
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

  // ── Habit / Streaks ──────────────────────────────────────────────────────

  {
    id: 'habit-streak-3',
    code: '3D',
    name: 'On a Roll',
    description: 'Maintain a 3-day active streak',
    category: 'habit',
    colour: '#f97316',
    icon: 'flame',
    rarity: 'common',
    unlock: { type: 'streak_current', days: 3 },
  },
  {
    id: 'habit-streak-7',
    code: '7D',
    name: 'First Week',
    description: 'Stay active every day for 7 days',
    category: 'habit',
    colour: '#f97316',
    icon: 'flame',
    rarity: 'common',
    unlock: { type: 'streak_current', days: 7 },
  },
  {
    id: 'habit-streak-14',
    code: '14D',
    name: 'Fortnight',
    description: 'Keep your streak going for 14 days',
    category: 'habit',
    colour: '#f97316',
    icon: 'flame',
    rarity: 'rare',
    unlock: { type: 'streak_current', days: 14 },
  },
  {
    id: 'habit-streak-30',
    code: '30D',
    name: 'Month Strong',
    description: 'Achieve a 30-day active streak',
    category: 'habit',
    colour: '#fb923c',
    icon: 'flame',
    rarity: 'rare',
    unlock: { type: 'streak_current', days: 30 },
  },
  {
    id: 'habit-streak-60',
    code: '60D',
    name: 'Iron Will',
    description: '60 consecutive active days',
    category: 'habit',
    colour: '#ef4444',
    icon: 'flame',
    rarity: 'epic',
    unlock: { type: 'streak_current', days: 60 },
  },
  {
    id: 'habit-streak-100',
    code: '100',
    name: 'Century',
    description: 'Reach a 100-day active streak',
    category: 'habit',
    colour: '#ef4444',
    icon: 'flame',
    rarity: 'epic',
    unlock: { type: 'streak_current', days: 100 },
  },
  {
    id: 'habit-streak-365',
    code: '365',
    name: 'Year of Fire',
    description: 'An entire year without missing a day',
    category: 'habit',
    colour: '#E8D200',
    icon: 'flame',
    rarity: 'legendary',
    unlock: { type: 'streak_current', days: 365 },
  },

  // ── Sessions Total ───────────────────────────────────────────────────────

  {
    id: 'sessions-1',
    code: '1ST',
    name: 'First Move',
    description: 'Complete your first workout session',
    category: 'sessions',
    colour: '#4ade80',
    icon: 'checkmark-circle',
    rarity: 'common',
    unlock: { type: 'sessions_total', count: 1 },
  },
  {
    id: 'sessions-10',
    code: '10',
    name: 'Ten Down',
    description: 'Log 10 total workout sessions',
    category: 'sessions',
    colour: '#4ade80',
    icon: 'checkmark-done',
    rarity: 'common',
    unlock: { type: 'sessions_total', count: 10 },
  },
  {
    id: 'sessions-25',
    code: '25',
    name: 'Regular',
    description: 'Complete 25 sessions across any activities',
    category: 'sessions',
    colour: '#4ade80',
    icon: 'checkmark-done',
    rarity: 'common',
    unlock: { type: 'sessions_total', count: 25 },
  },
  {
    id: 'sessions-50',
    code: '50',
    name: 'Fifty Strong',
    description: '50 sessions in the books',
    category: 'sessions',
    colour: '#22c55e',
    icon: 'stats-chart',
    rarity: 'rare',
    unlock: { type: 'sessions_total', count: 50 },
  },
  {
    id: 'sessions-100',
    code: '100',
    name: 'Century Club',
    description: 'Reach 100 lifetime sessions',
    category: 'sessions',
    colour: '#22c55e',
    icon: 'stats-chart',
    rarity: 'rare',
    unlock: { type: 'sessions_total', count: 100 },
  },
  {
    id: 'sessions-200',
    code: '200',
    name: 'Unstoppable',
    description: '200 sessions completed',
    category: 'sessions',
    colour: '#16a34a',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'sessions_total', count: 200 },
  },
  {
    id: 'sessions-365',
    code: '365',
    name: 'Year of Gains',
    description: 'Log 365 total sessions',
    category: 'sessions',
    colour: '#E8D200',
    icon: 'trophy',
    rarity: 'legendary',
    unlock: { type: 'sessions_total', count: 365 },
  },

  // ── Points Milestones ────────────────────────────────────────────────────

  {
    id: 'pts-100',
    code: '100',
    name: 'First Hundred',
    description: 'Earn 100 total POWR points',
    category: 'points',
    colour: '#E8D200',
    icon: 'star',
    rarity: 'common',
    unlock: { type: 'total_points', amount: 100 },
  },
  {
    id: 'pts-500',
    code: '500',
    name: 'Power Earner',
    description: 'Accumulate 500 POWR points',
    category: 'points',
    colour: '#E8D200',
    icon: 'star',
    rarity: 'common',
    unlock: { type: 'total_points', amount: 500 },
  },
  {
    id: 'pts-1k',
    code: '1K',
    name: '1K Club',
    description: 'Earn 1,000 total POWR points',
    category: 'points',
    colour: '#E8D200',
    icon: 'star',
    rarity: 'common',
    unlock: { type: 'total_points', amount: 1000 },
  },
  {
    id: 'pts-2500',
    code: '2.5K',
    name: 'On the Rise',
    description: 'Rack up 2,500 POWR points',
    category: 'points',
    colour: '#fbbf24',
    icon: 'trending-up',
    rarity: 'rare',
    unlock: { type: 'total_points', amount: 2500 },
  },
  {
    id: 'pts-5k',
    code: '5K',
    name: 'High Roller',
    description: '5,000 points earned',
    category: 'points',
    colour: '#fbbf24',
    icon: 'trending-up',
    rarity: 'rare',
    unlock: { type: 'total_points', amount: 5000 },
  },
  {
    id: 'pts-10k',
    code: '10K',
    name: 'Elite Earner',
    description: 'Earn 10,000 POWR points',
    category: 'points',
    colour: '#f59e0b',
    icon: 'diamond',
    rarity: 'epic',
    unlock: { type: 'total_points', amount: 10000 },
  },
  {
    id: 'pts-25k',
    code: '25K',
    name: 'Sovereign',
    description: 'Reach 25,000 POWR points',
    category: 'points',
    colour: '#f59e0b',
    icon: 'diamond',
    rarity: 'epic',
    unlock: { type: 'total_points', amount: 25000 },
  },
  {
    id: 'pts-50k',
    code: '50K',
    name: 'POWR Legend',
    description: '50,000 POWR points — truly elite',
    category: 'points',
    colour: '#E8D200',
    icon: 'diamond',
    rarity: 'legendary',
    unlock: { type: 'total_points', amount: 50000 },
  },

  // ── Level ────────────────────────────────────────────────────────────────

  {
    id: 'lvl-2',
    code: 'LV2',
    name: 'Mover',
    description: 'Reach Level 2: Mover',
    category: 'level',
    colour: '#4ade80',
    icon: 'ribbon',
    rarity: 'common',
    unlock: { type: 'level', level: 2 },
  },
  {
    id: 'lvl-3',
    code: 'LV3',
    name: 'Athlete',
    description: 'Reach Level 3: Athlete',
    category: 'level',
    colour: '#38bdf8',
    icon: 'ribbon',
    rarity: 'common',
    unlock: { type: 'level', level: 3 },
  },
  {
    id: 'lvl-4',
    code: 'LV4',
    name: 'Performer',
    description: 'Reach Level 4: Performer',
    category: 'level',
    colour: '#a855f7',
    icon: 'ribbon',
    rarity: 'rare',
    unlock: { type: 'level', level: 4 },
  },
  {
    id: 'lvl-5',
    code: 'LV5',
    name: 'Champion',
    description: 'Reach Level 5: Champion',
    category: 'level',
    colour: '#E8D200',
    icon: 'trophy',
    rarity: 'rare',
    unlock: { type: 'level', level: 5 },
  },
  {
    id: 'lvl-6',
    code: 'LV6',
    name: 'Elite',
    description: 'Reach Level 6: Elite',
    category: 'level',
    colour: '#f97316',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'level', level: 6 },
  },
  {
    id: 'lvl-7',
    code: 'LV7',
    name: 'Sovereign',
    description: 'Reach Level 7: Sovereign',
    category: 'level',
    colour: '#ef4444',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'level', level: 7 },
  },
  {
    id: 'lvl-8',
    code: 'LV8',
    name: 'Legend',
    description: 'The pinnacle. Reach Level 8: Legend',
    category: 'level',
    colour: '#E8D200',
    icon: 'medal',
    rarity: 'legendary',
    unlock: { type: 'level', level: 8 },
  },

  // ── Running ──────────────────────────────────────────────────────────────

  {
    id: 'run-first',
    code: 'RUN',
    name: 'First Run',
    description: 'Log your first running session',
    category: 'running',
    colour: '#38bdf8',
    icon: 'footsteps',
    rarity: 'common',
    unlock: { type: 'sessions_type', activity: 'running', count: 1 },
  },
  {
    id: 'run-5k',
    code: '5K',
    name: '5K Club',
    description: 'Run 5 km in a single session',
    category: 'running',
    colour: '#38bdf8',
    icon: 'speedometer',
    rarity: 'common',
    unlock: { type: 'run_distance_single', km: 5 },
  },
  {
    id: 'run-10k',
    code: '10K',
    name: '10K Club',
    description: 'Run 10 km without stopping',
    category: 'running',
    colour: '#0ea5e9',
    icon: 'speedometer',
    rarity: 'rare',
    unlock: { type: 'run_distance_single', km: 10 },
  },
  {
    id: 'run-hm',
    code: 'HM',
    name: 'Half Marathon',
    description: 'Complete a 21.1 km run in one session',
    category: 'running',
    colour: '#0284c7',
    icon: 'map',
    rarity: 'epic',
    unlock: { type: 'run_distance_single', km: 21.1 },
  },
  {
    id: 'run-marathon',
    code: '42K',
    name: 'Marathoner',
    description: 'Run the full 42.2 km marathon distance',
    category: 'running',
    colour: '#E8D200',
    icon: 'medal',
    rarity: 'legendary',
    unlock: { type: 'run_distance_single', km: 42.2 },
  },
  {
    id: 'run-10-sessions',
    code: '×10',
    name: 'Runner',
    description: 'Complete 10 running sessions',
    category: 'running',
    colour: '#38bdf8',
    icon: 'repeat',
    rarity: 'common',
    unlock: { type: 'sessions_type', activity: 'running', count: 10 },
  },
  {
    id: 'run-25-sessions',
    code: '×25',
    name: 'Road Runner',
    description: '25 running sessions logged',
    category: 'running',
    colour: '#0ea5e9',
    icon: 'repeat',
    rarity: 'rare',
    unlock: { type: 'sessions_type', activity: 'running', count: 25 },
  },
  {
    id: 'run-50-sessions',
    code: '×50',
    name: 'Run Addict',
    description: '50 running sessions completed',
    category: 'running',
    colour: '#0284c7',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'sessions_type', activity: 'running', count: 50 },
  },
  {
    id: 'run-100k-total',
    code: '100K',
    name: '100K Milestone',
    description: 'Run 100 km total across all sessions',
    category: 'running',
    colour: '#0ea5e9',
    icon: 'trail-sign',
    rarity: 'rare',
    unlock: { type: 'run_distance_total', km: 100 },
  },
  {
    id: 'run-500k-total',
    code: '500K',
    name: 'Road Warrior',
    description: 'Accumulate 500 km total running distance',
    category: 'running',
    colour: '#E8D200',
    icon: 'trail-sign',
    rarity: 'legendary',
    unlock: { type: 'run_distance_total', km: 500 },
  },

  // ── Gym ──────────────────────────────────────────────────────────────────

  {
    id: 'gym-first',
    code: 'GYM',
    name: 'First Pump',
    description: 'Check in at a gym for the first time',
    category: 'gym',
    colour: '#E8D200',
    icon: 'barbell',
    rarity: 'common',
    unlock: { type: 'sessions_type', activity: 'gym', count: 1 },
  },
  {
    id: 'gym-10',
    code: '×10',
    name: 'Gym Regular',
    description: 'Log 10 gym sessions',
    category: 'gym',
    colour: '#E8D200',
    icon: 'barbell',
    rarity: 'common',
    unlock: { type: 'sessions_type', activity: 'gym', count: 10 },
  },
  {
    id: 'gym-25',
    code: '×25',
    name: 'Gym Rat',
    description: '25 gym sessions — you live here now',
    category: 'gym',
    colour: '#fbbf24',
    icon: 'barbell',
    rarity: 'rare',
    unlock: { type: 'sessions_type', activity: 'gym', count: 25 },
  },
  {
    id: 'gym-50',
    code: '×50',
    name: 'Iron Addict',
    description: '50 gym sessions done',
    category: 'gym',
    colour: '#f59e0b',
    icon: 'fitness',
    rarity: 'epic',
    unlock: { type: 'sessions_type', activity: 'gym', count: 50 },
  },
  {
    id: 'gym-100',
    code: '×100',
    name: 'Gym Legend',
    description: '100 gym sessions — you are the gym',
    category: 'gym',
    colour: '#E8D200',
    icon: 'trophy',
    rarity: 'legendary',
    unlock: { type: 'sessions_type', activity: 'gym', count: 100 },
  },

  // ── Cycling ──────────────────────────────────────────────────────────────

  {
    id: 'cycle-first',
    code: 'RIDE',
    name: 'First Ride',
    description: 'Log your first cycling session',
    category: 'cycling',
    colour: '#a855f7',
    icon: 'bicycle',
    rarity: 'common',
    unlock: { type: 'sessions_type', activity: 'cycling', count: 1 },
  },
  {
    id: 'cycle-10',
    code: '×10',
    name: 'Cyclist',
    description: 'Complete 10 cycling sessions',
    category: 'cycling',
    colour: '#a855f7',
    icon: 'bicycle',
    rarity: 'rare',
    unlock: { type: 'sessions_type', activity: 'cycling', count: 10 },
  },
  {
    id: 'cycle-25',
    code: '×25',
    name: 'Road Rider',
    description: '25 cycling sessions logged',
    category: 'cycling',
    colour: '#9333ea',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'sessions_type', activity: 'cycling', count: 25 },
  },
  {
    id: 'cycle-50',
    code: '×50',
    name: 'Iron Cyclist',
    description: '50 cycling sessions — the road is your home',
    category: 'cycling',
    colour: '#E8D200',
    icon: 'trophy',
    rarity: 'legendary',
    unlock: { type: 'sessions_type', activity: 'cycling', count: 50 },
  },

  // ── Swimming ──────────────────────────────────────────────────────────────

  {
    id: 'swim-first',
    code: 'SWIM',
    name: 'First Lap',
    description: 'Complete your first swim session',
    category: 'swimming',
    colour: '#06b6d4',
    icon: 'water',
    rarity: 'common',
    unlock: { type: 'sessions_type', activity: 'swimming', count: 1 },
  },
  {
    id: 'swim-10',
    code: '×10',
    name: 'Swimmer',
    description: '10 swim sessions in the pool',
    category: 'swimming',
    colour: '#06b6d4',
    icon: 'water',
    rarity: 'rare',
    unlock: { type: 'sessions_type', activity: 'swimming', count: 10 },
  },
  {
    id: 'swim-25',
    code: '×25',
    name: 'Pool Regular',
    description: '25 swim sessions logged',
    category: 'swimming',
    colour: '#0891b2',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'sessions_type', activity: 'swimming', count: 25 },
  },
  {
    id: 'swim-50',
    code: '×50',
    name: 'Aquatic',
    description: '50 swim sessions — you belong in the water',
    category: 'swimming',
    colour: '#E8D200',
    icon: 'trophy',
    rarity: 'legendary',
    unlock: { type: 'sessions_type', activity: 'swimming', count: 50 },
  },

  // ── HIIT ──────────────────────────────────────────────────────────────────

  {
    id: 'hiit-first',
    code: 'HIIT',
    name: 'First Burn',
    description: 'Survive your first HIIT session',
    category: 'hiit',
    colour: '#ef4444',
    icon: 'flash',
    rarity: 'common',
    unlock: { type: 'sessions_type', activity: 'hiit', count: 1 },
  },
  {
    id: 'hiit-10',
    code: '×10',
    name: 'HIIT Habit',
    description: 'Complete 10 HIIT sessions',
    category: 'hiit',
    colour: '#ef4444',
    icon: 'flash',
    rarity: 'rare',
    unlock: { type: 'sessions_type', activity: 'hiit', count: 10 },
  },
  {
    id: 'hiit-25',
    code: '×25',
    name: 'HIIT Master',
    description: '25 HIIT sessions — you thrive in the burn',
    category: 'hiit',
    colour: '#dc2626',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'sessions_type', activity: 'hiit', count: 25 },
  },
  {
    id: 'hiit-50',
    code: '×50',
    name: 'Intensity King',
    description: '50 HIIT sessions: unmatched intensity',
    category: 'hiit',
    colour: '#E8D200',
    icon: 'trophy',
    rarity: 'legendary',
    unlock: { type: 'sessions_type', activity: 'hiit', count: 50 },
  },

  // ── Yoga / Pilates ───────────────────────────────────────────────────────

  {
    id: 'yoga-first',
    code: 'YOGA',
    name: 'First Flow',
    description: 'Complete your first yoga or pilates session',
    category: 'yoga',
    colour: '#c084fc',
    icon: 'leaf',
    rarity: 'common',
    unlock: { type: 'sessions_type', activity: 'yoga', count: 1 },
  },
  {
    id: 'yoga-10',
    code: '×10',
    name: 'Yogi',
    description: '10 yoga or pilates sessions logged',
    category: 'yoga',
    colour: '#c084fc',
    icon: 'leaf',
    rarity: 'rare',
    unlock: { type: 'sessions_type', activity: 'yoga', count: 10 },
  },
  {
    id: 'yoga-25',
    code: '×25',
    name: 'Zen Regular',
    description: '25 mindful movement sessions',
    category: 'yoga',
    colour: '#a855f7',
    icon: 'flower',
    rarity: 'epic',
    unlock: { type: 'sessions_type', activity: 'yoga', count: 25 },
  },
  {
    id: 'yoga-50',
    code: '×50',
    name: 'Zen Master',
    description: '50 yoga sessions — inner and outer strength',
    category: 'yoga',
    colour: '#E8D200',
    icon: 'flower',
    rarity: 'legendary',
    unlock: { type: 'sessions_type', activity: 'yoga', count: 50 },
  },

  // ── Sports ───────────────────────────────────────────────────────────────

  {
    id: 'sports-first',
    code: 'PLAY',
    name: 'In the Game',
    description: 'Log your first sports session',
    category: 'sports',
    colour: '#4ade80',
    icon: 'football',
    rarity: 'common',
    unlock: { type: 'sessions_type', activity: 'sports', count: 1 },
  },
  {
    id: 'sports-10',
    code: '×10',
    name: 'Team Player',
    description: 'Complete 10 sports sessions',
    category: 'sports',
    colour: '#22c55e',
    icon: 'people',
    rarity: 'rare',
    unlock: { type: 'sessions_type', activity: 'sports', count: 10 },
  },
  {
    id: 'sports-25',
    code: '×25',
    name: 'Sports Regular',
    description: '25 sports sessions — game on',
    category: 'sports',
    colour: '#E8D200',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'sessions_type', activity: 'sports', count: 25 },
  },

  // ── Walking / Steps ──────────────────────────────────────────────────────

  {
    id: 'steps-10k-day',
    code: '10K',
    name: '10K Steps',
    description: 'Walk 10,000 steps in a single day',
    category: 'walking',
    colour: '#6ee7b7',
    icon: 'footsteps',
    rarity: 'common',
    unlock: { type: 'steps_single_day', steps: 10000 },
  },
  {
    id: 'steps-20k-day',
    code: '20K',
    name: 'Step Machine',
    description: 'Clock 20,000 steps in one day',
    category: 'walking',
    colour: '#34d399',
    icon: 'footsteps',
    rarity: 'rare',
    unlock: { type: 'steps_single_day', steps: 20000 },
  },
  {
    id: 'steps-100k-total',
    code: '100K',
    name: 'Walker',
    description: 'Accumulate 100,000 total steps',
    category: 'walking',
    colour: '#10b981',
    icon: 'trending-up',
    rarity: 'rare',
    unlock: { type: 'steps_total', steps: 100000 },
  },
  {
    id: 'steps-1m-total',
    code: '1M',
    name: 'Million Steps',
    description: 'One million steps — an extraordinary journey',
    category: 'walking',
    colour: '#E8D200',
    icon: 'medal',
    rarity: 'legendary',
    unlock: { type: 'steps_total', steps: 1000000 },
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
  const RARITY_ORDER: Record<AchievementRarity, number> = {
    legendary: 4,
    epic: 3,
    rare: 2,
    common: 1,
  };

  return ACHIEVEMENTS
    .map(a => ({ ...a, earned: earnedIds.has(a.id) }))
    .sort((a, b) => {
      if (a.earned !== b.earned) return a.earned ? -1 : 1;
      return RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity];
    });
}

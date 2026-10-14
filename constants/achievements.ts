/**
 * POWR Achievement Library
 *
 * 20 achievements focused on level progression. Each has a typed unlock condition
 * that `computeEarnedIds()` evaluates against real user stats.
 *
 * Category: level
 *
 * Names, descriptions and the category and rarity labels are getters that read
 * the points catalog when they're used, so they follow the language on screen.
 * A level milestone's name IS the level's name (points:levels.*), so the badge
 * and the level always agree. Display only: logic keys off `id`, `category` and
 * `unlock`. (Spreading an achievement — sortedAchievements — copies the text in
 * the language of that moment.)
 */

import i18n from '@/lib/i18n';

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
  habit:    { get label() { return i18n.t('points:achievements.category.habit'); }, colour: '#f97316', icon: 'flame-outline' },
  sessions: { get label() { return i18n.t('points:achievements.category.sessions'); }, colour: '#4ade80', icon: 'checkmark-done-outline' },
  points:   { get label() { return i18n.t('points:achievements.category.points'); }, colour: '#E8D200', icon: 'star-outline' },
  level:    { get label() { return i18n.t('points:achievements.category.level'); }, colour: '#E8D200', icon: 'ribbon-outline' },
  running:  { get label() { return i18n.t('points:achievements.category.running'); }, colour: '#38bdf8', icon: 'speedometer-outline' },
  gym:      { get label() { return i18n.t('points:achievements.category.gym'); }, colour: '#E8D200', icon: 'barbell-outline' },
  cycling:  { get label() { return i18n.t('points:achievements.category.cycling'); }, colour: '#a855f7', icon: 'bicycle-outline' },
  swimming: { get label() { return i18n.t('points:achievements.category.swimming'); }, colour: '#06b6d4', icon: 'water-outline' },
  hiit:     { get label() { return i18n.t('points:achievements.category.hiit'); }, colour: '#ef4444', icon: 'flash-outline' },
  yoga:     { get label() { return i18n.t('points:achievements.category.yoga'); }, colour: '#c084fc', icon: 'leaf-outline' },
  sports:   { get label() { return i18n.t('points:achievements.category.sports'); }, colour: '#4ade80', icon: 'football-outline' },
  walking:  { get label() { return i18n.t('points:achievements.category.walking'); }, colour: '#6ee7b7', icon: 'footsteps-outline' },
};

// ─── Achievement Library ──────────────────────────────────────────────────────

export const ACHIEVEMENTS: AchievementDef[] = [
  // ── Level progression milestones ─────────────────────────────────────────

  {
    id: 'lvl-1',
    code: 'LV1',
    get name() { return i18n.t('points:levels.touchingGrass.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 1, name: i18n.t('points:levels.touchingGrass.name') }); },
    category: 'level',
    colour: '#4ade80',
    icon: 'ribbon',
    rarity: 'common',
    unlock: { type: 'level', level: 1 },
  },
  {
    id: 'lvl-2',
    code: 'LV2',
    get name() { return i18n.t('points:levels.cardioGoblin.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 2, name: i18n.t('points:levels.cardioGoblin.name') }); },
    category: 'level',
    colour: '#4ade80',
    icon: 'ribbon',
    rarity: 'common',
    unlock: { type: 'level', level: 2 },
  },
  {
    id: 'lvl-3',
    code: 'LV3',
    get name() { return i18n.t('points:levels.streakFreak.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 3, name: i18n.t('points:levels.streakFreak.name') }); },
    category: 'level',
    colour: '#38bdf8',
    icon: 'ribbon',
    rarity: 'common',
    unlock: { type: 'level', level: 3 },
  },
  {
    id: 'lvl-4',
    code: 'LV4',
    get name() { return i18n.t('points:levels.motionMagic.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 4, name: i18n.t('points:levels.motionMagic.name') }); },
    category: 'level',
    colour: '#a855f7',
    icon: 'ribbon',
    rarity: 'common',
    unlock: { type: 'level', level: 4 },
  },
  {
    id: 'lvl-5',
    code: 'LV5',
    get name() { return i18n.t('points:levels.heavyHitter.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 5, name: i18n.t('points:levels.heavyHitter.name') }); },
    category: 'level',
    colour: '#E8D200',
    icon: 'trophy',
    rarity: 'common',
    unlock: { type: 'level', level: 5 },
  },
  {
    id: 'lvl-6',
    code: 'LV6',
    get name() { return i18n.t('points:levels.cantSitStill.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 6, name: i18n.t('points:levels.cantSitStill.name') }); },
    category: 'level',
    colour: '#f97316',
    icon: 'trophy',
    rarity: 'rare',
    unlock: { type: 'level', level: 6 },
  },
  {
    id: 'lvl-7',
    code: 'LV7',
    get name() { return i18n.t('points:levels.ironLungs.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 7, name: i18n.t('points:levels.ironLungs.name') }); },
    category: 'level',
    colour: '#ef4444',
    icon: 'trophy',
    rarity: 'rare',
    unlock: { type: 'level', level: 7 },
  },
  {
    id: 'lvl-8',
    code: 'LV8',
    get name() { return i18n.t('points:levels.pavementPredator.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 8, name: i18n.t('points:levels.pavementPredator.name') }); },
    category: 'level',
    colour: '#E8D200',
    icon: 'ribbon',
    rarity: 'rare',
    unlock: { type: 'level', level: 8 },
  },
  {
    id: 'lvl-9',
    code: 'LV9',
    get name() { return i18n.t('points:levels.stepCollector.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 9, name: i18n.t('points:levels.stepCollector.name') }); },
    category: 'level',
    colour: '#22c55e',
    icon: 'ribbon',
    rarity: 'rare',
    unlock: { type: 'level', level: 9 },
  },
  {
    id: 'lvl-10',
    code: 'LV10',
    get name() { return i18n.t('points:levels.calorieCriminal.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 10, name: i18n.t('points:levels.calorieCriminal.name') }); },
    category: 'level',
    colour: '#0ea5e9',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'level', level: 10 },
  },
  {
    id: 'lvl-11',
    code: 'LV11',
    get name() { return i18n.t('points:levels.mileMuncher.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 11, name: i18n.t('points:levels.mileMuncher.name') }); },
    category: 'level',
    colour: '#06b6d4',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'level', level: 11 },
  },
  {
    id: 'lvl-12',
    code: 'LV12',
    get name() { return i18n.t('points:levels.moveMachine.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 12, name: i18n.t('points:levels.moveMachine.name') }); },
    category: 'level',
    colour: '#a855f7',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'level', level: 12 },
  },
  {
    id: 'lvl-13',
    code: 'LV13',
    get name() { return i18n.t('points:levels.needNewShoes.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 13, name: i18n.t('points:levels.needNewShoes.name') }); },
    category: 'level',
    colour: '#ef4444',
    icon: 'trophy',
    rarity: 'epic',
    unlock: { type: 'level', level: 13 },
  },
  {
    id: 'lvl-14',
    code: 'LV14',
    get name() { return i18n.t('points:levels.certifiedWeapon.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 14, name: i18n.t('points:levels.certifiedWeapon.name') }); },
    category: 'level',
    colour: '#f59e0b',
    icon: 'medal',
    rarity: 'epic',
    unlock: { type: 'level', level: 14 },
  },
  {
    id: 'lvl-15',
    code: 'LV15',
    get name() { return i18n.t('points:levels.momentumMonster.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 15, name: i18n.t('points:levels.momentumMonster.name') }); },
    category: 'level',
    colour: '#f97316',
    icon: 'shield-checkmark',
    rarity: 'legendary',
    unlock: { type: 'level', level: 15 },
  },
  {
    id: 'lvl-16',
    code: 'LV16',
    get name() { return i18n.t('points:levels.limitBreaker.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 16, name: i18n.t('points:levels.limitBreaker.name') }); },
    category: 'level',
    colour: '#f43f5e',
    icon: 'medal',
    rarity: 'legendary',
    unlock: { type: 'level', level: 16 },
  },
  {
    id: 'lvl-17',
    code: 'LV17',
    get name() { return i18n.t('points:levels.dieselMode.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 17, name: i18n.t('points:levels.dieselMode.name') }); },
    category: 'level',
    colour: '#E8D200',
    icon: 'medal',
    rarity: 'legendary',
    unlock: { type: 'level', level: 17 },
  },
  {
    id: 'lvl-18',
    code: 'LV18',
    get name() { return i18n.t('points:levels.peakCondition.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 18, name: i18n.t('points:levels.peakCondition.name') }); },
    category: 'level',
    colour: '#22d3ee',
    icon: 'diamond',
    rarity: 'legendary',
    unlock: { type: 'level', level: 18 },
  },
  {
    id: 'lvl-19',
    code: 'LV19',
    get name() { return i18n.t('points:levels.longHauler.name'); },
    get description() { return i18n.t('points:achievements.reachLevel', { level: 19, name: i18n.t('points:levels.longHauler.name') }); },
    category: 'level',
    colour: '#d946ef',
    icon: 'diamond',
    rarity: 'legendary',
    unlock: { type: 'level', level: 19 },
  },
  {
    id: 'lvl-20',
    code: 'LV20',
    get name() { return i18n.t('points:levels.goggins.name'); },
    get description() { return i18n.t('points:achievements.summit', { level: 20, name: i18n.t('points:levels.goggins.name') }); },
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
  common:    { get label() { return i18n.t('points:achievements.rarity.common'); },    border: 'rgba(255,255,255,0.15)', glow: 'transparent' },
  rare:      { get label() { return i18n.t('points:achievements.rarity.rare'); },      border: 'rgba(56,189,248,0.5)',   glow: 'rgba(56,189,248,0.12)' },
  epic:      { get label() { return i18n.t('points:achievements.rarity.epic'); },      border: 'rgba(168,85,247,0.6)',   glow: 'rgba(168,85,247,0.15)' },
  legendary: { get label() { return i18n.t('points:achievements.rarity.legendary'); }, border: 'rgba(232,210,0,0.7)',    glow: 'rgba(232,210,0,0.18)' },
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

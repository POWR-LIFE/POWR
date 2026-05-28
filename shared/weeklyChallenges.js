/**
 * Weekly-challenge CATALOG + weekly rotation. PURE, dependency-free (ESM).
 *
 * 57 challenges across 5 categories (gym/walking/running/cycling/multi), each
 * Easy/Medium/Hard with fixed points and a declarative `rule` (see
 * ./challengeRules.js for the evaluator). Each week the rotation surfaces ONE
 * challenge per category (5 active total), advancing by ISO-week.
 *
 * Source of truth. Mirrored (catalog + evaluator) into
 * supabase/functions/_shared/challenges.js for the edge function — keep in sync.
 */

// ── Category presentation metadata (used by the home card) ──────────────────
export const CATEGORY_META = {
  gym:     { label: 'Gym',     icon: { lib: 'ion', name: 'barbell' } },
  walking: { label: 'Walking', icon: { lib: 'ion', name: 'walk' } },
  running: { label: 'Running', icon: { lib: 'mc', name: 'run' } },
  cycling: { label: 'Cycling', icon: { lib: 'ion', name: 'bicycle' } },
  multi:   { label: 'All',     icon: { lib: 'ion', name: 'flame' } },
};

export const CATEGORY_ORDER = ['gym', 'walking', 'running', 'cycling', 'multi'];

// Day-of-week constants (0=Mon … 6=Sun) to keep rules readable.
const MON = 0, TUE = 1, WED = 2, SAT = 5, SUN = 6;

// ── The catalog ─────────────────────────────────────────────────────────────
// `supported:false` => never selected by the rotation (data not yet available).
export const CATALOG = [
  // ───────────── GYM ─────────────
  { id: 'gym-show-up',       category: 'gym', tier: 'easy',   title: 'Show Up',        description: 'Check in 2 times this week.',                         points: 20, rule: { kind: 'session_count', category: 'gym', target: 2 } },
  { id: 'gym-back-again',    category: 'gym', tier: 'easy',   title: 'Back Again',     description: 'Check in 3 times this week.',                         points: 25, rule: { kind: 'session_count', category: 'gym', target: 3 } },
  { id: 'gym-midweek-move',  category: 'gym', tier: 'easy',   title: 'Midweek Move',   description: 'Check in at least once between Monday and Wednesday.', points: 15, rule: { kind: 'session_count', category: 'gym', dayOfWeek: [MON, TUE, WED], target: 1 } },
  { id: 'gym-weekend',       category: 'gym', tier: 'easy',   title: 'Weekend Warrior', description: 'Check in on a Saturday or Sunday this week.',         points: 15, rule: { kind: 'session_count', category: 'gym', dayOfWeek: [SAT, SUN], target: 1 } },
  { id: 'gym-4-from-7',      category: 'gym', tier: 'medium', title: '4 From 7',       description: 'Check in 4 times this week.',                         points: 40, rule: { kind: 'session_count', category: 'gym', target: 4 } },
  { id: 'gym-early-doors',   category: 'gym', tier: 'medium', title: 'Early Doors',    description: 'Check in before 8am, 3 times this week.',             points: 40, rule: { kind: 'session_count', category: 'gym', beforeHour: 8, target: 3 } },
  { id: 'gym-lunchtime',     category: 'gym', tier: 'medium', title: 'Lunchtime Grind', description: 'Check in between 12pm and 2pm, 3 times this week.',   points: 40, rule: { kind: 'session_count', category: 'gym', hourWindow: [12, 14], target: 3 } },
  { id: 'gym-no-days-off',   category: 'gym', tier: 'medium', title: 'No Days Off',    description: 'Check in 5 times this week.',                         points: 50, rule: { kind: 'session_count', category: 'gym', target: 5 } },
  { id: 'gym-perfect-week',  category: 'gym', tier: 'hard',   title: 'Perfect Week',   description: 'Check in every day for 7 consecutive days.',          points: 75, rule: { kind: 'distinct_days', category: 'gym', target: 7 } },
  { id: 'gym-double-day',    category: 'gym', tier: 'hard',   title: 'Double Day',     description: 'Check in twice in one day, 2 times this week.',       points: 70, supported: false, rule: { kind: 'same_day_count', category: 'gym', perDay: 2, target: 2 } },
  { id: 'gym-5am-club',      category: 'gym', tier: 'hard',   title: '5am Club',       description: 'Check in before 6am, 3 times this week.',             points: 75, rule: { kind: 'session_count', category: 'gym', beforeHour: 6, target: 3 } },
  { id: 'gym-six-pack',      category: 'gym', tier: 'hard',   title: 'Six Pack Week',  description: 'Check in 6 times this week.',                         points: 80, rule: { kind: 'session_count', category: 'gym', target: 6 } },

  // ───────────── WALKING ─────────────
  { id: 'walk-first-steps',  category: 'walking', tier: 'easy',   title: 'First Steps',  description: 'Hit 5,000 steps in a single day this week.',          points: 15, rule: { kind: 'daily_metric_days', threshold: 5000, target: 1 } },
  { id: 'walk-daily-mover',  category: 'walking', tier: 'easy',   title: 'Daily Mover',  description: 'Hit 7,000 steps a day, 3 days this week.',            points: 20, rule: { kind: 'daily_metric_days', threshold: 7000, target: 3 } },
  { id: 'walk-lunch-walk',   category: 'walking', tier: 'easy',   title: 'Lunch Walk',   description: 'Log 2,000 steps between 12pm and 2pm, 3 times this week.', points: 15, rule: { kind: 'step_window', window: 'midday', threshold: 2000, target: 3 } },
  { id: 'walk-evening',      category: 'walking', tier: 'easy',   title: 'Evening Stroll', description: 'Log 3,000 steps after 6pm, 3 times this week.',     points: 15, rule: { kind: 'step_window', window: 'evening', threshold: 3000, target: 3 } },
  { id: 'walk-10k-days',     category: 'walking', tier: 'medium', title: '10K Days',     description: 'Hit 10,000 steps a day, 4 days this week.',           points: 40, rule: { kind: 'daily_metric_days', threshold: 10000, target: 4 } },
  { id: 'walk-30k-weekend',  category: 'walking', tier: 'medium', title: '30K Weekend',  description: 'Log 30,000 steps across Saturday and Sunday.',        points: 40, rule: { kind: 'weekend_sum', metric: 'steps', target: 30000 } },
  { id: 'walk-morning',      category: 'walking', tier: 'medium', title: 'Morning Walker', description: 'Log 3,000 steps before 9am, 4 times this week.',    points: 35, rule: { kind: 'step_window', window: 'morning', threshold: 3000, target: 4 } },
  { id: 'walk-35k-week',     category: 'walking', tier: 'medium', title: '35K Week',     description: 'Hit 35,000 steps across the week.',                   points: 45, rule: { kind: 'weekly_sum', metric: 'steps', target: 35000 } },
  { id: 'walk-50k-week',     category: 'walking', tier: 'hard',   title: '50K Week',     description: 'Hit 50,000 steps across the week.',                   points: 65, rule: { kind: 'weekly_sum', metric: 'steps', target: 50000 } },
  { id: 'walk-10k-everyday', category: 'walking', tier: 'hard',   title: '10K Every Day', description: 'Hit 10,000 steps every day for 7 days.',            points: 75, rule: { kind: 'daily_metric_days', threshold: 10000, target: 7 } },
  { id: 'walk-big-day',      category: 'walking', tier: 'hard',   title: 'Big Saturday', description: 'Log 20,000 steps in a single day.',                  points: 60, rule: { kind: 'daily_metric_days', threshold: 20000, target: 1 } },
  { id: 'walk-70k-week',     category: 'walking', tier: 'hard',   title: '70K Week',     description: 'Hit 70,000 steps across the week.',                   points: 80, rule: { kind: 'weekly_sum', metric: 'steps', target: 70000 } },

  // ───────────── RUNNING ─────────────
  { id: 'run-just-run',      category: 'running', tier: 'easy',   title: 'Just Run',     description: 'Log 1 run of any distance this week.',                points: 15, rule: { kind: 'session_count', category: 'running', target: 1 } },
  { id: 'run-3km',           category: 'running', tier: 'easy',   title: '3km Run',      description: 'Complete a single run of 3km or more.',               points: 20, rule: { kind: 'count_with_min_metric', category: 'running', metric: 'distance_m', threshold: 3000, target: 1 } },
  { id: 'run-twice',         category: 'running', tier: 'easy',   title: 'Twice This Week', description: 'Log 2 runs this week, any distance.',              points: 20, rule: { kind: 'session_count', category: 'running', target: 2 } },
  { id: 'run-5km-total',     category: 'running', tier: 'easy',   title: '5km Total',    description: 'Log 5km of running across the week.',                 points: 20, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'running', target: 5000 } },
  { id: 'run-3-runs-10km',   category: 'running', tier: 'medium', title: '3 Runs This Week', description: 'Log 3 runs totalling at least 10km.',              points: 40, rule: { kind: 'count_and_sum', category: 'running', metric: 'distance_m', target: 3, min: 10000 } },
  { id: 'run-5k-x3',         category: 'running', tier: 'medium', title: '5K Three Times', description: 'Run 5km or more, 3 times this week.',               points: 45, rule: { kind: 'count_with_min_metric', category: 'running', metric: 'distance_m', threshold: 5000, target: 3 } },
  { id: 'run-20k-week',      category: 'running', tier: 'medium', title: '20K Week',     description: 'Log 20km of running across the week.',                points: 40, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'running', target: 20000 } },
  { id: 'run-every-other',   category: 'running', tier: 'medium', title: 'Run Every Other Day', description: '4 runs this week with at least 1 rest day between each.', points: 50, rule: { kind: 'spaced_days', category: 'running', minGapDays: 1, target: 4 } },
  { id: 'run-long-one',      category: 'running', tier: 'hard',   title: 'Long One',     description: 'Complete a single run of 10km or more.',              points: 60, rule: { kind: 'count_with_min_metric', category: 'running', metric: 'distance_m', threshold: 10000, target: 1 } },
  { id: 'run-half-week',     category: 'running', tier: 'hard',   title: 'Half Marathon Week', description: 'Log 21km of running across the week.',             points: 70, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'running', target: 21000 } },
  { id: 'run-5-runs',        category: 'running', tier: 'hard',   title: '5 Runs This Week', description: 'Log 5 runs of any distance this week.',            points: 65, rule: { kind: 'session_count', category: 'running', target: 5 } },
  { id: 'run-30k-week',      category: 'running', tier: 'hard',   title: '30K Week',     description: 'Log 30km of running across the week.',                points: 75, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'running', target: 30000 } },

  // ───────────── CYCLING ─────────────
  { id: 'cycle-first-ride',  category: 'cycling', tier: 'easy',   title: 'First Ride',   description: 'Log 1 ride of any distance this week.',               points: 15, rule: { kind: 'session_count', category: 'cycling', target: 1 } },
  { id: 'cycle-10km',        category: 'cycling', tier: 'easy',   title: '10km Ride',    description: 'Complete a single ride of 10km or more.',             points: 20, rule: { kind: 'count_with_min_metric', category: 'cycling', metric: 'distance_m', threshold: 10000, target: 1 } },
  { id: 'cycle-twice',       category: 'cycling', tier: 'easy',   title: 'Twice This Week', description: 'Log 2 rides this week, any distance.',             points: 20, rule: { kind: 'session_count', category: 'cycling', target: 2 } },
  { id: 'cycle-20km-total',  category: 'cycling', tier: 'easy',   title: '20km Total',   description: 'Log 20km of cycling across the week.',                points: 20, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'cycling', target: 20000 } },
  { id: 'cycle-commuter',    category: 'cycling', tier: 'medium', title: 'Commuter',     description: 'Cycle 3 times this week, any distance.',              points: 35, rule: { kind: 'session_count', category: 'cycling', target: 3 } },
  { id: 'cycle-50km-week',   category: 'cycling', tier: 'medium', title: '50km Week',    description: 'Log 50km of cycling across the week.',                points: 40, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'cycling', target: 50000 } },
  { id: 'cycle-25km',        category: 'cycling', tier: 'medium', title: '25km Ride',    description: 'Complete a single ride of 25km or more.',             points: 40, rule: { kind: 'count_with_min_metric', category: 'cycling', metric: 'distance_m', threshold: 25000, target: 1 } },
  { id: 'cycle-4-rides',     category: 'cycling', tier: 'medium', title: '4 Rides This Week', description: 'Log 4 rides of any distance this week.',           points: 45, rule: { kind: 'session_count', category: 'cycling', target: 4 } },
  { id: 'cycle-50km-ride',   category: 'cycling', tier: 'hard',   title: '50km Ride',    description: 'Complete a single ride of 50km or more.',             points: 65, rule: { kind: 'count_with_min_metric', category: 'cycling', metric: 'distance_m', threshold: 50000, target: 1 } },
  { id: 'cycle-100km-week',  category: 'cycling', tier: 'hard',   title: '100km Week',   description: 'Log 100km of cycling across the week.',               points: 75, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'cycling', target: 100000 } },
  { id: 'cycle-5-rides',     category: 'cycling', tier: 'hard',   title: '5 Rides This Week', description: 'Log 5 rides this week, any distance.',             points: 65, rule: { kind: 'session_count', category: 'cycling', target: 5 } },
  { id: 'cycle-century-prep', category: 'cycling', tier: 'hard',  title: 'Century Prep', description: 'Complete a single ride of 80km or more.',             points: 80, rule: { kind: 'count_with_min_metric', category: 'cycling', metric: 'distance_m', threshold: 80000, target: 1 } },

  // ───────────── MULTI ─────────────
  { id: 'multi-mix-it-up',   category: 'multi', tier: 'easy',   title: 'Mix It Up',      description: 'Log activity in 2 different categories this week.',   points: 25, rule: { kind: 'distinct_categories', perCat: 1, target: 2 } },
  { id: 'multi-gym-and-go',  category: 'multi', tier: 'easy',   title: 'Gym and Go',     description: 'Check in to the gym and log a walk or run on the same day.', points: 25, rule: { kind: 'same_day_combo', a: 'gym', b: ['walking', 'running'], target: 1 } },
  { id: 'multi-3-types',     category: 'multi', tier: 'easy',   title: '3 Activity Types', description: 'Log at least 1 session in 3 different categories this week.', points: 30, rule: { kind: 'distinct_categories', perCat: 1, target: 3 } },
  { id: 'multi-triple',      category: 'multi', tier: 'medium', title: 'Triple Threat',  description: 'Log 2 sessions in 3 different categories this week.', points: 50, rule: { kind: 'distinct_categories', perCat: 2, target: 3 } },
  { id: 'multi-gym-and-run', category: 'multi', tier: 'medium', title: 'Gym and Run',    description: 'Check in to the gym and log a run on the same day, twice this week.', points: 50, rule: { kind: 'same_day_combo', a: 'gym', b: ['running'], target: 2 } },
  { id: 'multi-5-days',      category: 'multi', tier: 'medium', title: '5 Days Active',  description: 'Log at least 1 activity of any kind, 5 days this week.', points: 45, rule: { kind: 'distinct_days', target: 5 } },
  { id: 'multi-everyday',    category: 'multi', tier: 'hard',   title: 'Active Every Day', description: 'Log at least 1 activity every day for 7 days.',     points: 80, rule: { kind: 'distinct_days', target: 7 } },
  { id: 'multi-all-four',    category: 'multi', tier: 'hard',   title: 'All Four',       description: 'Log at least 1 session in all 4 categories this week.', points: 85, rule: { kind: 'distinct_categories', perCat: 1, target: 4 } },
  { id: 'multi-10-sessions', category: 'multi', tier: 'hard',   title: '10 Sessions',    description: 'Log 10 total activity sessions across the week.',     points: 90, rule: { kind: 'session_count', target: 10 } },
];

// ── Rotation ────────────────────────────────────────────────────────────────

/** Returns the ISO timestamp for the end of the current week's Sunday 23:59:59 local. */
export function nextSundayMidnight() {
  const now = new Date();
  const daysUntilSunday = now.getDay() === 0 ? 0 : 7 - now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  sunday.setHours(23, 59, 59, 0);
  return sunday.toISOString();
}

/** ISO week key, e.g. '2026-W22'. */
export function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

/** Monotonic integer for an ISO-week key, used to advance the rotation. */
export function weekNumber(isoWeek) {
  const m = /^(\d+)-W(\d+)$/.exec(isoWeek || '');
  if (!m) return 0;
  return parseInt(m[1], 10) * 53 + parseInt(m[2], 10);
}

/**
 * Select the active challenges for a given ISO week: one supported challenge
 * per category (gym/walking/running/cycling/multi), advancing each week.
 */
export function getActiveChallengesForWeek(isoWeek, catalog = CATALOG) {
  const wn = weekNumber(isoWeek);
  const active = [];
  for (const cat of CATEGORY_ORDER) {
    const list = catalog.filter((c) => c.category === cat && c.supported !== false);
    if (list.length === 0) continue;
    active.push(list[wn % list.length]);
  }
  return active;
}

export function getChallengeById(id, catalog = CATALOG) {
  return catalog.find((c) => c.id === id) || null;
}

// ── Admin-managed weekly challenge (display format, stored in system_config) ───

const CHALLENGE_DEFAULTS = {
  active: false,
  status: 'draft',
  bonusLabel: '',
  expiresAt: '',
  imageUri: '',
  imageOffsetY: 0,
  hint: '',
  xpReward: 0,
  powrRewardText: '',
  cadenceLabel: 'Rotates weekly',
  scheduleLabel: '',
  audienceLabel: 'All members',
  requiredSessions: 1,
  qualifyingTypes: [],
  steps: [],
  startBeforeHour: null,
};

export const ACTIVE_WEEKLY_CHALLENGE = {
  ...CHALLENGE_DEFAULTS,
  id: 'default-challenge',
  active: true,
  status: 'draft',
  title: 'Weekly Challenge',
  description: 'Complete this week\'s challenge to earn XP.',
  bonusLabel: 'Bonus',
};

export function normalizeWeeklyChallenges(list) {
  if (!Array.isArray(list) || list.length === 0) return [{ ...ACTIVE_WEEKLY_CHALLENGE }];
  return list.map((c) => ({ ...CHALLENGE_DEFAULTS, ...c }));
}

export function getActiveWeeklyChallenge(challenges) {
  if (!Array.isArray(challenges) || challenges.length === 0) return { ...ACTIVE_WEEKLY_CHALLENGE };
  return challenges.find((c) => c.active) ?? challenges[0];
}

export function parseWeeklyChallengesConfig(value) {
  if (!value) return normalizeWeeklyChallenges([{ ...ACTIVE_WEEKLY_CHALLENGE }]);
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(parsed) && parsed.length) return normalizeWeeklyChallenges(parsed);
  } catch { /* fall through */ }
  return normalizeWeeklyChallenges([{ ...ACTIVE_WEEKLY_CHALLENGE }]);
}

export function serializeWeeklyChallenges(challenges) {
  return JSON.stringify(challenges);
}

// ── Optional system_config override ───────────────────────────────────────────

/** Validate + normalize an admin-provided catalog; falls back to bundled. */
export function parseChallengeCatalog(value) {
  if (!value) return CATALOG;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(parsed) && parsed.length && parsed.every((c) => c && c.id && c.category && c.rule)) {
      return parsed;
    }
  } catch {
    /* fall through */
  }
  return CATALOG;
}

// ── Countdown helpers (unchanged behaviour) ───────────────────────────────────

export function computeExpiresIn(expiresAt) {
  if (!expiresAt) return '';
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h left` : `${days}d left`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m left` : `${hours}h left`;
  return `${minutes}m left`;
}

export function computeUrgency(expiresAt) {
  if (!expiresAt) return 0;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 1;
  const windowMs = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.min(1, 1 - diff / windowMs));
}

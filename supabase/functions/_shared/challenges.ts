// Weekly-challenge catalog + rule engine — Deno ESM MIRROR.
//
// This is a self-contained copy of the canonical source files:
//   shared/weeklyChallenges.js (catalog + rotation)
//   shared/challengeRules.js   (evaluator)
// Keep this file in sync with those. The edge function uses this to
// re-validate completions server-side before awarding points.

// ── Types ───────────────────────────────────────────────────────────────────
export type Rule =
  | { kind: 'session_count'; category?: string; target: number; dayOfWeek?: number[]; beforeHour?: number; hourWindow?: [number, number]; minDistanceM?: number; minDurationMin?: number }
  | { kind: 'distinct_days'; category?: string; target: number }
  | { kind: 'daily_metric_days'; threshold: number; target: number; dayOfWeek?: number[] }
  | { kind: 'weekly_sum'; metric: 'steps' | 'distance_m'; category?: string; target: number }
  | { kind: 'weekend_sum'; metric: 'steps'; target: number }
  | { kind: 'count_with_min_metric'; category: string; metric?: string; threshold: number; target: number }
  | { kind: 'count_and_sum'; category: string; metric?: string; target: number; min: number }
  | { kind: 'distinct_categories'; perCat?: number; target: number }
  | { kind: 'same_day_combo'; a: string; b: string[]; target: number }
  | { kind: 'spaced_days'; category: string; minGapDays?: number; target: number }
  | { kind: 'step_window'; window: 'morning' | 'midday' | 'evening'; threshold: number; target: number }
  | { kind: 'same_day_count'; category: string; perDay: number; target: number };

export interface Challenge {
  id: string;
  category: 'gym' | 'walking' | 'running' | 'cycling' | 'multi';
  tier: 'easy' | 'medium' | 'hard';
  title: string;
  description: string;
  points: number;
  supported?: boolean;
  rule: Rule;
}

interface RawSession {
  type: string;
  started_at: string;
  distance_m?: number | null;
  steps?: number | null;
  duration_sec?: number | null;
  verification?: string;
}

// ── Catalog (mirror of shared/weeklyChallenges.js) ───────────────────────────
const MON = 0, TUE = 1, WED = 2, SAT = 5, SUN = 6;

export const CATALOG: Challenge[] = [
  // GYM
  { id: 'gym-show-up', category: 'gym', tier: 'easy', title: 'Show Up', description: 'Check in 2 times this week.', points: 20, rule: { kind: 'session_count', category: 'gym', target: 2 } },
  { id: 'gym-back-again', category: 'gym', tier: 'easy', title: 'Back Again', description: 'Check in 3 times this week.', points: 25, rule: { kind: 'session_count', category: 'gym', target: 3 } },
  { id: 'gym-midweek-move', category: 'gym', tier: 'easy', title: 'Midweek Move', description: 'Check in at least once between Monday and Wednesday.', points: 15, rule: { kind: 'session_count', category: 'gym', dayOfWeek: [MON, TUE, WED], target: 1 } },
  { id: 'gym-weekend', category: 'gym', tier: 'easy', title: 'Weekend Warrior', description: 'Check in on a Saturday or Sunday this week.', points: 15, rule: { kind: 'session_count', category: 'gym', dayOfWeek: [SAT, SUN], target: 1 } },
  { id: 'gym-4-from-7', category: 'gym', tier: 'medium', title: '4 From 7', description: 'Check in 4 times this week.', points: 40, rule: { kind: 'session_count', category: 'gym', target: 4 } },
  { id: 'gym-early-doors', category: 'gym', tier: 'medium', title: 'Early Doors', description: 'Check in before 8am, 3 times this week.', points: 40, rule: { kind: 'session_count', category: 'gym', beforeHour: 8, target: 3 } },
  { id: 'gym-lunchtime', category: 'gym', tier: 'medium', title: 'Lunchtime Grind', description: 'Check in between 12pm and 2pm, 3 times this week.', points: 40, rule: { kind: 'session_count', category: 'gym', hourWindow: [12, 14], target: 3 } },
  { id: 'gym-no-days-off', category: 'gym', tier: 'medium', title: 'No Days Off', description: 'Check in 5 times this week.', points: 50, rule: { kind: 'session_count', category: 'gym', target: 5 } },
  { id: 'gym-perfect-week', category: 'gym', tier: 'hard', title: 'Perfect Week', description: 'Check in every day for 7 consecutive days.', points: 75, rule: { kind: 'distinct_days', category: 'gym', target: 7 } },
  { id: 'gym-double-day', category: 'gym', tier: 'hard', title: 'Double Day', description: 'Check in twice in one day, 2 times this week.', points: 70, supported: false, rule: { kind: 'same_day_count', category: 'gym', perDay: 2, target: 2 } },
  { id: 'gym-5am-club', category: 'gym', tier: 'hard', title: '5am Club', description: 'Check in before 6am, 3 times this week.', points: 75, rule: { kind: 'session_count', category: 'gym', beforeHour: 6, target: 3 } },
  { id: 'gym-six-pack', category: 'gym', tier: 'hard', title: 'Six Pack Week', description: 'Check in 6 times this week.', points: 80, rule: { kind: 'session_count', category: 'gym', target: 6 } },
  // WALKING
  { id: 'walk-first-steps', category: 'walking', tier: 'easy', title: 'First Steps', description: 'Hit 5,000 steps in a single day this week.', points: 15, rule: { kind: 'daily_metric_days', threshold: 5000, target: 1 } },
  { id: 'walk-daily-mover', category: 'walking', tier: 'easy', title: 'Daily Mover', description: 'Hit 7,000 steps a day, 3 days this week.', points: 20, rule: { kind: 'daily_metric_days', threshold: 7000, target: 3 } },
  { id: 'walk-lunch-walk', category: 'walking', tier: 'easy', title: 'Lunch Walk', description: 'Log 2,000 steps between 12pm and 2pm, 3 times this week.', points: 15, rule: { kind: 'step_window', window: 'midday', threshold: 2000, target: 3 } },
  { id: 'walk-evening', category: 'walking', tier: 'easy', title: 'Evening Stroll', description: 'Log 3,000 steps after 6pm, 3 times this week.', points: 15, rule: { kind: 'step_window', window: 'evening', threshold: 3000, target: 3 } },
  { id: 'walk-10k-days', category: 'walking', tier: 'medium', title: '10K Days', description: 'Hit 10,000 steps a day, 4 days this week.', points: 40, rule: { kind: 'daily_metric_days', threshold: 10000, target: 4 } },
  { id: 'walk-30k-weekend', category: 'walking', tier: 'medium', title: '30K Weekend', description: 'Log 30,000 steps across Saturday and Sunday.', points: 40, rule: { kind: 'weekend_sum', metric: 'steps', target: 30000 } },
  { id: 'walk-morning', category: 'walking', tier: 'medium', title: 'Morning Walker', description: 'Log 3,000 steps before 9am, 4 times this week.', points: 35, rule: { kind: 'step_window', window: 'morning', threshold: 3000, target: 4 } },
  { id: 'walk-35k-week', category: 'walking', tier: 'medium', title: '35K Week', description: 'Hit 35,000 steps across the week.', points: 45, rule: { kind: 'weekly_sum', metric: 'steps', target: 35000 } },
  { id: 'walk-50k-week', category: 'walking', tier: 'hard', title: '50K Week', description: 'Hit 50,000 steps across the week.', points: 65, rule: { kind: 'weekly_sum', metric: 'steps', target: 50000 } },
  { id: 'walk-10k-everyday', category: 'walking', tier: 'hard', title: '10K Every Day', description: 'Hit 10,000 steps every day for 7 days.', points: 75, rule: { kind: 'daily_metric_days', threshold: 10000, target: 7 } },
  { id: 'walk-big-day', category: 'walking', tier: 'hard', title: 'Big Saturday', description: 'Log 20,000 steps in a single day.', points: 60, rule: { kind: 'daily_metric_days', threshold: 20000, target: 1 } },
  { id: 'walk-70k-week', category: 'walking', tier: 'hard', title: '70K Week', description: 'Hit 70,000 steps across the week.', points: 80, rule: { kind: 'weekly_sum', metric: 'steps', target: 70000 } },
  // RUNNING
  { id: 'run-just-run', category: 'running', tier: 'easy', title: 'Just Run', description: 'Log 1 run of any distance this week.', points: 15, rule: { kind: 'session_count', category: 'running', target: 1 } },
  { id: 'run-3km', category: 'running', tier: 'easy', title: '3km Run', description: 'Complete a single run of 3km or more.', points: 20, rule: { kind: 'count_with_min_metric', category: 'running', metric: 'distance_m', threshold: 3000, target: 1 } },
  { id: 'run-twice', category: 'running', tier: 'easy', title: 'Twice This Week', description: 'Log 2 runs this week, any distance.', points: 20, rule: { kind: 'session_count', category: 'running', target: 2 } },
  { id: 'run-5km-total', category: 'running', tier: 'easy', title: '5km Total', description: 'Log 5km of running across the week.', points: 20, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'running', target: 5000 } },
  { id: 'run-3-runs-10km', category: 'running', tier: 'medium', title: '3 Runs This Week', description: 'Log 3 runs totalling at least 10km.', points: 40, rule: { kind: 'count_and_sum', category: 'running', metric: 'distance_m', target: 3, min: 10000 } },
  { id: 'run-5k-x3', category: 'running', tier: 'medium', title: '5K Three Times', description: 'Run 5km or more, 3 times this week.', points: 45, rule: { kind: 'count_with_min_metric', category: 'running', metric: 'distance_m', threshold: 5000, target: 3 } },
  { id: 'run-20k-week', category: 'running', tier: 'medium', title: '20K Week', description: 'Log 20km of running across the week.', points: 40, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'running', target: 20000 } },
  { id: 'run-every-other', category: 'running', tier: 'medium', title: 'Run Every Other Day', description: '4 runs this week with at least 1 rest day between each.', points: 50, rule: { kind: 'spaced_days', category: 'running', minGapDays: 1, target: 4 } },
  { id: 'run-long-one', category: 'running', tier: 'hard', title: 'Long One', description: 'Complete a single run of 10km or more.', points: 60, rule: { kind: 'count_with_min_metric', category: 'running', metric: 'distance_m', threshold: 10000, target: 1 } },
  { id: 'run-half-week', category: 'running', tier: 'hard', title: 'Half Marathon Week', description: 'Log 21km of running across the week.', points: 70, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'running', target: 21000 } },
  { id: 'run-5-runs', category: 'running', tier: 'hard', title: '5 Runs This Week', description: 'Log 5 runs of any distance this week.', points: 65, rule: { kind: 'session_count', category: 'running', target: 5 } },
  { id: 'run-30k-week', category: 'running', tier: 'hard', title: '30K Week', description: 'Log 30km of running across the week.', points: 75, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'running', target: 30000 } },
  // CYCLING
  { id: 'cycle-first-ride', category: 'cycling', tier: 'easy', title: 'First Ride', description: 'Log 1 ride of any distance this week.', points: 15, rule: { kind: 'session_count', category: 'cycling', target: 1 } },
  { id: 'cycle-10km', category: 'cycling', tier: 'easy', title: '10km Ride', description: 'Complete a single ride of 10km or more.', points: 20, rule: { kind: 'count_with_min_metric', category: 'cycling', metric: 'distance_m', threshold: 10000, target: 1 } },
  { id: 'cycle-twice', category: 'cycling', tier: 'easy', title: 'Twice This Week', description: 'Log 2 rides this week, any distance.', points: 20, rule: { kind: 'session_count', category: 'cycling', target: 2 } },
  { id: 'cycle-20km-total', category: 'cycling', tier: 'easy', title: '20km Total', description: 'Log 20km of cycling across the week.', points: 20, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'cycling', target: 20000 } },
  { id: 'cycle-commuter', category: 'cycling', tier: 'medium', title: 'Commuter', description: 'Cycle 3 times this week, any distance.', points: 35, rule: { kind: 'session_count', category: 'cycling', target: 3 } },
  { id: 'cycle-50km-week', category: 'cycling', tier: 'medium', title: '50km Week', description: 'Log 50km of cycling across the week.', points: 40, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'cycling', target: 50000 } },
  { id: 'cycle-25km', category: 'cycling', tier: 'medium', title: '25km Ride', description: 'Complete a single ride of 25km or more.', points: 40, rule: { kind: 'count_with_min_metric', category: 'cycling', metric: 'distance_m', threshold: 25000, target: 1 } },
  { id: 'cycle-4-rides', category: 'cycling', tier: 'medium', title: '4 Rides This Week', description: 'Log 4 rides of any distance this week.', points: 45, rule: { kind: 'session_count', category: 'cycling', target: 4 } },
  { id: 'cycle-50km-ride', category: 'cycling', tier: 'hard', title: '50km Ride', description: 'Complete a single ride of 50km or more.', points: 65, rule: { kind: 'count_with_min_metric', category: 'cycling', metric: 'distance_m', threshold: 50000, target: 1 } },
  { id: 'cycle-100km-week', category: 'cycling', tier: 'hard', title: '100km Week', description: 'Log 100km of cycling across the week.', points: 75, rule: { kind: 'weekly_sum', metric: 'distance_m', category: 'cycling', target: 100000 } },
  { id: 'cycle-5-rides', category: 'cycling', tier: 'hard', title: '5 Rides This Week', description: 'Log 5 rides this week, any distance.', points: 65, rule: { kind: 'session_count', category: 'cycling', target: 5 } },
  { id: 'cycle-century-prep', category: 'cycling', tier: 'hard', title: 'Century Prep', description: 'Complete a single ride of 80km or more.', points: 80, rule: { kind: 'count_with_min_metric', category: 'cycling', metric: 'distance_m', threshold: 80000, target: 1 } },
  // MULTI
  { id: 'multi-mix-it-up', category: 'multi', tier: 'easy', title: 'Mix It Up', description: 'Log activity in 2 different categories this week.', points: 25, rule: { kind: 'distinct_categories', perCat: 1, target: 2 } },
  { id: 'multi-gym-and-go', category: 'multi', tier: 'easy', title: 'Gym and Go', description: 'Check in to the gym and log a walk or run on the same day.', points: 25, rule: { kind: 'same_day_combo', a: 'gym', b: ['walking', 'running'], target: 1 } },
  { id: 'multi-3-types', category: 'multi', tier: 'easy', title: '3 Activity Types', description: 'Log at least 1 session in 3 different categories this week.', points: 30, rule: { kind: 'distinct_categories', perCat: 1, target: 3 } },
  { id: 'multi-triple', category: 'multi', tier: 'medium', title: 'Triple Threat', description: 'Log 2 sessions in 3 different categories this week.', points: 50, rule: { kind: 'distinct_categories', perCat: 2, target: 3 } },
  { id: 'multi-gym-and-run', category: 'multi', tier: 'medium', title: 'Gym and Run', description: 'Check in to the gym and log a run on the same day, twice this week.', points: 50, rule: { kind: 'same_day_combo', a: 'gym', b: ['running'], target: 2 } },
  { id: 'multi-5-days', category: 'multi', tier: 'medium', title: '5 Days Active', description: 'Log at least 1 activity of any kind, 5 days this week.', points: 45, rule: { kind: 'distinct_days', target: 5 } },
  { id: 'multi-everyday', category: 'multi', tier: 'hard', title: 'Active Every Day', description: 'Log at least 1 activity every day for 7 days.', points: 80, rule: { kind: 'distinct_days', target: 7 } },
  { id: 'multi-all-four', category: 'multi', tier: 'hard', title: 'All Four', description: 'Log at least 1 session in all 4 categories this week.', points: 85, rule: { kind: 'distinct_categories', perCat: 1, target: 4 } },
  { id: 'multi-10-sessions', category: 'multi', tier: 'hard', title: '10 Sessions', description: 'Log 10 total activity sessions across the week.', points: 90, rule: { kind: 'session_count', target: 10 } },
];

export function getChallengeById(id: string, catalog: Challenge[] = CATALOG): Challenge | null {
  return catalog.find((c) => c.id === id) ?? null;
}

// ── Evaluator (mirror of shared/challengeRules.js) ───────────────────────────
const MAIN_CATEGORIES = ['gym', 'walking', 'running', 'cycling'];

function categoryOf(type: string): string | null {
  switch (type) {
    case 'gym': return 'gym';
    case 'walking': return 'walking';
    case 'running': return 'running';
    case 'cycling': return 'cycling';
    default: return null;
  }
}

function localParts(startedAtISO: string, utcOffsetMinutes: number) {
  const d = new Date(new Date(startedAtISO).getTime() + utcOffsetMinutes * 60 * 1000);
  const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { dateKey, dow: (d.getUTCDay() + 6) % 7, hour: d.getUTCHours() };
}

function dateKeyToDayNum(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

interface StepWindowRow { date: string; before_9am?: number; midday_12_14?: number; after_6pm?: number }

export interface EvalContext {
  sessions: { category: string | null; type: string; dateKey: string; dow: number; hour: number; distance_m: number; steps: number; duration_sec: number }[];
  dailySteps: Map<string, { steps: number; dow: number }>;
  stepWindows: Map<string, { morning: number; midday: number; evening: number }>;
}

export function buildContext(rawSessions: RawSession[], utcOffsetMinutes: number, stepWindowRows: StepWindowRow[] = []): EvalContext {
  const sessions: EvalContext['sessions'] = [];
  const dailySteps = new Map<string, { steps: number; dow: number }>();

  for (const r of rawSessions || []) {
    if (r.verification === 'manual') continue;
    if (r.type === 'sleep') continue;
    const { dateKey, dow, hour } = localParts(r.started_at, utcOffsetMinutes);
    sessions.push({
      category: categoryOf(r.type), type: r.type, dateKey, dow, hour,
      distance_m: r.distance_m || 0, steps: r.steps || 0, duration_sec: r.duration_sec || 0,
    });
    if (r.type === 'walking') {
      const prev = dailySteps.get(dateKey);
      dailySteps.set(dateKey, { steps: (prev?.steps || 0) + (r.steps || 0), dow });
    }
  }

  const stepWindows = new Map<string, { morning: number; midday: number; evening: number }>();
  for (const w of stepWindowRows || []) {
    stepWindows.set(w.date, { morning: w.before_9am || 0, midday: w.midday_12_14 || 0, evening: w.after_6pm || 0 });
  }
  return { sessions, dailySteps, stepWindows };
}

function sessionMatches(s: EvalContext['sessions'][number], rule: any): boolean {
  if (rule.category && s.category !== rule.category) return false;
  if (rule.dayOfWeek && !rule.dayOfWeek.includes(s.dow)) return false;
  if (rule.beforeHour != null && !(s.hour < rule.beforeHour)) return false;
  if (rule.hourWindow && !(s.hour >= rule.hourWindow[0] && s.hour < rule.hourWindow[1])) return false;
  if (rule.minDistanceM != null && s.distance_m < rule.minDistanceM) return false;
  if (rule.minDurationMin != null && s.duration_sec / 60 < rule.minDurationMin) return false;
  return true;
}

const result = (progress: number, target: number) => ({ progress, target, met: progress >= target });

export function evaluateChallenge(rule: any, ctx: EvalContext): { progress: number; target: number; met: boolean } {
  switch (rule.kind) {
    case 'session_count':
      return result(ctx.sessions.filter((s) => sessionMatches(s, rule)).length, rule.target);
    case 'distinct_days': {
      const days = new Set<string>();
      for (const s of ctx.sessions) {
        if (rule.category && s.category !== rule.category) continue;
        days.add(s.dateKey);
      }
      return result(days.size, rule.target);
    }
    case 'daily_metric_days': {
      let count = 0;
      for (const { steps, dow } of ctx.dailySteps.values()) {
        if (rule.dayOfWeek && !rule.dayOfWeek.includes(dow)) continue;
        if (steps >= rule.threshold) count++;
      }
      return result(count, rule.target);
    }
    case 'weekly_sum': {
      let sum = 0;
      if (rule.metric === 'steps') { for (const { steps } of ctx.dailySteps.values()) sum += steps; }
      else { for (const s of ctx.sessions) if (s.category === rule.category) sum += s.distance_m; }
      return result(sum, rule.target);
    }
    case 'weekend_sum': {
      let sum = 0;
      for (const { steps, dow } of ctx.dailySteps.values()) if (dow >= 5) sum += steps;
      return result(sum, rule.target);
    }
    case 'count_with_min_metric': {
      const metric = rule.metric || 'distance_m';
      const n = ctx.sessions.filter((s) => s.category === rule.category && ((s as any)[metric] || 0) >= rule.threshold).length;
      return result(n, rule.target);
    }
    case 'count_and_sum': {
      const metric = rule.metric || 'distance_m';
      const matching = ctx.sessions.filter((s) => s.category === rule.category);
      const count = matching.length;
      const sum = matching.reduce((a, s) => a + ((s as any)[metric] || 0), 0);
      return { progress: count, target: rule.target, met: count >= rule.target && sum >= rule.min };
    }
    case 'distinct_categories': {
      const counts: Record<string, number> = {};
      for (const s of ctx.sessions) {
        if (!s.category || !MAIN_CATEGORIES.includes(s.category)) continue;
        counts[s.category] = (counts[s.category] || 0) + 1;
      }
      const perCat = rule.perCat || 1;
      return result(Object.values(counts).filter((c) => c >= perCat).length, rule.target);
    }
    case 'same_day_combo': {
      const byDay = new Map<string, Set<string | null>>();
      for (const s of ctx.sessions) {
        if (!byDay.has(s.dateKey)) byDay.set(s.dateKey, new Set());
        byDay.get(s.dateKey)!.add(s.category);
      }
      let days = 0;
      for (const set of byDay.values()) if (set.has(rule.a) && rule.b.some((b: string) => set.has(b))) days++;
      return result(days, rule.target);
    }
    case 'spaced_days': {
      const nums = [...new Set(ctx.sessions.filter((s) => s.category === rule.category).map((s) => s.dateKey))]
        .map(dateKeyToDayNum).sort((a, b) => a - b);
      let count = 0, prev = -Infinity;
      const gap = rule.minGapDays ?? 1;
      for (const n of nums) if (n - prev > gap) { count++; prev = n; }
      return result(count, rule.target);
    }
    case 'step_window': {
      let count = 0;
      for (const w of ctx.stepWindows.values()) if (((w as any)[rule.window] || 0) >= rule.threshold) count++;
      return result(count, rule.target);
    }
    default:
      return { progress: 0, target: rule?.target ?? 1, met: false };
  }
}

// ── Week helpers ──────────────────────────────────────────────────────────────
export function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

/** Monday 00:00 of the week containing `date`, in the user's local tz, as a UTC ISO string. */
export function getLocalMondayAsUTC(utcOffsetMinutes: number, now: number = Date.now()): string {
  const localMs = now + utcOffsetMinutes * 60 * 1000;
  const localNow = new Date(localMs);
  const day = localNow.getUTCDay() || 7;
  const mondayLocalMs = localMs - (day - 1) * 24 * 60 * 60 * 1000;
  const mondayLocal = new Date(mondayLocalMs);
  mondayLocal.setUTCHours(0, 0, 0, 0);
  return new Date(mondayLocal.getTime() - utcOffsetMinutes * 60 * 1000).toISOString();
}

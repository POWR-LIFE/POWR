/**
 * A Together template's goal line ("Check in 4×", "Together: 100,000 steps"),
 * in the reader's language, from its structured `measure`.
 *
 * The admin panel writes the English line into shared_challenge_templates.goal
 * when a template is saved (SharedChallengesPanel.jsx goalText / poolGoalText),
 * and a challenge's snapshot copies it, so every stored goal is English. This
 * is the same generator over catalog keys (challenges:goal.*), so the line can
 * be said in any language. In English it reproduces the stored goal of every
 * template byte for byte (__tests__/challengeNames.test.ts checks them all),
 * including the two rows seeded by migration rather than the panel ("Ride 50km
 * in total", "Together: 50km walking").
 *
 * Pure: the caller passes its translator and the number locale, so the app and
 * tests share it. Returns null for anything it can't say with certainty (an
 * unknown measure or window, a missing number); the caller then shows the
 * stored goal as written.
 */

export interface GoalMeasure {
  measure?: string | null;
  target?: number | string | null;
  unit?: string | null;
  days?: number | string | null;
  window?: string | null;
}

export interface GoalSource {
  category?: string | null;
  mode?: string | null;
  measure?: GoalMeasure | null;
}

export type GoalTranslate = (key: string, vars?: Record<string, string | number>) => string;

const WINDOWS = ['before_9am', 'midday', 'after_6pm'] as const;
const DISTANCE_CATEGORIES = ['running', 'cycling', 'walking'] as const;

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && Math.floor(n) === n ? n : null;
}

/** 'any' (or none) → 'any'; a known window → itself; anything else → null. */
function windowKey(value: unknown): 'any' | (typeof WINDOWS)[number] | null {
  if (value == null || value === '' || value === 'any') return 'any';
  return (WINDOWS as readonly unknown[]).includes(value) ? (value as (typeof WINDOWS)[number]) : null;
}

export function sharedChallengeGoalText(source: GoalSource, t: GoalTranslate, locale: string): string | null {
  const m = source.measure;
  if (!m || typeof m !== 'object' || typeof m.measure !== 'string') return null;
  const target = positiveInt(m.target);
  if (target == null) return null;
  const pooled = source.mode === 'pooled';
  const english = locale.toLowerCase().startsWith('en');
  // The panel prints most numbers bare (`${v}`) and step counts grouped
  // (v.toLocaleString()). Other languages always group the way their locale does.
  const plain = (n: number) => (english ? String(n) : n.toLocaleString(locale));
  const grouped = (n: number) => n.toLocaleString(locale);

  const distance = (fallbackUnit: string | null) => {
    const unit = m.unit || fallbackUnit;
    if (unit !== 'km' && unit !== 'mi') return null;
    return t('challenges:goal.distance', { value: plain(target), unit });
  };

  if (pooled) {
    switch (m.measure) {
      case 'distance': {
        const cat = source.category;
        const d = distance('km');
        if (!d || !(DISTANCE_CATEGORIES as readonly unknown[]).includes(cat)) return null;
        return t(`challenges:goal.pool.distance.${cat}`, { distance: d });
      }
      case 'checkins': return t('challenges:goal.pool.checkins', { count: target });
      case 'steps_week':
      case 'steps_day': return t('challenges:goal.pool.steps', { steps: grouped(target) });
      case 'runs': return t('challenges:goal.pool.runs', { count: target });
      case 'rides': return t('challenges:goal.pool.rides', { count: target });
      case 'sessions': return t('challenges:goal.pool.sessions', { count: target });
      default: return null;
    }
  }

  switch (m.measure) {
    case 'distance': {
      const cat = source.category;
      const d = distance(null);
      if (!d || !(DISTANCE_CATEGORIES as readonly unknown[]).includes(cat)) return null;
      return t(`challenges:goal.total.${cat}`, { distance: d });
    }
    case 'checkins': {
      const win = windowKey(m.window);
      return win ? t(`challenges:goal.checkins.${win}`, { count: target }) : null;
    }
    case 'distinct_days': return t('challenges:goal.distinctDays', { count: target });
    case 'steps_week': return t('challenges:goal.stepsWeek', { steps: grouped(target) });
    case 'steps_day': {
      const win = windowKey(m.window);
      const days = positiveInt(m.days);
      if (!win || days == null) return null;
      return t(`challenges:goal.stepsDay.${win}`, { steps: grouped(target), count: days });
    }
    case 'runs': return t('challenges:goal.runs', { count: target });
    case 'rides': return t('challenges:goal.rides', { count: target });
    case 'sessions': return t('challenges:goal.sessions', { count: target });
    case 'categories': return t('challenges:goal.categories', { count: target });
    default: return null;
  }
}

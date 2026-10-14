// What a gym's members' activity says, and what to do about it — the gym
// portal's "The data" card (after the Gym Clash packages sheet: "Running is up
// 30% among members → Launch a run club. We bring the sponsor.").
//
// Input is gym_member_activity(): anonymous numbers across the members who
// picked the gym, their activity anywhere, never sleep / heart rate / steps.
// Pure functions, under jest (__tests__/memberInsights.test.ts); the portal
// only renders what these return.
//
// The words live in the portal's venueMembers catalog (insights.*). The
// portal passes i18next's t (and its date locale) to get them in the reader's
// language; without one (gymMoves, the tests) they come out in English,
// straight from shared/i18n/en/portal/venueMembers.json.

import english from './i18n/en/portal/venueMembers.json';

export type MixRow = {
  type: string;
  members: number;
  sessions: number;
  minutes?: number;
  km?: number;
  prev_sessions?: number;
  /** Sessions per active member, last 4 complete weeks vs the 4 before, in %. */
  change_pct: number | null;
};

export type MemberActivity = {
  members: number;
  too_few?: boolean;
  min_members?: number;
  active_4w?: number;
  active_prev_4w?: number;
  mix?: MixRow[];
  segments?: Array<{ type: string; members: number }>;
  consistency?: { none: number; low: number; mid: number; high: number };
  weekdays?: number[];
  months?: Array<{ month: string; active_members: number; sessions: number }>;
  gym_sessions?: { here: number; other_gyms: number; elsewhere: number };
  quiet?: number;
  slowing?: number;
  sharing?: number;
};

export type Insight = {
  key: string;
  finding: string;
  action: string;
  tone: 'up' | 'down' | 'watch';
};

/** A full key ('venueMembers:insights.…') and its values → the words. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * English from the catalog, for callers without i18next: {{placeholders}},
 * and `_one` / `_other` picked by `count` like i18next does in English.
 */
export const englishText: Translate = (key, values = {}) => {
  const path = key.replace(/^venueMembers:/, '').split('.');
  const last = path.pop() as string;
  let node: unknown = english;
  for (const k of path) node = (node as Record<string, unknown> | undefined)?.[k];
  const at = (k: string) => (node as Record<string, unknown> | undefined)?.[k];
  const count = values.count;
  const text = (typeof count === 'number' ? at(`${last}_${count === 1 ? 'one' : 'other'}`) : undefined) ?? at(last);
  if (typeof text !== 'string') return key;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(values[name] ?? ''));
};

/** The activity as a subject: "Running is up…", "Gym training is down…" (English). */
export const ACTIVITY_NOUN: Record<string, string> = english.insights.subject;

/** Types with their own suggestion when they rise (insights.rise.action.*). */
const RISE_ACTION_TYPES = new Set(['running', 'cycling', 'swimming', 'hiit', 'yoga', 'walking', 'gym']);

/** insights.onDays.* — "Mondays" here, "le lundi" in French. */
const ON_DAYS = ['mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays', 'sundays'];

/**
 * Up to `limit` findings, most useful first: regulars drifting (Retention),
 * the biggest rise, heavy walkers vs light lifters, training at other gyms,
 * the biggest fall, a weak weekday, a seasonal dip, the committed core.
 * Nothing when the gym is below the member threshold.
 */
export function memberInsights(
  a: MemberActivity | null | undefined,
  opts: {
    gymName: string;
    canSeePeople: boolean;
    limit?: number;
    /** i18next's t from the portal; English without it. */
    t?: Translate;
    /** For month names (Intl); en-GB without it. */
    locale?: string;
  },
): Insight[] {
  if (!a || a.too_few) return [];
  const t = opts.t ?? englishText;
  const noun = (type: string) => (ACTIVITY_NOUN[type] ? t(`venueMembers:insights.subject.${type}`) : type.charAt(0).toUpperCase() + type.slice(1));
  const out: Insight[] = [];
  // An activity only speaks for "members" once 3+ did it and there's enough of it.
  const mix = (a.mix ?? []).filter((r) => r.members >= 3 && r.sessions >= 8);

  const quiet = a.quiet ?? 0;
  const slowing = a.slowing ?? 0;
  if (quiet + slowing > 0) {
    // quiet/slowing are Retention's drifting/slipping: each person against
    // their own usual gap between visits (gym_member_activity, 20261007120000).
    const finding = quiet === 0 ? t('venueMembers:insights.quiet.slipping', { count: slowing })
      : !slowing ? t('venueMembers:insights.quiet.drifting', { count: quiet })
      : slowing === 1 ? t('venueMembers:insights.quiet.driftingAndOneSlipping', { count: quiet, slipping: slowing })
      : t('venueMembers:insights.quiet.driftingAndSlipping', { count: quiet, slipping: slowing });
    out.push({
      key: 'quiet',
      finding,
      action: opts.canSeePeople ? t('venueMembers:insights.quiet.actionPro') : t('venueMembers:insights.quiet.actionPlus'),
      tone: 'watch',
    });
  }

  const riser = mix
    .filter((r) => r.change_pct != null && r.change_pct >= 25)
    .sort((x, y) => (y.change_pct ?? 0) - (x.change_pct ?? 0))[0];
  if (riser) {
    out.push({
      key: `up:${riser.type}`,
      finding: t('venueMembers:insights.rise.finding', { activity: noun(riser.type), pct: riser.change_pct ?? 0 }),
      action: RISE_ACTION_TYPES.has(riser.type) ? t(`venueMembers:insights.rise.action.${riser.type}`) : t('venueMembers:insights.rise.action.other'),
      tone: 'up',
    });
  }

  const walk = mix.find((r) => r.type === 'walking');
  const lift = mix.find((r) => r.type === 'gym');
  if (walk && walk.members >= 5 && walk.members > 1.5 * (lift?.members ?? 0)) {
    out.push({ key: 'walkers', finding: t('venueMembers:insights.walkers.finding'), action: t('venueMembers:insights.walkers.action'), tone: 'up' });
  }

  const g = a.gym_sessions;
  if (g && g.other_gyms >= 5) {
    const placed = g.here + g.other_gyms;
    const share = placed ? g.other_gyms / placed : 0;
    if (share >= 0.2) {
      out.push({
        key: 'elsewhere',
        finding: t('venueMembers:insights.elsewhere.finding', { pct: Math.round(share * 100) }),
        action: t('venueMembers:insights.elsewhere.action', { gym: opts.gymName }),
        tone: 'down',
      });
    }
  }

  const faller = mix
    .filter((r) => r.change_pct != null && r.change_pct <= -25)
    .sort((x, y) => (x.change_pct ?? 0) - (y.change_pct ?? 0))[0];
  if (faller) {
    out.push({
      key: `down:${faller.type}`,
      finding: t('venueMembers:insights.fall.finding', { activity: noun(faller.type), pct: Math.abs(faller.change_pct ?? 0) }),
      action: t('venueMembers:insights.fall.action'),
      tone: 'down',
    });
  }

  const wd = a.weekdays ?? [];
  const total = wd.reduce((s, n) => s + n, 0);
  if (wd.length === 7 && total >= 50) {
    const mean = total / 7;
    const low = wd.indexOf(Math.min(...wd));
    if (wd[low] < 0.7 * mean) {
      const days = t(`venueMembers:insights.onDays.${ON_DAYS[low]}`);
      out.push({
        key: 'weekday',
        finding: t('venueMembers:insights.weekday.finding', { days }),
        action: t('venueMembers:insights.weekday.action', { days }),
        tone: 'down',
      });
    }
  }

  // Seasonal: complete months with 5+ active members, per active member.
  const months = (a.months ?? []).slice(0, -1).filter((m) => m.active_members >= 5);
  if (months.length >= 4) {
    const rates = months.map((m) => m.sessions / m.active_members);
    const low = rates.indexOf(Math.min(...rates));
    const others = rates.filter((_, i) => i !== low);
    const avg = others.reduce((s, r) => s + r, 0) / others.length;
    if (rates[low] < 0.75 * avg) {
      const month = new Intl.DateTimeFormat(opts.locale ?? 'en-GB', { month: 'long', timeZone: 'UTC' })
        .format(Date.UTC(2000, Number(months[low].month.slice(5, 7)) - 1, 1));
      out.push({ key: 'month', finding: t('venueMembers:insights.month.finding', { month }), action: t('venueMembers:insights.month.action'), tone: 'down' });
    }
  }

  const c = a.consistency;
  const active = a.active_4w ?? 0;
  if (c && active >= 5 && c.high / active >= 0.4) {
    out.push({
      key: 'core',
      finding: t('venueMembers:insights.core.finding', { n: c.high }),
      action: t('venueMembers:insights.core.action'),
      tone: 'up',
    });
  }

  return out.slice(0, opts.limit ?? 3);
}

/** "+91%" / "−12%" / "" for a per-member change. */
export function changeLabel(pct: number | null | undefined): string {
  if (pct == null) return '';
  return pct > 0 ? `+${pct}%` : pct < 0 ? `−${Math.abs(pct)}%` : '0%';
}

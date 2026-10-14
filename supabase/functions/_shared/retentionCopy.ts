// The words for Retention: who's drifting from a gym, said the same way in
// the portal (/venue/retention) and the morning email (send-gym-email,
// drift_digest). The rule itself lives in SQL (_gym_retention_people,
// migration 20261007120000); this file only turns its numbers into lines.
// Pure, no imports, so Deno and the portal's Vite build both take it. Under
// jest (__tests__/retentionCopy.test.ts).
//
// The functions that return English (patternLine, personLine, quietLabel…)
// are what the email sends. Each has a *Parts twin that returns the same
// answer as ids and numbers, which the portal words in the reader's language
// (venueMembers namespace); the English is built from those parts, so the
// two can't drift apart.

export type RetentionStatus = 'regular' | 'slipping' | 'drifting' | 'lapsed' | 'new' | 'occasional' | 'unseen';
export type RetentionSignal = 'ok' | 'no_signal' | 'location_off';
export type OutreachChannel = 'call' | 'text' | 'email' | 'in_person' | 'push' | 'other';

export type Pattern = {
  per_week?: number | string | null;
  usual_gap?: number | string | null;
  part?: string | null;
  dows?: number[] | null;
};

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PARTS: Record<string, string> = { morning: 'mornings', midday: 'lunchtimes', afternoon: 'afternoons', evening: 'evenings' };

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? null : n;
};

/** "Mon, Wed & Fri" from ISO weekdays (1 = Monday). */
export function dowList(dows: number[] | null | undefined): string {
  const names = (dows ?? []).filter((d) => d >= 1 && d <= 7).map((d) => DOW[d - 1]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export type FrequencyParts =
  | { id: 'most_days' }
  | { id: 'per_week'; n: number }
  | { id: 'weekly' }
  | { id: 'fortnightly' };

/** frequency() as data. */
export function frequencyParts(p: Pattern): FrequencyParts | null {
  const pw = num(p.per_week);
  if (pw == null) return null;
  if (pw >= 4.5) return { id: 'most_days' };
  if (pw >= 1.5) return { id: 'per_week', n: Math.round(pw) };
  if (pw >= 0.75) return { id: 'weekly' };
  return { id: 'fortnightly' };
}

/** How often they come: "3× a week", "most days", "about once a week", "every couple of weeks". */
export function frequency(p: Pattern): string | null {
  const f = frequencyParts(p);
  if (!f) return null;
  switch (f.id) {
    case 'most_days': return 'most days';
    case 'per_week': return `${f.n}× a week`;
    case 'weekly': return 'about once a week';
    default: return 'every couple of weeks';
  }
}

export type PatternParts = {
  frequency: FrequencyParts;
  /** morning | midday | afternoon | evening, or null. */
  part: string | null;
  /** ISO weekdays (1 = Monday), in the order given. */
  dows: number[];
};

/** patternLine() as data; null when there's no pattern yet. */
export function patternParts(p: Pattern): PatternParts | null {
  const f = frequencyParts(p);
  if (!f) return null;
  return {
    frequency: f,
    part: p.part && PARTS[p.part] ? p.part : null,
    dows: (p.dows ?? []).filter((d) => d >= 1 && d <= 7),
  };
}

/**
 * Their normal, in one line: "Usually 3× a week, mornings · Mon, Wed & Fri".
 * Empty when there's no pattern yet (fewer than 4 visits).
 */
export function patternLine(p: Pattern): string {
  const f = frequency(p);
  if (!f) return '';
  const part = p.part ? PARTS[p.part] : null;
  const days = dowList(p.dows);
  return `Usually ${f}${part ? `, ${part}` : ''}${days ? ` · ${days}` : ''}`;
}

/** quietLabel() as data: days, or weeks from four weeks on. */
export function quietParts(gapDays: number | null | undefined): { id: 'days' | 'weeks'; n: number } {
  const g = Math.max(0, Math.round(Number(gapDays ?? 0)));
  return g >= 28 ? { id: 'weeks', n: Math.floor(g / 7) } : { id: 'days', n: g };
}

/** "12 days quiet", "1 day quiet", "5 weeks quiet" (from four weeks on). */
export function quietLabel(gapDays: number | null | undefined): string {
  const q = quietParts(gapDays);
  if (q.id === 'weeks') return `${q.n} weeks quiet`;
  return `${q.n} day${q.n === 1 ? '' : 's'} quiet`;
}

export type AgoParts =
  | { id: 'not_yet' }
  | { id: 'today' }
  | { id: 'yesterday' }
  | { id: 'days'; n: number }
  | { id: 'weeks'; n: number };

/** sinceLabel() as data. */
export function agoParts(gapDays: number | null | undefined): AgoParts {
  if (gapDays == null) return { id: 'not_yet' };
  const g = Math.max(0, Math.round(gapDays));
  if (g === 0) return { id: 'today' };
  if (g === 1) return { id: 'yesterday' };
  if (g >= 28) return { id: 'weeks', n: Math.floor(g / 7) };
  return { id: 'days', n: g };
}

function agoLabel(a: AgoParts): string {
  switch (a.id) {
    case 'not_yet': return 'not yet';
    case 'today': return 'today';
    case 'yesterday': return 'yesterday';
    case 'weeks': return `${a.n} weeks ago`;
    default: return `${a.n} days ago`;
  }
}

/** "today", "yesterday", "12 days ago", "5 weeks ago". */
export function sinceLabel(gapDays: number | null | undefined): string {
  return agoLabel(agoParts(gapDays));
}

export const STATUS_LABEL: Record<RetentionStatus, string> = {
  drifting: 'Drifting',
  slipping: 'Slipping',
  lapsed: 'Lapsed',
  new: 'New',
  regular: 'On track',
  occasional: 'Occasional',
  unseen: 'Not seen here',
};

/** What to call someone POWR can't hear: their phone, not them. */
export function signalLabel(signal: RetentionSignal | string | null | undefined): string | null {
  if (signal === 'location_off') return 'Location off';
  if (signal === 'no_signal') return 'Not syncing';
  return null;
}

const atRisk = (status: string) => status === 'slipping' || status === 'drifting' || status === 'lapsed';

/** Status as shown, the signal winning for anyone at risk. */
export function statusLabel(status: RetentionStatus | string, signal?: RetentionSignal | string | null): string {
  const s = atRisk(status) ? signalLabel(signal) : null;
  return s ?? STATUS_LABEL[status as RetentionStatus] ?? status;
}

/**
 * statusLabel() as an id: 'location_off' / 'no_signal' when the signal wins,
 * else the status itself (a STATUS_LABEL key, or whatever SQL sent).
 */
export function statusId(status: RetentionStatus | string, signal?: RetentionSignal | string | null): string {
  return atRisk(status) && signalLabel(signal) ? String(signal) : status;
}

export type PersonLine = Pattern & {
  status: RetentionStatus | string;
  signal?: RetentionSignal | string | null;
  gap_days?: number | null;
  drift_after?: number | null;
  first_visit?: string | null;
  visit_days?: number | null;
  /** The gym's today (YYYY-MM-DD), for "First visit 9 days ago". */
  as_of?: string | null;
};

/** When they were last in: nothing known, in today, or a last visit some time ago. */
export type SinceParts = { id: 'in_today' } | { id: 'last_visit'; ago: AgoParts } | null;

export type PersonLineParts =
  | { id: 'phone_quiet'; since: SinceParts }
  | { id: 'unseen' }
  /** visits: how many so far when more than one, else null ("not back yet"). */
  | { id: 'new'; first: AgoParts; visits: number | null }
  | { id: 'occasional'; since: SinceParts }
  | { id: 'usual'; since: SinceParts; pattern: PatternParts | null };

/** personLine() as data. */
export function personLineParts(p: PersonLine): PersonLineParts {
  const since: SinceParts = p.gap_days == null ? null
    : p.gap_days === 0 ? { id: 'in_today' }
    : { id: 'last_visit', ago: agoParts(p.gap_days) };
  if (atRisk(String(p.status)) && signalLabel(p.signal)) return { id: 'phone_quiet', since };
  switch (p.status) {
    case 'unseen':
      return { id: 'unseen' };
    case 'new':
      return { id: 'new', first: agoParts(daysSince(p.first_visit, p.as_of)), visits: (p.visit_days ?? 0) > 1 ? (p.visit_days as number) : null };
    case 'occasional':
      return { id: 'occasional', since };
    default:
      return { id: 'usual', since, pattern: patternParts(p) };
  }
}

/**
 * The line under a name: when they were last in, and what's normal for them.
 *   "Last visit 16 days ago · Usually 2× a week, mornings · Mon & Thu"
 * Built from patternLine so the portal and the email never disagree.
 */
export function personLine(p: PersonLine): string {
  const line = personLineParts(p);
  if (line.id === 'unseen') return 'Picked your gym, not checked in here yet';
  if (line.id === 'new') return `First visit ${agoLabel(line.first)}${line.visits != null ? `, ${line.visits} visits so far` : ', not back yet'}`;
  const since = !line.since ? '' : line.since.id === 'in_today' ? 'In today' : `Last visit ${agoLabel(line.since.ago)}`;
  if (line.id === 'phone_quiet') return `${since} · POWR hasn't heard from their phone, so they may still be training`;
  if (line.id === 'occasional') return `${since} · drops in now and then`;
  return [since, patternLine(p)].filter(Boolean).join(' · ');
}

// Calendar days from a YYYY-MM-DD visit day to `asOf` (the gym's today, as
// gym_retention returns it; UTC today when not given).
function daysSince(first: string | null | undefined, asOf?: string | null): number | null {
  if (!first) return null;
  const to = Date.parse(`${asOf ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const from = Date.parse(`${first}T00:00:00Z`);
  if (Number.isNaN(to) || Number.isNaN(from)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export const CHANNEL_LABEL: Record<OutreachChannel, string> = {
  call: 'Called',
  text: 'Texted',
  email: 'Emailed',
  in_person: 'Spoke in person',
  push: 'POWR nudge',
  other: 'Reached out',
};

/** "3 members are drifting" / "Callum R. is drifting". */
export function driftHeadline(n: number, firstName?: string | null): string {
  if (n === 1 && firstName) return `${firstName} is drifting`;
  return `${n} ${n === 1 ? 'person is' : 'people are'} drifting`;
}

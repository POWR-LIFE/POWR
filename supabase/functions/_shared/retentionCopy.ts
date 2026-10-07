// The words for Retention: who's drifting from a gym, said the same way in
// the portal (/venue/retention) and the morning email (send-gym-email,
// drift_digest). The rule itself lives in SQL (_gym_retention_people,
// migration 20261007120000); this file only turns its numbers into lines.
// Pure, no imports, so Deno and the portal's Vite build both take it. Under
// jest (__tests__/retentionCopy.test.ts).

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

/** How often they come: "3× a week", "most days", "about once a week", "every couple of weeks". */
export function frequency(p: Pattern): string | null {
  const pw = num(p.per_week);
  if (pw == null) return null;
  if (pw >= 4.5) return 'most days';
  if (pw >= 1.5) return `${Math.round(pw)}× a week`;
  if (pw >= 0.75) return 'about once a week';
  return 'every couple of weeks';
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

/** "12 days quiet", "1 day quiet", "5 weeks quiet" (from four weeks on). */
export function quietLabel(gapDays: number | null | undefined): string {
  const g = Math.max(0, Math.round(Number(gapDays ?? 0)));
  if (g >= 28) return `${Math.floor(g / 7)} weeks quiet`;
  return `${g} day${g === 1 ? '' : 's'} quiet`;
}

/** "today", "yesterday", "12 days ago", "5 weeks ago". */
export function sinceLabel(gapDays: number | null | undefined): string {
  if (gapDays == null) return 'not yet';
  const g = Math.max(0, Math.round(gapDays));
  if (g === 0) return 'today';
  if (g === 1) return 'yesterday';
  if (g >= 28) return `${Math.floor(g / 7)} weeks ago`;
  return `${g} days ago`;
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

/** Status as shown, the signal winning for anyone at risk. */
export function statusLabel(status: RetentionStatus | string, signal?: RetentionSignal | string | null): string {
  const atRisk = status === 'slipping' || status === 'drifting' || status === 'lapsed';
  const s = atRisk ? signalLabel(signal) : null;
  return s ?? STATUS_LABEL[status as RetentionStatus] ?? status;
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

/**
 * The line under a name: when they were last in, and what's normal for them.
 *   "Last visit 16 days ago · Usually 2× a week, mornings · Mon & Thu"
 * Built from patternLine so the portal and the email never disagree.
 */
export function personLine(p: PersonLine): string {
  const pattern = patternLine(p);
  const since = p.gap_days == null ? '' : p.gap_days === 0 ? 'In today' : `Last visit ${sinceLabel(p.gap_days)}`;
  const sig = signalLabel(p.signal);
  if ((p.status === 'slipping' || p.status === 'drifting' || p.status === 'lapsed') && sig) {
    return `${since} · POWR hasn't heard from their phone, so they may still be training`;
  }
  switch (p.status) {
    case 'unseen':
      return 'Picked your gym, not checked in here yet';
    case 'new':
      return `First visit ${sinceLabel(daysSince(p.first_visit, p.as_of))}${(p.visit_days ?? 0) > 1 ? `, ${p.visit_days} visits so far` : ', not back yet'}`;
    case 'occasional':
      return `${since} · drops in now and then`;
    default:
      return [since, pattern].filter(Boolean).join(' · ');
  }
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

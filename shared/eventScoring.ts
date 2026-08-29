/**
 * Live-event scoring breakdown — the admin's view of WHAT scored for WHOM.
 *
 * The server (`admin_get_event_scoring`, `admin_get_event_user_ledger`)
 * labels every ledger row with a bucket, whether it counted, and the reason
 * it did not. Everything here is presentation over that: names for the
 * vocabulary, column selection, totals, search and the CSV. No scoring rule
 * lives in this file — the one predicate is `_live_event_ledger` in SQL, and
 * this file must never disagree with it by re-deriving anything.
 */

export type Bucket =
  | 'activity'
  | 'streak'
  | 'challenge'
  | 'bonus'
  | 'adjustment'
  | 'event_adjustment'
  | 'penalty'
  | 'other'
  | 'invite'
  | 'attendance';

export type Reason =
  | 'outside_window'
  | 'manual_off'
  | 'walking_off'
  | 'activity_not_included'
  | 'streak_off'
  | 'challenges_off'
  | 'bonuses_off'
  | 'adjustments_off'
  | 'never_counts'
  | 'no_anchor'
  | 'type_not_scored';

export interface ScoringEvent {
  id: string;
  status: string;
  window_start_at: string;
  window_end_at: string;
  lock_at: string | null;
  entry_gate_mode: 'deadline' | 'entry';
  entry_gate_n: number;
  frozen: boolean;
  included_activities: string[] | null;
  count_manual: boolean;
  count_walking: boolean;
  count_streak: boolean;
  count_challenges: boolean;
  count_bonuses: boolean;
  count_adjustments: boolean;
}

export interface ScoringRow {
  rank: number;
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  member_id: string | null;
  points: number;
  last_counted_at: string | null;
  gate_count: number | null;
  gate_met: boolean;
  by_bucket: Record<string, number>;
  by_activity: Record<string, number>;
  counted_rows: number;
  counted_sessions: number;
  excluded_rows: number;
  excluded_points: number;
  excluded_by_reason: Record<string, number>;
  adjustments_n: number;
}

export interface LedgerRow {
  tx_id: string;
  amount: number;
  tx_type: string;
  source: string | null;
  description: string | null;
  created_at: string;
  session_id: string | null;
  activity: string | null;
  verification: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  flagged: boolean | null;
  venue_name: string | null;
  raw_name: string | null;
  bucket: Bucket;
  counted: boolean;
  counted_at: string | null;
  reason: Reason | null;
}

export interface EventAdjustment {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
  admin_name: string;
}

/**
 * Bucket order for the table columns and the detail chips. Activity first
 * (it is nearly always the whole score), corrections last. Invite and
 * attendance never count so they never get a column — they show up only
 * in the excluded tally and the per-person ledger.
 */
export const BUCKETS: { key: Bucket; label: string; short: string }[] = [
  { key: 'activity',         label: 'Activity',          short: 'Activity' },
  { key: 'streak',           label: 'Streak bonuses',    short: 'Streaks' },
  { key: 'challenge',        label: 'Challenge payouts', short: 'Challenges' },
  { key: 'bonus',            label: 'Other bonuses',     short: 'Bonuses' },
  { key: 'other',            label: 'Other credits',     short: 'Other' },
  { key: 'adjustment',       label: 'Wallet adjustments', short: 'Wallet adj.' },
  { key: 'penalty',          label: 'Penalties',         short: 'Penalties' },
  { key: 'event_adjustment', label: 'Event adjustments', short: 'Event adj.' },
];

const BUCKET_LABEL: Record<Bucket, string> = {
  activity: 'Activity',
  streak: 'Streak bonus',
  challenge: 'Challenge payout',
  bonus: 'Bonus',
  other: 'Other credit',
  adjustment: 'Wallet adjustment',
  penalty: 'Penalty',
  event_adjustment: 'Event adjustment',
  invite: 'Invite reward',
  attendance: 'Attendance reward',
};

export function bucketLabel(bucket: string): string {
  return BUCKET_LABEL[bucket as Bucket] ?? bucket;
}

/**
 * Why a row is not on the board, in the words an admin would use to
 * answer the member. Each names the rule, and where the rule is a switch,
 * says so — the fix is one toggle away in the editor.
 */
const REASON_LABEL: Record<Reason, string> = {
  outside_window:         'Activity outside the window',
  manual_off:             'Manual sessions are off',
  walking_off:            'Walking is off',
  activity_not_included:  'Activity not in the event',
  streak_off:             'Streak bonuses are off',
  challenges_off:         'Challenge payouts are off',
  bonuses_off:            'Bonuses are off',
  adjustments_off:        'Wallet adjustments are off',
  never_counts:           'Never counts (invite / attendance reward)',
  no_anchor:              'No in-window activity to ride on',
  type_not_scored:        'Not a scoring row',
};

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Counted';
  return REASON_LABEL[reason as Reason] ?? reason;
}

/** True when the reason is a per-event switch the editor can flip. */
export function reasonIsSwitch(reason: string | null | undefined): boolean {
  return reason === 'manual_off' || reason === 'walking_off' || reason === 'streak_off'
    || reason === 'challenges_off' || reason === 'bonuses_off' || reason === 'adjustments_off'
    || reason === 'activity_not_included';
}

export interface RuleChip {
  key: string;
  label: string;
  on: boolean;
}

/**
 * The counting rules in force, as chips for the panel header — so the
 * numbers underneath are never read without the rules that made them.
 */
export function ruleChips(ev: Pick<ScoringEvent,
  'included_activities' | 'count_manual' | 'count_walking' | 'count_streak'
  | 'count_challenges' | 'count_bonuses' | 'count_adjustments'>): RuleChip[] {
  const acts = ev.included_activities;
  return [
    {
      key: 'activities',
      label: acts === null || acts === undefined
        ? 'All activities'
        : acts.length === 0 ? 'No activities' : acts.join(' · '),
      on: acts === null || acts === undefined || acts.length > 0,
    },
    { key: 'manual',      label: 'Manual sessions',    on: ev.count_manual },
    { key: 'walking',     label: 'Walking',            on: ev.count_walking },
    { key: 'streak',      label: 'Streak bonuses',     on: ev.count_streak },
    { key: 'challenges',  label: 'Challenge payouts',  on: ev.count_challenges },
    { key: 'bonuses',     label: 'Other bonuses',      on: ev.count_bonuses },
    { key: 'adjustments', label: 'Wallet adjustments', on: ev.count_adjustments },
  ];
}

/**
 * Buckets worth a column: any row has a non-zero figure in it. A table for
 * an event where only activity scores is one column wide, not eight.
 */
export function activeBuckets(rows: ScoringRow[]): Bucket[] {
  return BUCKETS
    .filter(b => rows.some(r => (r.by_bucket?.[b.key] ?? 0) !== 0))
    .map(b => b.key);
}

export interface ScoringTotals {
  points: number;
  byBucket: Record<Bucket, number>;
  excludedPoints: number;
  excludedRows: number;
  adjustmentsN: number;
  people: number;
}

export function scoringTotals(rows: ScoringRow[]): ScoringTotals {
  const byBucket: Record<Bucket, number> = {
    activity: 0,
    streak: 0,
    challenge: 0,
    bonus: 0,
    adjustment: 0,
    event_adjustment: 0,
    penalty: 0,
    other: 0,
    invite: 0,
    attendance: 0,
  };
  let points = 0, excludedPoints = 0, excludedRows = 0, adjustmentsN = 0;
  for (const r of rows) {
    points += r.points ?? 0;
    excludedPoints += r.excluded_points ?? 0;
    excludedRows += r.excluded_rows ?? 0;
    adjustmentsN += r.adjustments_n ?? 0;
    for (const b of BUCKETS) byBucket[b.key] += r.by_bucket?.[b.key] ?? 0;
  }
  return { points, byBucket, excludedPoints, excludedRows, adjustmentsN, people: rows.length };
}

/** Name to show for a row — the same fallback the app's League uses. */
export function rowName(r: { display_name?: string | null; username?: string | null }): string {
  return r.display_name ?? r.username ?? 'POWR member';
}

/** Case-insensitive match on name, username and POWR ID. */
export function searchScoringRows(rows: ScoringRow[], query: string): ScoringRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r =>
    (r.display_name ?? '').toLowerCase().includes(q)
    || (r.username ?? '').toLowerCase().includes(q)
    || (r.member_id ?? '').toLowerCase().includes(q));
}

/**
 * The excluded tally as one line: "12 pts · manual off, activity outside
 * the window". Reasons sorted by points lost so the biggest one leads.
 */
export function excludedSummary(r: Pick<ScoringRow, 'excluded_points' | 'excluded_rows' | 'excluded_by_reason'>): string {
  if (!r.excluded_rows) return '';
  const reasons = Object.entries(r.excluded_by_reason ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => reasonLabel(k).toLowerCase());
  return `${r.excluded_points} pts · ${reasons.join(', ')}`;
}

/** "Gym · 42 min · geofence at One LDN" — what the row was, for the ledger. */
export function ledgerRowTitle(row: LedgerRow): string {
  if (row.session_id) {
    const parts = [capitalise(row.activity ?? 'session')];
    if (row.duration_sec) parts.push(`${Math.round(row.duration_sec / 60)} min`);
    if (row.verification) parts.push(row.verification + (row.venue_name ? ` at ${row.venue_name}` : ''));
    return parts.join(' · ');
  }
  const label = bucketLabel(row.bucket);
  const src = row.source ? row.source.replace(/_/g, ' ') : null;
  return src && src !== label.toLowerCase() ? `${label} · ${src}` : label;
}

function capitalise(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function csvCell(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

/** Per-person breakdown, one row each — what Jamie hands to whoever pays prizes. */
export function scoringCsv(rows: ScoringRow[]): string {
  const header = [
    'rank', 'name', 'username', 'powr_id', 'points',
    ...BUCKETS.map(b => b.key),
    'counted_rows', 'counted_sessions', 'excluded_points', 'excluded_rows', 'excluded_reasons', 'last_counted',
  ].join(',');
  const lines = rows.map(r => [
    r.rank, csvCell(r.display_name), csvCell(r.username), csvCell(r.member_id), r.points,
    ...BUCKETS.map(b => r.by_bucket?.[b.key] ?? 0),
    r.counted_rows, r.counted_sessions, r.excluded_points, r.excluded_rows,
    csvCell(Object.entries(r.excluded_by_reason ?? {}).map(([k, v]) => `${reasonLabel(k)} ${v}`).join('; ')),
    csvCell(r.last_counted_at),
  ].join(','));
  return [header, ...lines].join('\n');
}

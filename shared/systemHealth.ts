// Admin System Health — the interpretation layer.
//
// The RPCs in 20260825170000_admin_system_health.sql return FACTS: numerators,
// denominators, counts, timestamps. Everything in this file is the JUDGEMENT
// applied on top — which workstream a signal belongs to, the threshold that
// turns it amber or red, and the sentence that says why. Same split as
// shared/liveops.ts, same reason: these rules will be wrong sometimes, and a rule
// that is wrong in SQL is invisible. Every one is covered in
// __tests__/systemHealth.test.ts, and the threshold VALUES are pinned there so a
// change shows up as a test diff, not a quiet edit.
//
// THE RULES:
//   • `unknown` is a real status. A source that is reset, missing or not yet
//     built renders as unknown — never as green. Green means "measured and fine".
//   • Rates are never shipped as rates. `pct(n, d)` returns null when nothing was
//     measurable, and null renders as "—", never as 0%. (Rendering null as 0% is
//     exactly the misread that made the 08-12 Live Ops board say "0 pushes
//     proven drawn".)
//   • Cumulative sources (pg_stat_statements, pg_stat_database) are judged on
//     the RECENT interval derived from two snapshots when there are two, and on
//     the lifetime mean — labelled as such — when there aren't.
//   • A workstream's status is the WORST of its signals. Six cards, one answer.

// ── Workstreams ──────────────────────────────────────────────────────────────

export type Workstream = 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'integrity';

export interface WorkstreamInfo {
  key: Workstream;
  title: string;
  /** What breaks, in one line. */
  what: string;
  /** What "act" means — the change to make when the cards go red. */
  action: string;
}

export const WORKSTREAMS: WorkstreamInfo[] = [
  {
    key: 'W1',
    title: 'Ledger',
    what: 'Two triggers re-sum a member\'s entire lifetime ledger on every earn insert. Cost grows with tenure, not user count.',
    action: 'Materialise the balance (shadow-first, reconcile, then repoint the two triggers and the user_balances view).',
  },
  {
    key: 'W2',
    title: 'Claim chain',
    what: 'claim-points is ~35 auto-commit calls with no transaction; an isolate dying mid-chain leaves a half-paid check-in.',
    action: 'Wrap the write steps (10–11c) in one advisory-locked RPC. Writes only — never a full port of the scoring rules.',
  },
  {
    key: 'W3',
    title: 'Beacon',
    what: 'gym-visit-beacon wakes at most 200 visits per stage per minute — a platform-wide ceiling compute cannot raise.',
    action: 'Record due_count before the limit (P2), then shard the pass and batch the push fan-out.',
  },
  {
    key: 'W4',
    title: 'Relay',
    what: 'Every background claim and every DB-triggered push rides pg_net: one worker, 200 per tick, no receipt, no retry.',
    action: 'A durable queue with retries and a dead-letter path. Pushes need a dedupe key first — they are not idempotent.',
  },
  {
    key: 'W5',
    title: 'Database',
    what: 'Micro tier: 2 shared vCPU, 1 GB, 60 connections. Connection exhaustion becomes PostgREST 504s.',
    action: 'Move up a compute tier, off-peak (it restarts Postgres). Not before W1 and W3 — you would pay more for the same ceilings.',
  },
  {
    key: 'integrity',
    title: 'Integrity',
    what: 'Invariants that must hold at any scale. Non-zero means something is already wrong, not that something is getting slow.',
    action: 'Investigate the rows in the detail. These are field-incident classes with no other alarm.',
  },
];

// ── Signals ──────────────────────────────────────────────────────────────────

export type Status = 'green' | 'watch' | 'act' | 'unknown';

// 'ratio_numerator': the SQL already reduced the value (a p95) and put it in the
// numerator; the denominator is the sample count, for evidence only. Kept as a
// distinct kind so `value()` never divides a percentile by its sample size.
export type Kind = 'count' | 'ratio' | 'pct' | 'ratio_numerator';

export interface Threshold {
  watch: number;
  act: number;
  /** 'above' — larger is worse. 'below' — smaller is worse (cache hit). */
  direction: 'above' | 'below';
}

export interface Signal {
  key: string;
  workstream: Workstream;
  label: string;
  /** How numerator/denominator become a value. */
  kind: Kind;
  /** Display unit, appended to the value. */
  unit: string;
  /** null = trend only, never judged (db size). */
  threshold: Threshold | null;
  /** The source is cumulative since a stats reset; judge on the interval when possible. */
  cumulative?: boolean;
  /** One line: why this threshold, what it protects. */
  why: string;
}

export const SIGNALS: Signal[] = [
  // W1 — Ledger
  {
    key: 'ledger.insert_mean_ms', workstream: 'W1', label: 'Earn-insert mean time', kind: 'ratio', unit: 'ms',
    threshold: { watch: 75, act: 150, direction: 'above' }, cumulative: true,
    why: 'Includes both lifetime-sum triggers and the rewards scan. This is the "points landed" latency a member feels. 33–52 ms at 2,880 rows.',
  },
  {
    key: 'ledger.rows_per_user', workstream: 'W1', label: 'Ledger rows — heaviest member', kind: 'count', unit: 'rows',
    threshold: { watch: 1000, act: 2500, direction: 'above' },
    why: 'The trigger sum is O(rows for that member). Rises with tenure and zero user growth. Max today: 403.',
  },
  {
    key: 'ledger.total_rows', workstream: 'W1', label: 'Ledger total rows', kind: 'count', unit: 'rows',
    threshold: { watch: 250_000, act: 1_000_000, direction: 'above' },
    why: 'Planner choices inside the triggers get expensive here.',
  },
  {
    key: 'ledger.balance_drift', workstream: 'W1', label: 'Balance drift (post-W1)', kind: 'count', unit: 'members',
    threshold: { watch: 1, act: 5, direction: 'above' },
    why: 'Once a materialised balance exists this is THE invariant. Unknown until W1 ships.',
  },

  // W2 — Claim chain
  {
    key: 'claims.partial_24h', workstream: 'W2', label: 'Partial claims, 24h', kind: 'count', unit: '',
    threshold: { watch: 1, act: 3, direction: 'above' },
    why: 'Earn row landed but the visit stamp or the earn row is missing — the isolate died between steps 10 and 11c.',
  },
  {
    key: 'claims.wall_p95_s', workstream: 'W2', label: 'Wake → claim p95', kind: 'ratio_numerator', unit: 's',
    threshold: { watch: 8, act: 20, direction: 'above' },
    why: 'Bounded by the PostgREST statement timeout and the client outbox\'s patience.',
  },
  {
    key: 'claims.rate_limited_24h', workstream: 'W2', label: 'Proven claims answered 429, 24h', kind: 'count', unit: '',
    threshold: { watch: 1, act: 3, direction: 'above' },
    why: 'The 2026-08-13 class: a health-sync batch spent the 3/hour cap before a proven gym claim arrived. Must stay at zero.',
  },
  {
    key: 'claims.cap_overshoot_7d', workstream: 'W2', label: 'Daily-cap overshoots, 7d', kind: 'count', unit: 'member-days',
    threshold: { watch: 1, act: 3, direction: 'above' },
    why: 'Two claims raced the read-then-write cap check for one member. The DB trigger does not backstop the service path.',
  },

  // W3 — Beacon
  {
    key: 'beacon.due_per_tick', workstream: 'W3', label: 'Visits due per tick (max, 24h)', kind: 'count', unit: '',
    threshold: { watch: 100, act: 160, direction: 'above' },
    why: 'The cap is 200. At 160 the next busy evening hits it and everyone past #200 never wakes. Unknown until P2 ships.',
  },
  {
    key: 'beacon.tick_p95_s', workstream: 'W3', label: 'Beacon tick p95', kind: 'ratio_numerator', unit: 's',
    threshold: { watch: 30, act: 45, direction: 'above' },
    why: 'Runs every 60 s. Past ~55 s ticks overlap and the settle/pursuit passes starve behind the nudge pass.',
  },
  {
    key: 'beacon.failures_24h', workstream: 'W3', label: 'Beacon failed runs, 24h', kind: 'count', unit: '',
    threshold: { watch: 1, act: 5, direction: 'above' },
    why: 'A dead beacon means no background claims platform-wide.',
  },
  {
    key: 'beacon.push_fail_pct_24h', workstream: 'W3', label: 'Wake push failure rate, 24h', kind: 'pct', unit: '%',
    threshold: { watch: 10, act: 30, direction: 'above' },
    why: 'The 08-12 read was 116 sent / 722 failed. Null when no wakes were attempted — not 0%.',
  },

  // W4 — Relay
  {
    key: 'relay.queue_depth', workstream: 'W4', label: 'pg_net queue depth', kind: 'count', unit: '',
    threshold: { watch: 50, act: 200, direction: 'above' },
    why: 'batch_size is 200. Above it the single worker is behind by definition.',
  },
  {
    key: 'relay.fail_pct_24h', workstream: 'W4', label: 'Relay failure rate (pg_net window)', kind: 'pct', unit: '%',
    threshold: { watch: 2, act: 10, direction: 'above' },
    why: 'These failures leave no receipt anywhere else — net._http_response is the only witness, and pg_net.ttl purges it after 6 h, so this is a ~6 h window, not 24 h. The hourly snapshot is what makes it a day.',
  },
  {
    key: 'relay.volume_24h', workstream: 'W4', label: 'Relay requests (pg_net window)', kind: 'count', unit: '',
    threshold: { watch: 1500, act: 5000, direction: 'above' },
    why: 'Every DB-triggered push and every cron-invoked edge function shares the one worker with the claim relay. ~6 h window (pg_net.ttl), so the thresholds are a quarter of the day-rate ones.',
  },

  // W5 — Database
  {
    key: 'db.connections_pct', workstream: 'W5', label: 'Connections in use', kind: 'pct', unit: '%',
    threshold: { watch: 60, act: 80, direction: 'above' },
    why: 'Micro\'s hard wall is 60. This is what turns into PostgREST 504s.',
  },
  {
    key: 'db.cache_hit_pct', workstream: 'W5', label: 'Buffer cache hit', kind: 'pct', unit: '%',
    threshold: { watch: 99, act: 95, direction: 'below' }, cumulative: true,
    why: 'shared_buffers is 224 MB. Below 99% the working set no longer fits and every trigger sum goes to disk.',
  },
  {
    key: 'db.longest_query_s', workstream: 'W5', label: 'Longest running query', kind: 'count', unit: 's',
    threshold: { watch: 5, act: 30, direction: 'above' },
    why: 'Lock pile-ups behind a slow trigger show here first.',
  },
  {
    key: 'db.dead_tuple_pct', workstream: 'W5', label: 'Dead tuples, worst hot table', kind: 'pct', unit: '%',
    threshold: { watch: 20, act: 50, direction: 'above' },
    why: 'Autovacuum falling behind on Micro\'s CPU share.',
  },
  {
    key: 'db.size_bytes', workstream: 'W5', label: 'Database size', kind: 'count', unit: 'B',
    threshold: null,
    why: 'Trend only. Feeds the compute conversation.',
  },

  // Integrity
  {
    key: 'integrity.dup_earns', workstream: 'integrity', label: 'Sessions with duplicate earns', kind: 'count', unit: '',
    threshold: { watch: 1, act: 1, direction: 'above' },
    why: 'The unique index guards (session, description) only. The 05-29 race class.',
  },
  {
    key: 'integrity.open_visits_12h', workstream: 'integrity', label: 'Open visits older than 12h', kind: 'count', unit: '',
    threshold: { watch: 1, act: 1, direction: 'above' },
    why: 'The reaper invariant: nothing stays open past 12h.',
  },
  {
    key: 'integrity.proven_unpaid_24h', workstream: 'integrity', label: 'Proven but unpaid visits, 24h', kind: 'count', unit: '',
    threshold: { watch: 1, act: 1, direction: 'above' },
    why: 'Presence proven for the full dwell, visit closed, no claim. The 08-13 class — nothing else records it.',
  },
  {
    key: 'integrity.evidence_gap_7d', workstream: 'integrity', label: 'Journeys with purged evidence, 7d', kind: 'count', unit: '',
    threshold: { watch: 1, act: 1, direction: 'above' },
    why: 'A journey rolled up after its raw rows were purged. The "publish a lie" guard.',
  },
  {
    key: 'integrity.postgrest_cap', workstream: 'integrity', label: 'Largest unbounded read', kind: 'count', unit: 'rows',
    threshold: { watch: 700, act: 1000, direction: 'above' },
    why: 'PostgREST silently truncates every response at 1000 rows. A member\'s own ledger and sessions are read unbounded.',
  },
  {
    key: 'integrity.cron_silent', workstream: 'integrity', label: 'Silent cron jobs', kind: 'count', unit: '',
    threshold: { watch: 1, act: 1, direction: 'above' },
    why: 'A dead cron fails silently — there is no other alarm.',
  },
];

// ── Facts, as the RPC ships them ─────────────────────────────────────────────

export interface Fact {
  numerator: number | null;
  denominator: number | null;
  detail?: Record<string, unknown> | null;
  evidence_ok: boolean;
  error?: string;
}

export interface LiveDoc {
  captured_at: string;
  signals: Record<string, Fact>;
  pss_stats_reset: string | null;
  db_stats_reset: string | null;
  last_snapshot_at: string | null;
}

/** [captured_at, numerator, denominator, evidence_ok] */
export type HistoryPoint = [string, number | null, number | null, boolean];
export type HistoryDoc = Record<string, HistoryPoint[]>;

// ── Arithmetic ───────────────────────────────────────────────────────────────

/** Percent, or null when nothing was measurable. Never 0% for "no data". */
export function pct(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || !(denominator > 0)) return null;
  return (numerator / denominator) * 100;
}

/** numerator / denominator, or null when nothing was measurable. */
export function ratio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || !(denominator > 0)) return null;
  return numerator / denominator;
}

/** The judged value of a fact, per the signal's kind. Null = not measurable. */
export function value(signal: Signal, fact: Fact | null | undefined): number | null {
  if (!fact || !fact.evidence_ok) return null;
  switch (signal.kind) {
    case 'count':
    case 'ratio_numerator':
      return fact.numerator == null ? null : Number(fact.numerator);
    case 'ratio':
      return ratio(fact.numerator, fact.denominator);
    case 'pct':
      return pct(fact.numerator, fact.denominator);
    default:
      return null;
  }
}

/**
 * For a CUMULATIVE source, the value over the interval between two snapshots:
 * Δnumerator / Δdenominator. Null when there are not two usable points, when
 * the counters went backwards (a stats reset), or when nothing happened in the
 * interval. This is what "recent" means for pg_stat_* signals.
 */
export function intervalValue(signal: Signal, points: HistoryPoint[] | undefined): number | null {
  if (!points || points.length < 2) return null;
  const usable = points.filter(p => p[3] && p[1] != null && p[2] != null);
  if (usable.length < 2) return null;
  const a = usable[usable.length - 2];
  const b = usable[usable.length - 1];
  const dn = Number(b[1]) - Number(a[1]);
  const dd = Number(b[2]) - Number(a[2]);
  if (dn < 0 || dd < 0) return null;  // reset between the two
  if (dd === 0) return null;          // no traffic — nothing measurable
  return signal.kind === 'pct' ? (dn / dd) * 100 : dn / dd;
}

// ── Judgement ────────────────────────────────────────────────────────────────

export interface Verdict {
  status: Status;
  value: number | null;
  /** Human sentence: what the number is, against what. */
  reason: string;
  /** True when the number shown is a lifetime mean rather than a recent interval. */
  lifetime?: boolean;
}

function breach(t: Threshold, v: number, level: 'watch' | 'act'): boolean {
  const bound = t[level];
  return t.direction === 'above' ? v >= bound : v <= bound;
}

export function judgeValue(signal: Signal, v: number | null, opts: { lifetime?: boolean } = {}): Verdict {
  if (v == null) {
    return { status: 'unknown', value: null, reason: 'Not measurable — no evidence in this window.' };
  }
  const t = signal.threshold;
  if (!t) {
    return { status: 'green', value: v, reason: 'Trend only — no threshold.', lifetime: opts.lifetime };
  }
  const shown = `${formatValue(signal, v)}`;
  const cmp = t.direction === 'above' ? '≥' : '≤';
  if (breach(t, v, 'act')) {
    return { status: 'act', value: v, reason: `${shown} — at or past the act line (${cmp} ${formatValue(signal, t.act)}).`, lifetime: opts.lifetime };
  }
  if (breach(t, v, 'watch')) {
    return { status: 'watch', value: v, reason: `${shown} — past the watch line (${cmp} ${formatValue(signal, t.watch)}), under act (${formatValue(signal, t.act)}).`, lifetime: opts.lifetime };
  }
  return { status: 'green', value: v, reason: `${shown} — under the watch line (${formatValue(signal, t.watch)}).`, lifetime: opts.lifetime };
}

/**
 * Judge one signal from the live fact plus its history. Cumulative signals
 * prefer the last snapshot interval; when that is not available they fall back
 * to the lifetime value and SAY so.
 */
export function judge(signal: Signal, fact: Fact | null | undefined, history?: HistoryPoint[]): Verdict {
  if (!fact) return { status: 'unknown', value: null, reason: 'No fact returned for this signal.' };
  if (!fact.evidence_ok) {
    const note = (fact.detail && typeof fact.detail.note === 'string') ? fact.detail.note
      : fact.error ? `Source unavailable: ${fact.error}` : 'Evidence not available.';
    return { status: 'unknown', value: null, reason: note };
  }
  if (signal.cumulative) {
    const recent = intervalValue(signal, history);
    if (recent != null) return judgeValue(signal, recent);
    return judgeValue(signal, value(signal, fact), { lifetime: true });
  }
  return judgeValue(signal, value(signal, fact));
}

const STATUS_RANK: Record<Status, number> = { act: 3, watch: 2, unknown: 1, green: 0 };

export function worstStatus(statuses: Status[]): Status {
  if (statuses.length === 0) return 'unknown';
  return statuses.reduce((w, s) => (STATUS_RANK[s] > STATUS_RANK[w] ? s : w), 'green' as Status);
}

export interface Judged { signal: Signal; verdict: Verdict; fact: Fact | null }

export function judgeAll(doc: LiveDoc | null | undefined, history?: HistoryDoc | null): Judged[] {
  return SIGNALS.map(signal => {
    const fact = doc?.signals?.[signal.key] ?? null;
    return { signal, fact, verdict: judge(signal, fact, history?.[signal.key]) };
  });
}

/** Worst-of per workstream. A workstream with no judged signals is unknown. */
export function workstreamStatus(judged: Judged[]): Record<Workstream, Status> {
  const out = {} as Record<Workstream, Status>;
  for (const w of WORKSTREAMS) {
    out[w.key] = worstStatus(judged.filter(j => j.signal.workstream === w.key).map(j => j.verdict.status));
  }
  return out;
}

/** The signal that decides a workstream's card — the worst one, first on ties. */
export function drivingSignal(judged: Judged[], workstream: Workstream): Judged | null {
  const mine = judged.filter(j => j.signal.workstream === workstream);
  if (mine.length === 0) return null;
  return mine.reduce((w, j) => (STATUS_RANK[j.verdict.status] > STATUS_RANK[w.verdict.status] ? j : w), mine[0]);
}

/** Count feeding the admin dashboard tile: signals at ACT. */
export function needsAttentionCount(judged: Judged[]): number {
  return judged.filter(j => j.verdict.status === 'act').length;
}

/** Sort for the table: act → watch → unknown → green, stable within a level. */
export function sortJudged(judged: Judged[]): Judged[] {
  return [...judged].sort((a, b) => STATUS_RANK[b.verdict.status] - STATUS_RANK[a.verdict.status]);
}

// ── Evidence notes ───────────────────────────────────────────────────────────

/** Banner lines for sources that are reset or unavailable. Empty = nothing to say. */
export function evidenceNotes(doc: LiveDoc | null | undefined, judged: Judged[], nowMs: number): string[] {
  if (!doc) return [];
  const notes: string[] = [];
  const DAY = 86_400_000;
  if (doc.pss_stats_reset) {
    const age = nowMs - Date.parse(doc.pss_stats_reset);
    if (age < DAY) notes.push(`pg_stat_statements reset ${formatAgo(doc.pss_stats_reset, nowMs)} — ledger timings are a short sample until ~24h of traffic.`);
  }
  if (doc.db_stats_reset) {
    const age = nowMs - Date.parse(doc.db_stats_reset);
    if (age < DAY) notes.push(`Postgres stats reset ${formatAgo(doc.db_stats_reset, nowMs)} — cache-hit is a short sample.`);
  }
  const unavailable = judged.filter(j => j.fact && !j.fact.evidence_ok && j.fact.error);
  for (const j of unavailable) notes.push(`${j.signal.label}: source unavailable (${j.fact!.error}).`);
  if (!doc.last_snapshot_at) notes.push('No snapshots yet — trends and interval rates appear after the first hourly capture.');
  return notes;
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatValue(signal: Signal, v: number | null | undefined): string {
  if (v == null) return '—';
  if (signal.unit === 'B') return formatBytes(v);
  if (signal.unit === '%') return `${v.toFixed(v >= 10 ? 0 : 1)}%`;
  if (signal.unit === 'ms') return `${v.toFixed(v >= 100 ? 0 : 1)} ms`;
  if (signal.unit === 's') return `${v.toFixed(v >= 10 ? 0 : 1)} s`;
  const n = Number.isInteger(v) ? v.toLocaleString('en-GB') : v.toFixed(1);
  return signal.unit ? `${n} ${signal.unit}` : n;
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function formatAgo(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Series of judged values for a sparkline. Nulls are gaps, never zeros. */
export function sparkSeries(signal: Signal, points: HistoryPoint[] | undefined): Array<number | null> {
  if (!points) return [];
  if (signal.cumulative) {
    // Interval values between consecutive usable points.
    const out: Array<number | null> = [];
    for (let i = 1; i < points.length; i++) {
      out.push(intervalValue(signal, points.slice(i - 1, i + 1)));
    }
    return out;
  }
  return points.map(p => {
    if (!p[3]) return null;
    return value(signal, { numerator: p[1], denominator: p[2], evidence_ok: true });
  });
}

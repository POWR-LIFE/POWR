import {
  REARM_SKIPPED_ROW_INTERVAL_MS,
  rearmSkippedDecision,
  rearmSkippedFlush,
  type RearmSkippedTally,
} from '@/lib/rearmSkippedTally';

const T0 = 1_757_000_000_000;
const MIN = 60_000;

/** Replays `n` refusals of one reason `stepMs` apart, returning the rows that went out. */
function replay(n: number, stepMs: number, reason = 'background_would_destroy') {
  let state: RearmSkippedTally | null = null;
  const rows: Array<{ at: number; count: number; window_s: number }> = [];
  for (let i = 0; i < n; i++) {
    const now = T0 + i * stepMs;
    const d = rearmSkippedDecision(state, reason, now);
    state = d.next;
    if (d.emit) rows.push({ at: now, count: d.row.count, window_s: d.row.window_s });
  }
  return { rows, state };
}

describe('rearmSkippedDecision — one row per half hour, never a silent first refusal', () => {
  it('reports the first refusal at once, with count 1', () => {
    const d = rearmSkippedDecision(null, 'background_would_destroy', T0);
    expect(d.emit).toBe(true);
    if (d.emit) expect(d.row).toEqual({ reason: 'background_would_destroy', count: 1, window_s: 0 });
    expect(d.next).toEqual({ reason: 'background_would_destroy', count: 0, since: T0, lastRowAt: T0 });
  });

  it('a stream asking every minute for two hours produces 5 rows, not 120', () => {
    const { rows } = replay(120, MIN);
    // t=0 (first), then every 30 min: t=30, 60, 90 — and nothing at 120 (loop ends at 119).
    expect(rows.map(r => (r.at - T0) / MIN)).toEqual([0, 30, 60, 90]);
    // Each later row stands for the refusals since the previous row.
    expect(rows.slice(1).map(r => r.count)).toEqual([30, 30, 30]);
    expect(rows.slice(1).every(r => r.window_s === 30 * 60)).toBe(true);
  });

  it('the row after the interval carries the count of refusals it stands for', () => {
    const { rows } = replay(3, REARM_SKIPPED_ROW_INTERVAL_MS);
    expect(rows.map(r => r.count)).toEqual([1, 1, 1]); // one refusal per interval → count 1 each
  });

  it('a different reason is reported immediately, on its own tally', () => {
    let state: RearmSkippedTally | null = null;
    state = rearmSkippedDecision(state, 'background_would_destroy', T0).next;
    state = rearmSkippedDecision(state, 'background_would_destroy', T0 + MIN).next;
    const d = rearmSkippedDecision(state, 'no_trusted_fix', T0 + 2 * MIN);
    expect(d.emit).toBe(true);
    if (d.emit) expect(d.row).toEqual({ reason: 'no_trusted_fix', count: 1, window_s: 0 });
  });
});

describe('rearmSkippedFlush — a successful arm ships what is pending', () => {
  it('returns the pending count and clears the tally', () => {
    const { state } = replay(10, MIN); // first row at t=0, then 9 pending
    expect(state?.count).toBe(9);
    const f = rearmSkippedFlush(state, T0 + 10 * MIN);
    expect(f.row).toEqual({ reason: 'background_would_destroy', count: 9, window_s: 10 * 60 });
    expect(f.next).toBeNull();
  });

  it('is silent when nothing is pending', () => {
    expect(rearmSkippedFlush(null, T0)).toEqual({ row: null, next: null });
    const fresh = rearmSkippedDecision(null, 'background_would_destroy', T0).next;
    expect(rearmSkippedFlush(fresh, T0 + MIN).row).toBeNull();
  });
});

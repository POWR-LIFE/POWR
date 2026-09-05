import {
  Fact,
  HistoryPoint,
  LiveDoc,
  SIGNALS,
  WORKSTREAMS,
  drivingSignal,
  evidenceNotes,
  formatValue,
  intervalValue,
  judge,
  judgeAll,
  judgeValue,
  needsAttentionCount,
  pct,
  ratio,
  sortJudged,
  sparkSeries,
  value,
  workstreamStatus,
  worstStatus,
} from '@/shared/systemHealth';

const NOW = Date.parse('2026-08-25T18:00:00.000Z');
const sig = (key: string) => {
  const s = SIGNALS.find(x => x.key === key);
  if (!s) throw new Error(`no signal ${key}`);
  return s;
};
const fact = (over: Partial<Fact> = {}): Fact => ({ numerator: 0, denominator: null, detail: null, evidence_ok: true, ...over });

// A doc where every MEASURABLE signal is green: zero counts, a full cache, and
// the two by-design unknowns (balance drift → W1, due-per-tick → P2) left as the
// SQL ships them — evidence_ok=false. Tests override single signals from here.
const greenDoc = (): LiveDoc => {
  const signals: Record<string, Fact> = Object.fromEntries(SIGNALS.map(s => [s.key, fact({ numerator: 0, denominator: 1 })]));
  signals['db.cache_hit_pct'] = fact({ numerator: 100, denominator: 100 });
  signals['ledger.balance_drift'] = fact({ numerator: null, denominator: null, evidence_ok: false, detail: { note: 'W1 not shipped' } });
  signals['beacon.due_per_tick'] = fact({ numerator: null, denominator: null, evidence_ok: false, detail: { note: 'P2 not shipped' } });
  return { captured_at: '2026-08-25T18:00:00Z', pss_stats_reset: null, db_stats_reset: null, last_snapshot_at: '2026-08-25T17:00:00Z', signals };
};

// ── The pinned list ──────────────────────────────────────────────────────────
// A threshold edit must show up as a test diff. If you are changing a number
// here, the `why` on the signal has to say why.

describe('SIGNALS are pinned', () => {
  it('every signal has a unique key and a known workstream', () => {
    const keys = SIGNALS.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const ws = new Set(WORKSTREAMS.map(w => w.key));
    for (const s of SIGNALS) expect(ws.has(s.workstream)).toBe(true);
  });

  it('thresholds are the 2026-08-25 first pass', () => {
    const t = Object.fromEntries(SIGNALS.map(s => [s.key, s.threshold && [s.threshold.watch, s.threshold.act, s.threshold.direction]]));
    expect(t).toEqual({
      'ledger.insert_mean_ms':     [75, 150, 'above'],
      'ledger.rows_per_user':      [1000, 2500, 'above'],
      'ledger.total_rows':         [250_000, 1_000_000, 'above'],
      'ledger.balance_drift':      [1, 5, 'above'],
      'claims.partial_24h':        [1, 3, 'above'],
      'claims.wall_p95_s':         [8, 20, 'above'],
      'claims.rate_limited_24h':   [1, 3, 'above'],
      'claims.cap_overshoot_7d':   [1, 3, 'above'],
      'beacon.due_per_tick':       [100, 160, 'above'],
      'beacon.tick_p95_s':         [30, 45, 'above'],
      'beacon.failures_24h':       [1, 5, 'above'],
      'beacon.push_fail_pct_24h':  [10, 30, 'above'],
      'relay.queue_depth':         [50, 200, 'above'],
      'relay.fail_pct_24h':        [2, 10, 'above'],
      'relay.volume_24h':          [1500, 5000, 'above'],
      'db.connections_pct':        [60, 80, 'above'],
      'db.cache_hit_pct':          [99, 95, 'below'],
      'db.longest_query_s':        [5, 30, 'above'],
      'db.dead_tuple_pct':         [20, 50, 'above'],
      'db.size_bytes':             null,
      'integrity.dup_earns':       [1, 1, 'above'],
      'integrity.open_visits_12h': [1, 1, 'above'],
      'integrity.proven_unpaid_24h': [1, 1, 'above'],
      'integrity.evidence_gap_7d': [1, 1, 'above'],
      'integrity.postgrest_cap':   [700, 1000, 'above'],
      'integrity.cron_silent':     [1, 1, 'above'],
    });
  });

  it('every signal carries a why and a plain-English line', () => {
    for (const s of SIGNALS) {
      expect(s.why.length).toBeGreaterThan(20);
      expect(s.plain.length).toBeGreaterThan(20);
      expect(s.plain).not.toMatch(/numerator|denominator|jsonb|pg_stat/);
    }
  });
});

// ── Arithmetic: null is null, never 0 ────────────────────────────────────────

describe('pct / ratio', () => {
  it('returns null when nothing was measurable', () => {
    expect(pct(0, 0)).toBeNull();
    expect(pct(5, null)).toBeNull();
    expect(pct(null, 5)).toBeNull();
    expect(ratio(0, 0)).toBeNull();
  });
  it('computes when it can', () => {
    expect(pct(1, 4)).toBe(25);
    expect(ratio(90, 3)).toBe(30);
  });
});

describe('value by kind', () => {
  it('count uses the numerator', () => {
    expect(value(sig('relay.queue_depth'), fact({ numerator: 7 }))).toBe(7);
  });
  it('ratio divides', () => {
    expect(value(sig('ledger.insert_mean_ms'), fact({ numerator: 500, denominator: 10 }))).toBe(50);
  });
  it('pct multiplies by 100', () => {
    expect(value(sig('db.connections_pct'), fact({ numerator: 30, denominator: 60 }))).toBe(50);
  });
  it('ratio_numerator never divides a percentile by its sample count', () => {
    expect(value(sig('claims.wall_p95_s'), fact({ numerator: 12.5, denominator: 40 }))).toBe(12.5);
  });
  it('evidence_ok=false is null regardless of numbers', () => {
    expect(value(sig('relay.queue_depth'), fact({ numerator: 7, evidence_ok: false }))).toBeNull();
  });
});

// ── Judgement ────────────────────────────────────────────────────────────────

describe('judgeValue', () => {
  const s = sig('relay.queue_depth'); // watch 50, act 200, above
  it('green under watch', () => expect(judgeValue(s, 10).status).toBe('green'));
  it('watch at the watch line', () => expect(judgeValue(s, 50).status).toBe('watch'));
  it('act at the act line', () => expect(judgeValue(s, 200).status).toBe('act'));
  it('unknown for null', () => expect(judgeValue(s, null).status).toBe('unknown'));
  it('direction below flips the comparison (cache hit)', () => {
    const c = sig('db.cache_hit_pct'); // watch 99, act 95, below
    expect(judgeValue(c, 99.9).status).toBe('green');
    expect(judgeValue(c, 98).status).toBe('watch');
    expect(judgeValue(c, 94).status).toBe('act');
  });
  it('trend-only signals are green with any value', () => {
    expect(judgeValue(sig('db.size_bytes'), 10 ** 12).status).toBe('green');
  });
  it('reason names the line it crossed', () => {
    expect(judgeValue(s, 60).reason).toMatch(/watch line/);
    expect(judgeValue(s, 250).reason).toMatch(/act line/);
  });
});

describe('judge: unknown is never green', () => {
  it('a missing fact is unknown', () => {
    expect(judge(sig('relay.queue_depth'), null).status).toBe('unknown');
  });
  it('evidence_ok=false is unknown and carries the note', () => {
    const v = judge(sig('beacon.due_per_tick'), fact({ evidence_ok: false, detail: { note: 'P2 not shipped' } }));
    expect(v.status).toBe('unknown');
    expect(v.reason).toBe('P2 not shipped');
  });
  it('a source error is unknown and says so', () => {
    const v = judge(sig('relay.queue_depth'), fact({ evidence_ok: false, error: 'permission denied' }));
    expect(v.status).toBe('unknown');
    expect(v.reason).toMatch(/permission denied/);
  });
  it('a zero-sample percentile is unknown, not green', () => {
    // SQL ships evidence_ok=false when samples=0; the TS must not invent a 0 s p95.
    expect(judge(sig('claims.wall_p95_s'), fact({ numerator: 0, denominator: 0, evidence_ok: false })).status).toBe('unknown');
  });
});

// ── Cumulative sources ───────────────────────────────────────────────────────

describe('intervalValue (cumulative pg_stat_* signals)', () => {
  const s = sig('ledger.insert_mean_ms');
  const pt = (t: string, n: number, d: number, ok = true): HistoryPoint => [t, n, d, ok];

  it('needs two usable points', () => {
    expect(intervalValue(s, undefined)).toBeNull();
    expect(intervalValue(s, [pt('a', 100, 2)])).toBeNull();
    expect(intervalValue(s, [pt('a', 100, 2, false), pt('b', 200, 4)])).toBeNull();
  });
  it('is Δnumerator / Δdenominator over the LAST two points', () => {
    // lifetime mean 50 ms, but the last hour ran at 100 ms
    expect(intervalValue(s, [pt('a', 0, 0), pt('b', 1000, 20), pt('c', 4000, 50)])).toBe(100);
  });
  it('a reset between the points is null, not a negative rate', () => {
    expect(intervalValue(s, [pt('a', 5000, 100), pt('b', 50, 1)])).toBeNull();
  });
  it('no traffic in the interval is null, not 0', () => {
    expect(intervalValue(s, [pt('a', 5000, 100), pt('b', 5000, 100)])).toBeNull();
  });
  it('pct kind multiplies the interval by 100', () => {
    const c = sig('db.cache_hit_pct');
    expect(intervalValue(c, [pt('a', 900, 1000), pt('b', 1000, 1200)])).toBe(50);
  });
  it('an interval under minSample is not measurable, whatever its mean', () => {
    // 2026-08-27 06:00: four inserts averaging 473 ms — a data point, not an outage.
    expect(s.minSample).toBe(20);
    expect(intervalValue(s, [pt('a', 100000, 3000), pt('b', 101892, 3004)])).toBeNull();
    // exactly minSample is judged
    expect(intervalValue(s, [pt('a', 100000, 3000), pt('b', 102000, 3020)])).toBe(100);
  });
  it('minSample only applies where a signal sets it', () => {
    const c = sig('db.cache_hit_pct');
    expect(c.minSample).toBeUndefined();
    expect(intervalValue(c, [pt('a', 900, 1000), pt('b', 902, 1002)])).toBe(100);
  });
});

describe('minSample on the timeline', () => {
  it('a thin hour is grey, not red, and falls out of uptime', () => {
    const s = sig('ledger.insert_mean_ms');
    const points: HistoryPoint[] = [
      ['2026-08-27T05:00:00Z', 100000, 3000, true],
      ['2026-08-27T06:00:00Z', 101892, 3004, true], // 4 inserts @ 473 ms
      ['2026-08-27T07:00:00Z', 103000, 3030, true], // 26 inserts @ 43 ms
    ];
    expect(judgeHistoryPoint(s, points, 1).status).toBe('unknown');
    expect(judgeHistoryPoint(s, points, 2).status).toBe('green');
  });
});

describe('minSample on a percentile (claims.wall_p95_s)', () => {
  const s = sig('claims.wall_p95_s');
  it('is pinned at 20 samples', () => expect(s.minSample).toBe(20));
  it('eleven claims cannot make a p95 verdict, however slow the slowest', () => {
    // 2026-08-30: one 34 s claim among eleven → p95 34 s → two red days.
    const v = judge(s, fact({ numerator: 33.9, denominator: 11 }));
    expect(v.status).toBe('unknown');
    expect(v.value).toBeNull();
    expect(v.reason).toMatch(/11 samples/);
  });
  it('exactly minSample is judged', () => {
    expect(judge(s, fact({ numerator: 33.9, denominator: 20 })).status).toBe('act');
    expect(judge(s, fact({ numerator: 2.1, denominator: 20 })).status).toBe('green');
  });
  it('no denominator at all is a thin sample, not a verdict', () => {
    expect(judge(s, fact({ numerator: 33.9, denominator: null })).status).toBe('unknown');
  });
  it('the timeline applies the same floor, so a thin day is grey not red', () => {
    const points: HistoryPoint[] = [
      ['2026-08-30T11:00:00Z', 33.9, 11, true],
      ['2026-08-30T12:00:00Z', 33.9, 25, true],
    ];
    expect(judgeHistoryPoint(s, points, 0).status).toBe('unknown');
    expect(judgeHistoryPoint(s, points, 1).status).toBe('act');
  });
  it('a percentile without minSample is judged on any sample', () => {
    const b = sig('beacon.tick_p95_s');
    expect(b.minSample).toBeUndefined();
    expect(judge(b, fact({ numerator: 0.07, denominator: null })).status).toBe('green');
  });
});

describe('judge on a cumulative signal', () => {
  const s = sig('ledger.insert_mean_ms');
  it('prefers the interval and is not flagged lifetime', () => {
    const v = judge(s, fact({ numerator: 4000, denominator: 50 }), [['a', 1000, 20, true], ['b', 4000, 50, true]]);
    expect(v.value).toBe(100);
    expect(v.status).toBe('watch');
    expect(v.lifetime).toBeFalsy();
  });
  it('falls back to lifetime and SAYS so when there is no interval', () => {
    const v = judge(s, fact({ numerator: 2000, denominator: 40 }), []);
    expect(v.value).toBe(50);
    expect(v.lifetime).toBe(true);
  });
});

// ── Roll-ups ─────────────────────────────────────────────────────────────────

describe('worstStatus / workstreamStatus / drivingSignal', () => {
  it('worst-of ranks act > watch > unknown > green', () => {
    expect(worstStatus(['green', 'unknown'])).toBe('unknown');
    expect(worstStatus(['green', 'watch', 'unknown'])).toBe('watch');
    expect(worstStatus(['act', 'watch'])).toBe('act');
    expect(worstStatus([])).toBe('unknown');
  });

  it('a workstream is its worst signal and the driving signal is that one', () => {
    const doc = greenDoc();
    doc.signals['relay.queue_depth'] = fact({ numerator: 300 });          // act
    doc.signals['relay.fail_pct_24h'] = fact({ numerator: 3, denominator: 100 }); // 3% → watch
    const judged = judgeAll(doc);
    const ws = workstreamStatus(judged);
    expect(ws.W4).toBe('act');
    expect(drivingSignal(judged, 'W4')!.signal.key).toBe('relay.queue_depth');
    // The two deliberately-unknown signals keep their workstreams honest.
    expect(ws.W1).toBe('unknown'); // balance_drift is unknown until W1
    expect(ws.W3).toBe('unknown'); // due_per_tick is unknown until P2
    expect(ws.W5).toBe('green');
    expect(ws.integrity).toBe('green');
  });

  it('needsAttentionCount counts ACT only', () => {
    const doc = greenDoc();
    doc.signals['integrity.dup_earns'] = fact({ numerator: 2 });
    doc.signals['relay.queue_depth'] = fact({ numerator: 60 }); // watch
    expect(needsAttentionCount(judgeAll(doc))).toBe(1);
  });

  it('sortJudged puts act first and green last', () => {
    const doc = greenDoc();
    doc.signals['integrity.open_visits_12h'] = fact({ numerator: 1 });
    const sorted = sortJudged(judgeAll(doc));
    expect(sorted[0].signal.key).toBe('integrity.open_visits_12h');
    expect(sorted[sorted.length - 1].verdict.status).toBe('green');
  });
});

// ── Evidence + formatting ────────────────────────────────────────────────────

describe('evidenceNotes', () => {
  it('flags a fresh stats reset and a missing first snapshot', () => {
    const doc: LiveDoc = {
      captured_at: '', pss_stats_reset: new Date(NOW - 3600_000).toISOString(), db_stats_reset: null, last_snapshot_at: null,
      signals: {},
    };
    const notes = evidenceNotes(doc, judgeAll(doc), NOW);
    expect(notes.some(n => /pg_stat_statements reset/.test(n))).toBe(true);
    expect(notes.some(n => /No snapshots yet/.test(n))).toBe(true);
  });
  it('is silent when the reset is old and snapshots exist', () => {
    const doc = greenDoc();
    doc.pss_stats_reset = '2026-02-27T13:06:52Z';
    expect(evidenceNotes(doc, judgeAll(doc), NOW)).toEqual([]);
  });
});

describe('formatValue', () => {
  it('never renders null as 0', () => {
    expect(formatValue(sig('db.connections_pct'), null)).toBe('—');
  });
  it('units', () => {
    expect(formatValue(sig('ledger.insert_mean_ms'), 42.4)).toBe('42.4 ms');
    expect(formatValue(sig('ledger.insert_mean_ms'), 142.4)).toBe('142 ms');
    expect(formatValue(sig('db.connections_pct'), 35)).toBe('35%');
    expect(formatValue(sig('db.size_bytes'), 265_289_728)).toBe('253 MB');
    expect(formatValue(sig('ledger.rows_per_user'), 2880)).toBe('2,880 rows');
  });
});

describe('sparkSeries', () => {
  it('maps unusable points to null gaps, not zeros', () => {
    const s = sig('relay.queue_depth');
    expect(sparkSeries(s, [['a', 3, null, true], ['b', 9, null, false], ['c', 4, null, true]])).toEqual([3, null, 4]);
  });
  it('cumulative signals chart the interval between consecutive points', () => {
    const s = sig('ledger.insert_mean_ms');
    expect(sparkSeries(s, [['a', 0, 0, true], ['b', 1000, 20, true], ['c', 4000, 50, true]])).toEqual([50, 100]);
  });
});

// ── Status page derivations ──────────────────────────────────────────────────

import {
  COMPONENTS,
  HistoryDoc,
  componentState,
  dayCells,
  hourlyTimeline,
  incidents,
  judgeHistoryPoint,
  uptimePct,
} from '@/shared/systemHealth';

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A history where every signal is green at every capture, then overridden per test. */
function greenHistory(captures: number[]): HistoryDoc {
  const h: HistoryDoc = {};
  for (const s of SIGNALS) {
    if (s.key === 'ledger.balance_drift' || s.key === 'beacon.due_per_tick') {
      h[s.key] = captures.map(t => [iso(t), null, null, false]);
    } else if (s.key === 'db.cache_hit_pct') {
      // cumulative: grows 1000 hits per hour, no misses → 100% on every interval
      h[s.key] = captures.map((t, i) => [iso(t), 1000 * (i + 1), 1000 * (i + 1), true]);
    } else if (s.key === 'ledger.insert_mean_ms') {
      h[s.key] = captures.map((t, i) => [iso(t), 40 * (i + 1), i + 1, true]); // 40 ms per interval
    } else {
      h[s.key] = captures.map(t => [iso(t), 0, 1, true]);
    }
  }
  return h;
}

describe('status page: components + state', () => {
  it('every workstream is a component, named for a person', () => {
    expect(COMPONENTS.map(c => c.key).sort()).toEqual(WORKSTREAMS.map(w => w.key).sort());
    for (const c of COMPONENTS) expect(c.name).not.toMatch(/^W\d$/);
  });
  it('maps status to status-page vocabulary', () => {
    expect(componentState('green')).toBe('operational');
    expect(componentState('watch')).toBe('degraded');
    expect(componentState('act')).toBe('disrupted');
    expect(componentState('unknown')).toBe('unknown');
  });
});

describe('judgeHistoryPoint', () => {
  it('a plain signal is judged from its own point', () => {
    const s = sig('relay.queue_depth');
    expect(judgeHistoryPoint(s, [[iso(0), 300, null, true]], 0).status).toBe('act');
  });
  it('a cumulative signal is judged from the interval, and its first point is unknown', () => {
    const s = sig('ledger.insert_mean_ms');
    const pts: HistoryPoint[] = [[iso(0), 0, 0, true], [iso(H), 4000, 20, true]]; // 200 ms over the hour
    expect(judgeHistoryPoint(s, pts, 0).status).toBe('unknown');
    expect(judgeHistoryPoint(s, pts, 1).status).toBe('act');
  });
  it('evidence_ok=false is unknown', () => {
    expect(judgeHistoryPoint(sig('relay.queue_depth'), [[iso(0), 300, null, false]], 0).status).toBe('unknown');
  });
});

describe('hourlyTimeline / dayCells / uptimePct', () => {
  const t0 = Date.parse('2026-08-20T00:00:00Z');
  const captures = Array.from({ length: 48 }, (_, i) => t0 + i * H); // two days, hourly

  it('is worst-of across the workstream at each capture, and names the driver', () => {
    const h = greenHistory(captures);
    h['relay.queue_depth'][5] = [iso(captures[5]), 60, null, true];  // watch at hour 5
    h['relay.fail_pct_24h'][5] = [iso(captures[5]), 20, 100, true];  // act at hour 5 → wins
    const tl = hourlyTimeline(h, 'W4');
    expect(tl).toHaveLength(48);
    expect(tl[5].status).toBe('act');
    expect(tl[5].driver?.key).toBe('relay.fail_pct_24h');
    expect(tl[4].status).toBe('green');
    expect(tl[4].driver).toBeNull();
  });

  it('a workstream whose only signals are unknown is unknown, not green', () => {
    const h = greenHistory(captures);
    // W3: everything green except due_per_tick (unknown by design) → worst-of is unknown
    expect(hourlyTimeline(h, 'W3').every(p => p.status === 'unknown')).toBe(true);
  });

  it('dayCells: worst-of per day, nodata where nothing was captured, oldest first', () => {
    const h = greenHistory(captures);
    h['relay.queue_depth'][30] = [iso(captures[30]), 60, null, true]; // day 2, watch
    const now = t0 + 3 * 86_400_000 + H; // three days later
    const cells = dayCells(hourlyTimeline(h, 'W4'), 5, now);
    expect(cells).toHaveLength(5);
    expect(cells.map(c => c.status)).toEqual(['nodata', 'green', 'watch', 'nodata', 'nodata']);
    expect(cells[1].points).toBe(24);
  });

  it('uptime counts only measured captures and is null when none were', () => {
    const h = greenHistory(captures);
    h['relay.queue_depth'][0] = [iso(captures[0]), 300, null, true]; // one bad hour of 48
    expect(uptimePct(hourlyTimeline(h, 'W4'))).toBeCloseTo((47 / 48) * 100, 5);
    expect(uptimePct(hourlyTimeline(h, 'W3'))).toBeNull(); // all unknown
    expect(uptimePct([])).toBeNull();
  });
});

describe('incidents', () => {
  const t0 = Date.parse('2026-08-20T00:00:00Z');
  const captures = Array.from({ length: 12 }, (_, i) => t0 + i * H);

  it('groups contiguous bad captures into one incident with its worst driver, and marks the last run ongoing', () => {
    const h = greenHistory(captures);
    h['relay.queue_depth'][2] = [iso(captures[2]), 60, null, true];   // watch
    h['relay.queue_depth'][3] = [iso(captures[3]), 300, null, true];  // act
    h['relay.queue_depth'][4] = [iso(captures[4]), 60, null, true];   // watch
    // hour 5 green → run ends at capture 5
    h['integrity.open_visits_12h'][11] = [iso(captures[11]), 1, null, true]; // ongoing at the end
    const inc = incidents(h);
    expect(inc).toHaveLength(2);
    const ongoing = inc[0];
    expect(ongoing.workstream).toBe('integrity');
    expect(ongoing.endedAt).toBeNull();
    expect(ongoing.status).toBe('act');
    const past = inc[1];
    expect(past.workstream).toBe('W4');
    expect(past.status).toBe('act');
    expect(past.driver?.key).toBe('relay.queue_depth');
    expect(past.startedAt).toBe(captures[2]);
    expect(past.endedAt).toBe(captures[5]);
  });

  it('an all-green history has no incidents', () => {
    expect(incidents(greenHistory(captures))).toEqual([]);
  });
});

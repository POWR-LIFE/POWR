import {
  LedgerRow,
  ScoringRow,
  activeBuckets,
  bucketLabel,
  excludedSummary,
  ledgerRowTitle,
  reasonIsSwitch,
  reasonLabel,
  rowName,
  ruleChips,
  scoringCsv,
  scoringTotals,
  searchScoringRows,
} from '../shared/eventScoring';

const row = (over: Partial<ScoringRow> = {}): ScoringRow => ({
  rank: 1,
  user_id: 'u1',
  display_name: 'Jamie',
  username: 'jamie',
  avatar_url: null,
  member_id: 'ABCD1234',
  points: 30,
  last_counted_at: '2026-08-28T10:00:00Z',
  gate_count: 3,
  gate_met: true,
  by_bucket: { activity: 30 },
  by_activity: { gym: 30 },
  counted_rows: 2,
  counted_sessions: 2,
  excluded_rows: 0,
  excluded_points: 0,
  excluded_by_reason: {},
  adjustments_n: 0,
  ...over,
});

const FNL = {
  included_activities: null,
  count_manual: false,
  count_walking: true,
  count_streak: false,
  count_challenges: false,
  count_bonuses: false,
  count_adjustments: true,
};

describe('labels', () => {
  it('names every bucket and reason, and falls back to the raw key', () => {
    expect(bucketLabel('activity')).toBe('Activity');
    expect(bucketLabel('event_adjustment')).toBe('Event adjustment');
    expect(bucketLabel('mystery')).toBe('mystery');
    expect(reasonLabel(null)).toBe('Counted');
    expect(reasonLabel('manual_off')).toBe('Manual sessions are off');
    expect(reasonLabel('outside_window')).toBe('Activity outside the window');
    expect(reasonLabel('weird')).toBe('weird');
  });

  it('knows which reasons are one toggle away', () => {
    expect(reasonIsSwitch('manual_off')).toBe(true);
    expect(reasonIsSwitch('activity_not_included')).toBe(true);
    expect(reasonIsSwitch('outside_window')).toBe(false);
    expect(reasonIsSwitch('never_counts')).toBe(false);
    expect(reasonIsSwitch(null)).toBe(false);
  });

  it('uses the League fallback name', () => {
    expect(rowName({ display_name: 'Jamie', username: 'j' })).toBe('Jamie');
    expect(rowName({ display_name: null, username: 'j' })).toBe('j');
    expect(rowName({ display_name: null, username: null })).toBe('POWR member');
  });
});

describe('ruleChips', () => {
  it('reads the FNL flags back as on/off chips', () => {
    const chips = ruleChips(FNL);
    const byKey = Object.fromEntries(chips.map(c => [c.key, c]));
    expect(byKey.activities.label).toBe('All activities');
    expect(byKey.activities.on).toBe(true);
    expect(byKey.manual.on).toBe(false);
    expect(byKey.walking.on).toBe(true);
    expect(byKey.streak.on).toBe(false);
    expect(byKey.adjustments.on).toBe(true);
  });

  it('lists an allowlist, and treats an empty one as nothing counting', () => {
    expect(ruleChips({ ...FNL, included_activities: ['gym', 'running'] })[0].label).toBe('gym · running');
    const none = ruleChips({ ...FNL, included_activities: [] })[0];
    expect(none.label).toBe('No activities');
    expect(none.on).toBe(false);
  });
});

describe('activeBuckets + totals', () => {
  const rows = [
    row(),
    row({ user_id: 'u2', rank: 2, points: 5, by_bucket: { activity: 20, penalty: -15 }, excluded_rows: 1, excluded_points: 85, excluded_by_reason: { challenges_off: 85 } }),
    row({ user_id: 'u3', rank: 3, points: 12, by_bucket: { activity: 2, event_adjustment: 10 }, adjustments_n: 1 }),
  ];

  it('only offers columns that carry a number, in bucket order', () => {
    expect(activeBuckets(rows)).toEqual(['activity', 'penalty', 'event_adjustment']);
    expect(activeBuckets([])).toEqual([]);
  });

  it('sums points, buckets, exclusions and adjustments', () => {
    const t = scoringTotals(rows);
    expect(t.points).toBe(47);
    expect(t.byBucket.activity).toBe(52);
    expect(t.byBucket.penalty).toBe(-15);
    expect(t.byBucket.event_adjustment).toBe(10);
    expect(t.byBucket.streak).toBe(0);
    expect(t.excludedPoints).toBe(85);
    expect(t.excludedRows).toBe(1);
    expect(t.adjustmentsN).toBe(1);
    expect(t.people).toBe(3);
  });

  it('survives a row with no bucket map', () => {
    const t = scoringTotals([row({ by_bucket: undefined as unknown as Record<string, number> })]);
    expect(t.byBucket.activity).toBe(0);
    expect(activeBuckets([row({ by_bucket: undefined as unknown as Record<string, number> })])).toEqual([]);
  });
});

describe('search', () => {
  const rows = [row(), row({ user_id: 'u2', display_name: 'Matt Rudge', username: 'mattr', member_id: 'ZZZZ9999' })];
  it('matches name, username and POWR ID, case-insensitively; blank returns all', () => {
    expect(searchScoringRows(rows, '').length).toBe(2);
    expect(searchScoringRows(rows, 'MATT').map(r => r.user_id)).toEqual(['u2']);
    expect(searchScoringRows(rows, 'jam').map(r => r.user_id)).toEqual(['u1']);
    expect(searchScoringRows(rows, 'zzzz').map(r => r.user_id)).toEqual(['u2']);
    expect(searchScoringRows(rows, 'nobody')).toEqual([]);
  });
});

describe('excludedSummary', () => {
  it('leads with the biggest reason and says nothing when nothing was excluded', () => {
    expect(excludedSummary(row())).toBe('');
    expect(excludedSummary(row({
      excluded_rows: 3, excluded_points: 100,
      excluded_by_reason: { manual_off: 15, outside_window: 85 },
    }))).toBe('100 pts · activity outside the window, manual sessions are off');
  });
});

describe('ledgerRowTitle', () => {
  const base: LedgerRow = {
    tx_id: 't1', amount: 10, tx_type: 'earn', source: 'health_sync', description: null,
    created_at: '2026-08-28T10:00:00Z', session_id: 's1', activity: 'gym', verification: 'geofence',
    started_at: '2026-08-28T09:00:00Z', ended_at: '2026-08-28T09:45:00Z', duration_sec: 2700,
    flagged: false, venue_name: 'One LDN', raw_name: null, bucket: 'activity', counted: true,
    counted_at: '2026-08-28T09:45:00Z', reason: null,
  };
  it('describes a session row by activity, length and proof', () => {
    expect(ledgerRowTitle(base)).toBe('Gym · 45 min · geofence at One LDN');
    expect(ledgerRowTitle({ ...base, venue_name: null, verification: 'wearable', duration_sec: null })).toBe('Gym · wearable');
  });
  it('describes a sessionless row by bucket and source', () => {
    expect(ledgerRowTitle({ ...base, session_id: null, bucket: 'challenge', source: 'weekly_challenge' })).toBe('Challenge payout · weekly challenge');
    expect(ledgerRowTitle({ ...base, session_id: null, bucket: 'penalty', source: null })).toBe('Penalty');
  });
});

describe('scoringCsv', () => {
  it('writes one line per person with every bucket and the exclusion reasons', () => {
    const csv = scoringCsv([row({ display_name: 'Jamie "J"', excluded_rows: 1, excluded_points: 85, excluded_by_reason: { challenges_off: 85 } })]);
    const [header, line] = csv.split('\n');
    expect(header.startsWith('rank,name,username,powr_id,points,activity,streak,')).toBe(true);
    expect(line).toContain('"Jamie ""J"""');
    expect(line).toContain('Challenge payouts are off 85');
    expect(line.split(',').length).toBe(header.split(',').length);
  });
});

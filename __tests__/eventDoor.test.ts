import {
  DoorRow,
  PRESENCE_FRESH_MIN,
  bandInfo,
  doorCsv,
  doorTotals,
  filterDoorRows,
  gateLabel,
  gateMet,
  presence,
  searchDoorRows,
  sortDoorRows,
} from '../shared/eventDoor';

const NOW = new Date('2026-09-04T19:30:00Z').getTime();
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const base = (over: Partial<DoorRow> = {}): DoorRow => ({
  user_id: over.user_id ?? 'u-' + Math.random().toString(36).slice(2, 8),
  name: 'Member',
  username: null,
  email: null,
  member_id: null,
  on_roster: true,
  joined_at: minsAgo(60 * 24),
  disqualified_at: null,
  booked: false,
  gate_count: null,
  first_entered_at: null,
  last_proof_at: null,
  last_ended_at: null,
  has_open_visit: false,
  visit_count: 0,
  platform: null,
  last_status: null,
  manual_checked_in_at: null,
  manual_by: null,
  manual_note: null,
  ...over,
});

describe('presence', () => {
  it('open visit with fresh proof = inside', () => {
    const p = presence(base({ has_open_visit: true, first_entered_at: minsAgo(30), last_proof_at: minsAgo(5), visit_count: 1 }), NOW);
    expect(p.key).toBe('inside');
    expect(p.arrived).toBe(true);
    expect(p.detail).toContain('5m ago');
  });

  it('open visit with stale proof = inside? (never asserts they left)', () => {
    const p = presence(base({ has_open_visit: true, first_entered_at: minsAgo(90), last_proof_at: minsAgo(PRESENCE_FRESH_MIN + 1), visit_count: 1 }), NOW);
    expect(p.key).toBe('inside_stale');
    expect(p.arrived).toBe(true);
  });

  it('proof exactly at the threshold is still fresh', () => {
    const p = presence(base({ has_open_visit: true, first_entered_at: minsAgo(60), last_proof_at: minsAgo(PRESENCE_FRESH_MIN) }), NOW);
    expect(p.key).toBe('inside');
  });

  it('closed visit = left, carries in/out', () => {
    const p = presence(base({ first_entered_at: minsAgo(120), last_ended_at: minsAgo(10), last_proof_at: minsAgo(10), visit_count: 1 }), NOW);
    expect(p.key).toBe('left');
    expect(p.arrived).toBe(true);
    expect(p.at).toBe(minsAgo(10));
  });

  it('geofence outranks the manual mark', () => {
    const p = presence(base({ has_open_visit: true, first_entered_at: minsAgo(20), last_proof_at: minsAgo(1), manual_checked_in_at: minsAgo(30), manual_by: 'Jay' }), NOW);
    expect(p.key).toBe('inside');
  });

  it('manual mark alone = arrived by hand, names who marked', () => {
    const p = presence(base({ manual_checked_in_at: minsAgo(3), manual_by: 'Jay' }), NOW);
    expect(p.key).toBe('manual');
    expect(p.arrived).toBe(true);
    expect(p.detail).toContain('by Jay');
  });

  it('nothing = not seen, not arrived', () => {
    const p = presence(base(), NOW);
    expect(p.key).toBe('not_seen');
    expect(p.arrived).toBe(false);
    expect(p.at).toBeNull();
  });
});

describe('gate', () => {
  it('no gate qualifies everyone', () => {
    expect(gateMet(base({ gate_count: null }), 0)).toBe(true);
    expect(gateLabel(base({ gate_count: null }), 0)).toBe('—');
  });
  it('counts against N', () => {
    expect(gateMet(base({ gate_count: 4 }), 5)).toBe(false);
    expect(gateMet(base({ gate_count: 5 }), 5)).toBe(true);
    expect(gateLabel(base({ gate_count: 2 }), 5)).toBe('2 / 5');
    expect(gateLabel(base({ gate_count: null }), 5)).toBe('0 / 5');
  });
});

describe('doorTotals', () => {
  const rows: DoorRow[] = [
    base({ user_id: 'a', gate_count: 5, booked: true, has_open_visit: true, first_entered_at: minsAgo(20), last_proof_at: minsAgo(2) }),   // registered, qualified, booked, inside
    base({ user_id: 'b', gate_count: 1, booked: true }),                                                                                     // registered, not qualified, booked, not seen
    base({ user_id: 'c', gate_count: 5, manual_checked_in_at: minsAgo(5) }),                                                                 // registered, qualified, arrived by hand
    base({ user_id: 'd', gate_count: 5, disqualified_at: minsAgo(100), booked: true }),                                                      // DQ'd: off every roster count
    base({ user_id: 'e', on_roster: false, joined_at: null, first_entered_at: minsAgo(40), last_ended_at: minsAgo(1), last_proof_at: minsAgo(1) }), // walk-in, left
    base({ user_id: 'f', on_roster: false, joined_at: null, has_open_visit: true, first_entered_at: minsAgo(10), last_proof_at: minsAgo(70) }),     // walk-in, inside?
  ];
  const t = doorTotals(rows, 5, NOW);
  it('roster tiles exclude DQ and walk-ins', () => {
    expect(t.registered).toBe(3);
    expect(t.qualified).toBe(2);
    expect(t.booked).toBe(2);
  });
  it('arrived/inside count everyone in the building; walk-ins separately', () => {
    expect(t.arrived).toBe(4);   // a, c, e, f
    expect(t.inside).toBe(2);    // a, f
    expect(t.walkIns).toBe(2);   // e, f
  });
});

describe('ordering + filters', () => {
  const rows: DoorRow[] = [
    base({ user_id: 'left', name: 'Left', first_entered_at: minsAgo(60), last_ended_at: minsAgo(5), last_proof_at: minsAgo(5) }),
    base({ user_id: 'none', name: 'None' }),
    base({ user_id: 'in2', name: 'Inside older', has_open_visit: true, first_entered_at: minsAgo(30), last_proof_at: minsAgo(9) }),
    base({ user_id: 'hand', name: 'Hand', manual_checked_in_at: minsAgo(2), manual_by: 'Jay' }),
    base({ user_id: 'in1', name: 'Inside fresh', has_open_visit: true, first_entered_at: minsAgo(10), last_proof_at: minsAgo(1) }),
    base({ user_id: 'stale', name: 'Stale', has_open_visit: true, first_entered_at: minsAgo(200), last_proof_at: minsAgo(120) }),
    base({ user_id: 'walk', name: 'Walk', on_roster: false, joined_at: null, has_open_visit: true, first_entered_at: minsAgo(3), last_proof_at: minsAgo(3) }),
  ];
  it('inside → inside? → by hand → left → not seen, freshest first', () => {
    expect(sortDoorRows(rows, NOW).map(r => r.user_id)).toEqual(['in1', 'walk', 'in2', 'stale', 'hand', 'left', 'none']);
  });
  it('filters', () => {
    const ids = (f: Parameters<typeof filterDoorRows>[1]) => filterDoorRows(rows, f, 0, NOW).map(r => r.user_id).sort();
    expect(ids('arrived')).toEqual(['hand', 'in1', 'in2', 'left', 'stale', 'walk']);
    expect(ids('not_arrived')).toEqual(['none']);
    expect(ids('walk_ins')).toEqual(['walk']);
    expect(ids('all').length).toBe(7);
  });
  it('qualified filter respects the gate and skips walk-ins/DQ', () => {
    const gated = [
      base({ user_id: 'q', gate_count: 5 }),
      base({ user_id: 'nq', gate_count: 4 }),
      base({ user_id: 'dq', gate_count: 5, disqualified_at: minsAgo(1) }),
      base({ user_id: 'w', gate_count: 5, on_roster: false }),
    ];
    expect(filterDoorRows(gated, 'qualified', 5, NOW).map(r => r.user_id)).toEqual(['q']);
  });
  it('search matches name/username/email and member id with spacing', () => {
    const r = [
      base({ user_id: 'x', name: 'Suzi Royds', username: 'suziroyds', email: 'suzi@example.com', member_id: 'ABCD2345' }),
      base({ user_id: 'y', name: 'Other', member_id: 'ZZZZ9999' }),
    ];
    expect(searchDoorRows(r, 'royds').map(x => x.user_id)).toEqual(['x']);
    expect(searchDoorRows(r, 'abcd 23').map(x => x.user_id)).toEqual(['x']);
    expect(searchDoorRows(r, '  ').length).toBe(2);
  });
});

describe('bandInfo', () => {
  it('doors set → precise label, live inside the margin', () => {
    const b = bandInfo({ band_from: minsAgo(30), band_to: new Date(NOW + 3 * 3_600_000).toISOString(), band_source: 'doors' }, NOW);
    expect(b.fallback).toBe(false);
    expect(b.live).toBe(true);
    expect(b.label.startsWith('Doors ')).toBe(true);
  });
  it('not live well before doors', () => {
    const b = bandInfo({ band_from: new Date(NOW + 5 * 3_600_000).toISOString(), band_to: null, band_source: 'doors' }, NOW);
    expect(b.live).toBe(false);
  });
  it('fallback sources are flagged and open-ended bands stay live', () => {
    const b = bandInfo({ band_from: minsAgo(60 * 48), band_to: null, band_source: 'lock' }, NOW);
    expect(b.fallback).toBe(true);
    expect(b.live).toBe(true);
    expect(b.label).toContain('board lock');
  });
});

describe('doorCsv', () => {
  it('one line per row plus header, quoted fields, presence label', () => {
    const csv = doorCsv([
      base({ name: 'Quote "Me"', email: 'a@b.c', has_open_visit: true, first_entered_at: minsAgo(5), last_proof_at: minsAgo(1), gate_count: 5, booked: true }),
      base({ name: 'Nobody' }),
    ], 5, NOW);
    const lines = csv.split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0].startsWith('name,username,email')).toBe(true);
    expect(lines[1]).toContain('"Quote ""Me"""');
    expect(lines[1]).toContain(',yes,yes,"5 / 5",yes,INSIDE,');
    expect(lines[2]).toContain('NOT SEEN');
  });
});

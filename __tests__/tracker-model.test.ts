import {
  QUICK_FILTERS,
  addDays,
  burndown,
  daysLeft,
  isDone,
  matchesSearch,
  sprintStats,
} from '../landing-page/src/pages/admin/tracker/model';

const at = (iso: string) => new Date(iso);

describe('done', () => {
  it('means verified, or closed as done — not dropped', () => {
    expect(isDone({ status: 'verified' })).toBe(true);
    expect(isDone({ status: 'closed', resolution: 'done' })).toBe(true);
    expect(isDone({ status: 'closed', resolution: 'wont_do' })).toBe(false);
    expect(isDone({ status: 'live' })).toBe(false);
  });

  it('counts an issue closed as done today in "Done this week"', () => {
    const done7 = QUICK_FILTERS.find(f => f.key === 'done7')!;
    expect(done7.test({ status: 'closed', resolution: 'done', closed_at: new Date().toISOString() })).toBe(true);
    expect(done7.test({ status: 'closed', resolution: 'duplicate', closed_at: new Date().toISOString() })).toBe(false);
  });

  it('finds an issue by its key, closed or not', () => {
    expect(matchesSearch({ number: 1, title: 'Test Item', status: 'closed' }, 'POWR-1')).toBe(true);
  });
});

describe('sprint maths', () => {
  const sprint = { status: 'active', starts_on: '2026-10-05', ends_on: '2026-10-09' };
  const members = [
    { status: 'verified', verified_at: '2026-10-06T10:00:00', effort: 'm' },
    { status: 'closed', resolution: 'wont_do', closed_at: '2026-10-07T09:00:00', effort: 's' },
    { status: 'doing', effort: 'l' },
    { status: 'live' },
  ];

  it('burns down by the end of each day and stops at today', () => {
    const { total, days } = burndown(sprint, members, at('2026-10-07T15:00:00'));
    expect(total).toBe(4);
    expect(days.map(d => d.iso)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
    expect(days.map(d => d.remaining)).toEqual([4, 3, 2, null, null]);
    expect(days[days.length - 1].ideal).toBe(0);
  });

  it('draws a completed sprint to the end', () => {
    const { days } = burndown({ ...sprint, status: 'completed' }, members, at('2026-10-20T12:00:00'));
    expect(days.every(d => d.remaining !== null)).toBe(true);
  });

  it('adds up progress and points', () => {
    const s = sprintStats(members);
    expect(s.total).toBe(4);
    expect(s.done).toBe(1);
    expect(s.groups).toMatchObject({ done: 1, dropped: 1, doing: 1, live: 1 });
    expect(s.points).toBe(3 + 2 + 5);
    expect(s.pointsDone).toBe(3);
    expect(s.unsized).toBe(1);
  });

  it('counts days left on the calendar', () => {
    expect(daysLeft(sprint, at('2026-10-07T23:30:00'))).toBe(2);
    expect(daysLeft(sprint, at('2026-10-09T08:00:00'))).toBe(0);
    expect(daysLeft(sprint, at('2026-10-11T08:00:00'))).toBe(-2);
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });
});

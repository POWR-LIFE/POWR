import { weekStory, rushOf, hourName, type WeekInput } from '../shared/gymWeek';

// A fortnight of days: last week's Monday to Sunday, then this week's.
const fortnight = (last: number[], now: number[], monday = '2026-09-14') => {
  const start = Date.parse(`${monday}T12:00:00Z`);
  return [...last, ...now].map((sessions, i) => ({ day: new Date(start + i * 86_400_000).toISOString().slice(0, 10), sessions }));
};
const SAT = '2026-09-26';
const MON = '2026-09-21';
const busy: WeekInput = {
  days: fortnight([14, 11, 16, 9, 12, 7, 4], [12, 15, 9, 18, 6, 5, 0]),
  todayIso: SAT,
  soFar: 65,
  lastWeek: 73,
  weeks: [48, 55, 51, 62, 58, 66, 71, 73, 65].map((sessions) => ({ sessions })),
  weekdays: [52, 18, 49, 61, 44, 37, 29],
  hours: Array.from({ length: 24 }, (_, h) => Math.max(0, Math.round(12 - Math.abs(h - 18) * 1.5))),
};

describe('weekStory', () => {
  it('reads a busy week against its own normal and its best', () => {
    const s = weekStory(busy);
    expect(s).toMatchObject({ dayIndex: 5, usual: 67, usualFrom: 'four', best: 73, bestOf: 8, projected: 77, tone: 'up' });
    expect(s.headline).toBe('On course for your busiest week in 8 weeks.');
  });

  it('says so when the week has already beaten the best, and how early', () => {
    const s = weekStory({ ...busy, soFar: 80 });
    expect(s.headline).toBe('Your busiest week in 8 weeks already, and it’s only Saturday.');
  });

  it('points a slow week at the busy day still to come (POWR’s own gym)', () => {
    const s = weekStory({
      days: fortnight([2, 1, 2, 1, 1, 1, 0], [1, 0, 1, 0, 1, 1, 0]),
      todayIso: SAT, soFar: 4, lastWeek: 8,
      weeks: [12, 18, 13, 12, 12, 12, 8, 7, 4].map((sessions) => ({ sessions })),
      weekdays: [5, 6, 6, 4, 5, 6, 9],
    });
    expect(s).toMatchObject({ usual: 10, best: 18, projected: 7, tone: 'down' });
    expect(s.headline).toBe('Quieter than usual so far. Sundays are your busiest, and it’s still to come.');
  });

  it('works from last week alone on the free package', () => {
    const s = weekStory({ days: fortnight([14, 11, 16, 9, 12, 7, 4], [12, 15, 9, 18, 6, 5, 0]), todayIso: SAT, soFar: 65, lastWeek: 73 });
    expect(s).toMatchObject({ usual: 73, usualFrom: 'last', best: null, projected: 67 + 4, tone: 'even' });
    expect(s.headline).toBe('A normal week so far: on course for about 71.');
  });

  it('starts a week, and notices one that hasn’t started', () => {
    expect(weekStory({ ...busy, days: fortnight([14, 11, 16, 9, 12, 7, 4], [0, 0, 0, 0, 0, 0, 0]), todayIso: MON, soFar: 0 }))
      .toMatchObject({ tone: 'new', headline: 'New week. A usual one here is about 67 sessions.' });
    expect(weekStory({ days: fortnight([0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]), todayIso: MON, soFar: 0, lastWeek: 0 }).headline)
      .toBe('New week. The board starts again today.');
    expect(weekStory({ ...busy, days: fortnight([14, 11, 16, 9, 12, 7, 4], [0, 0, 0, 0, 0, 0, 0]), todayIso: '2026-09-23', soFar: 0 }))
      .toMatchObject({ tone: 'down', headline: 'No check-ins yet this week.' });
    // A gym with no history isn't behind anything.
    expect(weekStory({ days: fortnight([0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]), todayIso: '2026-09-23', soFar: 0, lastWeek: 0 }))
      .toMatchObject({ tone: 'new', headline: 'No check-ins yet. Each session shows up here as members train.' });
  });

  it('speaks of the week as done on Sunday', () => {
    const sunday = { ...busy, todayIso: '2026-09-27', days: fortnight([14, 11, 16, 9, 12, 7, 4], [12, 15, 9, 18, 6, 5, 4]), soFar: 69 };
    expect(weekStory(sunday).headline).toBe('A normal week: 69 against about 67.');
  });

  it('finds the rush hour, when there are enough sessions to call it', () => {
    expect(rushOf(busy.hours)).toEqual({ from: 17, to: 19 });
    expect(rushOf(Array.from({ length: 24 }, (_, h) => (h === 7 ? 3 : 0)))).toBeNull();
    expect(hourName(17)).toBe('5pm');
    expect(hourName(0)).toBe('12am');
    expect(hourName(12)).toBe('12pm');
  });
});

import {
  activityMeta,
  barFraction,
  boardName,
  boardUrl,
  countdownParts,
  fmtKm,
  fmtMinutes,
  fmtSteps,
  gymSlug,
  hourLabel,
  initials,
  kmLandmark,
  kmMilestone,
  landmarkLine,
  memberSince,
  newDisplayToken,
  ordinal,
  pctChange,
  resetLabel,
  rootFontSize,
  sampleActivity,
  sampleBeyond,
  sampleCommunity,
  sampleStandings,
  scenePlan,
  splitStandings,
  spotlightCards,
  todayIndex,
  weekLabel,
  weekdayFull,
  weekdayShort,
  whenLabel,
} from '../shared/gymBoard';

describe('gymSlug', () => {
  it('lower-cases, dashes and trims', () => {
    expect(gymSlug('ONE LDN')).toBe('one-ldn');
    expect(gymSlug('  Valhalla Boxing & Fitness ')).toBe('valhalla-boxing-and-fitness');
    expect(gymSlug('PureGym — Worcester (Unit 4)')).toBe('puregym-worcester-unit-4');
  });
  it('never ends on a dash after truncation', () => {
    const s = gymSlug('a'.repeat(63) + ' b');
    expect(s.length).toBeLessThanOrEqual(64);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('newDisplayToken', () => {
  it('is 48 hex chars from 24 random bytes', () => {
    const t = newDisplayToken((b) => b.fill(0xab));
    expect(t).toBe('ab'.repeat(24));
    expect(t).toMatch(/^[0-9a-f]{48}$/);
  });
});

describe('boardUrl / boardName / initials', () => {
  it('builds the screen URL with and without preview', () => {
    expect(boardUrl('one-ldn', 'tok')).toBe('https://powr.life/gym/one-ldn?k=tok');
    expect(boardUrl('one-ldn', 'tok', 'sample')).toBe('https://powr.life/gym/one-ldn?k=tok&preview=sample');
    expect(boardUrl('one-ldn', 'tok', null, 'http://localhost:5173/')).toBe('http://localhost:5173/gym/one-ldn?k=tok');
  });
  it('prefers display name, then username, then a neutral label', () => {
    expect(boardName({ display_name: 'Suzi', username: 'suz' })).toBe('Suzi');
    expect(boardName({ display_name: null, username: 'suz' })).toBe('suz');
    expect(boardName({})).toBe('POWR member');
  });
  it('takes two initials', () => {
    expect(initials('Georgie Smith')).toBe('GS');
    expect(initials('suz')).toBe('S');
  });
});

describe('weekLabel', () => {
  it('collapses the month when the week sits inside one', () => {
    // Mon 7 Sep 2026 00:00 London = 06 Sep 23:00Z (BST)
    expect(weekLabel('2026-09-06T23:00:00Z', '2026-09-13T23:00:00Z', 'Europe/London')).toBe('Mon 7 – Sun 13 Sept');
  });
  it('names both months when the week straddles one', () => {
    expect(weekLabel('2026-09-27T23:00:00Z', '2026-10-04T23:00:00Z', 'Europe/London')).toBe('Mon 28 Sept – Sun 4 Oct');
  });
});

describe('countdownParts / resetLabel', () => {
  const target = '2026-09-13T23:00:00Z';
  it('splits into d/h/m/s and clamps at zero', () => {
    const p = countdownParts(target, Date.parse('2026-09-11T08:54:30Z'));
    expect(p).toMatchObject({ days: 2, hours: 14, minutes: 5, seconds: 30 });
    expect(countdownParts(target, Date.parse('2026-09-14T00:00:00Z')).totalMs).toBe(0);
  });
  it('reads at one glance at each scale', () => {
    expect(resetLabel(countdownParts(target, Date.parse('2026-09-11T08:54:30Z')))).toBe('2d 14h');
    expect(resetLabel(countdownParts(target, Date.parse('2026-09-13T08:54:30Z')))).toBe('14h 05m');
    expect(resetLabel(countdownParts(target, Date.parse('2026-09-13T22:53:48Z')))).toBe('06m 12s');
  });
});

describe('splitStandings / barFraction', () => {
  it('gives three to the podium, the next seven to the list, the rest to the ticker', () => {
    const rows = sampleStandings(15);
    const { podium, list, rest } = splitStandings(rows);
    expect(podium.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(list.map((r) => r.rank)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(rest.map((r) => r.rank)).toEqual([11, 12, 13, 14, 15]);
  });
  it('handles a short board', () => {
    const { podium, list, rest } = splitStandings(sampleStandings(2));
    expect(podium).toHaveLength(2);
    expect(list).toEqual([]);
    expect(rest).toEqual([]);
  });
  it('bars are proportional with a visible floor', () => {
    expect(barFraction(500, 1000)).toBe(0.5);
    expect(barFraction(1, 1000)).toBe(0.04);
    expect(barFraction(0, 1000)).toBe(0);
    expect(barFraction(10, 0)).toBe(0);
  });
});

describe('rootFontSize', () => {
  it('is 16px at 1080p, doubles at 4K, and clamps', () => {
    expect(rootFontSize(1920, 1080)).toBe(16);
    expect(rootFontSize(3840, 2160)).toBe(32);
    expect(rootFontSize(1280, 720)).toBeCloseTo(10.67, 1);
    expect(rootFontSize(320, 200)).toBe(9);
    expect(rootFontSize(9000, 9000)).toBe(40);
  });
  it('follows the tighter axis on an odd aspect', () => {
    expect(rootFontSize(1920, 540)).toBe(8 < 9 ? 9 : 8);
  });
});

describe('sampleStandings', () => {
  it('is strictly descending and obviously fake', () => {
    const rows = sampleStandings(10);
    for (let i = 1; i < rows.length; i++) expect(rows[i].points).toBeLessThan(rows[i - 1].points);
    expect(rows.every((r) => r.key.startsWith('sample-'))).toBe(true);
  });
});

describe('fmtMinutes / memberSince / spotlightCards', () => {
  it('prints minutes the way the wall does', () => {
    expect(fmtMinutes(0)).toBe('0m');
    expect(fmtMinutes(45)).toBe('45m');
    expect(fmtMinutes(120)).toBe('2h');
    expect(fmtMinutes(130)).toBe('2h 10m');
    expect(fmtMinutes(2620, { compact: true })).toBe('43h');
    expect(fmtMinutes(130, { compact: true })).toBe('2h 10m');
  });
  it('stamps month and year in the board zone', () => {
    expect(memberSince('2026-03-14T10:00:00Z')).toBe('Mar 2026');
    expect(memberSince(null)).toBeNull();
  });
  it('lists only the spotlight cards that have content', () => {
    expect(spotlightCards(null)).toEqual([]);
    expect(spotlightCards({ session: null, improved: null, new_members: [] })).toEqual([]);
    expect(spotlightCards({ session: { points: 1 }, improved: null, new_members: ['a'] })).toEqual(['session', 'new']);
  });
});

describe('activity feed helpers', () => {
  const tz = 'Europe/London';
  const now = Date.parse('2026-09-10T12:00:00Z'); // Thu 13:00 London
  it('labels when a session finished at the scale that reads best', () => {
    expect(whenLabel('2026-09-10T11:59:30Z', now, tz)).toBe('Just now');
    expect(whenLabel('2026-09-10T11:25:00Z', now, tz)).toBe('35m ago');
    expect(whenLabel('2026-09-10T09:00:00Z', now, tz)).toBe('3h ago');
    expect(whenLabel('2026-09-10T05:30:00Z', now, tz)).toBe('Today 06:30');
    expect(whenLabel('2026-09-09T17:54:00Z', now, tz)).toBe('Yesterday 18:54');
    expect(whenLabel('2026-09-07T06:10:00Z', now, tz)).toBe('Mon 07:10');
  });
  it('names every activity and falls back safely', () => {
    expect(activityMeta('gym').label).toBe('Gym session');
    expect(activityMeta('running').label).toBe('Run');
    expect(activityMeta('unknown').label).toBe('Session');
  });
  it('plans scenes from what there is to show', () => {
    expect(scenePlan({ feed: 0, rest: 0 }).map((s) => s.scene)).toEqual(['board']);
    expect(scenePlan({ feed: 5, rest: 0, community: true }).map((s) => s.scene)).toEqual(['board', 'community']);
    expect(scenePlan({ feed: 5, rest: 3, community: true }).map((s) => s.scene)).toEqual(['board', 'community', 'chasing']);
    expect(scenePlan({ feed: 5, rest: 3, community: true, beyond: true }).map((s) => s.scene)).toEqual(['board', 'community', 'beyond', 'chasing']);
    // the per-session wall is never in rotation
    expect(scenePlan({ feed: 50, rest: 3 }).map((s) => s.scene)).not.toContain('activity');
  });
  it('sample feed is newest first and obviously fake', () => {
    const f = sampleActivity(now);
    expect(f).toHaveLength(12);
    for (let i = 1; i < f.length; i++) expect(Date.parse(f[i].ended_at)).toBeLessThan(Date.parse(f[i - 1].ended_at));
    expect(f.every((x) => x.key.startsWith('feed-'))).toBe(true);
  });
});

describe('community helpers', () => {
  it('labels and indexes the week', () => {
    expect(weekdayShort('2026-09-07')).toBe('Mon');
    const week = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'].map((date) => ({ date, points: 0, sessions: 0 }));
    expect(todayIndex(week, Date.parse('2026-09-10T12:00:00Z'), 'Europe/London')).toBe(3);
    expect(todayIndex(week, Date.parse('2026-09-06T23:30:00Z'), 'Europe/London')).toBe(0); // 00:30 Monday London
  });
  it('formats change, hours, ordinals', () => {
    expect(pctChange(123, 100)).toEqual({ pct: 23, label: '+23%' });
    expect(pctChange(92, 100)?.label).toBe('−8%');
    expect(pctChange(5, 0)).toBeNull();
    expect(hourLabel(18)).toBe('6pm');
    expect(hourLabel(7)).toBe('7am');
    expect(hourLabel(0)).toBe('12am');
    expect(hourLabel(12)).toBe('12pm');
    expect(weekdayFull(2)).toBe('Tuesday');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
  });
  it('sample community has seven days and a rank', () => {
    const c = sampleCommunity(Date.parse('2026-09-10T12:00:00Z')) as { week: unknown[]; rank: { rank: number } };
    expect(c.week).toHaveLength(7);
    expect(c.rank.rank).toBe(2);
  });
});

describe('beyond helpers', () => {
  it('prints distance and steps at wall scale', () => {
    expect(fmtKm(0)).toBe('0 km');
    expect(fmtKm(0.74)).toBe('740 m');
    expect(fmtKm(5.26)).toBe('5.3 km');
    expect(fmtKm(1955.5)).toBe('1,956 km');
    expect(fmtSteps(812)).toBe('812');
    expect(fmtSteps(494_000)).toBe('494k');
    expect(fmtSteps(4_276_074)).toBe('4.3M');
  });
  it('picks a landmark a room can picture', () => {
    expect(kmLandmark(3)).toBeNull();
    expect(kmLandmark(45)).toEqual({ label: 'a marathon', times: 1.1 });
    expect(kmLandmark(186)).toEqual({ label: 'London to Brighton', times: 2.1 });
    expect(landmarkLine(186)).toBe("That's London to Brighton, twice over.");
    expect(landmarkLine(340)).toBe("That's London to Manchester.");
    expect(landmarkLine(3014)).toBe("That's Land's End to John o' Groats, 2.2 times over.");
    expect(landmarkLine(130)).toBe("That's London to Brighton, and half again.");
  });
  it('chases the next round number', () => {
    expect(kmMilestone(186)).toEqual({ target: 250, frac: 186 / 250 });
    expect(kmMilestone(3014).target).toBe(5000);
    expect(kmMilestone(0).target).toBe(100);
  });
  it('sample beyond has seven days and the walking tile first', () => {
    const b = sampleBeyond(Date.parse('2026-09-10T12:00:00Z')) as { days: unknown[]; week: Array<{ type: string }> };
    expect(b.days).toHaveLength(7);
    expect(b.week[0].type).toBe('walking');
  });
});

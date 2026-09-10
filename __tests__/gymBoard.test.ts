import {
  barFraction,
  boardName,
  boardUrl,
  countdownParts,
  gymSlug,
  initials,
  newDisplayToken,
  resetLabel,
  rootFontSize,
  sampleStandings,
  splitStandings,
  weekLabel,
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

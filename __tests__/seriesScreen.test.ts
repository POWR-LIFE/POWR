import {
  buildUpWindow,
  countdownDigits,
  crowdAt,
  dateRange,
  isPlaceholderPrize,
  newScreenKey,
  prizeChip,
  PRIZE_SLOTS,
  roundPhase,
  roundWindow,
  sampleSeriesScreen,
  seriesClock,
  seriesNumber,
  seriesScreenUrl,
  weekdayDate,
} from '../shared/seriesScreen';

const TZ = 'Europe/London';
const ROUND = {
  slug: 'autumn-01',
  name: 'Round 01',
  starts_at: '2026-11-15T00:00:00.000Z',
  ends_at: '2026-12-01T00:00:00.000Z',
  invite_from: '2026-10-26T15:01:51.000Z',
  draw_days: 10,
};
const NEXT = { ...ROUND, slug: 'autumn-02', name: 'Round 02', starts_at: '2026-12-15T00:00:00.000Z', ends_at: '2027-01-01T00:00:00.000Z', invite_from: null };

describe('seriesScreenUrl', () => {
  it('is one link for every TV, one segment (never under /series/, which is the invite preview)', () => {
    expect(seriesScreenUrl('abc')).toBe('https://powr.life/series-tv?k=abc');
    expect(seriesScreenUrl('abc', 'sample', 'http://localhost:5173/')).toBe('http://localhost:5173/series-tv?k=abc&preview=sample');
  });
  it('makes a 48-character hex key from the random source', () => {
    const key = newScreenKey((b) => b.fill(171));
    expect(key).toBe('ab'.repeat(24));
    expect(newScreenKey((b) => { for (let i = 0; i < b.length; i++) b[i] = i; })).toMatch(/^[0-9a-f]{48}$/);
  });
});

describe('dates', () => {
  it('prints the round as people say it (ends_at is the midnight after)', () => {
    expect(roundWindow(ROUND, TZ)).toBe('15–30 Nov');
    expect(roundWindow(NEXT, TZ)).toBe('15–31 Dec');
  });
  it('spans months in the build-up', () => {
    expect(buildUpWindow(ROUND, TZ)).toBe('26 Oct–15 Nov');
    // No invite_from: the server's own two-week fallback.
    expect(buildUpWindow(NEXT, TZ)).toBe('1–15 Dec');
  });
  it('collapses a single day', () => {
    expect(dateRange('2026-11-15T00:00:00Z', '2026-11-15T12:00:00Z', TZ)).toBe('15 Nov');
  });
  it('names the weekday', () => {
    expect(weekdayDate(ROUND.starts_at, TZ)).toBe('Sun 15 Nov');
  });
});

describe('seriesClock', () => {
  it('counts to the gun before the round', () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    expect(roundPhase(ROUND, now)).toBe('before');
    const c = seriesClock(ROUND, NEXT, now, TZ);
    expect(c).toMatchObject({ phase: 'before', label: 'To Round 01', when: 'Starts Sun 15 Nov', targetMs: Date.parse(ROUND.starts_at) });
    expect(countdownDigits(c.targetMs, now)).toEqual({ days: '12', hours: '12', minutes: '00', seconds: '00' });
  });
  it('counts to the end while live', () => {
    const now = Date.parse('2026-11-20T09:30:15Z');
    const c = seriesClock(ROUND, NEXT, now, TZ);
    expect(c).toMatchObject({ phase: 'live', label: 'Round 01 · Live', when: 'Ends Mon 30 Nov, midnight', targetMs: Date.parse(ROUND.ends_at) });
    expect(countdownDigits(c.targetMs, now)).toEqual({ days: '10', hours: '14', minutes: '29', seconds: '45' });
  });
  it('moves on to the next round once this one is over', () => {
    const now = Date.parse('2026-12-03T00:00:00Z');
    expect(seriesClock(ROUND, NEXT, now, TZ)).toMatchObject({ phase: 'after', label: 'To Round 02', when: 'Starts Tue 15 Dec' });
    expect(seriesClock(ROUND, null, now, TZ)).toMatchObject({ phase: 'after', label: 'Round 01 · Complete', when: 'Winners announced soon', targetMs: null });
    expect(countdownDigits(null, now)).toEqual({ days: '00', hours: '00', minutes: '00', seconds: '00' });
  });
  it('says so when there is no round at all', () => {
    expect(seriesClock(null, null, Date.now(), TZ).targetMs).toBeNull();
  });
});

describe('crowdAt', () => {
  const crowd = { real: 131, pacers_at_gun: 1369, ramp_from: '2026-10-26T15:01:51Z', ramp_to: '2026-11-15T00:00:00Z', base: 0.835 };
  it('matches the app: base share at the open, everyone at the gun', () => {
    expect(crowdAt(crowd, Date.parse('2026-10-26T15:01:51Z'))).toBe(131 + Math.round(1369 * 0.835));
    expect(crowdAt(crowd, Date.parse('2026-11-15T00:00:00Z'))).toBe(1500);
    expect(crowdAt(crowd, Date.parse('2026-11-20T00:00:00Z'))).toBe(1500);
  });
  it('is null without a crowd', () => {
    expect(crowdAt(null, Date.now())).toBeNull();
  });
});

describe('prizes', () => {
  it('lists seven ways to win in scene order', () => {
    expect(PRIZE_SLOTS.map((s) => s.title)).toEqual(['Champion', 'Contender', 'Challenger', 'Unbreakable', 'Level Up', 'Rookie of the Series', 'Squad Builder']);
  });
  it('treats stand-in names as not entered', () => {
    expect(isPlaceholderPrize('Prize to be announced')).toBe(true);
    expect(isPlaceholderPrize('TBC')).toBe(true);
    expect(isPlaceholderPrize('Theragun Prime')).toBe(false);
  });
  it('shows the prize once it is in the system, else "To be announced" (never a date)', () => {
    const prizes = [{ kind: 'patient_zero', place: null, name: 'Theragun Prime', sponsor: null, detail: null, winners: 1 }];
    const by = Object.fromEntries(PRIZE_SLOTS.map((s) => [s.key, prizeChip(s, prizes)]));
    expect(by['patient_zero']).toEqual({ text: 'Theragun Prime', on: true });
    for (const key of ['rookie', 'biggest_mover', 'hot_streak', 'place-3', 'place-2', 'place-1']) {
      expect(by[key]).toEqual({ text: 'To be announced', on: false });
    }
  });
  it('treats a stand-in row as not entered', () => {
    const squad = PRIZE_SLOTS.find((s) => s.key === 'patient_zero')!;
    expect(prizeChip(squad, [{ kind: 'patient_zero', place: null, name: 'Prize to be announced', sponsor: null, detail: null, winners: 1 }]))
      .toEqual({ text: 'To be announced', on: false });
  });
  it('matches a place prize by its place', () => {
    const prizes = [{ kind: 'place', place: 2, name: 'Garmin Forerunner', sponsor: null, detail: null, winners: 1 }];
    expect(prizeChip(PRIZE_SLOTS[1], prizes)).toEqual({ text: 'Garmin Forerunner', on: true });
    expect(prizeChip(PRIZE_SLOTS[0], prizes).on).toBe(false);
  });
});

describe('sample', () => {
  it('is a complete payload', () => {
    const s = sampleSeriesScreen(Date.parse('2026-11-02T12:00:00Z'));
    expect(s.city).toBe('London');
    expect(s.round?.name).toBe('Round 01');
    expect(seriesNumber(s.season?.number)).toBe('001');
  });
});

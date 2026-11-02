import {
  buildUpWindow,
  countdownDigits,
  crowdAt,
  dateRange,
  isPlaceholderPrize,
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
  it('is the third screen on the same slug and key', () => {
    expect(seriesScreenUrl('one-ldn', 'abc')).toBe('https://powr.life/series/tv/one-ldn?k=abc');
    expect(seriesScreenUrl('one-ldn', 'abc', 'sample', 'http://localhost:5178/')).toBe('http://localhost:5178/series/tv/one-ldn?k=abc&preview=sample');
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
  const now = Date.parse('2026-11-02T12:00:00Z');
  it('lists seven ways to win in scene order', () => {
    expect(PRIZE_SLOTS.map((s) => s.title)).toEqual(['Champion', 'Contender', 'Challenger', 'Unbreakable', 'Level Up', 'Rookie of the Series', 'Squad Builder']);
  });
  it('treats stand-in names as not entered', () => {
    expect(isPlaceholderPrize('Prize to be announced')).toBe(true);
    expect(isPlaceholderPrize('TBC')).toBe(true);
    expect(isPlaceholderPrize('Theragun Prime')).toBe(false);
  });
  it('shows the prize once it is in the system, else the reveal day', () => {
    const prizes = [{ kind: 'patient_zero', place: null, name: 'Theragun Prime', sponsor: null, detail: null, winners: 1 }];
    const by = Object.fromEntries(PRIZE_SLOTS.map((s) => [s.key, prizeChip(s, prizes, ROUND, now, TZ)]));
    expect(by['patient_zero']).toEqual({ text: 'Theragun Prime', on: true });
    expect(by['rookie']).toEqual({ text: 'Revealed 15 Nov', on: false });
    expect(by['biggest_mover']).toEqual({ text: 'Revealed 16 Nov', on: false });
    expect(by['hot_streak']).toEqual({ text: 'Revealed 17 Nov', on: false });
    expect(by['place-3']).toEqual({ text: 'Revealed 18 Nov', on: false });
    expect(by['place-2']).toEqual({ text: 'Revealed 19 Nov', on: false });
    expect(by['place-1']).toEqual({ text: 'Revealed 20 Nov', on: false });
  });
  it('never prints a reveal day that has passed', () => {
    const slot = PRIZE_SLOTS.find((s) => s.key === 'rookie')!;
    expect(prizeChip(slot, [], ROUND, Date.parse('2026-11-16T00:00:00Z'), TZ)).toEqual({ text: 'Announced soon', on: false });
    const squad = PRIZE_SLOTS.find((s) => s.key === 'patient_zero')!;
    expect(prizeChip(squad, [{ kind: 'patient_zero', place: null, name: 'Prize to be announced', sponsor: null, detail: null, winners: 1 }], ROUND, now, TZ))
      .toEqual({ text: 'Announced soon', on: false });
  });
  it('matches a place prize by its place', () => {
    const prizes = [{ kind: 'place', place: 2, name: 'Garmin Forerunner', sponsor: null, detail: null, winners: 1 }];
    expect(prizeChip(PRIZE_SLOTS[1], prizes, ROUND, now, TZ)).toEqual({ text: 'Garmin Forerunner', on: true });
    expect(prizeChip(PRIZE_SLOTS[0], prizes, ROUND, now, TZ).on).toBe(false);
  });
});

describe('sample', () => {
  it('is a complete payload', () => {
    const s = sampleSeriesScreen(Date.parse('2026-11-02T12:00:00Z'));
    expect(s.gym.name).toBe('Sample Gym');
    expect(s.round?.name).toBe('Round 01');
    expect(seriesNumber(s.season?.number)).toBe('001');
  });
});

import { changeLabel, memberInsights, type MemberActivity } from '../shared/memberInsights';

const base: MemberActivity = {
  members: 23,
  active_4w: 18,
  active_prev_4w: 12,
  mix: [],
  consistency: { none: 5, low: 4, mid: 7, high: 2 },
  weekdays: [92, 100, 107, 94, 101, 98, 82],
  months: [],
  gym_sessions: { here: 70, other_gyms: 1, elsewhere: 97 },
  quiet: 0,
  slowing: 0,
};
const opts = { gymName: 'ONE LDN', canSeePeople: false };
const keys = (a: MemberActivity, o = opts) => memberInsights(a, o).map((i) => i.key);

describe('memberInsights', () => {
  it('says nothing below the member threshold', () => {
    expect(memberInsights({ members: 4, too_few: true, min_members: 5 }, opts)).toEqual([]);
    expect(memberInsights(null, opts)).toEqual([]);
  });

  it('leads with members going quiet, and points Clash+ gyms at Pro for names', () => {
    const [first] = memberInsights({ ...base, quiet: 4, slowing: 1 }, opts);
    expect(first).toEqual({
      key: 'quiet',
      finding: '4 members have gone quiet, and 1 more is slowing down',
      action: 'Reach out before they cancel. Clash Pro shows you who.',
      tone: 'watch',
    });
    expect(memberInsights({ ...base, quiet: 1 }, { ...opts, canSeePeople: true })[0].finding).toBe('1 member has gone quiet');
    expect(memberInsights({ ...base, quiet: 1 }, { ...opts, canSeePeople: true })[0].action).toBe('Reach out before they cancel. See who below.');
    expect(memberInsights({ ...base, slowing: 2 }, opts)[0].finding).toBe('2 members are slowing down');
  });

  it('names the biggest per-member rise with its action (the sheet’s run club)', () => {
    const a = {
      ...base,
      mix: [
        { type: 'gym', members: 15, sessions: 115, change_pct: 45 },
        { type: 'running', members: 16, sessions: 129, change_pct: 91 },
        { type: 'yoga', members: 4, sessions: 12, change_pct: 100 },
      ],
    };
    const up = memberInsights(a, opts).find((i) => i.tone === 'up')!;
    // Yoga's +100% counts: 4 members, 12 sessions clears both floors.
    expect(up.key).toBe('up:yoga');
    const noYoga = { ...a, mix: a.mix.filter((r) => r.type !== 'yoga') };
    expect(memberInsights(noYoga, opts)[0]).toMatchObject({
      finding: 'Running is up 91% among members',
      action: 'Launch a run club. We bring the sponsor.',
    });
  });

  it('ignores activities too small to speak for members', () => {
    const a = { ...base, mix: [{ type: 'swimming', members: 2, sessions: 20, change_pct: 300 }, { type: 'dance', members: 5, sessions: 6, change_pct: 200 }] };
    expect(keys(a)).not.toContain('up:swimming');
    expect(keys(a)).not.toContain('up:dance');
  });

  it('spots heavy walkers and light lifters', () => {
    const a = { ...base, mix: [{ type: 'walking', members: 12, sessions: 60, change_pct: 0 }, { type: 'gym', members: 6, sessions: 20, change_pct: 0 }] };
    expect(memberInsights(a, opts)).toContainEqual({ key: 'walkers', finding: 'Heavy walkers, light lifters', action: 'Add beginner strength classes.', tone: 'up' });
    expect(keys({ ...a, mix: [a.mix[0], { ...a.mix[1], members: 10 }] })).not.toContain('walkers');
  });

  it('flags members checking in at other gyms, never counting unplaced workouts', () => {
    const a = { ...base, gym_sessions: { here: 40, other_gyms: 20, elsewhere: 500 } };
    expect(memberInsights(a, opts).find((i) => i.key === 'elsewhere')).toMatchObject({
      finding: '33% of their gym check-ins are at other gyms',
      action: 'Give them a reason to train here: a monthly challenge that only counts sessions at ONE LDN.',
    });
    // 97 unplaced workouts and 1 at another gym: nothing to say.
    expect(keys(base)).not.toContain('elsewhere');
  });

  it('reports the biggest fall', () => {
    const a = { ...base, mix: [{ type: 'cycling', members: 8, sessions: 20, change_pct: -40 }, { type: 'hiit', members: 8, sessions: 30, change_pct: -30 }] };
    expect(memberInsights(a, opts).find((i) => i.tone === 'down')).toMatchObject({
      key: 'down:cycling',
      finding: 'Cycling is down 40% among members',
    });
  });

  it('finds a weak weekday only when it really dips', () => {
    expect(keys(base)).not.toContain('weekday');
    const a = { ...base, weekdays: [100, 100, 100, 100, 100, 100, 40] };
    expect(memberInsights(a, opts).find((i) => i.key === 'weekday')).toMatchObject({
      finding: 'Training dips on Sundays',
      action: 'Put a class or a challenge day on Sundays.',
    });
  });

  it('finds a seasonal dip per active member, skipping the running month and thin months', () => {
    const months = [
      { month: '2026-01', active_members: 10, sessions: 50 },
      { month: '2026-02', active_members: 10, sessions: 100 },
      { month: '2026-03', active_members: 10, sessions: 100 },
      { month: '2026-04', active_members: 10, sessions: 100 },
      { month: '2026-05', active_members: 2, sessions: 1 },
      { month: '2026-06', active_members: 20, sessions: 10 }, // the month still running
    ];
    expect(memberInsights({ ...base, months }, opts).find((i) => i.key === 'month')).toMatchObject({
      finding: 'Consistency dipped in January',
      action: 'Book a Clash Night exactly then.',
    });
    // Growth alone (more members, same pace each) is not a dip.
    const growth = months.map((m) => ({ ...m, sessions: m.active_members * 10 }));
    expect(keys({ ...base, months: growth })).not.toContain('month');
  });

  it('celebrates a committed core', () => {
    const a = { ...base, consistency: { none: 2, low: 2, mid: 4, high: 10 } };
    expect(memberInsights(a, opts).find((i) => i.key === 'core')?.finding).toBe('10 of your members train 5+ days a week');
  });

  it('returns at most three, in order of use', () => {
    const a = {
      ...base,
      quiet: 3,
      mix: [{ type: 'running', members: 10, sessions: 40, change_pct: 50 }, { type: 'cycling', members: 8, sessions: 20, change_pct: -40 }],
      weekdays: [100, 100, 100, 100, 100, 100, 40],
      consistency: { none: 1, low: 1, mid: 2, high: 14 },
    };
    expect(keys(a)).toEqual(['quiet', 'up:running', 'down:cycling']);
    expect(memberInsights(a, { ...opts, limit: 5 }).map((i) => i.key)).toEqual(['quiet', 'up:running', 'down:cycling', 'weekday', 'core']);
  });
});

describe('changeLabel', () => {
  it('signs a change', () => {
    expect(changeLabel(91)).toBe('+91%');
    expect(changeLabel(-12)).toBe('−12%');
    expect(changeLabel(0)).toBe('0%');
    expect(changeLabel(null)).toBe('');
  });
});

import { gymMoves, type MovesInput, type MoveEvent } from '../shared/gymMoves';
import type { MemberActivity } from '../shared/memberInsights';

const NOW = Date.parse('2026-09-26T10:00:00Z');
const DAY = 86_400_000;
const PRO = { events: true, insights: true, studio: true, people: true };
const PLUS = { events: true, insights: true, studio: false, people: false };
const CLASH = { events: false, insights: false, studio: false, people: false };

const base: MovesInput = {
  nowMs: NOW,
  gymName: 'ONE LDN',
  features: PLUS,
  members: 40,
  board: { enabled: true },
  events: [],
  posterMade: true,
  fmtDay: (iso) => `day(${iso.slice(0, 10)})`,
  lastDay: (iso) => `last(${iso.slice(0, 10)})`,
};
const ev = (o: Partial<MoveEvent> & { id: string; state: string }): MoveEvent => ({
  name: `Event ${o.id}`, managed_by: 'gym', participants: 0, ...o,
});
const activity = (o: Partial<MemberActivity> = {}): MemberActivity => ({
  members: 40, active_4w: 20, mix: [], quiet: 0, slowing: 0, ...o,
});
const keys = (i: Partial<MovesInput>) => gymMoves({ ...base, ...i }).map((m) => m.key);

describe('gymMoves', () => {
  it('puts winners to reveal first, and never shows more than three', () => {
    const moves = gymMoves({
      ...base,
      events: [
        ev({ id: 'a', state: 'draft' }),
        ev({ id: 'b', state: 'locked', name: 'September Challenge' }),
        ev({ id: 'c', state: 'live', participants: 12, window_end_at: '2026-09-30T23:00:00Z' }),
      ],
      activity: activity({ quiet: 3 }),
    });
    expect(moves).toHaveLength(3);
    expect(moves[0]).toMatchObject({
      key: 'reveal:b', urgent: true, title: 'Reveal the winners of September Challenge', action: { label: 'Reveal', to: '/venue/events/b' },
    });
    expect(moves.map((m) => m.key)).toEqual(['reveal:b', 'live:c', 'quiet']);
  });

  it('keeps to two event moves unless more are waiting on the gym', () => {
    expect(keys({
      events: [ev({ id: 'a', state: 'draft' }), ev({ id: 'b', state: 'live' }), ev({ id: 'c', state: 'scheduled', window_start_at: new Date(NOW + 3 * DAY).toISOString() })],
      board: null,
    })).toEqual(['live:b', 'screens', 'draft:a']);
    expect(keys({
      events: [ev({ id: 'a', state: 'locked' }), ev({ id: 'b', state: 'locked' }), ev({ id: 'c', state: 'rejected' })],
    })).toEqual(['reveal:a', 'reveal:b', 'note:c']);
  });

  it('only counts the gym’s own events for reveals and drafts, but shows POWR nights that are live', () => {
    const k = keys({
      events: [ev({ id: 'p', state: 'locked', managed_by: 'powr' }), ev({ id: 'q', state: 'live', managed_by: 'powr', participants: 30 })],
    });
    expect(k[0]).toBe('live:q');
    expect(k).not.toContain('reveal:p');
  });

  it('asks for prizes to be handed over for a week after the reveal', () => {
    const revealed = (daysAgo: number, handed: boolean) => ev({
      id: `r${daysAgo}`, state: 'revealed', revealed_at: new Date(NOW - daysAgo * DAY).toISOString(),
      prizes: [{ handed_at: handed ? 'x' : null }, { handed_at: null }],
    });
    expect(keys({ events: [revealed(2, false)] })).toContain('prizes:r2');
    expect(keys({ events: [revealed(9, false)] })).not.toContain('prizes:r9');
    expect(keys({ events: [ev({ id: 'done', state: 'revealed', revealed_at: new Date(NOW - DAY).toISOString(), prizes: [{ handed_at: 'x' }] })] }))
      .not.toContain('prizes:done');
  });

  it('only promotes an upcoming event in the three weeks before it starts', () => {
    const soon = ev({ id: 's', state: 'scheduled', participants: 1, window_start_at: new Date(NOW + 5 * DAY).toISOString() });
    const later = ev({ id: 'l', state: 'scheduled', window_start_at: new Date(NOW + 40 * DAY).toISOString() });
    const [first] = gymMoves({ ...base, events: [soon, later] });
    expect(first).toMatchObject({ key: 'soon:s', action: { to: '/venue/events/s?tab=promote' } });
    expect(first.detail).toBe('1 person has joined so far. Put the join QR at the desk and on your socials.');
    expect(keys({ events: [later] })).not.toContain('soon:l');
  });

  it('suggests running the last finished event again when nothing is on', () => {
    const past = [
      ev({ id: 'old', state: 'cancelled', revealed_at: '2026-07-01T20:00:00Z', window_end_at: '2026-06-30T23:00:00Z' }),
      ev({ id: 'recent', state: 'settled', name: 'August Clash', revealed_at: '2026-09-02T20:00:00Z', window_end_at: '2026-09-01T23:00:00Z' }),
    ];
    const [first] = gymMoves({ ...base, events: past });
    expect(first).toMatchObject({ key: 'again', action: { label: 'Run it again', to: '/venue/events/new?from=recent' } });
    expect(first.detail).toContain('August Clash');
    expect(keys({ events: [] })[0]).toBe('first');
    // Not while the events are unknown.
    expect(keys({ events: null })).not.toContain('first');
  });

  it('turns quiet members into a nudge on Pro, and names the package otherwise', () => {
    const pro = gymMoves({ ...base, features: PRO, activity: activity({ quiet: 4 }) });
    expect(pro[0]).toMatchObject({ key: 'quiet', nudge: true, title: '4 regulars have gone quiet', action: { label: 'Nudge them' } });
    const plus = gymMoves({ ...base, activity: activity({ quiet: 1 }) });
    expect(plus[0]).toMatchObject({ key: 'quiet', title: '1 regular has gone quiet', action: { lock: 'pro', to: '/venue/package' } });
    expect(plus[0].nudge).toBeUndefined();
    // Under the member threshold there's no count to show.
    expect(keys({ activity: { members: 4, too_few: true, min_members: 5 } })).not.toContain('quiet');
  });

  it('gives a free gym one package move, never three', () => {
    const moves = gymMoves({ ...base, features: CLASH, events: [], weekdays: [20, 2, 20, 20, 20, 20, 20] });
    const locked = moves.filter((m) => m.action.lock);
    expect(locked).toHaveLength(1);
    expect(new Set(moves.map((m) => m.action.to)).size).toBe(moves.length);
  });

  it('reads the league: the gap to the gym above, or top spot on Pro', () => {
    const behind = { rank: 2, count: 4, radiusKm: 15, rival: { name: 'Stars Gym' }, ahead: false, gap: 40 };
    const [m] = gymMoves({ ...base, league: behind });
    expect(m).toMatchObject({ key: 'league', title: '40 POWR behind Stars Gym', action: { to: '/venue/screens' } });
    expect(m.detail).toBe('About 3 more sessions would pass them. Keep the race on your gym TV.');
    expect(gymMoves({ ...base, features: PRO, league: behind })[0].action.to).toBe('/venue/studio?board=week');
    const top = { ...behind, rank: 1, ahead: true };
    expect(keys({ league: top })).not.toContain('league');
    expect(gymMoves({ ...base, features: PRO, league: top }).find((x) => x.key === 'league')?.title).toBe('Top of the Gym League within 15 km');
    expect(keys({ league: { ...behind, count: 1, rival: null } })).not.toContain('league');
  });

  it('finds the quietest day only with enough sessions to mean it', () => {
    const wd = [14, 3, 12, 16, 11, 9, 8];
    const [m] = gymMoves({ ...base, weekdays: wd });
    expect(m).toMatchObject({ key: 'weekday', title: 'Tuesdays are your quietest day', action: { label: 'Plan an event' } });
    expect(m.detail).toBe('3 sessions in 4 weeks, against 16 on Thursdays. A sprint gives members a reason to come in.');
    // POWR's own gym: 41 sessions in 4 weeks, nearly flat. Nothing to say.
    expect(keys({ weekdays: [5, 6, 6, 4, 5, 6, 9] })).not.toContain('weekday');
  });

  it('builds a challenge around what members are doing more of', () => {
    const mix = [{ type: 'hiit', members: 6, sessions: 30, change_pct: 40 }];
    const [m] = gymMoves({ ...base, activity: activity({ mix }) });
    expect(m).toMatchObject({ key: 'insight:up:hiit', title: 'HIIT is up 40% among members' });
    expect(m.detail).toBe('Build a challenge around HIIT while it’s popular.');
    const run = gymMoves({ ...base, activity: activity({ mix: [{ type: 'running', members: 5, sessions: 20, change_pct: 30 }] }) })[0];
    expect(run.detail).toBe('Build a challenge around running while it’s popular.');
  });

  it('gets a small gym going: screens, the join poster, a first event', () => {
    expect(keys({ board: null, members: 3, posterMade: false, events: [] })).toEqual(['screens', 'first', 'poster']);
    const [, , poster] = gymMoves({ ...base, board: null, members: 0, posterMade: false, events: [] });
    expect(poster.title).toBe('Nobody’s picked ONE LDN in the app yet');
  });

  it('warns about the end of a trial in its last fortnight', () => {
    expect(keys({ trialDaysLeft: 20 })).not.toContain('trial');
    const [m] = gymMoves({ ...base, trialDaysLeft: 5 });
    expect(m).toMatchObject({ key: 'trial', title: 'Your free trial ends in 5 days' });
    expect(gymMoves({ ...base, trialDaysLeft: 0 })[0].title).toBe('Your free trial ends today');
  });

  it('never sends two buttons to the same place', () => {
    // A first event and a quiet Tuesday both want the event builder: one move, the stronger.
    const moves = gymMoves({ ...base, events: [], weekdays: [14, 3, 12, 16, 11, 9, 8] });
    const toBuilder = moves.filter((m) => m.action.to === '/venue/events/new');
    expect(toBuilder.map((m) => m.key)).toEqual(['weekday']);
    expect(new Set(moves.map((m) => m.action.to)).size).toBe(moves.length);
  });

  describe('never goes quiet', () => {
    const calm: MovesInput = {
      ...base, features: PRO, board: { enabled: true }, events: [ev({ id: 's', state: 'scheduled', window_start_at: new Date(NOW + 10 * DAY).toISOString() })],
      members: 60, posterMade: true, hasPhoto: true, recapOn: true, todayPost: { label: 'The board', free: false },
    };

    it('fills three with everyday moves when nothing else needs doing', () => {
      for (const features of [PRO, PLUS, CLASH]) {
        expect(gymMoves({ ...calm, features, events: [] })).toHaveLength(3);
        expect(gymMoves({ ...calm, features })).toHaveLength(3);
        // Every day of the week, and with the day's post put off.
        for (let day = 0; day < 7; day++) {
          const done = { 'post:today': new Date(NOW + 2 * DAY).toISOString() };
          expect(gymMoves({ ...calm, features, nowMs: NOW + day * DAY, done })).toHaveLength(3);
        }
      }
    });

    it('keeps a free gym to one package move among its three', () => {
      const league = { rank: 1, count: 3, radiusKm: 10, rival: { name: 'Iron Works' }, ahead: true, gap: 20 };
      const moves = gymMoves({ ...calm, features: CLASH, league, todayPost: null });
      expect(moves).toHaveLength(3);
      expect(moves.filter((m) => m.action.to === '/venue/package')).toHaveLength(1);
    });

    it('offers today’s post: to post on Pro, to see when the package can’t download it', () => {
      const pro = gymMoves({ ...calm, todayPost: { label: 'The board', free: false } });
      expect(pro.find((m) => m.key === 'post:today')).toMatchObject({ title: 'Today’s post: The board', action: { label: 'Post it', to: '/venue?post=today' }, snooze: 'day' });
      const plus = gymMoves({ ...calm, features: PLUS, todayPost: { label: 'The board', free: false } });
      expect(plus.find((m) => m.key === 'post:today')?.action.label).toBe('See it');
      const joinDay = gymMoves({ ...calm, features: PLUS, todayPost: { label: 'Join us', free: true } });
      expect(joinDay.find((m) => m.key === 'post:today')?.action.label).toBe('Post it');
    });

    it('lets an everyday move be put off, and the next one steps up', () => {
      const before = gymMoves({ ...calm, todayPost: { label: 'The board', free: false } });
      expect(before.map((m) => m.key)).toContain('post:today');
      const later = new Date(NOW + DAY).toISOString();
      const after = gymMoves({ ...calm, todayPost: { label: 'The board', free: false }, done: { 'post:today': later } });
      expect(after.map((m) => m.key)).not.toContain('post:today');
      expect(after).toHaveLength(3);
      // Once the time's up it's back.
      expect(gymMoves({ ...calm, todayPost: { label: 'The board', free: false }, done: { 'post:today': new Date(NOW - 1).toISOString() } })
        .map((m) => m.key)).toContain('post:today');
    });

    it('never puts off an alert', () => {
      const locked = [ev({ id: 'b', state: 'locked' })];
      const moves = gymMoves({ ...calm, events: locked, done: { 'reveal:b': new Date(NOW + DAY).toISOString() } });
      expect(moves[0].key).toBe('reveal:b');
      expect(moves[0].snooze).toBeUndefined();
    });

    it('turns the everyday moves over from one day to the next', () => {
      const today = gymMoves({ ...calm }).map((m) => m.key);
      const tomorrow = gymMoves({ ...calm, nowMs: NOW + DAY }).map((m) => m.key);
      expect(today).not.toEqual(tomorrow);
    });

    it('asks for a photo and the recap only when they’re missing', () => {
      const all = (i: Partial<MovesInput>) => [0, 1, 2, 3, 4, 5, 6].flatMap((d) => gymMoves({ ...calm, ...i, nowMs: NOW + d * DAY }).map((m) => m.key));
      expect(all({})).not.toContain('photo');
      expect(all({})).not.toContain('recap');
      expect(all({ hasPhoto: false })).toContain('photo');
      expect(all({ recapOn: false })).toContain('recap');
    });

    it('only suggests next month’s challenge when nothing is booked in the next 30 days', () => {
      const week = (i: Partial<MovesInput>) => [0, 1, 2, 3, 4, 5, 6].flatMap((d) => gymMoves({ ...calm, ...i, nowMs: NOW + d * DAY }).map((m) => m.key));
      expect(week({})).not.toContain('plan-next');
      expect(week({ events: [ev({ id: 'd', state: 'draft' })] })).toContain('plan-next');
    });
  });
});

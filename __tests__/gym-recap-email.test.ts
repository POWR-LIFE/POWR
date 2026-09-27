import {
  eventLine,
  gymWeeklyRecapEmail,
  weekLabel,
  type GymWeeklyRecapData,
} from '../supabase/functions/_shared/emails/gym-weekly-recap';
import { gymEventEmail, type GymEventMailData } from '../supabase/functions/_shared/emails/gym-event-mail';

const TZ = 'Europe/London';

const recap: GymWeeklyRecapData = {
  gymName: 'POWR Gym <Leamington>',
  weekLabel: '15–21 Sep',
  tz: TZ,
  sessions: 84, prevSessions: 71,
  athletes: 31, prevAthletes: 31,
  minutes: 4620,
  newFaces: 3,
  members: 41,
  top: [
    { name: 'Aisha K', points: 240, sessions: 7 },
    { name: 'Tom & Jerry', points: 223, sessions: 1 },
    { name: 'Maya Chen', points: 206, sessions: 6 },
  ],
  busiest: { day: 'Tuesday', sessions: 21 },
  quiet: 4,
  quietNamed: true,
  events: [
    { id: 'e1', name: 'October Challenge', status: 'live', participants: 23, window_start_at: '2026-09-20T23:00:00Z', window_end_at: '2026-10-18T23:00:00Z' },
    { id: 'e2', name: 'Points Week', status: 'scheduled', participants: 1, window_start_at: '2026-10-05T23:00:00Z', window_end_at: '2026-10-12T23:00:00Z' },
  ],
};

describe('weekLabel', () => {
  it('names one month once', () => {
    // en-GB abbreviates September as "Sept" on newer ICU (browsers and Deno alike).
    expect(weekLabel('2026-09-13T23:00:00Z', '2026-09-20T23:00:00Z', TZ)).toMatch(/^14–20 Sept?$/);
  });
  it('names both months across a boundary', () => {
    expect(weekLabel('2026-09-27T23:00:00Z', '2026-10-04T23:00:00Z', TZ)).toMatch(/^28 Sept? – 4 Oct$/);
  });
});

describe('eventLine', () => {
  const base = { id: 'x', name: 'X', participants: 2, window_start_at: '2026-10-05T23:00:00Z', window_end_at: '2026-10-12T23:00:00Z' };
  it('says when a scheduled event starts', () => {
    expect(eventLine({ ...base, status: 'scheduled' }, TZ)).toBe('Starts Tue 6 Oct · 2 people in');
  });
  it('gives a live event its last day, not the midnight after it', () => {
    expect(eventLine({ ...base, status: 'live' }, TZ)).toBe('Live · 2 people in · last day Mon 12 Oct');
  });
  it('asks for the reveal once sealed', () => {
    expect(eventLine({ ...base, status: 'locked', participants: 1 }, TZ)).toBe('Board sealed · 1 person in · reveal the winners from your phone');
  });
  it('marks drafts with POWR', () => {
    expect(eventLine({ ...base, status: 'draft', review_status: 'pending' }, TZ)).toBe('With POWR for a check');
    expect(eventLine({ ...base, status: 'draft', review_status: 'rejected' }, TZ)).toMatch(/asked for a change/);
  });
  it('names POWR-run events', () => {
    expect(eventLine({ ...base, status: 'live', managed_by: 'powr' }, TZ)).toMatch(/^Run by POWR · Live/);
  });
});

describe('gymWeeklyRecapEmail', () => {
  it('leads with the sessions and escapes the gym name', () => {
    const { subject, html, text } = gymWeeklyRecapEmail(recap);
    expect(subject).toBe('POWR Gym <Leamington> on POWR: 84 sessions last week');
    expect(html).toContain('POWR Gym &lt;Leamington&gt;');
    expect(html).not.toContain('POWR Gym <Leamington>');
    expect(html).toContain('Tom &amp; Jerry');
    expect(html).toContain('13 vs the week before');
    expect(html).toContain('level with the week before');
    expect(html).toContain('4 members have gone quiet</strong>');
    expect(html).toContain('Reach out from Members.');
    expect(html).toContain('https://powr.life/venue/events/e1');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    expect(text).toContain('1. Aisha K — 240 POWR, 7 sessions');
    expect(text).toContain('2. Tom & Jerry — 223 POWR, 1 session');
    expect(text).toContain('- October Challenge: Live · 23 people in · last day Sun 18 Oct');
    expect(text).toContain('Busiest day: Tuesday, 21 sessions.');
  });

  it('has a quiet-week subject and copy when nothing was logged', () => {
    const { subject, html } = gymWeeklyRecapEmail({ ...recap, sessions: 0, athletes: 0, newFaces: 0, top: [], busiest: null });
    expect(subject).toBe('POWR Gym <Leamington> on POWR: last week');
    expect(html).toContain('Nothing was logged');
    expect(html).not.toContain('Top of the board');
  });

  it('counts the quiet without pointing at Members below Clash Pro, and says nothing below Clash+', () => {
    const plus = gymWeeklyRecapEmail({ ...recap, quietNamed: false, quiet: 1 });
    expect(plus.html).toContain('1 member has gone quiet</strong>');
    expect(plus.html).not.toContain('Reach out from Members');
    const free = gymWeeklyRecapEmail({ ...recap, quiet: null });
    expect(free.html).not.toContain('gone quiet');
  });

  it('never carries a Mailgun unsubscribe: the switch is in Settings', () => {
    const { html } = gymWeeklyRecapEmail(recap);
    expect(html).not.toContain('%unsubscribe_url%');
    expect(html).toContain('https://powr.life/venue/settings');
  });
});

describe('gymEventEmail', () => {
  const event: GymEventMailData['event'] = {
    id: 'ev-1',
    name: 'October Challenge',
    participants: 23,
    window_start_at: '2026-09-20T23:00:00Z',
    window_end_at: '2026-10-18T23:00:00Z',
    auto_reveal_at: '2026-10-22T11:00:00Z',
    review_note: null,
  };
  const top = [
    { rank: 1, name: 'Aisha K', points: 410, prize: 'Free month' },
    { rank: 2, name: 'Tom Reid', points: 379, prize: null },
  ];

  it('results ready: the sealed podium and the safety net, linking to the event', () => {
    const { subject, html, text } = gymEventEmail({ kind: 'results_ready', gymName: 'POWR Gym', tz: TZ, event, top });
    expect(subject).toBe('October Challenge: the results are in');
    expect(html).toContain('sealed after Sun 18 Oct');
    expect(html).toContain('POWR reveals them Thu 22 Oct');
    expect(html).toContain('Only your team can see this until you reveal it.');
    expect(html).toContain('Free month');
    expect(html).toContain('https://powr.life/venue/events/ev-1');
    expect(text).toContain('1. Aisha K — 410 POWR (Free month)');
    expect(text).toContain('2. Tom Reid — 379 POWR');
  });

  it('approved: says scoring starts and, for a newly trusted gym, that the check is over', () => {
    const { subject, html } = gymEventEmail({ kind: 'approved', gymName: 'POWR Gym', tz: TZ, event, trusted: true });
    expect(subject).toBe('October Challenge is on');
    expect(html).toMatch(/Scoring starts Mon 21 Sept?\./);
    expect(html).toContain('go straight out, no check');
    const again = gymEventEmail({ kind: 'approved', gymName: 'POWR Gym', tz: TZ, event, trusted: false });
    expect(again.html).not.toContain('no check');
  });

  it('rejected and pulled carry the note, escaped', () => {
    const note = 'Prize says "free membership" <b>';
    const rejected = gymEventEmail({ kind: 'rejected', gymName: 'POWR Gym', tz: TZ, event: { ...event, review_note: note } });
    expect(rejected.subject).toBe('October Challenge: one change before it goes out');
    expect(rejected.html).toContain('Prize says &quot;free membership&quot; &lt;b&gt;');
    expect(rejected.text).toContain(`What to change: ${note}`);
    const pulled = gymEventEmail({ kind: 'pulled', gymName: 'POWR Gym', tz: TZ, event: { ...event, review_note: note } });
    expect(pulled.subject).toBe('October Challenge was pulled');
    expect(pulled.html).toContain('including the 23 people who had joined');
    expect(pulled.html).toContain('The reason');
  });
});

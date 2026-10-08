import {
  PLACE_LABELS,
  esc,
  homeOf,
  placeLabel,
  planPosts,
  sprintPosts,
  type SprintEvent,
  type TrackerEvent,
  type TrackerIssue,
} from '../supabase/functions/_shared/trackerSlack';
import { SURFACES } from '../landing-page/src/pages/admin/tracker/taxonomy';

const issue = (o: Partial<TrackerIssue> = {}): TrackerIssue => ({
  id: 'i-1',
  number: 12,
  title: 'Midnight visits <lose> points & retry',
  type: 'bug',
  status: 'triage',
  priority: 1,
  surface: 'app',
  area: 'geofencing',
  feature: 'Dwell & points claim',
  platforms: ['ios', 'android'],
  risks: ['points_money'],
  pr_numbers: [],
  ship_steps: [],
  ...o,
});

const moved = (from: string, to: string, o: Partial<TrackerIssue> = {}, extra: Partial<TrackerEvent> = {}): TrackerEvent => ({
  kind: 'updated',
  issue: issue({ status: to, ...o }),
  old: { status: from, priority: o.priority ?? 1, assignee_id: null },
  actor: 'Jamie',
  assignee_id: null,
  ...extra,
});

const textOf = (p: { blocks: unknown[] }) => JSON.stringify(p.blocks);

describe('tracker → Slack labels', () => {
  it('match the admin taxonomy, surface for surface and area for area', () => {
    const fromTaxonomy = Object.fromEntries(
      SURFACES.map((s: { key: string; label: string; areas: { key: string; label: string }[] }) => [
        s.key,
        { label: s.label, areas: Object.fromEntries(s.areas.map(a => [a.key, a.label])) },
      ]),
    );
    expect(PLACE_LABELS).toEqual(fromTaxonomy);
  });

  it('names the place the way the Tracker does, and falls back to keys', () => {
    expect(placeLabel(issue())).toBe('Member app › Gym check-in (geofencing) › Dwell & points claim');
    expect(placeLabel(issue({ surface: 'new_thing', area: 'x', feature: null }))).toBe('new_thing › x');
  });

  it("escapes Slack's control characters", () => {
    expect(esc('a <b> & c')).toBe('a &lt;b&gt; &amp; c');
  });
});

describe('planPosts', () => {
  it('posts a filed issue to #issues and keeps it as the thread', () => {
    const [post, ...rest] = planPosts({ kind: 'created', issue: issue(), actor: 'Sorine' }, { threaded: true });
    expect(rest).toHaveLength(0);
    expect(post.channel).toBe('issues');
    expect(post.saveThread).toBe(true);
    const text = textOf(post);
    expect(text).toContain('POWR-12');
    expect(text).toContain('P1 · This week');
    expect(text).toContain('Midnight visits &lt;lose&gt; points &amp; retry');
    expect(text).toContain('filed by Sorine');
    expect(text).toContain('https://powr.life/admin/tracker?issue=POWR-12');
  });

  it('marks a filed P0 so it stands out', () => {
    const [post] = planPosts({ kind: 'created', issue: issue({ priority: 0 }) }, { threaded: false });
    expect(textOf(post)).toContain(':rotating_light:');
  });

  it('tells #development about the shipping flow, not the early columns', () => {
    for (const to of ['review', 'merged', 'live', 'verified']) {
      expect(planPosts(moved('doing', to), { threaded: false }).map(p => p.channel)).toContain('dev');
    }
    for (const to of ['backlog', 'next', 'doing']) {
      expect(planPosts(moved('triage', to), { threaded: false })).toEqual([]);
    }
  });

  it("lists what's left to ship when something merges", () => {
    const [dev] = planPosts(
      moved('review', 'merged', {
        ship_steps: [
          { kind: 'ota', target: '1.6.0', done: false },
          { kind: 'function', target: 'claim-points', done: true },
        ],
        pr_numbers: [527],
      }),
      { threaded: false },
    );
    const text = textOf(dev);
    expect(text).toContain('To ship: OTA 1.6.0');
    expect(text).not.toContain('claim-points');
    expect(text).toContain('pull/527');
  });

  it("asks for proof when it goes live, using the issue's own words", () => {
    const [dev] = planPosts(moved('merged', 'live', { verify_how: 'No 23505 for a week' }), { threaded: false });
    expect(textOf(dev)).toContain("How we'll know: No 23505 for a week");
  });

  it('threads every move under the issue when a bot token is set', () => {
    const posts = planPosts(moved('triage', 'next'), { threaded: true });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ channel: 'issues', thread: true, broadcast: false });
  });

  it('broadcasts resolutions to #issues, threaded or not', () => {
    const closed = planPosts(moved('doing', 'closed', { resolution: 'wont_do' }), { threaded: false });
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ channel: 'issues', broadcast: true });
    expect(textOf(closed[0])).toContain("Closed · Won't do");

    const verified = planPosts(moved('live', 'verified'), { threaded: true }).map(p => p.channel).sort();
    expect(verified).toEqual(['dev', 'issues']);
  });

  it('raises the alarm when an issue becomes P0', () => {
    const e: TrackerEvent = { ...moved('doing', 'doing', { priority: 0 }), old: { status: 'doing', priority: 2, assignee_id: null } };
    const posts = planPosts(e, { threaded: false });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ channel: 'issues', broadcast: true });
    expect(textOf(posts[0])).toContain('P0 · Now');
  });

  it('notes assignments in the thread only', () => {
    const e: TrackerEvent = { ...moved('doing', 'doing'), assignee: 'Sorine', assignee_id: 'u-2' };
    expect(planPosts(e, { threaded: false })).toEqual([]);
    const [post] = planPosts(e, { threaded: true });
    expect(post).toMatchObject({ channel: 'issues', thread: true });
    expect(textOf(post)).toContain('assigned it to *Sorine*');
  });
});

describe('home channel by type', () => {
  it('keeps what is broken in #issues and planned work in #development', () => {
    for (const t of ['bug', 'incident']) expect(homeOf(t)).toBe('issues');
    for (const t of ['feature', 'improvement', 'task', 'debt', 'investigation']) expect(homeOf(t)).toBe('dev');
  });

  it('files planned work in #development, as its thread', () => {
    const [post] = planPosts({ kind: 'created', issue: issue({ type: 'task' }) }, { threaded: true });
    expect(post).toMatchObject({ channel: 'dev', saveThread: true });
    expect(planPosts({ kind: 'created', issue: issue({ type: 'feature' }) }, { threaded: false })[0].channel).toBe('dev');
  });

  it('threads planned work\'s early moves in #development', () => {
    const [post] = planPosts(moved('triage', 'next', { type: 'task' }), { threaded: true });
    expect(post).toMatchObject({ channel: 'dev', thread: true, broadcast: false });
  });

  it('posts a planned item\'s shipping update once — in its thread, shown in the channel', () => {
    for (const to of ['review', 'merged', 'live', 'verified']) {
      const posts = planPosts(moved('doing', to, { type: 'feature' }), { threaded: true });
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ channel: 'dev', thread: true, broadcast: true });
    }
  });

  it('never double-posts planned work without threads either', () => {
    const posts = planPosts(moved('live', 'verified', { type: 'task' }), { threaded: false });
    expect(posts).toHaveLength(1);
    expect(posts[0].channel).toBe('dev');
  });

  it('still tells #development when a bug ships, and keeps the bug\'s story in #issues', () => {
    const posts = planPosts(moved('review', 'merged'), { threaded: true });
    expect(posts.map(p => [p.channel, !!p.thread])).toEqual([['dev', false], ['issues', true]]);
  });

  it('announces closing and P0 in the home channel', () => {
    const closed = planPosts(moved('doing', 'closed', { type: 'task', resolution: 'wont_do' }), { threaded: true });
    expect(closed).toEqual([expect.objectContaining({ channel: 'dev', thread: true, broadcast: true })]);
    const e: TrackerEvent = { ...moved('doing', 'doing', { type: 'improvement', priority: 0 }), old: { status: 'doing', priority: 2, assignee_id: null } };
    expect(planPosts(e, { threaded: false })).toEqual([expect.objectContaining({ channel: 'dev', broadcast: true })]);
  });
});

describe('sprintPosts', () => {
  const sprint = (o: Partial<SprintEvent['sprint']> = {}): SprintEvent['sprint'] => ({
    id: 's-1', number: 4, name: 'Sprint 4', goal: 'Midnight visits pay', starts_on: '2026-10-12', ends_on: '2026-10-23',
    status: 'active', summary: null, ...o,
  });

  it('announces a start in #development with the goal, dates, issues and points', () => {
    const [post] = sprintPosts({
      kind: 'sprint',
      sprint: sprint(),
      issues: [
        { number: 3, title: 'Midnight <visits>', priority: 1, effort: 'm', status: 'next' },
        { number: 9, title: 'Rotate key', priority: 0, effort: 'xl', status: 'next' },
      ],
      actor: 'Jamie',
    });
    expect(post.channel).toBe('dev');
    const text = textOf(post);
    expect(text).toContain('has started');
    expect(text).toContain('Mon 12 Oct');
    expect(text).toContain('Goal:* Midnight visits pay');
    expect(text).toContain('POWR-3');
    expect(text).toContain('Midnight &lt;visits&gt;');
    expect(text).toContain('11 points');
    expect(text).toContain('tracker?sprint=4');
  });

  it('keeps a long sprint list short', () => {
    const issues = Array.from({ length: 15 }, (_, n) => ({ number: n + 1, title: `T${n}`, priority: 2, status: 'next' }));
    expect(textOf(sprintPosts({ kind: 'sprint', sprint: sprint(), issues })[0])).toContain('and 3 more');
  });

  it('reports a finish with what was done, owed and carried', () => {
    const [post] = sprintPosts({
      kind: 'sprint',
      sprint: sprint({ status: 'completed', summary: { total: 4, done: 1, live: 1, dropped: 1, carried: 2, carried_to_name: 'Sprint 5', points: 10, points_done: 2, added: 1 } }),
      issues: [],
    });
    const text = textOf(post);
    expect(post.channel).toBe('dev');
    expect(text).toContain('*1 of 4* done');
    expect(text).toContain('1 live, awaiting proof');
    expect(text).toContain('2 carried to Sprint 5');
    expect(text).toContain('2/10 points');
    expect(text).toContain('1 issue added mid-sprint');
  });

  it('says when unfinished work went back to the backlog', () => {
    const [post] = sprintPosts({ kind: 'sprint', sprint: sprint({ status: 'completed', summary: { total: 2, done: 0, carried: 2 } }), issues: [] });
    expect(textOf(post)).toContain('2 carried to the backlog');
  });
});

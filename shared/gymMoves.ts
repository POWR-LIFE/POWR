// What's worth doing at a gym this week, most useful first: the gym portal
// Overview's "Worth doing" card. Each move is something the gym couldn't see
// at a glance, the one thing to do about it, and the button that does it (or
// names the package that unlocks it).
//
// Pure: the portal passes what it has already loaded (the summary, its
// events, the league standing, the members' activity, the weekly numbers,
// the package) and renders what comes back. Under jest
// (__tests__/gymMoves.test.ts).

import { memberInsights, ACTIVITY_NOUN, type MemberActivity } from './memberInsights';
import { sessionsToClose } from './gymLeague';

export type MoveKind = 'event' | 'members' | 'league' | 'growth' | 'programme' | 'screens' | 'package' | 'content';

export type MoveAction = {
  label: string;
  to: string;
  /** The package that unlocks it: the button says so and goes to Packages. */
  lock?: 'clash_plus' | 'pro';
};

export type Move = {
  key: string;
  kind: MoveKind;
  /** Waiting on the gym: winners to reveal, a note from POWR. */
  urgent?: boolean;
  title: string;
  detail: string;
  action: MoveAction;
  /** The quiet-member nudge, sent from the card itself (Clash Pro). */
  nudge?: boolean;
  priority: number;
};

export type MoveEvent = {
  id: string;
  name: string;
  /** The portal's statusKey(): draft, pending, rejected, scheduled, live, locked, revealed, settled… */
  state: string;
  managed_by?: string | null;
  participants?: number | null;
  window_start_at?: string | null;
  window_end_at?: string | null;
  revealed_at?: string | null;
  prizes?: Array<{ handed_at?: string | null }> | null;
};

export type LeagueStanding = {
  rank: number;
  /** Gyms in the local table, the host included. */
  count: number;
  radiusKm: number;
  rival: { name: string } | null;
  ahead: boolean;
  /** POWR between the host and its rival this week. */
  gap: number;
};

export type MovesInput = {
  nowMs: number;
  gymName: string;
  /** gym_package().features; null while it loads. */
  features: { events?: boolean; insights?: boolean; studio?: boolean; people?: boolean } | null;
  /** Days left on a free trial; null when not on one. */
  trialDaysLeft?: number | null;
  /** Members who picked the gym in the app. */
  members: number;
  /** null: no screens set up yet. */
  board: { enabled?: boolean | null } | null;
  /** null: not loaded, so no event moves (and never "nothing on"). */
  events: MoveEvent[] | null;
  league?: LeagueStanding | null;
  /** gym_member_activity (Clash+). */
  activity?: MemberActivity | null;
  /** Sessions at the gym by weekday, Monday first, last 28 days (gym_insights.days). */
  weekdays?: number[] | null;
  /** This week's board leader, and how many are on it. */
  leader?: { name: string; points: number } | null;
  onBoard?: number;
  posterMade?: boolean;
  fmtDay: (iso: string) => string;
  lastDay: (iso: string) => string;
};

const num = (n: number) => n.toLocaleString('en-GB');
const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
const DAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const DAY_MS = 86_400_000;
// "Running" → "running", "Gym training" → "gym training", "HIIT" stays.
const lower = (s: string) => (s === s.toUpperCase() ? s : s.charAt(0).toLowerCase() + s.slice(1));
const PACKAGES = '/venue/package';
const BOARD_POST = '/venue/studio?board=week';
const NEW_EVENT = '/venue/events/new';

function eventMoves(i: MovesInput): Move[] {
  if (!i.events) return [];
  const out: Move[] = [];
  const page = (e: MoveEvent, tab?: string) => `/venue/events/${e.id}${tab ? `?tab=${tab}` : ''}`;
  const mine = i.events.filter((e) => e.managed_by === 'gym');

  for (const e of mine) {
    if (e.state === 'locked') {
      out.push({
        key: `reveal:${e.id}`, kind: 'event', urgent: true, priority: 100,
        title: `Reveal the winners of ${e.name}`,
        detail: 'Revealing tells everyone who took part, in the app and on your screens.',
        action: { label: 'Reveal', to: page(e) },
      });
    } else if (e.state === 'rejected') {
      out.push({
        key: `note:${e.id}`, kind: 'event', urgent: true, priority: 95,
        title: `POWR asked for a change to ${e.name}`,
        detail: 'Read the note, make the change and send it back.',
        action: { label: 'See the note', to: page(e) },
      });
    } else if (e.state === 'revealed') {
      const recent = e.revealed_at && i.nowMs - new Date(e.revealed_at).getTime() < 7 * DAY_MS;
      const prizes = e.prizes ?? [];
      const handed = prizes.length > 0 && prizes.every((p) => p.handed_at);
      if (recent && prizes.length > 0 && !handed) {
        out.push({
          key: `prizes:${e.id}`, kind: 'event', priority: 80,
          title: `Hand over the prizes for ${e.name}`,
          detail: 'Winners show their POWR ID at the desk. Tick each prize off as it goes.',
          action: { label: 'Prizes', to: page(e) },
        });
      }
    } else if (e.state === 'draft') {
      out.push({
        key: `draft:${e.id}`, kind: 'event', priority: 50,
        title: `${e.name} is still a draft`,
        detail: 'Publish it so your members can see it in the app.',
        action: { label: 'Finish it', to: page(e) },
      });
    } else if (e.state === 'pending') {
      out.push({
        key: `pending:${e.id}`, kind: 'event', priority: 10,
        title: `${e.name} is with POWR for a quick check`,
        detail: 'It goes live in the app as soon as it’s approved.',
        action: { label: 'View', to: page(e) },
      });
    }
  }

  // Live and upcoming, including POWR-run nights at the gym.
  for (const e of i.events) {
    const n = e.participants ?? 0;
    if (e.state === 'live') {
      out.push({
        key: `live:${e.id}`, kind: 'event', priority: 60,
        title: `${e.name} is live: ${num(n)} in`,
        detail: e.window_end_at ? `It runs until ${i.lastDay(e.window_end_at)}. See who’s out in front.` : 'See who’s out in front.',
        action: { label: 'Standings', to: page(e, 'board') },
      });
    } else if (e.state === 'scheduled' && e.window_start_at) {
      const until = new Date(e.window_start_at).getTime() - i.nowMs;
      if (until < 21 * DAY_MS) {
        out.push({
          key: `soon:${e.id}`, kind: 'event', priority: 45,
          title: `${e.name} starts ${i.fmtDay(e.window_start_at)}`,
          detail: `${n > 0 ? `${plural(n, 'person has', 'people have')} joined so far.` : 'Nobody’s joined yet.'} Put the join QR at the desk and on your socials.`,
          action: { label: 'Promote', to: page(e, 'promote') },
        });
      }
    }
  }

  // Nothing on at all: something for members to aim at.
  const on = i.events.some((e) => ['live', 'scheduled', 'locked', 'draft', 'pending', 'rejected'].includes(e.state));
  if (!on && i.features) {
    if (i.features.events) {
      // One that ran to the end (an archived one reads as cancelled, so go by the reveal).
      const last = mine
        .filter((e) => e.revealed_at || ['revealed', 'settled'].includes(e.state))
        .sort((a, b) => String(b.window_end_at ?? '').localeCompare(String(a.window_end_at ?? '')))[0];
      out.push(last
        ? {
          key: 'again', kind: 'event', priority: 30,
          title: 'Nothing on for your members right now',
          detail: `Run ${last.name} again: the same prizes and rules, new dates.`,
          action: { label: 'Run it again', to: `${NEW_EVENT}?from=${last.id}` },
        }
        : {
          key: 'first', kind: 'event', priority: 30,
          title: 'Run your first event',
          detail: 'A monthly challenge runs itself: the board, the pushes and the reveal.',
          action: { label: 'Start one', to: NEW_EVENT },
        });
    } else {
      out.push({
        key: 'events-locked', kind: 'event', priority: 14,
        title: 'Run your own challenges',
        detail: 'Monthly challenges and weekend sprints that run themselves come with Clash+.',
        action: { label: 'Clash+', to: PACKAGES, lock: 'clash_plus' },
      });
    }
  }
  return out;
}

function memberMoves(i: MovesInput): Move[] {
  const f = i.features;
  if (!f) return [];
  if (!f.insights) {
    return [{
      key: 'quiet-locked', kind: 'members', priority: 12,
      title: 'See who’s drifting before they cancel',
      detail: 'Clash+ counts the members who’ve gone quiet. Clash Pro names them.',
      action: { label: 'Clash+', to: PACKAGES, lock: 'clash_plus' },
    }];
  }
  const a = i.activity;
  const q = a && !a.too_few ? a.quiet ?? 0 : 0;
  if (q < 1) return [];
  // Regulars: 6+ days of training in the 6 weeks before, none in the last 2.
  const title = `${plural(q, 'regular has', 'regulars have')} gone quiet`;
  return f.people
    ? [{
      key: 'quiet', kind: 'members', priority: 70, nudge: true, title,
      detail: 'Nothing in the last 2 weeks. One push from POWR invites them back.',
      action: { label: 'Nudge them', to: '/venue/members' },
    }]
    : [{
      key: 'quiet', kind: 'members', priority: 55, title,
      detail: 'Nothing in the last 2 weeks. Clash Pro names them and nudges them back.',
      action: { label: 'Clash Pro', to: PACKAGES, lock: 'pro' },
    }];
}

function leagueMoves(i: MovesInput): Move[] {
  const l = i.league;
  if (!l || !l.rival || l.count < 2) return [];
  const post = !!i.features?.studio;
  if (!l.ahead && l.gap > 0) {
    const n = sessionsToClose(l.gap);
    return [{
      key: 'league', kind: 'league', priority: 40,
      title: `${num(l.gap)} POWR behind ${l.rival.name}`,
      detail: `About ${plural(n, 'more session', 'more sessions')} would pass them. ${post ? 'Post the board and rally your members.' : 'Keep the race on your gym TV.'}`,
      action: post ? { label: 'Make the post', to: BOARD_POST } : { label: 'Screens', to: '/venue/screens' },
    }];
  }
  if (l.ahead && l.rank === 1 && post) {
    return [{
      key: 'league', kind: 'league', priority: 26,
      title: `Top of the Gym League within ${l.radiusKm} km`,
      detail: l.gap > 0 ? `${num(l.gap)} POWR clear of ${l.rival.name}. Tell your members before the week ends.` : `Level with ${l.rival.name}. Tell your members it’s all to play for.`,
      action: { label: 'Make the post', to: BOARD_POST },
    }];
  }
  return [];
}

function growthMoves(i: MovesInput): Move[] {
  if (i.members >= 25 || i.posterMade) return [];
  return [{
    key: 'poster', kind: 'growth', priority: 28,
    title: i.members === 0
      ? `Nobody’s picked ${i.gymName} in the app yet`
      : `${plural(i.members, 'member has', 'members have')} picked ${i.gymName} in the app`,
    detail: 'The join poster at the desk puts more of them on your board.',
    action: { label: 'Print it', to: '/venue/poster' },
  }];
}

function programmeMoves(i: MovesInput): Move[] {
  const out: Move[] = [];
  const plan: MoveAction = i.features?.events
    ? { label: 'Plan an event', to: NEW_EVENT }
    : { label: 'Clash+', to: PACKAGES, lock: 'clash_plus' };

  // What members do anywhere (Clash+, anonymous): a rise, a fall, training
  // elsewhere, a committed core. Quiet members are their own move.
  const found = memberInsights(i.activity, { gymName: i.gymName, canSeePeople: !!i.features?.people, limit: 8 })
    .find((x) => /^(up|down):/.test(x.key) || x.key === 'elsewhere' || x.key === 'core');
  if (found) {
    // In the card's own words: each one ends in the event it suggests.
    const type = found.key.startsWith('up:') ? found.key.slice(3) : null;
    const detail = type ? `Build a challenge around ${lower(ACTIVITY_NOUN[type] ?? type)} while it’s popular.`
      : found.key === 'elsewhere' ? 'A challenge that only counts sessions here gives them a reason to come back.'
      : found.action;
    out.push({ key: `insight:${found.key}`, kind: 'programme', priority: 34, title: found.finding, detail, action: plan });
  }

  // The quietest day at the gym itself, once there's enough to say so.
  const wd = i.weekdays ?? [];
  const total = wd.reduce((s, n) => s + n, 0);
  if (wd.length === 7 && total >= 50) {
    const lo = wd.indexOf(Math.min(...wd));
    const hi = wd.indexOf(Math.max(...wd));
    if (wd[lo] < 0.6 * (total / 7)) {
      out.push({
        key: 'weekday', kind: 'programme', priority: 32,
        title: `${DAYS[lo]} are your quietest day`,
        detail: `${plural(wd[lo], 'session', 'sessions')} in 4 weeks, against ${num(wd[hi])} on ${DAYS[hi]}. A sprint gives members a reason to come in.`,
        action: plan,
      });
    }
  }
  return out;
}

function screenMoves(i: MovesInput): Move[] {
  if (!i.board) {
    return [{
      key: 'screens', kind: 'screens', priority: 58,
      title: 'Put your leaderboard on the gym TV',
      detail: 'This week’s board and the Gym League, on any screen with a web browser.',
      action: { label: 'Set up', to: '/venue/screens' },
    }];
  }
  if (i.board.enabled === false) {
    return [{
      key: 'screens', kind: 'screens', priority: 25,
      title: 'Your leaderboard screen is paused',
      detail: 'Nobody sees this week’s board on the wall until you switch it back on.',
      action: { label: 'Screens', to: '/venue/screens' },
    }];
  }
  return [];
}

function packageMoves(i: MovesInput): Move[] {
  const d = i.trialDaysLeft;
  if (d == null || d > 14) return [];
  return [{
    key: 'trial', kind: 'package', priority: d <= 7 ? 65 : 42,
    title: d === 0 ? 'Your free trial ends today' : `Your free trial ends in ${plural(d, 'day', 'days')}`,
    detail: 'Choose a package to keep your events, members dashboard and Studio.',
    action: { label: 'Packages', to: PACKAGES },
  }];
}

function contentMoves(i: MovesInput): Move[] {
  if (!i.features?.studio || !i.leader || (i.onBoard ?? 0) < 3) return [];
  return [{
    key: 'post', kind: 'content', priority: 20,
    title: `${i.leader.name} leads this week with ${num(i.leader.points)} POWR`,
    detail: 'This week’s board is ready to post. Add a photo and download it.',
    action: { label: 'Make the post', to: BOARD_POST },
  }];
}

/**
 * Up to `limit` moves, most useful first. At most two about events (unless
 * more are waiting on the gym) and one of any other kind, and never two
 * buttons to the same place, so three moves are three different things.
 */
export function gymMoves(i: MovesInput, limit = 3): Move[] {
  const all = [
    ...eventMoves(i), ...memberMoves(i), ...leagueMoves(i), ...growthMoves(i),
    ...programmeMoves(i), ...screenMoves(i), ...packageMoves(i), ...contentMoves(i),
  ].sort((a, b) => b.priority - a.priority);
  const out: Move[] = [];
  const perKind: Partial<Record<MoveKind, number>> = {};
  const places = new Set<string>();
  for (const m of all) {
    if (out.length >= limit) break;
    const n = perKind[m.kind] ?? 0;
    if (n >= (m.kind === 'event' ? 2 : 1) && !m.urgent) continue;
    if (places.has(m.action.to)) continue;
    out.push(m);
    perKind[m.kind] = n + 1;
    places.add(m.action.to);
  }
  return out;
}

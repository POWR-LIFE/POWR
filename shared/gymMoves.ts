// What's worth doing at a gym this week, most useful first: the gym portal
// Overview's "Worth doing" card. Each move is something the gym couldn't see
// at a glance, the one thing to do about it, and the button that does it (or
// names the package that unlocks it).
//
// The card is never empty: after what the numbers call for come the everyday
// moves (today's post, the join link, next month's challenge, the discounts,
// the Members page, the Studio, a missing photo, team or recap), a different order
// each day. Those can be put off ("Not now", `done`) and the next one steps up.
//
// Pure: the portal passes what it has already loaded (the summary, its
// events, the league standing, the members' activity, the weekly numbers,
// the package) and renders what comes back. Under jest
// (__tests__/gymMoves.test.ts). The words come from the venueHome catalog
// through `t` (the portal's own; English without one), see
// shared/venueHomeText.ts. A programme move built on a member insight quotes
// memberInsights()'s own finding and action, in the same language (it takes the
// same `t`, and its own English without one).

import { memberInsights, ACTIVITY_NOUN, type MemberActivity } from './memberInsights';
import { sessionsToClose } from './gymLeague';
import { DAY_IDS, englishT, ordinalIn, type Translate } from './venueHomeText';

export type MoveKind = 'event' | 'members' | 'league' | 'growth' | 'programme' | 'screens' | 'package' | 'content' | 'setup' | 'tools';

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
  /** An everyday move the gym can put off: until tomorrow, or for a week. */
  snooze?: 'day' | 'week';
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
  posterMade?: boolean;
  /** Today's post from the week's seven: its name, and whether it downloads on this package. */
  todayPost?: { label: string; free: boolean } | null;
  /** The gym has a photo on its POWR listing (false: it hasn't; undefined: unknown). */
  hasPhoto?: boolean;
  /** People shown on the gym's page in the app (gym_team, active); null or undefined: unknown. */
  teamCount?: number | null;
  /** The Monday recap email for whoever is looking: on, off, or unknown (null). */
  recapOn?: boolean | null;
  /** Last week's sessions at the gym. */
  lastWeekSessions?: number | null;
  /** Moves put off on this device: key → until (ISO). */
  done?: Record<string, string>;
  fmtDay: (iso: string) => string;
  lastDay: (iso: string) => string;
  /** The portal's t(); English (shared/venueHomeText.ts) when left out. */
  t?: Translate;
  /** The locale numbers and ordinals are written in; en-GB when left out. */
  locale?: string;
};

/** The words for one run: the translator, and numbers in the reader's locale. */
type Words = { t: Translate; num: (n: number) => string; ordinal: (n: number) => string };
function wordsFor(i: MovesInput): Words {
  const t = i.t ?? englishT;
  const locale = i.locale ?? 'en-GB';
  return { t, num: (n) => n.toLocaleString(locale), ordinal: (n) => ordinalIn(t, locale, n) };
}

const DAY_MS = 86_400_000;
// "Running" → "running", "Gym training" → "gym training", "HIIT" stays.
const lower = (s: string) => (s === s.toUpperCase() ? s : s.charAt(0).toLowerCase() + s.slice(1));
/** The activity inside a sentence ("a challenge around running"), for the types the catalog knows. */
const ACTIVITY_KEY: Record<string, string> = {
  running: 'venueHome:moves.activity.running',
  cycling: 'venueHome:moves.activity.cycling',
  gym: 'venueHome:moves.activity.gym',
  hiit: 'venueHome:moves.activity.hiit',
  swimming: 'venueHome:moves.activity.swimming',
  yoga: 'venueHome:moves.activity.yoga',
  sports: 'venueHome:moves.activity.sports',
  dance: 'venueHome:moves.activity.dance',
  walking: 'venueHome:moves.activity.walking',
};
const PACKAGES = '/venue/package';
const BOARD_POST = '/venue/studio?board=week';
const NEW_EVENT = '/venue/events/new';
/** The Overview itself, with today's post open (WeekPosts reads ?post=today). */
export const TODAY_POST = '/venue?post=today';

function eventMoves(i: MovesInput, { t, num }: Words): Move[] {
  if (!i.events) return [];
  const out: Move[] = [];
  const page = (e: MoveEvent, tab?: string) => `/venue/events/${e.id}${tab ? `?tab=${tab}` : ''}`;
  const mine = i.events.filter((e) => e.managed_by === 'gym');

  for (const e of mine) {
    if (e.state === 'locked') {
      out.push({
        key: `reveal:${e.id}`, kind: 'event', urgent: true, priority: 100,
        title: t('venueHome:moves.reveal.title', { name: e.name }),
        detail: t('venueHome:moves.reveal.detail'),
        action: { label: t('venueHome:moves.reveal.action'), to: page(e) },
      });
    } else if (e.state === 'rejected') {
      out.push({
        key: `note:${e.id}`, kind: 'event', urgent: true, priority: 95,
        title: t('venueHome:moves.note.title', { name: e.name }),
        detail: t('venueHome:moves.note.detail'),
        action: { label: t('venueHome:moves.note.action'), to: page(e) },
      });
    } else if (e.state === 'revealed') {
      const recent = e.revealed_at && i.nowMs - new Date(e.revealed_at).getTime() < 7 * DAY_MS;
      const prizes = e.prizes ?? [];
      const handed = prizes.length > 0 && prizes.every((p) => p.handed_at);
      if (recent && prizes.length > 0 && !handed) {
        out.push({
          key: `prizes:${e.id}`, kind: 'event', priority: 80,
          title: t('venueHome:moves.prizes.title', { name: e.name }),
          detail: t('venueHome:moves.prizes.detail'),
          action: { label: t('venueHome:moves.prizes.action'), to: page(e) },
        });
      }
    } else if (e.state === 'draft') {
      out.push({
        key: `draft:${e.id}`, kind: 'event', priority: 50,
        title: t('venueHome:moves.draft.title', { name: e.name }),
        detail: t('venueHome:moves.draft.detail'),
        action: { label: t('venueHome:moves.draft.action'), to: page(e) },
      });
    } else if (e.state === 'pending') {
      out.push({
        key: `pending:${e.id}`, kind: 'event', priority: 10,
        title: t('venueHome:moves.pending.title', { name: e.name }),
        detail: t('venueHome:moves.pending.detail'),
        action: { label: t('venueHome:moves.pending.action'), to: page(e) },
      });
    }
  }

  // Live and upcoming, including POWR-run nights at the gym.
  for (const e of i.events) {
    const n = e.participants ?? 0;
    if (e.state === 'live') {
      out.push({
        key: `live:${e.id}`, kind: 'event', priority: 60,
        title: t('venueHome:moves.live.title', { name: e.name, n: num(n) }),
        detail: e.window_end_at ? t('venueHome:moves.live.detailUntil', { date: i.lastDay(e.window_end_at) }) : t('venueHome:moves.live.detail'),
        action: { label: t('venueHome:moves.live.action'), to: page(e, 'board') },
      });
    } else if (e.state === 'scheduled' && e.window_start_at) {
      const until = new Date(e.window_start_at).getTime() - i.nowMs;
      if (until < 21 * DAY_MS) {
        out.push({
          key: `soon:${e.id}`, kind: 'event', priority: 45,
          title: t('venueHome:moves.soon.title', { name: e.name, date: i.fmtDay(e.window_start_at) }),
          detail: n > 0 ? t('venueHome:moves.soon.joined', { count: n, n: num(n) }) : t('venueHome:moves.soon.nobody'),
          action: { label: t('venueHome:moves.soon.action'), to: page(e, 'promote') },
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
          title: t('venueHome:moves.again.title'),
          detail: t('venueHome:moves.again.detail', { name: last.name }),
          action: { label: t('venueHome:moves.again.action'), to: `${NEW_EVENT}?from=${last.id}` },
        }
        : {
          key: 'first', kind: 'event', priority: 30,
          title: t('venueHome:moves.first.title'),
          detail: t('venueHome:moves.first.detail'),
          action: { label: t('venueHome:moves.first.action'), to: NEW_EVENT },
        });
    } else {
      out.push({
        key: 'events-locked', kind: 'event', priority: 14,
        title: t('venueHome:moves.eventsLocked.title'),
        detail: t('venueHome:moves.eventsLocked.detail'),
        action: { label: 'Clash+', to: PACKAGES, lock: 'clash_plus' }, // the package's name
      });
    }
  }
  return out;
}

function memberMoves(i: MovesInput, { t, num }: Words): Move[] {
  const f = i.features;
  if (!f) return [];
  if (!f.insights) {
    return [{
      key: 'quiet-locked', kind: 'members', priority: 12,
      title: t('venueHome:moves.quietLocked.title'),
      detail: t('venueHome:moves.quietLocked.detail'),
      action: { label: 'Clash+', to: PACKAGES, lock: 'clash_plus' },
    }];
  }
  const a = i.activity;
  const q = a && !a.too_few ? a.quiet ?? 0 : 0;
  if (q < 1) return [];
  // Retention's drifting: well past their own usual gap between visits.
  const title = t('venueHome:moves.quiet.title', { count: q, n: num(q) });
  return f.people
    ? [{
      key: 'quiet', kind: 'members', priority: 70, nudge: true, title,
      detail: t('venueHome:moves.quiet.detailPro'),
      action: { label: t('venueHome:moves.quiet.action'), to: '/venue/retention' },
    }]
    : [{
      key: 'quiet', kind: 'members', priority: 55, title,
      detail: t('venueHome:moves.quiet.detailPlus'),
      action: { label: 'Clash Pro', to: PACKAGES, lock: 'pro' },
    }];
}

function leagueMoves(i: MovesInput, { t, num }: Words): Move[] {
  const l = i.league;
  if (!l || !l.rival || l.count < 2) return [];
  const post = !!i.features?.studio;
  if (!l.ahead && l.gap > 0) {
    const n = sessionsToClose(l.gap);
    return [{
      key: 'league', kind: 'league', priority: 40,
      title: t('venueHome:moves.league.behind', { gap: num(l.gap), rival: l.rival.name }),
      detail: post ? t('venueHome:moves.league.passPost', { count: n, n: num(n) }) : t('venueHome:moves.league.passScreens', { count: n, n: num(n) }),
      action: post ? { label: t('venueHome:moves.league.makePost'), to: BOARD_POST } : { label: t('venueHome:moves.league.screens'), to: '/venue/screens' },
    }];
  }
  if (l.ahead && l.rank === 1 && post) {
    return [{
      key: 'league', kind: 'league', priority: 26,
      title: t('venueHome:moves.league.top', { km: l.radiusKm }),
      detail: l.gap > 0 ? t('venueHome:moves.league.clear', { gap: num(l.gap), rival: l.rival.name }) : t('venueHome:moves.league.level', { rival: l.rival.name }),
      action: { label: t('venueHome:moves.league.makePost'), to: BOARD_POST },
    }];
  }
  return [];
}

function growthMoves(i: MovesInput, { t, num }: Words): Move[] {
  if (i.members >= 25 || i.posterMade) return [];
  return [{
    key: 'poster', kind: 'growth', priority: 28,
    title: i.members === 0
      ? t('venueHome:moves.poster.nobody', { gym: i.gymName })
      : t('venueHome:moves.poster.picked', { count: i.members, n: num(i.members), gym: i.gymName }),
    detail: t('venueHome:moves.poster.detail'),
    action: { label: t('venueHome:moves.poster.action'), to: '/venue/poster' },
  }];
}

function programmeMoves(i: MovesInput, { t, num }: Words): Move[] {
  const out: Move[] = [];
  const plan: MoveAction = i.features?.events
    ? { label: t('venueHome:moves.plan'), to: NEW_EVENT }
    : { label: 'Clash+', to: PACKAGES, lock: 'clash_plus' };

  // What members do anywhere (Clash+, anonymous): a rise, a fall, training
  // elsewhere, a committed core. Quiet members are their own move.
  const found = memberInsights(i.activity, { gymName: i.gymName, canSeePeople: !!i.features?.people, limit: 8, t: i.t, locale: i.locale })
    .find((x) => /^(up|down):/.test(x.key) || x.key === 'elsewhere' || x.key === 'core');
  if (found) {
    // In the card's own words: each one ends in the event it suggests.
    const type = found.key.startsWith('up:') ? found.key.slice(3) : null;
    const activity = type && (ACTIVITY_KEY[type] ? t(ACTIVITY_KEY[type]) : lower(ACTIVITY_NOUN[type] ?? type));
    const detail = activity ? t('venueHome:moves.insight.up', { activity })
      : found.key === 'elsewhere' ? t('venueHome:moves.insight.elsewhere')
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
        title: t('venueHome:moves.weekday.title', { days: t(`venueHome:days.plural.${DAY_IDS[lo]}`) }),
        detail: t('venueHome:moves.weekday.detail', { count: wd[lo], n: num(wd[lo]), hi: num(wd[hi]), hiDays: t(`venueHome:days.plural.${DAY_IDS[hi]}`) }),
        action: plan,
      });
    }
  }
  return out;
}

function screenMoves(i: MovesInput, { t }: Words): Move[] {
  if (!i.board) {
    return [{
      key: 'screens', kind: 'screens', priority: 58,
      title: t('venueHome:moves.screens.setupTitle'),
      detail: t('venueHome:moves.screens.setupDetail'),
      action: { label: t('venueHome:moves.screens.setupAction'), to: '/venue/screens' },
    }];
  }
  if (i.board.enabled === false) {
    return [{
      key: 'screens', kind: 'screens', priority: 25,
      title: t('venueHome:moves.screens.pausedTitle'),
      detail: t('venueHome:moves.screens.pausedDetail'),
      action: { label: t('venueHome:moves.screens.action'), to: '/venue/screens' },
    }];
  }
  return [];
}

function packageMoves(i: MovesInput, { t, num }: Words): Move[] {
  const d = i.trialDaysLeft;
  if (d == null || d > 14) return [];
  return [{
    key: 'trial', kind: 'package', priority: d <= 7 ? 65 : 42,
    title: d === 0 ? t('venueHome:moves.trial.today') : t('venueHome:moves.trial.endsIn', { count: d, n: num(d) }),
    detail: t('venueHome:moves.trial.detail'),
    action: { label: t('venueHome:moves.trial.action'), to: PACKAGES },
  }];
}

// Nothing on the calendar in the next 30 days: a draft or a live event doesn't count as next month.
function nothingAhead(i: MovesInput): boolean {
  if (!i.events) return false;
  return !i.events.some((e) => e.state === 'scheduled' && e.window_start_at
    && new Date(e.window_start_at).getTime() - i.nowMs < 30 * DAY_MS);
}

function everydayMoves(i: MovesInput, { t, num, ordinal }: Words): Move[] {
  const f = i.features ?? {};
  const g = i.gymName;
  const out: Move[] = [];

  // Today's post, from the week's seven: something to do every single day.
  if (i.todayPost) {
    const can = !!f.studio || i.todayPost.free;
    out.push({
      key: 'post:today', kind: 'content', priority: 23, snooze: 'day',
      title: t('venueHome:moves.post.title', { label: i.todayPost.label }),
      detail: can ? t('venueHome:moves.post.ready') : t('venueHome:moves.post.locked'),
      action: { label: can ? t('venueHome:moves.post.postIt') : t('venueHome:moves.post.seeIt'), to: TODAY_POST },
    });
  }

  // The rest take turns: each only when it's useful, a different order each day.
  const pool: Array<Omit<Move, 'priority'>> = [];
  pool.push({
    key: 'join-link', kind: 'growth', snooze: 'week',
    title: t('venueHome:moves.joinLink.title'),
    detail: t('venueHome:moves.joinLink.detail', { gym: g }),
    action: { label: t('venueHome:moves.joinLink.action'), to: '/venue/poster' },
  });
  if (i.hasPhoto === false) {
    pool.push({
      key: 'photo', kind: 'setup', snooze: 'week',
      title: t('venueHome:moves.photo.title'),
      detail: t('venueHome:moves.photo.detail'),
      action: { label: t('venueHome:moves.photo.action'), to: '/venue#app-cover' },
    });
  }
  if (i.teamCount === 0) {
    pool.push({
      key: 'team', kind: 'setup', snooze: 'week',
      title: t('venueHome:moves.team.title'),
      detail: t('venueHome:moves.team.detail', { gym: g }),
      action: { label: t('venueHome:moves.team.action'), to: '/venue#app-team' },
    });
  }
  if (i.recapOn === false) {
    pool.push({
      key: 'recap', kind: 'setup', snooze: 'week',
      title: t('venueHome:moves.recap.title'),
      detail: t('venueHome:moves.recap.detail'),
      action: { label: t('venueHome:moves.recap.action'), to: '/venue/settings#recap' },
    });
  }
  if (f.events && nothingAhead(i)) {
    pool.push({
      key: 'plan-next', kind: 'event', snooze: 'week',
      title: t('venueHome:moves.planNext.title'),
      detail: t('venueHome:moves.planNext.detail'),
      action: { label: t('venueHome:moves.planNext.action'), to: NEW_EVENT },
    });
  }
  if (f.events) {
    pool.push({
      key: 'discounts', kind: 'tools', snooze: 'week',
      title: t('venueHome:moves.discounts.title'),
      detail: t('venueHome:moves.discounts.detail'),
      action: { label: t('venueHome:moves.discounts.action'), to: '/venue/partners' },
    });
  }
  if (f.insights) {
    pool.push({
      key: 'members', kind: 'tools', snooze: 'week',
      title: i.lastWeekSessions
        ? t('venueHome:moves.members.lastWeek', { count: i.lastWeekSessions, n: num(i.lastWeekSessions) })
        : t('venueHome:moves.members.title'),
      detail: t('venueHome:moves.members.detail'),
      action: { label: t('venueHome:moves.members.action'), to: '/venue/members' },
    });
  }
  if (f.studio) {
    pool.push({
      key: 'studio', kind: 'tools', snooze: 'week',
      title: t('venueHome:moves.studio.title'),
      detail: t('venueHome:moves.studio.detail'),
      action: { label: t('venueHome:moves.studio.action'), to: '/venue/studio' },
    });
  }
  const l = i.league;
  if (l && l.rival && l.count >= 2) {
    pool.push({
      key: 'league-screen', kind: 'league', snooze: 'week',
      title: t('venueHome:moves.leagueScreen.title', { rank: ordinal(l.rank), total: l.count }),
      detail: t('venueHome:moves.leagueScreen.detail'),
      action: { label: t('venueHome:moves.leagueScreen.action'), to: '/venue/screens' },
    });
  }
  const d = Math.floor(i.nowMs / DAY_MS);
  pool.forEach((m, k) => out.push({ ...m, priority: 9 - (((k - d) % pool.length) + pool.length) % pool.length * 0.5 }));
  return out;
}

/**
 * Exactly `limit` moves whenever there are that many to give, most useful
 * first. At most two about events (unless more are waiting on the gym) and
 * one of any other kind, and never two buttons to the same place, so three
 * moves are three different things. Everyday moves the gym has put off
 * (`done`) step aside until their time is up.
 */
export function gymMoves(i: MovesInput, limit = 3): Move[] {
  const away = (m: Move) => {
    const until = m.snooze ? i.done?.[m.key] : undefined;
    return !!until && Date.parse(until) > i.nowMs;
  };
  const w = wordsFor(i);
  const all = [
    ...eventMoves(i, w), ...memberMoves(i, w), ...leagueMoves(i, w), ...growthMoves(i, w),
    ...programmeMoves(i, w), ...screenMoves(i, w), ...packageMoves(i, w), ...everydayMoves(i, w),
  ].filter((m) => !away(m)).sort((a, b) => b.priority - a.priority);
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

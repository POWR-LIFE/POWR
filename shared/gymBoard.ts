/**
 * Gym big-screen board — pure helpers shared by the display page
 * (landing-page/src/pages/GymBoard.jsx) and the admin panel.
 * No React, no network: everything here is unit-testable.
 */

export type BoardLevel = { level: number; name: string; tier: string; colour: string };

export type BoardRow = {
  key: string;
  rank: number;
  points: number;
  sessions: number;
  rank_delta?: number | null;
  display_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  minutes?: number;
  today_points?: number;
  streak?: number;
  is_new?: boolean;
  is_pb?: boolean;
  last_week_points?: number;
  level?: BoardLevel | null;
  member_since?: string | null;
};

const SAMPLE_LEVELS: BoardLevel[] = [
  { level: 12, name: 'Move Machine', tier: 'Elite', colour: '#E8D200' },
  { level: 8, name: 'Pavement Predator', tier: 'Athlete', colour: '#fb923c' },
  { level: 4, name: 'Motion Magic', tier: 'Recruit', colour: '#999999' },
  { level: 16, name: 'Limit Breaker', tier: 'Legend', colour: '#E8D200' },
  { level: 6, name: "Can't Sit Still", tier: 'Athlete', colour: '#fb923c' },
  { level: 2, name: 'Cardio Goblin', tier: 'Recruit', colour: '#999999' },
];

/** URL slug for a gym: lower-case, dashes, nothing else. */
export function gymSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/** Unguessable display token — 48 hex chars, matches the live-event shape. */
export function newDisplayToken(random: (bytes: Uint8Array) => void): string {
  const bytes = new Uint8Array(24);
  random(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The board's URL. `origin` defaults to the canonical host the gym receives;
 *  pass the admin's own origin for Open/Preview so they work from localhost
 *  and Vercel branch previews before the route is on powr.life. */
export function boardUrl(slug: string, token: string, preview?: string | null, origin = 'https://powr.life'): string {
  const base = `${origin.replace(/\/+$/, '')}/gym/${slug}?k=${token}`;
  return preview ? `${base}&preview=${preview}` : base;
}

/** Name as the screen shows it. Never a user id, never an email. */
export function boardName(row: { display_name?: string | null; username?: string | null }): string {
  return row.display_name || row.username || 'POWR member';
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** "Mon 7 – Sun 13 Sep" / "Mon 28 Sep – Sun 4 Oct" in the board's own zone. */
export function weekLabel(startIso: string, endIso: string, tz: string, locale = 'en-GB'): string {
  const start = new Date(startIso);
  // The window is half-open; the last day that counts is a minute before it closes.
  const last = new Date(new Date(endIso).getTime() - 60_000);
  const day = (d: Date, withMonth: boolean) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      ...(withMonth ? { month: 'short' } : {}),
    }).format(d);
  const monthOf = (d: Date) => new Intl.DateTimeFormat(locale, { timeZone: tz, month: 'short' }).format(d);
  const sameMonth = monthOf(start) === monthOf(last);
  return `${day(start, !sameMonth)} – ${day(last, true)}`;
}

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number; totalMs: number };

export function countdownParts(targetIso: string, nowMs: number): CountdownParts {
  const totalMs = Math.max(0, new Date(targetIso).getTime() - nowMs);
  return {
    days: Math.floor(totalMs / 86_400_000),
    hours: Math.floor((totalMs % 86_400_000) / 3_600_000),
    minutes: Math.floor((totalMs % 3_600_000) / 60_000),
    seconds: Math.floor((totalMs % 60_000) / 1000),
    totalMs,
  };
}

/** "2d 14h" / "14h 06m" / "06m 12s" — the reset clock reads at one glance. */
export function resetLabel(parts: CountdownParts): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (parts.days > 0) return `${parts.days}d ${pad(parts.hours)}h`;
  if (parts.hours > 0) return `${parts.hours}h ${pad(parts.minutes)}m`;
  return `${pad(parts.minutes)}m ${pad(parts.seconds)}s`;
}

/** Split standings into the podium (1–3), the list (4–N) and the ticker (N+1…). */
export function splitStandings(rows: BoardRow[], listSize = 7): { podium: BoardRow[]; list: BoardRow[]; rest: BoardRow[] } {
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  return {
    podium: sorted.slice(0, 3),
    list: sorted.slice(3, 3 + listSize),
    rest: sorted.slice(3 + listSize),
  };
}

/** Width of a row's bar as a fraction of the leader's points (0–1). */
export function barFraction(points: number, leaderPoints: number): number {
  if (leaderPoints <= 0 || points <= 0) return 0;
  return Math.max(0.04, Math.min(1, points / leaderPoints));
}

/** Root font-size that scales a 1920×1080 design to any TV (16px at 1080p). */
export function rootFontSize(width: number, height: number, base = 16): number {
  const scale = Math.min(width / 1920, height / 1080);
  return Math.round(Math.min(40, Math.max(9, base * scale)) * 100) / 100;
}

/** Sample rows for the admin preview — obviously fake, never mistaken for real scores. */
export function sampleStandings(n: number): BoardRow[] {
  const names = [
    'Alex P.', 'Jordan R.', 'Sam T.', 'Charlie M.', 'Taylor B.', 'Morgan K.', 'Riley S.', 'Casey D.',
    'Jamie W.', 'Drew H.', 'Robin F.', 'Quinn L.', 'Avery N.', 'Skyler J.', 'Reese C.', 'Rowan G.',
    'Emerson V.', 'Finley O.', 'Harper E.', 'Kendall A.', 'Logan I.', 'Marley U.', 'Noel Y.', 'Parker Z.',
  ];
  const deltas = [0, 2, -1, 1, 0, 3, -2, 0, 1, -1, 0, 2];
  const streaks = [14, 3, 27, 0, 6, 2, 41, 1, 9, 0, 5, 12];
  return names.slice(0, n).map((name, i) => ({
    key: `sample-${i}`,
    rank: i + 1,
    points: 1240 - i * 61 - (i % 3) * 17,
    sessions: Math.max(1, 6 - Math.floor(i / 3)),
    rank_delta: deltas[i % deltas.length],
    display_name: name,
    username: null,
    avatar_url: null,
    minutes: 55 * Math.max(1, 6 - Math.floor(i / 3)) + (i * 7) % 40,
    today_points: i % 4 === 0 ? 85 - i * 3 : 0,
    streak: streaks[i % streaks.length],
    is_new: i === 5 || i === 11,
    is_pb: i === 1 || i === 6,
    last_week_points: i % 5 === 0 ? 0 : 900 - i * 50,
    level: SAMPLE_LEVELS[i % SAMPLE_LEVELS.length],
    member_since: '2026-03-14T10:00:00Z',
  }));
}

/** "2h 10m" / "45m" — minutes trained, as the wall prints them. */
export function fmtMinutes(min: number, opts: { compact?: boolean } = {}): string {
  if (!min || min <= 0) return '0m';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  // Stat tiles: past ten hours the minutes are noise and the tile is narrow.
  if (opts.compact && h >= 10) return `${h}h`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

/** "Sept 2026" for a member-since stamp. */
export function memberSince(iso: string | null | undefined, tz = 'Europe/London', locale = 'en-GB'): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(locale, { timeZone: tz, month: 'short', year: 'numeric' }).format(new Date(iso));
}

export type Spotlight = { kind: 'session' | 'improved' | 'new'; [k: string]: unknown };

/** Which spotlight cards a board can show, in rotation order. Empty → no card. */
export function spotlightCards(spot: { session?: unknown; improved?: unknown; new_members?: unknown[] } | null | undefined): Array<'session' | 'improved' | 'new'> {
  if (!spot) return [];
  const out: Array<'session' | 'improved' | 'new'> = [];
  if (spot.session) out.push('session');
  if (spot.improved) out.push('improved');
  if (Array.isArray(spot.new_members) && spot.new_members.length > 0) out.push('new');
  return out;
}

// ─── Activity feed ──────────────────────────────────────────────

export type FeedItem = {
  key: string;
  display_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  type: string;
  started_at: string;
  ended_at: string;
  minutes: number;
  points: number;
  verified: boolean;
};

/** How each activity reads on the wall. Glyph + label; the label is what they "earned on". */
export const ACTIVITY_META: Record<string, { glyph: string; label: string }> = {
  gym:      { glyph: '🏋️', label: 'Gym session' },
  running:  { glyph: '🏃', label: 'Run' },
  cycling:  { glyph: '🚴', label: 'Ride' },
  swimming: { glyph: '🏊', label: 'Swim' },
  hiit:     { glyph: '⚡', label: 'HIIT' },
  yoga:     { glyph: '🧘', label: 'Yoga' },
  sports:   { glyph: '🏅', label: 'Sport' },
  dance:    { glyph: '💃', label: 'Dance' },
  walking:  { glyph: '🚶', label: 'Walk' },
};

export function activityMeta(type: string): { glyph: string; label: string } {
  return ACTIVITY_META[type] ?? { glyph: '✦', label: 'Session' };
}

/** "Just now" / "35m ago" / "3h ago" / "Yesterday 18:54" / "Wed 07:10" — when a session finished. */
export function whenLabel(iso: string, nowMs: number, tz: string, locale = 'en-GB'): string {
  const t = new Date(iso).getTime();
  const diffMin = Math.floor((nowMs - t) / 60_000);
  if (diffMin < 2) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 6) return `${diffH}h ago`;
  const dayKey = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const time = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t));
  const today = dayKey(nowMs);
  const yesterday = dayKey(nowMs - 86_400_000);
  const day = dayKey(t);
  if (day === today) return `Today ${time}`;
  if (day === yesterday) return `Yesterday ${time}`;
  const wd = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short' }).format(new Date(t));
  return `${wd} ${time}`;
}

export type Scene = 'board' | 'community' | 'activity' | 'chasing';

/** The rotation the main column plays, given what the board has to show.
 *  Board always; the community picture when the server sent one; chasing
 *  only past the list. The per-session activity wall is NOT in rotation —
 *  twelve random cards stop meaning anything past a few dozen members — but
 *  it stays reachable by pin (?scene=activity) while there is a feed. */
export function scenePlan(opts: { feed: number; rest: number; community?: boolean }): Array<{ scene: Scene; ms: number }> {
  const plan: Array<{ scene: Scene; ms: number }> = [{ scene: 'board', ms: 36_000 }];
  if (opts.community) plan.push({ scene: 'community', ms: 16_000 });
  if (opts.rest > 0) plan.push({ scene: 'chasing', ms: 10_000 });
  return plan;
}

/** Sample feed for the admin preview. */
export function sampleActivity(nowMs: number): FeedItem[] {
  const rows = sampleStandings(12);
  const types = ['gym', 'running', 'hiit', 'gym', 'swimming', 'yoga', 'gym', 'cycling', 'gym', 'sports', 'gym', 'walking'];
  return rows.map((r, i) => {
    const ended = nowMs - (8 + i * 137) * 60_000;
    const minutes = 35 + ((i * 23) % 70);
    return {
      key: `feed-${i}`,
      display_name: r.display_name,
      username: null,
      avatar_url: null,
      type: types[i % types.length],
      started_at: new Date(ended - minutes * 60_000).toISOString(),
      ended_at: new Date(ended).toISOString(),
      minutes,
      points: 12 + ((i * 7) % 31),
      verified: i % 5 !== 4,
    };
  });
}

// ─── Community scene ────────────────────────────────────────────

export type DayPoint = { date: string; points: number; sessions: number; minutes?: number; members?: number };

/** Mon..Sun labels for a week series, with today's index on the board's grid. */
export function weekdayShort(dateIso: string, locale = 'en-GB'): string {
  // dates are bare YYYY-MM-DD from the server; parse as UTC noon to dodge DST
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${dateIso}T12:00:00Z`));
}

export function todayIndex(week: DayPoint[], nowMs: number, tz: string): number {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
  return week.findIndex((d) => d.date === key);
}

/** "+23%" / "−8%" / null when there is nothing to compare against. */
export function pctChange(now: number, before: number): { pct: number; label: string } | null {
  if (!before || before <= 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return { pct, label: `${sign}${Math.abs(pct)}%` };
}

/** "6pm" / "7am" / "12pm" — the wall's hour label. */
export function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

const WEEKDAY_FULL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function weekdayFull(isodow: number): string {
  return WEEKDAY_FULL[isodow] ?? '';
}

/** "1st" / "2nd" / "23rd" */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** Sample community block for the admin preview. */
export function sampleCommunity(nowMs: number, tz = 'Europe/London'): Record<string, unknown> {
  const key = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const dow = (new Date(nowMs).getUTCDay() + 6) % 7; // 0 = Monday
  const monday = nowMs - dow * 86_400_000;
  const pts = [1420, 1660, 1310, 1890, 1540, 980, 0];
  const lastPts = [1210, 1480, 1390, 1500, 1320, 1110, 640];
  const week = pts.map((p, i) => ({
    date: key(monday + i * 86_400_000),
    points: i <= dow ? p : 0,
    sessions: i <= dow ? Math.round(p / 21) : 0,
    minutes: i <= dow ? Math.round(p * 2.4) : 0,
    members: i <= dow ? Math.round(p / 48) : 0,
  }));
  const last_week = lastPts.map((p, i) => ({ date: key(monday - (7 - i) * 86_400_000), points: p, sessions: Math.round(p / 21) }));
  return {
    tz,
    week,
    last_week,
    now: { in_gym: 7, sessions: 41, points: 890, members: 33, minutes: 2210 },
    vs_last: { points: 8800, points_last: 7250, sessions: 412, sessions_last: 361, members: 96, members_last: 84 },
    mix: [
      { type: 'gym', sessions: 1180, points: 24500, minutes: 71000 },
      { type: 'hiit', sessions: 260, points: 6100, minutes: 11200 },
      { type: 'running', sessions: 140, points: 3900, minutes: 7600 },
      { type: 'yoga', sessions: 90, points: 1700, minutes: 5100 },
      { type: 'swimming', sessions: 40, points: 900, minutes: 1900 },
    ],
    peak: { hour: 18, weekday: 2, by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, sessions: Math.round(Math.max(0, 40 * Math.exp(-((h - 18) ** 2) / 8) + 22 * Math.exp(-((h - 7) ** 2) / 4))) })) },
    streaks: { on_7plus: 23, on_30plus: 4, longest: { key: 'sample-streak', display_name: 'Riley S.', username: null, avatar_url: null, streak: 41 } },
    rank: { rank: 2, of: 37, points: 8800 },
    all_time: { sessions: 6420, minutes: 391000, members: 214, points: 128400, since: '2026-03-02T09:00:00Z' },
  };
}

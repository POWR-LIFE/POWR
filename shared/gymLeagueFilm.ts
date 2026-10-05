/**
 * Gym League — FILM MODE: a whole city on POWR, for promo footage.
 *
 * powr.life/league/film?preview=film renders the real Gym League page on a
 * simulated week: POWR's own London gyms — real names, real locations, real
 * logos, from `partners` (landing-page/src/data/londonFilmGyms.json, built
 * from the database; hotels, parks and non-gyms removed) — ~25,000 athletes
 * spread across them, and a steady stream of sessions landing so lanes race,
 * ranks swap and the map ripples. The activity is simulated; nothing is read
 * from or written to the database at runtime. ONE LDN hosts.
 *
 * Pure and seeded: the same seed and clock give the same opening board and
 * the same sequence of landings, so every take of the film matches.
 */

import { haversineKm, type LeagueFeedItem, type LeagueGym, type LeaguePayload } from './gymLeague';

/** [lat, lng, name, area, logo_url, logo_bg] per gym. */
export type FilmData = { gyms: Array<[number, number, string, string, string | null, string]> };

export type FilmOptions = {
  /** Athletes on POWR across the city (active + lapsed members). */
  athletes?: number;
  seed?: number;
  tz?: string;
};

export type FilmState = {
  payload: LeaguePayload;
  /** Cumulative pick weights over the OFF-screen gyms (indexes in `off`). */
  cum: number[];
  off: number[];
  /** Indexes of the gyms a viewer can see (both races + the host); they share FILM_ON_SCREEN_SHARE of landings. */
  on: number[];
  /** Keys in the host's local lens — the tightest race, so it gets triple weight. */
  local: Set<string>;
  /** Gyms the screen is showing right now (set by the page via filmFocus); they get FILM_FOCUS_SHARE of landings. */
  focus: number[];
  rnd: () => number;
  n: number;
};

export const FILM_HOST = {
  key: 'film-host', name: 'ONE LDN', address: 'Imperial Wharf, Fulham', lat: 51.47371, lng: -0.18256,
  // ONE LDN's logo (partners.logo_url), used if the data file lacks it.
  logo_url: 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/partner-logos/partners/1780309700450-phgw9x.webp',
  logo_bg: 'dark',
};
export const FILM_DEFAULT_ATHLETES = 25_000;
export const FILM_LOCAL_GYMS = 12;
/** Share of landings that go to gyms on screen. */
export const FILM_ON_SCREEN_SHARE = 0.7;
/** Points behind the gym above that doubles a lane's chance of the next landing. */
export const FILM_CHASE_PTS = 12;
/** Points between neighbouring lanes at the front of a race: about one session. */
export const FILM_RUNG_PTS = 14;
/** Below the front of a race, each lane starts this share of the leader's points lower. */
export const FILM_STEP_DOWN = 0.035;
/** Sessions kept in the feed: enough that both sides of the head-to-head can show their last four. */
export const FILM_FEED_MAX = 150;
/** Share of landings that go to the gyms in the current scene — the head-to-head shows two, so they trade points every second or two. */
export const FILM_FOCUS_SHARE = 0.45;

// Big-box operators and council leisure centres have bigger floors than
// studios and boutiques; the rest sit in between.
const BIG = /\b(puregym|the gym group|virgin active|david lloyd|nuffield|third space|energie|anytime|bannatyne|fitness first|gymbox|leisure|sports centre|lido|baths|park view)\b/i;
const SMALL = /\b(yoga|pilates|barre|boxing|martial|kickboxing|studio|spin|1rebel|barry's|psycle|sweatbox|reformer|dance|gymnastics|self defence|fight|personal training|climbing|tennis)\b/i;

const FIRST = [
  'Amara', 'Ben', 'Chloe', 'Dev', 'Ella', 'Femi', 'Grace', 'Hassan', 'Isla', 'Jonah', 'Kemi', 'Leo', 'Maya', 'Nico', 'Olu', 'Priya', 'Quinn',
  'Rafa', 'Sofia', 'Tom', 'Uma', 'Vik', 'Wren', 'Yusuf', 'Zara', 'Aisha', 'Callum', 'Dani', 'Eli', 'Freya', 'Georgie', 'Harry', 'Imogen',
  'Jas', 'Kai', 'Lola', 'Marcus', 'Nadia', 'Oscar', 'Poppy', 'Reece', 'Suzi', 'Theo', 'Anya', 'Bilal', 'Cara', 'Darius', 'Esme', 'Finn',
  'Hana', 'Ivan', 'Jade', 'Kris', 'Luca', 'Mia', 'Noor', 'Ola', 'Ruby', 'Sam', 'Tash', 'Arjun', 'Bea', 'Caleb', 'Divya', 'Eva', 'Gabe',
  'Holly', 'Idris', 'Jess', 'Kofi', 'Lily', 'Mo', 'Nina', 'Omar', 'Pia', 'Rosa', 'Sami', 'Tara', 'Will', 'Yas', 'Ada', 'Charlie', 'Elif',
];

const TYPES: Array<[string, number, number, number]> = [
  // type, weight, min minutes, spread
  ['gym', 44, 35, 50], ['hiit', 14, 25, 25], ['cycling', 9, 30, 30], ['yoga', 9, 45, 30],
  ['running', 8, 25, 45], ['swimming', 6, 30, 30], ['sports', 5, 45, 45], ['dance', 5, 40, 25],
];

// Share of a week's training by weekday (Mon..Sun) and of a day's by hour.
const DAY_W = [1.15, 1.1, 1.05, 1.0, 0.8, 0.9, 0.7];
const HOUR_W = [0.2, 0.1, 0.05, 0.05, 0.2, 1.2, 4.5, 6.5, 5.5, 3.5, 2.8, 3, 4.2, 4, 2.6, 2.4, 3.8, 6.5, 8, 7, 4.5, 2.6, 1.2, 0.5];
const DAY_SUM = DAY_W.reduce((s, v) => s + v, 0);
const HOUR_SUM = HOUR_W.reduce((s, v) => s + v, 0);
const HOUR_MAX = Math.max(...HOUR_W);

/** Seeded PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Where `ms` sits in its local week: Monday 00:00 and today 00:00 as epoch ms, weekday (Mon = 0), fractional hour. */
export function weekClock(ms: number, tz = 'Europe/London'): { weekStart: number; dayStart: number; dayIdx: number; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const dayIdx = Math.max(0, WEEKDAYS.indexOf(parts.weekday));
  const secs = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  const dayStart = ms - secs * 1000 - (ms % 1000);
  return { weekStart: dayStart - dayIdx * 86_400_000, dayStart, dayIdx, hour: secs / 3600 };
}

/** "thu-19:00" → weekday 3, 19:00. Null when it doesn't parse. */
export function parseFilmClock(at: string | null | undefined): { day: number; hour: number; minute: number } | null {
  const m = /^(mon|tue|wed|thu|fri|sat|sun)[-_ ]?(\d{1,2})(?::?(\d{2}))?$/i.exec((at ?? '').trim());
  if (!m) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3] ?? 0);
  if (hour > 23 || minute > 59) return null;
  return { day: WEEKDAYS.findIndex((d) => d.toLowerCase() === m[1].toLowerCase()), hour, minute };
}

/** Milliseconds to add to the real clock so the screen reads `at` in the current week. 0 when `at` is absent. */
export function filmClockOffset(at: string | null | undefined, realMs: number, tz = 'Europe/London'): number {
  const c = parseFilmClock(at);
  if (!c) return 0;
  const { weekStart } = weekClock(realMs, tz);
  return weekStart + ((c.day * 24 + c.hour) * 60 + c.minute) * 60_000 - realMs;
}

/** Share of a day's training done by `hour` (fractional). */
export function dayShareBy(hour: number): number {
  const h = Math.max(0, Math.min(24, hour));
  let s = 0;
  for (let i = 0; i < Math.floor(h); i++) s += HOUR_W[i];
  if (h < 24) s += HOUR_W[Math.floor(h)] * (h - Math.floor(h));
  return s / HOUR_SUM;
}

function gauss(rnd: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
}

function athleteName(rnd: () => number): string {
  return `${FIRST[Math.floor(rnd() * FIRST.length)]} ${String.fromCharCode(65 + Math.floor(rnd() * 26))}.`;
}

/** Scale a gym's week to `target` points, keeping its day shape and its points per athlete. */
function scaleTo(g: LeagueGym, target: number): LeagueGym {
  const k = g.points_week > 0 ? target / g.points_week : 1;
  const days = g.days.map((v) => Math.round(v * k));
  const points_week = days.reduce((s, v) => s + v, 0);
  const today = g.points_week > 0 ? Math.round(g.points_today * k) : 0;
  return {
    ...g,
    days,
    points_week,
    points_today: today,
    points_last_same: Math.round((g.points_last_same ?? 0) * k),
    sessions_week: Math.max(1, Math.round(g.sessions_week * k)),
    athletes_week: Math.max(3, Math.round(g.athletes_week * k)),
    in_now: Math.round(g.in_now * k),
  };
}

/** The opening board. `nowMs` is the (possibly shifted) clock the screen shows. */
export function filmLeague(data: FilmData, nowMs: number, opts: FilmOptions = {}): FilmState {
  const tz = opts.tz ?? 'Europe/London';
  const rnd = seededRandom(opts.seed ?? 1);
  const athletes = Math.max(1_000, Math.min(200_000, Math.round(opts.athletes ?? FILM_DEFAULT_ATHLETES)));
  const { weekStart, dayStart, dayIdx, hour } = weekClock(nowMs, tz);
  const todayShare = dayShareBy(hour);
  const weekDone = (DAY_W.slice(0, dayIdx).reduce((s, v) => s + v, 0) + DAY_W[dayIdx] * todayShare) / DAY_SUM;

  // The host is built separately (below), so its row in the data file is skipped here.
  const rows = data.gyms.filter((g) => g[2] !== FILM_HOST.name);
  const hostRow = data.gyms.find((g) => g[2] === FILM_HOST.name);
  const hostLogo = { logo_url: hostRow?.[4] ?? FILM_HOST.logo_url, logo_bg: hostRow?.[5] ?? FILM_HOST.logo_bg };
  const sizes = rows.map(([, , name]) => Math.exp(gauss(rnd) * 0.6) * (BIG.test(name) ? 1.6 : SMALL.test(name) ? 0.55 : 0.9));
  const hostSize = 2.4;
  const sizeSum = sizes.reduce((s, v) => s + v, 0) + hostSize;

  // Points per athlete: log-normal, so a handful of keen gyms pull clear on the effort table.
  const build = (key: string, name: string, address: string, lat: number, lng: number, size: number, keen = gauss(rnd)): LeagueGym => {
    const members = (athletes * size) / sizeSum;
    const activeWeek = members * (0.55 + 0.25 * rnd());
    const athletesNow = Math.max(3, Math.round(activeWeek * Math.min(1, 0.3 + weekDone)));
    const perAthleteWeek = 70 * Math.exp(0.35 * keen);
    const full = activeWeek * perAthleteWeek;
    const days = DAY_W.map((w, d) => (d < dayIdx ? Math.round(((full * w) / DAY_SUM) * (0.85 + 0.3 * rnd())) : d === dayIdx ? Math.round(((full * w) / DAY_SUM) * todayShare) : 0));
    const points_week = days.reduce((s, v) => s + v, 0);
    return {
      key, name, address, lat, lng,
      points_week,
      points_today: days[dayIdx],
      points_last_same: Math.round(points_week * (0.78 + 0.5 * rnd())),
      sessions_week: Math.max(1, Math.round(points_week / (17 + 3 * rnd()))),
      athletes_week: athletesNow,
      days,
      in_now: Math.round((members * 0.16 * HOUR_W[Math.floor(hour)] / HOUR_MAX) * (0.7 + 0.6 * rnd())),
    };
  };

  let gyms: LeagueGym[] = rows.map(([lat, lng, name, area, logo_url, logo_bg], i) => ({
    ...build(`film-${i}`, name, area, lat, lng, sizes[i]),
    logo_url,
    logo_bg,
  }));
  // The host's members are keen: near the top of the effort table as well as in the race.
  let host = build(FILM_HOST.key, FILM_HOST.name, FILM_HOST.address, FILM_HOST.lat, FILM_HOST.lng, hostSize, 2.5);

  // Local lens: the widest 0.1 km radius holding at most FILM_LOCAL_GYMS − 1
  // neighbours, so every local lane fits on screen (central London packs a
  // dozen gyms into 1.5 km).
  const byDist = gyms.map((g) => ({ g, d: haversineKm(FILM_HOST, g) })).sort((a, b) => a.d - b.d);
  let radius = 0.5;
  for (let r = 0.5; r <= 15; r = Math.round((r + 0.1) * 10) / 10) {
    if (byDist.filter((x) => x.d <= r).length > FILM_LOCAL_GYMS - 1) break;
    radius = r;
  }
  const localKeys = new Set(byDist.filter((x) => x.d <= radius).map((x) => x.g.key));

  // A race worth filming: the city's top 14 sit within a few percent of each
  // other, the host's neighbourhood fights in that band, and the host starts
  // one good session behind the gym above it — so it overtakes on camera.
  const top = [...gyms].filter((g) => !localKeys.has(g.key)).sort((a, b) => b.points_week - a.points_week);
  const lead = top[0]?.points_week ?? 1000;
  // ~1% apart ≈ three sessions: close enough that a burst of landings swaps two lanes.
  // A board that reads like a real league: the front of each race is packed
  // (rungs in POINTS, about a session apart, so overtakes happen on camera),
  // and below that lanes step down a few percent each so the bars show spread.
  const rung = (i: number, base: number, tight: number) => (i < tight
    ? base - FILM_RUNG_PTS * i - FILM_RUNG_PTS * 0.5 * rnd()
    : base - FILM_RUNG_PTS * tight - lead * FILM_STEP_DOWN * (i - tight + 1) - lead * 0.01 * rnd());
  const band = new Map(top.slice(0, 14).map((g, i) => [g.key, Math.round(rung(i, lead, 6))]));
  const local = byDist.filter((x) => localKeys.has(x.g.key)).map((x) => x.g).sort((a, b) => b.points_week - a.points_week);
  // The whole neighbourhood trains: no cliff from 5th to 6th.
  // Slot 2 of the local ladder is left for the host.
  local.forEach((g, i) => {
    const slot = i < 2 ? i : i + 1;
    // The neighbourhood pack sits a little below the city's front runners (~8th–12th in London).
    band.set(g.key, Math.round(Math.max(lead * 0.5, rung(slot, lead * 0.9, 7))));
  });
  gyms = gyms.map((g) => (band.has(g.key) ? scaleTo(g, band.get(g.key)!) : g));
  const secondLocal = band.get(local[1]?.key ?? '') ?? lead * 0.9;
  // One rung behind its rival (slot 2 of the ladder was kept free for it).
  host = { ...scaleTo(host, Math.round(secondLocal - FILM_RUNG_PTS - 3 * rnd())), ...hostLogo };
  gyms = [host, ...gyms];

  // Who scores next. Off screen: by size. On screen: rubber-banded — the
  // further a lane is behind the one above it, the likelier it scores next, so
  // the pack keeps leapfrogging instead of spreading out. The host gets a
  // little extra and starts ~40 pts behind, so it overtakes early on camera.
  const onScreen = new Set([...band.keys(), ...localKeys, FILM_HOST.key]);
  const on: number[] = [];
  const off: number[] = [];
  gyms.forEach((g, i) => (onScreen.has(g.key) ? on : off).push(i));
  const cum: number[] = [];
  off.reduce((s, i) => { cum.push(s + gyms[i].athletes_week); return s + gyms[i].athletes_week; }, 0);

  const weekSessions = gyms.reduce((s, g) => s + g.sessions_week, 0) / Math.max(0.02, weekDone);
  const sessionsHour = Math.round((weekSessions * DAY_W[dayIdx]) / DAY_SUM * (HOUR_W[Math.floor(hour)] / HOUR_SUM));

  const state: FilmState = {
    payload: {
      gym: { name: FILM_HOST.name, address: FILM_HOST.address, ...hostLogo },
      slug: 'film', host_key: FILM_HOST.key, radius_km: radius, tz,
      week_start_at: new Date(weekStart).toISOString(),
      week_end_at: new Date(weekStart + 7 * 86_400_000).toISOString(),
      day_start_at: new Date(dayStart).toISOString(),
      gyms, feed: [], generated_at: new Date(nowMs).toISOString(),
      scope_label: 'London',
      sessions_hour: sessionsHour,
    },
    cum, off, on, local: new Set([...localKeys, FILM_HOST.key]), focus: [], rnd, n: 0,
  };
  // Backfill the feed over the last half hour without touching the totals
  // (they already include these sessions).
  const feed: LeagueFeedItem[] = [];
  // The host and its three nearest rivals each get a share of the opening
  // feed, so every side of the head-to-head opens with four rows.
  const rivals = gyms
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => localKeys.has(g.key))
    .sort((a, b) => b.g.points_week - a.g.points_week)
    .slice(0, 3)
    .map(({ i }) => i);
  for (let i = 0; i < 40; i++) {
    const slot = i % 5;
    const force = slot === 1 ? 0 : slot >= 3 && rivals.length ? rivals[(Math.floor(i / 5) * 2 + slot - 3) % rivals.length] : undefined;
    feed.push(nextSession(state, nowMs - (i + 1) * 45_000 - Math.floor(rnd() * 30_000), force).item);
  }
  state.payload = { ...state.payload, feed };
  return state;
}

function pickOffScreen(state: FilmState): number {
  const { cum, off } = state;
  const r = state.rnd() * cum[cum.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
  return off[lo];
}

/** Tell the simulator which gyms the screen is showing; they get the next landings. Unknown keys are ignored. */
export function filmFocus(state: FilmState, keys: string[]): void {
  const want = new Set(keys);
  state.focus = state.payload.gyms.flatMap((g, i) => (want.has(g.key) ? [i] : []));
}

function pickOnScreen(state: FilmState): number {
  return pickLadder(state, state.on, (key) => (key === FILM_HOST.key ? 4 : state.local.has(key) ? 3 : 1));
}

/** Rubber band: the further a gym is behind the one above it, the likelier it scores next. */
function pickLadder(state: FilmState, pool: number[], boost: (key: string) => number): number {
  const gyms = state.payload.gyms;
  const ladder = [...pool].sort((a, b) => gyms[b].points_week - gyms[a].points_week);
  const w = ladder.map((gi, k) => {
    const gap = k === 0 ? 0 : gyms[ladder[k - 1]].points_week - gyms[gi].points_week;
    const chase = k === 0 ? 0.7 : 1 + Math.min(5, gap / FILM_CHASE_PTS);
    return chase * boost(gyms[gi].key);
  });
  let r = state.rnd() * w.reduce((s, v) => s + v, 0);
  for (let k = 0; k < ladder.length; k++) { r -= w[k]; if (r <= 0) return ladder[k]; }
  return ladder[ladder.length - 1];
}

function nextSession(state: FilmState, atMs: number, force?: number): { gi: number; item: LeagueFeedItem } {
  const { rnd } = state;
  const focused = state.focus.length > 0 && rnd() < FILM_FOCUS_SHARE;
  const gi = force ?? (focused ? pickLadder(state, state.focus, (key) => (key === FILM_HOST.key ? 1.5 : 1)) : rnd() < FILM_ON_SCREEN_SHARE || state.off.length === 0 ? pickOnScreen(state) : pickOffScreen(state));
  const tw = rnd() * TYPES.reduce((s, t) => s + t[1], 0);
  let acc = 0;
  const [type, , min, spread] = TYPES.find((t) => (acc += t[1]) >= tw) ?? TYPES[0];
  const minutes = min + Math.floor(rnd() * spread);
  const points = 8 + Math.round(minutes / 3.5) + Math.floor(rnd() * 6);
  const item: LeagueFeedItem = {
    key: `film-s${state.n++}`, gym_key: state.payload.gyms[gi].key, display_name: athleteName(rnd), username: null,
    type, started_at: new Date(atMs - minutes * 60_000).toISOString(), minutes, points,
  };
  return { gi, item };
}

/** One session lands at `nowMs`: the gym's week, today and sessions move, the feed gains it. */
export function filmStep(state: FilmState, nowMs: number): FilmState {
  const { gi, item } = nextSession(state, nowMs);
  const p = state.payload;
  const dayIdx = weekClock(nowMs, p.tz).dayIdx;
  const gyms = p.gyms.slice();
  const g = gyms[gi];
  gyms[gi] = {
    ...g,
    points_week: g.points_week + item.points,
    points_today: g.points_today + item.points,
    sessions_week: g.sessions_week + 1,
    athletes_week: g.athletes_week + (state.rnd() < 0.1 ? 1 : 0),
    days: g.days.map((v, d) => (d === dayIdx ? v + item.points : v)),
  };
  state.payload = {
    ...p,
    gyms,
    feed: [item, ...p.feed].slice(0, FILM_FEED_MAX),
    sessions_hour: (p.sessions_hour ?? 0) + 1,
    generated_at: new Date(nowMs).toISOString(),
  };
  return state;
}

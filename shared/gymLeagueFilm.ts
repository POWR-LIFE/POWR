/**
 * Gym League — FILM MODE: a whole city on POWR, for promo footage.
 *
 * powr.life/league/film?preview=film renders the real Gym League page on a
 * simulated London: every gym OpenStreetMap knows inside the M25-ish ring
 * (landing-page/src/data/londonFilmGyms.json), ~25,000 athletes spread across
 * them, and a steady stream of sessions landing so lanes race, ranks swap and
 * the map ripples. Nothing is read from or written to the database.
 *
 * Pure and seeded: the same seed and clock give the same opening board and
 * the same sequence of landings, so every take of the film matches.
 *
 * Gym names are invented ("<brand> <area>") unless realNames is set — a real
 * operator's name on a POWR board in an ad reads as a partnership. The host is
 * ONE LDN, a real POWR partner, in both modes.
 */

import { haversineKm, type LeagueFeedItem, type LeagueGym, type LeaguePayload } from './gymLeague';

export type FilmData = { areas: string[]; gyms: Array<[number, number, number, string]> };

export type FilmOptions = {
  /** Athletes on POWR across the city (active + lapsed members). */
  athletes?: number;
  seed?: number;
  realNames?: boolean;
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
  rnd: () => number;
  n: number;
};

export const FILM_HOST = { key: 'film-host', name: 'ONE LDN', address: 'Imperial Wharf, Fulham', lat: 51.47371, lng: -0.18256 };
export const FILM_DEFAULT_ATHLETES = 25_000;
export const FILM_LOCAL_GYMS = 12;
/** Share of landings that go to gyms on screen. */
export const FILM_ON_SCREEN_SHARE = 0.7;
/** Points behind the gym above that doubles a lane's chance of the next landing. */
export const FILM_CHASE_PTS = 20;

// Invented operators. The first eight behave like chains (many sites, bigger
// floors); the rest are one- or two-site boutiques.
const CHAINS = ['Kestrel Fitness', 'Northline Gym', 'Halden Athletic', 'Tidewater', 'Ostrum Strength', 'Brightwell Health Club', 'Veyra', 'Marlow & Stone'];
const BOUTIQUES = [
  'Kiln Barbell', 'Halcyon Boxing', 'Ember Cycle', 'Loft Pilates Co.', 'Ironleaf', 'Saltmarsh Yoga', 'Tallow Strength', 'Juniper Athletic',
  'Copperline Fitness', 'Slate & Oak', 'Kinloch Performance', 'Redbrick Barbell', 'Quarry Fitness', 'Wharfside Athletic', 'Longbow Boxing Club',
  'Ferrum Gym', 'Ninefold Fitness', 'Cinder Track Club', 'Lumen Studio', 'Arcadia Strength', 'Hollow Oak Yoga', 'Sable Fight Club',
  'Riverside Kinetic', 'Wrenfield Fitness', 'Tempo Row Club', 'Northfold', 'Bramble Pilates', 'Oxbow Strength', 'Hearth Fitness', 'Millrace Gym',
];

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

/** Invented "<brand> <area>" names, unique across the city; chains own most sites. */
export function inventGymNames(areas: string[], rnd: () => number): string[] {
  const used = new Set<string>();
  return areas.map((area) => {
    const order = [...CHAINS.map((b) => [b, 3 + rnd()] as const), ...BOUTIQUES.map((b) => [b, rnd() * 2.2] as const)]
      .sort((x, y) => y[1] - x[1])
      .map(([b]) => b);
    for (const b of order) {
      const name = `${b} ${area}`;
      if (!used.has(name)) { used.add(name); return name; }
    }
    const name = `${order[0]} ${area} ${used.size}`;
    used.add(name);
    return name;
  });
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

  const names = opts.realNames ? data.gyms.map((g) => g[3]) : inventGymNames(data.gyms.map((g) => data.areas[g[2]]), rnd);
  const chainSet = new Set(CHAINS);
  const sizes = data.gyms.map((_, i) => {
    const chain = !opts.realNames && chainSet.has(CHAINS.find((c) => names[i].startsWith(c)) ?? '');
    return Math.exp(gauss(rnd) * 0.7) * (chain ? 1.5 : 0.75);
  });
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

  let gyms: LeagueGym[] = data.gyms.map(([lat, lng, area], i) => build(`film-${i}`, names[i], data.areas[area], lat, lng, sizes[i]));
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
  const band = new Map(top.slice(0, 14).map((g, i) => [g.key, Math.round(lead * (1 - 0.007 * i - 0.003 * rnd()))]));
  const local = byDist.filter((x) => localKeys.has(x.g.key)).map((x) => x.g).sort((a, b) => b.points_week - a.points_week);
  // The whole neighbourhood trains: no cliff from 5th to 6th.
  // Slot 2 of the local ladder is left for the host.
  local.forEach((g, i) => {
    const slot = i < 2 ? i : i + 1;
    band.set(g.key, Math.round(lead * (slot < 7 ? 0.975 - 0.0035 * slot - 0.0015 * rnd() : Math.max(0.6, 0.95 - 0.006 * (slot - 7) - 0.006 * rnd()))));
  });
  gyms = gyms.map((g) => (band.has(g.key) ? scaleTo(g, band.get(g.key)!) : g));
  const secondLocal = band.get(local[1]?.key ?? '') ?? lead * 0.9;
  host = scaleTo(host, Math.round(secondLocal - 18 - 8 * rnd()));
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
      gym: { name: FILM_HOST.name, address: FILM_HOST.address },
      slug: 'film', host_key: FILM_HOST.key, radius_km: radius, tz,
      week_start_at: new Date(weekStart).toISOString(),
      week_end_at: new Date(weekStart + 7 * 86_400_000).toISOString(),
      day_start_at: new Date(dayStart).toISOString(),
      gyms, feed: [], generated_at: new Date(nowMs).toISOString(),
      scope_label: 'London',
      sessions_hour: sessionsHour,
    },
    cum, off, on, local: new Set([...localKeys, FILM_HOST.key]), rnd, n: 0,
  };
  // Backfill the feed over the last half hour without touching the totals
  // (they already include these sessions).
  const feed: LeagueFeedItem[] = [];
  // Every fifth is the host's, so its head-to-head side never opens idle.
  for (let i = 0; i < 40; i++) feed.push(nextSession(state, nowMs - (i + 1) * 45_000 - Math.floor(rnd() * 30_000), i % 5 === 1 ? 0 : undefined).item);
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

function pickOnScreen(state: FilmState): number {
  const gyms = state.payload.gyms;
  const ladder = [...state.on].sort((a, b) => gyms[b].points_week - gyms[a].points_week);
  const w = ladder.map((gi, k) => {
    const gap = k === 0 ? 0 : gyms[ladder[k - 1]].points_week - gyms[gi].points_week;
    const chase = k === 0 ? 0.7 : 1 + Math.min(5, gap / FILM_CHASE_PTS);
    return chase * (gyms[gi].key === FILM_HOST.key ? 4 : state.local.has(gyms[gi].key) ? 3 : 1);
  });
  let r = state.rnd() * w.reduce((s, v) => s + v, 0);
  for (let k = 0; k < ladder.length; k++) { r -= w[k]; if (r <= 0) return ladder[k]; }
  return ladder[ladder.length - 1];
}

function nextSession(state: FilmState, atMs: number, force?: number): { gi: number; item: LeagueFeedItem } {
  const { rnd } = state;
  const gi = force ?? (rnd() < FILM_ON_SCREEN_SHARE || state.off.length === 0 ? pickOnScreen(state) : pickOffScreen(state));
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
    feed: [item, ...p.feed].slice(0, 40),
    sessions_hour: (p.sessions_hour ?? 0) + 1,
    generated_at: new Date(nowMs).toISOString(),
  };
  return state;
}

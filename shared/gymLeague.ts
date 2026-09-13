/**
 * Gym League — pure helpers shared by the big-screen page
 * (landing-page/src/pages/GymLeague.jsx) and the admin panel.
 * No React, no network, no canvas: everything here is unit-testable.
 *
 * The screen takes one gym's point of view (the host) and shows two lenses:
 * LOCAL (gyms within the board's radius of the host) and GLOBAL (every gym
 * on POWR), then a head-to-head against the gym directly above the host.
 */

export type LeagueGym = {
  key: string;
  name: string;
  address?: string | null;
  lat: number;
  lng: number;
  points_week: number;
  points_today: number;
  /** Points over the same stretch of last week (Monday → now − 7 days). */
  points_last_same?: number;
  sessions_week: number;
  athletes_week: number;
  days: number[];
  in_now: number;
};

export type LeagueFeedItem = {
  key: string;
  gym_key: string;
  display_name?: string | null;
  username?: string | null;
  type: string;
  started_at: string;
  minutes: number;
  points: number;
};

export type LeaguePayload = {
  gym: { name: string; logo_url?: string | null; logo_bg?: string | null; address?: string | null };
  slug: string;
  host_key: string | null;
  radius_km: number;
  tz: string;
  week_start_at: string;
  week_end_at: string;
  day_start_at: string;
  gyms: LeagueGym[];
  feed: LeagueFeedItem[];
  generated_at: string;
};

export const LEAGUE_RADII = [5, 10, 15, 25, 50, 100];

/** The league's URL — same slug and token as the wall, a different screen. */
export function leagueUrl(slug: string, token: string, preview?: string | null, origin = 'https://powr.life'): string {
  const base = `${origin.replace(/\/+$/, '')}/league/${slug}?k=${token}`;
  return preview ? `${base}&preview=${preview}` : base;
}

/** Two-letter mark for a gym without a logo: "Third Space Mayfair" → "TS", "POWR" → "PW". */
export function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) {
    const w = words[0];
    return (w.length >= 2 ? w[0] + w[w.length - 1] : w + w).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

const COUNTRY_WORDS: Array<[RegExp, string]> = [
  [/\b(uk|united kingdom|england|scotland|wales|northern ireland)\b/i, 'UK'],
  [/\b(spain|españa)\b/i, 'ES'],
  [/\b(greece|ελλάδα)\b/i, 'GR'],
  [/\b(france)\b/i, 'FR'],
  [/\b(ireland)\b/i, 'IE'],
  [/\b(portugal)\b/i, 'PT'],
  [/\b(italy|italia)\b/i, 'IT'],
  [/\b(germany|deutschland)\b/i, 'DE'],
  [/\b(netherlands|nederland)\b/i, 'NL'],
  [/\b(usa|united states)\b/i, 'US'],
  [/\b(australia)\b/i, 'AU'],
  [/\b(uae|united arab emirates|dubai)\b/i, 'AE'],
];

// Loose boxes for the fallback when the address carries no country.
const COUNTRY_BOXES: Array<[string, number, number, number, number]> = [
  ['UK', 49.8, 61, -8.7, 2],
  ['IE', 51.3, 55.5, -10.7, -5.4],
  ['ES', 36, 43.9, -9.4, 4.4],
  ['PT', 36.9, 42.2, -9.6, -6.1],
  ['FR', 42.3, 51.2, -5.2, 8.3],
  ['GR', 34.8, 41.8, 19.3, 28.3],
  ['IT', 36.6, 47.1, 6.6, 18.6],
  ['DE', 47.2, 55.1, 5.8, 15.1],
  ['NL', 50.7, 53.6, 3.3, 7.3],
  ['AE', 22.6, 26.1, 51.5, 56.4],
];

/** Country code from the address text, else from the coordinates, else null. */
export function countryCode(address: string | null | undefined, lat?: number, lng?: number): string | null {
  const a = (address ?? '').trim();
  if (a) {
    // The country is the last thing people write; check the tail first so
    // "London Rd" never reads as a country.
    const tail = a.split(',').slice(-2).join(',');
    for (const [re, cc] of COUNTRY_WORDS) if (re.test(tail)) return cc;
    if (/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(a)) return 'UK'; // a UK postcode
  }
  if (lat != null && lng != null) {
    for (const [cc, s, n, w, e] of COUNTRY_BOXES) if (lat >= s && lat <= n && lng >= w && lng <= e) return cc;
  }
  return null;
}

const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;
const PLUS_CODE = /\b[23456789CFGHJMPQRVWX]{4,}\+[23456789CFGHJMPQRVWX]{2,}\b/g;

/** Where a gym is, in a word or two: the town from its address.
 *  "97-104 London Rd, Brighton and Hove, Brighton BN1 4JF, UK" → "Brighton"
 *  "61 MEON VALE, STRATFORD-UPON-AVON" → "Stratford-upon-Avon" */
export function placeLabel(address: string | null | undefined, fallback = ''): string {
  const a = (address ?? '').trim();
  if (!a) return fallback;
  const isCountry = (p: string) => COUNTRY_WORDS.some(([re]) => new RegExp(`^${re.source}$`, 'i').test(p));
  const parts = a
    .split(',')
    // strip postcodes of every shape: UK, plus codes, and bare numeric blocks ("166 73", "03730")
    .map((p) => p.replace(UK_POSTCODE, '').replace(PLUS_CODE, '').replace(/\b\d{3,}(?:\s\d{2,})?\b/g, '').replace(/\s+/g, ' ').trim())
    .filter((p) => p && !isCountry(p));
  if (parts.length === 0) return fallback;
  // The town is the last part without digits (streets and units carry numbers).
  const candidates = parts.filter((p) => !/\d/.test(p));
  const town = candidates.length ? candidates[candidates.length - 1] : parts[parts.length - 1];
  return titleCase(town);
}

function titleCase(s: string): string {
  const lower = s.toLowerCase();
  const isShouting = s === s.toUpperCase() && /[A-Z]/.test(s);
  const src = isShouting ? lower : s;
  return src
    .split(/(\s+|-)/)
    .map((w) => (/^(upon|on|and|the|of|de|la|le|by|in)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('')
    .replace(/^(upon|on|and|the|of|de|la|le|by|in)/, (m) => m.charAt(0).toUpperCase() + m.slice(1));
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Gyms within the local lens, host included, nearest last-resort order. */
export function localGyms(gyms: LeagueGym[], host: LeagueGym | null | undefined, radiusKm: number): LeagueGym[] {
  if (!host) return gyms;
  return gyms.filter((g) => g.key === host.key || haversineKm(host, g) <= radiusKm);
}

/** Standings order: points this week, then name. */
export function rankGyms(gyms: LeagueGym[]): LeagueGym[] {
  return [...gyms].sort((a, b) => b.points_week - a.points_week || a.name.localeCompare(b.name));
}

/** Rank of every gym at the start of today (this week's points minus today's). */
export function ranksAtDayStart(gyms: LeagueGym[]): Record<string, number> {
  const then = [...gyms].sort((a, b) => (b.points_week - b.points_today) - (a.points_week - a.points_today) || a.name.localeCompare(b.name));
  return Object.fromEntries(then.map((g, i) => [g.key, i + 1]));
}

/** Who the host is racing: the gym directly above it, or the runner-up when it leads. */
export function rivalOf(ranked: LeagueGym[], hostKey: string | null): { rival: LeagueGym | null; ahead: boolean } {
  const i = ranked.findIndex((g) => g.key === hostKey);
  if (i < 0 || ranked.length < 2) return { rival: null, ahead: false };
  return i > 0 ? { rival: ranked[i - 1], ahead: false } : { rival: ranked[1], ahead: true };
}

export const AVG_SESSION_POINTS = 18;

/** "about 3 sessions" — how far a gap is in ordinary sessions. */
export function sessionsToClose(gap: number, avg = AVG_SESSION_POINTS): number {
  return Math.max(1, Math.ceil(Math.max(0, gap) / avg));
}

export function shareOf(a: number, b: number): number {
  const t = a + b;
  return t <= 0 ? 0.5 : a / t;
}

// ── Effort: the fair table ───────────────────────────────────────────────
//
// Totals reward size. POWR's own argument is effort over size, so the second
// table ranks points per active athlete — the only denominator POWR can
// honestly use (it never knows a gym's membership, only who trained on
// POWR). One guard keeps a lone hero from topping it: a gym ranks on effort
// only with EFFORT_MIN_ATHLETES athletes this week. The table ranks on the
// exact figure it shows — a shrunk score was tried and put 151 above 155 on
// the wall, which a room reads as a bug, not statistics.

export const EFFORT_MIN_ATHLETES = 3;

/** Network average points per active athlete across the league. */
export function networkAvgPerAthlete(gyms: LeagueGym[]): number {
  const points = gyms.reduce((s, g) => s + g.points_week, 0);
  const athletes = gyms.reduce((s, g) => s + g.athletes_week, 0);
  return athletes > 0 ? points / athletes : 0;
}

/** The figure a lane shows: points per athlete this week, or null with no athletes. */
export function rawPerAthlete(g: LeagueGym): number | null {
  return g.athletes_week > 0 ? g.points_week / g.athletes_week : null;
}

export type EffortRow = { gym: LeagueGym; perAthlete: number };

/** Effort table: gyms with enough athletes ranked by points per athlete (ties to the bigger squad); the rest listed unranked. */
export function rankByEffort(gyms: LeagueGym[], minAthletes = EFFORT_MIN_ATHLETES): { ranked: EffortRow[]; unranked: LeagueGym[] } {
  const ranked = gyms
    .filter((g) => g.athletes_week >= minAthletes)
    .map((g) => ({ gym: g, perAthlete: rawPerAthlete(g) ?? 0 }))
    .sort((a, b) => b.perAthlete - a.perAthlete || b.gym.athletes_week - a.gym.athletes_week || a.gym.name.localeCompare(b.gym.name));
  const unranked = rankGyms(gyms.filter((g) => g.athletes_week < minAthletes));
  return { ranked, unranked };
}

/** Change against the same stretch of last week, as a badge — null when last week is too small to compare. */
export function momentum(g: LeagueGym, floor = 20): { pct: number; up: boolean } | null {
  const last = g.points_last_same ?? 0;
  if (last < floor) return null;
  const pct = Math.round(((g.points_week - last) / last) * 100);
  return { pct: Math.abs(pct), up: pct >= 0 };
}

export type LeagueScene = 'local' | 'global' | 'effort' | 'duel';

/** Local → Global → Head-to-head; the duel only when there is someone to race. */
export function leagueScenePlan(opts: { localCount: number; globalCount: number; hasRival: boolean; effortCount?: number }): Array<{ scene: LeagueScene; ms: number }> {
  const plan: Array<{ scene: LeagueScene; ms: number }> = [];
  if (opts.localCount >= 2) plan.push({ scene: 'local', ms: 28_000 });
  plan.push({ scene: 'global', ms: opts.localCount >= 2 ? 28_000 : 40_000 });
  if ((opts.effortCount ?? 0) >= 2) plan.push({ scene: 'effort', ms: 18_000 });
  if (opts.hasRival) plan.push({ scene: 'duel', ms: 12_000 });
  return plan;
}

/** Sessions across the network in the last hour. */
export function sessionsLastHour(feed: LeagueFeedItem[], nowMs: number): number {
  return feed.filter((f) => nowMs - new Date(f.started_at).getTime() < 3_600_000).length;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Map geometry ────────────────────────────────────────────────────────

export type Bounds = { n: number; s: number; e: number; w: number };

/** Bounds that hold every gym with breathing room on each side. */
export function boundsOf(list: Array<{ lat: number; lng: number }>): Bounds {
  if (list.length === 0) return { n: 60, s: 35, e: 28, w: -12 };
  let n = -90, s = 90, e = -180, w = 180;
  for (const g of list) { n = Math.max(n, g.lat); s = Math.min(s, g.lat); e = Math.max(e, g.lng); w = Math.min(w, g.lng); }
  const padLat = (n - s) * 0.16 + 0.01;
  const padLng = (e - w) * 0.1 + 0.01;
  return { n: n + padLat, s: s - padLat, e: e + padLng, w: w - padLng };
}

export type Projector = ((lat: number, lng: number) => [number, number]) & { sc: number; kx: number };

/** Equirectangular fit of `b` into W×H, geography roughly true at the centre latitude. */
export function projector(b: Bounds, W: number, H: number): Projector {
  const kx = Math.cos(((b.n + b.s) / 2) * Math.PI / 180);
  const spanX = Math.max(1e-6, (b.e - b.w) * kx);
  const spanY = Math.max(1e-6, b.n - b.s);
  const sc = Math.min(W / spanX, H / spanY);
  const ox = (W - spanX * sc) / 2;
  const oy = (H - spanY * sc) / 2;
  const p = ((lat: number, lng: number): [number, number] => [ox + (lng - b.w) * kx * sc, oy + (b.n - lat) * sc]) as Projector;
  p.sc = sc;
  p.kx = kx;
  return p;
}

export type MapNode = {
  x: number; y: number;      // where the disc is drawn (after separation)
  ox: number; oy: number;    // where the place really is
  r: number;
  gyms: LeagueGym[];
  points: number;
  host: boolean;
  lead: LeagueGym;
};

/** Merge gyms that would sit within `px` of each other into one node, then
 *  push discs apart so none overlap. Pure: takes the projector, returns positions. */
export function clusterNodes(gyms: LeagueGym[], p: Projector, px: number, rem: number, hostKey: string | null): MapNode[] {
  const nodes: MapNode[] = [];
  for (const g of rankGyms(gyms)) {
    const [x, y] = p(g.lat, g.lng);
    const hit = nodes.find((n) => Math.hypot(n.x - x, n.y - y) < px);
    if (hit) { hit.gyms.push(g); hit.points += g.points_week; hit.host = hit.host || g.key === hostKey; }
    else nodes.push({ x, y, ox: x, oy: y, r: 0, gyms: [g], points: g.points_week, host: g.key === hostKey, lead: g });
  }
  for (const n of nodes) {
    // a single disc carries its rank, so it needs room for a digit or two
    n.r = n.gyms.length > 1 ? 0.4 * rem + 0.06 * rem * Math.min(6, n.gyms.length - 1) : (n.host ? 0.44 : 0.36) * rem;
    if (n.gyms.length > 1) {
      n.x = n.gyms.reduce((s, g) => s + p(g.lat, g.lng)[0], 0) / n.gyms.length;
      n.y = n.gyms.reduce((s, g) => s + p(g.lat, g.lng)[1], 0) / n.gyms.length;
    }
    n.ox = n.x; n.oy = n.y;
  }
  for (let it = 0; it < 24; it++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], c = nodes[j];
        const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = a.r + c.r + 0.25 * rem;
        if (d < min) {
          const push = (min - d) / 2, ux = dx / d, uy = dy / d;
          a.x -= ux * push; a.y -= uy * push; c.x += ux * push; c.y += uy * push;
        }
      }
    }
  }
  return nodes;
}

/** "London", "London & Brighton", "London +2 areas" — honest about what a disc holds. */
export function nodeLabel(node: MapNode, hostKey: string | null): string {
  const places = [...new Set(node.gyms.map((g) => placeLabel(g.address, g.name)))];
  const hostGym = node.gyms.find((g) => g.key === hostKey);
  const first = hostGym ? placeLabel(hostGym.address, hostGym.name) : places[0];
  const rest = places.filter((c) => c !== first);
  if (rest.length === 0) return first;
  if (rest.length === 1) return `${first} & ${rest[0]}`;
  return `${first} +${rest.length} areas`;
}

// ── Sample data (admin preview) ─────────────────────────────────────────

const SAMPLE_GYMS: Array<[string, string, number, number, number]> = [
  ['ONE LDN', 'Imperial Wharf the Boulevard, 3 The Blvd, London SW6 2UB', 51.473706, -0.182558, 9],
  ['Stars Gym', 'Battersea, London SW11 4NP, UK', 51.48037, -0.168859, 3],
  ['Third Space Canary Wharf', '16-19 Canada Square, Canary Wharf, London E14 5ER, UK', 51.504786, -0.016741, 6],
  ['Third Space The Whiteley', 'The Whiteley, Queensway, London W2 4YN, UK', 51.514595, -0.188425, 5],
  ['Third Space Marylebone', 'Bulstrode Pl, London W1U 2HU, UK', 51.517991, -0.150586, 4],
  ['Third Space Tower Bridge', '2b More London Pl, London SE1 2AP, UK', 51.505369, -0.080248, 4],
  ['Third Space Mayfair', '22 Clarges St, London W1J 5FA, UK', 51.507581, -0.145922, 5],
  ['PureGym Finsbury Park', '189-219 Isledon Rd, Finsbury Park, London N7 7JR, UK', 51.5628, -0.1074, 2],
  ['POWR', '61 Meon Vale, Stratford-upon-Avon CV37 8YE, UK', 52.124508, -1.764087, 4],
  ['Valhalla Boxing & Fitness', '151 London Rd, Worcester WR5 2ED, UK', 52.184879, -2.205244, 3],
  ['Millpond Yoga', 'Methodist church, Droitwich Spa, Droitwich WR9 8AN, UK', 52.26191, -2.15277, 2],
  ['Xtreme Gym', 'Carrer Roma 3, 03730 Xàbia, Alicante, Spain', 38.784331, 0.173306, 3],
  ['SOMA', 'Arkadiou 55, Voula 166 73, Greece', 37.837703, 23.778101, 2],
  ['The Gym Group Brighton', '97-104 London Rd, Brighton BN1 4JF, UK', 50.832155, -0.136884, 3],
  ['Snap Fitness Hove', '84 Denmark Villas, Hove BN3 3TJ, UK', 50.834576, -0.169252, 2],
  ['The Gym Group Southampton', '176-178 High St, Southampton SO14 2BY, UK', 50.902139, -1.404482, 3],
  ['Anytime Fitness Cosham', '3-4 Portsmouth Rd, Cosham, Portsmouth PO6 2AE, UK', 50.841736, -1.068189, 2],
  ['Sports Park', 'Stocker Rd, Exeter EX4 4QL, UK', 50.738036, -3.537167, 2],
  ['The Gym Group Swansea', '36a Princess Way, Swansea SA1 5HE, UK', 51.621021, -3.943081, 2],
  ['PureGym Durham Arnison', 'Mercia Retail Park, Pity Me, Durham DH1 5GE, UK', 54.805914, -1.579183, 1],
];

/** A believable league for the admin preview: the host is the first gym, in the fight. */
export function sampleLeague(nowMs: number, tz = 'Europe/London'): LeaguePayload {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gyms: LeagueGym[] = SAMPLE_GYMS.map(([name, address, lat, lng, members], i) => {
    const pts = members * (60 + Math.floor(rnd() * 90)) + Math.floor(rnd() * 120) + (i === 0 ? 140 : 0);
    // Six days at 50–110% of an even split leaves today a real share of the week.
    const days = Array.from({ length: 7 }, (_, d) => (d < 6 ? Math.floor((pts / 7) * (0.5 + rnd() * 0.6)) : 0));
    days[6] = Math.max(0, pts - days.slice(0, 6).reduce((s, v) => s + v, 0));
    return {
      key: `sample-${i}`, name, address, lat, lng,
      points_week: pts, points_today: days[6], points_last_same: Math.round(pts * (0.6 + rnd() * 0.8)),
      sessions_week: Math.round(pts / 18), athletes_week: members, days,
      in_now: rnd() < 0.3 ? 1 + Math.floor(rnd() * 3) : 0,
    };
  });
  const types = ['gym', 'hiit', 'yoga', 'swimming', 'cycling', 'sports'];
  const names = ['Georgie', 'Suzi', 'Kris', 'Amir', 'Tash', 'Leo', 'Priya', 'Jonah'];
  const feed: LeagueFeedItem[] = Array.from({ length: 12 }, (_, i) => {
    const g = gyms[Math.floor(rnd() * gyms.length)];
    return {
      key: `sample-feed-${i}`, gym_key: g.key, display_name: names[i % names.length], username: null,
      type: types[i % types.length], started_at: new Date(nowMs - (i + 1) * 4 * 60_000 - 600_000).toISOString(),
      minutes: 30 + Math.floor(rnd() * 45), points: 10 + Math.floor(rnd() * 24),
    };
  });
  const monday = new Date(nowMs); monday.setUTCHours(0, 0, 0, 0); monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const next = new Date(monday.getTime() + 7 * 86_400_000);
  const day = new Date(nowMs); day.setUTCHours(0, 0, 0, 0);
  return {
    gym: { name: gyms[0].name, address: gyms[0].address },
    slug: 'sample', host_key: gyms[0].key, radius_km: 15, tz,
    week_start_at: monday.toISOString(), week_end_at: next.toISOString(), day_start_at: day.toISOString(),
    gyms, feed, generated_at: new Date(nowMs).toISOString(),
  };
}

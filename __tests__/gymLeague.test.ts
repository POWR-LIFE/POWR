import {
  boundsOf,
  clusterNodes,
  countryCode,
  haversineKm,
  leagueScenePlan,
  leagueUrl,
  localGyms,
  momentum,
  monogram,
  networkAvgPerAthlete,
  nodeLabel,
  ordinal,
  placeLabel,
  projector,
  rankByEffort,
  rankGyms,
  ranksAtDayStart,
  rawPerAthlete,
  rivalOf,
  sampleLeague,
  sessionsLastHour,
  sessionsToClose,
  shareOf,
  type LeagueGym,
} from '../shared/gymLeague';

const gym = (key: string, name: string, lat: number, lng: number, week: number, today = 0, address: string | null = null): LeagueGym => ({
  key, name, lat, lng, address,
  points_week: week, points_today: today, sessions_week: 0, athletes_week: 0, days: [0, 0, 0, 0, 0, 0, today], in_now: 0,
});

const ONE = gym('one', 'ONE LDN', 51.473706, -0.182558, 300, 40, 'Imperial Wharf the Boulevard, 3 The Blvd, London SW6 2UB');
const STARS = gym('stars', 'Stars Gym', 51.48037, -0.168859, 120, 0, 'Battersea, London SW11 4NP, UK');
const TS_CW = gym('cw', 'Third Space Canary Wharf', 51.504786, -0.016741, 340, 10, '16-19 Canada Square, London E14 5ER, UK');
const POWR = gym('powr', 'POWR', 52.124508, -1.764087, 105, 105, '61 MEON VALE, STRATFORD-UPON-AVON');
const XTREME = gym('xt', 'Xtreme Gym', 38.784331, 0.173306, 15, 0, 'Carrer Roma, 3, Nave 2, 03730 Badia de Xàbia, Alicante, Spain');

describe('leagueUrl', () => {
  it('shares the wall slug and token on a different path', () => {
    expect(leagueUrl('one-ldn', 'abc')).toBe('https://powr.life/league/one-ldn?k=abc');
    expect(leagueUrl('one-ldn', 'abc', 'sample', 'http://localhost:5199/')).toBe('http://localhost:5199/league/one-ldn?k=abc&preview=sample');
  });
});

describe('monogram', () => {
  it('takes two initials, or first and last letter of a single word', () => {
    expect(monogram('Third Space Mayfair')).toBe('TS');
    expect(monogram('POWR')).toBe('PR');
    expect(monogram('Valhalla Boxing & Fitness')).toBe('VB');
    expect(monogram('')).toBe('??');
  });
});

describe('placeLabel / countryCode', () => {
  it('finds the town in ordinary UK addresses', () => {
    expect(placeLabel('97-104 London Rd, Brighton and Hove, Brighton BN1 4JF, UK')).toBe('Brighton');
    expect(placeLabel('16-19 Canada Square, Canary Wharf Estate, London E14 5ER, UK')).toBe('London');
    expect(placeLabel('151 London Rd, Worcester WR5 2ED, UK')).toBe('Worcester');
  });
  it('copes with shouting, plus codes and missing countries', () => {
    expect(placeLabel('61 MEON VALE, STRATFORD-UPON-AVON')).toBe('Stratford-upon-Avon');
    expect(placeLabel('7P6M+77, Worcester WR9 9RB')).toBe('Worcester');
    expect(placeLabel(null, 'Somewhere')).toBe('Somewhere');
    expect(placeLabel('Carrer Roma, 3, Nave 2, 03730 Badia de Xàbia, Alicante, Spain')).toBe('Alicante');
    expect(placeLabel('Arkadiou 55, Voula 166 73, Greece')).toBe('Voula');
    expect(placeLabel('Imperial Wharf the Boulevard, 3 The Blvd, London SW6 2UB')).toBe('London');
  });
  it('reads the country from the address tail, else from the coordinates', () => {
    expect(countryCode('151 London Rd, Worcester WR5 2ED, UK')).toBe('UK');
    expect(countryCode('Arkadiou 55, Voula 166 73, Greece')).toBe('GR');
    expect(countryCode('61 MEON VALE, STRATFORD-UPON-AVON', 52.12, -1.76)).toBe('UK');
    expect(countryCode(null, 38.78, 0.17)).toBe('ES');
    expect(countryCode(null)).toBeNull();
  });
});

describe('distance and lenses', () => {
  it('measures km and keeps the host in its own local lens', () => {
    expect(haversineKm(ONE, STARS)).toBeGreaterThan(1);
    expect(haversineKm(ONE, STARS)).toBeLessThan(1.5);
    expect(haversineKm(ONE, POWR)).toBeGreaterThan(120);
    const local = localGyms([ONE, STARS, TS_CW, POWR, XTREME], ONE, 15);
    expect(local.map((g) => g.key)).toEqual(['one', 'stars', 'cw']);
    expect(localGyms([POWR], null, 15)).toEqual([POWR]);
  });
  it('ranks by points then name and knows where everyone started the day', () => {
    const ranked = rankGyms([ONE, STARS, TS_CW, POWR]);
    expect(ranked.map((g) => g.key)).toEqual(['cw', 'one', 'stars', 'powr']);
    // POWR earned all 105 today: it started the day on 0, behind everyone.
    const then = ranksAtDayStart([ONE, STARS, TS_CW, POWR]);
    expect(then.powr).toBe(4);
    expect(then.cw).toBe(1);
  });
  it('picks the gym directly above the host, or the runner-up when it leads', () => {
    const ranked = rankGyms([ONE, STARS, TS_CW]);
    expect(rivalOf(ranked, 'one')).toEqual({ rival: TS_CW, ahead: false });
    expect(rivalOf(ranked, 'cw')).toEqual({ rival: ONE, ahead: true });
    expect(rivalOf(ranked, 'nope')).toEqual({ rival: null, ahead: false });
    expect(rivalOf([ONE], 'one').rival).toBeNull();
  });
  it('turns a gap into sessions and a share', () => {
    expect(sessionsToClose(40)).toBe(3);
    expect(sessionsToClose(0)).toBe(1);
    expect(shareOf(300, 100)).toBeCloseTo(0.75);
    expect(shareOf(0, 0)).toBe(0.5);
  });
});

describe('effort', () => {
  const big = { ...gym('big', 'Third Space', 51.5, -0.1, 1200), athletes_week: 40 };        // 30 per athlete
  const small = { ...gym('small', 'Valhalla', 52.18, -2.2, 240), athletes_week: 4 };       // 60 per athlete
  const solo = { ...gym('solo', 'Iron Asylum', 52.27, -2.15, 180), athletes_week: 1 };     // 180 per athlete, unranked
  const quiet = gym('quiet', 'Stars Gym', 51.48, -0.17, 0);
  it('ranks points per athlete with a three-athlete floor', () => {
    expect(rawPerAthlete(big)).toBe(30);
    expect(rawPerAthlete(quiet)).toBeNull();
    expect(networkAvgPerAthlete([big, small, solo, quiet])).toBeCloseTo(1620 / 45);
    const { ranked, unranked } = rankByEffort([big, small, solo, quiet]);
    expect(ranked.map((r) => r.gym.key)).toEqual(['small', 'big']);
    expect(ranked[0].perAthlete).toBe(60);
    expect(unranked.map((g) => g.key)).toEqual(['solo', 'quiet']);
  });
  it('turns last week\'s same stretch into a badge, or nothing when last week was too small', () => {
    expect(momentum({ ...big, points_last_same: 1000 })).toEqual({ pct: 20, up: true });
    expect(momentum({ ...big, points_last_same: 1500 })).toEqual({ pct: 20, up: false });
    expect(momentum({ ...big, points_last_same: 10 })).toBeNull();
    expect(momentum(big)).toBeNull();
  });
});

describe('scene plan', () => {
  it('adds the effort table only when two gyms can rank on it', () => {
    expect(leagueScenePlan({ localCount: 9, globalCount: 40, hasRival: true, effortCount: 5 }).map((s) => s.scene)).toEqual(['local', 'global', 'effort', 'duel']);
    expect(leagueScenePlan({ localCount: 9, globalCount: 40, hasRival: true, effortCount: 1 }).map((s) => s.scene)).toEqual(['local', 'global', 'duel']);
  });
  it('drops the local lens with one gym and the duel with no rival', () => {
    expect(leagueScenePlan({ localCount: 9, globalCount: 40, hasRival: true }).map((s) => s.scene)).toEqual(['local', 'global', 'duel']);
    expect(leagueScenePlan({ localCount: 1, globalCount: 40, hasRival: true }).map((s) => s.scene)).toEqual(['global', 'duel']);
    expect(leagueScenePlan({ localCount: 1, globalCount: 1, hasRival: false }).map((s) => s.scene)).toEqual(['global']);
  });
});

describe('feed', () => {
  it('counts sessions in the last hour', () => {
    const now = Date.parse('2026-09-13T12:00:00Z');
    const f = (min: number) => ({ key: `k${min}`, gym_key: 'one', type: 'gym', started_at: new Date(now - min * 60_000).toISOString(), minutes: 30, points: 12 });
    expect(sessionsLastHour([f(5), f(59), f(61), f(600)], now)).toBe(2);
  });
  it('spells ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  });
});

describe('map geometry', () => {
  it('fits bounds with padding and projects north up', () => {
    const b = boundsOf([ONE, TS_CW]);
    expect(b.n).toBeGreaterThan(TS_CW.lat);
    expect(b.s).toBeLessThan(ONE.lat);
    const p = projector(b, 400, 300);
    const [, yNorth] = p(b.n, b.w);
    const [, ySouth] = p(b.s, b.w);
    expect(yNorth).toBeLessThan(ySouth);
    const [xw] = p(b.n, b.w);
    const [xe] = p(b.n, b.e);
    expect(xe).toBeGreaterThan(xw);
    expect(boundsOf([])).toEqual({ n: 60, s: 35, e: 28, w: -12 });
  });
  it('clusters gyms that would touch and keeps discs apart', () => {
    const all = [ONE, STARS, TS_CW, POWR, XTREME];
    const p = projector(boundsOf(all), 400, 300);
    const nodes = clusterNodes(all, p, 12, 16, 'one');
    // London collapses into one disc at this scale; Stratford, Xàbia stand alone.
    const london = nodes.find((n) => n.host)!;
    expect(london.gyms.map((g) => g.key).sort()).toEqual(['cw', 'one', 'stars']);
    expect(london.points).toBe(760);
    expect(nodes.length).toBe(3);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], c = nodes[j];
      expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThanOrEqual(a.r + c.r + 4 - 0.01);
    }
    expect(nodeLabel(london, 'one')).toBe('London');
  });
  it('labels merged places honestly', () => {
    const brighton = gym('b', 'The Gym Group Brighton', 50.83, -0.13, 50, 0, '97-104 London Rd, Brighton BN1 4JF, UK');
    const p = projector(boundsOf([ONE, brighton, POWR]), 60, 60);
    const nodes = clusterNodes([ONE, brighton, POWR], p, 40, 16, 'one');
    const n = nodes.find((x) => x.host)!;
    expect(n.gyms.length).toBeGreaterThanOrEqual(2);
    expect(nodeLabel(n, 'one')).toMatch(/^London (& |\+\d areas)/);
  });
});

describe('sampleLeague', () => {
  it('is deterministic, host first, with a feed that lands on known gyms', () => {
    const a = sampleLeague(1_800_000_000_000);
    const b = sampleLeague(1_800_000_000_000);
    expect(a.gyms.map((g) => g.points_week)).toEqual(b.gyms.map((g) => g.points_week));
    expect(a.host_key).toBe(a.gyms[0].key);
    const keys = new Set(a.gyms.map((g) => g.key));
    expect(a.feed.every((f) => keys.has(f.gym_key))).toBe(true);
    expect(a.gyms.every((g) => g.days.reduce((s, v) => s + v, 0) === g.points_week)).toBe(true);
  });
});

import { localGyms, rankGyms, rivalOf, todayIndex } from '../shared/gymLeague';
import {
  FILM_HOST,
  dayShareBy,
  filmFocus,
  filmClockOffset,
  filmLeague,
  filmStep,
  parseFilmClock,
  weekClock,
} from '../shared/gymLeagueFilm';
import data from '../landing-page/src/data/londonFilmGyms.json';

// Thursday 1 Oct 2026, 19:00 BST.
const THU_19 = Date.UTC(2026, 9, 1, 18, 0, 0);

describe('film clock', () => {
  it('finds the London week and day', () => {
    const c = weekClock(THU_19);
    expect(c.dayIdx).toBe(3);
    expect(c.hour).toBeCloseTo(19);
    expect(new Date(c.weekStart).toISOString()).toBe('2026-09-27T23:00:00.000Z'); // Mon 00:00 BST
    expect(c.dayStart - c.weekStart).toBe(3 * 86_400_000);
  });

  it('parses and applies ?at=', () => {
    expect(parseFilmClock('thu-19:00')).toEqual({ day: 3, hour: 19, minute: 0 });
    expect(parseFilmClock('Sat 7')).toEqual({ day: 5, hour: 7, minute: 0 });
    expect(parseFilmClock('noon')).toBeNull();
    expect(parseFilmClock('mon-25:00')).toBeNull();
    const tueMorning = Date.UTC(2026, 8, 29, 8, 0, 0);
    expect(tueMorning + filmClockOffset('thu-19:00', tueMorning)).toBe(THU_19);
    expect(filmClockOffset(null, tueMorning)).toBe(0);
  });

  it('day share rises through the day', () => {
    expect(dayShareBy(0)).toBe(0);
    expect(dayShareBy(24)).toBeCloseTo(1);
    expect(dayShareBy(12)).toBeGreaterThan(dayShareBy(8));
  });
});

describe('film league', () => {
  const state = filmLeague(data as never, THU_19, { seed: 1 });
  const p = state.payload;

  it('is POWR\'s own London gyms, with the host once', () => {
    const others = data.gyms.filter((g) => g[2] !== FILM_HOST.name);
    expect(p.gyms.length).toBe(others.length + 1);
    expect(p.gyms.length).toBeGreaterThan(150);
    expect(p.gyms.filter((g) => g.name === FILM_HOST.name)).toHaveLength(1);
    expect(p.host_key).toBe(FILM_HOST.key);
    expect(p.scope_label).toBe('London');
    expect(todayIndex(p)).toBe(3);
  });

  it('carries the real names and logos', () => {
    const byName = new Map(data.gyms.map((g) => [g[2], g]));
    for (const g of p.gyms) {
      const row = byName.get(g.name);
      expect(row).toBeDefined();
      if (g.key !== FILM_HOST.key) expect(g.logo_url ?? null).toBe(row![4]);
    }
    expect(p.gyms.filter((g) => g.logo_url).length).toBeGreaterThan(60);
    expect(p.gyms.find((g) => g.key === FILM_HOST.key)!.logo_url).toMatch(/^https:/);
    expect(p.gym.logo_url).toMatch(/^https:/);
  });

  it('adds up to roughly the athletes asked for', () => {
    const active = p.gyms.reduce((s, g) => s + g.athletes_week, 0);
    expect(active).toBeGreaterThan(10_000);
    expect(active).toBeLessThan(32_000);
  });

  it('keeps each gym consistent: days sum to the week, today is today, no future', () => {
    for (const g of p.gyms) {
      expect(g.days.reduce((s, v) => s + v, 0)).toBe(g.points_week);
      expect(g.points_today).toBe(g.days[3]);
      expect(g.days[4] + g.days[5] + g.days[6]).toBe(0);
    }
  });

  it('opens with the host about a session behind its local rival', () => {
    const host = p.gyms.find((g) => g.key === p.host_key)!;
    const local = rankGyms(localGyms(p.gyms, host, p.radius_km));
    expect(local.length).toBeGreaterThanOrEqual(8);
    expect(local.length).toBeLessThanOrEqual(12);
    const { rival, ahead } = rivalOf(local, host.key);
    expect(ahead).toBe(false);
    expect(rival!.points_week - host.points_week).toBeGreaterThan(10);
    expect(rival!.points_week - host.points_week).toBeLessThan(40);
  });

  it('opens with the host and its nearest rivals in the recent feed', () => {
    expect(p.feed.filter((f) => f.gym_key === FILM_HOST.key).length).toBeGreaterThanOrEqual(8);
    const host = p.gyms.find((g) => g.key === p.host_key)!;
    const local = rankGyms(localGyms(p.gyms, host, p.radius_km)).filter((g) => g.key !== host.key).slice(0, 3);
    for (const g of local) expect(p.feed.filter((f) => f.gym_key === g.key).length).toBeGreaterThanOrEqual(4);
  });

  it('has one lane per name', () => {
    const names = p.gyms.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('is repeatable for a seed', () => {
    const a = filmLeague(data as never, THU_19, { seed: 7 });
    const b = filmLeague(data as never, THU_19, { seed: 7 });
    filmStep(a, THU_19 + 1000); filmStep(b, THU_19 + 1000);
    expect(a.payload.feed[0]).toEqual(b.payload.feed[0]);
    expect(a.payload.gyms.map((g) => g.points_week)).toEqual(b.payload.gyms.map((g) => g.points_week));
  });

  it('sends most landings to the lanes on screen, the host included', () => {
    const s = filmLeague(data as never, THU_19, { seed: 4 });
    const on = new Set(s.on.map((i) => s.payload.gyms[i].key));
    let host = 0, onScreen = 0;
    for (let i = 0; i < 1000; i++) {
      filmStep(s, THU_19 + i * 1000);
      const k = s.payload.feed[0].gym_key;
      if (k === FILM_HOST.key) host++;
      if (on.has(k)) onScreen++;
    }
    expect(onScreen / 1000).toBeGreaterThan(0.63);
    expect(onScreen / 1000).toBeLessThan(0.77);
    expect(host / 1000).toBeGreaterThan(0.03);
  });

  it('keeps both races swapping places while they are on screen', () => {
    for (const scene of ['local', 'london']) {
      const s = filmLeague(data as never, THU_19, { seed: 5 });
      const host = s.payload.gyms.find((g) => g.key === s.payload.host_key)!;
      const lanes = () => (scene === 'local' ? rankGyms(localGyms(s.payload.gyms, host, s.payload.radius_km)) : rankGyms(s.payload.gyms).slice(0, 12));
      let swaps = 0, last = lanes().map((g) => g.key).join();
      for (let i = 0; i < 100; i++) { // ~70 s at the page's landing rate; the page focuses the scene's lanes
        filmFocus(s, lanes().map((g) => g.key));
        filmStep(s, THU_19 + i * 700);
        const now = lanes().map((g) => g.key).join();
        if (now !== last) swaps++;
        last = now;
      }
      expect(swaps).toBeGreaterThan(7);
    }
  });

  it('lands on the gyms the screen is showing', () => {
    const s = filmLeague(data as never, THU_19, { seed: 6 });
    const rival = s.payload.gyms[5].key;
    filmFocus(s, [FILM_HOST.key, rival, 'nope']);
    let hits = 0, host = 0, other = 0;
    for (let i = 0; i < 17; i++) { // one 12 s head-to-head at ~1.4 landings a second
      filmStep(s, THU_19 + i * 700);
      const k = s.payload.feed[0].gym_key;
      if (k === FILM_HOST.key) host++;
      if (k === rival) other++;
      if (k === FILM_HOST.key || k === rival) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(5);
    expect(host).toBeGreaterThan(0);
    expect(other).toBeGreaterThan(0);
    filmFocus(s, []);
    expect(s.focus).toEqual([]);
  });

  it('a landing moves exactly one gym by its points', () => {
    const s = filmLeague(data as never, THU_19, { seed: 2 });
    const before = new Map(s.payload.gyms.map((g) => [g.key, g.points_week]));
    const hour = s.payload.sessions_hour!;
    filmStep(s, THU_19 + 2000);
    const item = s.payload.feed[0];
    const moved = s.payload.gyms.filter((g) => g.points_week !== before.get(g.key));
    expect(moved.map((g) => g.key)).toEqual([item.gym_key]);
    expect(moved[0].points_week - before.get(item.gym_key)!).toBe(item.points);
    expect(moved[0].days[3]).toBe(moved[0].points_today);
    expect(s.payload.sessions_hour).toBe(hour + 1);
    expect(s.payload.feed.length).toBe(41);
  });
});

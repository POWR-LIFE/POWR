import {
  gateLine,
  liveMode,
  liveScenePlan,
  prizeLine,
  prizeSlots,
  raceThreshold,
  rerank,
  sampleLiveRows,
  simulateLanding,
  type LiveRow,
} from '../shared/liveBoard';

const rows = (pts: number[]): LiveRow[] => pts.map((points, i) => ({ key: `k${i}`, rank: i + 1, points, display_name: `P${i}` }));

describe('raceThreshold / liveMode', () => {
  it('never goes below five on the board', () => {
    expect(raceThreshold(0)).toBe(5);
    expect(raceThreshold(1)).toBe(5);
    expect(raceThreshold(3)).toBe(5);
  });

  it('wants every prize place filled plus two chasing', () => {
    expect(raceThreshold(4)).toBe(6);
    expect(raceThreshold(10)).toBe(12);
  });

  it('flips from warm-up to race at the threshold', () => {
    expect(liveMode(0, 3)).toBe('warmup');
    expect(liveMode(4, 3)).toBe('warmup');
    expect(liveMode(5, 3)).toBe('race');
    expect(liveMode(5, 4)).toBe('warmup');
    expect(liveMode(6, 4)).toBe('race');
  });
});

describe('prizeSlots', () => {
  const prizes = [{ rank: 2, label: 'B' }, { rank: 1, label: 'A' }, { rank: 3, label: 'C' }];

  it('orders by rank and leaves untaken places empty', () => {
    const slots = prizeSlots(prizes, rows([40]));
    expect(slots.map((s) => s.prize.label)).toEqual(['A', 'B', 'C']);
    expect(slots[0].holder?.key).toBe('k0');
    expect(slots[1].holder).toBeNull();
    expect(slots[2].holder).toBeNull();
  });
});

describe('prizeLine', () => {
  it('is null until someone sits outside the prizes', () => {
    expect(prizeLine(rows([50, 40, 30]), 3)).toBeNull();
    expect(prizeLine(rows([50]), 0)).toBeNull();
  });

  it('pairs the last prize place with the first one out', () => {
    const line = prizeLine(rows([90, 70, 52, 40, 10]), 3);
    expect(line?.lastIn.key).toBe('k2');
    expect(line?.firstOut.key).toBe('k3');
    expect(line?.gap).toBe(12);
  });
});

describe('liveScenePlan', () => {
  it('warm-up rotates prizes and how to enter', () => {
    expect(liveScenePlan({ mode: 'warmup', prizes: 3, rows: 2 }).map((p) => p.scene)).toEqual(['prizes', 'enter']);
  });

  it('race adds the prize fight and the chasing pack only when they have something to show', () => {
    expect(liveScenePlan({ mode: 'race', prizes: 3, rows: 6 }).map((p) => p.scene)).toEqual(['race', 'fight']);
    expect(liveScenePlan({ mode: 'race', prizes: 0, rows: 6 }).map((p) => p.scene)).toEqual(['race']);
    expect(liveScenePlan({ mode: 'race', prizes: 3, rows: 24 }).map((p) => p.scene)).toEqual(['race', 'fight', 'chasing']);
  });
});

describe('gateLine', () => {
  it('says nothing for an ungated event', () => {
    expect(gateLine(null)).toBeNull();
    expect(gateLine({ n: 0 })).toBeNull();
  });

  it('matches the gate mode and what counts', () => {
    expect(gateLine({ n: 3, counting: 'signups', mode: 'deadline' })).toBe('Bring 3 friends who join with your code to make the final standings');
    expect(gateLine({ n: 1, counting: 'conversions', mode: 'entry' })).toBe('Bring 1 friend who joins and logs a verified workout to get on the board');
  });
});

describe('preview simulation', () => {
  it('re-ranks by points and reports movement against the reference', () => {
    const ref = new Map([['k0', 1], ['k1', 2]]);
    const next = rerank([{ key: 'k0', rank: 1, points: 10 }, { key: 'k1', rank: 2, points: 30 }], ref);
    expect(next.map((r) => [r.key, r.rank, r.rank_delta])).toEqual([['k1', 1, 1], ['k0', 2, -1]]);
  });

  it('lands a workout on someone and keeps the board ranked', () => {
    let seed = 0.37;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280 / 233280; return seed; };
    const start = sampleLiveRows(8);
    const ref = new Map(start.map((r) => [r.key, r.rank]));
    const { rows: after, item } = simulateLanding(start, ref, 1, rnd);
    const total = (rs: LiveRow[]) => rs.reduce((s, r) => s + r.points, 0);
    expect(total(after) - total(start)).toBe(item.points);
    expect(after.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 1; i < after.length; i++) expect(after[i - 1].points).toBeGreaterThanOrEqual(after[i].points);
  });
});

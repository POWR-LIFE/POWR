/**
 * The member's own gyms always get a wake ring (lib/geofence/armedSet.ts).
 *
 * iOS watches 20 regions per app — 19 venues plus the travel sentinel. The set
 * used to be the 19 NEAREST to wherever the app last armed. 2,120 of 8,007
 * venues have 19 or more others within 2 km (2026-11-25), and the sentinel that
 * triggers a re-arm is floored at 2 km, so in a dense city a member's own gym
 * could sit just outside the cut with nothing watching it.
 *
 * What this pins:
 *   1. the home gym and recently visited venues are reserved slots, even when
 *      nineteen nearer venues exist;
 *   2. the reserve is capped, so the set still follows the member around;
 *   3. a reserved venue across town never stretches the sentinel envelope;
 *   4. with no priority information the set is exactly the nearest, as before.
 */
import {
  PRIORITY_MAX_DISTANCE_M,
  PRIORITY_SLOTS_MAX,
  VISITED_KEEP,
  VISITED_MAX_AGE_MS,
  pickArmedSet,
  withVisit,
  type ArmEntry,
} from '@/lib/geofence/armedSet';

const NOW = 1_800_000_000_000;
const HERE = { latitude: 51.5, longitude: -0.12 };
const north = (m: number) => m / 111_195;

/** `n` venues in a line heading north, the i-th one (i + 1) * stepM away. */
function row(n: number, stepM: number, prefix = 'near'): Array<[string, ArmEntry]> {
  return Array.from({ length: n }, (_, i) => [
    `${prefix}-${String(i).padStart(2, '0')}-0`,
    { dbId: `${prefix}-${String(i).padStart(2, '0')}`, lat: HERE.latitude + north((i + 1) * stepM), lng: HERE.longitude, radius: 25 },
  ]);
}
const venue = (id: string, metresNorth: number): [string, ArmEntry] =>
  [`${id}-0`, { dbId: id, lat: HERE.latitude + north(metresNorth), lng: HERE.longitude, radius: 25 }];

describe('pickArmedSet', () => {
  it('with nothing of their own to reserve, it is exactly the nearest — unchanged', () => {
    const entries = row(40, 50);
    const pick = pickArmedSet(entries, HERE, 19, null, NOW);
    expect(pick.chosen.map(c => c.id)).toEqual(entries.slice(0, 19).map(([id]) => id));
    expect(pick.priorityCount).toBe(0);
    expect(Math.round(pick.envelopeM!)).toBe(19 * 50);
  });

  it('the dense-city case: the home gym ranks 26th and still gets a slot', () => {
    // Twenty-five venues inside 1.25 km, then the member's own gym 1.5 km out.
    const entries = [...row(25, 50), venue('my-gym', 1_500)];
    const without = pickArmedSet(entries, HERE, 19, null, NOW);
    expect(without.chosen.some(c => c.id === 'my-gym-0')).toBe(false);

    const withHome = pickArmedSet(entries, HERE, 19, { homeGymId: 'my-gym', visited: {} }, NOW);
    expect(withHome.chosen[0]).toMatchObject({ id: 'my-gym-0', priority: true });
    expect(withHome.chosen).toHaveLength(19);
    expect(withHome.priorityCount).toBe(1);
  });

  it('a reserved venue across town does not stretch the sentinel envelope', () => {
    const entries = [...row(25, 50), venue('my-gym', 30_000)];
    const pick = pickArmedSet(entries, HERE, 19, { homeGymId: 'my-gym', visited: {} }, NOW);
    // 18 nearest fill the rest; the envelope is the 18th, not 30 km.
    expect(Math.round(pick.envelopeM!)).toBe(18 * 50);
  });

  it('places they have checked in are reserved too, most recent first', () => {
    const entries = [...row(25, 50), venue('old', 1_400), venue('recent', 1_600), venue('ancient', 1_800)];
    const pick = pickArmedSet(entries, HERE, 19, {
      homeGymId: null,
      visited: {
        'old-0': NOW - 30 * 86_400_000,
        'recent-0': NOW - 2 * 86_400_000,
        'ancient-0': NOW - VISITED_MAX_AGE_MS - 1,
      },
    }, NOW);
    expect(pick.chosen.slice(0, 2).map(c => c.id)).toEqual(['recent-0', 'old-0']);
    expect(pick.chosen.some(c => c.id === 'ancient-0')).toBe(false);
    expect(pick.priorityCount).toBe(2);
  });

  it('caps the reserve so the set still follows the member', () => {
    const mine = Array.from({ length: 12 }, (_, i) => venue(`mine${i}`, 2_000 + i * 100));
    const visited = Object.fromEntries(mine.map(([id], i) => [id, NOW - i * 86_400_000]));
    const pick = pickArmedSet([...row(25, 50), ...mine], HERE, 19, { homeGymId: null, visited }, NOW);
    expect(pick.priorityCount).toBe(PRIORITY_SLOTS_MAX);
    expect(pick.chosen.filter(c => !c.priority)).toHaveLength(19 - PRIORITY_SLOTS_MAX);
    expect(pick.chosen).toHaveLength(19);
  });

  it('never lists a venue twice when it is both home, visited and nearest', () => {
    const entries = row(25, 50);
    const pick = pickArmedSet(entries, HERE, 19, {
      homeGymId: 'near-00', visited: { 'near-00-0': NOW - 1_000, 'near-01-0': NOW - 2_000 },
    }, NOW);
    const ids = pick.chosen.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(19);
  });

  it('skips a home gym too far away to reach before the next re-arm', () => {
    const entries = [...row(25, 50), venue('my-gym', PRIORITY_MAX_DISTANCE_M + 1_000)];
    const pick = pickArmedSet(entries, HERE, 19, { homeGymId: 'my-gym', visited: {} }, NOW);
    expect(pick.priorityCount).toBe(0);
    expect(pick.chosen.some(c => c.id === 'my-gym-0')).toBe(false);
  });

  it('reserves the NEAREST location of a multi-site home gym', () => {
    const entries: Array<[string, ArmEntry]> = [
      ...row(25, 50),
      ['chain-0', { dbId: 'chain', lat: HERE.latitude + north(9_000), lng: HERE.longitude, radius: 25 }],
      ['chain-1', { dbId: 'chain', lat: HERE.latitude + north(1_700), lng: HERE.longitude, radius: 25 }],
    ];
    const pick = pickArmedSet(entries, HERE, 19, { homeGymId: 'chain', visited: {} }, NOW);
    expect(pick.chosen[0].id).toBe('chain-1');
    expect(pick.chosen.some(c => c.id === 'chain-0')).toBe(false);
  });

  it('ignores entries with no geometry and copes with an empty map', () => {
    expect(pickArmedSet([], HERE, 19, null, NOW)).toEqual({ chosen: [], envelopeM: null, priorityCount: 0 });
    const pick = pickArmedSet([['bad-0', { dbId: 'bad' }], venue('ok', 100)], HERE, 19, null, NOW);
    expect(pick.chosen.map(c => c.id)).toEqual(['ok-0']);
  });
});

describe('withVisit', () => {
  it('keeps the newest check-ins and forgets the rest', () => {
    let visited: Record<string, number> = {};
    for (let i = 0; i < VISITED_KEEP + 5; i++) visited = withVisit(visited, `r-${i}`, NOW + i);
    expect(Object.keys(visited)).toHaveLength(VISITED_KEEP);
    expect(visited['r-0']).toBeUndefined();
    expect(visited[`r-${VISITED_KEEP + 4}`]).toBe(NOW + VISITED_KEEP + 4);
  });

  it('refreshes a venue visited again rather than duplicating it', () => {
    const visited = withVisit(withVisit({}, 'gym-0', NOW), 'gym-0', NOW + 5_000);
    expect(visited).toEqual({ 'gym-0': NOW + 5_000 });
  });
});

/**
 * Live-event big screen — pure helpers for the venue display
 * (landing-page/src/pages/LiveBoard.jsx). No React, no network.
 *
 * The screen has two faces while an event is live:
 *   WARM-UP — too few people have scored for a leaderboard to read as a race,
 *             so the prizes lead: who holds each one right now, what is still
 *             up for grabs, how to get in.
 *   RACE    — the full board, Gym Clash style.
 * The switch is `raceThreshold()`: every prize place taken AND two people
 * chasing outside them, never fewer than five on the board.
 */

export type LivePrize = { rank: number; label: string; image_url?: string | null };

export type LiveRow = {
  key: string;
  rank: number;
  points: number;
  rank_delta?: number | null;
  display_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
};

export type LiveFeedItem = {
  key: string;
  /** The standings row key of whoever scored (hashed, never a user id). */
  who: string;
  display_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  type: string;
  points: number;
  at: string;
};

/** Never show the race board with fewer than this many people on it. */
export const RACE_FLOOR = 5;

/** People with points the race board needs: every prize place filled plus two
 *  chasing outside them, so the prize line has someone on each side. */
export function raceThreshold(prizeCount: number): number {
  return Math.max(RACE_FLOOR, Math.max(0, Math.trunc(prizeCount)) + 2);
}

export function liveMode(scorers: number, prizeCount: number): 'warmup' | 'race' {
  return scorers >= raceThreshold(prizeCount) ? 'race' : 'warmup';
}

/** Prize places in rank order, each with whoever holds it right now (null = up for grabs). */
export function prizeSlots(prizes: LivePrize[], standings: LiveRow[]): Array<{ prize: LivePrize; holder: LiveRow | null }> {
  const byRank = new Map(standings.map((r) => [r.rank, r]));
  return [...prizes]
    .sort((a, b) => a.rank - b.rank)
    .map((prize) => ({ prize, holder: byRank.get(prize.rank) ?? null }));
}

/** The fight at the prize line: the last person inside the prizes and the
 *  first one outside. null until both exist. */
export function prizeLine(standings: LiveRow[], prizeCount: number): { lastIn: LiveRow; firstOut: LiveRow; gap: number } | null {
  if (prizeCount <= 0) return null;
  const sorted = [...standings].sort((a, b) => a.rank - b.rank);
  const lastIn = sorted[prizeCount - 1];
  const firstOut = sorted[prizeCount];
  if (!lastIn || !firstOut) return null;
  return { lastIn, firstOut, gap: Math.max(0, lastIn.points - firstOut.points) };
}

export type LiveScene = 'prizes' | 'enter' | 'race' | 'fight' | 'chasing';

/** Lanes on the race scene before the rest move to the chasing scene. */
export const RACE_LANES = 10;

/** What the main column plays while the event is live. Keyed by the caller on
 *  the scene names only, never the payload (a fresh object lands every poll). */
export function liveScenePlan(opts: { mode: 'warmup' | 'race'; prizes: number; rows: number }): Array<{ scene: LiveScene; ms: number }> {
  if (opts.mode === 'warmup') {
    return [
      { scene: 'prizes', ms: 24_000 },
      { scene: 'enter', ms: 14_000 },
    ];
  }
  const plan: Array<{ scene: LiveScene; ms: number }> = [{ scene: 'race', ms: 34_000 }];
  if (opts.prizes > 0 && opts.rows > opts.prizes) plan.push({ scene: 'fight', ms: 14_000 });
  if (opts.rows > RACE_LANES) plan.push({ scene: 'chasing', ms: 10_000 });
  return plan;
}

/** The entry-gate sentence the screen prints, or null for an ungated event. */
export function gateLine(gate: { n: number; counting?: string | null; mode?: string | null } | null | undefined): string | null {
  if (!gate || !(gate.n > 0)) return null;
  const one = gate.n === 1;
  const friends = `${gate.n} friend${one ? '' : 's'}`;
  const how = gate.counting === 'conversions'
    ? (one ? ' who joins and logs a verified workout' : ' who join and log a verified workout')
    : (one ? ' who joins with your code' : ' who join with your code');
  return gate.mode === 'entry'
    ? `Bring ${friends}${how} to get on the board`
    : `Bring ${friends}${how} to make the final standings`;
}

// ─── Preview: sample standings that keep moving ─────────────────

const SAMPLE_NAMES = [
  'Alex P.', 'Jordan R.', 'Sam T.', 'Charlie M.', 'Taylor B.', 'Morgan K.',
  'Riley S.', 'Casey D.', 'Jamie W.', 'Drew H.', 'Robin F.', 'Quinn L.',
  'Avery N.', 'Skyler J.', 'Reese C.', 'Rowan G.', 'Emerson V.', 'Finley O.',
  'Harper E.', 'Kendall A.', 'Logan I.', 'Marley U.', 'Noel Y.', 'Parker Z.',
];
const SAMPLE_TYPES = ['gym', 'running', 'hiit', 'cycling', 'yoga', 'swimming', 'walking'];

/** Obviously-fake standings for the admin preview. */
export function sampleLiveRows(n: number): LiveRow[] {
  return SAMPLE_NAMES.slice(0, Math.max(0, n)).map((name, i) => ({
    key: `preview-${i}`,
    rank: i + 1,
    points: Math.max(12, 940 - i * 37 - (i % 3) * 11),
    rank_delta: null,
    display_name: name,
    username: null,
    avatar_url: null,
  }));
}

/** Re-rank by points (ties: whoever was ahead stays ahead), carrying movement
 *  against `prev` so the preview shows arrows like the real board. */
export function rerank(rows: LiveRow[], prev: Map<string, number>): LiveRow[] {
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.points - a.r.points || a.r.rank - b.r.rank || a.i - b.i)
    .map(({ r }) => r);
  return sorted.map((r, i) => {
    const was = prev.get(r.key);
    return { ...r, rank: i + 1, rank_delta: was == null ? null : was - (i + 1) };
  });
}

/** One simulated workout landing on the preview board. `rnd` is injected so tests are deterministic. */
export function simulateLanding(rows: LiveRow[], dayStart: Map<string, number>, seq: number, rnd: () => number = Math.random): { rows: LiveRow[]; item: LiveFeedItem } {
  // Favour the chasing pack a little so places actually change.
  const weights = rows.map((r) => 1 + r.rank / Math.max(1, rows.length));
  let pick = rnd() * weights.reduce((s, w) => s + w, 0);
  let idx = 0;
  for (let i = 0; i < weights.length; i++) { pick -= weights[i]; if (pick <= 0) { idx = i; break; } }
  const points = 10 + Math.round(rnd() * 34);
  const type = SAMPLE_TYPES[Math.floor(rnd() * SAMPLE_TYPES.length)];
  const target = rows[idx];
  const bumped = rows.map((r, i) => (i === idx ? { ...r, points: r.points + points } : r));
  return {
    rows: rerank(bumped, dayStart),
    item: {
      key: `sim-${seq}`,
      who: target.key,
      display_name: target.display_name,
      username: target.username,
      avatar_url: target.avatar_url,
      type,
      points,
      at: new Date().toISOString(),
    },
  };
}

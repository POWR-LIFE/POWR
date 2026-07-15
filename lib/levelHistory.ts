import { getLevelInfo } from '@/constants/levels';
import type { PointTransaction } from '@/lib/api/points';

/**
 * A reconstructed "the member levelled up here" moment. Levels are never
 * stored — they're a pure function of lifetime earned — so the ledger derives
 * these by replaying its credits and watching the running total cross level
 * boundaries. Works retroactively for the member's whole visible history.
 */
export interface LevelUpEvent {
  /** Level reached. Multi-level jumps collapse to the final level, matching the celebration. */
  level: number;
  /** The transaction whose credit crossed the boundary — the event renders next to it. */
  txId: string;
  createdAt: string;
  /** Lifetime earned immediately after the crossing credit (the share card's asOf anchor). */
  totalEarnedAt: number;
}

/**
 * Replays the newest-first transaction list oldest→newest and emits an event
 * wherever the cumulative earned total crosses a level boundary.
 *
 * `totalEarnedNow` (from get_my_points_summary — credits only) anchors the
 * starting point: the ledger fetch caps at 500 rows, so credits older than the
 * window are accounted for as a baseline rather than assumed to be zero.
 */
export function deriveLevelUps(
  newestFirst: PointTransaction[],
  totalEarnedNow: number,
): LevelUpEvent[] {
  const visibleEarned = newestFirst.reduce((sum, t) => sum + Math.max(t.amount, 0), 0);
  let running = Math.max(0, totalEarnedNow - visibleEarned);

  const events: LevelUpEvent[] = [];
  for (let i = newestFirst.length - 1; i >= 0; i--) {
    const tx = newestFirst[i];
    if (tx.amount <= 0) continue;
    const before = getLevelInfo(running).current.level;
    running += tx.amount;
    const after = getLevelInfo(running).current.level;
    if (after > before) {
      events.push({ level: after, txId: tx.id, createdAt: tx.created_at, totalEarnedAt: running });
    }
  }
  return events.reverse(); // newest first, like the ledger itself
}

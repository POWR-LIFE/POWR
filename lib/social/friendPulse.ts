/**
 * Friend-pulse relevance: which ONE friend (if any) the home "challenge them"
 * row should feature. Recency alone is a weak signal — in an active friend
 * group somebody trained in the last 24h basically every day, so the row would
 * become permanent furniture pinned to the most frequent gym-goer. Ranking
 * instead leads with the strongest accept-predictor available client-side:
 * shared-challenge history with YOU. Recency breaks ties.
 *
 * Anti-fatigue guardrails, all enforced here so they're testable:
 *  - a friend who declined one of your invites recently is off the list;
 *  - the same friend is featured at most once per PULSE_FRIEND_COOLOFF_MS
 *    (but keeps showing for the rest of the day they were featured, so the
 *    row isn't flickery within a session);
 *  - dismissing the row silences it entirely for PULSE_DISMISS_COOLOFF_MS.
 */

import type { Friend, SharedChallenge } from './types';

export interface PulseCandidate {
  friend: Friend;
  type: string;
  startedAt: string;
}

export interface PulseHistory {
  /** Challenges (in your list) this friend accepted/completed alongside you. */
  togetherCount: Map<string, number>;
  /** Challenges this friend created that included you — reciprocity. */
  invitedMeCount: Map<string, number>;
  /** Most recent time (ms) this friend declined one of YOUR challenges. */
  recentDeclineAt: Map<string, number>;
}

export interface PulsePacing {
  /** Per-friend: when they were last featured (ms epoch). */
  lastSuggestedAt: Record<string, number>;
  /** When the user dismissed the row outright (ms epoch). */
  rowDismissedAt?: number;
}

export const PULSE_FRIEND_COOLOFF_MS = 3 * 24 * 3_600_000; // same friend ≤ once per 3 days
export const PULSE_DECLINE_COOLOFF_MS = 7 * 24 * 3_600_000; // declined your invite → week off
export const PULSE_DISMISS_COOLOFF_MS = 36 * 3_600_000;     // row dismissed → day and a half off

/** Same recency proxy as lib/social/crew.ts — endsAt once started, acceptBy while forming. */
function recency(c: SharedChallenge): number {
  return Date.parse(c.settledAt ?? c.endsAt ?? c.acceptBy ?? '') || 0;
}

export function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/** Distils the challenge list (which always includes you) into per-friend signals. */
export function buildPulseHistory(all: SharedChallenge[], selfId: string | null): PulseHistory {
  const togetherCount = new Map<string, number>();
  const invitedMeCount = new Map<string, number>();
  const recentDeclineAt = new Map<string, number>();
  for (const c of all) {
    const when = recency(c);
    for (const p of c.participants) {
      if (p.isSelf) continue;
      const id = p.friend.id;
      if (p.state === 'accepted' || p.state === 'completed' || p.completed) {
        togetherCount.set(id, (togetherCount.get(id) ?? 0) + 1);
      }
      if (c.creatorId === id) {
        invitedMeCount.set(id, (invitedMeCount.get(id) ?? 0) + 1);
      }
      if (selfId && c.creatorId === selfId && p.state === 'declined') {
        recentDeclineAt.set(id, Math.max(recentDeclineAt.get(id) ?? 0, when));
      }
    }
  }
  return { togetherCount, invitedMeCount, recentDeclineAt };
}

/**
 * Picks the friend to feature, or null. Candidates are pre-filtered by the
 * caller for hard constraints the ranker can't know (opted-out friends,
 * already in / invited to a live challenge with you).
 */
export function rankFriendPulse(
  candidates: PulseCandidate[],
  history: PulseHistory,
  pacing: PulsePacing,
  now: number = Date.now(),
): PulseCandidate | null {
  if (pacing.rowDismissedAt && now - pacing.rowDismissedAt < PULSE_DISMISS_COOLOFF_MS) return null;

  const eligible = candidates.filter((c) => {
    const id = c.friend.id;
    const declined = history.recentDeclineAt.get(id);
    if (declined && now - declined < PULSE_DECLINE_COOLOFF_MS) return false;
    const last = pacing.lastSuggestedAt[id];
    // Featured recently → cool off, EXCEPT continuation of today's feature.
    if (last && now - last < PULSE_FRIEND_COOLOFF_MS && !sameLocalDay(last, now)) return false;
    return true;
  });
  if (eligible.length === 0) return null;

  // History dominates, reciprocity nudges, freshness (0–24) breaks near-ties.
  const score = (c: PulseCandidate): number => {
    const id = c.friend.id;
    const ageH = Math.max(0, (now - Date.parse(c.startedAt)) / 3_600_000);
    return (
      (history.togetherCount.get(id) ?? 0) * 100 +
      (history.invitedMeCount.get(id) ?? 0) * 25 +
      Math.max(0, 24 - ageH)
    );
  };
  return [...eligible].sort(
    (a, b) => score(b) - score(a) || Date.parse(b.startedAt) - Date.parse(a.startedAt),
  )[0];
}

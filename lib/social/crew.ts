import type { Friend, SharedChallenge } from './types';

/**
 * Who to preselect when re-running `challenge`: everyone who actually joined
 * (accepted/completed), falling back to the invited-but-never-answered crowd
 * when nobody did (a challenge that died forming still had an intended crew).
 * Ids are returned raw — the create sheet drops anyone who is no longer an
 * invitable friend.
 */
export function rematchCrew(challenge: SharedChallenge): string[] {
  const others = challenge.participants.filter((p) => !p.isSelf);
  const joined = others.filter((p) => p.state === 'accepted' || p.state === 'completed' || p.completed);
  const pool = joined.length > 0 ? joined : others.filter((p) => p.state === 'invited');
  return pool.map((p) => p.friend.id);
}

/** Recency proxy — endsAt exists once started, acceptBy while forming. */
function recency(c: SharedChallenge): number {
  return Date.parse(c.settledAt ?? c.endsAt ?? c.acceptBy ?? '') || 0;
}

/**
 * The crew from your most recently created group challenge — the default
 * preselection when the create sheet opens, so the usual gym partners are one
 * "send" away instead of re-picked every time. Empty when you've never made a
 * group challenge (or have no self id yet).
 */
export function lastCrew(all: SharedChallenge[], selfId: string | null): string[] {
  if (!selfId) return [];
  const mine = all
    .filter((c) => c.creatorId === selfId && c.participants.some((p) => !p.isSelf))
    .sort((a, b) => recency(b) - recency(a));
  return mine.length ? rematchCrew(mine[0]) : [];
}

/**
 * The crew to PITCH on the starter cards (and preselect when one is tapped):
 * your usual crew leads, then the rest of your invitable friends fill the
 * remaining slots — so someone who has never created a challenge still sees
 * real faces, and one small challenge doesn't shrink the pitch to that single
 * friend forever. Only accepted, together-enabled friends qualify (the pitch
 * must never name someone the create sheet would then refuse to invite).
 */
export function starterCrew(friends: Friend[], lastCrewIds: string[], max = 3): Friend[] {
  const invitable = friends.filter((f) => f.status === 'accepted' && f.togetherEnabled !== false);
  const byId = new Map(invitable.map((f) => [f.id, f]));
  const usual = lastCrewIds.map((id) => byId.get(id)).filter((f): f is Friend => !!f);
  const picked = new Set(usual.map((f) => f.id));
  return [...usual, ...invitable.filter((f) => !picked.has(f.id))].slice(0, max);
}

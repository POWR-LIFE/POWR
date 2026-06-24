/**
 * Data layer for shared ("together") challenges.
 *
 * Currently backed by in-memory mocks (lib/social/mockData) so the whole UI is
 * interactive in Expo Go before the backend exists. This hook is the SEAM: when
 * the friendships + shared_challenges tables and the complete-shared-challenge
 * edge function land, only this file changes — the components keep the same API.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  MOCK_FRIENDS,
  MOCK_SELF_ID,
  MOCK_SHARED_CHALLENGES,
  MOCK_TEMPLATES,
} from '@/lib/social/mockData';
import type {
  ChallengeTemplate,
  Friend,
  Participant,
  SharedChallenge,
} from '@/lib/social/types';

export interface NewChallengeInput {
  templateId: string;
  friendIds: string[];
  /** Chosen run length once the clock starts. Defaults to 72h. */
  durationHours?: number;
}

/** Invitees get this long to respond before a forming challenge resolves. */
const ACCEPT_WINDOW_HOURS = 48;
const DEFAULT_DURATION_HOURS = 72;
const HOUR_MS = 3_600_000;

/**
 * Max challenges you can have OPEN at once (your part not yet done). Keeping this
 * tight stops a stale wall of half-finished challenges and turns the cap into a
 * completion driver: finishing your part frees a slot, so completion is how you
 * make room for the next one. Pending invites don't count (they're requests, not
 * commitments). Scope §8 — concurrency cap.
 */
export const CHALLENGE_CAP = 3;

/** A challenge that occupies one of your slots: committed + live + not yet done. */
function isOpenForSelf(c: SharedChallenge): boolean {
  const self = c.participants.find((p) => p.isSelf);
  if (!self) return false;
  const committed = self.state === 'accepted';
  const live = c.status === 'active' || c.status === 'open';
  return committed && !self.completed && live;
}

export interface UseSharedChallenges {
  loading: boolean;
  /** Challenges the user is in or running. */
  active: SharedChallenge[];
  /** Invites awaiting the user's response (subset surfaced for badges/CTAs). */
  pendingInvites: SharedChallenge[];
  /** Challenges occupying a slot — your part isn't done yet. */
  openChallenges: SharedChallenge[];
  /** How many of the cap's slots are in use. */
  openCount: number;
  /** Max concurrent open challenges. */
  cap: number;
  /** True when every slot is full — must finish or drop one to take on another. */
  atCap: boolean;
  friends: Friend[];
  templates: ChallengeTemplate[];
  selfId: string;
  createChallenge: (input: NewChallengeInput) => Promise<SharedChallenge>;
  acceptInvite: (challengeId: string) => Promise<void>;
  declineInvite: (challengeId: string) => Promise<void>;
  /** Drop a challenge you're in — frees a slot. */
  leaveChallenge: (challengeId: string) => Promise<void>;
  /** Mark your part done. Real path: a backend completion event calls this. */
  completeChallenge: (challengeId: string) => Promise<void>;
  /** Id of a challenge you just completed — drives the celebration overlay. */
  newlyCompletedId: string | null;
  /** Dismiss the celebration overlay. */
  clearCelebration: () => void;
  refresh: () => Promise<void>;
}

let idCounter = 0;
const nextId = () => `sc-new-${++idCounter}`;

export function useSharedChallenges(): UseSharedChallenges {
  const [challenges, setChallenges] = useState<SharedChallenge[]>(MOCK_SHARED_CHALLENGES);
  const [loading] = useState(false);
  const [newlyCompletedId, setNewlyCompletedId] = useState<string | null>(null);

  const active = useMemo(
    () => challenges.filter((c) => c.status === 'active' || c.creatorId === MOCK_SELF_ID),
    [challenges],
  );

  const pendingInvites = useMemo(
    () =>
      challenges.filter((c) =>
        c.participants.some((p) => p.isSelf && p.state === 'invited'),
      ),
    [challenges],
  );

  const openChallenges = useMemo(() => challenges.filter(isOpenForSelf), [challenges]);
  const openCount = openChallenges.length;
  const atCap = openCount >= CHALLENGE_CAP;

  const createChallenge = useCallback(
    async ({ templateId, friendIds, durationHours = DEFAULT_DURATION_HOURS }: NewChallengeInput) => {
      if (openCount >= CHALLENGE_CAP) {
        throw new Error('Challenge slots full — finish or drop one first.');
      }
      const template = MOCK_TEMPLATES.find((t) => t.id === templateId) ?? MOCK_TEMPLATES[0];
      const invited: Participant[] = friendIds
        .map((fid) => MOCK_FRIENDS.find((f) => f.id === fid))
        .filter((f): f is Friend => !!f)
        .map((f) => ({ friend: f, state: 'invited' as const, progress: 0, completed: false }));

      // Forming until invitees respond — clock is off (endsAt null), accept
      // window running. The chosen duration is applied to endsAt once it starts.
      const created: SharedChallenge = {
        id: nextId(),
        template,
        kind: 'parallel',
        status: 'active',
        creatorId: MOCK_SELF_ID,
        expiresIn: 'Not started',
        endsAt: null,
        acceptBy: new Date(Date.now() + ACCEPT_WINDOW_HOURS * HOUR_MS).toISOString(),
        durationHours,
        participants: [
          {
            friend: { id: MOCK_SELF_ID, username: 'you', displayName: 'You', status: 'accepted' },
            state: 'accepted',
            progress: 0,
            completed: false,
            isSelf: true,
          },
          ...invited,
        ],
      };
      setChallenges((prev) => [created, ...prev]);
      return created;
    },
    [openCount],
  );

  const acceptInvite = useCallback(
    async (challengeId: string) => {
      // Accepting commits a slot — blocked at cap (UI offers "free a slot to join").
      if (openCount >= CHALLENGE_CAP) return;
      setChallenges((prev) =>
        prev.map((c) => {
          if (c.id !== challengeId) return c;
          const participants = c.participants.map((p) =>
            p.isSelf ? { ...p, state: 'accepted' as const } : p,
          );
          // Timer starts the moment the last invite is accepted (scope §8 #4),
          // running for the duration chosen at creation.
          const everyoneIn = participants.every((p) => p.state !== 'invited');
          const started = everyoneIn && !c.endsAt;
          const endsAt = started
            ? new Date(Date.now() + (c.durationHours ?? DEFAULT_DURATION_HOURS) * HOUR_MS).toISOString()
            : c.endsAt;
          return { ...c, status: 'active', participants, endsAt, acceptBy: started ? null : c.acceptBy };
        }),
      );
    },
    [openCount],
  );

  const declineInvite = useCallback(async (challengeId: string) => {
    setChallenges((prev) => prev.filter((c) => c.id !== challengeId));
  }, []);

  const leaveChallenge = useCallback(async (challengeId: string) => {
    setChallenges((prev) => prev.filter((c) => c.id !== challengeId));
  }, []);

  const completeChallenge = useCallback(async (challengeId: string) => {
    setChallenges((prev) =>
      prev.map((c) =>
        c.id === challengeId
          ? {
              ...c,
              participants: c.participants.map((p) =>
                p.isSelf ? { ...p, state: 'completed' as const, progress: 1, completed: true } : p,
              ),
            }
          : c,
      ),
    );
    setNewlyCompletedId(challengeId);
  }, []);

  const clearCelebration = useCallback(() => setNewlyCompletedId(null), []);

  // When a forming challenge's accept window closes, it can't hang: it starts
  // with whoever's in (≥2) or auto-cancels. (Server cron does this for real; this
  // mirrors it client-side so the mock stays honest.)
  useEffect(() => {
    const resolveExpiredForming = () => {
      setChallenges((prev) => {
        let changed = false;
        const next = prev.flatMap<SharedChallenge>((c) => {
          const forming = c.participants.some((p) => p.state === 'invited');
          if (!forming || !c.acceptBy || Date.parse(c.acceptBy) > Date.now()) return [c];
          changed = true;
          const remaining = c.participants.filter((p) => p.state !== 'invited');
          const accepted = remaining.filter((p) => p.state === 'accepted' || p.completed).length;
          if (accepted < 2) return []; // too few responders — cancel
          return [{
            ...c,
            participants: remaining,
            acceptBy: null,
            endsAt: new Date(Date.now() + (c.durationHours ?? DEFAULT_DURATION_HOURS) * HOUR_MS).toISOString(),
          }];
        });
        return changed ? next : prev;
      });
    };
    const id = setInterval(resolveExpiredForming, 30_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    /* no-op for mocks; real impl will refetch */
  }, []);

  return {
    loading,
    active,
    pendingInvites,
    openChallenges,
    openCount,
    cap: CHALLENGE_CAP,
    atCap,
    friends: MOCK_FRIENDS.filter((f) => f.status === 'accepted'),
    templates: MOCK_TEMPLATES,
    selfId: MOCK_SELF_ID,
    createChallenge,
    acceptInvite,
    declineInvite,
    leaveChallenge,
    completeChallenge,
    newlyCompletedId,
    clearCelebration,
    refresh,
  };
}

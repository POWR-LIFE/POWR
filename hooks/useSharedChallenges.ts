/**
 * Data layer for shared ("together") challenges.
 *
 * Currently backed by in-memory mocks (lib/social/mockData) so the whole UI is
 * interactive in Expo Go before the backend exists. This hook is the SEAM: when
 * the friendships + shared_challenges tables and the complete-shared-challenge
 * edge function land, only this file changes — the components keep the same API.
 */

import { useCallback, useMemo, useState } from 'react';

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
}

export interface UseSharedChallenges {
  loading: boolean;
  /** Challenges the user is in or running. */
  active: SharedChallenge[];
  /** Invites awaiting the user's response (subset surfaced for badges/CTAs). */
  pendingInvites: SharedChallenge[];
  friends: Friend[];
  templates: ChallengeTemplate[];
  selfId: string;
  createChallenge: (input: NewChallengeInput) => Promise<SharedChallenge>;
  acceptInvite: (challengeId: string) => Promise<void>;
  declineInvite: (challengeId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

let idCounter = 0;
const nextId = () => `sc-new-${++idCounter}`;

export function useSharedChallenges(): UseSharedChallenges {
  const [challenges, setChallenges] = useState<SharedChallenge[]>(MOCK_SHARED_CHALLENGES);
  const [loading] = useState(false);

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

  const createChallenge = useCallback(
    async ({ templateId, friendIds }: NewChallengeInput) => {
      const template = MOCK_TEMPLATES.find((t) => t.id === templateId) ?? MOCK_TEMPLATES[0];
      const invited: Participant[] = friendIds
        .map((fid) => MOCK_FRIENDS.find((f) => f.id === fid))
        .filter((f): f is Friend => !!f)
        .map((f) => ({ friend: f, state: 'invited' as const, progress: 0, completed: false }));

      const created: SharedChallenge = {
        id: nextId(),
        template,
        kind: 'parallel',
        status: 'active',
        creatorId: MOCK_SELF_ID,
        expiresIn: '7d left',
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
    [],
  );

  const acceptInvite = useCallback(async (challengeId: string) => {
    setChallenges((prev) =>
      prev.map((c) =>
        c.id === challengeId
          ? {
              ...c,
              status: 'active',
              participants: c.participants.map((p) =>
                p.isSelf ? { ...p, state: 'accepted' } : p,
              ),
            }
          : c,
      ),
    );
  }, []);

  const declineInvite = useCallback(async (challengeId: string) => {
    setChallenges((prev) => prev.filter((c) => c.id !== challengeId));
  }, []);

  const refresh = useCallback(async () => {
    /* no-op for mocks; real impl will refetch */
  }, []);

  return {
    loading,
    active,
    pendingInvites,
    friends: MOCK_FRIENDS.filter((f) => f.status === 'accepted'),
    templates: MOCK_TEMPLATES,
    selfId: MOCK_SELF_ID,
    createChallenge,
    acceptInvite,
    declineInvite,
    refresh,
  };
}

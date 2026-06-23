/**
 * Friend-graph data layer (scope §4). Mock-backed for now so the Friends screen
 * is interactive in Expo Go; this hook is the seam to the `friendships` table +
 * RLS later. Only this file changes when the backend lands.
 */

import { useCallback, useMemo, useState } from 'react';

import { MOCK_FRIENDS } from '@/lib/social/mockData';
import type { Friend } from '@/lib/social/types';

/** A directory of people you could discover by username search (not yet friends). */
const DIRECTORY: Friend[] = [
  { id: 'd-leo', username: 'leoruns', displayName: 'Leo Park', status: 'accepted' },
  { id: 'd-mia', username: 'miafit', displayName: 'Mia Chen', status: 'accepted' },
  { id: 'd-tom', username: 'tomlift', displayName: 'Tom Frost', status: 'accepted' },
  { id: 'd-ade', username: 'adeola', displayName: 'Ade Okafor', status: 'accepted' },
];

export interface UseFriends {
  friends: Friend[];
  /** People who asked to be your friend — need accept/decline. */
  incoming: Friend[];
  /** Requests you sent, awaiting their response. */
  outgoing: Friend[];
  /** Username search over people you're not yet connected to. */
  search: (query: string) => Friend[];
  sendRequest: (friend: Friend) => void;
  acceptRequest: (id: string) => void;
  declineRequest: (id: string) => void;
  removeFriend: (id: string) => void;
}

export function useFriends(): UseFriends {
  const [friends, setFriends] = useState<Friend[]>(MOCK_FRIENDS);
  const [incoming, setIncoming] = useState<Friend[]>([
    { id: 'r-zoe', username: 'zoek', displayName: 'Zoe Klein', status: 'pending' },
    { id: 'r-ben', username: 'benh', displayName: 'Ben Hart', status: 'pending' },
  ]);
  const [outgoing, setOutgoing] = useState<Friend[]>([
    { id: 'o-ade', username: 'adeola', displayName: 'Ade Okafor', status: 'pending' },
  ]);

  const knownIds = useMemo(
    () => new Set([...friends, ...incoming, ...outgoing].map((f) => f.id)),
    [friends, incoming, outgoing],
  );

  const search = useCallback(
    (query: string): Friend[] => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return DIRECTORY.filter(
        (f) =>
          !knownIds.has(f.id) &&
          (f.username.toLowerCase().includes(q) || f.displayName.toLowerCase().includes(q)),
      );
    },
    [knownIds],
  );

  const sendRequest = useCallback((friend: Friend) => {
    setOutgoing((prev) =>
      prev.some((f) => f.id === friend.id) ? prev : [...prev, { ...friend, status: 'pending' }],
    );
  }, []);

  const acceptRequest = useCallback((id: string) => {
    setIncoming((prev) => {
      const match = prev.find((f) => f.id === id);
      if (match) setFriends((fs) => [{ ...match, status: 'accepted' }, ...fs]);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const declineRequest = useCallback((id: string) => {
    setIncoming((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const removeFriend = useCallback((id: string) => {
    setFriends((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return { friends, incoming, outgoing, search, sendRequest, acceptRequest, declineRequest, removeFriend };
}

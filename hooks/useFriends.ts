/**
 * Friend-graph data layer (scope §4), backed by Supabase.
 *
 * Reads go through the get_my_friendships RPC (one call → friends / incoming /
 * outgoing, with the other person's profile joined). Discovery is the
 * search_profiles_by_username RPC. All MUTATIONS go through the manage-friendship
 * edge function (canonical-pair handling + push notifications live server-side),
 * then we refetch. This is the seam the mock used to fill — components are
 * unchanged except friends.tsx now awaits the async `search`.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Friend } from '@/lib/social/types';

type FriendAction = 'request' | 'accept' | 'decline' | 'remove' | 'block';

export interface UseFriends {
  loading: boolean;
  friends: Friend[];
  /** People who asked to be your friend — need accept/decline. */
  incoming: Friend[];
  /** Requests you sent, awaiting their response. */
  outgoing: Friend[];
  /** Username search over people you're not yet connected to (async — RPC). */
  search: (query: string) => Promise<Friend[]>;
  sendRequest: (friend: Friend) => void;
  acceptRequest: (id: string) => void;
  declineRequest: (id: string) => void;
  removeFriend: (id: string) => void;
  refresh: () => Promise<void>;
}

function rowToFriend(r: any, status: Friend['status']): Friend {
  return {
    id: r.friend_user_id ?? r.id,
    username: r.username ?? '',
    displayName: r.display_name ?? r.username ?? '',
    avatarUrl: r.avatar_url ?? null,
    status,
    togetherEnabled: r.together_enabled !== false, // default opted-in when unknown
  };
}

export function useFriends(): UseFriends {
  const { user } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<Friend[]>([]);
  const [outgoing, setOutgoing] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setFriends([]); setIncoming([]); setOutgoing([]); setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc('get_my_friendships');
    if (error) {
      console.warn('[useFriends] load failed:', error.message);
      setLoading(false);
      return;
    }
    const f: Friend[] = [], inc: Friend[] = [], out: Friend[] = [];
    for (const r of data ?? []) {
      if (r.status === 'accepted') f.push(rowToFriend(r, 'accepted'));
      else if (r.status === 'pending') {
        (r.requested_by === user.id ? out : inc).push(rowToFriend(r, 'pending'));
      }
    }
    setFriends(f); setIncoming(inc); setOutgoing(out); setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const search = useCallback(async (query: string): Promise<Friend[]> => {
    const q = query.trim();
    if (q.length < 2) return [];
    const { data, error } = await supabase.rpc('search_profiles_by_username', { q });
    if (error) {
      console.warn('[useFriends] search failed:', error.message);
      return [];
    }
    return (data ?? []).map((p: any) => rowToFriend(p, 'accepted'));
  }, []);

  const mutate = useCallback(async (action: FriendAction, targetUserId: string) => {
    const { error } = await supabase.functions.invoke('manage-friendship', {
      body: { action, target_user_id: targetUserId },
    });
    if (error) console.warn(`[useFriends] ${action} failed:`, error.message);
    await load();
  }, [load]);

  // Fire-and-forget from the UI; the list refreshes when the mutation resolves.
  const sendRequest = useCallback((friend: Friend) => { void mutate('request', friend.id); }, [mutate]);
  const acceptRequest = useCallback((id: string) => { void mutate('accept', id); }, [mutate]);
  const declineRequest = useCallback((id: string) => { void mutate('decline', id); }, [mutate]);
  const removeFriend = useCallback((id: string) => { void mutate('remove', id); }, [mutate]);

  return {
    loading, friends, incoming, outgoing, search,
    sendRequest, acceptRequest, declineRequest, removeFriend,
    refresh: load,
  };
}

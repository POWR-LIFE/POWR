import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useActivityRevision } from '@/hooks/useActivityRevision';
import { deriveRescueOffer, type StreakRescueOffer } from '@/lib/streakRescue';
import { supabase } from '@/lib/supabase';

// Pure state derivation (types, SAVED_VISIBLE_MS, deriveRescueOffer,
// rescueDayIndexFor) lives in lib/streakRescue so it stays testable without the
// native import chain this hook pulls in. Re-exported so call sites are
// unchanged.
export {
    deriveRescueOffer,
    rescueDayIndexFor,
    SAVED_VISIBLE_MS,
    type RescueRequirementType,
    type StreakRescueOffer,
    type StreakRescueRow,
} from '@/lib/streakRescue';

/**
 * The user's live streak-rescue offer, if any. Server-owned lifecycle: the
 * rescue sweep creates offers, a DB trigger advances sessions_done as
 * qualifying sessions land, and completion/expiry flip status — the client
 * only ever reads. RLS scopes the query to the signed-in user.
 */
export function useStreakRescue() {
    const queryClient = useQueryClient();
    const revision = useActivityRevision();

    // Nothing in the app invalidated ['streakRescue'] and this query sets no
    // refetchInterval, so the ONLY refresh paths were a cold mount and a
    // foreground return with the data already 60s stale. Completion is a server
    // event — the DB trigger flips the row inside the session INSERT — so the
    // moment it most needs to refetch is precisely the moment the user is
    // standing in the gym with the app open and nothing tells the client.
    // The revision bus already fires on session-completed, points-changed and
    // every foreground, which is exactly the set of events that can complete a
    // rescue. Compared against the revision seen at mount so remounting Home
    // doesn't fire a redundant invalidate on every visit.
    const seenRevision = useRef(revision);
    useEffect(() => {
        if (revision === seenRevision.current) return;
        seenRevision.current = revision;
        queryClient.invalidateQueries({ queryKey: ['streakRescue'] });
    }, [revision, queryClient]);

    const { data, isPending, refetch } = useQuery({
        queryKey: ['streakRescue'],
        queryFn: async (): Promise<StreakRescueOffer | null> => {
            try {
                const { data: row } = await supabase
                    .from('streak_rescues')
                    .select('id, lost_streak, missed_day, label, requirement_type, sessions_required, sessions_done, expires_at, status, completed_at')
                    .in('status', ['offered', 'completed'])
                    .order('offered_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                return deriveRescueOffer(row, Date.now());
            } catch {
                return null; // table may predate this build
            }
        },
        refetchOnWindowFocus: true,
    });

    return {
        rescue: data ?? null,
        loading: isPending,
        refresh: () => refetch(),
        // Called after a rescue completes so the streak card picks up the
        // restored value without waiting for the next natural refetch.
        invalidateStreak: () => queryClient.invalidateQueries({ queryKey: ['streak'] }),
    };
}

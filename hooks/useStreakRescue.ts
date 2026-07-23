import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface StreakRescueOffer {
    id: string;
    lostStreak: number;
    sessionsRequired: number;
    sessionsDone: number;
    expiresAt: string;
}

/**
 * The user's live streak-rescue offer, if any. Server-owned lifecycle: the
 * rescue sweep creates offers, a DB trigger advances sessions_done as
 * qualifying sessions land, and completion/expiry flip status — the client
 * only ever reads. RLS scopes the query to the signed-in user.
 */
export function useStreakRescue() {
    const queryClient = useQueryClient();
    const { data, isPending, refetch } = useQuery({
        queryKey: ['streakRescue'],
        queryFn: async (): Promise<StreakRescueOffer | null> => {
            try {
                const { data: row } = await supabase
                    .from('streak_rescues')
                    .select('id, lost_streak, sessions_required, sessions_done, expires_at, status')
                    .eq('status', 'offered')
                    .gt('expires_at', new Date().toISOString())
                    .maybeSingle();
                if (!row) return null;
                return {
                    id: row.id,
                    lostStreak: row.lost_streak,
                    sessionsRequired: row.sessions_required,
                    sessionsDone: row.sessions_done,
                    expiresAt: row.expires_at,
                };
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

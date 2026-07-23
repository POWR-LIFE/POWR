import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type RescueRequirementType = 'sessions' | 'gym_sessions' | 'active_days' | 'steps';

export interface StreakRescueOffer {
    id: string;
    /** 'offered' = challenge in progress; 'saved' = completed within the last
     *  24h — the card holds a celebratory state so the win is visible in-app,
     *  not only in the push (which a notifications-off user never sees). */
    state: 'offered' | 'saved';
    lostStreak: number;
    /** Admin-authored challenge name, e.g. "Back on track". */
    label: string | null;
    requirementType: RescueRequirementType;
    /** Required amount in the requirement's unit (sessions / days / steps). */
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
                    .select('id, lost_streak, label, requirement_type, sessions_required, sessions_done, expires_at, status, completed_at')
                    .in('status', ['offered', 'completed'])
                    .order('offered_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (!row) return null;

                const now = Date.now();
                const isLiveOffer = row.status === 'offered' && new Date(row.expires_at).getTime() > now;
                const isFreshSave = row.status === 'completed' && row.completed_at
                    && now - new Date(row.completed_at).getTime() < 24 * 3600_000;
                if (!isLiveOffer && !isFreshSave) return null;

                return {
                    id: row.id,
                    state: isLiveOffer ? 'offered' : 'saved',
                    lostStreak: row.lost_streak,
                    label: row.label ?? null,
                    requirementType: (row.requirement_type ?? 'sessions') as RescueRequirementType,
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

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
    /** The local calendar day (YYYY-MM-DD) that broke the chain — highlighted
     *  in the StreakCard week strip while the offer is live. */
    missedDay: string;
    /** Admin-authored challenge name, e.g. "Back on track". */
    label: string | null;
    requirementType: RescueRequirementType;
    /** Required amount in the requirement's unit (sessions / days / steps). */
    sessionsRequired: number;
    sessionsDone: number;
    expiresAt: string;
}

/** How long the celebratory 'saved' state stays visible after completion. */
export const SAVED_VISIBLE_MS = 24 * 3600_000;

/**
 * Pure state derivation from a streak_rescues row — extracted so the
 * offered/saved/expired boundaries are unit-testable without Supabase.
 * Returns null when nothing should be surfaced.
 */
export function deriveRescueOffer(
    row: {
        id: string;
        status: string;
        lost_streak: number;
        missed_day?: string | null;
        label?: string | null;
        requirement_type?: string | null;
        sessions_required: number;
        sessions_done: number;
        expires_at: string;
        completed_at?: string | null;
    } | null,
    nowMs: number,
): StreakRescueOffer | null {
    if (!row) return null;

    const isLiveOffer = row.status === 'offered' && new Date(row.expires_at).getTime() > nowMs;
    const isFreshSave = row.status === 'completed' && !!row.completed_at
        && nowMs - new Date(row.completed_at).getTime() < SAVED_VISIBLE_MS;
    if (!isLiveOffer && !isFreshSave) return null;

    return {
        id: row.id,
        state: isLiveOffer ? 'offered' : 'saved',
        lostStreak: row.lost_streak,
        missedDay: String(row.missed_day ?? '').slice(0, 10),
        label: row.label ?? null,
        requirementType: (row.requirement_type ?? 'sessions') as RescueRequirementType,
        sessionsRequired: row.sessions_required,
        sessionsDone: row.sessions_done,
        expiresAt: row.expires_at,
    };
}

/**
 * Mon–Sun index of the rescue's missed day when it falls inside the current
 * week strip; null otherwise (the strip only shows this week). Pure for tests.
 */
export function rescueDayIndexFor(
    missedDay: string | null | undefined,
    todayIndex: number,
    now: Date = new Date(),
): number | null {
    if (!missedDay) return null;
    const missed = new Date(`${missedDay}T12:00:00`);
    if (Number.isNaN(missed.getTime())) return null;
    const monday = new Date(now);
    monday.setDate(now.getDate() - todayIndex);
    monday.setHours(0, 0, 0, 0);
    const idx = Math.floor((missed.getTime() - monday.getTime()) / 86400000);
    return idx >= 0 && idx <= 6 ? idx : null;
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

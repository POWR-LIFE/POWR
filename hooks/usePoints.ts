import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchPointsSummary } from '@/lib/api/points';
import { onSessionCompleted } from '@/context/GeofenceContext';

type PointsState = {
    balance: number;
    todayEarned: number;
    totalEarned: number;
    weeklyEarned: number;
    vaultPending: number;
    vaultNextVestAt: string | null;
    loading: boolean;
    error: string | null;
    refresh: () => void;
};

/**
 * Points aggregates, shared app-wide through the query cache: every consumer
 * reads the same entry, so mounting a new screen renders instantly from cache
 * and only refetches once the data is stale.
 */
export function usePoints(): PointsState {
    const queryClient = useQueryClient();
    const { data, isPending, error, refetch } = useQuery({
        queryKey: ['points', 'summary'],
        queryFn: fetchPointsSummary,
    });

    // Refresh whenever a foreground geofence session is claimed
    useEffect(
        () => onSessionCompleted(() => {
            queryClient.invalidateQueries({ queryKey: ['points'] });
        }),
        [queryClient],
    );

    return {
        balance: data?.balance ?? 0,
        todayEarned: data?.todayEarned ?? 0,
        totalEarned: data?.totalEarned ?? 0,
        weeklyEarned: data?.weeklyEarned ?? 0,
        vaultPending: data?.vaultPending ?? 0,
        vaultNextVestAt: data?.vaultNextVestAt ?? null,
        loading: isPending,
        error: error ? (error instanceof Error ? error.message : 'Failed to load points') : null,
        // Returns the refetch promise so pull-to-refresh can await completion.
        refresh: () => refetch(),
    };
}

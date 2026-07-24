import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { fetchPointsSummary } from '@/lib/api/points';
import { onSessionCompleted } from '@/context/GeofenceContext';
import { onPointsChanged } from '@/lib/pointsEvents';

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

    // Refresh when points may have changed outside the geofence path — a
    // foreground push (level_up / reward_unlocked / session receipt) or a
    // foreground health-sync earn. Without this the ['points'] cache only
    // refreshed on a geofence claim, so a server-driven "You leveled up" push
    // could arrive while the home readout still showed the cached "X pts to go".
    useEffect(
        () => onPointsChanged(() => {
            queryClient.invalidateQueries({ queryKey: ['points'] });
        }),
        [queryClient],
    );

    // Safety net: refetch on foreground so points that changed while the app was
    // backgrounded (a background health sync, a push received while away) are
    // reconciled the moment the user returns, not on the next manual refresh.
    useEffect(() => {
        const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
            if (next === 'active') {
                queryClient.invalidateQueries({ queryKey: ['points'] });
            }
        });
        return () => sub.remove();
    }, [queryClient]);

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

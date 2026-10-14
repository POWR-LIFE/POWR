import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
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

// The refresh triggers are app-wide events, so they are subscribed ONCE no
// matter how many usePoints() consumers are mounted (the four tabs, level-up,
// achievements, league preview… ~8 once the tabs have been visited). Subscribed
// per consumer, one trigger fired one invalidate each, and every invalidate
// cancels the in-flight refetch and starts another: 5–6 identical
// get_my_points_summary calls within milliseconds (Sentry, 2026-10-14).
let triggerConsumers = 0;
let stopTriggers: (() => void) | null = null;

function retainRefreshTriggers(queryClient: QueryClient): () => void {
    triggerConsumers += 1;
    if (triggerConsumers === 1) {
        const invalidate = () => {
            queryClient.invalidateQueries({ queryKey: ['points'] });
        };

        // Refresh whenever a foreground geofence session is claimed
        const offSession = onSessionCompleted(invalidate);

        // Refresh when points may have changed outside the geofence path — a
        // foreground push (level_up / reward_unlocked / session receipt) or a
        // foreground health-sync earn. Without this the ['points'] cache only
        // refreshed on a geofence claim, so a server-driven "You leveled up" push
        // could arrive while the home readout still showed the cached "X pts to go".
        const offPoints = onPointsChanged(invalidate);

        // Safety net: refetch on foreground so points that changed while the app was
        // backgrounded (a background health sync, a push received while away) are
        // reconciled the moment the user returns, not on the next manual refresh.
        const appState = AppState.addEventListener('change', (next: AppStateStatus) => {
            if (next === 'active') invalidate();
        });

        stopTriggers = () => {
            offSession();
            offPoints();
            appState.remove();
        };
    }
    return () => {
        triggerConsumers -= 1;
        if (triggerConsumers === 0) {
            stopTriggers?.();
            stopTriggers = null;
        }
    };
}

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

    useEffect(() => retainRefreshTriggers(queryClient), [queryClient]);

    // Stable identity: callers put this in useFocusEffect / useEffect deps.
    // A fresh closure per render made the Rewards tab re-run its focus effect
    // on every render (refetch -> setState -> render -> new refresh -> ...),
    // hammering Supabase at ~13 req/s while the tab was open.
    // Returns the refetch promise so pull-to-refresh can await completion.
    const refresh = useCallback(() => refetch(), [refetch]);

    return {
        balance: data?.balance ?? 0,
        todayEarned: data?.todayEarned ?? 0,
        totalEarned: data?.totalEarned ?? 0,
        weeklyEarned: data?.weeklyEarned ?? 0,
        vaultPending: data?.vaultPending ?? 0,
        vaultNextVestAt: data?.vaultNextVestAt ?? null,
        loading: isPending,
        error: error ? (error instanceof Error ? error.message : 'Failed to load points') : null,
        refresh,
    };
}

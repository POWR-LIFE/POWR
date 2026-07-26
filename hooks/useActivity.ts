import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
    fetchDailyMetrics,
    fetchRecentSessions,
    fetchWeekActiveDays,
    fetchWeeklyMetrics,
    type ActivitySession,
    type DailyMetrics,
    type WeeklyMetrics,
} from '@/lib/api/activity';
import { type ActivityFeedItem } from '@/components/home/ActivityFeed';
import { ACTIVITIES } from '@/constants/activities';
import { useActivityRevision } from '@/hooks/useActivityRevision';
import { formatRawActivityName } from '@/lib/rawActivityName';

function formatDetail(session: ActivitySession): string {
    if (session.distance_m && session.distance_m > 0) {
        const km = session.distance_m / 1000;
        return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(session.distance_m)} m`;
    }
    const mins = Math.round(session.duration_sec / 60);
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m`.replace(' 0m', '') : `${mins}m`;
}

function formatSteps(steps: number): string {
    return steps >= 1000 ? `${(steps / 1000).toFixed(1)}k steps` : `${steps} steps`;
}

function sessionToFeedItem(session: ActivitySession): ActivityFeedItem | null {
    if (!(session.type in ACTIVITIES)) return null;
    const pointsEarned = (session.point_transactions ?? []).reduce((sum, t) => sum + t.amount, 0);
    const detail = session.type === 'walking' && session.steps && session.steps > 0
        ? formatSteps(session.steps)
        : undefined;
    return {
        type: session.type as any,
        pointsEarned,
        durationMinutes: Math.round(session.duration_sec / 60),
        detail,
        timestamp: session.started_at,
        verified: session.verification !== 'manual',
        rawName: formatRawActivityName(session.raw_activity_name, session.type) ?? undefined,
    };
}

type ActivityState = {
    recentItems: ActivityFeedItem[];
    weekActiveDays: boolean[];
    weeklyMetrics: WeeklyMetrics;
    dailyMetrics: DailyMetrics;
    loading: boolean;
    error: string | null;
    refresh: () => void;
};

const DEFAULT_METRICS: WeeklyMetrics = { gymVisits: 0, runs: 0, totalSteps: 0, sessionCount: 0, perType: {}, activeDaysPerType: {}, pointsPerType: {} };
const DEFAULT_DAILY: DailyMetrics = { perType: {}, stepsToday: 0 };

export function useActivity(): ActivityState {
    const queryClient = useQueryClient();
    const revision = useActivityRevision();

    // Nothing invalidated ['activity'] anywhere in the app, and this query sets
    // no refetchInterval — so a claim landing while Progress was open moved the
    // points total and left the week rings, per-type counts and pointsPerType on
    // their pre-claim values indefinitely. staleTime expiry alone never triggers
    // a refetch; only mount, focus, or an explicit invalidate does.
    //
    // Compared against the revision seen at mount, so remounting a screen
    // (Home <-> Progress) doesn't fire a redundant invalidate on every visit.
    const seenRevision = useRef(revision);
    useEffect(() => {
        if (revision === seenRevision.current) return;
        seenRevision.current = revision;
        queryClient.invalidateQueries({ queryKey: ['activity'] });
    }, [revision, queryClient]);

    const { data, isPending, error, refetch } = useQuery({
        queryKey: ['activity', 'overview'],
        queryFn: async () => {
            const [sessions, activeDays, metrics, daily] = await Promise.all([
                fetchRecentSessions(5),
                fetchWeekActiveDays(),
                fetchWeeklyMetrics(),
                fetchDailyMetrics(),
            ]);
            return {
                recentItems: sessions.map(sessionToFeedItem).filter(Boolean) as ActivityFeedItem[],
                weekActiveDays: activeDays,
                weeklyMetrics: metrics,
                dailyMetrics: daily,
            };
        },
    });

    return {
        recentItems: data?.recentItems ?? [],
        weekActiveDays: data?.weekActiveDays ?? [false, false, false, false, false, false, false],
        weeklyMetrics: data?.weeklyMetrics ?? DEFAULT_METRICS,
        dailyMetrics: data?.dailyMetrics ?? DEFAULT_DAILY,
        loading: isPending,
        error: error ? (error instanceof Error ? error.message : 'Failed to load activity') : null,
        // Returns the refetch promise so pull-to-refresh can await completion.
        refresh: () => refetch(),
    };
}

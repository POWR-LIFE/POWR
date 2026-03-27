import { useCallback, useEffect, useState } from 'react';
import {
    fetchRecentSessions,
    fetchWeekActiveDays,
    fetchWeeklyMetrics,
    type ActivitySession,
    type WeeklyMetrics,
} from '@/lib/api/activity';
import { type ActivityGridItem } from '@/components/home/ActivityGrid';
import { ACTIVITIES } from '@/constants/activities';

function formatDetail(session: ActivitySession): string {
    if (session.distance_m && session.distance_m > 0) {
        const km = session.distance_m / 1000;
        return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(session.distance_m)} m`;
    }
    const mins = Math.round(session.duration_sec / 60);
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m`.replace(' 0m', '') : `${mins}m`;
}

function sessionToGridItem(session: ActivitySession): ActivityGridItem | null {
    if (!(session.type in ACTIVITIES)) return null;
    const pointsEarned = (session.point_transactions ?? []).reduce((sum, t) => sum + t.amount, 0);
    return {
        type: session.type as any,
        pointsEarned,
        detail: formatDetail(session),
    };
}

type ActivityState = {
    recentItems: ActivityGridItem[];
    weekActiveDays: boolean[];
    weeklyMetrics: WeeklyMetrics;
    loading: boolean;
    error: string | null;
    refresh: () => void;
};

const DEFAULT_METRICS: WeeklyMetrics = { gymVisits: 0, runs: 0, totalSteps: 0, sessionCount: 0 };

export function useActivity(): ActivityState {
    const [recentItems, setRecentItems] = useState<ActivityGridItem[]>([]);
    const [weekActiveDays, setWeekActiveDays] = useState<boolean[]>([false, false, false, false, false, false, false]);
    const [weeklyMetrics, setWeeklyMetrics] = useState<WeeklyMetrics>(DEFAULT_METRICS);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [sessions, activeDays, metrics] = await Promise.all([
                fetchRecentSessions(5),
                fetchWeekActiveDays(),
                fetchWeeklyMetrics(),
            ]);
            setRecentItems(sessions.map(sessionToGridItem).filter(Boolean) as ActivityGridItem[]);
            setWeekActiveDays(activeDays);
            setWeeklyMetrics(metrics);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load activity');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return { recentItems, weekActiveDays, weeklyMetrics, loading, error, refresh: load };
}

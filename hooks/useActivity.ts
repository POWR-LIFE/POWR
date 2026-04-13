import { useCallback, useEffect, useState } from 'react';
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

const DEFAULT_METRICS: WeeklyMetrics = { gymVisits: 0, runs: 0, totalSteps: 0, sessionCount: 0, perType: {} };
const DEFAULT_DAILY: DailyMetrics = { pointsByType: {}, stepsToday: 0 };

export function useActivity(): ActivityState {
    const [recentItems, setRecentItems] = useState<ActivityFeedItem[]>([]);
    const [weekActiveDays, setWeekActiveDays] = useState<boolean[]>([false, false, false, false, false, false, false]);
    const [weeklyMetrics, setWeeklyMetrics] = useState<WeeklyMetrics>(DEFAULT_METRICS);
    const [dailyMetrics, setDailyMetrics] = useState<DailyMetrics>(DEFAULT_DAILY);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [sessions, activeDays, metrics, daily] = await Promise.all([
                fetchRecentSessions(5),
                fetchWeekActiveDays(),
                fetchWeeklyMetrics(),
                fetchDailyMetrics(),
            ]);
            setRecentItems(sessions.map(sessionToFeedItem).filter(Boolean) as ActivityFeedItem[]);
            setWeekActiveDays(activeDays);
            setWeeklyMetrics(metrics);
            setDailyMetrics(daily);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load activity');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return { recentItems, weekActiveDays, weeklyMetrics, dailyMetrics, loading, error, refresh: load };
}

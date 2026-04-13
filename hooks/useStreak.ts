import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type StreakState = {
    currentStreak: number;
    longestStreak: number;
    multiplier: number;
    loading: boolean;
    refresh: () => void;
};

/** Mirrors the gym streak multiplier table from POWR_Points_Logic.md */
function streakMultiplier(streak: number): number {
    if (streak >= 10) return 3.0;
    if (streak >= 7)  return 2.0;
    if (streak >= 5)  return 1.5;
    if (streak >= 3)  return 1.2;
    return 1.0;
}

/**
 * Compute the current streak by counting consecutive distinct activity days
 * backward from today, using the activity_sessions table directly.
 */
async function computeStreakFromSessions(): Promise<{ current: number; longest: number }> {
    // Fetch distinct activity dates in descending order (last 90 days is plenty)
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at')
        .neq('verification', 'manual')
        .gte('started_at', since.toISOString())
        .order('started_at', { ascending: false });

    if (error || !data?.length) return { current: 0, longest: 0 };

    // Build a sorted set of unique date strings (YYYY-MM-DD, local time)
    const uniqueDays = [...new Set(
        data.map(s => {
            const d = new Date(s.started_at);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })
    )].sort().reverse(); // most recent first

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    // Streak must start from today or yesterday
    if (uniqueDays[0] !== todayStr && uniqueDays[0] !== yesterdayStr) {
        return { current: 0, longest: longestRun(uniqueDays) };
    }

    // Count consecutive days backward
    let streak = 1;
    for (let i = 1; i < uniqueDays.length; i++) {
        const prev = new Date(uniqueDays[i - 1] + 'T00:00:00');
        const curr = new Date(uniqueDays[i] + 'T00:00:00');
        const diffMs = prev.getTime() - curr.getTime();
        if (diffMs === 86400000) { // exactly 1 day apart
            streak++;
        } else {
            break;
        }
    }

    return { current: streak, longest: Math.max(streak, longestRun(uniqueDays)) };
}

/** Find the longest consecutive-day run in a descending sorted array of date strings */
function longestRun(days: string[]): number {
    if (!days.length) return 0;
    let best = 1;
    let run = 1;
    for (let i = 1; i < days.length; i++) {
        const prev = new Date(days[i - 1] + 'T00:00:00');
        const curr = new Date(days[i] + 'T00:00:00');
        if (prev.getTime() - curr.getTime() === 86400000) {
            run++;
            if (run > best) best = run;
        } else {
            run = 1;
        }
    }
    return best;
}

export function useStreak(): StreakState {
    const [currentStreak, setCurrentStreak] = useState(0);
    const [longestStreak, setLongestStreak] = useState(0);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        const { current, longest } = await computeStreakFromSessions();
        setCurrentStreak(current);
        setLongestStreak(longest);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    return {
        currentStreak,
        longestStreak,
        multiplier: streakMultiplier(currentStreak),
        loading,
        refresh: load,
    };
}

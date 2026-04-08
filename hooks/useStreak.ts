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

export function useStreak(): StreakState {
    const [currentStreak, setCurrentStreak] = useState(0);
    const [longestStreak, setLongestStreak] = useState(0);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase
            .from('user_streaks')
            .select('current_streak, longest_streak, last_activity_date')
            .single();
        if (data) {
            // Check if the streak is still alive: last activity must be today or yesterday
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            const todayStr = today.toISOString().split('T')[0];
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            const lastDate = data.last_activity_date; // YYYY-MM-DD or null

            const streakAlive = lastDate === todayStr || lastDate === yesterdayStr;

            setCurrentStreak(streakAlive ? data.current_streak : 0);
            setLongestStreak(data.longest_streak);
        }
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

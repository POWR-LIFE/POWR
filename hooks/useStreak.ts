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
            .select('current_streak, longest_streak')
            .single();
        if (data) {
            setCurrentStreak(data.current_streak);
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

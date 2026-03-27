import { useCallback, useEffect, useState } from 'react';
import { fetchBalance, fetchTodayEarned, fetchTotalEarned, fetchWeeklyEarned } from '@/lib/api/points';

type PointsState = {
    balance: number;
    todayEarned: number;
    totalEarned: number;
    weeklyEarned: number;
    loading: boolean;
    error: string | null;
    refresh: () => void;
};

export function usePoints(): PointsState {
    const [balance, setBalance] = useState(0);
    const [todayEarned, setTodayEarned] = useState(0);
    const [totalEarned, setTotalEarned] = useState(0);
    const [weeklyEarned, setWeeklyEarned] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [bal, today, total, weekly] = await Promise.all([
                fetchBalance(),
                fetchTodayEarned(),
                fetchTotalEarned(),
                fetchWeeklyEarned(),
            ]);
            setBalance(bal);
            setTodayEarned(today);
            setTotalEarned(total);
            setWeeklyEarned(weekly);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load points');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return { balance, todayEarned, totalEarned, weeklyEarned, loading, error, refresh: load };
}

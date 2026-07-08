import { useQuery } from '@tanstack/react-query';

import {
  ACHIEVEMENTS,
  computeEarnedIds,
  sortedAchievements,
  type AchievementStats,
  type AchievementWithState,
} from '@/constants/achievements';
import { fetchAchievementStats } from '@/lib/api/achievement-stats';
import { getLevelInfo } from '@/constants/levels';

type AchievementsState = {
  all: AchievementWithState[];
  earned: AchievementWithState[];
  locked: AchievementWithState[];
  earnedCount: number;
  totalCount: number;
  loading: boolean;
  refresh: () => void;
};

/**
 * Fetches lifetime achievement stats and returns all achievements with
 * their earned state resolved. Accepts totalPoints from usePoints() since
 * that hook already has it.
 */
export function useAchievements(totalPoints: number): AchievementsState {
  const { data, isPending, refetch } = useQuery({
    queryKey: ['achievements', totalPoints],
    queryFn: async (): Promise<AchievementWithState[]> => {
      try {
        const { current: levelInfo } = getLevelInfo(totalPoints);
        const stats = await fetchAchievementStats(levelInfo.level);
        // Inject totalPoints (already available client-side)
        const fullStats: AchievementStats = { ...stats, totalPoints };
        const earnedIds = computeEarnedIds(fullStats);
        return sortedAchievements(earnedIds);
      } catch {
        // Degrade gracefully — show all as locked
        return ACHIEVEMENTS.map(a => ({ ...a, earned: false }));
      }
    },
  });

  const all = data ?? [];
  const earned = all.filter(a => a.earned);
  const locked = all.filter(a => !a.earned);

  return {
    all,
    earned,
    locked,
    earnedCount: earned.length,
    totalCount: ACHIEVEMENTS.length,
    loading: isPending,
    refresh: () => { void refetch(); },
  };
}

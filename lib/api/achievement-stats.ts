import { supabase } from '@/lib/supabase';
import type { AchievementStats } from '@/constants/achievements';

/**
 * Fetches all lifetime stats needed to evaluate which achievements are earned.
 * Single query per data type, all run in parallel.
 */
export async function fetchAchievementStats(level: number): Promise<AchievementStats> {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) {
    return emptyStats(level);
  }

  const [sessionsRes, streakRes, stepsRes] = await Promise.all([
    // All sessions grouped by type for counts + running distance aggregates
    supabase
      .from('activity_sessions')
      .select('type, distance_m, steps')
      .eq('user_id', userId),

    // Stored streak values
    supabase
      .from('user_streaks')
      .select('current_streak, longest_streak')
      .eq('user_id', userId)
      .maybeSingle(),

    // Walking sessions for step totals (walking type only)
    supabase
      .from('activity_sessions')
      .select('steps, started_at')
      .eq('user_id', userId)
      .eq('type', 'walking')
      .not('steps', 'is', null),
  ]);

  const sessions = (sessionsRes.data ?? []) as {
    type: string;
    distance_m: number | null;
    steps: number | null;
  }[];

  // Sessions per type
  const sessionsPerType: Record<string, number> = {};
  let totalSessions = 0;

  // Running distance
  let totalRunDistanceKm = 0;
  let maxSingleRunKm = 0;

  for (const s of sessions) {
    sessionsPerType[s.type] = (sessionsPerType[s.type] ?? 0) + 1;
    totalSessions++;

    if (s.type === 'running' && s.distance_m) {
      const km = s.distance_m / 1000;
      totalRunDistanceKm += km;
      if (km > maxSingleRunKm) maxSingleRunKm = km;
    }
  }

  // Step totals from walking sessions
  const walkingSessions = (stepsRes.data ?? []) as { steps: number | null; started_at: string }[];
  let totalSteps = 0;
  const stepsByDay: Record<string, number> = {};

  for (const s of walkingSessions) {
    if (!s.steps) continue;
    totalSteps += s.steps;
    const day = s.started_at.slice(0, 10);
    stepsByDay[day] = (stepsByDay[day] ?? 0) + s.steps;
  }

  const maxSingleDaySteps = Math.max(0, ...Object.values(stepsByDay));

  return {
    totalPoints: 0, // caller injects from usePoints
    currentStreak: streakRes.data?.current_streak ?? 0,
    longestStreak: streakRes.data?.longest_streak ?? 0,
    level,
    totalSessions,
    sessionsPerType,
    totalRunDistanceKm,
    maxSingleRunKm,
    totalSteps,
    maxSingleDaySteps,
  };
}

function emptyStats(level: number): AchievementStats {
  return {
    totalPoints: 0,
    currentStreak: 0,
    longestStreak: 0,
    level,
    totalSessions: 0,
    sessionsPerType: {},
    totalRunDistanceKm: 0,
    maxSingleRunKm: 0,
    totalSteps: 0,
    maxSingleDaySteps: 0,
  };
}

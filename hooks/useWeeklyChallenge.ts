import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  ACTIVE_WEEKLY_CHALLENGE,
  getActiveWeeklyChallenge,
  getTargetActivityType,
  parseWeeklyChallengesConfig,
} from '@/shared/weeklyChallenges';

export type ChallengeCompletion = {
  pointsAwarded: number;
  completedAt: string;
  activityType: string;
};

export type WeeklyChallengeState = {
  challenge: typeof ACTIVE_WEEKLY_CHALLENGE;
  targetActivityType: string | null;
  completion: ChallengeCompletion | null;
};

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

function getMondayUTC(): string {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - (day - 1));
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString();
}

export function useWeeklyChallenge(userPreferences: string[]): WeeklyChallengeState {
  const [state, setState] = useState<WeeklyChallengeState>({
    challenge: ACTIVE_WEEKLY_CHALLENGE,
    targetActivityType: null,
    completion: null,
  });

  const completing = useRef(false);

  const load = useCallback(async () => {
    // 1. Load challenge config from system_config, fall back to bundled
    let activeChallenge = ACTIVE_WEEKLY_CHALLENGE;
    try {
      const { data } = await supabase
        .from('system_config')
        .select('value')
        .eq('key', 'weekly_challenges')
        .maybeSingle();
      if (data?.value) {
        activeChallenge = getActiveWeeklyChallenge(parseWeeklyChallengesConfig(data.value));
      }
    } catch {
      // silently fall back to bundled
    }

    // 2. Pick the user's highest-scoring qualifying activity
    const targetActivityType = getTargetActivityType(activeChallenge, userPreferences);

    // 3. Check for existing completion this week
    const challengeWeek = getISOWeek(new Date());
    const { data: existing } = await supabase
      .from('user_challenge_completions')
      .select('points_awarded, completed_at, activity_type')
      .eq('challenge_id', activeChallenge.id)
      .eq('challenge_week', challengeWeek)
      .maybeSingle();

    if (existing) {
      setState({
        challenge: activeChallenge,
        targetActivityType,
        completion: {
          pointsAwarded: existing.points_awarded,
          completedAt: existing.completed_at,
          activityType: existing.activity_type,
        },
      });
      return;
    }

    setState({ challenge: activeChallenge, targetActivityType, completion: null });

    // 4. Check for a qualifying session this week that started before 12pm local
    if (!targetActivityType) return;

    const utcOffsetMinutes = -new Date().getTimezoneOffset();
    const weekStart = getMondayUTC();

    const { data: sessions } = await supabase
      .from('activity_sessions')
      .select('id, started_at')
      .eq('type', targetActivityType)
      .gte('started_at', weekStart)
      .order('started_at', { ascending: true });

    if (!sessions?.length) return;

    const qualifying = sessions.find((s) => {
      const localMs = new Date(s.started_at).getTime() + utcOffsetMinutes * 60 * 1000;
      return new Date(localMs).getUTCHours() < 12;
    });

    if (!qualifying || completing.current) return;

    // 5. Attempt completion via edge function
    completing.current = true;
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) return;

      const { data: result, error } = await supabase.functions.invoke('complete-weekly-challenge', {
        body: {
          challenge_id: activeChallenge.id,
          session_id: qualifying.id,
          utc_offset_minutes: utcOffsetMinutes,
        },
        headers: { Authorization: `Bearer ${authSession.access_token}` },
      });

      if (!error && result?.ok) {
        setState(prev => ({
          ...prev,
          completion: {
            pointsAwarded: result.points_awarded ?? 0,
            completedAt: new Date().toISOString(),
            activityType: result.activity_type ?? targetActivityType,
          },
        }));
      }
    } catch (e) {
      console.warn('[useWeeklyChallenge] completion failed:', e);
    } finally {
      completing.current = false;
    }
  }, [userPreferences]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  return state;
}

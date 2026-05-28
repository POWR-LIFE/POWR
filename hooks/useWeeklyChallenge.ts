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
  sessionsCompleted: number;
};

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

/**
 * Returns the start of the current week (Monday 00:00) in the user's local
 * timezone, expressed as a UTC ISO string. This ensures sessions logged on
 * Monday morning in UTC+ zones are not missed because their UTC timestamp
 * still falls on Sunday.
 */
function getLocalMondayAsUTC(utcOffsetMinutes: number): string {
  const localNowMs = Date.now() + utcOffsetMinutes * 60 * 1000;
  const localNow = new Date(localNowMs);
  const day = localNow.getUTCDay() || 7; // 1=Mon … 7=Sun
  // Rewind to local midnight of Monday
  const mondayLocalMs = localNowMs - (day - 1) * 24 * 60 * 60 * 1000;
  const mondayLocal = new Date(mondayLocalMs);
  mondayLocal.setUTCHours(0, 0, 0, 0);
  // Translate back to real UTC
  return new Date(mondayLocal.getTime() - utcOffsetMinutes * 60 * 1000).toISOString();
}

export function useWeeklyChallenge(userPreferences: string[]): WeeklyChallengeState {
  const [state, setState] = useState<WeeklyChallengeState>({
    challenge: ACTIVE_WEEKLY_CHALLENGE,
    targetActivityType: null,
    completion: null,
    sessionsCompleted: 0,
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

    // 3. Check for existing completion this week.
    // Use the user's LOCAL date (mirroring the edge function) so the week key
    // matches what was stored — prevents UTC+ users from missing their record
    // when their local Monday morning is still Sunday in UTC.
    const utcOffsetMinutes = -new Date().getTimezoneOffset();
    const localNow = new Date(Date.now() + utcOffsetMinutes * 60 * 1000);
    const challengeWeek = getISOWeek(localNow);
    const { data: existing } = await supabase
      .from('user_challenge_completions')
      .select('points_awarded, completed_at, activity_type')
      .eq('challenge_id', activeChallenge.id)
      .eq('challenge_week', challengeWeek)
      .maybeSingle();

    const requiredSessions = activeChallenge.requiredSessions ?? 1;

    if (existing) {
      setState({
        challenge: activeChallenge,
        targetActivityType,
        completion: {
          pointsAwarded: existing.points_awarded,
          completedAt: existing.completed_at,
          activityType: existing.activity_type,
        },
        sessionsCompleted: requiredSessions,
      });
      return;
    }

    setState(prev => ({ ...prev, challenge: activeChallenge, targetActivityType, completion: null }));

    // 4. Check for a qualifying session this week that started before the challenge's
    // time limit (startBeforeHour). Query ALL qualifying types — not just the user's
    // top-priority one — so any eligible session triggers completion.
    const qualifyingTypes = activeChallenge.qualifyingTypes ?? [];
    const startBeforeHour: number | null = activeChallenge.startBeforeHour ?? null;
    if (!qualifyingTypes.length) {
      setState(prev => ({ ...prev, sessionsCompleted: 0 }));
      return;
    }

    // weekStart is Monday 00:00 in the user's LOCAL timezone (as a UTC string)
    // so UTC+ users' early-morning Monday sessions are included in the query.
    const weekStart = getLocalMondayAsUTC(utcOffsetMinutes);

    const { data: sessions } = await supabase
      .from('activity_sessions')
      .select('id, started_at')
      .in('type', qualifyingTypes)
      .gte('started_at', weekStart)
      .order('started_at', { ascending: true });

    // Count all qualifying sessions up to requiredSessions, applying time-of-day
    // restriction only when the challenge specifies one.
    const qualifyingSessions = (sessions ?? []).filter((s) => {
      if (startBeforeHour === null) return true;
      const localMs = new Date(s.started_at).getTime() + utcOffsetMinutes * 60 * 1000;
      return new Date(localMs).getUTCHours() < startBeforeHour;
    });

    const sessionsCount = Math.min(qualifyingSessions.length, requiredSessions);
    setState(prev => ({ ...prev, sessionsCompleted: sessionsCount }));

    // 5. Attempt full completion via edge function once all sessions are done
    if (qualifyingSessions.length < requiredSessions || completing.current) return;

    const triggerSession = qualifyingSessions[requiredSessions - 1];
    completing.current = true;
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) return;

      const { data: result, error } = await supabase.functions.invoke('complete-weekly-challenge', {
        body: {
          challenge_id: activeChallenge.id,
          session_id: triggerSession.id,
          utc_offset_minutes: utcOffsetMinutes,
          start_before_hour: startBeforeHour,
        },
        headers: { Authorization: `Bearer ${authSession.access_token}` },
      });

      if (!error && result?.ok) {
        setState(prev => ({
          ...prev,
          sessionsCompleted: requiredSessions,
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

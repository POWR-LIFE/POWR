import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
// challengeRules.js is CommonJS — import the namespace for interop.
import { buildContext, evaluateChallenge } from '@/shared/challengeRules';
import {
  CATALOG,
  CATEGORY_META,
  getActiveChallengesForWeek,
  getISOWeek,
  nextSundayMidnight,
  parseChallengeCatalog,
  computeExpiresIn,
} from '@/shared/weeklyChallenges';

export interface ChallengeCardData {
  id: string;
  category: string;
  categoryLabel: string;
  icon: { lib: 'ion' | 'mc'; name: string };
  tier: 'easy' | 'medium' | 'hard';
  title: string;
  description: string;
  points: number;
  /** 0–1 bar fill. */
  fraction: number;
  /** Human display values, e.g. 2 / 3 check-ins, 35,000 / 70,000 steps, 12 / 20 km. */
  displayValue: number;
  displayGoal: number;
  unit: string;
  /** Show the per-step dot row (only for small count/day goals). */
  showDots: boolean;
  /** Completed (recorded in user_challenge_completions) this week. */
  completed: boolean;
  expiresIn: string;
  /** Mon–Sun, true where a qualifying session happened. */
  streak: boolean[];
  todayIndex: number;
  /** Short celebratory subtitle shown on completion. */
  completeSubtitle: string;
}

/** Per-category noun for count-based goals. */
const COUNT_NOUN: Record<string, string> = {
  gym: 'check-ins', running: 'runs', cycling: 'rides', walking: 'sessions', multi: 'sessions',
};

/** Derive display value/goal/unit + dot visibility from a rule + raw progress. */
function formatProgress(rule: any, category: string, progress: number, target: number) {
  const fraction = target > 0 ? Math.min(progress / target, 1) : 0;
  switch (rule.kind) {
    case 'weekly_sum':
    case 'weekend_sum':
      if (rule.metric === 'steps') {
        return { fraction, displayValue: progress, displayGoal: target, unit: 'steps', showDots: false };
      }
      return { fraction, displayValue: Math.round(progress / 1000), displayGoal: Math.round(target / 1000), unit: 'km', showDots: false };
    case 'daily_metric_days':
    case 'distinct_days':
    case 'spaced_days':
    case 'step_window':
      return { fraction, displayValue: progress, displayGoal: target, unit: 'days', showDots: target <= 7 };
    case 'distinct_categories':
      return { fraction, displayValue: progress, displayGoal: target, unit: 'categories', showDots: true };
    case 'same_day_combo':
      return { fraction, displayValue: progress, displayGoal: target, unit: 'days', showDots: true };
    default:
      return { fraction, displayValue: progress, displayGoal: target, unit: COUNT_NOUN[category] ?? 'sessions', showDots: target <= 7 };
  }
}

export interface WeeklyChallengesState {
  challenges: ChallengeCardData[];
  loading: boolean;
  /** Set to the challenge id that was just awarded this load (drives the celebration). */
  newlyCompletedId: string | null;
}

/** Local Monday 00:00 (user tz) as a UTC ISO string — matches the edge function. */
function localMondayAsUTC(utcOffsetMinutes: number): string {
  const localMs = Date.now() + utcOffsetMinutes * 60 * 1000;
  const day = new Date(localMs).getUTCDay() || 7;
  const mondayLocal = new Date(localMs - (day - 1) * 86400000);
  mondayLocal.setUTCHours(0, 0, 0, 0);
  return new Date(mondayLocal.getTime() - utcOffsetMinutes * 60 * 1000).toISOString();
}

/** Mon–Sun activity flags for a category (null = any category). */
function streakFor(sessions: any[], category: string | null): boolean[] {
  const days = [false, false, false, false, false, false, false];
  for (const s of sessions) {
    if (category && s.category !== category) continue;
    days[s.dow] = true;
  }
  return days;
}

export function useWeeklyChallenges(): WeeklyChallengesState {
  const [state, setState] = useState<WeeklyChallengesState>({
    challenges: [],
    loading: true,
    newlyCompletedId: null,
  });
  const awarding = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const utcOffsetMinutes = -new Date().getTimezoneOffset();
    const localNow = new Date(Date.now() + utcOffsetMinutes * 60 * 1000);
    const challengeWeek = getISOWeek(localNow);
    const todayIndex = (localNow.getUTCDay() + 6) % 7;
    const expiresIn = computeExpiresIn(nextSundayMidnight());

    // 1. Resolve catalog (system_config override → bundled) and the week's 5 active.
    let catalog = CATALOG;
    try {
      const { data } = await supabase
        .from('system_config')
        .select('value')
        .eq('key', 'weekly_challenges')
        .maybeSingle();
      if (data?.value) catalog = parseChallengeCatalog(data.value);
    } catch {
      /* fall back to bundled */
    }
    const baseActive = getActiveChallengesForWeek(challengeWeek, catalog);

    // Apply per-week category overrides stored in system_config.challenge_week_overrides.
    let active = baseActive;
    try {
      const { data: ovData } = await supabase
        .from('system_config')
        .select('value')
        .eq('key', 'challenge_week_overrides')
        .maybeSingle();
      if (ovData?.value) {
        const allOv: Record<string, Record<string, string>> =
          typeof ovData.value === 'string' ? JSON.parse(ovData.value) : ovData.value;
        const weekOv = allOv[challengeWeek] ?? {};
        if (Object.keys(weekOv).length > 0) {
          active = baseActive.map((c) => {
            const ovId = weekOv[c.category];
            if (ovId) {
              const found = (catalog as any[]).find((x: any) => x.id === ovId);
              if (found) return found;
            }
            return c;
          });
        }
      }
    } catch {
      /* use auto rotation */
    }

    // 2. This week's sessions + step windows (only if a step_window challenge is active).
    const weekStart = localMondayAsUTC(utcOffsetMinutes);
    const { data: sessions } = await supabase
      .from('activity_sessions')
      .select('type, started_at, duration_sec, distance_m, steps, verification')
      .gte('started_at', weekStart)
      .order('started_at', { ascending: true });

    let stepWindowRows: any[] = [];
    if (active.some((c) => c.rule.kind === 'step_window')) {
      const { data: windows } = await supabase
        .from('daily_step_windows')
        .select('date, before_9am, midday_12_14, after_6pm')
        .gte('date', weekStart.slice(0, 10));
      stepWindowRows = windows ?? [];
    }

    const ctx = buildContext(sessions ?? [], utcOffsetMinutes, stepWindowRows);

    // 3. Existing completions this week.
    const { data: completions } = await supabase
      .from('user_challenge_completions')
      .select('challenge_id')
      .eq('challenge_week', challengeWeek);
    const completedIds = new Set((completions ?? []).map((c) => c.challenge_id));

    // 4. Evaluate each active challenge; award any newly met.
    let newlyCompletedId: string | null = null;
    const cards: ChallengeCardData[] = [];

    for (const c of active) {
      const { progress, target, met } = evaluateChallenge(c.rule, ctx);
      let completed = completedIds.has(c.id);

      if (met && !completed && !awarding.current.has(c.id)) {
        awarding.current.add(c.id);
        try {
          const { data: { session: authSession } } = await supabase.auth.getSession();
          if (authSession) {
            const { data: result, error } = await supabase.functions.invoke('complete-weekly-challenge', {
              body: { challenge_id: c.id, utc_offset_minutes: utcOffsetMinutes },
              headers: { Authorization: `Bearer ${authSession.access_token}` },
            });
            if (!error && result?.ok && (result.completed || result.already_completed)) {
              completed = true;
              if (!result.already_completed) newlyCompletedId = c.id;
            }
          }
        } catch (e) {
          console.warn('[useWeeklyChallenges] award failed:', c.id, e);
        } finally {
          awarding.current.delete(c.id);
        }
      }

      const effectiveProgress = completed ? target : progress;
      const metaMap = CATEGORY_META as Record<string, { label: string; icon: { lib: 'ion' | 'mc'; name: string } }>;
      const meta = metaMap[c.category] ?? { label: c.category, icon: { lib: 'ion' as const, name: 'flame' } };
      const fmt = formatProgress(c.rule, c.category, effectiveProgress, target);
      cards.push({
        id: c.id,
        category: c.category,
        categoryLabel: meta.label,
        icon: meta.icon,
        tier: c.tier as ChallengeCardData['tier'],
        title: c.title,
        description: c.description,
        points: c.points,
        ...fmt,
        completed,
        expiresIn,
        streak: streakFor(ctx.sessions, c.category === 'multi' ? null : c.category),
        todayIndex,
        completeSubtitle: c.description,
      });
    }

    setState({ challenges: cards, loading: false, newlyCompletedId });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return state;
}

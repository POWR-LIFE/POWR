import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
// challengeRules.js is CommonJS — import the namespace for interop.
import { buildContext, categoryOf, evaluateChallenge } from '@/shared/challengeRules';
import {
  CATALOG,
  CATEGORY_META,
  getChallengeById,
  getISOWeek,
  getPersonalizedChallengesForWeek,
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
  /** Bar sections for discrete goals (one per unit); unset = continuous bar. */
  segments?: number;
  /** Completed (recorded in user_challenge_completions) this week. */
  completed: boolean;
  expiresIn: string;
  /** Mon–Sun, true where a qualifying session happened in this challenge's category. */
  streak: boolean[];
  /** Mon–Sun, true where any activity (all categories) happened — drives the top day dashes. */
  overallStreak: boolean[];
  todayIndex: number;
  /** Short celebratory subtitle shown on completion. */
  completeSubtitle: string;
}

/** Remembers the last ISO week the previous-week grace sweep ran for. */
const PREV_WEEK_SWEEP_KEY = 'weeklyChallengeSweptWeek';

/** Per-category noun for count-based goals. */
const COUNT_NOUN: Record<string, string> = {
  gym: 'check-ins', running: 'runs', cycling: 'rides', walking: 'sessions', multi: 'sessions',
};

/** Derive display value/goal/unit + dot visibility from a rule + raw progress. */
function formatProgress(rule: any, category: string, progress: number, target: number) {
  const fraction = target > 0 ? Math.min(progress / target, 1) : 0;
  // Every rule kind except the metric sums reports integer counts, so the bar
  // can break into one section per unit. Sums (70k steps, 20 km) stay continuous.
  const segments = target >= 2 && target <= 12 ? target : undefined;
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
      return { fraction, displayValue: progress, displayGoal: target, unit: 'days', showDots: target <= 7, segments };
    case 'distinct_categories':
      return { fraction, displayValue: progress, displayGoal: target, unit: 'categories', showDots: true, segments };
    case 'same_day_combo':
      return { fraction, displayValue: progress, displayGoal: target, unit: 'days', showDots: true, segments };
    default:
      return { fraction, displayValue: progress, displayGoal: target, unit: COUNT_NOUN[category] ?? 'sessions', showDots: target <= 7, segments };
  }
}

export interface WeeklyChallengesState {
  challenges: ChallengeCardData[];
  loading: boolean;
  /** Set to the challenge id that was just awarded this load (drives the celebration). */
  newlyCompletedId: string | null;
}

/** Local Monday 00:00 (user tz) as a UTC ISO string — matches the edge function. */
function localMondayAsUTC(utcOffsetMinutes: number, now: number = Date.now()): string {
  const localMs = now + utcOffsetMinutes * 60 * 1000;
  const day = new Date(localMs).getUTCDay() || 7;
  const mondayLocal = new Date(localMs - (day - 1) * 86400000);
  mondayLocal.setUTCHours(0, 0, 0, 0);
  return new Date(mondayLocal.getTime() - utcOffsetMinutes * 60 * 1000).toISOString();
}

/** Apply per-week category overrides (admin) to a rotation's active set. */
function applyOverrides(list: any[], weekOv: Record<string, string> | undefined, catalog: any[]): any[] {
  if (!weekOv || Object.keys(weekOv).length === 0) return list;
  return list.map((c) => {
    const ovId = weekOv[c.category];
    if (ovId) {
      const found = catalog.find((x: any) => x.id === ovId);
      if (found) return found;
    }
    return c;
  });
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
  const sweptPrevWeek = useRef(false);
  const lastLoadedAt = useRef(0);

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
    // Per-week category overrides stored in system_config.challenge_week_overrides.
    let allOv: Record<string, Record<string, string>> | null = null;
    try {
      const { data: ovData } = await supabase
        .from('system_config')
        .select('value')
        .eq('key', 'challenge_week_overrides')
        .maybeSingle();
      if (ovData?.value) {
        allOv = typeof ovData.value === 'string' ? JSON.parse(ovData.value) : ovData.value;
      }
    } catch {
      /* use auto rotation */
    }

    // 2. This week's sessions + completions — fetched before the active set is
    //    chosen, because both feed personalization.
    const weekStart = localMondayAsUTC(utcOffsetMinutes);
    const [{ data: sessions }, { data: completions }, { data: { session: authSession } }] =
      await Promise.all([
        supabase
          .from('activity_sessions')
          .select('type, started_at, duration_sec, distance_m, steps, verification')
          .gte('started_at', weekStart)
          .order('started_at', { ascending: true }),
        supabase
          .from('user_challenge_completions')
          .select('challenge_id')
          .eq('challenge_week', challengeWeek),
        supabase.auth.getSession(),
      ]);
    const completedIds = new Set((completions ?? []).map((c) => c.challenge_id));

    // 3. The user's week: relevance = onboarding activity buckets ∪ categories
    //    actually logged this week, so stale picks can't hide real behavior and
    //    a mid-week new activity adds its challenge rather than replacing one.
    let buckets: string[] = [];
    if (authSession) {
      try {
        const { data: prof } = await supabase
          .from('profiles')
          .select('activity_preferences')
          .eq('id', authSession.user.id)
          .maybeSingle();
        if (Array.isArray(prof?.activity_preferences)) buckets = prof.activity_preferences;
      } catch {
        /* behavior-only relevance */
      }
    }
    const sessionCats = new Set<string>();
    for (const s of sessions ?? []) {
      if (s.verification === 'manual') continue;
      const cat = categoryOf(s.type);
      if (cat) sessionCats.add(cat);
    }
    let active = applyOverrides(
      getPersonalizedChallengesForWeek(challengeWeek, [...new Set([...buckets, ...sessionCats])], catalog),
      allOv?.[challengeWeek],
      catalog as any[],
    );
    // A per-category override can collapse two same-category picks into one id.
    active = active.filter((c, i) => active.findIndex((x) => x.id === c.id) === i);
    // Anything already completed this week stays on the board as a receipt even
    // if personalization would no longer select it.
    for (const id of completedIds) {
      if (!active.some((c) => c.id === id)) {
        const found = getChallengeById(id, catalog as any[]);
        if (found) active.push(found);
      }
    }

    let stepWindowRows: any[] = [];
    if (active.some((c) => c.rule.kind === 'step_window')) {
      const { data: windows } = await supabase
        .from('daily_step_windows')
        .select('date, before_9am, midday_12_14, after_6pm')
        .gte('date', weekStart.slice(0, 10));
      stepWindowRows = windows ?? [];
    }

    const ctx = buildContext(sessions ?? [], utcOffsetMinutes, stepWindowRows);

    // 4. Evaluate each active challenge; award any newly met.
    let newlyCompletedId: string | null = null;
    const cards: ChallengeCardData[] = [];

    for (const c of active) {
      const { progress, target, met } = evaluateChallenge(c.rule, ctx);
      let completed = completedIds.has(c.id);

      if (met && !completed && !awarding.current.has(c.id)) {
        awarding.current.add(c.id);
        try {
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
        overallStreak: streakFor(ctx.sessions, null),
        todayIndex,
        completeSubtitle: c.description,
      });
    }

    setState({ challenges: cards, loading: false, newlyCompletedId });

    // 5. Grace sweep — retro-award any unclaimed completions from LAST week, once
    //    per week (on the first home load of the new week, any day). Covers a user
    //    who met a challenge but never opened the app before the Monday rollover,
    //    after which last week's sessions fall out of the current window. The
    //    award path is idempotent, so a repeat would be a safe no-op regardless.
    const prevWeek = getISOWeek(new Date(localNow.getTime() - 7 * 86400000));
    if (!sweptPrevWeek.current) {
      sweptPrevWeek.current = true; // at most one sweep per mount
      try {
        const lastSwept = await AsyncStorage.getItem(PREV_WEEK_SWEEP_KEY);
        if (lastSwept !== prevWeek) {
          const { data: prevCompletions, error: pcErr } = await supabase
            .from('user_challenge_completions')
            .select('challenge_id')
            .eq('challenge_week', prevWeek);
          if (pcErr) throw pcErr;
          const prevCompleted = new Set((prevCompletions ?? []).map((c) => c.challenge_id));

          // The personalized set depends on that week's sessions, so they're
          // fetched up front (the sweep runs at most once a week per device).
          const prevWeekStart = localMondayAsUTC(utcOffsetMinutes, Date.now() - 7 * 86400000);
          const prevWeekEnd = weekStart; // this week's Monday — exclusive upper bound
          const { data: prevSessions, error: psErr } = await supabase
            .from('activity_sessions')
            .select('type, started_at, duration_sec, distance_m, steps, verification')
            .gte('started_at', prevWeekStart)
            .lt('started_at', prevWeekEnd)
            .order('started_at', { ascending: true });
          if (psErr) throw psErr;

          const prevCats = new Set<string>();
          for (const s of prevSessions ?? []) {
            if (s.verification === 'manual') continue;
            const cat = categoryOf(s.type);
            if (cat) prevCats.add(cat);
          }
          let prevActive = applyOverrides(
            getPersonalizedChallengesForWeek(prevWeek, [...new Set([...buckets, ...prevCats])], catalog),
            allOv?.[prevWeek],
            catalog as any[],
          );
          prevActive = prevActive.filter((c, i) => prevActive.findIndex((x) => x.id === c.id) === i);

          let anyFailed = false;
          if (prevActive.some((c) => !prevCompleted.has(c.id))) {
            let prevStepRows: any[] = [];
            if (prevActive.some((c) => c.rule.kind === 'step_window')) {
              const { data: windows } = await supabase
                .from('daily_step_windows')
                .select('date, before_9am, midday_12_14, after_6pm')
                .gte('date', prevWeekStart.slice(0, 10))
                .lt('date', prevWeekEnd.slice(0, 10));
              prevStepRows = windows ?? [];
            }

            const prevCtx = buildContext(prevSessions ?? [], utcOffsetMinutes, prevStepRows);
            for (const c of prevActive) {
              if (prevCompleted.has(c.id)) continue;
              if (!evaluateChallenge(c.rule, prevCtx).met) continue;
              if (!authSession) { anyFailed = true; break; }
              try {
                await supabase.functions.invoke('complete-weekly-challenge', {
                  body: { challenge_id: c.id, utc_offset_minutes: utcOffsetMinutes, target: 'previous' },
                  headers: { Authorization: `Bearer ${authSession.access_token}` },
                });
              } catch (e) {
                anyFailed = true;
                console.warn('[useWeeklyChallenges] prev-week award failed:', c.id, e);
              }
            }
          }

          // Only mark the week swept once the pass fully succeeds, so a transient
          // failure retries on the next mount rather than being silently skipped.
          if (!anyFailed) await AsyncStorage.setItem(PREV_WEEK_SWEEP_KEY, prevWeek);
        }
      } catch (e) {
        console.warn('[useWeeklyChallenges] previous-week sweep failed:', e);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Focus fires on every tab switch; re-running the full evaluation each
      // time made returning to Home feel slow. Fresh-enough data is reused.
      if (Date.now() - lastLoadedAt.current < 60_000) return;
      lastLoadedAt.current = Date.now();
      load();
    }, [load])
  );

  return state;
}

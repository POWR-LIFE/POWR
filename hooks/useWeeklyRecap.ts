import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { localDateStr } from '@/lib/api/activity';
import { hrZonesFrom, isDayWideRow } from '@/lib/api/pointsBreakdown';
import { supabase } from '@/lib/supabase';
// challengeRules.js is CommonJS — import the namespace for interop.
import { buildContext, categoryOf, evaluateChallenge } from '@/shared/challengeRules';
import {
    CATALOG,
    CATEGORY_META,
    getChallengeById,
    getISOWeek,
    getPersonalizedChallengesForWeek,
    parseChallengeCatalog,
} from '@/shared/weeklyChallenges';
import { applyOverrides, formatProgress, localMondayAsUTC } from '@/hooks/useWeeklyChallenge';

/**
 * "Your Week" recap — everything the user did LAST week, shown at the start of
 * the new one.
 *
 * The board is rebuilt with the exact same personalization + rule engine the
 * previous-week grace sweep uses, and a challenge counts as completed when it
 * has a completion row OR the evaluator says it was met. That second clause is
 * deliberate: it makes the recap correct even when it renders before the sweep
 * has awarded (the two race on the first home load of a new week).
 */

export interface RecapChallenge {
    id: string;
    title: string;
    categoryLabel: string;
    icon: { lib: 'ion' | 'mc'; name: string };
    tier: 'easy' | 'medium' | 'hard';
    points: number;
    completed: boolean;
    fraction: number;
    displayValue: number;
    displayGoal: number;
    unit: string;
}

export interface RecapCategoryStat {
    category: string;
    label: string;
    icon: { lib: 'ion' | 'mc'; name: string };
    sessions: number;
    /** Running/cycling only. */
    distanceKm: number | null;
    /** Gym only — total time on the floor. */
    totalMin: number | null;
}

/**
 * What the week cost and gave, from health_snapshots — the same series the
 * BODY tab draws, aggregated over the recapped week. Vitals apply the same
 * day-wide gate as the breakdown sheet: a native "today" row carries the DAY's
 * figures, which would fake a workout peak and double-count burn.
 */
export interface RecapBody {
    /** Minutes of tracked exercise (walking and sleep excluded, 4h singles capped). */
    activeMin: number;
    /** Minutes the provider called high-intensity (or zone-4+ time) — subset of activeMin. */
    hardMin: number;
    /** Active kcal across the week's tracked workouts. 0 = none reported. */
    kcal: number;
    peakHr: number | null;
    /** Average hours per recorded night. Null = no sleep data that week. */
    sleepAvgH: number | null;
}

export interface RecapData {
    /** ISO week key of the week being recapped, e.g. '2026-W34'. */
    weekKey: string;
    /** Human range, e.g. 'Aug 10 – 16'. */
    weekLabel: string;
    pointsEarned: number;
    /** The week before that, for the delta line. Null = no data to compare. */
    pointsWeekBefore: number | null;
    /** One point per local day Mon–Sun (zeros included) — the hero sparkline. */
    pointsByDay: { date: string; value: number }[];
    challenges: RecapChallenge[];
    challengesCompleted: number;
    /** Mon–Sun, true where any activity happened. */
    activeDays: boolean[];
    totalSessions: number;
    steps: number;
    perCategory: RecapCategoryStat[];
    /** Highest-earning day of the week, when any day earned at all. */
    bestDay: { label: string; points: number } | null;
    body: RecapBody;
}

export interface WeeklyRecapState {
    /** True when the card should be on the home screen right now. */
    visible: boolean;
    data: RecapData | null;
    dismiss: () => void;
    /** DEV — clears the dismissal so the card can be re-tested. */
    resetDismissal: () => Promise<void>;
}

/** Holds the ISO week key of the last recap the user dismissed. */
const DISMISS_KEY = '@powr/weekly_recap_dismissed';

/** First sighting per week — {week, date} — powers the late-comer grace day. */
const SEEN_KEY = '@powr/weekly_recap_seen';

/**
 * Recap window: Monday–Wednesday of the new week, then it yields the slot.
 * EXCEPT for a user whose first Home open of the week lands later — they're
 * the semi-lapsed audience the recap most needs to reach, so they get it for
 * one day (their first), whenever that day falls. It never survives into the
 * next Monday, when the next recap takes over.
 */
const LAST_VISIBLE_DAY_INDEX = 2;

const DEV_TEST_EMAILS = new Set(['jamiemasonwright@gmail.com']);

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Mon-based day index of a UTC timestamp in the user's local time. */
function localDow(startedAt: string, utcOffsetMinutes: number): number {
    const local = new Date(new Date(startedAt).getTime() + utcOffsetMinutes * 60 * 1000);
    return (local.getUTCDay() + 6) % 7;
}

/** 'Aug 10 – 16' / 'Aug 31 – Sep 6' for the Monday-anchored week at `mondayISO`. */
function weekRangeLabel(mondayISO: string, utcOffsetMinutes: number): string {
    const mon = new Date(new Date(mondayISO).getTime() + utcOffsetMinutes * 60 * 1000);
    const sun = new Date(mon.getTime() + 6 * 86400000);
    const fmt = (d: Date) => `${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
    if (mon.getUTCMonth() === sun.getUTCMonth()) return `${fmt(mon)} – ${sun.getUTCDate()}`;
    return `${fmt(mon)} – ${fmt(sun)}`;
}

export function useWeeklyRecap(): WeeklyRecapState {
    const [visible, setVisible] = useState(false);
    const [data, setData] = useState<RecapData | null>(null);
    const [weekKey, setWeekKey] = useState<string | null>(null);

    const load = useCallback(async () => {
        const utcOffsetMinutes = -new Date().getTimezoneOffset();
        const localNow = new Date(Date.now() + utcOffsetMinutes * 60 * 1000);
        const todayIndex = (localNow.getUTCDay() + 6) % 7;
        const prevWeek = getISOWeek(new Date(localNow.getTime() - 7 * 86400000));

        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (!authSession) return;
        const uid = authSession.user.id;
        const isDev = __DEV__ && DEV_TEST_EMAILS.has(authSession.user.email ?? '');

        // Window + dismissal gates first — they're cheap and usually terminal.
        const dismissed = await AsyncStorage.getItem(DISMISS_KEY).catch(() => null);
        if (dismissed === prevWeek) return;

        const todayLocal = localDateStr(new Date());
        let seen: { week: string; date: string } | null = null;
        try {
            const raw = await AsyncStorage.getItem(SEEN_KEY);
            seen = raw ? JSON.parse(raw) : null;
        } catch { /* treat as never seen */ }

        if (!isDev && todayIndex > LAST_VISIBLE_DAY_INDEX) {
            // Past Wednesday: only the late-comer grace applies — first sighting
            // of this week's recap was today, or hasn't happened yet.
            if (seen?.week === prevWeek && seen.date !== todayLocal) return;
        }

        const weekStart = localMondayAsUTC(utcOffsetMinutes);
        const prevWeekStart = localMondayAsUTC(utcOffsetMinutes, Date.now() - 7 * 86400000);
        const weekBeforeStart = localMondayAsUTC(utcOffsetMinutes, Date.now() - 14 * 86400000);

        const [
            { data: sessions },
            { data: completions },
            { data: transactions },
            { data: snapshots },
            { data: prof },
            { data: catalogCfg },
            { data: ovCfg },
        ] = await Promise.all([
            supabase
                .from('activity_sessions')
                .select('type, started_at, duration_sec, distance_m, steps, verification')
                .eq('user_id', uid)
                .gte('started_at', prevWeekStart)
                .lt('started_at', weekStart)
                .order('started_at', { ascending: true }),
            supabase
                .from('user_challenge_completions')
                .select('challenge_id')
                .eq('user_id', uid)
                .eq('challenge_week', prevWeek),
            // Two weeks of ledger: last week's earnings + the week before for the
            // delta. Redemptions are negative amounts — filtered in code.
            supabase
                .from('point_transactions')
                .select('amount, created_at')
                .eq('user_id', uid)
                .gte('created_at', weekBeforeStart)
                .lt('created_at', weekStart),
            // The week's vitals — same rows the BODY tab reads, one week of them.
            // The upper bound runs 2 days past the week so LATE-WRITTEN sleep
            // still counts: Terra can deliver a night a day+ after it was slept,
            // and those rows carry recorded_at = write time. Effort metrics
            // re-apply the strict in-week bound in the loop below; sleep is
            // bucketed by the night's true wake time from the linked session.
            supabase
                .from('health_snapshots')
                .select('recorded_at, source, hr_max, calories_active, sleep_duration_h, sleep_deep_h, sleep_rem_h, sleep_light_h, extras, session:activity_sessions(started_at, ended_at)')
                .eq('user_id', uid)
                .gte('recorded_at', prevWeekStart)
                .lt('recorded_at', new Date(new Date(weekStart).getTime() + 2 * 86400000).toISOString()),
            supabase.from('profiles').select('activity_preferences').eq('id', uid).maybeSingle(),
            supabase.from('system_config').select('value').eq('key', 'weekly_challenges').maybeSingle(),
            supabase.from('system_config').select('value').eq('key', 'challenge_week_overrides').maybeSingle(),
        ]);

        // ── Ledger totals ──
        let pointsEarned = 0;
        let pointsWeekBefore = 0;
        const perDayPoints = [0, 0, 0, 0, 0, 0, 0];
        for (const t of transactions ?? []) {
            if (t.amount <= 0) continue;
            if (t.created_at >= prevWeekStart) {
                pointsEarned += t.amount;
                perDayPoints[localDow(t.created_at, utcOffsetMinutes)] += t.amount;
            } else {
                pointsWeekBefore += t.amount;
            }
        }

        // ── Session aggregates (manual included — it earned; sleep excluded) ──
        const activityRows = (sessions ?? []).filter((s) => s.type !== 'sleep');
        const activeDays = [false, false, false, false, false, false, false];
        const catStats = new Map<string, { sessions: number; distanceM: number; durationSec: number }>();
        let steps = 0;
        for (const s of activityRows) {
            activeDays[localDow(s.started_at, utcOffsetMinutes)] = true;
            const cat = categoryOf(s.type);
            if (!cat) continue;
            const agg = catStats.get(cat) ?? { sessions: 0, distanceM: 0, durationSec: 0 };
            agg.sessions += 1;
            agg.distanceM += s.distance_m ?? 0;
            agg.durationSec += s.duration_sec ?? 0;
            catStats.set(cat, agg);
            if (s.type === 'walking') steps += s.steps ?? 0;
        }

        // Nothing to recap — an empty-week card demotivates, so it never shows.
        if (!isDev && pointsEarned === 0 && activityRows.length === 0) return;

        // ── Body: what the week cost and gave (BodyTab's rules, one week) ──
        let activeMin = 0;
        for (const s of activityRows) {
            if (s.type === 'walking') continue;
            // 4h+ singles are open-ended check-ins, not effort — cap their weight.
            if (s.duration_sec && s.duration_sec > 0) activeMin += Math.min(Math.round(s.duration_sec / 60), 240);
        }
        let hardMin = 0;
        let kcal = 0;
        let peakHr: number | null = null;
        const sleepByDay = new Map<string, number>();
        const weekStartMs = new Date(weekStart).getTime();
        const prevWeekStartMs = new Date(prevWeekStart).getTime();
        for (const r of snapshots ?? []) {
            // The query window runs past the week to catch late-written sleep;
            // effort metrics keep the strict in-week bound.
            const inWeek = r.recorded_at < weekStart;

            const hard = (r.extras as Record<string, unknown> | null)?.high_intensity_min;
            if (inWeek && typeof hard === 'number' && Number.isFinite(hard) && hard > 0) {
                hardMin += Math.round(hard);
            } else if (inWeek) {
                // Zone 4+5 time counts as hard for providers that send zones but
                // no intensity minutes — same fallback the BODY tab's load uses.
                const zones = hrZonesFrom(r.extras as Record<string, unknown> | null);
                const hardSec = (zones ?? []).filter((z) => z.zone >= 4).reduce((s, z) => s + z.durationSec, 0);
                if (hardSec > 0) hardMin += Math.round(hardSec / 60);
            }

            // A night's hours: the explicit total when present, else the stage
            // sum; 12h+ "nights" are late-write artefacts, not sleep.
            const stages = (r.sleep_deep_h ?? 0) + (r.sleep_rem_h ?? 0) + (r.sleep_light_h ?? 0);
            const hours = r.sleep_duration_h ?? (stages > 0 ? stages : null);
            if (hours != null && hours >= 1 && hours <= 12) {
                // A night belongs to the morning it ENDED (the linked session's
                // real times), not the row's write time — Terra writes sleep up
                // to a day late, which filed nights on the wrong day and let a
                // backfill batch collapse two nights into one map key. Same
                // rule as bodyTrends. Longest record wins the day, so a
                // fragment or nap can't displace the main night.
                // To-one embed: PostgREST returns an object; the generated
                // types mistake it for an array (same cast as bodyTrends).
                const sess = (r as unknown as { session?: { started_at: string; ended_at: string | null } | null }).session;
                const wakeMs = sess
                    ? (sess.ended_at
                        ? new Date(sess.ended_at).getTime()
                        : new Date(sess.started_at).getTime() + hours * 3600_000)
                    : new Date(r.recorded_at).getTime();
                if (wakeMs >= prevWeekStartMs && wakeMs < weekStartMs) {
                    const wakeDay = localDateStr(new Date(wakeMs));
                    const prev = sleepByDay.get(wakeDay);
                    if (prev == null || hours > prev) sleepByDay.set(wakeDay, hours);
                }
            }

            if (!inWeek) continue;
            if (isDayWideRow(r as { source: string | null; extras: Record<string, unknown> | null })) continue;
            if (r.hr_max != null && r.hr_max > 0 && (peakHr == null || r.hr_max > peakHr)) peakHr = r.hr_max;
            if (r.calories_active != null && r.calories_active > 0) kcal += r.calories_active;
        }
        const nights = [...sleepByDay.values()];
        const body: RecapBody = {
            activeMin,
            hardMin: Math.min(hardMin, activeMin),
            kcal: Math.round(kcal),
            peakHr,
            sleepAvgH: nights.length > 0
                ? Math.round((nights.reduce((s, v) => s + v, 0) / nights.length) * 10) / 10
                : null,
        };

        const metaMap = CATEGORY_META as Record<string, { label: string; icon: { lib: 'ion' | 'mc'; name: string } }>;
        const perCategory: RecapCategoryStat[] = [...catStats.entries()]
            .map(([category, agg]) => ({
                category,
                label: metaMap[category]?.label ?? category,
                icon: metaMap[category]?.icon ?? { lib: 'ion' as const, name: 'flame' },
                sessions: agg.sessions,
                distanceKm: category === 'running' || category === 'cycling'
                    ? Math.round(agg.distanceM / 100) / 10
                    : null,
                totalMin: category === 'gym' ? Math.round(agg.durationSec / 60) : null,
            }))
            .sort((a, b) => b.sessions - a.sessions);

        // ── Rebuild last week's board, exactly as the grace sweep does ──
        const catalog = catalogCfg?.value ? parseChallengeCatalog(catalogCfg.value) : CATALOG;
        let allOv: Record<string, Record<string, string>> | null = null;
        try {
            if (ovCfg?.value) allOv = typeof ovCfg.value === 'string' ? JSON.parse(ovCfg.value) : ovCfg.value;
        } catch { /* auto rotation */ }

        const buckets = Array.isArray(prof?.activity_preferences) ? prof.activity_preferences : [];
        const prevCats = new Set<string>();
        for (const s of sessions ?? []) {
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
        const completedIds = new Set((completions ?? []).map((c) => c.challenge_id));
        for (const id of completedIds) {
            if (!prevActive.some((c) => c.id === id)) {
                const found = getChallengeById(id, catalog as any[]);
                if (found) prevActive.push(found);
            }
        }

        let stepWindowRows: any[] = [];
        if (prevActive.some((c) => c.rule.kind === 'step_window')) {
            const { data: windows } = await supabase
                .from('daily_step_windows')
                .select('date, before_9am, midday_12_14, after_6pm')
                .eq('user_id', uid)
                .gte('date', prevWeekStart.slice(0, 10))
                .lt('date', weekStart.slice(0, 10));
            stepWindowRows = windows ?? [];
        }

        const ctx = buildContext(sessions ?? [], utcOffsetMinutes, stepWindowRows);
        const challenges: RecapChallenge[] = prevActive.map((c) => {
            const { progress, target, met } = evaluateChallenge(c.rule, ctx);
            const completed = completedIds.has(c.id) || met;
            const meta = metaMap[c.category] ?? { label: c.category, icon: { lib: 'ion' as const, name: 'flame' } };
            const fmt = formatProgress(c.rule, c.category, completed ? target : progress, target);
            return {
                id: c.id,
                title: c.title,
                categoryLabel: meta.label,
                icon: meta.icon,
                tier: c.tier as RecapChallenge['tier'],
                points: c.points,
                completed,
                fraction: fmt.fraction,
                displayValue: fmt.displayValue,
                displayGoal: fmt.displayGoal,
                unit: fmt.unit,
            };
        });
        // Wins first, then closest misses — the order the story reads best in.
        challenges.sort((a, b) => Number(b.completed) - Number(a.completed) || b.fraction - a.fraction);

        const bestDayIdx = perDayPoints.indexOf(Math.max(...perDayPoints));
        // Local dates for the sparkline: prevWeekStart is local Monday midnight
        // as a UTC instant, so stepping whole days lands on each local day.
        const prevMondayMs = new Date(prevWeekStart).getTime();
        const pointsByDay = perDayPoints.map((value, i) => ({
            date: localDateStr(new Date(prevMondayMs + i * 86400000 + 12 * 3600000)),
            value,
        }));
        setWeekKey(prevWeek);
        setData({
            weekKey: prevWeek,
            weekLabel: weekRangeLabel(prevWeekStart, utcOffsetMinutes),
            pointsEarned,
            pointsWeekBefore: pointsWeekBefore > 0 ? pointsWeekBefore : null,
            pointsByDay,
            challenges,
            challengesCompleted: challenges.filter((c) => c.completed).length,
            activeDays,
            totalSessions: activityRows.length,
            steps,
            perCategory,
            bestDay: perDayPoints[bestDayIdx] > 0
                ? { label: DAY_LABELS[bestDayIdx], points: perDayPoints[bestDayIdx] }
                : null,
            body,
        });
        setVisible(true);

        // First sighting of this week's recap — stamp it (first only, so a
        // Tuesday viewing doesn't re-arm the Thursday grace day).
        if (seen?.week !== prevWeek) {
            AsyncStorage.setItem(SEEN_KEY, JSON.stringify({ week: prevWeek, date: todayLocal })).catch(() => {});
        }
    }, []);

    useEffect(() => {
        load().catch((e) => console.warn('[useWeeklyRecap] load failed:', e));
    }, [load]);

    const dismiss = useCallback(() => {
        setVisible(false);
        if (weekKey) AsyncStorage.setItem(DISMISS_KEY, weekKey).catch(() => {});
    }, [weekKey]);

    const resetDismissal = useCallback(async () => {
        await AsyncStorage.multiRemove([DISMISS_KEY, SEEN_KEY]).catch(() => {});
        await load().catch(() => {});
    }, [load]);

    return { visible, data, dismiss, resetDismissal };
}

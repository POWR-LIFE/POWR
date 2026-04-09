import { supabase } from '@/lib/supabase';
import { getDeviceId } from '@/lib/device';
import { type ActivityType } from '@/constants/activities';

// ── Walking step-tier helpers (shared by manual-log + health sync) ─────────────

/** Points awarded for a given step count (matches manual-log calcBasePoints). */
export function stepTierPoints(steps: number): number {
    if (steps >= 10000) return 5;
    if (steps >= 8000)  return 4;
    if (steps >= 6000)  return 3;
    if (steps >= 4000)  return 2;
    return 0;
}

/** Next step threshold above current count, or null if already at max. */
export function nextStepThreshold(steps: number): number | null {
    if (steps >= 10000) return null;
    if (steps >= 8000)  return 10000;
    if (steps >= 6000)  return 8000;
    if (steps >= 4000)  return 6000;
    return 4000;
}

export type ActivitySession = {
    id: string;
    type: string;
    started_at: string;
    ended_at: string;
    duration_sec: number;
    distance_m: number | null;
    steps: number | null;
    verification: string;
    trust_score: number;
    point_transactions: { amount: number }[];
};

export async function fetchRecentSessions(limit = 5): Promise<ActivitySession[]> {
    const { data, error } = await supabase
        .from('activity_sessions')
        .select('id, type, started_at, ended_at, duration_sec, distance_m, steps, verification, trust_score, point_transactions(amount)')
        .order('ended_at', { ascending: false, nullsFirst: false })
        .limit(limit);
    if (error) throw error;
    return (data ?? []) as ActivitySession[];
}

/** Returns a Mon–Sun boolean[7] for the current week */
export async function fetchWeekActiveDays(): Promise<boolean[]> {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at')
        .neq('verification', 'manual')
        .gte('started_at', monday.toISOString());
    if (error) throw error;

    const active = [false, false, false, false, false, false, false];
    for (const s of data ?? []) {
        const d = new Date(s.started_at).getDay();
        active[d === 0 ? 6 : d - 1] = true; // Mon=0 … Sun=6
    }
    return active;
}

export type WeeklyMetrics = {
    gymVisits: number;
    runs: number;
    totalSteps: number;
    sessionCount: number;
    /** Session counts keyed by activity type */
    perType: Record<string, number>;
};

export type ManualSessionParams = {
    type: ActivityType;
    duration_sec: number;
    distance_m?: number;
    steps?: number;
    hr_avg?: number;
    points: number;
    started_at: string;
    healthVerified?: boolean;
};

export async function logManualSession(params: ManualSessionParams): Promise<void> {
    const ended_at = new Date().toISOString();
    const verification = params.healthVerified ? 'wearable' : 'manual';
    const trust_score = params.healthVerified ? 85 : 55;
    const device_id = await getDeviceId();

    const { data: session, error: sessionError } = await supabase
        .from('activity_sessions')
        .insert({
            type: params.type,
            started_at: params.started_at,
            ended_at,
            duration_sec: params.duration_sec,
            distance_m: params.distance_m ?? null,
            steps: params.steps ?? null,
            hr_avg: params.hr_avg ?? null,
            verification,
            trust_score,
            device_id,
        })
        .select('id')
        .single();
    if (sessionError) throw sessionError;

    if (params.points > 0) {
        const { error: ptError } = await supabase
            .from('point_transactions')
            .insert({
                session_id: session.id,
                amount: params.points,
                type: 'earn',
                source: 'manual_log',
            });
        if (ptError) throw ptError;
    }

    // Wearable-verified activities count towards streak (unlike plain manual logs)
    if (params.healthVerified) {
        await updateStreakForToday();
    }
}

export async function fetchWeeklyMetrics(): Promise<WeeklyMetrics> {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('type, steps')
        .gte('started_at', monday.toISOString());
    if (error) throw error;

    const sessions = data ?? [];
    const perType: Record<string, number> = {};
    for (const s of sessions) {
        perType[s.type] = (perType[s.type] ?? 0) + 1;
    }
    return {
        gymVisits: perType['gym'] ?? 0,
        runs: perType['running'] ?? 0,
        totalSteps: sessions.reduce((sum, s) => sum + (s.steps ?? 0), 0),
        sessionCount: sessions.length,
        perType,
    };
}

// ── Health-sync walking session API ──────────────────────────────────────────
// Auto-synced sessions use trust_score=90 to distinguish from manually
// health-verified sessions (trust_score=85) and plain manual logs (55).

export type HealthWalkingSession = { id: string; steps: number; points: number };

function todayMidnight(): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
}

/** Returns the health-auto-synced walking session for today, if it exists. */
export async function getTodayHealthWalkingSession(): Promise<HealthWalkingSession | null> {
    const { data } = await supabase
        .from('activity_sessions')
        .select('id, steps, point_transactions(amount)')
        .eq('type', 'walking')
        .eq('trust_score', 90)
        .gte('started_at', todayMidnight())
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!data) return null;
    const points = ((data as any).point_transactions ?? []).reduce(
        (s: number, t: { amount: number }) => s + t.amount, 0,
    );
    return { id: data.id, steps: (data as any).steps ?? 0, points };
}

/** Creates a new health-auto-synced walking session and awards initial points. */
export async function logHealthWalkingSession(steps: number, points: number): Promise<string> {
    const now = new Date().toISOString();
    const device_id = await getDeviceId();
    const { data: session, error: sErr } = await supabase
        .from('activity_sessions')
        .insert({
            type: 'walking',
            started_at: todayMidnight(),
            ended_at: now,
            duration_sec: 0,
            steps,
            verification: 'wearable',
            trust_score: 90,
            device_id,
        })
        .select('id')
        .single();
    if (sErr) throw sErr;

    if (points > 0) {
        const { error: pErr } = await supabase
            .from('point_transactions')
            .insert({ session_id: session.id, amount: points, type: 'earn', source: 'health_sync' });
        if (pErr) throw pErr;
    }
    return session.id;
}

/** Updates step count on an existing session and awards incremental points. */
export async function updateHealthWalkingSession(
    sessionId: string,
    steps: number,
    additionalPoints: number,
): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await supabase
        .from('activity_sessions')
        .update({ steps, ended_at: now })
        .eq('id', sessionId);
    if (error) console.warn('[walkingSync] session update failed:', error.message);

    if (additionalPoints > 0) {
        await supabase
            .from('point_transactions')
            .insert({ session_id: sessionId, amount: additionalPoints, type: 'earn', source: 'health_sync' });
    }
}

// ── Streak helper (called by walking auto-sync) ────────────────────────────

/** Marks today as an active streak day. Idempotent — safe to call repeatedly. */
export async function updateStreakForToday(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: streak } = await supabase
        .from('user_streaks')
        .select('current_streak, longest_streak, last_activity_date')
        .eq('user_id', user.id)
        .single();
    if (!streak) return;

    const today = new Date().toISOString().split('T')[0];
    if (streak.last_activity_date === today) return; // already counted

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];

    const newStreak = streak.last_activity_date === yStr
        ? streak.current_streak + 1
        : 1;

    await supabase
        .from('user_streaks')
        .update({
            current_streak: newStreak,
            longest_streak: Math.max(newStreak, streak.longest_streak),
            last_activity_date: today,
        })
        .eq('user_id', user.id);
}

/**
 * Builds a streak from an array of date strings (YYYY-MM-DD).
 * Computes the longest consecutive run ending at the most recent date,
 * then upserts the user_streaks row.
 * Used during onboarding to give users a real starting streak from historical health data.
 */
export async function buildStreakFromDates(activeDates: string[]): Promise<number> {
    if (activeDates.length === 0) return 0;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;

    // Deduplicate and sort ascending
    const unique = [...new Set(activeDates)].sort();

    // Find the longest consecutive streak ending at the latest date
    let streak = 1;
    for (let i = unique.length - 1; i > 0; i--) {
        const curr = new Date(unique[i]);
        const prev = new Date(unique[i - 1]);
        const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
        if (diffDays === 1) {
            streak++;
        } else {
            break; // gap found, stop counting
        }
    }

    const lastDate = unique[unique.length - 1];

    // Check if the streak is still current (last active date is today or yesterday)
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];

    // If the last active date isn't today or yesterday, the streak has broken
    if (lastDate !== today && lastDate !== yStr) {
        streak = 0;
    }

    // Upsert user_streaks
    const { data: existing } = await supabase
        .from('user_streaks')
        .select('current_streak, longest_streak')
        .eq('user_id', user.id)
        .single();

    if (existing) {
        await supabase
            .from('user_streaks')
            .update({
                current_streak: streak,
                longest_streak: Math.max(streak, existing.longest_streak),
                last_activity_date: lastDate,
            })
            .eq('user_id', user.id);
    } else {
        await supabase
            .from('user_streaks')
            .insert({
                user_id: user.id,
                current_streak: streak,
                longest_streak: streak,
                last_activity_date: lastDate,
            });
    }

    return streak;
}

// ── Daily cap helper (walking) ──────────────────────────────────────────────

const WALKING_DAILY_CAP = 5;

/** Returns total walking points already earned today (all sources). */
export async function fetchTodayWalkingPoints(): Promise<number> {
    const midnight = todayMidnight();
    const { data } = await supabase
        .from('point_transactions')
        .select('amount, session_id')
        .eq('type', 'earn')
        .gte('created_at', midnight);

    if (!data || data.length === 0) return 0;

    // Filter to walking sessions only
    const sessionIds = [...new Set(data.map(t => t.session_id).filter(Boolean))];
    if (sessionIds.length === 0) return 0;

    const { data: sessions } = await supabase
        .from('activity_sessions')
        .select('id')
        .in('id', sessionIds)
        .eq('type', 'walking');

    const walkingIds = new Set((sessions ?? []).map(s => s.id));
    return data
        .filter(t => t.session_id && walkingIds.has(t.session_id))
        .reduce((sum, t) => sum + t.amount, 0);
}

/** Returns Mon–Sun sleep hours for the current week from synced activity sessions. */
export async function fetchWeeklySleepHours(): Promise<{ hours: number[]; bedtimes: (string | null)[] }> {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at, duration_sec')
        .eq('type', 'sleep')
        .gte('started_at', monday.toISOString())
        .order('started_at', { ascending: true });
    if (error) throw error;

    // Map each session to its weekday (Mon=0 … Sun=6)
    const hours: number[] = [0, 0, 0, 0, 0, 0, 0];
    const bedtimes: (string | null)[] = [null, null, null, null, null, null, null];

    for (const s of data ?? []) {
        const d = new Date(s.started_at);
        // Sleep that starts in the evening belongs to the next day's metric
        // e.g. sleeping at 11pm Monday → Tuesday's sleep
        const startHour = d.getHours();
        const assignDate = startHour >= 18
            ? new Date(d.getTime() + 86400000) // next day
            : d;
        const day = assignDate.getDay();
        const idx = day === 0 ? 6 : day - 1;
        const durationH = Math.round((s.duration_sec / 3600) * 10) / 10;
        hours[idx] += durationH;

        // Track bedtime (earliest start for that night)
        if (!bedtimes[idx] || s.started_at < bedtimes[idx]!) {
            bedtimes[idx] = s.started_at;
        }
    }

    return { hours, bedtimes };
}

// ── Health snapshot persistence ───────────────────────────────────────────────

export type HealthSnapshotParams = {
    sessionId?: string;
    steps?: number;
    distanceM?: number;
    hrAvg?: number;
    hrMax?: number;
    hrResting?: number;
    caloriesActive?: number;
    caloriesTotal?: number;
    sleepDurationH?: number;
    sleepDeepH?: number;
    sleepRemH?: number;
    sleepLightH?: number;
    activityType?: string;
    durationSec?: number;
    source: 'healthkit' | 'health_connect';
};

/** Persists a health data snapshot to the health_snapshots table. */
export async function saveHealthSnapshot(params: HealthSnapshotParams): Promise<void> {
    const { error } = await supabase.from('health_snapshots').insert({
        session_id: params.sessionId ?? null,
        steps: params.steps ?? null,
        distance_m: params.distanceM ?? null,
        hr_avg: params.hrAvg ?? null,
        hr_max: params.hrMax ?? null,
        hr_resting: params.hrResting ?? null,
        calories_active: params.caloriesActive ?? null,
        calories_total: params.caloriesTotal ?? null,
        sleep_duration_h: params.sleepDurationH ?? null,
        sleep_deep_h: params.sleepDeepH ?? null,
        sleep_rem_h: params.sleepRemH ?? null,
        sleep_light_h: params.sleepLightH ?? null,
        activity_type: params.activityType ?? null,
        duration_sec: params.durationSec ?? null,
        source: params.source,
    });
    if (error) console.warn('[healthSnapshot] insert failed:', error.message);
}

export { WALKING_DAILY_CAP };

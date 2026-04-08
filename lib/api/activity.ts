import { supabase } from '@/lib/supabase';
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
    points: number;
    started_at: string;
    healthVerified?: boolean;
};

export async function logManualSession(params: ManualSessionParams): Promise<void> {
    const ended_at = new Date().toISOString();
    const verification = params.healthVerified ? 'wearable' : 'manual';
    const trust_score = params.healthVerified ? 85 : 55;

    const { data: session, error: sessionError } = await supabase
        .from('activity_sessions')
        .insert({
            type: params.type,
            started_at: params.started_at,
            ended_at,
            duration_sec: params.duration_sec,
            distance_m: params.distance_m ?? null,
            steps: params.steps ?? null,
            verification,
            trust_score,
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

export { WALKING_DAILY_CAP };

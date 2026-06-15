import { type ActivityType } from '@/constants/activities';
import { getDeviceId } from '@/lib/device';
import { supabase } from '@/lib/supabase';

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

async function getCurrentUserId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
}

/** True if an ISO timestamp falls on the current local calendar day. */
function isLocalToday(iso: string): boolean {
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
}

export async function fetchRecentSessions(limit = 5): Promise<ActivitySession[]> {
    const uid = await getCurrentUserId();
    if (!uid) return [];
    const { data, error } = await supabase
        .from('activity_sessions')
        .select('id, type, started_at, ended_at, duration_sec, distance_m, steps, verification, trust_score, point_transactions(amount)')
        .eq('user_id', uid)
        .order('ended_at', { ascending: false, nullsFirst: false })
        .limit(limit);
    if (error) throw error;
    return (data ?? []) as ActivitySession[];
}

/** Returns a Mon–Sun boolean[7] for the current week */
export async function fetchWeekActiveDays(): Promise<boolean[]> {
    const uid = await getCurrentUserId();
    if (!uid) return [false, false, false, false, false, false, false];
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at')
        .eq('user_id', uid)
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
    /** Mon–Sun active-day booleans keyed by activity type */
    activeDaysPerType: Record<string, boolean[]>;
};

export type DailyMetrics = {
    /** Session counts today keyed by activity type */
    perType: Record<string, number>;
    stepsToday: number;
};

export async function fetchDailyMetrics(): Promise<DailyMetrics> {
    const uid = await getCurrentUserId();
    if (!uid) return { perType: {}, stepsToday: 0 };
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('type, steps')
        .eq('user_id', uid)
        .gte('started_at', start.toISOString());
    if (error) throw error;

    const perType: Record<string, number> = {};
    let stepsToday = 0;
    for (const s of (data ?? []) as Array<{ type: string; steps: number | null }>) {
        perType[s.type] = (perType[s.type] ?? 0) + 1;
        if (s.type === 'walking') stepsToday += s.steps ?? 0;
    }
    return { perType, stepsToday };
}

export type ManualSessionParams = {
    type: ActivityType;
    duration_sec: number;
    distance_m?: number;
    steps?: number;
    hr_avg?: number;
    points: number;
    started_at: string;
    healthVerified?: boolean;
    /**
     * When `healthVerified`, the provenance of the data: 'wearable' for dedicated
     * wearable providers (Fitbit/Whoop/Garmin), 'health' for native phone sync.
     * Defaults to 'health' — native phone health is the common case and never a
     * true wearable. See `verificationForProvider`.
     */
    healthSource?: 'wearable' | 'health';
};

/** Max unverified manual logs allowed per calendar week (Mon–Sun). */
const WEEKLY_MANUAL_CAP = 3;

export async function logManualSession(params: ManualSessionParams): Promise<boolean> {
    // ended_at is the activity's true end (start + duration), NOT the moment we
    // happen to sync it. Using `now` made backfilled health sessions span hours/
    // days of wall-clock (e.g. a sleep "ending" at sync time, days after the
    // bedtime) and surfaced a wrong wake time in the sleep detail view. For
    // manual logs started_at is already (now - duration), so this is unchanged.
    const ended_at = new Date(new Date(params.started_at).getTime() + params.duration_sec * 1000).toISOString();
    const verification = params.healthVerified ? (params.healthSource ?? 'health') : 'manual';
    const trust_score = params.healthVerified ? 0.85 : 0.55;
    const device_id = await getDeviceId();

    // Anti-abuse: cap unverified manual logs at WEEKLY_MANUAL_CAP per week.
    // Health-verified logs (wearable) are exempt — they have real sensor backing.
    if (!params.healthVerified) {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(now);
        monday.setDate(now.getDate() + mondayOffset);
        monday.setHours(0, 0, 0, 0);

        const { count, error: countError } = await supabase
            .from('activity_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', (await getCurrentUserId()) ?? '')
            .eq('verification', 'manual')
            .gte('started_at', monday.toISOString());

        if (!countError && (count ?? 0) >= WEEKLY_MANUAL_CAP) {
            throw new Error(
                `You've reached the ${WEEKLY_MANUAL_CAP} manual log limit for this week. ` +
                'Connect a health provider to keep logging sessions.',
            );
        }
    }

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
    if (sessionError) {
        // Session for this type/day already exists — skip silently
        if (sessionError.code === '23505') return false;
        throw sessionError;
    }

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

    // Wearable-verified activities count towards streak (unlike plain manual logs).
    // Only TODAY's activity advances the streak counter — backfilled past-day
    // sessions still populate active-days (read from sessions directly) but must
    // not retroactively bump today's streak.
    if (params.healthVerified && isLocalToday(params.started_at)) {
        await updateStreakForToday();
    }

    return true;
}

export async function fetchWeeklyMetrics(): Promise<WeeklyMetrics> {
    const uid = await getCurrentUserId();
    if (!uid) return { gymVisits: 0, runs: 0, totalSteps: 0, sessionCount: 0, perType: {}, activeDaysPerType: {} };
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('type, steps, started_at')
        .eq('user_id', uid)
        .gte('started_at', monday.toISOString());
    if (error) throw error;

    const sessions = data ?? [];
    const perType: Record<string, number> = {};
    const activeDaysPerType: Record<string, boolean[]> = {};
    for (const s of sessions) {
        perType[s.type] = (perType[s.type] ?? 0) + 1;
        if (!activeDaysPerType[s.type]) {
            activeDaysPerType[s.type] = [false, false, false, false, false, false, false];
        }
        const d = new Date(s.started_at).getDay();
        activeDaysPerType[s.type][d === 0 ? 6 : d - 1] = true;
    }
    return {
        gymVisits: perType['gym'] ?? 0,
        runs: perType['running'] ?? 0,
        totalSteps: sessions.reduce((sum, s) => sum + (s.steps ?? 0), 0),
        sessionCount: sessions.length,
        perType,
        activeDaysPerType,
    };
}

// ── Health-sync walking session API ──────────────────────────────────────────
// Auto-synced sessions use trust_score=0.90 to distinguish from manually
// health-verified sessions (0.85) and plain manual logs (0.55).

export type HealthWalkingSession = { id: string; steps: number; points: number };

function todayMidnight(): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
}

/** Returns a YYYY-MM-DD string in the device's local timezone. */
function localDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Returns the health-auto-synced walking session for today, if it exists. */
export async function getTodayHealthWalkingSession(): Promise<HealthWalkingSession | null> {
    const uid = await getCurrentUserId();
    if (!uid) return null;
    const { data } = await supabase
        .from('activity_sessions')
        .select('id, steps, point_transactions(amount)')
        .eq('user_id', uid)
        .eq('type', 'walking')
        .eq('trust_score', 0.90)
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

/**
 * Creates a new health-auto-synced walking session and awards initial points.
 * `verification` reflects the data source — 'wearable' for dedicated wearables,
 * 'health' for native phone sync (the default). See `verificationForProvider`.
 */
export async function logHealthWalkingSession(
    steps: number,
    points: number,
    verification: 'wearable' | 'health' = 'health',
    startedAt?: string,
    endedAt?: string,
): Promise<string | null> {
    // Defaults target today; the backfill path passes a past day's local midnight
    // (and that day's end) to recover days the app was closed across (see
    // backfillWalkingDays). The per-day unique index keeps this idempotent.
    const start = startedAt ?? todayMidnight();
    const end = endedAt ?? new Date().toISOString();
    const device_id = await getDeviceId();
    const { data: session, error: sErr } = await supabase
        .from('activity_sessions')
        .insert({
            type: 'walking',
            started_at: start,
            ended_at: end,
            duration_sec: 0,
            steps,
            verification,
            trust_score: 0.90,
            device_id,
        })
        .select('id')
        .single();
    if (sErr) {
        // Unique constraint: session already exists for today — fall back to update path
        if (sErr.code === '23505') {
            console.log('[walkingSync] Walking session already exists today — skipping insert.');
            return null;
        }
        throw sErr;
    }

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

// ── Recent walking history (Day view) ────────────────────────────────────────

export type DailyWalkingHistory = {
    date: string;    // YYYY-MM-DD
    steps: number;
    points: number;
};

/**
 * Returns the last `days` days of walking data (excluding today),
 * aggregated by date with step counts and points earned.
 */
export async function fetchRecentWalkingHistory(days = 5): Promise<DailyWalkingHistory[]> {
    const uid = await getCurrentUserId();
    if (!uid) return [];

    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - days);
    rangeStart.setHours(0, 0, 0, 0);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at, steps, point_transactions(amount)')
        .eq('user_id', uid)
        .eq('type', 'walking')
        .gte('started_at', rangeStart.toISOString())
        .lt('started_at', todayStart.toISOString())
        .order('started_at', { ascending: true });
    if (error) throw error;

    const byDate = new Map<string, { steps: number; points: number }>();
    for (const s of (data ?? []) as Array<{ started_at: string; steps: number | null; point_transactions: { amount: number }[] }>) {
        const dateKey = localDateStr(new Date(s.started_at));
        const pts = (s.point_transactions ?? []).reduce((sum, t) => sum + t.amount, 0);
        const existing = byDate.get(dateKey);
        if (existing) {
            existing.steps += s.steps ?? 0;
            existing.points += pts;
        } else {
            byDate.set(dateKey, { steps: s.steps ?? 0, points: pts });
        }
    }

    const result: DailyWalkingHistory[] = [];
    for (let i = days; i >= 1; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateKey = localDateStr(d);
        const val = byDate.get(dateKey);
        result.push({ date: dateKey, steps: val?.steps ?? 0, points: val?.points ?? 0 });
    }
    return result;
}

/**
 * Returns Mon–Sun step counts for the current week (index 0 = Mon, 6 = Sun).
 * Today's value includes all walking sessions so far today.
 */
export async function fetchWeeklyStepsPerDay(): Promise<number[]> {
    const uid = await getCurrentUserId();
    if (!uid) return [0, 0, 0, 0, 0, 0, 0];

    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at, steps')
        .eq('user_id', uid)
        .eq('type', 'walking')
        .gte('started_at', monday.toISOString());
    if (error) throw error;

    const steps = [0, 0, 0, 0, 0, 0, 0];
    for (const s of (data ?? []) as Array<{ started_at: string; steps: number | null }>) {
        const d = new Date(s.started_at).getDay();
        const idx = d === 0 ? 6 : d - 1; // Mon=0 … Sun=6
        steps[idx] += s.steps ?? 0;
    }
    return steps;
}

// ── Recent workout history (Day view) ────────────────────────────────────────

export type DailyWorkoutHistory = {
    date: string;           // YYYY-MM-DD
    sessions: number;
    totalDurationMin: number;
    points: number;
};

/**
 * Returns the last `days` days of workout sessions (excluding today)
 * for the given activity type, grouped by date.
 */
export async function fetchRecentWorkoutHistory(type: ActivityType, days = 5): Promise<DailyWorkoutHistory[]> {
    const uid = await getCurrentUserId();
    if (!uid) return [];

    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - days);
    rangeStart.setHours(0, 0, 0, 0);

    // Exclude today — it already appears in the big "TODAY'S …" metric above the
    // list. (Matches fetchRecentWalkingHistory / fetchRecentSleepHistory, which
    // also stop at yesterday; previously this view double-counted today.)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at, duration_sec, point_transactions(amount)')
        .eq('user_id', uid)
        .eq('type', type)
        .gte('started_at', rangeStart.toISOString())
        .lt('started_at', todayStart.toISOString())
        .order('started_at', { ascending: true });
    if (error) throw error;

    const byDate = new Map<string, { sessions: number; durationMin: number; points: number }>();
    for (const s of (data ?? []) as Array<{ started_at: string; duration_sec: number | null; point_transactions: { amount: number }[] }>) {
        const dateKey = localDateStr(new Date(s.started_at));
        const pts = (s.point_transactions ?? []).reduce((sum, t) => sum + t.amount, 0);
        const durMin = Math.round((s.duration_sec ?? 0) / 60);
        const existing = byDate.get(dateKey);
        if (existing) {
            existing.sessions++;
            existing.durationMin += durMin;
            existing.points += pts;
        } else {
            byDate.set(dateKey, { sessions: 1, durationMin: durMin, points: pts });
        }
    }

    const result: DailyWorkoutHistory[] = [];
    for (let i = days; i >= 1; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateKey = localDateStr(d);
        const val = byDate.get(dateKey);
        result.push({
            date: dateKey,
            sessions: val?.sessions ?? 0,
            totalDurationMin: val?.durationMin ?? 0,
            points: val?.points ?? 0,
        });
    }
    return result;
}

// ── Recent sleep history (Day view) ──────────────────────────────────────────

export type DailySleepHistory = {
    date: string;    // YYYY-MM-DD
    hours: number;
};

/**
 * Returns the last `days` nights of sleep data (excluding tonight),
 * aggregated by date.
 */
export async function fetchRecentSleepHistory(days = 5): Promise<DailySleepHistory[]> {
    const uid = await getCurrentUserId();
    if (!uid) return [];

    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - days);
    rangeStart.setHours(0, 0, 0, 0);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at, duration_sec')
        .eq('user_id', uid)
        .eq('type', 'sleep')
        .gte('started_at', rangeStart.toISOString())
        .lt('started_at', todayStart.toISOString())
        .order('started_at', { ascending: true });
    if (error) throw error;

    const byDate = new Map<string, number>();
    for (const s of (data ?? []) as Array<{ started_at: string; duration_sec: number | null }>) {
        const dateKey = localDateStr(new Date(s.started_at));
        byDate.set(dateKey, (byDate.get(dateKey) ?? 0) + ((s.duration_sec ?? 0) / 3600));
    }

    const result: DailySleepHistory[] = [];
    for (let i = days; i >= 1; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateKey = localDateStr(d);
        result.push({ date: dateKey, hours: byDate.get(dateKey) ?? 0 });
    }
    return result;
}

/** Returns total walking points already earned today (all sources). */
export async function fetchTodayWalkingPoints(): Promise<number> {
    const uid = await getCurrentUserId();
    if (!uid) return 0;
    // Scope by today's walking *session* (started_at), NOT by the transaction's
    // created_at: a backfilled past-day session inserts its points with
    // created_at = now, which would otherwise be miscounted against today's cap.
    const { data: sessions } = await supabase
        .from('activity_sessions')
        .select('point_transactions(amount, type)')
        .eq('user_id', uid)
        .eq('type', 'walking')
        .gte('started_at', todayMidnight());

    if (!sessions || sessions.length === 0) return 0;

    return (sessions as Array<{ point_transactions: { amount: number; type: string }[] }>)
        .flatMap(s => s.point_transactions ?? [])
        .filter(t => t.type === 'earn')
        .reduce((sum, t) => sum + t.amount, 0);
}

/** Returns Mon–Sun sleep hours for the current week from synced activity sessions. */
export async function fetchWeeklySleepHours(): Promise<{ hours: number[]; bedtimes: (string | null)[] }> {
    const uid = await getCurrentUserId();
    if (!uid) return { hours: [0, 0, 0, 0, 0, 0, 0], bedtimes: [null, null, null, null, null, null, null] };

    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    // Look back 2 days before Monday (Saturday midnight) because sleep sessions
    // are stored with bedtime as started_at. Evening bedtimes (e.g. Sunday 10pm)
    // are attributed to the next morning's day (Monday). Without this look-back
    // the query misses evening starts that precede Monday midnight, and similarly
    // Saturday evening starts that map to Sunday's display slot.
    const lookback = new Date(monday);
    lookback.setDate(lookback.getDate() - 2);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at, duration_sec')
        .eq('user_id', uid)
        .eq('type', 'sleep')
        .gte('started_at', lookback.toISOString())
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

        // Skip sessions that map to days before the current week
        if (assignDate < monday) continue;

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

// ── Sleep detail: Day view ──────────────────────────────────────────────────

export type LastNightSleepDetail = {
    totalHours: number;
    bedtime: string;      // ISO timestamp
    wakeTime: string;      // ISO timestamp
    deepHours: number | null;
    remHours: number | null;
    lightHours: number | null;
    source: string | null;
};

/**
 * Fetches last night's sleep session with stage breakdown.
 * "Last night" = the most recent sleep whose bedtime is after yesterday 6pm.
 */
export async function fetchLastNightSleepDetail(): Promise<LastNightSleepDetail | null> {
    const uid = await getCurrentUserId();
    if (!uid) return null;

    const yesterday6pm = new Date();
    yesterday6pm.setDate(yesterday6pm.getDate() - 1);
    yesterday6pm.setHours(18, 0, 0, 0);

    // 1. Get the most recent sleep session from yesterday evening onward
    const { data: session, error } = await supabase
        .from('activity_sessions')
        .select('id, started_at, ended_at, duration_sec')
        .eq('user_id', uid)
        .eq('type', 'sleep')
        .gte('started_at', yesterday6pm.toISOString())
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    if (!session) return null;

    const totalHours = Math.round((session.duration_sec / 3600) * 10) / 10;

    // 2. Look up stage breakdown from health_snapshots in the same window.
    //    session_id FK isn't reliably set for sleep rows, so match by time window.
    const { data: snapshot } = await supabase
        .from('health_snapshots')
        .select('sleep_deep_h, sleep_rem_h, sleep_light_h, source')
        .eq('activity_type', 'sleep')
        .gte('created_at', yesterday6pm.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    return {
        totalHours,
        bedtime: session.started_at,
        wakeTime: session.ended_at ?? new Date().toISOString(),
        deepHours: snapshot?.sleep_deep_h ?? null,
        remHours: snapshot?.sleep_rem_h ?? null,
        lightHours: snapshot?.sleep_light_h ?? null,
        source: snapshot?.source ?? null,
    };
}

// ── Sleep data: Month view ──────────────────────────────────────────────────

export type DailySleepEntry = {
    date: string;         // YYYY-MM-DD
    hours: number;
    bedtime: string | null;
};

export type MonthlySleepData = {
    entries: DailySleepEntry[];   // 30 entries, oldest → newest
    avgHours: number;
    bestNight: DailySleepEntry | null;
    worstNight: DailySleepEntry | null;
};

/** Fetches 30 days of sleep data for the month heatmap view. */
export async function fetchMonthlySleepData(): Promise<MonthlySleepData> {
    const uid = await getCurrentUserId();
    if (!uid) return { entries: [], avgHours: 0, bestNight: null, worstNight: null };

    // Look back 32 days to cover the full 30-day window + evening-attribution offset
    const lookback = new Date();
    lookback.setDate(lookback.getDate() - 32);
    lookback.setHours(0, 0, 0, 0);

    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 29);
    rangeStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at, duration_sec')
        .eq('user_id', uid)
        .eq('type', 'sleep')
        .gte('started_at', lookback.toISOString())
        .order('started_at', { ascending: true });
    if (error) throw error;

    // Aggregate by date, applying evening → next-day attribution
    const byDate = new Map<string, { hours: number; bedtime: string | null }>();

    for (const s of data ?? []) {
        const d = new Date(s.started_at);
        const startHour = d.getHours();
        const assignDate = startHour >= 18
            ? new Date(d.getTime() + 86400000)
            : d;

        // Skip sessions outside the 30-day range
        if (assignDate < rangeStart) continue;

        const dateKey = assignDate.toISOString().split('T')[0];
        const durationH = Math.round((s.duration_sec / 3600) * 10) / 10;
        const existing = byDate.get(dateKey);

        if (existing) {
            existing.hours += durationH;
            if (!existing.bedtime || s.started_at < existing.bedtime) {
                existing.bedtime = s.started_at;
            }
        } else {
            byDate.set(dateKey, { hours: durationH, bedtime: s.started_at });
        }
    }

    // Build the 30-entry array
    const entries: DailySleepEntry[] = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateKey = d.toISOString().split('T')[0];
        const val = byDate.get(dateKey);
        entries.push({
            date: dateKey,
            hours: val?.hours ?? 0,
            bedtime: val?.bedtime ?? null,
        });
    }

    // Compute summary stats (only nights with data)
    const withData = entries.filter(e => e.hours > 0);
    const avgHours = withData.length > 0
        ? Math.round((withData.reduce((s, e) => s + e.hours, 0) / withData.length) * 10) / 10
        : 0;

    let bestNight: DailySleepEntry | null = null;
    let worstNight: DailySleepEntry | null = null;
    for (const e of withData) {
        if (!bestNight || e.hours > bestNight.hours) bestNight = e;
        if (!worstNight || e.hours < worstNight.hours) worstNight = e;
    }

    return { entries, avgHours, bestNight, worstNight };
}

// ── Today activity detail (Day view) ────────────────────────────────────────

export type TodayActivityDetail = {
    sessionCount: number;
    totalDurationMin: number;
    totalPoints: number;
    /** Walking-only: step count */
    steps: number | null;
    /** Walking-only: distance in metres */
    distanceM: number | null;
    /** ISO timestamp of the most recent session start */
    latestStartedAt: string | null;
};

/** Returns today's session summary for a given activity type. */
export async function fetchTodayActivityDetail(type: ActivityType): Promise<TodayActivityDetail> {
    const uid = await getCurrentUserId();
    if (!uid) return { sessionCount: 0, totalDurationMin: 0, totalPoints: 0, steps: null, distanceM: null, latestStartedAt: null };

    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('id, started_at, duration_sec, steps, distance_m, point_transactions(amount)')
        .eq('user_id', uid)
        .eq('type', type)
        .gte('started_at', start.toISOString())
        .order('started_at', { ascending: false });
    if (error) throw error;

    const sessions = (data ?? []) as Array<{
        id: string;
        started_at: string;
        duration_sec: number;
        steps: number | null;
        distance_m: number | null;
        point_transactions: { amount: number }[];
    }>;

    let totalDurationMin = 0;
    let totalPoints = 0;
    let totalSteps = 0;
    let totalDistance = 0;

    for (const s of sessions) {
        totalDurationMin += Math.round(s.duration_sec / 60);
        totalPoints += (s.point_transactions ?? []).reduce((sum, t) => sum + t.amount, 0);
        if (s.steps) totalSteps += s.steps;
        if (s.distance_m) totalDistance += s.distance_m;
    }

    return {
        sessionCount: sessions.length,
        totalDurationMin,
        totalPoints,
        steps: type === 'walking' ? totalSteps : null,
        distanceM: type === 'walking' ? totalDistance : null,
        latestStartedAt: sessions.length > 0 ? sessions[0].started_at : null,
    };
}

// ── Monthly activity data (Month view) ──────────────────────────────────────

export type DailyActivityEntry = {
    date: string;           // YYYY-MM-DD
    sessionCount: number;
    totalDurationMin: number;
    steps: number | null;   // walking only
};

export type MonthlyActivityData = {
    entries: DailyActivityEntry[];   // 30 entries, oldest → newest
    totalSessions: number;
    avgPerDay: number;               // avg sessions/day (workouts) or avg steps (walking)
    bestDay: DailyActivityEntry | null;
    type: ActivityType;
};

/** Fetches 30 days of activity data for a given type (heatmap + summary). */
export async function fetchMonthlyActivityData(type: ActivityType): Promise<MonthlyActivityData> {
    const uid = await getCurrentUserId();
    if (!uid) return { entries: [], totalSessions: 0, avgPerDay: 0, bestDay: null, type };

    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 29);
    rangeStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at, duration_sec, steps')
        .eq('user_id', uid)
        .eq('type', type)
        .gte('started_at', rangeStart.toISOString())
        .order('started_at', { ascending: true });
    if (error) throw error;

    // Aggregate by date
    const byDate = new Map<string, { count: number; durationMin: number; steps: number }>();

    for (const s of data ?? []) {
        const dateKey = new Date(s.started_at).toISOString().split('T')[0];
        const existing = byDate.get(dateKey);
        const durMin = Math.round((s.duration_sec ?? 0) / 60);
        const steps = s.steps ?? 0;

        if (existing) {
            existing.count++;
            existing.durationMin += durMin;
            existing.steps += steps;
        } else {
            byDate.set(dateKey, { count: 1, durationMin: durMin, steps });
        }
    }

    // Build the 30-entry array
    const entries: DailyActivityEntry[] = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateKey = d.toISOString().split('T')[0];
        const val = byDate.get(dateKey);
        entries.push({
            date: dateKey,
            sessionCount: val?.count ?? 0,
            totalDurationMin: val?.durationMin ?? 0,
            steps: type === 'walking' ? (val?.steps ?? 0) : null,
        });
    }

    const withData = entries.filter(e => e.sessionCount > 0);
    const totalSessions = withData.reduce((s, e) => s + e.sessionCount, 0);

    // For walking: avg steps/day; for others: avg sessions/day
    const avgPerDay = withData.length > 0
        ? type === 'walking'
            ? Math.round(withData.reduce((s, e) => s + (e.steps ?? 0), 0) / withData.length)
            : Math.round((totalSessions / withData.length) * 10) / 10
        : 0;

    let bestDay: DailyActivityEntry | null = null;
    for (const e of withData) {
        const metric = type === 'walking' ? (e.steps ?? 0) : e.sessionCount;
        const bestMetric = bestDay
            ? (type === 'walking' ? (bestDay.steps ?? 0) : bestDay.sessionCount)
            : -1;
        if (metric > bestMetric) bestDay = e;
    }

    return { entries, totalSessions, avgPerDay, bestDay, type };
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
    source: 'healthkit' | 'health_connect' | 'fitbit' | 'strava' | 'whoop' | 'garmin' | 'polar' | 'oura' | 'huawei' | 'withings' | 'peloton' | 'zepp' | 'technogym' | 'coros' | 'suunto' | 'wahoo' | 'zwift' | 'concept2' | 'ifit' | 'underarmour';
    /**
     * Specific app/device behind a native sync ("Apple Watch", "Garmin", "iPhone").
     * Powers the admin device overview; derived from per-sample provenance. Null
     * when provenance is unavailable. See lib/health/dataSource.ts.
     */
    sourceDetail?: string;
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
        source_detail: params.sourceDetail ?? null,
    });
    if (error) console.warn('[healthSnapshot] insert failed:', error.message);
}

/**
 * Upsert today's intraday step windows (user's LOCAL date) so time-of-day
 * walking challenges can be evaluated server-side. Idempotent per (user, date).
 */
export async function saveDailyStepWindows(params: {
    date: string; // local YYYY-MM-DD
    before9am: number;
    midday12to14: number;
    after6pm: number;
}): Promise<void> {
    const { error } = await supabase
        .from('daily_step_windows')
        .upsert(
            {
                date: params.date,
                before_9am: Math.round(params.before9am),
                midday_12_14: Math.round(params.midday12to14),
                after_6pm: Math.round(params.after6pm),
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,date' },
        );
    if (error) console.warn('[stepWindows] upsert failed:', error.message);
}

export { WALKING_DAILY_CAP };

// ── Monthly home-screen summary ───────────────────────────────────────────────

export type MonthlyMetrics = {
    /** Total distinct days with any activity logged this month */
    activeDays: number;
    /** Total sessions logged this month */
    sessionCount: number;
    /** Total steps this month */
    totalSteps: number;
    /** Session counts keyed by activity type */
    perType: Record<string, number>;
    /**
     * Active-day counts per week quarter of the month:
     * index 0 = days 1-7, 1 = days 8-14, 2 = days 15-21, 3 = days 22-end
     */
    weekActiveDays: [number, number, number, number];
    /**
     * Map of day-of-month (1-based) → activity types logged that day (most-done first)
     */
    activeDayTypes: Record<number, string[]>;
    /**
     * Per-day summary: total duration (mins), steps, points, session count
     */
    dayDetails: Record<number, { totalMinutes: number; totalSteps: number; totalPoints: number; sessionCount: number }>;
};

/** Fetches all activity sessions for the current calendar month. */
export async function fetchMonthlyMetrics(): Promise<MonthlyMetrics> {
    const uid = await getCurrentUserId();
    if (!uid) return { activeDays: 0, sessionCount: 0, totalSteps: 0, perType: {}, weekActiveDays: [0, 0, 0, 0], activeDayTypes: {}, dayDetails: {} };

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at, type, steps, duration_sec, point_transactions(amount)')
        .eq('user_id', uid)
        .gte('started_at', monthStart.toISOString())
        .order('started_at', { ascending: true });
    if (error) throw error;

    const sessions = (data ?? []) as Array<{
        started_at: string;
        type: string;
        steps: number | null;
        duration_sec: number;
        point_transactions: { amount: number }[];
    }>;

    // Track which dates have been counted as "active" to avoid double-counting
    const activeDateSet = new Set<string>();
    const perType: Record<string, number> = {};
    const weekActiveDays: [number, number, number, number] = [0, 0, 0, 0];
    const activeDayTypes: Record<number, Record<string, number>> = {};
    const dayDetails: Record<number, { totalMinutes: number; totalSteps: number; totalPoints: number; sessionCount: number }> = {};
    let totalSteps = 0;

    for (const s of sessions) {
        const date = new Date(s.started_at);
        const dateKey = date.toISOString().split('T')[0];
        const dayOfMonth = date.getDate(); // 1-based

        // Week quarter: 1-7 → 0, 8-14 → 1, 15-21 → 2, 22+ → 3
        const weekIdx = Math.min(Math.floor((dayOfMonth - 1) / 7), 3) as 0 | 1 | 2 | 3;

        if (!activeDateSet.has(dateKey)) {
            activeDateSet.add(dateKey);
            weekActiveDays[weekIdx]++;
        }

        perType[s.type] = (perType[s.type] ?? 0) + 1;
        totalSteps += s.steps ?? 0;

        // Per-day detail accumulation
        const pts = (s.point_transactions ?? []).reduce((sum, t) => sum + t.amount, 0);
        if (!dayDetails[dayOfMonth]) dayDetails[dayOfMonth] = { totalMinutes: 0, totalSteps: 0, totalPoints: 0, sessionCount: 0 };
        dayDetails[dayOfMonth].totalMinutes += Math.round((s.duration_sec ?? 0) / 60);
        dayDetails[dayOfMonth].totalSteps += s.steps ?? 0;
        dayDetails[dayOfMonth].totalPoints += pts;
        dayDetails[dayOfMonth].sessionCount++;

        // Track type counts per day for activeDayTypes
        if (!activeDayTypes[dayOfMonth]) activeDayTypes[dayOfMonth] = {};
        activeDayTypes[dayOfMonth][s.type] = (activeDayTypes[dayOfMonth][s.type] ?? 0) + 1;
    }

    // Convert per-day type counts → sorted string[] (most-done first)
    const activeDayTypesSorted: Record<number, string[]> = {};
    for (const [day, typeCounts] of Object.entries(activeDayTypes)) {
        activeDayTypesSorted[Number(day)] = Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([t]) => t);
    }

    return {
        activeDays: activeDateSet.size,
        sessionCount: sessions.length,
        totalSteps,
        perType,
        weekActiveDays,
        activeDayTypes: activeDayTypesSorted,
        dayDetails,
    };
}

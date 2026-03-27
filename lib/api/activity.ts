import { supabase } from '@/lib/supabase';
import { type ActivityType } from '@/constants/activities';

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
        .order('started_at', { ascending: false })
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
    return {
        gymVisits: sessions.filter(s => s.type === 'gym').length,
        runs: sessions.filter(s => s.type === 'running').length,
        totalSteps: sessions.reduce((sum, s) => sum + (s.steps ?? 0), 0),
        sessionCount: sessions.length,
    };
}

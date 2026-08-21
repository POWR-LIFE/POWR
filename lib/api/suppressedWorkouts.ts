// ── Suppressed workouts: the run inside the gym visit ─────────────────────────
//
// A geofence check-in outranks any overlapping wearable/native workout (source-
// of-truth priority — the same time must never be paid twice), so that workout
// is recorded in suppressed_workouts instead of activity_sessions. Deliberately
// OUTSIDE the sessions table: every challenge evaluator reaches sessions through
// one shared builder, and a kept session row would complete session-count and
// combo challenges off a single visit (see migration 20260801150000).
//
// Product call (Jamie, 2026-08-21): reward the gym, record the run. These rows
// surface in history and Progress stats as real training the user did — always
// unrewarded, never read by anything that pays.

import { supabase } from '@/lib/supabase';
import type { ActivitySession } from './activity';

export type SuppressedWorkoutRow = {
    id: string;
    type: string;
    started_at: string;
    ended_at: string;
    duration_sec: number;
    distance_m: number | null;
    hr_avg: number | null;
    source: string | null;
    raw_activity_name: string | null;
};

/**
 * Whether a suppressed workout of this type surfaces in history and stats.
 *
 * A wearable "gym"/strength workout overlapping a check-in is the SAME time the
 * check-in already represents — surfacing it would show the visit twice and
 * double its minutes, which is exactly the double-count the supersede rule
 * exists to prevent. A cross-type workout (running, cycling, hiit, …) is
 * genuinely new information: the activity the user actually did inside the
 * visit. walking/sleep are day-wide aggregates and are never suppressed.
 */
export function surfacesInStats(type: string): boolean {
    return type !== 'gym' && type !== 'walking' && type !== 'sleep';
}

/**
 * Shapes a suppressed workout as an ActivitySession so every existing consumer
 * (feed, per-type charts, month heatmaps) can aggregate it unchanged. It carries
 * an empty point_transactions — everything that sums points renders it as zero —
 * and `unrewarded: true` so the feed shows an em dash instead of "+0".
 */
export function suppressedToSession(w: SuppressedWorkoutRow): ActivitySession {
    return {
        // Namespaced like the `visit:` ids so it can never collide with a real
        // activity_sessions id in a list key.
        id: `suppressed:${w.id}`,
        type: w.type,
        started_at: w.started_at,
        ended_at: w.ended_at,
        duration_sec: w.duration_sec,
        distance_m: w.distance_m,
        steps: null,
        // The provider really measured it; the check-in just outranked it.
        // healthkit/health_connect are the native store, everything else
        // arrived from a wearable via Terra.
        verification: w.source === 'healthkit' || w.source === 'health_connect' || w.source === 'health' ? 'health' : 'wearable',
        trust_score: 0.85,
        raw_activity_name: w.raw_activity_name,
        point_transactions: [],
        unrewarded: true,
        partner_name: null,
    };
}

/**
 * Suppressed workouts for the stats surfaces, best-effort by design: a failure
 * here must never blank the real history or charts it merges into, so errors
 * come back as an empty list. Per-type callers pass `type`; callers without a
 * type filter get every surfaceable type (gym/walking/sleep excluded — see
 * surfacesInStats).
 */
export async function fetchSuppressedWorkouts(
    uid: string,
    opts: { type?: string; from?: Date | string; to?: Date | string; limit?: number } = {},
): Promise<SuppressedWorkoutRow[]> {
    if (opts.type !== undefined && !surfacesInStats(opts.type)) return [];
    try {
        let q = supabase
            .from('suppressed_workouts')
            .select('id, type, started_at, ended_at, duration_sec, distance_m, hr_avg, source, raw_activity_name')
            .eq('user_id', uid)
            .order('started_at', { ascending: false });
        if (opts.type !== undefined) q = q.eq('type', opts.type);
        else q = q.not('type', 'in', '("gym","walking","sleep")');
        if (opts.from) q = q.gte('started_at', new Date(opts.from).toISOString());
        if (opts.to) q = q.lt('started_at', new Date(opts.to).toISOString());
        if (opts.limit) q = q.limit(opts.limit);
        const { data, error } = await q;
        if (error) throw error;
        return (data ?? []) as SuppressedWorkoutRow[];
    } catch (e) {
        console.warn('[suppressed] fetch failed:', e instanceof Error ? e.message : String(e));
        return [];
    }
}

export type SuppressedNativeWorkout = {
    userId: string;
    winnerSessionId: string;
    type: string;
    startedAt: string;
    endedAt: string;
    durationSec: number;
    distanceM?: number | null;
    hrAvg?: number | null;
    hrMax?: number | null;
    caloriesActive?: number | null;
    /** Provider store the workout came from ('healthkit', 'health_connect', …). */
    source?: string | null;
    rawActivityName?: string | null;
    wouldHaveEarned?: number | null;
};

/**
 * Records a native workout skipped because a geofence check-in covers its
 * window — the HealthKit/Health Connect mirror of what terra-webhook writes for
 * Terra arrivals. Idempotent on (user_id, type, started_at) via DO NOTHING: the
 * sync loop revisits a 7-day window on every run, and the RLS door is
 * INSERT-only (reason pinned, overlapping own check-in required), so a recorded
 * row is immutable to its author. Best-effort: failing to record must never
 * block the sync that skipped the workout.
 */
export async function recordSuppressedNativeWorkout(w: SuppressedNativeWorkout): Promise<void> {
    if (w.durationSec <= 0) return; // table CHECK would refuse it anyway
    const { error } = await supabase
        .from('suppressed_workouts')
        .upsert({
            user_id: w.userId,
            winner_session_id: w.winnerSessionId,
            type: w.type,
            started_at: w.startedAt,
            ended_at: w.endedAt,
            duration_sec: w.durationSec,
            distance_m: w.distanceM != null ? Math.round(w.distanceM) : null,
            hr_avg: w.hrAvg != null ? Math.round(w.hrAvg) : null,
            hr_max: w.hrMax != null ? Math.round(w.hrMax) : null,
            calories_active: w.caloriesActive != null ? Math.round(w.caloriesActive) : null,
            source: w.source ?? null,
            raw_activity_name: w.rawActivityName?.trim().slice(0, 80) || null,
            reason: 'overlaps_geofence_checkin_native',
            would_have_earned: w.wouldHaveEarned ?? null,
        }, { onConflict: 'user_id,type,started_at', ignoreDuplicates: true });
    if (error) console.warn('[suppressed] record failed:', error.message);
}

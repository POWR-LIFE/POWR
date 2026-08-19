/**
 * Gives a geofence gym check-in the heart rate and calories the phone's health
 * store recorded while the user was inside.
 *
 * A check-in proves presence; it cannot measure effort. The wearable's own
 * telling of that hour is deliberately never a session (it would pay the same
 * time twice), so a check-in showed no vitals at all — even though half of them
 * come from people whose watch was running the whole visit. Terra providers now
 * reach the sheet via suppressed_workouts; this is the native half: read the
 * check-in's exact `started_at..ended_at` window out of HealthKit / Health
 * Connect and link the result to the session. No watch workout is needed — the
 * window is the session, so the user only has to have worn the watch.
 *
 * Runs in the foreground off the back of the health sync, AFTER gymReconcile
 * has corrected the session's window (the read is over the corrected span).
 * Best-effort, idempotent, write-once per session:
 *  - only CLOSED visits (the live one is still growing; a partial read would
 *    freeze at the moment of the sync),
 *  - only sessions with no linked snapshot carrying vitals yet,
 *  - only when the window actually measured something — a watch that hasn't
 *    synced to the phone yet reads as nothing, and "nothing" is not written, so
 *    the next sync simply tries again.
 *
 * Points are never touched. This is data for the Progress sheet, nothing else.
 */

import { Platform } from 'react-native';

import { saveHealthSnapshot } from '@/lib/api/activity';
import { getSessionUser, supabase } from '@/lib/supabase';

import { readWindowVitals, SESSION_SCOPED_EXTRAS } from './windowVitals';

/** How far back to look. A visit from a few days ago still deserves its numbers. */
const LOOKBACK_DAYS = 7;
/**
 * Let the watch finish syncing the visit to the phone before reading it. Apple
 * Watch → iPhone HR samples can lag the visit's end by several minutes; reading
 * at the first foreground tick after exit would capture half a session and,
 * being write-once, keep it.
 */
const SETTLE_MS = 15 * 60 * 1000;
const MAX_PER_PASS = 5;
/**
 * Mirrors MAX_GYM_SESSION_SEC. A row AT the backstop was clamped after a missed
 * exit, not measured — reading 12 h of heart rate would just restate the day.
 */
const GYM_BACKSTOP_SEC = 12 * 60 * 60;

type GymSessionRow = {
    id: string;
    started_at: string;
    ended_at: string | null;
    duration_sec: number;
    health_snapshots: { hr_avg: number | null; calories_active: number | null }[] | null;
};

/**
 * Attaches window-read vitals to recent closed geofence gym sessions that have
 * none. Failures are swallowed — this must never block the sync around it.
 */
export async function captureRecentGymVitals(now: number = Date.now()): Promise<void> {
    if (Platform.OS === 'web') return;
    // Scoped on user_id explicitly: activity_sessions carries an admin read-all
    // policy, so an unfiltered query hands an admin other users' sessions.
    const user = await getSessionUser();
    if (!user) return;

    const since = new Date(now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from('activity_sessions')
        .select('id, started_at, ended_at, duration_sec, health_snapshots(hr_avg, calories_active)')
        .eq('user_id', user.id)
        .eq('type', 'gym')
        .eq('verification', 'geofence')
        .gte('started_at', since)
        .order('started_at', { ascending: false })
        .limit(20);
    if (error || !data) return;

    const candidates = (data as GymSessionRow[]).filter(s => {
        const hasVitals = (s.health_snapshots ?? []).some(h => h.hr_avg != null || h.calories_active != null);
        if (hasVitals) return false;
        if ((s.duration_sec ?? 0) >= GYM_BACKSTOP_SEC) return false;
        const endMs = s.ended_at
            ? new Date(s.ended_at).getTime()
            : new Date(s.started_at).getTime() + (s.duration_sec ?? 0) * 1000;
        return endMs + SETTLE_MS <= now;
    });
    if (candidates.length === 0) return;

    // A session is closed only when no visit is still open on it. gym_visits is
    // the authority — a session row's ended_at is written at claim time and then
    // ratcheted by upgrades, so it can read as "ended" under a live visit.
    const { data: live } = await supabase
        .from('gym_visits')
        .select('claimed_session_id')
        .eq('user_id', user.id)
        .is('ended_at', null)
        .in('claimed_session_id', candidates.map(s => s.id));
    const liveIds = new Set((live ?? []).map(v => v.claimed_session_id).filter(Boolean));

    const source = Platform.OS === 'ios' ? 'healthkit' : 'health_connect';
    let written = 0;
    for (const s of candidates) {
        if (written >= MAX_PER_PASS) break;
        if (liveIds.has(s.id)) continue;
        try {
            const startMs = new Date(s.started_at).getTime();
            const endMs = s.ended_at ? new Date(s.ended_at).getTime() : startMs + s.duration_sec * 1000;
            const vitals = await readWindowVitals(startMs, endMs);
            if (!vitals) continue; // nothing measured (yet) — try again next sync

            await saveHealthSnapshot({
                sessionId: s.id,
                hrAvg: vitals.hrAvg ?? undefined,
                hrMax: vitals.hrMax ?? undefined,
                caloriesActive: vitals.caloriesActive ?? undefined,
                activityType: 'gym',
                durationSec: Math.round((endMs - startMs) / 1000),
                source,
                extras: { ...SESSION_SCOPED_EXTRAS },
            });
            written++;
            console.log(
                `[gymVitals] ${s.id.slice(0, 8)}… ${vitals.hrAvg ?? '—'} bpm / ${vitals.caloriesActive ?? '—'} kcal over ${Math.round((endMs - startMs) / 60000)}m`,
            );
        } catch (e) {
            console.warn('[gymVitals] capture failed:', e);
        }
    }
}

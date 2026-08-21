import { type ActivityType } from '@/constants/activities';
import { getDeviceId } from '@/lib/device';
import { emitPointsChanged } from '@/lib/pointsEvents';
import { dayAnchor, monthAnchorEnd, monthAnchorStart, weekAnchorMonday } from '@/lib/progressLookback';
import { getSessionUser, supabase } from '@/lib/supabase';
import {
    fetchSuppressedWorkouts,
    recordSuppressedNativeWorkout,
    suppressedToSession,
} from '@/lib/api/suppressedWorkouts';
import { mergeWorkouts, relateWorkouts } from '@/shared/sessionMerge';

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
    raw_activity_name: string | null;
    point_transactions: { amount: number }[];
    /** A session that could never earn: a gym visit under the dwell threshold
     *  (or on a day already banked), or a workout suppressed because a geofence
     *  check-in covered its window — the check-in was paid, the workout is
     *  recorded. It still happened, so it still shows. Absent/false on
     *  everything from activity_sessions. */
    unrewarded?: boolean;
    /** Venue name, only carried by unrewarded visits (sessions render the type). */
    partner_name?: string | null;
};

async function getCurrentUserId(): Promise<string | null> {
    const user = await getSessionUser();
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

/** Recent activity, INCLUDING sessions that earned nothing:
 *
 *  1. Gym visits under the dwell threshold (or on a day already banked). They
 *     produce no activity_sessions row at all — finalizeActiveGeofence returns
 *     at `if (!needsClaim)` — and the day-uniqueness index means a second visit
 *     the same day cannot create one either. Jamie, 2026-08-08: "we should
 *     still record session lengths even if they can't be rewarded points."
 *     gym_visits already holds started_at/ended_at, so this only surfaces them.
 *
 *  2. Suppressed workouts — the run a wearable recorded inside a geofence
 *     check-in. The check-in outranks it so the workout is never a session and
 *     never pays (the time must not be paid twice), but it IS the honest record
 *     of what the user actually did in there. Jamie, 2026-08-21: "reward the
 *     gym, record the run." Same-type (gym) suppressions stay hidden — the
 *     check-in already shows that time (see surfacesInStats).
 *
 *  Both carry an empty point_transactions, so every consumer that sums points
 *  already renders them as zero, and both DO count toward the session count and
 *  average duration on progress-detail — they are sessions the user did.
 */
export async function fetchRecentSessions(limit = 5): Promise<ActivitySession[]> {
    const uid = await getCurrentUserId();
    if (!uid) return [];

    const [sessionsRes, visitsRes, suppressed] = await Promise.all([
        supabase
            .from('activity_sessions')
            .select('id, type, started_at, ended_at, duration_sec, distance_m, steps, verification, trust_score, raw_activity_name, point_transactions(amount)')
            .eq('user_id', uid)
            .order('ended_at', { ascending: false, nullsFirst: false })
            .limit(limit),
        // Closed visits that never produced a session. Best-effort by design: a
        // failure here must never blank the real history below it.
        supabase
            .from('gym_visits')
            .select('id, started_at, ended_at, partners(name)')
            .eq('user_id', uid)
            .is('claimed_session_id', null)
            .not('ended_at', 'is', null)
            .order('ended_at', { ascending: false })
            .limit(limit),
        fetchSuppressedWorkouts(uid, { limit }),
    ]);

    if (sessionsRes.error) throw sessionsRes.error;
    const sessions = (sessionsRes.data ?? []) as ActivitySession[];
    if (visitsRes.error) return sessions;

    // ⚠ DEDUPE AGAINST REAL SESSIONS. A visit with claimed_session_id null is not
    // proof the time was unrewarded — the 2026-08-08 duplicate-visit bug produced
    // a SECOND unclaimed row covering the exact span of a claimed 60-minute
    // session, and rendering that would show the user a phantom hour they never
    // did twice. Overlap with any known session disqualifies it.
    const spans = sessions
        .filter(s => s.started_at && s.ended_at)
        .map(s => [Date.parse(s.started_at), Date.parse(s.ended_at)] as const)
        .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));

    const unrewarded: ActivitySession[] = [];
    for (const v of (visitsRes.data ?? []) as Array<{
        id: string; started_at: string; ended_at: string;
        partners?: { name?: string | null } | { name?: string | null }[] | null;
    }>) {
        const start = Date.parse(v.started_at);
        const end = Date.parse(v.ended_at);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        if (spans.some(([a, b]) => start < b && end > a)) continue;

        const partner = Array.isArray(v.partners) ? v.partners[0] : v.partners;
        unrewarded.push({
            // Namespaced so it can never collide with an activity_sessions id —
            // these are list keys, and a duplicate key silently drops a row.
            id: `visit:${v.id}`,
            type: 'gym',
            started_at: v.started_at,
            ended_at: v.ended_at,
            duration_sec: Math.round((end - start) / 1000),
            distance_m: null,
            steps: null,
            verification: 'geofence',
            trust_score: 0.94,
            raw_activity_name: null,
            point_transactions: [],
            unrewarded: true,
            partner_name: partner?.name ?? null,
        });
    }

    // Suppressed workouts are NOT overlap-deduped: they overlap their winning
    // check-in by definition, and showing both is the point — the visit that was
    // rewarded, and the run that was recorded.
    const extras = [...unrewarded, ...suppressed.map(suppressedToSession)];
    if (extras.length === 0) return sessions;
    return [...sessions, ...extras]
        .sort((a, b) => Date.parse(b.ended_at ?? '') - Date.parse(a.ended_at ?? ''))
        .slice(0, limit);
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
    /**
     * Points earned from this week's sessions, keyed by activity type. Only
     * covers session-linked transactions, so these will not sum to the weekly
     * total from get_my_points_summary (challenge rewards, referrals and other
     * standalone bonuses have no session to attribute them to).
     */
    pointsPerType: Record<string, number>;
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

    const [{ data, error }, suppressed] = await Promise.all([
        supabase
            .from('activity_sessions')
            .select('type, steps')
            .eq('user_id', uid)
            .gte('started_at', start.toISOString()),
        fetchSuppressedWorkouts(uid, { from: start }),
    ]);
    if (error) throw error;

    const perType: Record<string, number> = {};
    let stepsToday = 0;
    const rows = [
        ...((data ?? []) as Array<{ type: string; steps: number | null }>),
        // The run inside a gym visit counts as a session done, just not paid.
        ...suppressed.map(w => ({ type: w.type, steps: null })),
    ];
    for (const s of rows) {
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
    /**
     * Extra vitals carried only so a workout suppressed by a geofence check-in
     * can be recorded with them (suppressed_workouts is then the ONLY holder of
     * this effort's figures — no session row, no snapshot). A recorded session
     * gets its vitals through saveHealthSnapshot instead, as before.
     */
    hr_max?: number;
    calories_active?: number;
    /** Provider store the data came from ('healthkit', 'health_connect', …). */
    source?: string;
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
    /** Provider-reported activity name before bucketing (e.g. "Strength Training"). */
    rawActivityName?: string;
    /**
     * Prices a session of a given length and distance, for the case where this
     * workout turns out to continue one we already hold and the merged session is
     * worth more than the half we were paid for (4 km + 6 km crosses the 10 km
     * rung; 25 + 20 min of gym crosses the upgrade tier). Passed in rather than
     * imported because the scoring table lives in the caller — useHealthSync owns
     * the client mirror of _shared/points.ts, and importing it here would close a
     * cycle.
     */
    pointsFor?: (durationMin: number, distanceM: number | null) => number;
};

/** Max unverified manual logs allowed per calendar day (across all types). */
const DAILY_MANUAL_CAP = 1;

/**
 * Fold a health-synced workout into the session it continues, when it continues
 * one. Returns true if it was absorbed and the caller should NOT insert a row.
 *
 * Two things arrive here that are not new workouts: a watch restating a session
 * it already sent (a slightly different window for the same effort), and the
 * second half of a workout the user stopped and restarted — a run paused for a
 * phone call comes out of HealthKit as two workouts, not one.
 *
 * Before 2026-08-07 neither could be expressed: wearable rows were unique per
 * (user, type, UTC day), so the second one raised a 23505 that logManualSession
 * swallowed with a `return null`. The workout was not merged, not recorded, not
 * logged — a 10 k run interrupted by a call was simply stored as half of itself
 * (Sorine, 2026-08-06). The index now keys workouts on their start instant, so
 * this is where the two halves are put back together.
 *
 * relateWorkouts/mergeWorkouts are shared with terra-webhook via the mirrored
 * shared/sessionMerge.js so the Terra and native paths cannot disagree about
 * what counts as one workout.
 */
async function absorbIntoExistingWorkout(
    params: ManualSessionParams, endedAt: string, uid: string,
): Promise<boolean> {
    const incoming = {
        startMs: new Date(params.started_at).getTime(),
        endMs: new Date(endedAt).getTime(),
        durationSec: params.duration_sec,
        distanceM: params.distance_m ?? null,
        hrAvg: params.hr_avg ?? null,
    };

    const { data: candidates } = await supabase
        .from('activity_sessions')
        .select('id, started_at, ended_at, duration_sec, distance_m, hr_avg')
        .eq('user_id', uid)
        .eq('type', params.type)
        .in('verification', ['wearable', 'health'])
        .gte('started_at', new Date(incoming.startMs - 24 * 60 * 60 * 1000).toISOString())
        .lte('started_at', new Date(incoming.endMs + 24 * 60 * 60 * 1000).toISOString());

    let target: { row: any; existing: any; relation: 'same' | 'contiguous'; gap: number } | null = null;
    for (const row of candidates ?? []) {
        const startMs = new Date(row.started_at).getTime();
        const existing = {
            startMs,
            endMs: row.ended_at
                ? new Date(row.ended_at).getTime()
                : startMs + (row.duration_sec ?? 0) * 1000,
            durationSec: row.duration_sec ?? 0,
            distanceM: row.distance_m,
            hrAvg: row.hr_avg,
        };
        const relation = relateWorkouts(existing, incoming);
        if (relation === 'separate') continue;
        // An overlap is the same activity told twice — settled, stop looking.
        if (relation === 'same') { target = { row, existing, relation, gap: 0 }; break; }
        const gap = incoming.startMs >= existing.endMs
            ? incoming.startMs - existing.endMs
            : existing.startMs - incoming.endMs;
        if (!target || gap < target.gap) target = { row, existing, relation, gap };
    }
    if (!target) return false;

    const merged = mergeWorkouts(target.existing, incoming, target.relation);
    if (!merged.changed) return true; // a re-sync of something we already hold

    const patch: Record<string, unknown> = {
        started_at: new Date(merged.startMs).toISOString(),
        ended_at: new Date(merged.endMs).toISOString(),
        duration_sec: merged.durationSec,
    };
    if (merged.distanceM != null) patch.distance_m = Math.round(merged.distanceM);
    if (merged.hrAvg != null) patch.hr_avg = merged.hrAvg;
    const { error } = await supabase.from('activity_sessions').update(patch).eq('id', target.row.id);
    if (error) {
        console.warn('[activity] workout merge failed:', error.message);
        return false; // fall through and record it as its own session rather than lose it
    }

    // Top up to what the merged session is worth. The ledger, not a
    // recomputation, says what it has already been paid — and
    // enforce_point_award_cap silently clamps or cancels the insert if the day's
    // ceiling for this type is already met, so this cannot overpay.
    const priced = params.pointsFor?.(merged.durationSec / 60, merged.distanceM);
    if (priced != null && priced > 0) {
        const { data: earns } = await supabase
            .from('point_transactions')
            .select('amount')
            .eq('session_id', target.row.id)
            .eq('type', 'earn');
        const already = (earns ?? []).reduce((sum, t) => sum + (t.amount ?? 0), 0);
        if (priced > already) {
            const { error: ptError } = await supabase.from('point_transactions').insert({
                session_id: target.row.id,
                amount: priced - already,
                type: 'earn',
                source: 'health_sync',
            });
            if (ptError) console.warn('[activity] merge top-up failed:', ptError.message);
            else emitPointsChanged();
        }
    }

    console.log(
        `[activity] ${target.relation === 'contiguous' ? 'stitched split' : 'restated'} `
        + `${params.type} into ${target.row.id}: ${target.existing.durationSec}s → ${merged.durationSec}s`,
    );
    return true;
}

/**
 * Records a session. Returns the new session's id, or null when nothing was
 * written (already synced, or superseded by a higher-trust source).
 *
 * The id is returned so callers can pass it to `saveHealthSnapshot` as
 * `sessionId` — that link is what lets the Progress day sheet show a session's
 * heart rate and calories. Callers that only care whether a row was created can
 * keep testing truthiness.
 */
export async function logManualSession(params: ManualSessionParams): Promise<string | null> {
    // ended_at is the activity's true end (start + duration), NOT the moment we
    // happen to sync it. Using `now` made backfilled health sessions span hours/
    // days of wall-clock (e.g. a sleep "ending" at sync time, days after the
    // bedtime) and surfaced a wrong wake time in the sleep detail view. For
    // manual logs started_at is already (now - duration), so this is unchanged.
    const ended_at = new Date(new Date(params.started_at).getTime() + params.duration_sec * 1000).toISOString();
    const verification = params.healthVerified ? (params.healthSource ?? 'health') : 'manual';
    const trust_score = params.healthVerified ? 0.85 : 0.55;
    const device_id = await getDeviceId();

    // Source-of-truth priority is geofence > wearable/health > manual. A geofence
    // gym check-in is the authoritative record of that time at the gym, so a
    // health-verified workout syncing AFTER the check-in was claimed must not be
    // recorded alongside it (claim-points supersedes in the reverse arrival order,
    // and terra-webhook applies the same suppression for Terra-delivered
    // wearables). Type-agnostic for the same reason as the manual guard below;
    // walking is a daily aggregate and sleep never belongs to a check-in, so both
    // are exempt HERE (sleep still gets the absorb test, just below). Skip
    // silently — the check-in already counted this time.
    if (params.healthVerified && params.type !== 'walking' && params.type !== 'sleep') {
        const uid = (await getCurrentUserId()) ?? '';
        const startMs = new Date(params.started_at).getTime();
        const endMs = new Date(ended_at).getTime();
        const { data: checkIns } = await supabase
            .from('activity_sessions')
            .select('id, started_at, ended_at, duration_sec')
            .eq('user_id', uid)
            .eq('verification', 'geofence')
            .gte('started_at', new Date(startMs - 24 * 60 * 60 * 1000).toISOString())
            .lte('started_at', new Date(endMs + 24 * 60 * 60 * 1000).toISOString());
        const winningCheckIn = (checkIns ?? []).find(s => {
            const sStart = new Date(s.started_at).getTime();
            const sEnd = s.ended_at
                ? new Date(s.ended_at).getTime()
                : sStart + (s.duration_sec ?? 0) * 1000;
            return startMs < sEnd && endMs > sStart;
        });
        if (winningCheckIn) {
            console.log(`[activity] suppressing health-synced ${params.type} ${params.started_at} — overlaps geofence check-in`);
            // Reward the gym, record the run (Jamie, 2026-08-21). The check-in
            // stays the only payer for this time, but the workout must not
            // vanish: record it against the winning check-in exactly as
            // terra-webhook does for Terra arrivals, so it surfaces in history
            // and Progress stats as an unrewarded session.
            await recordSuppressedNativeWorkout({
                userId: uid,
                winnerSessionId: winningCheckIn.id,
                type: params.type,
                startedAt: params.started_at,
                endedAt: ended_at,
                durationSec: params.duration_sec,
                distanceM: params.distance_m ?? null,
                hrAvg: params.hr_avg ?? null,
                hrMax: params.hr_max ?? null,
                caloriesActive: params.calories_active ?? null,
                source: params.source ?? null,
                rawActivityName: params.rawActivityName ?? null,
                wouldHaveEarned: params.points,
            });
            return null;
        }

        // Not a new workout if it continues one we already hold — the second half
        // of a run the user paused, or the same session restated. Absorbed into
        // that row rather than becoming a second one; returns null for the same
        // reason the branch above does, so the caller writes no extra snapshot.
        if (await absorbIntoExistingWorkout(params, ended_at, uid)) return null;
    }

    // Sleep gets the absorb test but NOT the geofence suppression above — a night
    // never belongs to a gym check-in, and sleep must never be suppressed by one.
    //
    // Until 2026-08-21 a night synced here could not duplicate a Terra-delivered
    // one: both were 0.85 and the per-type-per-day unique index folded the second
    // into a 23505 we swallow below. Migration 20260821140000 took wearable sleep
    // out of that day bucket (a nap was silently eating that night's sleep), so a
    // HealthKit night at 22:03 and the same Whoop night at 22:01 would now be two
    // rows. Overlap is what separates them instead — the same test terra-webhook
    // runs server-side, so whichever source arrives second folds into the first.
    if (params.healthVerified && params.type === 'sleep') {
        const uid = (await getCurrentUserId()) ?? '';
        if (await absorbIntoExistingWorkout(params, ended_at, uid)) return null;
    }

    // A manual log must never be created when a higher-trust source (geofence
    // check-in, wearable, or native health sync) already covers the same activity.
    // We guard manual logs two ways below.
    if (!params.healthVerified) {
        const uid = (await getCurrentUserId()) ?? '';

        // 1. Anti-abuse: cap unverified manual logs at DAILY_MANUAL_CAP per calendar
        //    day, counted across all activity types.
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);

        const { count, error: countError } = await supabase
            .from('activity_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', uid)
            .eq('verification', 'manual')
            .gte('started_at', dayStart.toISOString());

        if (!countError && (count ?? 0) >= DAILY_MANUAL_CAP) {
            throw new Error(
                "You've already logged a session manually today. " +
                'Connect a health provider to log unlimited sessions automatically.',
            );
        }

        // 2. Don't shadow a higher-trust source: if a geofence check-in, wearable,
        //    or native-health session overlaps this window, it's the same time
        //    tracked more reliably — refuse the manual log regardless of how each
        //    side is typed. You can't be at a gym check-in and running outdoors at
        //    once, and a wearable may classify the same gym visit as cycling/hiit/
        //    yoga/etc — so this is type-agnostic, mirroring the geofenceSupersedes
        //    rule applied server-side on claim (see _shared/sessionPriority.ts).
        //    Only workout logs are guarded: `walking`/`sleep` are daily aggregates
        //    whose windows span hours/days and would always "overlap", and they're
        //    likewise excluded from the candidate set below.
        if (params.type !== 'walking' && params.type !== 'sleep') {
            const startMs = new Date(params.started_at).getTime();
            const endMs = new Date(ended_at).getTime();
            const { data: higherTrust } = await supabase
                .from('activity_sessions')
                .select('started_at, ended_at, duration_sec')
                .eq('user_id', uid)
                .not('type', 'in', '("walking","sleep")')
                .in('verification', ['geofence', 'wearable', 'health'])
                .gte('started_at', new Date(startMs - 24 * 60 * 60 * 1000).toISOString())
                .lte('started_at', new Date(endMs + 24 * 60 * 60 * 1000).toISOString());
            const overlaps = (higherTrust ?? []).some(s => {
                const sStart = new Date(s.started_at).getTime();
                const sEnd = s.ended_at
                    ? new Date(s.ended_at).getTime()
                    : sStart + (s.duration_sec ?? 0) * 1000;
                return startMs < sEnd && endMs > sStart;
            });
            if (overlaps) {
                throw new Error(
                    'This time is already tracked automatically by a check-in or your connected device.',
                );
            }
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
            raw_activity_name: params.rawActivityName?.trim().slice(0, 80) || null,
        })
        .select('id')
        .single();
    if (sessionError) {
        // Already recorded — skip silently. For a health-synced workout that now
        // means an identical start instant (the same session re-synced, or a race
        // with another device); anything merely NEAR an existing session was
        // absorbed above rather than reaching here. For manual logs and walking it
        // still means the day already holds one.
        if (sessionError.code === '23505') return null;
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

    return session.id as string;
}

export async function fetchWeeklyMetrics(): Promise<WeeklyMetrics> {
    const uid = await getCurrentUserId();
    if (!uid) return { gymVisits: 0, runs: 0, totalSteps: 0, sessionCount: 0, perType: {}, activeDaysPerType: {}, pointsPerType: {} };
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const [{ data, error }, suppressed] = await Promise.all([
        supabase
            .from('activity_sessions')
            .select('type, steps, started_at, point_transactions(amount)')
            .eq('user_id', uid)
            .gte('started_at', monday.toISOString()),
        fetchSuppressedWorkouts(uid, { from: monday }),
    ]);
    if (error) throw error;

    const sessions = [
        ...((data ?? []) as unknown as {
            type: string;
            steps: number | null;
            started_at: string;
            point_transactions: { amount: number }[] | null;
        }[]),
        // Suppressed workouts count as sessions done (a run inside a gym visit
        // IS a run); their empty transactions keep every points figure honest.
        ...suppressed.map(w => ({
            type: w.type,
            steps: null,
            started_at: w.started_at,
            point_transactions: [] as { amount: number }[],
        })),
    ];
    const perType: Record<string, number> = {};
    const activeDaysPerType: Record<string, boolean[]> = {};
    const pointsPerType: Record<string, number> = {};
    for (const s of sessions) {
        perType[s.type] = (perType[s.type] ?? 0) + 1;
        if (!activeDaysPerType[s.type]) {
            activeDaysPerType[s.type] = [false, false, false, false, false, false, false];
        }
        const d = new Date(s.started_at).getDay();
        activeDaysPerType[s.type][d === 0 ? 6 : d - 1] = true;
        // Any transaction written against the session counts towards its type —
        // that includes streak bonuses awarded on the back of the session.
        const sessionPoints = (s.point_transactions ?? []).reduce((sum, t) => sum + t.amount, 0);
        pointsPerType[s.type] = (pointsPerType[s.type] ?? 0) + sessionPoints;
    }
    return {
        gymVisits: perType['gym'] ?? 0,
        runs: perType['running'] ?? 0,
        totalSteps: sessions.reduce((sum, s) => sum + (s.steps ?? 0), 0),
        sessionCount: sessions.length,
        perType,
        activeDaysPerType,
        pointsPerType,
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

/**
 * Returns a YYYY-MM-DD string in the device's local timezone.
 *
 * Exported because the month heatmaps build their grid keys by stepping a
 * local-midnight cursor: `toISOString()` there yields the PREVIOUS day anywhere
 * east of Greenwich (local midnight BST = 23:00Z), which shifted every cell one
 * column right of its real date.
 */
export function localDateStr(d: Date): string {
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
 * The health-sync walking session (if any) for one local day, plus the total
 * walking points already earned that day across ALL walking sources — the
 * per-day figure the daily cap is enforced against. Used by the backfill to
 * top up days that synced partially and then never again.
 */
export async function getWalkingDaySummary(
    dayStartIso: string,
    dayEndIso: string,
): Promise<{ session: HealthWalkingSession | null; dayPoints: number }> {
    const uid = await getCurrentUserId();
    if (!uid) return { session: null, dayPoints: 0 };
    const { data } = await supabase
        .from('activity_sessions')
        .select('id, steps, trust_score, point_transactions(amount, type)')
        .eq('user_id', uid)
        .eq('type', 'walking')
        .gte('started_at', dayStartIso)
        .lt('started_at', dayEndIso);

    let session: HealthWalkingSession | null = null;
    let dayPoints = 0;
    for (const row of (data ?? []) as Array<{ id: string; steps: number | null; trust_score: number | string | null; point_transactions?: { amount: number; type: string }[] }>) {
        const earned = (row.point_transactions ?? [])
            .filter(t => t.type === 'earn')
            .reduce((s, t) => s + t.amount, 0);
        dayPoints += earned;
        if (Number(row.trust_score) === 0.9) {
            session = { id: row.id, steps: row.steps ?? 0, points: earned };
        }
    }
    return { session, dayPoints };
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
        // A foreground sync just earned points (and may have crossed a level) —
        // refresh the shared ['points'] cache so the home readout catches up.
        emitPointsChanged();
    }
    return session.id;
}

/** Updates step count on an existing session and awards incremental points. */
export async function updateHealthWalkingSession(
    sessionId: string,
    steps: number,
    additionalPoints: number,
    endedAt?: string,
): Promise<void> {
    // A past-day top-up passes that day's end so ended_at stays inside its day.
    const end = endedAt ?? new Date().toISOString();
    const { error } = await supabase
        .from('activity_sessions')
        .update({ steps, ended_at: end })
        .eq('id', sessionId);
    if (error) console.warn('[walkingSync] session update failed:', error.message);

    if (additionalPoints > 0) {
        await supabase
            .from('point_transactions')
            .insert({ session_id: sessionId, amount: additionalPoints, type: 'earn', source: 'health_sync' });
        emitPointsChanged();
    }
}

// ── Streak helper (called by walking auto-sync) ────────────────────────────

/** Marks today as an active streak day. Idempotent — safe to call repeatedly. */
export async function updateStreakForToday(): Promise<void> {
    const user = await getSessionUser();
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

    const user = await getSessionUser();
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
 * Returns the `days` days of walking data before `before` (default today,
 * which is excluded), aggregated by date with step counts and points earned.
 */
export async function fetchRecentWalkingHistory(days = 5, before?: Date): Promise<DailyWalkingHistory[]> {
    const uid = await getCurrentUserId();
    if (!uid) return [];

    const todayStart = new Date(before ?? new Date());
    todayStart.setHours(0, 0, 0, 0);

    const rangeStart = new Date(todayStart);
    rangeStart.setDate(rangeStart.getDate() - days);

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
        const d = new Date(todayStart);
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

// ── Anchored week data (Week view lookback) ──────────────────────────────────

export type WeekActivityData = {
    /** Mon–Sun active-day booleans */
    activeDays: boolean[];
    sessionCount: number;
    totalDurationMin: number;
    /** Session-linked points earned that week for this type */
    points: number;
    /** Mon–Sun points (same total as `points`, split by day) */
    pointsPerDay: number[];
    /** Mon–Sun session durations in minutes */
    durationPerDay: number[];
    /** Mon–Sun session counts */
    sessionsPerDay: number[];
    /** Mon–Sun step counts (walking only; zeros otherwise) */
    stepsPerDay: number[];
    totalSteps: number;
};

/**
 * Fetches one Mon–Sun week of sessions for a type, anchored at `weekStart`
 * (a local-midnight Monday). Powers the Week view when looking back at past
 * weeks; the current week keeps using the live hooks.
 */
export async function fetchWeekActivityData(type: ActivityType, weekStart: Date): Promise<WeekActivityData> {
    const empty: WeekActivityData = {
        activeDays: [false, false, false, false, false, false, false],
        sessionCount: 0,
        totalDurationMin: 0,
        points: 0,
        pointsPerDay: [0, 0, 0, 0, 0, 0, 0],
        durationPerDay: [0, 0, 0, 0, 0, 0, 0],
        sessionsPerDay: [0, 0, 0, 0, 0, 0, 0],
        stepsPerDay: [0, 0, 0, 0, 0, 0, 0],
        totalSteps: 0,
    };
    const uid = await getCurrentUserId();
    if (!uid) return empty;

    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    const [{ data, error }, suppressed] = await Promise.all([
        supabase
            .from('activity_sessions')
            .select('started_at, duration_sec, steps, point_transactions(amount)')
            .eq('user_id', uid)
            .eq('type', type)
            .gte('started_at', start.toISOString())
            .lt('started_at', end.toISOString()),
        fetchSuppressedWorkouts(uid, { type, from: start, to: end }),
    ]);
    if (error) throw error;

    const result: WeekActivityData = {
        ...empty,
        activeDays: [...empty.activeDays],
        pointsPerDay: [...empty.pointsPerDay],
        durationPerDay: [...empty.durationPerDay],
        sessionsPerDay: [...empty.sessionsPerDay],
        stepsPerDay: [...empty.stepsPerDay],
    };
    const weekRows = [
        ...((data ?? []) as Array<{ started_at: string; duration_sec: number | null; steps: number | null; point_transactions: { amount: number }[] }>),
        // Workouts a check-in suppressed still count as training done that week.
        ...suppressed.map(w => ({
            started_at: w.started_at,
            duration_sec: w.duration_sec,
            steps: null,
            point_transactions: [] as { amount: number }[],
        })),
    ];
    for (const s of weekRows) {
        const d = new Date(s.started_at).getDay();
        const idx = d === 0 ? 6 : d - 1; // Mon=0 … Sun=6
        const pts = (s.point_transactions ?? []).reduce((sum, t) => sum + t.amount, 0);
        const durMin = Math.round((s.duration_sec ?? 0) / 60);
        result.activeDays[idx] = true;
        result.sessionCount++;
        result.sessionsPerDay[idx]++;
        result.totalDurationMin += durMin;
        result.durationPerDay[idx] += durMin;
        result.points += pts;
        result.pointsPerDay[idx] += pts;
        result.stepsPerDay[idx] += s.steps ?? 0;
        result.totalSteps += s.steps ?? 0;
    }
    return result;
}

// ── Recent workout history (Day view) ────────────────────────────────────────

export type DailyWorkoutHistory = {
    date: string;           // YYYY-MM-DD
    sessions: number;
    totalDurationMin: number;
    points: number;
};

/**
 * Returns the `days` days of workout sessions before `before` (default today,
 * which is excluded) for the given activity type, grouped by date.
 */
export async function fetchRecentWorkoutHistory(type: ActivityType, days = 5, before?: Date): Promise<DailyWorkoutHistory[]> {
    const uid = await getCurrentUserId();
    if (!uid) return [];

    // Exclude the anchor day itself — it already appears in the big "TODAY'S …"
    // metric above the list. (Matches fetchRecentWalkingHistory /
    // fetchRecentSleepHistory, which also stop at the day before.)
    const todayStart = new Date(before ?? new Date());
    todayStart.setHours(0, 0, 0, 0);

    const rangeStart = new Date(todayStart);
    rangeStart.setDate(rangeStart.getDate() - days);

    const [{ data, error }, suppressed] = await Promise.all([
        supabase
            .from('activity_sessions')
            .select('started_at, duration_sec, point_transactions(amount)')
            .eq('user_id', uid)
            .eq('type', type)
            .gte('started_at', rangeStart.toISOString())
            .lt('started_at', todayStart.toISOString())
            .order('started_at', { ascending: true }),
        fetchSuppressedWorkouts(uid, { type, from: rangeStart, to: todayStart }),
    ]);
    if (error) throw error;

    const historyRows = [
        ...((data ?? []) as Array<{ started_at: string; duration_sec: number | null; point_transactions: { amount: number }[] }>),
        ...suppressed.map(w => ({
            started_at: w.started_at,
            duration_sec: w.duration_sec,
            point_transactions: [] as { amount: number }[],
        })),
    ];
    const byDate = new Map<string, { sessions: number; durationMin: number; points: number }>();
    for (const s of historyRows) {
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
        const d = new Date(todayStart);
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
 * Returns the `days` nights of sleep data before `before` (default today, which
 * is excluded — it already appears in the big metric above the list), aggregated
 * by date. Mirrors fetchRecentWorkoutHistory.
 */
export async function fetchRecentSleepHistory(days = 5, before?: Date): Promise<DailySleepHistory[]> {
    const uid = await getCurrentUserId();
    if (!uid) return [];

    const todayStart = new Date(before ?? new Date());
    todayStart.setHours(0, 0, 0, 0);

    const rangeStart = new Date(todayStart);
    rangeStart.setDate(rangeStart.getDate() - days);

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
        const d = new Date(todayStart);
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
export async function fetchWeeklySleepHours(
    monday: Date = weekAnchorMonday(0),
): Promise<{ hours: number[]; bedtimes: (string | null)[]; points: number[] }> {
    const uid = await getCurrentUserId();
    if (!uid) {
        return {
            hours: [0, 0, 0, 0, 0, 0, 0],
            bedtimes: [null, null, null, null, null, null, null],
            points: [0, 0, 0, 0, 0, 0, 0],
        };
    }

    const weekEnd = new Date(monday);
    weekEnd.setDate(weekEnd.getDate() + 7);

    // Look back 2 days before Monday (Saturday midnight) because sleep sessions
    // are stored with bedtime as started_at. Evening bedtimes (e.g. Sunday 10pm)
    // are attributed to the next morning's day (Monday). Without this look-back
    // the query misses evening starts that precede Monday midnight, and similarly
    // Saturday evening starts that map to Sunday's display slot.
    const lookback = new Date(monday);
    lookback.setDate(lookback.getDate() - 2);

    // Upper bound matters now that `monday` can be a PAST week: without it every
    // later session still came back, and assignDate.getDay() folded them into the
    // same seven slots — a past week would show hours it never had.
    const fetchTo = new Date(weekEnd);
    fetchTo.setDate(fetchTo.getDate() + 1);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at, duration_sec, point_transactions(amount)')
        .eq('user_id', uid)
        .eq('type', 'sleep')
        .gte('started_at', lookback.toISOString())
        .lt('started_at', fetchTo.toISOString())
        .order('started_at', { ascending: true });
    if (error) throw error;

    // Map each session to its weekday (Mon=0 … Sun=6)
    const hours: number[] = [0, 0, 0, 0, 0, 0, 0];
    const bedtimes: (string | null)[] = [null, null, null, null, null, null, null];
    // Points are bucketed HERE, beside the hours, using the same assignDate — so
    // the tappable bar's caption can never disagree with the bar above it. The
    // generic fetchWeekActivityData buckets on raw started_at and would put an
    // evening bedtime's POWR on the day before the bar showing its hours.
    const points: number[] = [0, 0, 0, 0, 0, 0, 0];

    for (const s of data ?? []) {
        const d = new Date(s.started_at);
        // Sleep that starts in the evening belongs to the next day's metric
        // e.g. sleeping at 11pm Monday → Tuesday's sleep
        const startHour = d.getHours();
        const assignDate = startHour >= 18
            ? new Date(d.getTime() + 86400000) // next day
            : d;

        // Skip sessions that map outside the anchored week
        if (assignDate < monday || assignDate >= weekEnd) continue;

        const day = assignDate.getDay();
        const idx = day === 0 ? 6 : day - 1;
        const durationH = Math.round((s.duration_sec / 3600) * 10) / 10;
        hours[idx] += durationH;
        for (const t of ((s as unknown as { point_transactions: { amount: number }[] | null }).point_transactions ?? [])) {
            points[idx] += t.amount ?? 0;
        }

        // Track bedtime (earliest start for that night)
        if (!bedtimes[idx] || s.started_at < bedtimes[idx]!) {
            bedtimes[idx] = s.started_at;
        }
    }

    return { hours, bedtimes, points };
}

/**
 * The window a sleep "day" actually covers: 18:00 the previous evening through
 * 18:00 that day.
 *
 * Sleep is stored with BEDTIME as started_at, and both sleep views attribute an
 * evening bedtime to the morning you wake — 11pm Monday is Tuesday's sleep (see
 * fetchWeeklySleepHours / fetchMonthlySleepData, which both shift at hour 18).
 * A plain midnight-to-midnight window disagrees with that on every evening
 * bedtime, i.e. almost every night: tapping Tuesday would open the night that
 * STARTED Tuesday evening, which the chart is showing as Wednesday.
 */
export function sleepDayWindow(day: Date): { start: Date; end: Date } {
    const end = new Date(day);
    end.setHours(18, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 1);
    return { start, end };
}

// ── Sleep detail: Day view ──────────────────────────────────────────────────

export type SleepDayDetail = {
    totalHours: number;
    bedtime: string;      // ISO timestamp
    wakeTime: string;      // ISO timestamp
    deepHours: number | null;
    remHours: number | null;
    lightHours: number | null;
    source: string | null;
};

/**
 * Fetches the sleep session attributed to a given day, with stage breakdown.
 * `offset` counts days back from today: 0 = last night, -1 = the night before.
 *
 * The night "belonging" to day D is the most recent sleep whose bedtime falls in
 * [D-1 6pm, D 6pm) — the same 6pm evening-attribution rule the week and month
 * views bucket by, so all three agree on which night a date refers to.
 */
export async function fetchSleepDayDetail(offset = 0): Promise<SleepDayDetail | null> {
    const uid = await getCurrentUserId();
    if (!uid) return null;

    const day = dayAnchor(offset);

    const windowStart = new Date(day);
    windowStart.setDate(windowStart.getDate() - 1);
    windowStart.setHours(18, 0, 0, 0);

    // Bounded at both ends: unbounded, stepping back to an earlier night still
    // returned the newest session in the table, so every past day showed last
    // night's sleep.
    const windowEnd = new Date(day);
    windowEnd.setHours(18, 0, 0, 0);

    // 1. Get the most recent sleep session in that window
    const { data: session, error } = await supabase
        .from('activity_sessions')
        .select('id, started_at, ended_at, duration_sec')
        .eq('user_id', uid)
        .eq('type', 'sleep')
        .gte('started_at', windowStart.toISOString())
        .lt('started_at', windowEnd.toISOString())
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    if (!session) return null;

    const totalHours = Math.round((session.duration_sec / 3600) * 10) / 10;

    // 2. Look up stage breakdown from health_snapshots in the same window.
    //    session_id FK isn't reliably set for sleep rows, so match by time window.
    //    The user_id filter is load-bearing, not redundant with RLS: admin read
    //    policies on this table are broad enough that without it an admin's own
    //    Progress page rendered whichever user's sleep stages sorted newest.
    const { data: snapshot } = await supabase
        .from('health_snapshots')
        .select('sleep_deep_h, sleep_rem_h, sleep_light_h, source')
        .eq('user_id', uid)
        .eq('activity_type', 'sleep')
        .gte('created_at', windowStart.toISOString())
        .lt('created_at', windowEnd.toISOString())
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
    /** Session-linked points earned for that night. */
    points: number;
};

export type MonthlySleepData = {
    entries: DailySleepEntry[];   // 30 entries, oldest → newest
    avgHours: number;
    bestNight: DailySleepEntry | null;
    worstNight: DailySleepEntry | null;
};

/**
 * Fetches a calendar month of sleep data for the month heatmap view. `offset`
 * counts months back from now: 0 = this month (running to today), -1 = last
 * month. Entry count varies between 1 and 31 — callers must not assume 30.
 */
export async function fetchMonthlySleepData(offset = 0): Promise<MonthlySleepData> {
    const uid = await getCurrentUserId();
    if (!uid) return { entries: [], avgHours: 0, bestNight: null, worstNight: null };

    const rangeStart = monthAnchorStart(offset);
    const rangeEndDay = monthAnchorEnd(offset);
    const rangeEndExclusive = new Date(rangeEndDay);
    rangeEndExclusive.setDate(rangeEndExclusive.getDate() + 1);

    // Evening attribution shifts a session forward a day, so the query has to
    // straddle both edges of the month: a 22:00 start on the last day of the
    // PREVIOUS month lands on the 1st, and a 22:00 start on this month's last
    // day lands outside it. Fetch a day either side, then filter by assignDate.
    const fetchFrom = new Date(rangeStart);
    fetchFrom.setDate(fetchFrom.getDate() - 1);

    const fetchTo = new Date(rangeEndDay);
    fetchTo.setDate(fetchTo.getDate() + 2);

    const { data, error } = await supabase
        .from('activity_sessions')
        .select('started_at, duration_sec, point_transactions(amount)')
        .eq('user_id', uid)
        .eq('type', 'sleep')
        .gte('started_at', fetchFrom.toISOString())
        .lt('started_at', fetchTo.toISOString())
        .order('started_at', { ascending: true });
    if (error) throw error;

    // Aggregate by date, applying evening → next-day attribution
    const byDate = new Map<string, { hours: number; bedtime: string | null; points: number }>();

    for (const s of (data ?? []) as Array<{
        started_at: string;
        duration_sec: number;
        point_transactions: { amount: number }[] | null;
    }>) {
        const d = new Date(s.started_at);
        const startHour = d.getHours();
        const assignDate = startHour >= 18
            ? new Date(d.getTime() + 86400000)
            : d;

        // Skip nights whose attributed day falls outside the month. The upper
        // bound is the EXCLUSIVE next midnight, not rangeEndDay: assignDate
        // keeps its clock time, so a 23:00 night on the final day would sort
        // after that day's midnight and get dropped.
        if (assignDate < rangeStart || assignDate >= rangeEndExclusive) continue;

        // localDateStr, not toISOString: a 00:30 bedtime in any UTC+ zone is the
        // previous day in UTC, which filed that night under the wrong date.
        const dateKey = localDateStr(assignDate);
        const durationH = Math.round((s.duration_sec / 3600) * 10) / 10;
        const pts = (s.point_transactions ?? []).reduce((sum, t) => sum + t.amount, 0);
        const existing = byDate.get(dateKey);

        if (existing) {
            existing.hours += durationH;
            existing.points += pts;
            if (!existing.bedtime || s.started_at < existing.bedtime) {
                existing.bedtime = s.started_at;
            }
        } else {
            byDate.set(dateKey, { hours: durationH, bedtime: s.started_at, points: pts });
        }
    }

    // Build one entry per night in the month, oldest first. Rebuilt per step
    // rather than walked with a mutating cursor — see fetchMonthlyActivityData
    // for why a setDate() walk loses the last day in midnight-DST zones.
    const dayCount = rangeEndDay.getDate();
    const entries: DailySleepEntry[] = [];
    for (let i = 0; i < dayCount; i++) {
        const dateKey = localDateStr(new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1 + i));
        const val = byDate.get(dateKey);
        entries.push({
            date: dateKey,
            hours: val?.hours ?? 0,
            bedtime: val?.bedtime ?? null,
            points: val?.points ?? 0,
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

/** Returns the session summary for a given activity type on one local day (default today). */
export async function fetchTodayActivityDetail(type: ActivityType, day?: Date): Promise<TodayActivityDetail> {
    const uid = await getCurrentUserId();
    if (!uid) return { sessionCount: 0, totalDurationMin: 0, totalPoints: 0, steps: null, distanceM: null, latestStartedAt: null };

    const start = new Date(day ?? new Date());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const [{ data, error }, suppressed] = await Promise.all([
        supabase
            .from('activity_sessions')
            .select('id, started_at, duration_sec, steps, distance_m, point_transactions(amount)')
            .eq('user_id', uid)
            .eq('type', type)
            .gte('started_at', start.toISOString())
            .lt('started_at', end.toISOString())
            .order('started_at', { ascending: false }),
        fetchSuppressedWorkouts(uid, { type, from: start, to: end }),
    ]);
    if (error) throw error;

    const sessions = [
        ...((data ?? []) as Array<{
            id: string;
            started_at: string;
            duration_sec: number;
            steps: number | null;
            distance_m: number | null;
            point_transactions: { amount: number }[];
        }>),
        ...suppressed.map(w => ({
            id: `suppressed:${w.id}`,
            started_at: w.started_at,
            duration_sec: w.duration_sec,
            steps: null,
            distance_m: w.distance_m,
            point_transactions: [] as { amount: number }[],
        })),
    // Re-sorted because latestStartedAt reads the first row, and the merged
    // suppressed rows arrive from their own query.
    ].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));

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
    /**
     * The single longest session that day, in minutes. Differs from
     * totalDurationMin only when a day holds several rows (wearable workouts).
     * Sessions pinned at the 12h gym backstop are EXCLUDED — that value is a
     * write-time clamp on a runaway dwell, not a measured stay (see
     * project_session_duration_integrity), so it must never win "longest".
     */
    longestSessionMin: number;
    /** Session-linked points earned that day for this type. */
    points: number;
    steps: number | null;   // walking only
};

/**
 * What "best day" ranks on. Walking ranks steps. Gym ranks the longest visit:
 * the geofence tier is bound to ONE gym row per user per UTC day
 * (idx_one_session_per_type_per_day folds a second visit into the first), so a
 * session count is a constant 1 for essentially everyone and says nothing.
 * Other workouts still rank on sessions, where a second row a day is real.
 */
export type BestDayMetric = 'steps' | 'sessions' | 'longestSession';

export type MonthlyActivityData = {
    entries: DailyActivityEntry[];   // 30 entries, oldest → newest
    totalSessions: number;
    avgPerDay: number;               // avg sessions/day (workouts) or avg steps (walking)
    bestDay: DailyActivityEntry | null;
    bestDayMetric: BestDayMetric;
    type: ActivityType;
};

/**
 * Mirrors MAX_GYM_SESSION_SEC (GeofenceContext / upgrade-gym-tier). A row AT the
 * backstop was clamped, not measured; nothing below it is.
 */
const GYM_BACKSTOP_SEC = 12 * 60 * 60;

export function bestDayMetricFor(type: ActivityType): BestDayMetric {
    if (type === 'walking') return 'steps';
    if (type === 'gym') return 'longestSession';
    return 'sessions';
}

function bestDayValue(e: DailyActivityEntry, metric: BestDayMetric): number {
    switch (metric) {
        case 'steps': return e.steps ?? 0;
        case 'longestSession': return e.longestSessionMin;
        default: return e.sessionCount;
    }
}

/**
 * Fetches a calendar month of activity data for a given type (heatmap +
 * summary). `offset` counts months back from now: 0 = this month (which runs to
 * today, not to the 31st), -1 = last month, and so on. Entry count therefore
 * varies between 1 and 31 — callers must not assume 30.
 */
export async function fetchMonthlyActivityData(type: ActivityType, offset = 0): Promise<MonthlyActivityData> {
    const uid = await getCurrentUserId();
    const bestDayMetric = bestDayMetricFor(type);
    if (!uid) return { entries: [], totalSessions: 0, avgPerDay: 0, bestDay: null, bestDayMetric, type };

    // No time-of-day normalisation needed. The anchors used to be pinned to local
    // noon, because the entry keys were built with toISOString() and a
    // local-midnight anchor resolves to the PREVIOUS UTC date in any UTC+ zone.
    // Keys are local via localDateStr now, so that reason is gone.
    //
    // Nothing else needs it either: the anchors are already at local midnight,
    // and the entry loop below rebuilds each day from calendar fields rather
    // than doing millisecond arithmetic. (The pin-to-noon idiom guards
    // MILLISECOND arithmetic, where a DST hour can push you over midnight; it
    // does not apply here.) Verified across every month of 2023-2026 in 9 zones
    // incl. midnight-transition ones (Santiago, Beirut, Havana, Chatham).
    const rangeStart = monthAnchorStart(offset);
    const endDayStart = monthAnchorEnd(offset);

    const rangeEnd = new Date(endDayStart);
    rangeEnd.setDate(rangeEnd.getDate() + 1);

    const [{ data, error }, suppressed] = await Promise.all([
        supabase
            .from('activity_sessions')
            .select('started_at, duration_sec, steps, point_transactions(amount)')
            .eq('user_id', uid)
            .eq('type', type)
            .gte('started_at', rangeStart.toISOString())
            .lt('started_at', rangeEnd.toISOString())
            .order('started_at', { ascending: true }),
        fetchSuppressedWorkouts(uid, { type, from: rangeStart, to: rangeEnd }),
    ]);
    if (error) throw error;

    // Aggregate by date
    const byDate = new Map<string, { count: number; durationMin: number; longestMin: number; points: number; steps: number }>();

    const monthRows = [
        ...((data ?? []) as Array<{
            started_at: string;
            duration_sec: number | null;
            steps: number | null;
            point_transactions: { amount: number }[] | null;
        }>),
        ...suppressed.map(w => ({
            started_at: w.started_at,
            duration_sec: w.duration_sec as number | null,
            steps: null,
            point_transactions: [] as { amount: number }[],
        })),
    ];
    for (const s of monthRows) {
        // localDateStr, not toISOString: Terra stamps walking/sleep day-aggregates
        // at LOCAL midnight, which is the previous UTC day in any UTC+ zone — so a
        // UTC key filed every one of them under the wrong date, and the day the
        // PointsBreakdownSheet queries (a local window) then came back empty.
        const dateKey = localDateStr(new Date(s.started_at));
        const existing = byDate.get(dateKey);
        const durMin = Math.round((s.duration_sec ?? 0) / 60);
        // A clamped row still counts toward the day's total (it's what RECENT
        // DAYS shows too) — it just can't be anyone's longest.
        const longestMin = (s.duration_sec ?? 0) >= GYM_BACKSTOP_SEC ? 0 : durMin;
        const steps = s.steps ?? 0;
        // Every row on the session counts, streak bonuses included — same rule as
        // fetchWeeklyMetrics.pointsPerType, so the two agree.
        const pts = (s.point_transactions ?? []).reduce((sum, t) => sum + t.amount, 0);

        if (existing) {
            existing.count++;
            existing.durationMin += durMin;
            existing.longestMin = Math.max(existing.longestMin, longestMin);
            existing.points += pts;
            existing.steps += steps;
        } else {
            byDate.set(dateKey, { count: 1, durationMin: durMin, longestMin, points: pts, steps });
        }
    }

    // Build one entry per day in the month, oldest first.
    //
    // Rebuilt from (y, m, 1 + i) each step rather than walked with a mutating
    // setDate() cursor. In zones where DST springs forward AT midnight
    // (Santiago, Havana, Beirut) local midnight does not exist on that day, so
    // the cursor normalises to 01:00 and CARRIES that time forward — a
    // `cursor <= endDayStart` test then trips a day early and drops the last day
    // of the month from the heatmap. rangeStart is always the 1st, so the day
    // count is just the end day's date.
    const dayCount = endDayStart.getDate();
    const entries: DailyActivityEntry[] = [];
    for (let i = 0; i < dayCount; i++) {
        const dateKey = localDateStr(new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1 + i));
        const val = byDate.get(dateKey);
        entries.push({
            date: dateKey,
            sessionCount: val?.count ?? 0,
            totalDurationMin: val?.durationMin ?? 0,
            longestSessionMin: val?.longestMin ?? 0,
            points: val?.points ?? 0,
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

    // Strictly greater, so ties go to the EARLIEST day. A day whose only value is
    // 0 (every visit clamped at the backstop) never qualifies: better to show a
    // dash than crown a 12h row that nobody actually spent at the gym.
    let bestDay: DailyActivityEntry | null = null;
    for (const e of withData) {
        const metric = bestDayValue(e, bestDayMetric);
        if (bestDayMetric === 'longestSession' && metric <= 0) continue;
        if (!bestDay || metric > bestDayValue(bestDay, bestDayMetric)) bestDay = e;
    }

    return { entries, totalSessions, avgPerDay, bestDay, bestDayMetric, type };
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
    /**
     * Bounded per-workout metrics (see the column comment) — scalars only, never
     * sample series. The native path uses it to mark a window-scoped read
     * (`{ scope: 'session' }`, lib/health/windowVitals.ts) apart from the
     * day-wide figures the same provider used to stamp on every session.
     */
    extras?: Record<string, unknown>;
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
        extras: params.extras ?? null,
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

    const [{ data, error }, suppressed] = await Promise.all([
        supabase
            .from('activity_sessions')
            .select('started_at, type, steps, duration_sec, point_transactions(amount)')
            .eq('user_id', uid)
            .gte('started_at', monthStart.toISOString())
            .order('started_at', { ascending: true }),
        fetchSuppressedWorkouts(uid, { from: monthStart }),
    ]);
    if (error) throw error;

    const sessions = [
        ...((data ?? []) as Array<{
            started_at: string;
            type: string;
            steps: number | null;
            duration_sec: number;
            point_transactions: { amount: number }[];
        }>),
        ...suppressed.map(w => ({
            started_at: w.started_at,
            type: w.type,
            steps: null,
            duration_sec: w.duration_sec,
            point_transactions: [] as { amount: number }[],
        })),
    ];

    // Track which dates have been counted as "active" to avoid double-counting
    const activeDateSet = new Set<string>();
    const perType: Record<string, number> = {};
    const weekActiveDays: [number, number, number, number] = [0, 0, 0, 0];
    const activeDayTypes: Record<number, Record<string, number>> = {};
    const dayDetails: Record<number, { totalMinutes: number; totalSteps: number; totalPoints: number; sessionCount: number }> = {};
    let totalSteps = 0;

    for (const s of sessions) {
        const date = new Date(s.started_at);
        // Local key to match dayOfMonth below, which is local: a UTC key made the
        // active-day dedupe disagree with the bucket it was deduping.
        const dateKey = localDateStr(date);
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

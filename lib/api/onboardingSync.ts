/**
 * Health history backfill (onboarding + late connect)
 *
 * Persists the last 7 days of native health data (HealthKit / Health Connect)
 * and PAYS for it exactly as the live sync would have, had the app been there
 * all week.
 *
 * Until 2026-08-30 this path wrote 0-point sessions on purpose ("points only
 * begin when the user starts actively using the app") while the Terra wearable
 * path scored the same 7 days like live. Two members joining on the same day
 * could start 100+ POWR apart on the strength of which device they own, and a
 * new member's first sight of the app was a week of their own workouts with a
 * dash where the points should be. Jamie, 2026-08-30: same history, same pay,
 * for everyone.
 *
 * There is no scoring table in this file. Every write goes through the live
 * sync's own functions — logManualSession for workouts and sleep,
 * logHealthWalkingSession for step days — priced by the same lib/health/points
 * ladder hooks/useHealthSync uses, and bounded server-side by
 * enforce_point_award_cap like any other client award. Walking days are keyed
 * on LOCAL midnight (as the walking sync stores them), not UTC.
 */

import { Platform } from 'react-native';
import { getSessionUser, supabase } from '@/lib/supabase';
import { ACTIVITIES } from '@/constants/activities';
import { getWeekHistoryNow, type DayHealthSummary } from '@/hooks/useHealthData';
import {
    buildStreakFromDates,
    getWalkingDaySummary,
    logHealthWalkingSession,
    logManualSession,
    saveHealthSnapshot,
    stepTierPoints,
    updateHealthWalkingSession,
    WALKING_DAILY_CAP,
} from '@/lib/api/activity';
import { calculateBasePoints, calculateSleepPoints, mapHealthType } from '@/lib/health/points';
import { sourceLabel, verificationFromProvenance } from '@/lib/health/dataSource';
import { readWindowVitals, SESSION_SCOPED_EXTRAS } from '@/lib/health/windowVitals';
import { emitPointsChanged } from '@/lib/pointsEvents';

// ── Types ────────────────────────────────────────────────────────────────────

export type DaySyncResult = {
    date: string;
    steps: number;
    activities: string[];  // activity type labels that were synced
    sleepHours: number;
    sessionCount: number;
    /** POWR awarded for this day's sessions (as priced; the server may clamp). */
    points: number;
};

export type OnboardingSyncResult = {
    totalSessions: number;
    totalPoints: number;
    streakDays: number;
    activeDates: string[];
    dailyBreakdown: DaySyncResult[];
};

const EMPTY_RESULT: OnboardingSyncResult = {
    totalSessions: 0, totalPoints: 0, streakDays: 0, activeDates: [], dailyBreakdown: [],
};

// ── Day helpers ──────────────────────────────────────────────────────────────

/** Local midnight of a YYYY-MM-DD day, and the next local midnight. */
function localDayBounds(date: string): { start: Date; end: Date } {
    const [y, m, d] = date.split('-').map(Number);
    return { start: new Date(y, m - 1, d), end: new Date(y, m - 1, d + 1) };
}

function localDateKey(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Core sync ────────────────────────────────────────────────────────────────

/**
 * Records — and pays for — a week of native health history.
 *
 * - Workouts and sleep go through `logManualSession` with the live scorer's
 *   points (check-in suppression, split stitching and the server bounds all
 *   apply exactly as they do on the live path).
 * - Past step days go through `logHealthWalkingSession` at the day's tier,
 *   under the walking daily cap, on local midnight. TODAY's steps are left to
 *   `syncWalkingNow`, which the Home screen runs the moment onboarding lands
 *   there — paying them here too would race its read-modify-write.
 * - Builds a streak from consecutive active days.
 * - Sets `initial_health_sync_complete` in user metadata (one-shot).
 *
 * One bad day never aborts the week: each section is best-effort.
 *
 * @param onDayComplete Optional callback fired after each day is processed (for UI progress)
 */
export async function syncHistoricalHealthData(
    weekData: DayHealthSummary[],
    onDayComplete?: (day: DaySyncResult, index: number) => void,
): Promise<OnboardingSyncResult> {
    // Guard: check if already synced
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');
    if (user.user_metadata?.initial_health_sync_complete) {
        console.log('[OnboardingSync] Already completed, skipping');
        return { ...EMPTY_RESULT };
    }

    const source = Platform.OS === 'ios' ? 'healthkit' : 'health_connect';
    const today = localDateKey(new Date());
    const dailyBreakdown: DaySyncResult[] = [];
    const activeDates: string[] = [];
    let totalSessions = 0;
    let totalPoints = 0;

    // The live sync's dedupe key (type + start instant) over the same window,
    // so a week the live sync reached first is never recorded — or paid —
    // twice. Scoped on user_id: activity_sessions has an "admins can read all"
    // policy, so an unfiltered probe can match a STRANGER's session and
    // silently drop this user's own workout.
    const syncedKeys = new Set<string>();
if (weekData.length > 0) {
    const earliest = weekData.reduce((min, d) => (d.date < min ? d.date : min), weekData[0].date);
    const latest = weekData.reduce((max, d) => (d.date > max ? d.date : max), weekData[0].date);
    const { start } = localDayBounds(earliest);
    const { end } = localDayBounds(latest);
    const { data: existing } = await supabase
        .from('activity_sessions')
        .select('type, started_at')
        .eq('user_id', user.id)
        .in('verification', ['wearable', 'health'])
        .gte('started_at', start.toISOString())
        .lt('started_at', end.toISOString());
    for (const s of existing ?? []) {
        syncedKeys.add(`${s.type}_${new Date(s.started_at).toISOString()}`);
    }
}

    for (let idx = 0; idx < weekData.length; idx++) {
        const day = weekData[idx];
        const dayResult: DaySyncResult = {
            date: day.date,
            steps: day.steps,
            activities: [],
            sleepHours: 0,
            sessionCount: 0,
            points: 0,
        };

        // ── Workouts ──────────────────────────────────────────────────
        for (const activity of day.activities) {
            const mappedType = mapHealthType(activity.type);
            if (!mappedType) continue;

            const key = `${mappedType}_${new Date(activity.startedAt).toISOString()}`;
            if (syncedKeys.has(key)) continue;
            syncedKeys.add(key);

            try {
                const startMs = new Date(activity.startedAt).getTime();
                const endMs = startMs + activity.durationMin * 60000;
                // The workout's OWN heart rate and calories over its window — never
                // the day's figure stamped on every session (the Progress sheet has
                // to gate those out as untrustworthy). Null when the store has
                // nothing for that span.
                const vitals = await readWindowVitals(startMs, endMs).catch(() => null);
                const points = calculateBasePoints(mappedType, activity.durationMin, activity.distanceM ?? null);

                const sessionId = await logManualSession({
                    type: mappedType,
                    duration_sec: activity.durationMin * 60,
                    distance_m: activity.distanceM,
                    hr_avg: vitals?.hrAvg ?? undefined,
                    hr_max: vitals?.hrMax ?? undefined,
                    calories_active: vitals?.caloriesActive ?? undefined,
                    source,
                    started_at: activity.startedAt,
                    points,
                    healthVerified: true,
                    healthSource: verificationFromProvenance(activity.source, 'health'),
                    rawActivityName: activity.rawName ?? activity.type,
                    pointsFor: (mins, distM) => calculateBasePoints(mappedType, mins, distM),
                });
                // null = suppressed by a check-in, absorbed into a session we
                // already hold, or already recorded — nothing new to count.
                if (!sessionId) continue;

                await saveHealthSnapshot({
                    sessionId,
                    steps: activity.steps,
                    distanceM: activity.distanceM,
                    hrAvg: vitals?.hrAvg ?? undefined,
                    hrMax: vitals?.hrMax ?? undefined,
                    caloriesActive: vitals?.caloriesActive ?? undefined,
                    activityType: activity.type,
                    durationSec: activity.durationMin * 60,
                    source,
                    sourceDetail: activity.source ? sourceLabel(activity.source) : undefined,
                    extras: vitals ? { ...SESSION_SCOPED_EXTRAS } : undefined,
                });

                dayResult.activities.push(ACTIVITIES[mappedType].label);
                dayResult.sessionCount++;
                dayResult.points += points;
                totalSessions++;
            } catch (e) {
                console.warn(`[OnboardingSync] Failed to record ${mappedType}:`, (e as Error)?.message ?? e);
            }
        }

        // ── Walking (steps) ───────────────────────────────────────────
        if (day.steps > 0 && day.date !== today) {
            try {
                const { start, end } = localDayBounds(day.date);
                const startIso = start.toISOString();
                const endIso = end.toISOString();
                const { session, dayPoints } = await getWalkingDaySummary(startIso, endIso);
                const capRemaining = Math.max(0, WALKING_DAILY_CAP - dayPoints);

                if (session) {
                    // The day is already on the books (the walking sync's own
                    // backfill got there first). Top the row up to the store's
                    // total; points award only the tier delta under the cap —
                    // the same rule as backfillWalkingDays.
                    if (day.steps > session.steps) {
                        const additional = Math.min(
                            Math.max(0, stepTierPoints(day.steps) - session.points),
                            capRemaining,
                        );
                        await updateHealthWalkingSession(session.id, day.steps, additional, endIso);
                        dayResult.points += additional;
                    }
                } else {
                    const points = Math.min(stepTierPoints(day.steps), capRemaining);
                    const sessionId = await logHealthWalkingSession(day.steps, points, 'health', startIso, endIso);
                    if (sessionId) {
                        await saveHealthSnapshot({ sessionId, steps: day.steps, activityType: 'walking', source });
                        dayResult.sessionCount++;
                        dayResult.points += points;
                        totalSessions++;
                    }
                }
            } catch (e) {
                console.warn(`[OnboardingSync] Failed to record walking ${day.date}:`, (e as Error)?.message ?? e);
            }
        }

        // ── Sleep ─────────────────────────────────────────────────────
        const sleep = day.sleep;
        if (sleep && sleep.durationHours >= 1) {
            const key = `sleep_${new Date(sleep.startedAt).toISOString()}`;
            if (!syncedKeys.has(key)) {
                syncedKeys.add(key);
                try {
const startMs = new Date(sleep.startedAt).getTime();
const endMs = new Date(sleep.endedAt).getTime();
const durationSec = Math.max(0, Math.round((endMs - startMs) / 1000));
const points = calculateSleepPoints(durationSec / 3600, sleep.deepHours, sleep.remHours);
                    const sessionId = await logManualSession({
                        type: 'sleep',
                        duration_sec: durationSec,
                        started_at: sleep.startedAt,
                        points,
                        healthVerified: true,
                        healthSource: 'health',
                        sleepDeepH: sleep.deepHours,
                        sleepRemH: sleep.remHours,
                        sleepLightH: sleep.lightHours,
                        source,
                    });
                    if (sessionId) {
                        await saveHealthSnapshot({
                            sessionId,
                            sleepDurationH: sleep.durationHours,
                            sleepDeepH: sleep.deepHours,
                            sleepRemH: sleep.remHours,
                            sleepLightH: sleep.lightHours,
                            activityType: 'sleep',
                            durationSec,
                            source,
                        });
                        dayResult.sleepHours = sleep.durationHours;
                        dayResult.sessionCount++;
                        dayResult.points += points;
                        totalSessions++;
                    }
                } catch (e) {
                    console.warn(`[OnboardingSync] Failed to record sleep ${day.date}:`, (e as Error)?.message ?? e);
                }
            }
        }

        // A day is "active" if it had any qualifying data
        const isActive = dayResult.sessionCount > 0 || day.steps >= 1000;
        if (isActive) {
            activeDates.push(day.date);
        }

        totalPoints += dayResult.points;
        dailyBreakdown.push(dayResult);
        onDayComplete?.(dayResult, idx);
    }

    // ── Build streak ──────────────────────────────────────────────────
    const streakDays = await buildStreakFromDates(activeDates);

    // ── Mark sync as complete ─────────────────────────────────────────
    await supabase.auth.updateUser({
        data: { initial_health_sync_complete: true },
    });

    // The home readout caches ['points']; a week just landed in the ledger.
    if (totalPoints > 0) emitPointsChanged();

    console.log(`[OnboardingSync] Complete: ${totalSessions} sessions, +${totalPoints} POWR, ${streakDays}-day streak, ${activeDates.length} active days`);

    return { totalSessions, totalPoints, streakDays, activeDates, dailyBreakdown };
}

let onboardingOwnsBackfill = false;

/**
 * Onboarding's health step runs `syncHistoricalHealthData` itself so it can
 * render per-day progress. While the flow is on screen the silent backfill must
 * stand down: the AppState auto-connect listener in useHealthProviders fires the
 * moment the Health Connect dialog hands control back, and if it won that race
 * onboarding would show "0 sessions synced" over a full week of real data.
 *
 * Set on the wearables + health steps, released on the notifications step — the
 * only route out of the health step. Module state, so a killed app resets it to
 * false, which is the correct default for everyone outside the flow.
 */
export function setOnboardingOwnsBackfill(owns: boolean): void {
    onboardingOwnsBackfill = owns;
}

/**
 * Pull the 7-day history for someone who connected a native health source
 * *after* onboarding — from Settings, the Home prime sheet, or by granting in
 * OS settings and letting the app auto-detect it.
 *
 * Onboarding drives `syncHistoricalHealthData` itself so it can render per-day
 * progress; every other entry point lands here instead. Safe to call on any
 * connect: the `initial_health_sync_complete` flag makes it one-shot per
 * account, and it's checked before the (slow) week read rather than after.
 *
 * Returns null when there was nothing to do. Never throws — a failed backfill
 * must not break the connect it was triggered by.
 */
export async function backfillHealthHistoryIfNeeded(): Promise<OnboardingSyncResult | null> {
    try {
        if (Platform.OS === 'web') return null;
        if (onboardingOwnsBackfill) return null;

        const user = await getSessionUser();
        if (!user) return null;
        if (user.user_metadata?.initial_health_sync_complete) return null;

        const weekData = await getWeekHistoryNow();
        // An empty read means the grant isn't live yet or the store is empty.
        // Bail WITHOUT syncing — syncHistoricalHealthData would burn the
        // one-shot flag on nothing and there'd be no second chance.
        if (!weekData.length) {
            console.log('[OnboardingSync] Backfill skipped — no history readable yet');
            return null;
        }

        console.log(`[OnboardingSync] Late backfill starting (${weekData.length} days)`);
        return await syncHistoricalHealthData(weekData);
    } catch (e) {
        console.warn('[OnboardingSync] Late backfill failed:', e);
        return null;
    }
}

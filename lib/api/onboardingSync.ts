/**
 * Onboarding Health Data Sync
 *
 * Persists 7 days of historical health data to populate the user's app
 * without awarding any POWR points. Sessions exist purely for UI population
 * (activity feed, weekly rings, step counts, sleep data).
 *
 * Points only begin when the user starts actively using the app.
 */

import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import type { DayHealthSummary } from '@/hooks/useHealthData';
import { buildStreakFromDates, saveHealthSnapshot } from '@/lib/api/activity';

// ── Types ────────────────────────────────────────────────────────────────────

export type DaySyncResult = {
    date: string;
    steps: number;
    activities: string[];  // activity type labels that were synced
    sleepHours: number;
    sessionCount: number;
};

export type OnboardingSyncResult = {
    totalSessions: number;
    streakDays: number;
    activeDates: string[];
    dailyBreakdown: DaySyncResult[];
};

// ── Activity type mapping (from useHealthSync) ───────────────────────────────

function mapHealthType(name: string): ActivityType | null {
    const n = name.toLowerCase();
    if (n.includes('run')) return 'running';
    if (n.includes('cycl') || n.includes('biking')) return 'cycling';
    if (n.includes('swim')) return 'swimming';
    if (n.includes('gym') || n.includes('weight') || n.includes('crossfit') || n.includes('calisthenics') || n.includes('strength')) return 'gym';
    if (n.includes('hiit') || n.includes('boot_camp')) return 'hiit';
    if (n.includes('yoga') || n.includes('pilates')) return 'yoga';
    if (n.includes('sport') || n.includes('tennis') || n.includes('soccer') || n.includes('basketball')
        || n.includes('handball') || n.includes('volleyball') || n.includes('squash') || n.includes('racquetball')
        || n.includes('fencing') || n.includes('martial')) return 'sports';
    if (n.includes('walk') || n.includes('hik')) return 'walking';
    if (n.includes('danc')) return 'dance';
    return null;
}

// ── Core sync ────────────────────────────────────────────────────────────────

/**
 * Syncs historical health data during onboarding.
 *
 * - Creates activity_sessions for qualifying workouts (0 points)
 * - Creates walking sessions per day if steps exist (0 points)
 * - Creates sleep sessions if sleep ≥ 1h (0 points)
 * - Saves health_snapshots for each datum
 * - Builds a streak from consecutive active days
 * - Sets initial_health_sync_complete flag in user metadata
 *
 * @param onDayComplete Optional callback fired after each day is processed (for UI progress)
 */
export async function syncHistoricalHealthData(
    weekData: DayHealthSummary[],
    onDayComplete?: (day: DaySyncResult, index: number) => void,
): Promise<OnboardingSyncResult> {
    // Guard: check if already synced
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    if (user.user_metadata?.initial_health_sync_complete) {
        console.log('[OnboardingSync] Already completed, skipping');
        return { totalSessions: 0, streakDays: 0, activeDates: [], dailyBreakdown: [] };
    }

    const source = Platform.OS === 'ios' ? 'healthkit' : 'health_connect' as const;
    const dailyBreakdown: DaySyncResult[] = [];
    const activeDates: string[] = [];
    let totalSessions = 0;

    for (let idx = 0; idx < weekData.length; idx++) {
        const day = weekData[idx];
        const dayResult: DaySyncResult = {
            date: day.date,
            steps: day.steps,
            activities: [],
            sleepHours: 0,
            sessionCount: 0,
        };

        // ── Workouts ──────────────────────────────────────────────────
        for (const activity of day.activities) {
            const mappedType = mapHealthType(activity.type);
            if (!mappedType) continue;

            const config = ACTIVITIES[mappedType];
            if (activity.durationMin < config.minDuration) continue;

            // Check for existing session at this timestamp to prevent duplicates
            const { data: existing } = await supabase
                .from('activity_sessions')
                .select('id')
                .eq('started_at', activity.startedAt)
                .eq('type', mappedType)
                .limit(1)
                .maybeSingle();
            if (existing) continue;

            const endedAt = new Date(new Date(activity.startedAt).getTime() + activity.durationMin * 60000).toISOString();

            const { error: sessErr } = await supabase
                .from('activity_sessions')
                .insert({
                    type: mappedType,
                    started_at: activity.startedAt,
                    ended_at: endedAt,
                    duration_sec: activity.durationMin * 60,
                    distance_m: activity.distanceM ?? null,
                    steps: activity.steps ?? null,
                    hr_avg: day.heartRate?.avg ?? null,
                    verification: 'wearable',
                    trust_score: 85,
                });
            if (sessErr) {
                console.warn(`[OnboardingSync] Failed to insert ${mappedType}:`, sessErr.message);
                continue;
            }

            // Health snapshot
            await saveHealthSnapshot({
                steps: activity.steps,
                distanceM: activity.distanceM,
                hrAvg: day.heartRate?.avg,
                hrMax: day.heartRate?.max,
                caloriesActive: day.calories?.active,
                caloriesTotal: day.calories?.total,
                activityType: activity.type,
                durationSec: activity.durationMin * 60,
                source,
            });

            dayResult.activities.push(config.label);
            dayResult.sessionCount++;
            totalSessions++;
        }

        // ── Walking (steps) ───────────────────────────────────────────
        if (day.steps > 0) {
            const midnight = `${day.date}T00:00:00.000Z`;

            // Check for existing walking session on this day
            const { data: existingWalk } = await supabase
                .from('activity_sessions')
                .select('id')
                .eq('type', 'walking')
                .eq('trust_score', 85)
                .gte('started_at', midnight)
                .lt('started_at', `${day.date}T23:59:59.999Z`)
                .limit(1)
                .maybeSingle();

            if (!existingWalk) {
                const { error: walkErr } = await supabase
                    .from('activity_sessions')
                    .insert({
                        type: 'walking',
                        started_at: midnight,
                        ended_at: `${day.date}T23:59:59.000Z`,
                        duration_sec: 0,
                        steps: day.steps,
                        verification: 'wearable',
                        trust_score: 85,
                    });

                if (!walkErr) {
                    await saveHealthSnapshot({
                        steps: day.steps,
                        activityType: 'walking',
                        source,
                    });
                    dayResult.sessionCount++;
                    totalSessions++;
                }
            }
        }

        // ── Sleep ─────────────────────────────────────────────────────
        if (day.sleep && day.sleep.durationHours >= 1) {
            // Check for existing sleep session
            const { data: existingSleep } = await supabase
                .from('activity_sessions')
                .select('id')
                .eq('type', 'sleep')
                .eq('started_at', day.sleep.startedAt)
                .limit(1)
                .maybeSingle();

            if (!existingSleep) {
                const { error: sleepErr } = await supabase
                    .from('activity_sessions')
                    .insert({
                        type: 'sleep',
                        started_at: day.sleep.startedAt,
                        ended_at: day.sleep.endedAt,
                        duration_sec: Math.round(day.sleep.durationHours * 3600),
                        verification: 'wearable',
                        trust_score: 85,
                    });

                if (!sleepErr) {
                    await saveHealthSnapshot({
                        sleepDurationH: day.sleep.durationHours,
                        sleepDeepH: day.sleep.deepHours,
                        sleepRemH: day.sleep.remHours,
                        sleepLightH: day.sleep.lightHours,
                        activityType: 'sleep',
                        durationSec: Math.round(day.sleep.durationHours * 3600),
                        source,
                    });
                    dayResult.sleepHours = day.sleep.durationHours;
                    dayResult.sessionCount++;
                    totalSessions++;
                }
            }
        }

        // A day is "active" if it had any qualifying data
        const isActive = dayResult.sessionCount > 0 || day.steps >= 1000;
        if (isActive) {
            activeDates.push(day.date);
        }

        dailyBreakdown.push(dayResult);
        onDayComplete?.(dayResult, idx);
    }

    // ── Build streak ──────────────────────────────────────────────────
    const streakDays = await buildStreakFromDates(activeDates);

    // ── Mark sync as complete ─────────────────────────────────────────
    await supabase.auth.updateUser({
        data: { initial_health_sync_complete: true },
    });

    console.log(`[OnboardingSync] Complete: ${totalSessions} sessions, ${streakDays}-day streak, ${activeDates.length} active days`);

    return { totalSessions, streakDays, activeDates, dailyBreakdown };
}

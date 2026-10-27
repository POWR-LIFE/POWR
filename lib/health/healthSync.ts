/**
 * The health sync, as one function any trigger can run.
 *
 * Until 2026-10-27 this lived inside hooks/useHealthSync and ran on mount and
 * every 15 minutes while a screen was up: a run finished at 09:00 reached the
 * server when its runner next opened POWR. The Series board moves on these
 * rows, so the same read now runs from every chance the app gets:
 *
 *   - the foreground hook, on mount, on every return to the foreground and
 *     every 15 minutes (hooks/useHealthSync);
 *   - the beacon's fence_refresh wake, ~5-6 minutes apart with the app closed
 *     (lib/backgroundNotificationTask → syncHealthFromWake, 10-minute gap);
 *   - HealthKit background delivery, the moment a workout or a night is
 *     written (lib/health/healthKitObserver → syncHealthOnStoreChange).
 *
 * Every path funnels through one single-flight promise, so two triggers that
 * land together share a run instead of racing the dedup read below. Only
 * within one JS context: the server's unique index (23505 → null) and the
 * earn race guard on point_transactions are what hold across contexts.
 *
 * The headless paths read the phone's store only. Third-party OAuth providers
 * keep the foreground hook, which holds their token-expiry handling.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import {
    getCaloriesTodayNow, getHeartRateTodayNow, getWeekHistoryNow,
    type CalorieSummary, type DayHealthSummary, type HeartRateSummary,
} from '@/hooks/useHealthData';
import { logManualSession, saveHealthSnapshot } from '@/lib/api/activity';
import { triggerServerNotification } from '@/lib/api/notifications';
import { sourceLabel, verificationFromProvenance } from '@/lib/health/dataSource';
import { syncDailyVitals } from '@/lib/health/dailyVitals';
import { hydrateGarminDirect } from '@/lib/health/garminDirect';
import { reconcileRecentGymSessions } from '@/lib/health/gymReconcile';
import { captureRecentGymVitals } from '@/lib/health/gymVitals';
import { resolveMaxHr } from '@/lib/health/maxHeartRate';
import { calculateBasePoints, calculateSleepPoints, mapHealthType } from '@/lib/health/points';
import {
    getNativeProviderId, isPausedProvider, isServerDelivered, verificationForProvider,
    type HealthProviderId,
} from '@/lib/health/providers';
import { getInferredActivitiesForWeek } from '@/lib/health/runInference';
import { hydrateTerraPause } from '@/lib/health/terraPause';
import { readWindowVitals, sessionExtras, type WindowVitals } from '@/lib/health/windowVitals';
import { getSessionUser, supabase } from '@/lib/supabase';

export type SnapshotSource = 'healthkit' | 'health_connect' | 'fitbit' | 'whoop' | 'garmin';

export type HealthSyncContext = {
    activeId: HealthProviderId | null;
    /** Apple Health / Health Connect, as opposed to an OAuth provider's own API. */
    isNativeProvider: boolean;
    source: SnapshotSource;
    verificationSource: 'wearable' | 'health';
    getWeekHistory: () => Promise<DayHealthSummary[]>;
    getHeartRateToday: () => Promise<HeartRateSummary | null>;
    getCaloriesToday: () => Promise<CalorieSummary | null>;
};

/** What a run wrote: new paying sessions (workouts, inferred cardio) and their points. */
export type HealthSyncResult = { sessions: number; points: number };

const NOTHING: HealthSyncResult = { sessions: 0, points: 0 };

/** True if an ISO timestamp falls on the current local calendar day. */
function isLocalToday(iso: string): boolean {
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
}

/** Map provider id → snapshot source label */
export function sourceForProvider(id: HealthProviderId | null): SnapshotSource {
    if (id === 'whoop') return 'whoop';
    if (id === 'fitbit') return 'fitbit';
    if (id === 'garmin') return 'garmin';
    return Platform.OS === 'ios' ? 'healthkit' : 'health_connect';
}

async function syncSleep(ctx: HealthSyncContext, weekHistory: DayHealthSummary[], syncedKeys: Set<string>) {
    const { source, verificationSource } = ctx;
    try {
        for (const day of weekHistory) {
            const sleep = day.sleep;
            if (!sleep || sleep.durationHours < 1) continue; // ignore very short naps

            const key = `sleep_${new Date(sleep.startedAt).toISOString()}`;
            if (syncedKeys.has(key)) continue;

            const points = calculateSleepPoints(sleep.durationHours, sleep.deepHours, sleep.remHours);

            const sleepSessionId = await logManualSession({
                type: 'sleep',
                duration_sec: Math.round(sleep.durationHours * 3600),
                started_at: sleep.startedAt,
                points,
                healthVerified: true,
                healthSource: verificationSource,
                sleepDeepH: sleep.deepHours,
                sleepRemH: sleep.remHours,
                sleepLightH: sleep.lightHours,
                source,
            });

            if (!sleepSessionId) continue;

            // Same receipt Terra sleep gets server-side — HealthKit/Health Connect
            // sync lands here instead, so fire it from the sync path. The server
            // owns the gates (preference, 1/day cap, feed row); best-effort only.
            //
            // Gated to nights that ended in the last 24h, mirroring the webhook:
            // this loop walks a week of history, and a first sync (or a gap in
            // syncedKeys) would otherwise congratulate old nights as if they were
            // last night. Points still land; only the receipt is fresh-only.
            const sleepEndMs = sleep.endedAt
                ? new Date(sleep.endedAt).getTime()
                : new Date(sleep.startedAt).getTime() + sleep.durationHours * 3600_000;
            const endedRecently = Date.now() - sleepEndMs < 24 * 60 * 60 * 1000;
            if (points > 0 && endedRecently) {
                try {
                    const uid = (await getSessionUser())?.id;
                    if (uid) {
                        await triggerServerNotification(uid, 'sleep_target_met', {
                            hours: sleep.durationHours, points,
                        });
                    }
                } catch { /* receipt must never break the sync */ }
            }

            await saveHealthSnapshot({
                sessionId: sleepSessionId,
                sleepDurationH: sleep.durationHours,
                sleepDeepH: sleep.deepHours,
                sleepRemH: sleep.remHours,
                sleepLightH: sleep.lightHours,
                activityType: 'sleep',
                durationSec: Math.round(sleep.durationHours * 3600),
                source,
            });

            console.log(`[HealthSync] Synced sleep ${day.date}: ${sleep.durationHours}h → ${points} pts`);
        }
    } catch (e) {
        console.error('[HealthSync] Error syncing sleep:', e);
    }
}

/**
 * One full pass: the week's workouts, inferred cardio, sleep, gym reconcile
 * and vitals. Throws ProviderAuthExpiredError through to the caller (the
 * foreground hook disconnects and tells the member); anything else is logged
 * and the pass ends.
 */
async function runHealthSync(ctx: HealthSyncContext): Promise<HealthSyncResult> {
    const { isNativeProvider, source, verificationSource } = ctx;
    const result: HealthSyncResult = { sessions: 0, points: 0 };

    // Pull a full week of health data so late-arriving activities (Garmin's
    // delayed cloud→Health sync, or the app being closed across midnight) are
    // still captured — not just today's. getWeekHistory already fetches per-day
    // workouts for every provider; we used to read only today and silently drop
    // anything older. Sleep (below) reuses the same fetch.
    const weekHistory = await ctx.getWeekHistory();

    // Existing synced sessions over the same window, to avoid duplicates.
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);

    // Scoped on user_id: activity_sessions has an "admins can read all"
    // policy, so without it syncedKeys fills with OTHER users' sessions and
    // this user's own workouts get silently dropped as "already synced".
    const uid = (await getSessionUser())?.id;
    if (!uid) return result;

    const { data: existingSessions } = await supabase
        .from('activity_sessions')
        .select('type, started_at')
        .eq('user_id', uid)
        // Match both health-synced sources so dedup survives the wearable→health split.
        .in('verification', ['wearable', 'health'])
        .gte('started_at', weekAgo.toISOString());

    const syncedKeys = new Set(
        (existingSessions ?? []).map(s => `${s.type}_${new Date(s.started_at).toISOString()}`),
    );

    // Workouts already recorded as SUPPRESSED (a geofence check-in covered
    // their window) are settled too: without this, every sync re-reads their
    // vitals and re-attempts the suppression insert for the whole 7-day
    // window. Same identity key as the table's unique index. Best-effort — on
    // error the upsert's DO NOTHING keeps the re-attempt harmless.
    const { data: suppressedDone } = await supabase
        .from('suppressed_workouts')
        .select('type, started_at')
        .eq('user_id', uid)
        .gte('started_at', weekAgo.toISOString());
    for (const s of suppressedDone ?? []) {
        syncedKeys.add(`${s.type}_${new Date(s.started_at).toISOString()}`);
    }

    // The same start instant is the same workout, whatever it was typed as.
    // syncedKeys is keyed on type, so a workout whose type changed after it
    // was recorded (the Health Connect type table was corrected on
    // 2026-10-07, turning a run that synced as gym back into a run) would
    // otherwise land a second time under its new type and be paid twice.
    const recordedWorkoutStarts = new Set(
        [...(existingSessions ?? []), ...(suppressedDone ?? [])]
            .filter(s => s.type !== 'walking' && s.type !== 'sleep')
            .map(s => new Date(s.started_at).toISOString()),
    );

    // Today's heart rate + calories — used to enrich *today's* sessions only. We
    // have no per-day aggregates for past days, so backfilled sessions are saved
    // without (misleading) day-wide HR/calorie figures rather than wrong ones.
    const [heartRate, calories] = await Promise.all([
        ctx.getHeartRateToday().catch(() => null),
        ctx.getCaloriesToday().catch(() => null),
    ]);

    // Max heart rate for the zone breakdown of each workout's window — read
    // once per sync (cached for the session). Null = no zones, nothing else.
    const maxHr = isNativeProvider ? await resolveMaxHr().catch(() => null) : null;

    // ── Workouts (every provider; today + backfill) ─────────────────────
    const workouts = weekHistory.flatMap(d => d.activities);
    let receiptCount = 0;
    let receiptPoints = 0;
    let receiptLabel: string | null = null;
    for (const health of workouts) {
        const mappedType = mapHealthType(health.type);
        if (!mappedType) continue;

        const key = `${mappedType}_${new Date(health.startedAt).toISOString()}`;
        if (syncedKeys.has(key)) continue;
        const startKey = new Date(health.startedAt).toISOString();
        if (recordedWorkoutStarts.has(startKey)) continue;
        syncedKeys.add(key); // also guard against duplicates within this run
        recordedWorkoutStarts.add(startKey);

        const today = isLocalToday(health.startedAt);
        // On the native path, derive wearable-vs-phone from the sample's own
        // provenance (which app/device wrote it); fall back to the provider-level
        // label when there's no per-sample source (e.g. OAuth providers).
        const activityVerification = isNativeProvider
            ? verificationFromProvenance(health.source, verificationSource)
            : verificationSource;

        // The workout's OWN heart rate and calories, read over its window — not
        // the day's figure stamped on every session (which the Progress sheet
        // has to gate out as untrustworthy). Null when the store recorded nothing
        // for that span, in which case we fall back to the day-wide read for
        // today only, exactly as before.
        const windowVitals: WindowVitals | null = isNativeProvider
            ? await readWindowVitals(+new Date(health.startedAt), +new Date(health.startedAt) + health.durationMin * 60000, { maxHr })
            : null;
        const hrAvgFor = windowVitals?.hrAvg ?? (today ? heartRate?.avg : undefined);

        const workoutPoints = calculateBasePoints(mappedType, health.durationMin, health.distanceM);
        const workoutSessionId = await logManualSession({
            type: mappedType,
            duration_sec: health.durationMin * 60,
            distance_m: health.distanceM,
            hr_avg: hrAvgFor,
            // Only consumed if a check-in suppresses this workout, in which case
            // the suppressed_workouts row is the sole holder of its vitals — a
            // recorded session gets them via saveHealthSnapshot below instead.
            hr_max: windowVitals?.hrMax ?? (today ? heartRate?.max : undefined),
            calories_active: windowVitals?.caloriesActive ?? (today ? calories?.active : undefined),
            source,
            started_at: health.startedAt,
            points: workoutPoints,
            healthVerified: true,
            healthSource: activityVerification,
            rawActivityName: health.rawName ?? health.type,
            pointsFor: (mins, distM) => calculateBasePoints(mappedType, mins, distM),
        });

        if (workoutSessionId && workoutPoints > 0) {
            receiptCount++;
            receiptPoints += workoutPoints;
            receiptLabel = (health.rawName ?? health.type ?? '').trim() || mappedType;
        }

        // Save full health snapshot for this session. sessionId is what lets the
        // Progress day sheet read these vitals back — without it the row is
        // orphaned (see supabase/migrations/20260801110000_*).
        // Only write when a session was actually created; logManualSession returns
        // null for already-synced sessions and overlap-suppressed ones, and an
        // orphaned snapshot (session_id NULL) accumulates duplicates across runs.
        if (workoutSessionId != null) {
            await saveHealthSnapshot({
                sessionId: workoutSessionId,
                steps: health.steps,
                distanceM: health.distanceM,
                hrAvg: windowVitals?.hrAvg ?? (today ? heartRate?.avg : undefined),
                hrMax: windowVitals?.hrMax ?? (today ? heartRate?.max : undefined),
                hrResting: today ? heartRate?.resting : undefined,
                caloriesActive: windowVitals?.caloriesActive ?? (today ? calories?.active : undefined),
                caloriesTotal: windowVitals ? undefined : (today ? calories?.total : undefined),
                activityType: health.type,
                durationSec: health.durationMin * 60,
                source,
                sourceDetail: health.source ? sourceLabel(health.source) : undefined,
                // The marker that lets the sheet trust these over a day-wide row
                // from the same provider, plus the window's heart-rate zones. Only
                // when the window actually measured.
                extras: windowVitals ? sessionExtras(windowVitals) : undefined,
            });
        }

        console.log(`[HealthSync] Synced ${mappedType} from ${health.startedAt}`);
    }

    // ── Inferred cardio (wearables that mirror metrics but write no workout) ──
    // Garmin et al. push distance/HR into Apple Health without an HKWorkout, so
    // the workout loop above never sees them. Reconstruct run/cycle/swim from the
    // wearable-sourced distance across the week (each lives in its own HK distance
    // type, so the type is self-identifying). iOS native path only.
    //
    // Dedup against the workout path used to lean on the once-per-type-per-day DB
    // constraint. That constraint destroyed split workouts and was replaced
    // (migration 20260807120000), so the guard is now explicit and, being
    // overlap-based rather than day-based, strictly stronger: the in-memory check
    // below catches a workout in THIS fetch, and logManualSession folds an
    // inferred activity into any already-persisted session it overlaps.
    if (isNativeProvider && Platform.OS === 'ios') {
        const inferred = await getInferredActivitiesForWeek().catch(() => []);
        for (const act of inferred) {
            const key = `${act.type}_${new Date(act.startedAt).toISOString()}`;
            if (syncedKeys.has(key)) continue;

            // Skip if a real workout of the same type already covers this window
            // (e.g. an Apple Watch run), so we never compete with the workout-path
            // session for the same effort.
            const actStart = +new Date(act.startedAt);
            const actEnd = +new Date(act.endedAt);
            const overlapsWorkout = workouts.some(h => {
                if (mapHealthType(h.type) !== act.type) return false;
                const hs = +new Date(h.startedAt);
                const he = hs + h.durationMin * 60000;
                return actStart < he && hs < actEnd;
            });
            if (overlapsWorkout) continue;
            syncedKeys.add(key);

            const today = isLocalToday(act.startedAt);
            const actVerification = verificationFromProvenance(act.source, verificationSource);
            const inferredPoints = calculateBasePoints(act.type, act.durationMin, act.distanceM);
            // Same per-window read as the workout path — this IS the native path.
            const actVitals = await readWindowVitals(actStart, actEnd, { maxHr });
            const inferredSessionId = await logManualSession({
                type: act.type,
                duration_sec: act.durationMin * 60,
                distance_m: act.distanceM,
                hr_avg: actVitals?.hrAvg ?? (today ? heartRate?.avg : undefined),
                // Same as the workout path: only read if a check-in suppresses this
                // activity and the suppressed record becomes its vitals' one home.
                hr_max: actVitals?.hrMax ?? (today ? heartRate?.max : undefined),
                calories_active: actVitals?.caloriesActive ?? undefined,
                source,
                started_at: act.startedAt,
                points: inferredPoints,
                healthVerified: true,
                healthSource: actVerification,
                pointsFor: (mins, distM) => calculateBasePoints(act.type, mins, distM),
            });

            if (inferredSessionId && inferredPoints > 0) {
                receiptCount++;
                receiptPoints += inferredPoints;
                receiptLabel = act.type;
            }

            if (inferredSessionId != null) {
                await saveHealthSnapshot({
                    sessionId: inferredSessionId,
                    distanceM: act.distanceM,
                    hrAvg: actVitals?.hrAvg ?? (today ? heartRate?.avg : undefined),
                    hrMax: actVitals?.hrMax ?? (today ? heartRate?.max : undefined),
                    hrResting: today ? heartRate?.resting : undefined,
                    caloriesActive: actVitals?.caloriesActive ?? undefined,
                    activityType: act.type,
                    durationSec: act.durationMin * 60,
                    source,
                    sourceDetail: act.source ? sourceLabel(act.source) : undefined,
                    extras: actVitals ? sessionExtras(actVitals) : undefined,
                });
            }

            console.log(`[HealthSync] Synced inferred ${act.type} ${act.startedAt} (${act.distanceM}m, ${act.avgSpeedKmh}km/h)`);
        }
    }

    result.sessions = receiptCount;
    result.points = receiptPoints;

    // ── Workout-synced receipt ──────────────────────────────────────────
    // Terra users get this from the webhook; HealthKit / Health Connect
    // sessions land through THIS client path instead, so fire the same
    // receipt here (one batched call per sync). The server owns every gate
    // (wearable_session preference, 1/day cap, feed row) — a repeat sync
    // later in the day just logs a type_daily_cap skip.
    if (receiptCount > 0) {
        try {
            await triggerServerNotification(uid, 'wearable_session_recorded', {
                count: receiptCount,
                points: receiptPoints,
                activity_label: receiptCount === 1 ? receiptLabel : undefined,
            });
        } catch { /* receipt must never break the sync */ }
    }

    // ── Sleep sync (week backfill, same fetch) ──────────────────────────
    await syncSleep(ctx, weekHistory, syncedKeys);

    // ── Reconcile recent gym sessions against step activity ─────────────
    // Corrects GPS-only durations (late entry / missed exit) using the health
    // store. Idempotent + best-effort, so it never blocks the sync above.
    await reconcileRecentGymSessions().catch(e =>
        console.warn('[HealthSync] gym reconcile failed:', e),
    );

    // ── Give recent check-ins the heart rate / calories the phone recorded ──
    // After reconcile on purpose: the read is over the session's window, so it
    // should see the corrected one. Native store only — Terra providers reach
    // the sheet through suppressed_workouts instead. Write-once, best-effort.
    if (isNativeProvider) {
        await captureRecentGymVitals().catch(e =>
            console.warn('[HealthSync] gym vitals capture failed:', e),
        );
        // ── The week's resting HR and HRV, one row per day ────────────────
        // What terra-webhook writes for cloud wearables, read from the phone
        // store instead — the Body tab's resting-HR and HRV charts. Hourly at
        // most; never blocks the sync.
        await syncDailyVitals().catch(e =>
            console.warn('[HealthSync] daily vitals failed:', e),
        );
    }

    return result;
}

// ── Single flight ────────────────────────────────────────────────────────────

let inFlight: Promise<HealthSyncResult> | null = null;
let lastRunAt = 0;

/** When the last pass finished in this JS context (ms epoch); 0 = never. */
export function lastHealthSyncAt(): number {
    return lastRunAt;
}

/**
 * Runs one pass, or joins the one in flight. Every trigger goes through here.
 * ProviderAuthExpiredError propagates; anything else is logged and resolves
 * to nothing written.
 */
export function syncHealthNow(ctx: HealthSyncContext): Promise<HealthSyncResult> {
    if (inFlight) return inFlight;
    inFlight = runHealthSync(ctx)
        .finally(() => { lastRunAt = Date.now(); inFlight = null; });
    return inFlight;
}

// ── Headless entry (wake, HealthKit delivery) ───────────────────────────────

/**
 * Reads `profiles.active_health_provider`, falls back to the native provider
 * for this OS — the same resolution walkingSync does on a wake. A headless
 * start has no switch value in memory yet; load the cached ones.
 */
async function resolveActiveProviderId(): Promise<HealthProviderId | null> {
    try {
        const user = await getSessionUser();
        if (!user) return getNativeProviderId();
        const { data } = await supabase
            .from('profiles')
            .select('active_health_provider')
            .eq('id', user.id)
            .single<{ active_health_provider: HealthProviderId | null }>();
        const active = data?.active_health_provider ?? null;
        await Promise.all([hydrateTerraPause(), hydrateGarminDirect()]);
        if (!active || isPausedProvider(active)) return getNativeProviderId();
        return active;
    } catch {
        return getNativeProviderId();
    }
}

/**
 * The phone-store context with no screen up. Null when there's nothing for a
 * headless pass to do: no member signed in, a provider the server delivers
 * for (Terra, Garmin direct), or an OAuth provider the foreground hook owns.
 */
export async function headlessHealthSyncContext(): Promise<HealthSyncContext | null> {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
    if (!(await getSessionUser())) return null;
    const activeId = await resolveActiveProviderId();
    if (isServerDelivered(activeId)) return null;
    const isNativeProvider = !activeId || activeId === 'apple-health' || activeId === 'health-connect';
    if (!isNativeProvider) return null;
    return {
        activeId,
        isNativeProvider,
        source: sourceForProvider(activeId),
        verificationSource: verificationForProvider(activeId),
        getWeekHistory: getWeekHistoryNow,
        getHeartRateToday: getHeartRateTodayNow,
        getCaloriesToday: getCaloriesTodayNow,
    };
}

const WAKE_SYNC_KEY = '@powr/health_wake_sync_at';
const WAKE_SYNC_MIN_GAP_MS = 10 * 60 * 1000;

/**
 * The sync off the beacon's wake (and the BackgroundFetch task, where that
 * ever runs). Throttled to one pass per 10 minutes across JS contexts, the
 * stamp written BEFORE the read so a hang can't hold the gate open; own
 * try/catch; cannot reject. Sits last in the wake chain, after the check-in
 * self-heal, and must never be able to delay it.
 */
export async function syncHealthFromWake(): Promise<HealthSyncResult> {
    try {
        const last = Number((await AsyncStorage.getItem(WAKE_SYNC_KEY)) ?? 0);
        if (Number.isFinite(last) && Date.now() - last < WAKE_SYNC_MIN_GAP_MS) return NOTHING;
        await AsyncStorage.setItem(WAKE_SYNC_KEY, String(Date.now()));
        const ctx = await headlessHealthSyncContext();
        if (!ctx) return NOTHING;
        return await syncHealthNow(ctx);
    } catch (err) {
        console.warn('[HealthSync] wake sync failed (non-fatal):', err);
        return NOTHING;
    }
}

const CHANGE_DEBOUNCE_MS = 8_000;
const CHANGE_MIN_GAP_MS = 45_000;
let changeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The sync off a store change (HealthKit background delivery). A workout
 * write lands as a burst of samples, so the pass waits 8 s for the burst to
 * settle, and never runs twice within 45 s. Own try/catch; cannot reject.
 */
export function syncHealthOnStoreChange(): void {
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
        changeTimer = null;
        void (async () => {
            try {
                if (Date.now() - lastRunAt < CHANGE_MIN_GAP_MS) return;
                const ctx = await headlessHealthSyncContext();
                if (!ctx) return;
                await syncHealthNow(ctx);
            } catch (err) {
                console.warn('[HealthSync] store-change sync failed (non-fatal):', err);
            }
        })();
    }, CHANGE_DEBOUNCE_MS);
}

/** Test seam: forget the throttle state. */
export function __resetHealthSyncForTests(): void {
    inFlight = null;
    lastRunAt = 0;
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = null;
}

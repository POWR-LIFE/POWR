import { useEffect, useCallback, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import { useHealthData, type DayHealthSummary } from './useHealthData';
import { useHealthProviders } from './useHealthProviders';
import { getProvider, verificationForProvider, isTerraProvider, ALL_PROVIDER_META, type HealthProviderId } from '@/lib/health/providers';
import { ProviderAuthExpiredError } from '@/lib/health/providers/types';
import { verificationFromProvenance, sourceLabel } from '@/lib/health/dataSource';
import { getInferredActivitiesForWeek } from '@/lib/health/runInference';
import { reconcileRecentGymSessions } from '@/lib/health/gymReconcile';
import { captureRecentGymVitals } from '@/lib/health/gymVitals';
import { readWindowVitals, SESSION_SCOPED_EXTRAS, type WindowVitals } from '@/lib/health/windowVitals';
import { supabase } from '@/lib/supabase';
import { calculateBasePoints, calculateSleepPoints, mapHealthType } from '@/lib/health/points';
import { logManualSession, saveHealthSnapshot } from '@/lib/api/activity';
import { triggerServerNotification } from '@/lib/api/notifications';
import { getSessionUser } from '@/lib/supabase';

/** True if an ISO timestamp falls on the current local calendar day. */
function isLocalToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

/** Map provider id → snapshot source label */
function sourceForProvider(id: HealthProviderId | null): 'healthkit' | 'health_connect' | 'fitbit' | 'whoop' | 'garmin' {
  if (id === 'whoop') return 'whoop';
  if (id === 'fitbit') return 'fitbit';
  if (id === 'garmin') return 'garmin';
  return Platform.OS === 'ios' ? 'healthkit' : 'health_connect';
}

export function useHealthSync() {
  const nativeHealth = useHealthData();
  const { activeId, disconnect } = useHealthProviders();
  const isNativeProvider = !activeId || activeId === 'apple-health' || activeId === 'health-connect';
  // Terra providers are synced server-side by the terra-webhook edge function —
  // the client must never pull their data here.
  const isTerra = isTerraProvider(activeId);
  const authExpiredHandled = useRef(false);

  // Reset the guard when the active provider changes (e.g. user reconnects).
  useEffect(() => { authExpiredHandled.current = false; }, [activeId]);

  // For native providers, use the useHealthData hook directly.
  // For third-party providers (Whoop, Fitbit, etc.), use the provider instance.
  const getHeartRateToday = useCallback(async () => {
    if (isNativeProvider) return nativeHealth.getHeartRateToday();
    try {
      const provider = getProvider(activeId!);
      return provider.getHeartRateToday();
    } catch { return null; }
  }, [isNativeProvider, activeId, nativeHealth.getHeartRateToday]);

  const getCaloriesToday = useCallback(async () => {
    if (isNativeProvider) return nativeHealth.getCaloriesToday();
    try {
      const provider = getProvider(activeId!);
      return provider.getCaloriesToday();
    } catch { return null; }
  }, [isNativeProvider, activeId, nativeHealth.getCaloriesToday]);

  // Consider syncing authorized if either native health is authorized or a
  // (non-Terra) third-party provider is active. Terra providers deliver data via
  // webhook, so the client sync loop stays off for them.
  const isAuthorized = isTerra ? false : (isNativeProvider ? nativeHealth.isAuthorized : !!activeId);
  const source = sourceForProvider(activeId);
  // 'wearable' only for dedicated wearable providers; native phone sync is 'health'.
  const verificationSource = verificationForProvider(activeId);

  const getWeekHistory = useCallback(async () => {
    if (isNativeProvider) return nativeHealth.getWeekHistory();
    try {
      const provider = getProvider(activeId!);
      return provider.getWeekHistory();
    } catch { return []; }
  }, [isNativeProvider, activeId, nativeHealth.getWeekHistory]);

  const syncSleep = useCallback(async (weekHistory: DayHealthSummary[], syncedKeys: Set<string>) => {
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
  }, [source, verificationSource]);

  const syncActivities = useCallback(async () => {
    if (!isAuthorized) return;

    try {
      // Pull a full week of health data so late-arriving activities (Garmin's
      // delayed cloud→Health sync, or the app being closed across midnight) are
      // still captured — not just today's. getWeekHistory already fetches per-day
      // workouts for every provider; we used to read only today and silently drop
      // anything older. Sleep (below) reuses the same fetch.
      const weekHistory = await getWeekHistory();

      // Existing synced sessions over the same window, to avoid duplicates.
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      weekAgo.setHours(0, 0, 0, 0);

      // Scoped on user_id: activity_sessions has an "admins can read all"
      // policy, so without it syncedKeys fills with OTHER users' sessions and
      // this user's own workouts get silently dropped as "already synced".
      const uid = (await getSessionUser())?.id;
      if (!uid) return;

      const { data: existingSessions } = await supabase
        .from('activity_sessions')
        .select('type, started_at')
        .eq('user_id', uid)
        // Match both health-synced sources so dedup survives the wearable→health split.
        .in('verification', ['wearable', 'health'])
        .gte('started_at', weekAgo.toISOString());

      const syncedKeys = new Set(
        (existingSessions ?? []).map(s => `${s.type}_${new Date(s.started_at).toISOString()}`)
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

      // Today's heart rate + calories — used to enrich *today's* sessions only. We
      // have no per-day aggregates for past days, so backfilled sessions are saved
      // without (misleading) day-wide HR/calorie figures rather than wrong ones.
      const [heartRate, calories] = await Promise.all([
        getHeartRateToday().catch(() => null),
        getCaloriesToday().catch(() => null),
      ]);

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
        syncedKeys.add(key); // also guard against duplicates within this run

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
          ? await readWindowVitals(+new Date(health.startedAt), +new Date(health.startedAt) + health.durationMin * 60000)
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
            // from the same provider. Only when the window actually measured.
            extras: windowVitals ? { ...SESSION_SCOPED_EXTRAS } : undefined,
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
          const actVitals = await readWindowVitals(actStart, actEnd);
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
              extras: actVitals ? { ...SESSION_SCOPED_EXTRAS } : undefined,
            });
          }

          console.log(`[HealthSync] Synced inferred ${act.type} ${act.startedAt} (${act.distanceM}m, ${act.avgSpeedKmh}km/h)`);
        }
      }

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
      await syncSleep(weekHistory, syncedKeys);

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
      }
    } catch (e: any) {
      // OAuth token expired — auto-disconnect and alert the user once.
      if (e instanceof ProviderAuthExpiredError) {
        if (!authExpiredHandled.current) {
          authExpiredHandled.current = true;
          const name = ALL_PROVIDER_META.find(m => m.id === e.providerId)?.name ?? e.providerId;
          // Clean up DB state so UI everywhere reflects the disconnection.
          disconnect(e.providerId as HealthProviderId).catch(err =>
            console.error('[HealthSync] Failed to auto-disconnect:', err),
          );
          Alert.alert(
            `${name} disconnected`,
            `Your ${name} connection has expired. Go to Settings to reconnect.`,
          );
        }
        return;
      }
      console.error('[HealthSync] Error syncing activities:', e);
    }
  }, [isAuthorized, getWeekHistory, getHeartRateToday, getCaloriesToday, source, verificationSource, isNativeProvider, syncSleep]);

  useEffect(() => {
    if (isAuthorized) {
      syncActivities();
      const interval = setInterval(syncActivities, 1000 * 60 * 15); // every 15 mins
      return () => clearInterval(interval);
    }
  }, [isAuthorized, syncActivities]);

  return { syncActivities };
}

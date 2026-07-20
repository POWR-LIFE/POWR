import { useEffect, useCallback, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import { useHealthData, type DayHealthSummary } from './useHealthData';
import { useHealthProviders } from './useHealthProviders';
import { getProvider, verificationForProvider, isTerraProvider, ALL_PROVIDER_META, type HealthProviderId } from '@/lib/health/providers';
import { ProviderAuthExpiredError } from '@/lib/health/providers/types';
import { verificationFromProvenance, sourceLabel } from '@/lib/health/dataSource';
import { getInferredActivitiesForWeek } from '@/lib/health/runInference';
import { reconcileRecentGymSessions } from '@/lib/health/gymReconcile';
import { supabase } from '@/lib/supabase';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { logManualSession, saveHealthSnapshot } from '@/lib/api/activity';

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

        const isNew = await logManualSession({
          type: 'sleep',
          duration_sec: Math.round(sleep.durationHours * 3600),
          started_at: sleep.startedAt,
          points,
          healthVerified: true,
          healthSource: verificationSource,
        });

        if (!isNew) continue;

        await saveHealthSnapshot({
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

      const { data: existingSessions } = await supabase
        .from('activity_sessions')
        .select('type, started_at')
        // Match both health-synced sources so dedup survives the wearable→health split.
        .in('verification', ['wearable', 'health'])
        .gte('started_at', weekAgo.toISOString());

      const syncedKeys = new Set(
        (existingSessions ?? []).map(s => `${s.type}_${new Date(s.started_at).toISOString()}`)
      );

      // Today's heart rate + calories — used to enrich *today's* sessions only. We
      // have no per-day aggregates for past days, so backfilled sessions are saved
      // without (misleading) day-wide HR/calorie figures rather than wrong ones.
      const [heartRate, calories] = await Promise.all([
        getHeartRateToday().catch(() => null),
        getCaloriesToday().catch(() => null),
      ]);

      // ── Workouts (every provider; today + backfill) ─────────────────────
      const workouts = weekHistory.flatMap(d => d.activities);
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

        await logManualSession({
          type: mappedType,
          duration_sec: health.durationMin * 60,
          distance_m: health.distanceM,
          hr_avg: today ? heartRate?.avg : undefined,
          started_at: health.startedAt,
          points: calculateBasePoints(mappedType, health.durationMin),
          healthVerified: true,
          healthSource: activityVerification,
          rawActivityName: health.rawName ?? health.type,
        });

        // Save full health snapshot for this session
        await saveHealthSnapshot({
          steps: health.steps,
          distanceM: health.distanceM,
          hrAvg: today ? heartRate?.avg : undefined,
          hrMax: today ? heartRate?.max : undefined,
          hrResting: today ? heartRate?.resting : undefined,
          caloriesActive: today ? calories?.active : undefined,
          caloriesTotal: today ? calories?.total : undefined,
          activityType: health.type,
          durationSec: health.durationMin * 60,
          source,
          sourceDetail: health.source ? sourceLabel(health.source) : undefined,
        });

        console.log(`[HealthSync] Synced ${mappedType} from ${health.startedAt}`);
      }

      // ── Inferred cardio (wearables that mirror metrics but write no workout) ──
      // Garmin et al. push distance/HR into Apple Health without an HKWorkout, so
      // the workout loop above never sees them. Reconstruct run/cycle/swim from the
      // wearable-sourced distance across the week (each lives in its own HK distance
      // type, so the type is self-identifying). iOS native path only; the once-per
      // -type-per-day DB constraint dedups against the workout path and re-syncs.
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
          await logManualSession({
            type: act.type,
            duration_sec: act.durationMin * 60,
            distance_m: act.distanceM,
            hr_avg: today ? heartRate?.avg : undefined,
            started_at: act.startedAt,
            points: calculateBasePoints(act.type, act.durationMin),
            healthVerified: true,
            healthSource: actVerification,
          });

          await saveHealthSnapshot({
            distanceM: act.distanceM,
            hrAvg: today ? heartRate?.avg : undefined,
            hrMax: today ? heartRate?.max : undefined,
            hrResting: today ? heartRate?.resting : undefined,
            activityType: act.type,
            durationSec: act.durationMin * 60,
            source,
            sourceDetail: act.source ? sourceLabel(act.source) : undefined,
          });

          console.log(`[HealthSync] Synced inferred ${act.type} ${act.startedAt} (${act.distanceM}m, ${act.avgSpeedKmh}km/h)`);
        }
      }

      // ── Sleep sync (week backfill, same fetch) ──────────────────────────
      await syncSleep(weekHistory, syncedKeys);

      // ── Reconcile recent gym sessions against step activity ─────────────
      // Corrects GPS-only durations (late entry / missed exit) using the health
      // store. Idempotent + best-effort, so it never blocks the sync above.
      await reconcileRecentGymSessions().catch(e =>
        console.warn('[HealthSync] gym reconcile failed:', e),
      );
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

function mapHealthType(name: string): ActivityType | null {
  const n = name.toLowerCase();
  // Running (includes treadmill, jogging)
  if (n.includes('run') || n.includes('jog')) return 'running';
  // Cycling (includes stationary biking, spin)
  if (n.includes('cycl') || n.includes('biking') || n.includes('spin')) return 'cycling';
  // Swimming
  if (n.includes('swim')) return 'swimming';
  // Dance (check before sports to avoid false matches)
  if (n.includes('dance') || n.includes('barre')) return 'dance';
  // Gym / weight training / cardio machines
  if (n.includes('gym') || n.includes('weight') || n.includes('crossfit') || n.includes('calisthenics')
      || n.includes('strength') || n.includes('powerlift') || n.includes('functional fitness')
      || n.includes('bodybuilding') || n.includes('elliptical') || n.includes('rowing')
      || n.includes('stair') || n.includes('core')) return 'gym';
  // HIIT / boot camp / circuit
  if (n.includes('hiit') || n.includes('boot_camp') || n.includes('bootcamp')
      || n.includes('circuit') || n.includes('tabata') || n.includes('f45')) return 'hiit';
  // Yoga / pilates
  if (n.includes('yoga') || n.includes('pilates')) return 'yoga';
  // Sports (ball sports, combat, racquet, etc.)
  if (n.includes('sport') || n.includes('tennis') || n.includes('soccer') || n.includes('basketball')
      || n.includes('handball') || n.includes('volleyball') || n.includes('squash') || n.includes('racquetball')
      || n.includes('fencing') || n.includes('martial') || n.includes('boxing') || n.includes('jiu jitsu')
      || n.includes('kickbox') || n.includes('rugby') || n.includes('football') || n.includes('baseball')
      || n.includes('softball') || n.includes('hockey') || n.includes('cricket') || n.includes('lacrosse')
      || n.includes('golf') || n.includes('pickleball') || n.includes('badminton') || n.includes('table tennis')
      || n.includes('wrestl') || n.includes('surf') || n.includes('climbing') || n.includes('ski')
      || n.includes('snowboard') || n.includes('skat') || n.includes('paddl') || n.includes('gymnastics')) return 'sports';
  // Walking / hiking — handled by walkingSync, not activity sync
  if (n.includes('walk') || n.includes('hik')) return null;
  return null;
}

function calculateBasePoints(type: ActivityType, durationMin: number): number {
  const config = ACTIVITIES[type];
  if (durationMin < config.minDuration) return 0;

  if (type === 'gym') return 10;
  if (type === 'running' || type === 'cycling') return 10;
  if (type === 'swimming') return 7;
  if (type === 'hiit') return 10;
  if (type === 'sports') return 6;
  if (type === 'yoga') return 3;
  return 5;
}

function calculateSleepPoints(hours: number, deepHours?: number, remHours?: number): number {
  let base = 0;
  if (hours >= 8) base = 5;
  else if (hours >= 7) base = 4;
  else if (hours >= 6) base = 3;
  else if (hours >= 5) base = 2;
  else if (hours >= 3) base = 1; // reward anything 3h+ rather than cutting off at 4h

  if (base === 0) return 0;

  // Scale by restorative sleep ratio when stage data is available
  if (deepHours !== undefined && remHours !== undefined) {
    const restorativeRatio = (deepHours + remHours) / hours;
    const multiplier =
      restorativeRatio >= 0.35 ? 1.0 :
      restorativeRatio >= 0.25 ? 0.85 :
      restorativeRatio >= 0.15 ? 0.70 :
      0.60;
    return Math.max(1, Math.round(base * multiplier));
  }

  return base;
}

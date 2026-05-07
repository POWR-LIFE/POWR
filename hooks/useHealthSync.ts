import { useEffect, useCallback, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import { useHealthData } from './useHealthData';
import { useHealthProviders } from './useHealthProviders';
import { getProvider, ALL_PROVIDER_META, type HealthProviderId } from '@/lib/health/providers';
import { ProviderAuthExpiredError } from '@/lib/health/providers/types';
import { supabase } from '@/lib/supabase';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { logManualSession, saveHealthSnapshot } from '@/lib/api/activity';
import { notifySleepTargetMet } from '@/lib/notifications';

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
  const authExpiredHandled = useRef(false);

  // Reset the guard when the active provider changes (e.g. user reconnects).
  useEffect(() => { authExpiredHandled.current = false; }, [activeId]);

  // For native providers, use the useHealthData hook directly.
  // For third-party providers (Whoop, Fitbit, etc.), use the provider instance.
  const getActivitiesToday = useCallback(async () => {
    if (isNativeProvider) return nativeHealth.getActivitiesToday();
    try {
      const provider = getProvider(activeId!);
      return provider.getActivitiesToday();
    } catch { return []; }
  }, [isNativeProvider, activeId, nativeHealth.getActivitiesToday]);

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

  // Consider syncing authorized if either native health is authorized
  // or a third-party provider is the active provider.
  const isAuthorized = isNativeProvider ? nativeHealth.isAuthorized : !!activeId;
  const source = sourceForProvider(activeId);

  const getWeekHistory = useCallback(async () => {
    if (isNativeProvider) return nativeHealth.getWeekHistory();
    try {
      const provider = getProvider(activeId!);
      return provider.getWeekHistory();
    } catch { return []; }
  }, [isNativeProvider, activeId, nativeHealth.getWeekHistory]);

  const syncSleep = useCallback(async (syncedKeys: Set<string>) => {
    try {
      // Fetch the full week of health data so we can backfill all nights,
      // not just the most recent one. This covers the case where a user
      // connects a provider mid-week — previous nights still get synced.
      const weekHistory = await getWeekHistory();

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

        // Notify once for recent sessions that hit the 7-hour target
        const ageMs = Date.now() - new Date(sleep.startedAt).getTime();
        if (sleep.durationHours >= 7 && ageMs < 36 * 60 * 60 * 1000) {
          notifySleepTargetMet(sleep.durationHours, points).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[HealthSync] Error syncing sleep:', e);
    }
  }, [getWeekHistory, source]);

  const syncActivities = useCallback(async () => {
    if (!isAuthorized) return;

    try {
      const healthActivities = await getActivitiesToday();

      // Fetch existing synced sessions for today to avoid duplicates
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data: existingSessions } = await supabase
        .from('activity_sessions')
        .select('type, started_at')
        .eq('verification', 'wearable')
        .gte('started_at', today.toISOString());

      const syncedKeys = new Set(
        (existingSessions ?? []).map(s => `${s.type}_${new Date(s.started_at).toISOString()}`)
      );

      // Fetch heart rate + calories once for snapshot enrichment
      const [heartRate, calories] = await Promise.all([
        getHeartRateToday().catch(() => null),
        getCaloriesToday().catch(() => null),
      ]);

      for (const health of healthActivities) {
        const mappedType = mapHealthType(health.type);
        if (!mappedType) continue;

        const key = `${mappedType}_${new Date(health.startedAt).toISOString()}`;
        if (syncedKeys.has(key)) continue;

        await logManualSession({
          type: mappedType,
          duration_sec: health.durationMin * 60,
          distance_m: health.distanceM,
          hr_avg: heartRate?.avg,
          started_at: health.startedAt,
          points: calculateBasePoints(mappedType, health.durationMin),
          healthVerified: true,
        });

        // Save full health snapshot for this session
        await saveHealthSnapshot({
          steps: health.steps,
          distanceM: health.distanceM,
          hrAvg: heartRate?.avg,
          hrMax: heartRate?.max,
          hrResting: heartRate?.resting,
          caloriesActive: calories?.active,
          caloriesTotal: calories?.total,
          activityType: health.type,
          durationSec: health.durationMin * 60,
          source,
        });

        console.log(`[HealthSync] Synced ${mappedType} from ${health.startedAt}`);
      }

      // ── Sleep sync ──────────────────────────────────────────────────
      await syncSleep(syncedKeys);
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
      const msg = e?.message ?? '';
      if (msg.includes('whoop-oauth') || msg.includes('fitbit-oauth') || msg.includes('broker failed')) {
        console.warn('[HealthSync] OAuth token expired or revoked:', msg);
      } else {
        console.error('[HealthSync] Error syncing activities:', e);
      }
    }
  }, [isAuthorized, getActivitiesToday, getHeartRateToday, getCaloriesToday, source, syncSleep]);

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
  // Gym / weight training
  if (n.includes('gym') || n.includes('weight') || n.includes('crossfit') || n.includes('calisthenics')
      || n.includes('strength') || n.includes('powerlift') || n.includes('functional fitness')
      || n.includes('bodybuilding')) return 'gym';
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
      || n.includes('wrestl') || n.includes('surf') || n.includes('climbing')) return 'sports';
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

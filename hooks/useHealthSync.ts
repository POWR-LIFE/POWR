import { useEffect, useCallback } from 'react';
import { useHealthData } from './useHealthData';
import { supabase } from '@/lib/supabase';
import { ACTIVITIES, type ActivityType } from '@/constants/activities';
import { logManualSession } from '@/lib/api/activity';

export function useHealthSync() {
  const { isAuthorized, getActivitiesToday, getLastNightSleep } = useHealthData();

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

      for (const health of healthActivities) {
        const mappedType = mapHealthType(health.type);
        if (!mappedType) continue;

        const key = `${mappedType}_${new Date(health.startedAt).toISOString()}`;
        if (syncedKeys.has(key)) continue;

        await logManualSession({
          type: mappedType,
          duration_sec: health.durationMin * 60,
          started_at: health.startedAt,
          points: calculateBasePoints(mappedType, health.durationMin),
          healthVerified: true,
        });

        console.log(`[HealthSync] Synced ${mappedType} from ${health.startedAt}`);
      }

      // ── Sleep sync ──────────────────────────────────────────────────
      await syncSleep(syncedKeys);
    } catch (e) {
      console.error('[HealthSync] Error syncing activities:', e);
    }
  }, [isAuthorized, getActivitiesToday, getLastNightSleep]);

  const syncSleep = useCallback(async (syncedKeys: Set<string>) => {
    try {
      const sleep = await getLastNightSleep();
      if (!sleep || sleep.durationHours < 1) return; // ignore very short naps

      const key = `sleep_${new Date(sleep.startedAt).toISOString()}`;
      if (syncedKeys.has(key)) return;

      const points = calculateSleepPoints(sleep.durationHours);

      await logManualSession({
        type: 'sleep',
        duration_sec: Math.round(sleep.durationHours * 3600),
        started_at: sleep.startedAt,
        points,
        healthVerified: true,
      });

      console.log(`[HealthSync] Synced sleep: ${sleep.durationHours}h → ${points} pts`);
    } catch (e) {
      console.error('[HealthSync] Error syncing sleep:', e);
    }
  }, [getLastNightSleep]);

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
  // Running (includes treadmill)
  if (n.includes('run')) return 'running';
  // Cycling (includes stationary biking)
  if (n.includes('cycl') || n.includes('biking')) return 'cycling';
  // Swimming
  if (n.includes('swim')) return 'swimming';
  // Gym / weight training
  if (n.includes('gym') || n.includes('weight') || n.includes('crossfit') || n.includes('calisthenics') || n.includes('strength')) return 'gym';
  // HIIT / boot camp
  if (n.includes('hiit') || n.includes('boot_camp')) return 'hiit';
  // Yoga / pilates
  if (n.includes('yoga') || n.includes('pilates')) return 'yoga';
  // Sports (various ball sports, martial arts, etc.)
  if (n.includes('sport') || n.includes('tennis') || n.includes('soccer') || n.includes('basketball')
      || n.includes('handball') || n.includes('volleyball') || n.includes('squash') || n.includes('racquetball')
      || n.includes('fencing') || n.includes('martial')) return 'sports';
  // Walking / hiking
  if (n.includes('walk') || n.includes('hik')) return null; // walking handled by walkingSync
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

function calculateSleepPoints(hours: number): number {
  // Reward good sleep: 7-9 hours is ideal
  if (hours >= 8) return 5;
  if (hours >= 7) return 4;
  if (hours >= 6) return 3;
  if (hours >= 5) return 2;
  if (hours >= 4) return 1;
  return 0;
}

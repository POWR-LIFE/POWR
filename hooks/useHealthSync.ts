import { useEffect, useCallback, useRef } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import { useHealthData } from './useHealthData';
import { useHealthProviders } from './useHealthProviders';
import { getProvider, verificationForProvider, isServerDelivered, effectiveProviderId, ALL_PROVIDER_META, type HealthProviderId } from '@/lib/health/providers';
import { useTerraPaused } from '@/hooks/useTerraPaused';
import { useGarminDirect } from '@/hooks/useGarminDirect';
import { ProviderAuthExpiredError } from '@/lib/health/providers/types';
import { lastHealthSyncAt, sourceForProvider, syncHealthNow, type HealthSyncContext } from '@/lib/health/healthSync';
import { armHealthKitDelivery } from '@/lib/health/healthKitObserver';
import i18n from '@/lib/i18n';

/**
 * A pass runs on mount, on every return to the foreground and every 15
 * minutes while up. The foreground return is the one that matters: the
 * member finishes a run, opens POWR, and the row is there before the Home
 * screen settles — not up to 15 minutes later, as before 2026-10-27. A
 * return within a minute of the last pass is skipped; the store can't have
 * much new, and the Series board polls every minute anyway.
 */
const FOREGROUND_MIN_GAP_MS = 60_000;

export function useHealthSync() {
  const nativeHealth = useHealthData();
  const { activeId: storedActiveId, disconnect } = useHealthProviders();
  // A paused brand (Garmin while garmin_direct leaves this user out, or every
  // Terra brand while the Terra pause switch is on) delivers nothing — read the
  // phone's health store in its place. Re-derived when either switch flips; the
  // profile itself is left alone.
  useTerraPaused();
  useGarminDirect();
  const activeId = effectiveProviderId(storedActiveId);
  const isNativeProvider = !activeId || activeId === 'apple-health' || activeId === 'health-connect';
  // Terra providers (terra-webhook) and Garmin direct (garmin-webhook) are
  // synced server-side — the client must never pull their data here.
  const isTerra = isServerDelivered(activeId);
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

  const syncActivities = useCallback(async () => {
    if (!isAuthorized) return;

    const ctx: HealthSyncContext = {
      activeId, isNativeProvider, source, verificationSource,
      getWeekHistory, getHeartRateToday, getCaloriesToday,
    };
    try {
      // The pass itself lives in lib/health/healthSync so the beacon wake and
      // HealthKit's background delivery run the very same read with no screen
      // up. One single-flight promise serves every trigger.
      await syncHealthNow(ctx);
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
            i18n.t('health:authExpired.title', { name }),
            i18n.t('health:authExpired.body', { name }),
          );
        }
        return;
      }
      console.error('[HealthSync] Error syncing activities:', e);
    }
  }, [isAuthorized, activeId, isNativeProvider, source, verificationSource, getWeekHistory, getHeartRateToday, getCaloriesToday, disconnect]);

  useEffect(() => {
    if (!isAuthorized) return undefined;
    syncActivities();
    const interval = setInterval(syncActivities, 1000 * 60 * 15); // every 15 mins
    const sub = AppState.addEventListener('change', next => {
      if (next !== 'active') return;
      if (Date.now() - lastHealthSyncAt() < FOREGROUND_MIN_GAP_MS) return;
      void syncActivities();
    });
    return () => { clearInterval(interval); sub.remove(); };
  }, [isAuthorized, syncActivities]);

  // With the phone store authorised, ask HealthKit to wake the app when a
  // workout or a night is written (no-op off iOS, and stood down by the
  // health_bg_delivery switch). The server's switch value is read here, on
  // the foreground, so a cold start armed from the cache catches up.
  useEffect(() => {
    if (!isAuthorized || !isNativeProvider || Platform.OS !== 'ios') return;
    void armHealthKitDelivery({ refreshSwitch: true });
  }, [isAuthorized, isNativeProvider]);

  return { syncActivities };
}

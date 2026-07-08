import * as WebBrowser from 'expo-web-browser';

import { getSessionUser, supabase } from '@/lib/supabase';
import type {
    CalorieSummary,
    DayHealthSummary,
    HealthActivity,
    HeartRateSummary,
    SleepSession,
    VerifyResult,
} from '@/hooks/useHealthData';
import type { HealthProvider, HealthProviderMeta } from './types';
import { HealthProviderNotImplementedError } from './types';

const REDIRECT = 'powr://terra-callback';

/**
 * Provider wrapper for Terra-aggregated cloud wearables (Whoop, Oura, Garmin,
 * Polar, Fitbit, Withings, Coros, and more — see ALL_PROVIDER_META).
 *
 * Terra holds the OAuth tokens and pushes normalised data to the terra-webhook
 * edge function, which writes activity_sessions/health_snapshots server-side. So
 * this wrapper ONLY drives the connect/disconnect lifecycle — it never pulls
 * data on-device. The data-read methods throw HealthProviderNotImplementedError;
 * callers either skip Terra providers (useHealthSync), fall back to native
 * (walkingSync), or wrap the call in try/catch and read from the DB instead
 * (progress / sleep screens are DB-first).
 */
export function createTerraProvider(meta: HealthProviderMeta): HealthProvider {
    const resource = meta.id.toUpperCase(); // Terra resource slug: WHOOP, OURA, ...

    async function loadConnection(): Promise<{ terra_user_id?: string } | null> {
        const user = await getSessionUser();
        if (!user) return null;
        const { data } = await supabase
            .from('profiles')
            .select('health_provider_connections')
            .eq('id', user.id)
            .maybeSingle();
        const conns = data?.health_provider_connections ?? {};
        return conns[meta.id] ?? null;
    }

    const notImplemented = (op: string) => {
        throw new HealthProviderNotImplementedError(meta.id, op);
    };

    return {
        meta,

        async isAvailable() { return true; },

        async isConnected() {
            // Connected only once Terra's auth webhook has written terra_user_id.
            // A stale pre-Terra entry (e.g. an old direct-Whoop connection that
            // lacks terra_user_id) reads as NOT connected → prompts a reconnect.
            const conn = await loadConnection();
            return !!conn?.terra_user_id;
        },

        async connect() {
            try {
                const { data, error } = await supabase.functions.invoke('terra-auth', {
                    body: { resource },
                });
                if (error || !data?.url) {
                    console.warn(`[terra:${meta.id}] widget session failed:`, error?.message ?? data);
                    return 'failed';
                }
                await WebBrowser.openAuthSessionAsync(data.url, REDIRECT);
                // The actual connection is confirmed by Terra's auth webhook; the
                // /terra-callback route only handles the return UX.
                return 'pending';
            } catch (e: any) {
                console.warn(`[terra:${meta.id}] connect threw:`, e?.message ?? e);
                return 'failed';
            }
        },

        async disconnect() {
            const conn = await loadConnection();
            if (conn?.terra_user_id) {
                await supabase.functions.invoke('terra-auth', {
                    body: { action: 'deauth', terra_user_id: conn.terra_user_id },
                }).catch(e => console.warn(`[terra:${meta.id}] deauth failed:`, e?.message ?? e));
            }
            // The profile connection entry is cleared by useHealthProviders.disconnect.
        },

        // ── Data reads: not available on-device for Terra providers ──────────────
        async getStepsToday(): Promise<number> { return notImplemented('getStepsToday'); },
        async getActivitiesToday(): Promise<HealthActivity[]> { return notImplemented('getActivitiesToday'); },
        async getLastNightSleep(): Promise<SleepSession | null> { return notImplemented('getLastNightSleep'); },
        async getHeartRateToday(): Promise<HeartRateSummary | null> { return notImplemented('getHeartRateToday'); },
        async getCaloriesToday(): Promise<CalorieSummary | null> { return notImplemented('getCaloriesToday'); },
        async getWeekHistory(): Promise<DayHealthSummary[]> { return notImplemented('getWeekHistory'); },
        async verifyWalking(): Promise<VerifyResult> { return notImplemented('verifyWalking'); },
        async verifyWorkout(): Promise<VerifyResult> { return notImplemented('verifyWorkout'); },
    };
}

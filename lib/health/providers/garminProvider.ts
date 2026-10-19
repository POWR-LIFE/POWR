import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Platform } from 'react-native';

import { awardBonus } from '@/lib/api/points';
import i18n from '@/lib/i18n';
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

/**
 * Garmin, direct: POWR's own Garmin Connect Developer app, no Terra in between.
 *
 * Like the Terra wrapper, this ONLY drives connect/disconnect. The sign-in
 * runs through the garmin-auth edge function (Garmin requires the code
 * exchange on a server); Garmin then pushes data to garmin-webhook, which
 * writes sessions and points server-side. The data-read methods throw
 * HealthProviderNotImplementedError, and callers treat Garmin as
 * server-delivered (isServerDelivered).
 *
 * The connection is confirmed by garmin-auth's callback, which writes
 * `garmin_user_id` onto the profile entry and then sends the browser to
 * powr://garmin-callback?status=…. Android opens that as a link (the
 * /garmin-callback screen); iOS hands it back to openAuthSessionAsync
 * instead, so the outcome is reported here — see reportOutcome.
 */

/** The status garmin-auth appended to the return address, if any. */
export function garminStatusFrom(url: string | null | undefined): string | null {
    const m = /[?&]status=([a-z_]+)/.exec(url ?? '');
    return m ? m[1] : null;
}

/** iOS only: what /garmin-callback shows on Android. */
function reportOutcome(status: string | null) {
    if (status === 'connected') {
        // One-time +20 POWR for connecting a wearable. Idempotent server-side.
        awardBonus('wearable_connection').catch(() => {});
        return;
    }
    const reason = status === 'denied' ? i18n.t('system:healthCallback.garminDenied')
        : status === 'already_linked' ? i18n.t('system:healthCallback.garminAlreadyLinked')
        : null;
    Alert.alert(i18n.t('system:healthCallback.failed'), reason ?? undefined);
}
export function createGarminProvider(meta: HealthProviderMeta): HealthProvider {
    async function loadConnection(): Promise<{ garmin_user_id?: string } | null> {
        const user = await getSessionUser();
        if (!user) return null;
        const { data } = await supabase
            .from('profiles')
            .select('health_provider_connections')
            .eq('id', user.id)
            .maybeSingle();
        return data?.health_provider_connections?.garmin ?? null;
    }

    const notImplemented = (op: string) => {
        throw new HealthProviderNotImplementedError(meta.id, op);
    };

    return {
        meta,

        async isAvailable() { return true; },

        async isConnected() {
            // Only once garmin-auth has linked an account. An entry left over
            // from the Terra days carries a terra_user_id and no garmin_user_id,
            // and reads as not connected.
            const conn = await loadConnection();
            return !!conn?.garmin_user_id;
        },

        async connect() {
            try {
                // powr://garmin-callback in a build; Expo Go's own address in
                // development. garmin-auth only accepts those two shapes.
                const returnTo = Linking.createURL('garmin-callback');
                const { data, error } = await supabase.functions.invoke('garmin-auth', {
                    body: { action: 'start', return_to: returnTo },
                });
                if (error || !data?.url) {
                    console.warn('[garmin] sign-in start failed:', error?.message ?? data);
                    return 'failed';
                }
                const result = await WebBrowser.openAuthSessionAsync(data.url, returnTo);
                if (Platform.OS === 'ios' && result.type === 'success') {
                    reportOutcome(garminStatusFrom(result.url));
                }
                // garmin-auth's callback has recorded the link (or not); the
                // screens pick it up when they refresh on returning to the app.
                return 'pending';
            } catch (e: any) {
                console.warn('[garmin] connect threw:', e?.message ?? e);
                return 'failed';
            }
        },

        async disconnect() {
            // Garmin requires us to delete the user's registration whenever the
            // app offers its own disconnect. The profile entry is cleared by
            // useHealthProviders.disconnect.
            await supabase.functions.invoke('garmin-auth', { body: { action: 'disconnect' } })
                .catch(e => console.warn('[garmin] disconnect failed:', e?.message ?? e));
        },

        // ── Data reads: Garmin delivers server-side ─────────────────────────────
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

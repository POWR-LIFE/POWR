import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';

import { isTerraProvider } from '@/lib/health/providers';
import type { HealthProviderId } from '@/lib/health/providers';
import { supabase } from '@/lib/supabase';
import { awardBonus } from '@/lib/api/points';

/**
 * Return surface for the Terra connection widget. Terra redirects here as
 * powr://terra-callback?user_id=<terra id>&reference_id=<powr id>&resource=<PROVIDER>
 * on success, or with ?error=... on failure.
 *
 * The authoritative connection record is written server-side by the terra-webhook
 * `auth` event. We only (a) show status and (b) optimistically stamp the profile
 * connection from the redirect's user_id so the UI reflects "Connected" without
 * waiting for the webhook round-trip.
 */
export default function TerraCallback() {
    const router = useRouter();
    // Grab ALL params, not just the known ones: Terra appends a `reason`/`message`
    // to the failure redirect that we want to capture for debugging.
    const params = useLocalSearchParams<{
        user_id?: string;
        reference_id?: string;
        resource?: string;
        error?: string;
        reason?: string;
        message?: string;
    }>();
    const { user_id, resource, error } = params;
    const [status, setStatus] = useState<'connecting' | 'success' | 'failed'>('connecting');
    const [failReason, setFailReason] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try { WebBrowser.dismissBrowser?.(); } catch {}

            if (error || !user_id) {
                // Surface Terra's failure detail. `reason`/`message` are what Terra
                // appends to auth_failure_redirect_url; log the full param set too so
                // anything unexpected still shows up in Metro / logcat.
                const reason = params.reason ?? params.message ?? (user_id ? null : 'no user_id in redirect');
                console.warn('[terra-callback] connection failed:', JSON.stringify(params));
                setFailReason(reason ?? null);
                setStatus('failed');
                returnHome(router, true);
                return;
            }

            // Optimistically record the connection on the profile (webhook reconciles).
            try {
                const providerId = (resource ?? '').toLowerCase();
                const { data: { user } } = await supabase.auth.getUser();
                if (user && providerId) {
                    const { data: prof } = await supabase
                        .from('profiles')
                        .select('active_health_provider, health_provider_connections')
                        .eq('id', user.id)
                        .single();
                    // One wearable at a time + wearable = source of truth: drop any
                    // other connected wearable and promote this one to active.
                    const conns: Record<string, { connected_at?: string; terra_user_id?: string }> =
                        { ...(prof?.health_provider_connections ?? {}) };
                    for (const k of Object.keys(conns)) {
                        if (k !== providerId && isTerraProvider(k as HealthProviderId)) delete conns[k];
                    }
                    conns[providerId] = {
                        connected_at: new Date().toISOString(),
                        terra_user_id: String(user_id),
                    };
                    await supabase.from('profiles').update({
                        health_provider_connections: conns,
                        active_health_provider: providerId,
                    }).eq('id', user.id);
                    // One-time +20 POWR for connecting a wearable. Idempotent server-side.
                    awardBonus('wearable_connection').catch(() => {});
                }
            } catch {}

            setStatus('success');
            returnHome(router, false);
        })();
    }, [user_id, resource, error]);

    return (
        <View style={{ flex: 1, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <ActivityIndicator size="large" color="#facc15" />
            <Text style={{ color: '#F2F2F2', marginTop: 16, fontSize: 14, textAlign: 'center' }}>
                {status === 'connecting' && 'Connecting…'}
                {status === 'success' && 'Connected!'}
                {status === 'failed' && 'Connection failed — tap back to retry.'}
            </Text>
            {status === 'failed' && failReason && (
                <Text style={{ color: '#9CA3AF', marginTop: 8, fontSize: 12, textAlign: 'center' }}>
                    {failReason}
                </Text>
            )}
        </View>
    );
}

async function returnHome(router: ReturnType<typeof useRouter>, failed: boolean) {
    const returnTo = await SecureStore.getItemAsync('oauth.returnTo');
    await SecureStore.deleteItemAsync('oauth.returnTo');
    // Linger on failure so the reason is readable before bouncing back.
    setTimeout(() => router.replace(returnTo === 'settings' ? '/settings-screen' : '/onboarding-health'), failed ? 4000 : 600);
}

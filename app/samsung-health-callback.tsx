import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';

import { completeSamsungHealthAuth } from '@/lib/health/providers/samsungHealthProvider';
import { getSessionUser, supabase } from '@/lib/supabase';

export default function SamsungHealthCallback() {
    const router = useRouter();
    const { code, state, error } = useLocalSearchParams<{
        code?: string;
        state?: string;
        error?: string;
    }>();
    const [status, setStatus] = useState<'exchanging' | 'success' | 'failed'>('exchanging');
    const [failReason, setFailReason] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try { WebBrowser.dismissBrowser?.(); } catch {}
            if (error) {
                console.warn('[samsung-health-callback] OAuth error param:', error);
                setFailReason(`Samsung Health returned: ${error}`);
                setStatus('failed');
                return;
            }
            if (!code || !state) {
                console.warn('[samsung-health-callback] missing code/state', { code: !!code, state: !!state });
                setFailReason('Missing authorization code');
                setStatus('failed');
                return;
            }
            try {
                const ok = await completeSamsungHealthAuth(code, state);
                if (!ok) {
                    setFailReason('State mismatch or empty token response');
                    setStatus('failed');
                    return;
                }
            } catch (e: any) {
                console.warn('[samsung-health-callback] completeSamsungHealthAuth threw:', e);
                setFailReason(e?.message ?? 'Token exchange failed');
                setStatus('failed');
                return;
            }

            // Mark provider as connected on the profile.
            try {
                const user = await getSessionUser();
                if (user) {
                    const { data: prof } = await supabase
                        .from('profiles')
                        .select('active_health_provider, health_provider_connections')
                        .eq('id', user.id)
                        .single();
                    const nextConns = {
                        ...(prof?.health_provider_connections ?? {}),
                        'samsung-health': {
                            connected_at: new Date().toISOString(),
                            scopes: [
                                'com.samsung.health.step_count.read',
                                'com.samsung.health.exercise.read',
                                'com.samsung.health.sleep.read',
                                'com.samsung.health.heart_rate.read',
                            ],
                        },
                    };
                    await supabase.from('profiles').update({
                        health_provider_connections: nextConns,
                        active_health_provider: prof?.active_health_provider ?? 'samsung-health',
                    }).eq('id', user.id);
                }
            } catch {}

            setStatus('success');
            const returnTo = await SecureStore.getItemAsync('oauth.returnTo');
            await SecureStore.deleteItemAsync('oauth.returnTo');
            setTimeout(() => router.replace(returnTo === 'settings' ? '/settings-screen' : '/onboarding-health'), 600);
        })();
    }, [code, state, error]);

    return (
        <View style={{ flex: 1, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <ActivityIndicator size="large" color="#facc15" />
            <Text style={{ color: '#F2F2F2', marginTop: 16, fontSize: 14, textAlign: 'center' }}>
                {status === 'exchanging' && 'Connecting Samsung Health…'}
                {status === 'success' && 'Connected!'}
                {status === 'failed' && 'Connection failed — tap back to retry.'}
            </Text>
            {status === 'failed' && failReason && (
                <Text style={{ color: 'rgba(255,255,255,0.4)', marginTop: 8, fontSize: 11, textAlign: 'center', paddingHorizontal: 16 }}>
                    {failReason}
                </Text>
            )}
        </View>
    );
}

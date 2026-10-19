import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';

import { awardBonus } from '@/lib/api/points';

/**
 * Return surface for the Garmin sign-in. garmin-auth's callback has already
 * done the work — swapped the code for tokens, linked the Garmin account and
 * made Garmin the active wearable — before sending the browser here as
 * powr://garmin-callback?status=connected | denied | already_linked | failed.
 * This screen only reports the outcome and goes back where the user came from.
 */
export default function GarminCallback() {
    const router = useRouter();
    const { t } = useTranslation();
    const { status } = useLocalSearchParams<{ status?: string }>();
    const [view, setView] = useState<'connecting' | 'success' | 'failed'>('connecting');
    const [reason, setReason] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try { WebBrowser.dismissBrowser?.(); } catch {}

            if (status === 'connected') {
                // One-time +20 POWR for connecting a wearable. Idempotent server-side.
                awardBonus('wearable_connection').catch(() => {});
                setView('success');
                returnHome(router, false);
                return;
            }
            if (status === 'denied') setReason(t('system:healthCallback.garminDenied'));
            else if (status === 'already_linked') setReason(t('system:healthCallback.garminAlreadyLinked'));
            console.warn('[garmin-callback] not connected:', status);
            setView('failed');
            returnHome(router, true);
        })();
    }, [status]);

    return (
        <View style={{ flex: 1, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <ActivityIndicator size="large" color="#facc15" />
            <Text style={{ color: '#F2F2F2', marginTop: 16, fontSize: 14, textAlign: 'center' }}>
                {view === 'connecting' && t('system:healthCallback.connectingGarmin')}
                {view === 'success' && t('system:healthCallback.connected')}
                {view === 'failed' && t('system:healthCallback.failed')}
            </Text>
            {view === 'failed' && reason && (
                <Text style={{ color: '#9CA3AF', marginTop: 8, fontSize: 12, textAlign: 'center' }}>
                    {reason}
                </Text>
            )}
        </View>
    );
}

async function returnHome(router: ReturnType<typeof useRouter>, failed: boolean) {
    const returnTo = await SecureStore.getItemAsync('oauth.returnTo');
    await SecureStore.deleteItemAsync('oauth.returnTo');
    // Linger on failure so the reason is readable before bouncing back.
    setTimeout(() => router.replace(returnTo === 'settings' ? '/settings-screen' : '/onboarding-wearables'), failed ? 4000 : 600);
}

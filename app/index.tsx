import { useAuth } from '@/context/AuthContext';
import { resumeOnboardingRoute } from '@/lib/onboarding/resume';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

// Captured synchronously at module load — before Expo Router processes the URL.
// On native, `window` can exist but `window.location` is undefined.
// Read hash only in a real web environment to avoid startup crashes.
const initialHash =
    Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.location?.hash === 'string'
        ? window.location.hash
        : '';

function parseHashError(): { code: string; description: string } | null {
    if (Platform.OS !== 'web' || !initialHash) return null;
    const p = new URLSearchParams(initialHash.slice(1));
    const error = p.get('error');
    if (!error) return null;
    return {
        code: p.get('error_code') ?? error,
        description: p.get('error_description') ?? 'The link is invalid or has expired.',
    };
}

const hashError = parseHashError();

export default function Index() {
    const { session, loading } = useAuth();
    const router = useRouter();
    const didRedirect = useRef(false);

    useEffect(() => {
        if (hashError || loading || didRedirect.current) return;
        didRedirect.current = true;
        if (session) {
            const onboardingComplete = !!session.user.user_metadata?.onboarding_complete;
            resumeOnboardingRoute(onboardingComplete).then(route => router.replace(route));
        } else {
            router.replace('/onboarding');
        }
    }, [loading, session]);

    if (hashError) {
        return (
            <Redirect
                href={`/reset-password?auth_error=${encodeURIComponent(hashError.code)}&auth_error_description=${encodeURIComponent(hashError.description)}`}
            />
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: '#080808', justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color="#E8D200" size="large" />
        </View>
    );
}

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';

export default function Index() {
    const { session, loading } = useAuth();
    const router = useRouter();
    const didRedirect = useRef(false);

    useEffect(() => {
        if (loading || didRedirect.current) return;
        didRedirect.current = true;

        if (session) {
            const onboardingComplete = session.user.user_metadata?.onboarding_complete;
            router.replace(onboardingComplete ? '/(tabs)' : '/onboarding-permission');
        } else {
            router.replace('/onboarding');
        }
    }, [loading, session]);

    return (
        <View style={{ flex: 1, backgroundColor: '#080808', justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color="#E8D200" size="large" />
        </View>
    );
}

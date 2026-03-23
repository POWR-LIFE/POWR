import { useAuth } from '@/context/AuthContext';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

export default function Index() {
    const { session, loading } = useAuth();

    if (loading) {
        return (
            <View style={{ flex: 1, backgroundColor: '#080808', justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator color="#E8D200" size="large" />
            </View>
        );
    }

    if (session) {
        const onboardingComplete = session.user.user_metadata?.onboarding_complete;
        if (onboardingComplete) {
            return <Redirect href="/(tabs)" />;
        }
        return <Redirect href="/onboarding-permission" />;
    }

    return <Redirect href="/onboarding" />;
}

/**
 * signup-confirmed.tsx
 *
 * Deep-link landing for signup confirmation emails.
 *
 * Flow:
 *  1. User creates an account with email + password.
 *  2. Supabase emails a link → https://powr.life/app?to=signup-confirmed&code=xxx
 *     (the smart-link page forwards it to powr://signup-confirmed?code=xxx).
 *  3. OS opens the app; Expo Router mounts this screen with `code` in params.
 *  4. We exchange the code for a session, which lands the user straight into
 *     onboarding rather than bouncing them back to the login form.
 *
 * Dormant until "Confirm email" is switched on in Auth settings — with signup
 * auto-confirm enabled no confirmation mail is ever sent, so nothing reaches
 * this route. It ships early so the landing is already in the field whenever
 * that setting is flipped (it takes effect for every installed build at once).
 *
 * Mirrors reset-password.tsx, including its PKCE constraint: the code verifier
 * lives on the device that started the signup, so opening the link elsewhere
 * cannot complete the exchange.
 */

import GeometricBackground from '@/components/GeometricBackground';
import { supabase } from '@/lib/supabase';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';

const GOLD = '#E8D200';
const BG   = '#080808';
const DIM  = 'rgba(255,255,255,0.50)';

type Screen = 'exchanging' | 'error';

export default function SignupConfirmedScreen() {
    const router = useRouter();
    const { code, auth_error, auth_error_description } = useLocalSearchParams<{
        code?: string;
        auth_error?: string;
        auth_error_description?: string;
    }>();

    const [screen, setScreen]               = useState<Screen>('exchanging');
    const [exchangeError, setExchangeError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            if (auth_error) {
                const description = auth_error_description ?? 'The link is invalid or has expired.';
                setExchangeError(
                    auth_error === 'otp_expired'
                        ? 'This confirmation link has expired. Sign up again to get a new one.'
                        : description.replace(/\+/g, ' ')
                );
                setScreen('error');
                return;
            }
            if (!code) {
                setExchangeError('No confirmation code found in the link. Please sign up again.');
                setScreen('error');
                return;
            }
            try {
                // Build the full URL so Supabase can extract and exchange the code.
                const url = Linking.createURL('signup-confirmed', { queryParams: { code } });
                const { error } = await supabase.auth.exchangeCodeForSession(url);
                if (error) {
                    setExchangeError(error.message);
                    setScreen('error');
                    return;
                }
                // Confirmed and signed in — pick up onboarding where signup leaves off.
                router.replace('/onboarding-permission');
            } catch (e: unknown) {
                setExchangeError(e instanceof Error ? e.message : 'Session exchange failed.');
                setScreen('error');
            }
        })();
    }, [code, auth_error, auth_error_description, router]);

    if (screen === 'exchanging') {
        return (
            <View style={[styles.container, styles.centred]}>
                <GeometricBackground />
                <ActivityIndicator color={GOLD} size="large" />
                <Text style={styles.loadingText}>Confirming your account…</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, styles.centred, { paddingHorizontal: 32 }]}>
            <GeometricBackground />
            <View style={styles.feedbackBox}>
                <Text style={styles.feedbackIcon}>✉</Text>
                <Text style={styles.feedbackTitle}>Couldn&rsquo;t confirm</Text>
                <Text style={styles.feedbackBody}>{exchangeError}</Text>
                <Text style={styles.feedbackHint}>
                    Open the confirmation link on the device you signed up on — for security,
                    it can only be completed there.
                </Text>
            </View>
            <Pressable
                style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.86 }]}
                onPress={() => router.replace('/auth-email?mode=signin')}
            >
                <Text style={styles.primaryLabel}>BACK TO LOG IN</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    centred: { justifyContent: 'center', alignItems: 'center' },
    loadingText: {
        color: DIM,
        fontSize: 14,
        fontWeight: '300',
        marginTop: 16,
    },
    feedbackBox: {
        alignItems: 'center',
        marginBottom: 36,
        paddingHorizontal: 8,
        alignSelf: 'stretch',
    },
    feedbackIcon: { fontSize: 48, marginBottom: 20 },
    feedbackTitle: {
        color: '#F2F2F2',
        fontSize: 28,
        fontWeight: '200',
        letterSpacing: -0.8,
        marginBottom: 14,
        textAlign: 'center',
    },
    feedbackBody: {
        color: 'rgba(255,255,255,0.45)',
        fontSize: 15,
        fontWeight: '300',
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 8,
    },
    feedbackHint: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 13,
        fontWeight: '300',
        textAlign: 'center',
        lineHeight: 20,
        marginTop: 6,
    },
    primaryButton: {
        height: 56,
        borderRadius: 28,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'stretch',
    },
    primaryLabel: {
        color: '#0a0a0a',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 2,
    },
});

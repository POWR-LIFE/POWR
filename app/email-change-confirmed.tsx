/**
 * email-change-confirmed.tsx
 *
 * Deep-link landing for email-change confirmation links.
 *
 * With double_confirm_changes = true (supabase/config.toml), Supabase emails
 * a link to BOTH the old and new addresses. Clicking either link opens this
 * screen via powr://email-change-confirmed?... — Supabase has already
 * verified the token before redirecting, so we don't validate anything here;
 * we just refresh the session, then tell the user where they are in the flow.
 *
 * Because the user might land here twice (once per address), we don't claim
 * "all done" — we look at whether the session's email actually changed and
 * show one of two messages.
 */

import { Ionicons } from '@expo/vector-icons';
import GeometricBackground from '@/components/GeometricBackground';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
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

type State = 'loading' | 'completed' | 'partial';

export default function EmailChangeConfirmedScreen() {
    const router = useRouter();
    const [state, setState]       = useState<State>('loading');
    const [newEmail, setNewEmail] = useState<string>('');

    useEffect(() => {
        (async () => {
            // Force a session refresh so we read the freshest email from
            // auth.users. Supabase swaps the email only after BOTH links are
            // clicked — so if the email matches user.new_email_in_session,
            // the change is complete. Otherwise we landed here mid-flow.
            try {
                await supabase.auth.refreshSession();
            } catch {
                // Non-fatal — getUser will still pull current claim state.
            }
            const { data } = await supabase.auth.getUser();
            const u = data.user;
            // `new_email` lives on the user record while a change is pending.
            // If it's empty, the swap has already happened (or never started).
            const pendingNew = (u as unknown as { new_email?: string })?.new_email;
            if (pendingNew) {
                setNewEmail(pendingNew);
                setState('partial');
            } else {
                setNewEmail(u?.email ?? '');
                setState('completed');
            }
        })();
    }, []);

    if (state === 'loading') {
        return (
            <View style={[styles.container, styles.centred]}>
                <GeometricBackground />
                <ActivityIndicator color={GOLD} size="large" />
                <Text style={styles.loadingText}>Confirming…</Text>
            </View>
        );
    }

    if (state === 'partial') {
        return (
            <View style={[styles.container, styles.centred, { paddingHorizontal: 32 }]}>
                <GeometricBackground />
                <View style={styles.feedbackBox}>
                    <Text style={styles.feedbackIcon}>✅</Text>
                    <Text style={styles.feedbackTitle}>One more step</Text>
                    <Text style={styles.feedbackBody}>
                        Thanks — that confirmation worked.
                    </Text>
                    <Text style={styles.feedbackHint}>
                        We also sent a link to {newEmail ? <Text style={styles.feedbackHighlight}>{newEmail}</Text> : 'your other inbox'}. Click that one too to finish moving your POWR account.
                    </Text>
                </View>
                <Pressable
                    style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.86 }]}
                    onPress={() => router.replace('/(tabs)')}
                >
                    <Text style={styles.primaryLabel}>BACK TO APP</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <View style={[styles.container, styles.centred, { paddingHorizontal: 32 }]}>
            <GeometricBackground />
            <View style={styles.feedbackBox}>
                <Text style={styles.feedbackIcon}>📬</Text>
                <Text style={styles.feedbackTitle}>Email updated</Text>
                <Text style={styles.feedbackBody}>
                    Your POWR account is now signed in as{'\n'}
                    <Text style={styles.feedbackHighlight}>{newEmail}</Text>
                </Text>
                <Text style={styles.feedbackHint}>
                    Use this address next time you sign in.
                </Text>
            </View>
            <Pressable
                style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.86 }]}
                onPress={() => router.replace('/(tabs)')}
            >
                <Text style={styles.primaryLabel}>CONTINUE</Text>
            </Pressable>
            <Pressable
                onPress={() => router.replace('/settings-screen')}
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, marginTop: 14 }]}
                hitSlop={8}
            >
                <Text style={styles.secondaryLink}>Open settings</Text>
            </Pressable>
            <View style={styles.iconRow}>
                <Ionicons name="shield-checkmark-outline" size={14} color={DIM} />
                <Text style={styles.shieldHint}>If this wasn't you, contact support@powr.life right away.</Text>
            </View>
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
    feedbackHighlight: {
        color: GOLD,
        fontWeight: '500',
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
    secondaryLink: {
        color: 'rgba(255,255,255,0.45)',
        fontSize: 13,
        fontWeight: '300',
        textAlign: 'center',
    },
    iconRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 28,
        paddingHorizontal: 8,
    },
    shieldHint: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 11,
        fontWeight: '300',
        flexShrink: 1,
    },
});

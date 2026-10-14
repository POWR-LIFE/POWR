/**
 * reset-password.tsx
 *
 * Deep-link callback for password recovery emails.
 *
 * Flow:
 *  1. User taps "Send reset email" in change-password screen.
 *  2. Supabase sends an email with a link → powr://reset-password?code=xxx
 *  3. OS opens the app; Expo Router mounts this screen with `code` in params.
 *  4. We call exchangeCodeForSession to establish the recovery session.
 *  5. User sets a new password (no current password required — the recovery
 *     link already proved their identity).
 */

import { Ionicons } from '@expo/vector-icons';
import GeometricBackground from '@/components/GeometricBackground';
import i18n from '@/lib/i18n';
import { authErrorMessage } from '@/lib/i18n/serverText';
import { supabase } from '@/lib/supabase';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD         = '#E8D200';
const BG           = '#080808';
const BORDER       = 'rgba(255,255,255,0.10)';
const BORDER_FOCUS = 'rgba(255,255,255,0.80)';
const DIM          = 'rgba(255,255,255,0.50)';

type Screen = 'exchanging' | 'form' | 'success' | 'error';

export default function ResetPasswordScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t } = useTranslation();
    const { code, auth_error, auth_error_description } = useLocalSearchParams<{
        code?: string;
        auth_error?: string;
        auth_error_description?: string;
    }>();

    const [screen, setScreen]               = useState<Screen>('exchanging');
    const [exchangeError, setExchangeError] = useState<string | null>(null);

    const [newPassword, setNewPassword]         = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNew, setShowNew]                 = useState(false);
    const [showConfirm, setShowConfirm]         = useState(false);
    const [focusedField, setFocusedField]       = useState<string | null>(null);
    const [loading, setLoading]                 = useState(false);
    const [formError, setFormError]             = useState<string | null>(null);

    // ── Step 1: exchange the code for a recovery session ──────────────────────

    useEffect(() => {
        (async () => {
            // i18n.t, not the hook's t: as a dependency, t would re-run this
            // effect (and the one-time code exchange) on a language change.
            if (auth_error) {
                const description = auth_error_description ?? i18n.t('auth:resetPassword.error.invalidLink');
                setExchangeError(
                    auth_error === 'otp_expired'
                        ? i18n.t('auth:resetPassword.error.expired')
                        // Supabase's own English description: kept for English,
                        // mapped (or the invalid-link line) for everyone else.
                        : authErrorMessage(
                            { code: auth_error, message: description.replace(/\+/g, ' ') },
                            i18n.t('auth:resetPassword.error.invalidLink'),
                        )
                );
                setScreen('error');
                return;
            }
            if (!code) {
                setExchangeError(i18n.t('auth:resetPassword.error.noCode'));
                setScreen('error');
                return;
            }
            try {
                // Build the full URL so Supabase can extract and exchange the code.
                const url = Linking.createURL('reset-password', { queryParams: { code } });
                const { error } = await supabase.auth.exchangeCodeForSession(url);
                if (error) {
                    setExchangeError(authErrorMessage(error, i18n.t('auth:resetPassword.error.invalidLink')));
                    setScreen('error');
                    return;
                }
                setScreen('form');
            } catch (e: unknown) {
                setExchangeError(e instanceof Error ? authErrorMessage(e, i18n.t('auth:resetPassword.error.exchangeFailed')) : i18n.t('auth:resetPassword.error.exchangeFailed'));
                setScreen('error');
            }
        })();
    }, [code, auth_error, auth_error_description]);

    // ── Step 2: set the new password ──────────────────────────────────────────

    const handleSubmit = async () => {
        setFormError(null);
        if (!newPassword)            { setFormError(t('auth:resetPassword.error.passwordRequired')); return; }
        if (newPassword.length < 6)  { setFormError(t('auth:resetPassword.error.passwordTooShort')); return; }
        if (newPassword !== confirmPassword) { setFormError(t('auth:resetPassword.error.passwordMismatch')); return; }

        setLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) { setFormError(authErrorMessage(error)); return; }
            setScreen('success');
        } finally {
            setLoading(false);
        }
    };

    // ── Exchanging — loading state ─────────────────────────────────────────────

    if (screen === 'exchanging') {
        return (
            <View style={[styles.container, styles.centred]}>
                <GeometricBackground />
                <ActivityIndicator color={GOLD} size="large" />
                <Text style={styles.loadingText}>{t('auth:resetPassword.loading')}</Text>
            </View>
        );
    }

    // ── Error state ────────────────────────────────────────────────────────────

    if (screen === 'error') {
        return (
            <View style={[styles.container, styles.centred, { paddingHorizontal: 32 }]}>
                <GeometricBackground />
                <View style={styles.feedbackBox}>
                    <Text style={styles.feedbackIcon}>⚠️</Text>
                    <Text style={styles.feedbackTitle}>{t('auth:resetPassword.errorTitle')}</Text>
                    <Text style={styles.feedbackBody}>{exchangeError}</Text>
                </View>
                <Pressable
                    style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.86 }]}
                    onPress={() => router.replace('/(tabs)')}
                >
                    <Text style={styles.primaryLabel}>{t('auth:resetPassword.backToApp')}</Text>
                </Pressable>
            </View>
        );
    }

    // ── Success state ──────────────────────────────────────────────────────────

    if (screen === 'success') {
        return (
            <View style={[styles.container, styles.centred, { paddingHorizontal: 32 }]}>
                <GeometricBackground />
                <View style={styles.feedbackBox}>
                    <Text style={styles.feedbackIcon}>🔒</Text>
                    <Text style={styles.feedbackTitle}>{t('auth:resetPassword.successTitle')}</Text>
                    <Text style={styles.feedbackBody}>{t('auth:resetPassword.successBody')}</Text>
                </View>
                <Pressable
                    style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.86 }]}
                    onPress={() => router.replace('/(tabs)')}
                >
                    <Text style={styles.primaryLabel}>{t('auth:resetPassword.continue')}</Text>
                </Pressable>
            </View>
        );
    }

    // ── Form ───────────────────────────────────────────────────────────────────

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <GeometricBackground />

            {/* No back button — user arrived via email link, back is ambiguous */}
            <ScrollView
                contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 32 }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <Text style={styles.headline}>
                    <Trans i18nKey="auth:resetPassword.headline" components={{ gold: <Text style={styles.headlineGold} /> }} />
                </Text>

                <View style={styles.form}>
                    {/* New password */}
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>{t('auth:resetPassword.field.newPassword')}</Text>
                        <View style={[
                            styles.inputContainer,
                            focusedField === 'new' && styles.inputFocused,
                        ]}>
                            <TextInput
                                style={styles.inputBorderless}
                                placeholder={t('auth:resetPassword.placeholder.newPassword')}
                                placeholderTextColor="rgba(255,255,255,0.22)"
                                value={newPassword}
                                onChangeText={setNewPassword}
                                onFocus={() => setFocusedField('new')}
                                onBlur={() => setFocusedField(null)}
                                secureTextEntry={!showNew}
                                autoComplete="new-password"
                                autoCapitalize="none"
                                autoFocus
                            />
                            <Pressable style={styles.eyeIcon} onPress={() => setShowNew(!showNew)} hitSlop={12}>
                                <Ionicons name={showNew ? 'eye-off' : 'eye'} size={24} color="#FFFFFF" />
                            </Pressable>
                        </View>
                    </View>

                    {/* Confirm */}
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>{t('auth:resetPassword.field.confirmPassword')}</Text>
                        <View style={[
                            styles.inputContainer,
                            focusedField === 'confirm' && styles.inputFocused,
                        ]}>
                            <TextInput
                                style={styles.inputBorderless}
                                placeholder={t('auth:resetPassword.placeholder.confirmPassword')}
                                placeholderTextColor="rgba(255,255,255,0.22)"
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                onFocus={() => setFocusedField('confirm')}
                                onBlur={() => setFocusedField(null)}
                                secureTextEntry={!showConfirm}
                                autoComplete="new-password"
                                autoCapitalize="none"
                            />
                            <Pressable style={styles.eyeIcon} onPress={() => setShowConfirm(!showConfirm)} hitSlop={12}>
                                <Ionicons name={showConfirm ? 'eye-off' : 'eye'} size={24} color="#FFFFFF" />
                            </Pressable>
                        </View>
                    </View>

                    {/* Error */}
                    {formError && (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{formError}</Text>
                        </View>
                    )}

                    {/* Submit */}
                    <Pressable
                        style={({ pressed }) => [
                            styles.primaryButton,
                            pressed && { opacity: 0.86 },
                            loading && { opacity: 0.7 },
                        ]}
                        onPress={handleSubmit}
                        disabled={loading}
                    >
                        {loading
                            ? <ActivityIndicator color="#0a0a0a" />
                            : <Text style={styles.primaryLabel}>{t('auth:resetPassword.submit')}</Text>
                        }
                    </Pressable>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BG,
    },
    centred: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        color: DIM,
        fontSize: 14,
        fontWeight: '300',
        marginTop: 16,
    },
    scroll: {
        paddingHorizontal: 24,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 44,
        fontWeight: '200',
        letterSpacing: -1.4,
        lineHeight: 50,
        marginBottom: 40,
    },
    headlineGold: {
        color: GOLD,
        fontWeight: '700',
    },
    form: {
        gap: 16,
    },
    fieldGroup: {
        gap: 7,
    },
    fieldLabel: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 2,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 52,
        borderRadius: 12,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: BORDER,
    },
    inputBorderless: {
        flex: 1,
        height: '100%',
        paddingLeft: 16,
        paddingRight: 52,
        color: '#F2F2F2',
        fontSize: 15,
        fontWeight: '300',
    },
    eyeIcon: {
        position: 'absolute',
        right: 0,
        width: 52,
        height: 52,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },
    inputFocused: {
        borderColor: BORDER_FOCUS,
    },
    errorBox: {
        backgroundColor: 'rgba(255,60,60,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,60,60,0.25)',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    errorText: {
        color: '#ff6b6b',
        fontSize: 13,
        fontWeight: '300',
        lineHeight: 18,
    },
    primaryButton: {
        height: 56,
        borderRadius: 28,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 8,
    },
    primaryLabel: {
        color: '#0a0a0a',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 2,
    },
    feedbackBox: {
        alignItems: 'center',
        marginBottom: 40,
        paddingHorizontal: 8,
    },
    feedbackIcon: {
        fontSize: 48,
        marginBottom: 20,
    },
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
    },
});

import { Ionicons } from '@expo/vector-icons';
import GeometricBackground from '@/components/GeometricBackground';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
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

type Screen = 'form' | 'pending' | 'success';

// Basic email shape check — server-side validation is the source of truth.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ChangeEmailScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const currentEmail = user?.email ?? '';
    // OAuth-provisioned accounts source their email from the provider; mutating
    // it in Supabase Auth would diverge on next sign-in. Block both Google/Apple.
    const oauthProvider = user?.app_metadata?.provider;
    const isOAuthUser = !!oauthProvider && oauthProvider !== 'email';

    const [newEmail, setNewEmail]                 = useState('');
    const [confirmEmail, setConfirmEmail]         = useState('');
    const [currentPassword, setCurrentPassword]   = useState('');
    const [showPassword, setShowPassword]         = useState(false);
    const [focusedField, setFocusedField]         = useState<string | null>(null);
    const [loading, setLoading]                   = useState(false);
    const [resending, setResending]               = useState(false);
    const [error, setError]                       = useState<string | null>(null);
    const [screen, setScreen]                     = useState<Screen>('form');

    // ── Submit ────────────────────────────────────────────────────────────────

    const handleSubmit = async () => {
        setError(null);

        const target = newEmail.trim().toLowerCase();
        const targetConfirm = confirmEmail.trim().toLowerCase();

        if (!target)                            { setError('Please enter a new email address.'); return; }
        if (!EMAIL_RE.test(target))             { setError("That email doesn't look right."); return; }
        if (target !== targetConfirm)           { setError("Emails don't match."); return; }
        if (target === currentEmail.toLowerCase()) {
            setError('That is already your email address.'); return;
        }
        if (!currentPassword)                   { setError('Please enter your current password.'); return; }

        setLoading(true);
        try {
            // Step 1: re-authenticate. Even with an active session, requiring the
            // password here means a stolen device can't pivot to account takeover
            // by simply changing the email and then resetting the password.
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: currentEmail,
                password: currentPassword,
            });
            if (signInError) {
                setError('Current password is incorrect.');
                return;
            }

            // Step 2: request the change. With double_confirm_changes = true in
            // Supabase Auth config, this dispatches a confirmation link to BOTH
            // the old and the new address; the email is only swapped after both
            // are clicked.
            const { error: updateError } = await supabase.auth.updateUser(
                { email: target },
                { emailRedirectTo: Linking.createURL('email-change-confirmed') },
            );
            if (updateError) {
                // updateUser surfaces "email already registered" generically. We
                // intentionally don't disambiguate to avoid leaking which emails
                // exist on POWR.
                setError(updateError.message);
                return;
            }

            setScreen('pending');
        } finally {
            setLoading(false);
        }
    };

    // ── Resend ────────────────────────────────────────────────────────────────

    const handleResend = async () => {
        setError(null);
        setResending(true);
        try {
            // Re-issuing the change re-sends both confirmation links. Subject to
            // the 2/hour email rate limit configured in supabase/config.toml.
            const { error: resendError } = await supabase.auth.updateUser(
                { email: newEmail.trim().toLowerCase() },
                { emailRedirectTo: Linking.createURL('email-change-confirmed') },
            );
            if (resendError) {
                setError(resendError.message);
                return;
            }
        } finally {
            setResending(false);
        }
    };

    // ── OAuth provider — can't change email here ──────────────────────────────

    if (isOAuthUser) {
        const providerName = oauthProvider === 'apple' ? 'Apple' : 'Google';
        return (
            <View style={[styles.container, styles.centred, { paddingHorizontal: 32 }]}>
                <GeometricBackground />
                <Pressable
                    style={[styles.backButton, { top: insets.top + 14 }]}
                    onPress={() => router.back()}
                    hitSlop={24}
                >
                    <Ionicons name="chevron-back" size={26} color={DIM} />
                </Pressable>
                <View style={styles.feedbackBox}>
                    <Text style={styles.feedbackIcon}>🔗</Text>
                    <Text style={styles.feedbackTitle}>{providerName} account</Text>
                    <Text style={styles.feedbackBody}>
                        Your POWR account is linked to {providerName}. To change your email, update it in your {providerName} account first, then sign in to POWR again.
                    </Text>
                </View>
                <Pressable
                    style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.86 }]}
                    onPress={() => router.back()}
                >
                    <Text style={styles.primaryLabel}>BACK TO SETTINGS</Text>
                </Pressable>
            </View>
        );
    }

    // ── Pending state ─────────────────────────────────────────────────────────

    if (screen === 'pending') {
        return (
            <View style={[styles.container, styles.centred, { paddingHorizontal: 32 }]}>
                <GeometricBackground />
                <View style={styles.feedbackBox}>
                    <Text style={styles.feedbackIcon}>✉️</Text>
                    <Text style={styles.feedbackTitle}>Check both inboxes</Text>
                    <Text style={styles.feedbackBody}>
                        We sent a confirmation link to:
                    </Text>
                    <View style={styles.emailRow}>
                        <Text style={styles.emailRowLabel}>OLD</Text>
                        <Text style={styles.emailRowValue}>{currentEmail}</Text>
                    </View>
                    <View style={styles.emailRow}>
                        <Text style={styles.emailRowLabel}>NEW</Text>
                        <Text style={styles.emailRowValue}>{newEmail.trim().toLowerCase()}</Text>
                    </View>
                    <Text style={styles.feedbackHint}>
                        Click both links to complete the change. Until then, keep signing in with your old email. If you ignore the emails, nothing changes.
                    </Text>
                </View>

                {error && (
                    <View style={[styles.errorBox, { marginBottom: 16, alignSelf: 'stretch' }]}>
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                )}

                <Pressable
                    style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.86 }]}
                    onPress={() => router.replace('/settings-screen')}
                >
                    <Text style={styles.primaryLabel}>BACK TO SETTINGS</Text>
                </Pressable>

                <Pressable
                    onPress={handleResend}
                    disabled={resending}
                    style={({ pressed }) => [{ opacity: pressed || resending ? 0.6 : 1, marginTop: 12 }]}
                >
                    <Text style={styles.forgotHint}>
                        {resending ? 'Resending…' : "Didn't get the emails? "}
                        {!resending && <Text style={styles.forgotLink}>Resend</Text>}
                    </Text>
                </Pressable>
            </View>
        );
    }

    // ── Form ──────────────────────────────────────────────────────────────────

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <GeometricBackground />

            <Pressable
                style={[styles.backButton, { top: insets.top + 14 }]}
                onPress={() => router.back()}
                hitSlop={24}
            >
                <Ionicons name="chevron-back" size={26} color={DIM} />
            </Pressable>

            <ScrollView
                contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 32 }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <Text style={styles.headline}>
                    {'Change\n'}
                    <Text style={styles.headlineGold}>email.</Text>
                </Text>

                <Text style={styles.intro}>
                    For your security we'll email a confirmation link to both your current and new addresses. Both must be clicked to complete the change.
                </Text>

                <View style={styles.currentBox}>
                    <Text style={styles.currentLabel}>CURRENT EMAIL</Text>
                    <Text style={styles.currentValue}>{currentEmail || '—'}</Text>
                </View>

                <View style={styles.form}>
                    {/* New email */}
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>NEW EMAIL</Text>
                        <View style={[
                            styles.inputContainer,
                            focusedField === 'new' && styles.inputFocused,
                        ]}>
                            <TextInput
                                style={styles.input}
                                placeholder="you@example.com"
                                placeholderTextColor="rgba(255,255,255,0.22)"
                                value={newEmail}
                                onChangeText={setNewEmail}
                                onFocus={() => setFocusedField('new')}
                                onBlur={() => setFocusedField(null)}
                                autoCapitalize="none"
                                autoCorrect={false}
                                autoComplete="email"
                                keyboardType="email-address"
                                inputMode="email"
                            />
                        </View>
                    </View>

                    {/* Confirm new email */}
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>CONFIRM NEW EMAIL</Text>
                        <View style={[
                            styles.inputContainer,
                            focusedField === 'confirm' && styles.inputFocused,
                        ]}>
                            <TextInput
                                style={styles.input}
                                placeholder="Re-enter new email"
                                placeholderTextColor="rgba(255,255,255,0.22)"
                                value={confirmEmail}
                                onChangeText={setConfirmEmail}
                                onFocus={() => setFocusedField('confirm')}
                                onBlur={() => setFocusedField(null)}
                                autoCapitalize="none"
                                autoCorrect={false}
                                autoComplete="email"
                                keyboardType="email-address"
                                inputMode="email"
                            />
                        </View>
                    </View>

                    {/* Current password */}
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>CURRENT PASSWORD</Text>
                        <View style={[
                            styles.inputContainer,
                            focusedField === 'password' && styles.inputFocused,
                        ]}>
                            <TextInput
                                style={[styles.input, { paddingRight: 52 }]}
                                placeholder="••••••••"
                                placeholderTextColor="rgba(255,255,255,0.22)"
                                value={currentPassword}
                                onChangeText={setCurrentPassword}
                                onFocus={() => setFocusedField('password')}
                                onBlur={() => setFocusedField(null)}
                                secureTextEntry={!showPassword}
                                autoComplete="current-password"
                                autoCapitalize="none"
                            />
                            <Pressable
                                style={styles.eyeIcon}
                                onPress={() => setShowPassword(!showPassword)}
                                hitSlop={12}
                            >
                                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={24} color="#FFFFFF" />
                            </Pressable>
                        </View>
                    </View>

                    {error && (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    )}

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
                            : <Text style={styles.primaryLabel}>SEND CONFIRMATION LINKS</Text>
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
    backButton: {
        position: 'absolute',
        left: 16,
        zIndex: 20,
        padding: 4,
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
        marginBottom: 16,
    },
    headlineGold: {
        color: GOLD,
        fontWeight: '700',
    },
    intro: {
        color: 'rgba(255,255,255,0.45)',
        fontSize: 14,
        fontWeight: '300',
        lineHeight: 21,
        marginBottom: 28,
    },
    currentBox: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginBottom: 24,
        gap: 4,
    },
    currentLabel: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 2,
    },
    currentValue: {
        color: '#F2F2F2',
        fontSize: 15,
        fontWeight: '300',
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
    inputFocused: {
        borderColor: BORDER_FOCUS,
    },
    input: {
        flex: 1,
        height: '100%',
        paddingLeft: 16,
        paddingRight: 16,
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
        alignSelf: 'stretch',
    },
    primaryLabel: {
        color: '#0a0a0a',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 2,
    },
    feedbackBox: {
        alignItems: 'center',
        marginBottom: 32,
        paddingHorizontal: 8,
        alignSelf: 'stretch',
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
        marginBottom: 12,
    },
    feedbackHint: {
        color: 'rgba(255,255,255,0.35)',
        fontSize: 13,
        fontWeight: '300',
        textAlign: 'center',
        lineHeight: 20,
        marginTop: 16,
    },
    emailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: BORDER,
        marginTop: 8,
        alignSelf: 'stretch',
    },
    emailRowLabel: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 9,
        fontWeight: '600',
        letterSpacing: 1.5,
        width: 36,
    },
    emailRowValue: {
        color: '#F2F2F2',
        fontSize: 14,
        fontWeight: '300',
        flex: 1,
    },
    forgotHint: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 13,
        fontWeight: '300',
        textAlign: 'center',
    },
    forgotLink: {
        color: GOLD,
        fontWeight: '600',
    },
});

import { Ionicons } from '@expo/vector-icons';
import GeometricBackground from '@/components/GeometricBackground';
import { useAuth } from '@/context/AuthContext';
import { PASSWORD_RESET_REDIRECT, supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
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

type ScreenView = 'form' | 'success' | 'reset-sent';

export default function ChangePasswordScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const [currentPassword, setCurrentPassword]     = useState('');
    const [newPassword, setNewPassword]             = useState('');
    const [confirmPassword, setConfirmPassword]     = useState('');
    const [focusedField, setFocusedField]           = useState<string | null>(null);
    const [showCurrent, setShowCurrent]             = useState(false);
    const [showNew, setShowNew]                     = useState(false);
    const [showConfirm, setShowConfirm]             = useState(false);
    const [loading, setLoading]                     = useState(false);
    const [resetLoading, setResetLoading]           = useState(false);
    const [error, setError]                         = useState<string | null>(null);
    const [screen, setScreen]                       = useState<ScreenView>('form');

    const isGoogleUser = user?.app_metadata?.provider === 'google';
    const email = user?.email ?? '';

    // ── Change password ────────────────────────────────────────────────────────

    const handleSubmit = async () => {
        setError(null);

        if (!currentPassword) { setError('Please enter your current password.'); return; }
        if (!newPassword)      { setError('Please enter a new password.'); return; }
        if (newPassword.length < 6) { setError('New password must be at least 6 characters.'); return; }
        if (newPassword !== confirmPassword) { setError("Passwords don't match."); return; }
        if (newPassword === currentPassword) { setError('New password must be different from your current one.'); return; }

        setLoading(true);
        try {
            // Step 1: re-authenticate to verify the current password
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email,
                password: currentPassword,
            });
            if (signInError) {
                setError('Current password is incorrect.');
                return;
            }

            // Step 2: update to the new password
            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword,
            });
            if (updateError) {
                setError(updateError.message);
                return;
            }

            setScreen('success');
        } finally {
            setLoading(false);
        }
    };

    // ── Forgot password ────────────────────────────────────────────────────────

    const handleForgotPassword = async () => {
        setError(null);
        setResetLoading(true);
        try {
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: PASSWORD_RESET_REDIRECT,
            });
            if (resetError) {
                setError(resetError.message);
                return;
            }
            setScreen('reset-sent');
        } finally {
            setResetLoading(false);
        }
    };

    // ── Success state ──────────────────────────────────────────────────────────

    if (screen === 'success') {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }]}>
                <GeometricBackground />
                <View style={styles.feedbackBox}>
                    <Text style={styles.feedbackIcon}>🔒</Text>
                    <Text style={styles.feedbackTitle}>Password updated</Text>
                    <Text style={styles.feedbackBody}>Your password has been changed successfully.</Text>
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

    // ── Reset email sent state ─────────────────────────────────────────────────

    if (screen === 'reset-sent') {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }]}>
                <GeometricBackground />
                <View style={styles.feedbackBox}>
                    <Text style={styles.feedbackIcon}>✉️</Text>
                    <Text style={styles.feedbackTitle}>Check your inbox</Text>
                    <Text style={styles.feedbackBody}>
                        We sent a reset link to{'\n'}
                        <Text style={styles.feedbackHighlight}>{email}</Text>
                    </Text>
                    <Text style={styles.feedbackHint}>
                        Click the link in the email to set a new password, then log back in.
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

    // ── Google OAuth — no password to change ──────────────────────────────────

    if (isGoogleUser) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }]}>
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
                    <Text style={styles.feedbackTitle}>Google account</Text>
                    <Text style={styles.feedbackBody}>
                        Your account uses Google Sign-In. To change your password, manage it through your Google account settings.
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

    // ── Main form ──────────────────────────────────────────────────────────────

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <GeometricBackground />

            {/* Back button */}
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
                {/* Header */}
                <Text style={styles.headline}>
                    {'Change\n'}
                    <Text style={styles.headlineGold}>password.</Text>
                </Text>

                {/* Form */}
                <View style={styles.form}>
                    {/* Current password */}
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>CURRENT PASSWORD</Text>
                        <View style={[
                            styles.inputContainer,
                            focusedField === 'current' && styles.inputFocused,
                        ]}>
                            <TextInput
                                style={styles.inputBorderless}
                                placeholder="••••••••"
                                placeholderTextColor="rgba(255,255,255,0.22)"
                                value={currentPassword}
                                onChangeText={setCurrentPassword}
                                onFocus={() => setFocusedField('current')}
                                onBlur={() => setFocusedField(null)}
                                secureTextEntry={!showCurrent}
                                autoComplete="current-password"
                                autoCapitalize="none"
                            />
                            <Pressable
                                style={styles.eyeIcon}
                                onPress={() => setShowCurrent(!showCurrent)}
                                hitSlop={12}
                            >
                                <Ionicons name={showCurrent ? 'eye-off' : 'eye'} size={24} color="#FFFFFF" />
                            </Pressable>
                        </View>
                    </View>

                    {/* New password */}
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>NEW PASSWORD</Text>
                        <View style={[
                            styles.inputContainer,
                            focusedField === 'new' && styles.inputFocused,
                        ]}>
                            <TextInput
                                style={styles.inputBorderless}
                                placeholder="Min. 6 characters"
                                placeholderTextColor="rgba(255,255,255,0.22)"
                                value={newPassword}
                                onChangeText={setNewPassword}
                                onFocus={() => setFocusedField('new')}
                                onBlur={() => setFocusedField(null)}
                                secureTextEntry={!showNew}
                                autoComplete="new-password"
                                autoCapitalize="none"
                            />
                            <Pressable
                                style={styles.eyeIcon}
                                onPress={() => setShowNew(!showNew)}
                                hitSlop={12}
                            >
                                <Ionicons name={showNew ? 'eye-off' : 'eye'} size={24} color="#FFFFFF" />
                            </Pressable>
                        </View>
                    </View>

                    {/* Confirm new password */}
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>CONFIRM NEW PASSWORD</Text>
                        <View style={[
                            styles.inputContainer,
                            focusedField === 'confirm' && styles.inputFocused,
                        ]}>
                            <TextInput
                                style={styles.inputBorderless}
                                placeholder="Re-enter new password"
                                placeholderTextColor="rgba(255,255,255,0.22)"
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                onFocus={() => setFocusedField('confirm')}
                                onBlur={() => setFocusedField(null)}
                                secureTextEntry={!showConfirm}
                                autoComplete="new-password"
                                autoCapitalize="none"
                            />
                            <Pressable
                                style={styles.eyeIcon}
                                onPress={() => setShowConfirm(!showConfirm)}
                                hitSlop={12}
                            >
                                <Ionicons name={showConfirm ? 'eye-off' : 'eye'} size={24} color="#FFFFFF" />
                            </Pressable>
                        </View>
                    </View>

                    {/* Error */}
                    {error && (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{error}</Text>
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
                            : <Text style={styles.primaryLabel}>UPDATE PASSWORD</Text>
                        }
                    </Pressable>

                    {/* Forgot password */}
                    <Pressable
                        onPress={handleForgotPassword}
                        disabled={resetLoading}
                        style={({ pressed }) => [{ opacity: pressed || resetLoading ? 0.6 : 1 }]}
                    >
                        <Text style={styles.forgotHint}>
                            {resetLoading ? 'Sending…' : "Forgot your password? "}
                            {!resetLoading && <Text style={styles.forgotLink}>Send reset email</Text>}
                        </Text>
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
    forgotHint: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 13,
        fontWeight: '300',
        textAlign: 'center',
        marginTop: 4,
    },
    forgotLink: {
        color: GOLD,
        fontWeight: '600',
    },
    // Feedback screens (success / reset-sent / google)
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
        marginBottom: 12,
    },
    feedbackHighlight: {
        color: GOLD,
        fontWeight: '500',
    },
    feedbackHint: {
        color: 'rgba(255,255,255,0.25)',
        fontSize: 13,
        fontWeight: '300',
        textAlign: 'center',
        lineHeight: 20,
    },
});

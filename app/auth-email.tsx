import { useAuth } from '@/context/AuthContext';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
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

const GOLD = '#E8D200';
const BG = '#080808';
const CARD_BG = 'rgba(255,255,255,0.04)';
const BORDER = 'rgba(255,255,255,0.10)';
const BORDER_FOCUS = 'rgba(232,210,0,0.5)';

export default function AuthEmailScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { signInWithEmail, signUpWithEmail } = useAuth();
    const params = useLocalSearchParams<{ mode?: string }>();

    const [mode, setMode] = useState<'signin' | 'signup'>(params.mode === 'signin' ? 'signin' : 'signup');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [focusedField, setFocusedField] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmationSent, setConfirmationSent] = useState(false);

    const handleSubmit = async () => {
        setError(null);

        if (!email.trim()) { setError('Please enter your email.'); return; }
        if (!password) { setError('Please enter your password.'); return; }
        if (mode === 'signup') {
            if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
            if (password !== confirmPassword) { setError('Passwords don\'t match.'); return; }
        }

        setLoading(true);
        try {
            if (mode === 'signin') {
                const { error } = await signInWithEmail(email.trim(), password);
                if (error) { setError(error); return; }
                router.replace('/(tabs)');
            } else {
                const { error, needsConfirmation } = await signUpWithEmail(email.trim(), password);
                if (error) { setError(error); return; }
                if (needsConfirmation) {
                    setConfirmationSent(true);
                } else {
                    // Email confirmation disabled — session created immediately
                    router.replace('/onboarding-permission');
                }
            }
        } finally {
            setLoading(false);
        }
    };

    if (confirmationSent) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }]}>
                <View style={styles.confirmBox}>
                    <Text style={styles.confirmIcon}>✉</Text>
                    <Text style={styles.confirmTitle}>Check your inbox</Text>
                    <Text style={styles.confirmBody}>
                        We sent a confirmation link to{'\n'}
                        <Text style={styles.confirmEmail}>{email}</Text>
                    </Text>
                    <Text style={styles.confirmHint}>
                        Click the link to activate your account, then come back and log in.
                    </Text>
                </View>
                <Pressable
                    onPress={() => setMode('signin')}
                    style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}
                >
                    <Text style={styles.secondaryLabel}>Back to Log In</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            {/* Back button */}
            <Pressable
                style={[styles.backButton, { top: insets.top + 14 }]}
                onPress={() => router.back()}
                hitSlop={12}
            >
                <Text style={styles.backIcon}>←</Text>
            </Pressable>

            {/* Logo */}
            <View style={[styles.logo, { top: insets.top + 18 }]}>
                <Image
                    source={require('@/assets/images/powrlogotext.png')}
                    style={styles.logoImage}
                    contentFit="contain"
                />
            </View>

            <ScrollView
                contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 32 }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* Header */}
                <Text style={styles.headline}>
                    {mode === 'signup' ? 'Create\n' : 'Welcome\n'}
                    <Text style={styles.headlineGold}>
                        {mode === 'signup' ? 'your account.' : 'back.'}
                    </Text>
                </Text>

                {/* Mode toggle */}
                <View style={styles.toggleRow}>
                    <Pressable
                        style={[styles.toggleBtn, mode === 'signup' && styles.toggleBtnActive]}
                        onPress={() => { setMode('signup'); setError(null); }}
                    >
                        <Text style={[styles.toggleLabel, mode === 'signup' && styles.toggleLabelActive]}>
                            Sign Up
                        </Text>
                    </Pressable>
                    <Pressable
                        style={[styles.toggleBtn, mode === 'signin' && styles.toggleBtnActive]}
                        onPress={() => { setMode('signin'); setError(null); }}
                    >
                        <Text style={[styles.toggleLabel, mode === 'signin' && styles.toggleLabelActive]}>
                            Log In
                        </Text>
                    </Pressable>
                </View>

                {/* Form */}
                <View style={styles.form}>
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>EMAIL</Text>
                        <TextInput
                            style={[
                                styles.input,
                                focusedField === 'email' && styles.inputFocused,
                            ]}
                            placeholder="you@example.com"
                            placeholderTextColor="rgba(255,255,255,0.22)"
                            value={email}
                            onChangeText={setEmail}
                            onFocus={() => setFocusedField('email')}
                            onBlur={() => setFocusedField(null)}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            autoCorrect={false}
                            autoComplete="email"
                        />
                    </View>

                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>PASSWORD</Text>
                        <TextInput
                            style={[
                                styles.input,
                                focusedField === 'password' && styles.inputFocused,
                            ]}
                            placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
                            placeholderTextColor="rgba(255,255,255,0.22)"
                            value={password}
                            onChangeText={setPassword}
                            onFocus={() => setFocusedField('password')}
                            onBlur={() => setFocusedField(null)}
                            secureTextEntry
                            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                        />
                    </View>

                    {mode === 'signup' && (
                        <View style={styles.fieldGroup}>
                            <Text style={styles.fieldLabel}>CONFIRM PASSWORD</Text>
                            <TextInput
                                style={[
                                    styles.input,
                                    focusedField === 'confirm' && styles.inputFocused,
                                ]}
                                placeholder="Re-enter your password"
                                placeholderTextColor="rgba(255,255,255,0.22)"
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                onFocus={() => setFocusedField('confirm')}
                                onBlur={() => setFocusedField(null)}
                                secureTextEntry
                                autoComplete="new-password"
                            />
                        </View>
                    )}

                    {/* Error */}
                    {error && (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    )}

                    {/* Submit */}
                    <Pressable
                        style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.86 }, loading && { opacity: 0.7 }]}
                        onPress={handleSubmit}
                        disabled={loading}
                    >
                        {loading
                            ? <ActivityIndicator color="#0a0a0a" />
                            : <Text style={styles.primaryLabel}>{mode === 'signup' ? 'CREATE ACCOUNT' : 'LOG IN'}</Text>
                        }
                    </Pressable>

                    {/* Toggle hint */}
                    <Pressable onPress={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); }}>
                        <Text style={styles.switchHint}>
                            {mode === 'signup' ? 'Already have an account? ' : 'Don\'t have an account? '}
                            <Text style={styles.switchLink}>{mode === 'signup' ? 'Log in' : 'Sign up'}</Text>
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
        left: 20,
        zIndex: 10,
        padding: 4,
    },
    backIcon: {
        color: 'rgba(255,255,255,0.55)',
        fontSize: 22,
    },
    logo: {
        position: 'absolute',
        alignSelf: 'center',
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 10,
    },
    logoImage: {
        width: 100,
        height: 36,
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
        marginBottom: 32,
    },
    headlineGold: {
        color: GOLD,
        fontWeight: '700',
    },
    toggleRow: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 24,
        padding: 3,
        marginBottom: 32,
    },
    toggleBtn: {
        flex: 1,
        height: 40,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
    },
    toggleBtnActive: {
        backgroundColor: 'rgba(232,210,0,0.12)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.3)',
    },
    toggleLabel: {
        color: 'rgba(255,255,255,0.35)',
        fontSize: 13,
        fontWeight: '500',
    },
    toggleLabelActive: {
        color: GOLD,
        fontWeight: '600',
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
    input: {
        height: 52,
        borderRadius: 12,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 16,
        color: '#F2F2F2',
        fontSize: 15,
        fontWeight: '300',
    },
    inputFocused: {
        borderColor: BORDER_FOCUS,
        backgroundColor: 'rgba(232,210,0,0.03)',
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
    switchHint: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 13,
        fontWeight: '300',
        textAlign: 'center',
        marginTop: 4,
    },
    switchLink: {
        color: GOLD,
        fontWeight: '600',
    },
    // Confirmation screen
    confirmBox: {
        alignItems: 'center',
        marginBottom: 40,
    },
    confirmIcon: {
        fontSize: 48,
        marginBottom: 20,
    },
    confirmTitle: {
        color: '#F2F2F2',
        fontSize: 28,
        fontWeight: '200',
        letterSpacing: -0.8,
        marginBottom: 14,
    },
    confirmBody: {
        color: 'rgba(255,255,255,0.45)',
        fontSize: 15,
        fontWeight: '300',
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 16,
    },
    confirmEmail: {
        color: GOLD,
        fontWeight: '500',
    },
    confirmHint: {
        color: 'rgba(255,255,255,0.25)',
        fontSize: 13,
        fontWeight: '300',
        textAlign: 'center',
        lineHeight: 20,
    },
    secondaryButton: {
        height: 52,
        borderRadius: 26,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: CARD_BG,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    secondaryLabel: {
        color: 'rgba(255,255,255,0.55)',
        fontSize: 14,
        fontWeight: '400',
    },
});

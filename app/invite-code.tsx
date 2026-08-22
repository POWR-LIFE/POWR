import { Ionicons } from '@expo/vector-icons';
import GeometricBackground from '@/components/GeometricBackground';
import { supabase } from '@/lib/supabase';
import { normalizeMemberId } from '@/shared/memberId';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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

/**
 * Late invite-code entry.
 *
 * The code is normally handed over during signup (the email screen, the
 * profile step, or the last onboarding screen). This is the second chance for
 * someone who installed from the store, never saw the code and finished
 * onboarding without it — reachable from Settings › Account while they are
 * inside the grace window.
 *
 * The window is enforced by `process_referral`, not here: this screen only
 * decides what to render. `referrals` has UNIQUE (referred_id), so an account
 * can be referred at most once whatever this screen does.
 */
type EntryState = {
    referred: boolean;
    eligible: boolean;
    days_left?: number;
    referrer_name?: string;
};

const MESSAGES: Record<string, string> = {
    invalid_code:      "We don't recognise that code. Check the 8 characters against your friend's message — letters and numbers only, no I or O.",
    self_referral:     "That's your own POWR ID — share it with a friend instead.",
    already_referred:  'An invite code is already applied to this account.',
    window_closed:     'Invite codes can only be added in your first couple of weeks, and that window has closed.',
    not_authenticated: 'Please sign in again to apply your code.',
    network:           "Couldn't reach POWR. Check your connection and try again.",
};

export default function InviteCodeScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const [state, setState]     = useState<EntryState | null>(null);
    const [code, setCode]       = useState('');
    const [focused, setFocused] = useState(false);
    const [busy, setBusy]       = useState(false);
    const [error, setError]     = useState<string | null>(null);
    const [applied, setApplied] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const { data } = await supabase.rpc('referral_entry_state');
                if (alive) setState((data as EntryState) ?? { referred: false, eligible: false });
            } catch {
                if (alive) setState({ referred: false, eligible: false });
            }
        })();
        return () => { alive = false; };
    }, []);

    const submit = async () => {
        if (busy) return;
        setError(null);

        const normalized = normalizeMemberId(code);
        if (!normalized || normalized.length !== 8) {
            setError('An invite code is 8 characters long.');
            return;
        }

        setBusy(true);
        try {
            // One retry on transport failure, same as the onboarding path — a
            // blip here is not the user's fault and the code is still in hand.
            const call = () => supabase.rpc('process_referral', { p_referral_code: normalized });
            let { data, error: rpcErr } = await call();
            if (rpcErr) ({ data, error: rpcErr } = await call());

            const result = (data ?? null) as { success?: boolean; error?: string } | null;
            if (!rpcErr && result?.success) {
                // process_referral returns the referrer's id, not their name;
                // read the state back so the receipt can say who it was.
                const { data: after } = await supabase.rpc('referral_entry_state');
                setApplied((after as EntryState)?.referrer_name ?? 'your friend');
                return;
            }
            setError(MESSAGES[rpcErr ? 'network' : (result?.error ?? 'network')] ?? MESSAGES.network);
        } finally {
            setBusy(false);
        }
    };

    // ── Applied ───────────────────────────────────────────────────────────────

    if (applied) {
        return (
            <View style={[styles.container, styles.centred]}>
                <GeometricBackground />
                <View style={styles.feedbackBox}>
                    <Ionicons name="checkmark-circle" size={38} color={GOLD} />
                    <Text style={styles.feedbackTitle}>Code applied</Text>
                    <Text style={styles.feedbackBody}>
                        You and {applied} both earn 20 POWR once you log your first verified workout. Time to move.
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

    // ── Loading ───────────────────────────────────────────────────────────────

    if (!state) {
        return (
            <View style={[styles.container, styles.centred]}>
                <GeometricBackground />
                <ActivityIndicator color={GOLD} />
            </View>
        );
    }

    // ── Nothing to do (already referred, or out of time) ───────────────────────

    if (state.referred || !state.eligible) {
        return (
            <View style={[styles.container, styles.centred]}>
                <GeometricBackground />
                <View style={styles.feedbackBox}>
                    <Ionicons
                        name={state.referred ? 'checkmark-circle' : 'time-outline'}
                        size={38}
                        color={state.referred ? GOLD : DIM}
                    />
                    <Text style={styles.feedbackTitle}>
                        {state.referred ? 'You were invited' : 'That window has closed'}
                    </Text>
                    <Text style={styles.feedbackBody}>
                        {state.referred
                            ? `${state.referrer_name} invited you to POWR. You both earn 20 POWR once you log your first verified workout.`
                            : 'Invite codes can only be added in your first couple of weeks. Your own POWR ID still works for inviting friends — find it in Settings › Account.'}
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

    // ── Form ──────────────────────────────────────────────────────────────────

    const daysLeft = state.days_left ?? 0;

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
                    {'Invite\n'}
                    <Text style={styles.headlineGold}>code.</Text>
                </Text>

                <Text style={styles.intro}>
                    Joined on a friend's invite but never entered their code? Add it here and you'll both earn 20 POWR after your first verified workout.
                </Text>

                <View style={styles.form}>
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>THEIR POWR ID</Text>
                        <View style={[styles.inputContainer, focused && styles.inputFocused]}>
                            <TextInput
                                style={styles.input}
                                placeholder="ABCD 2345"
                                placeholderTextColor="rgba(255,255,255,0.22)"
                                value={code}
                                onChangeText={t => { setCode(t.toUpperCase()); setError(null); }}
                                onFocus={() => setFocused(true)}
                                onBlur={() => setFocused(false)}
                                autoCapitalize="characters"
                                autoCorrect={false}
                                maxLength={9}
                            />
                        </View>
                        <Text style={styles.helper}>
                            {daysLeft > 0
                                ? `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left to add one — a code can't be applied after that.`
                                : "Last day to add one — a code can't be applied after that."}
                        </Text>
                    </View>

                    {error && (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    )}

                    <Pressable
                        style={({ pressed }) => [styles.primaryButton, (pressed || busy) && { opacity: 0.86 }]}
                        onPress={submit}
                        disabled={busy}
                    >
                        {busy
                            ? <ActivityIndicator color="#0a0a0a" size="small" />
                            : <Text style={styles.primaryLabel}>APPLY CODE</Text>}
                    </Pressable>

                    <Text style={styles.footnote}>
                        A POWR ID is 8 characters — your friend can find theirs in Settings › Account, or in any invite they send you.
                    </Text>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    centred: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    backButton: { position: 'absolute', left: 16, zIndex: 20, padding: 4 },
    scroll: { paddingHorizontal: 24 },
    headline: {
        color: '#F2F2F2',
        fontSize: 34,
        lineHeight: 39,
        fontFamily: 'Outfit_300Light',
        letterSpacing: -0.5,
        marginBottom: 14,
    },
    headlineGold: { color: GOLD, fontFamily: 'Outfit_700Bold', fontWeight: '700' },
    intro: {
        color: DIM,
        fontSize: 14,
        lineHeight: 21,
        fontFamily: 'Outfit_300Light',
        marginBottom: 28,
    },
    form: { width: '100%' },
    fieldGroup: { marginBottom: 20 },
    fieldLabel: {
        color: 'rgba(255,255,255,0.45)',
        fontSize: 11,
        fontFamily: 'Outfit_500Medium',
        fontWeight: '500',
        letterSpacing: 1.2,
        marginBottom: 8,
    },
    inputContainer: {
        height: 56,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: 'rgba(255,255,255,0.04)',
        justifyContent: 'center',
    },
    inputFocused: { borderColor: BORDER_FOCUS },
    input: {
        color: '#F2F2F2',
        fontSize: 20,
        fontFamily: 'Outfit_600SemiBold',
        letterSpacing: 4,
        textAlign: 'center',
        paddingHorizontal: 16,
    },
    helper: {
        color: 'rgba(255,255,255,0.35)',
        fontSize: 12,
        fontFamily: 'Outfit_400Regular',
        lineHeight: 17,
        marginTop: 8,
    },
    errorBox: {
        backgroundColor: 'rgba(255,60,60,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,60,60,0.25)',
        borderRadius: 12,
        padding: 12,
        marginBottom: 16,
    },
    errorText: {
        color: '#ff8080',
        fontSize: 13,
        fontFamily: 'Outfit_400Regular',
        lineHeight: 18,
    },
    primaryButton: {
        height: 52,
        borderRadius: 26,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'stretch',
    },
    primaryLabel: {
        color: '#0a0a0a',
        fontSize: 12,
        fontFamily: 'Outfit_700Bold',
        fontWeight: '700',
        letterSpacing: 1.5,
    },
    footnote: {
        color: 'rgba(255,255,255,0.3)',
        fontSize: 12,
        fontFamily: 'Outfit_300Light',
        lineHeight: 17,
        textAlign: 'center',
        marginTop: 18,
    },
    feedbackBox: { alignItems: 'center', marginBottom: 28 },
    feedbackTitle: {
        color: '#F2F2F2',
        fontSize: 22,
        fontFamily: 'Outfit_600SemiBold',
        fontWeight: '600',
        marginTop: 14,
        marginBottom: 10,
    },
    feedbackBody: {
        color: DIM,
        fontSize: 14,
        lineHeight: 21,
        fontFamily: 'Outfit_300Light',
        textAlign: 'center',
    },
});

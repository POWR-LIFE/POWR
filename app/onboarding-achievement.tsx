import { useAuth } from '@/context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import GeometricBackground from '@/components/GeometricBackground';
import { ONBOARDING_DOT_COUNT, dotIndexFor } from '@/lib/onboarding/flow';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { sendWelcomeEmail } from '@/lib/api/email';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const FONT_LIGHT = 'Outfit_300Light';
const FONT_REGULAR = 'Outfit_400Regular';
const FONT_MEDIUM = 'Outfit_500Medium';
const FONT_SEMIBOLD = 'Outfit_600SemiBold';
const FONT_BOLD = 'Outfit_700Bold';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Ring geometry — 7 segments
const CONTAINER = 340;
const RING_R = 138;
const SW = 5;
const CX = CONTAINER / 2;
const CY = CONTAINER / 2;
const SEGMENTS = 7;
const GAP_DEG = 6; // visual gap between segments
const SEG_DEG = 360 / SEGMENTS - GAP_DEG;

function polar(r: number, deg: number) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arcPath(r: number, startDeg: number, endDeg: number) {
    const s = polar(r, startDeg);
    const e = polar(r, endDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

function StepDots({ current }: { current: number }) {
    return (
        <View style={dotStyles.row}>
            {Array.from({ length: ONBOARDING_DOT_COUNT }, (_, i) => i).map(i => (
                <View
                    key={i}
                    style={[dotStyles.dot, i === current ? dotStyles.dotActive : dotStyles.dotInactive]}
                />
            ))}
        </View>
    );
}

const dotStyles = StyleSheet.create({
    row: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 20 },
    dot: { height: 5, borderRadius: 3 },
    dotActive: { width: 20, backgroundColor: GOLD },
    dotInactive: { width: 5, backgroundColor: 'rgba(255,255,255,0.15)' },
});

export default function OnboardingAchievementScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { markOnboardingComplete } = useAuth();
    const params = useLocalSearchParams<{ streakDays?: string; totalSessions?: string; activeDays?: string }>();

    const [inviteCode, setInviteCode] = useState('');
    const [codeFromLink, setCodeFromLink] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // A code captured from an invite link (AuthContext stores it as
    // pending_referral_code) used to apply silently on submit; surface it in
    // the input instead so the user sees the attribution happening — invite
    // conversion is the live-events funnel and must not be invisible.
    //
    // That capture only survives when the app was ALREADY installed when the
    // link was tapped. A friend who installs from the store arrives with
    // nothing but the code spelled out in the message they came from — so the
    // field is always open and always asks, rather than hiding behind a
    // chevron they have no reason to tap on the last screen of the flow.
    useEffect(() => {
        AsyncStorage.getItem('pending_referral_code')
            .then(deepCode => {
                if (deepCode) {
                    setInviteCode(deepCode.toUpperCase());
                    setCodeFromLink(true);
                }
            })
            .catch(() => {});
    }, []);

    // Parse sync results from route params (0 = skipped / no data)
    const streakDays = parseInt(params.streakDays ?? '0', 10) || 0;
    const totalSessions = parseInt(params.totalSessions ?? '0', 10) || 0;
    const activeDays = parseInt(params.activeDays ?? '0', 10) || 0;
    const hasSyncData = streakDays > 0 || totalSessions > 0;

    // Display values
    const displayStreak = hasSyncData ? streakDays : 1;
    // --- Animated values ---
    const glowIn        = useRef(new Animated.Value(0)).current;
    const ringScaleIn   = useRef(new Animated.Value(0.78)).current;
    const segmentOps    = useRef(Array.from({ length: SEGMENTS }, () => new Animated.Value(0))).current;
    const numberScale   = useRef(new Animated.Value(0)).current;
    const numberOpacity = useRef(new Animated.Value(0)).current;
    const contentOpacity = useRef(new Animated.Value(0)).current;
    const contentY      = useRef(new Animated.Value(30)).current;
    const bonusOpacity  = useRef(new Animated.Value(0)).current;
    const bonusY        = useRef(new Animated.Value(30)).current;
    const buttonOpacity = useRef(new Animated.Value(0)).current;
    const pulse         = useRef(new Animated.Value(1)).current;
    // Lifts the CTA block above the keyboard so the invite-code input stays visible.
    const kbOffset      = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.sequence([
            // 1. Glow + ring scale in
            Animated.parallel([
                Animated.timing(glowIn, { toValue: 1, duration: 750, useNativeDriver: true }),
                Animated.timing(ringScaleIn, {
                    toValue: 1,
                    duration: 750,
                    easing: Easing.out(Easing.back(1.06)),
                    useNativeDriver: true,
                }),
            ]),
            // 2. Segments light up one by one, up to displayStreak
            Animated.stagger(
                140,
                segmentOps.slice(0, Math.min(displayStreak, SEGMENTS)).map((v) =>
                    Animated.timing(v, {
                        toValue: 1,
                        duration: 360,
                        easing: Easing.out(Easing.cubic),
                        useNativeDriver: true,
                    }),
                ),
            ),
        ]).start(() => {
            // Ring complete -> number pop
            Animated.spring(numberScale, { toValue: 1, tension: 75, friction: 5, useNativeDriver: true }).start();
            Animated.timing(numberOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();

            // Headline slides up
            setTimeout(() => {
                Animated.parallel([
                    Animated.timing(contentOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
                    Animated.timing(contentY, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
                ]).start();
            }, 160);

            // Bonus card
            setTimeout(() => {
                Animated.parallel([
                    Animated.timing(bonusOpacity, { toValue: 1, duration: 460, useNativeDriver: true }),
                    Animated.timing(bonusY, { toValue: 0, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
                ]).start();
            }, 360);

            // Button + pulse loop
            setTimeout(() => {
                Animated.timing(buttonOpacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
                Animated.loop(
                    Animated.sequence([
                        Animated.timing(pulse, { toValue: 1.028, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                        Animated.timing(pulse, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                    ])
                ).start();
            }, 580);
        });
    }, []);

    // Keep the invite-code input above the keyboard.
    useEffect(() => {
        const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const onShow = (e: any) => {
            const h = e?.endCoordinates?.height ?? 0;
            Animated.timing(kbOffset, {
                toValue: -Math.max(0, h - insets.bottom),
                duration: Platform.OS === 'ios' ? (e?.duration || 250) : 180,
                useNativeDriver: true,
            }).start();
        };
        const onHide = (e: any) => {
            Animated.timing(kbOffset, {
                toValue: 0,
                duration: Platform.OS === 'ios' ? (e?.duration || 250) : 180,
                useNativeDriver: true,
            }).start();
        };
        const showSub = Keyboard.addListener(showEvt, onShow);
        const hideSub = Keyboard.addListener(hideEvt, onHide);
        return () => { showSub.remove(); hideSub.remove(); };
    }, [insets.bottom]);

    return (
        <View style={styles.container}>
            <GeometricBackground />
            {/* Back button */}
            <Pressable
                style={[styles.backButton, { top: insets.top + 14 }]}
                onPress={() => {
                    if (router.canGoBack()) {
                        router.back();
                    } else {
                        router.replace('/onboarding-activities');
                    }
                }}
                hitSlop={24}
            >
                <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
            </Pressable>

            {/* Main content */}
            <View style={styles.center}>

                {/* ── Ring area ── */}
                <Animated.View style={{ transform: [{ scale: pulse }] }}>
                    <Animated.View
                        style={[styles.ringContainer, { transform: [{ scale: ringScaleIn }] }]}
                    >
                        {/* Dark ambient halo to match leaderboard ring language */}
                        <Animated.View style={[
                            styles.darkHalo,
                            { opacity: glowIn.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) },
                        ]} />

                        {/* SVG segmented ring */}
                        <Svg width={CONTAINER} height={CONTAINER} style={StyleSheet.absoluteFillObject}>
                            {Array.from({ length: SEGMENTS }, (_, i) => {
                                const start = i * (360 / SEGMENTS) + GAP_DEG / 2;
                                const end = start + SEG_DEG;
                                const d = arcPath(RING_R, start, end);
                                return (
                                    <Path
                                        key={`track-${i}`}
                                        d={d}
                                        stroke="rgba(255,255,255,0.05)"
                                        strokeWidth={SW}
                                        strokeLinecap="round"
                                        fill="none"
                                    />
                                );
                            })}
                            {Array.from({ length: SEGMENTS }, (_, i) => {
                                const start = i * (360 / SEGMENTS) + GAP_DEG / 2;
                                const end = start + SEG_DEG;
                                const d = arcPath(RING_R, start, end);
                                return (
                                    <AnimatedPath
                                        key={`seg-${i}`}
                                        d={d}
                                        stroke={GOLD}
                                        strokeWidth={SW}
                                        strokeLinecap="round"
                                        fill="none"
                                        opacity={segmentOps[i]}
                                    />
                                );
                            })}
                        </Svg>

                        {/* Inner number + label */}
                        <View style={styles.ringInner}>
                            <Text style={styles.dayEyebrow}>DAY</Text>
                            <Animated.Text
                                style={[
                                    styles.dayNumber,
                                    {
                                        opacity: numberOpacity,
                                        transform: [{ scale: numberScale.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
                                    },
                                ]}
                            >
                                {displayStreak}
                            </Animated.Text>
                            <Text style={styles.daySub}>of 7</Text>
                        </View>
                    </Animated.View>
                </Animated.View>

                {/* ── Headline ── */}
                <Animated.View
                    style={[
                        styles.textBlock,
                        { opacity: contentOpacity, transform: [{ translateY: contentY }] },
                    ]}
                >
                    <Text style={styles.headline}>7 days already locked in.</Text>
                </Animated.View>

                {/* ── Earned today — inline ── */}
                <Animated.View
                    style={[
                        styles.bonusRow,
                        { opacity: bonusOpacity, transform: [{ translateY: bonusY }] },
                    ]}
                >
                    <View style={styles.bonusDot} />
                    <Text style={styles.bonusLabel}>Earned today</Text>
                    <Text style={styles.bonusAmount}>+20 POWR</Text>
                </Animated.View>
            </View>

            {/* ── CTA ── */}
            <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 28, opacity: buttonOpacity, transform: [{ translateY: kbOffset }] }]}>
                <StepDots current={dotIndexFor('/onboarding-achievement')} />
                {/* Invite code — the only place a referral can ever be applied */}
                <View style={styles.inviteBlock}>
                    <Text style={styles.inviteTitle}>
                        {codeFromLink ? 'Your friend’s invite code' : 'Got an invite code from a friend?'}
                    </Text>
                    <Text style={styles.inviteSub}>
                        {codeFromLink
                            ? 'Carried over from sign-up — you’ll both earn POWR once you log your first workout.'
                            : 'Last chance to enter it — you’ll both earn POWR after your first workout, and it can’t be added later.'}
                    </Text>
                    <TextInput
                        style={styles.codeInput}
                        placeholder="8-CHARACTER CODE"
                        placeholderTextColor="rgba(255,255,255,0.28)"
                        value={inviteCode}
                        onChangeText={t => setInviteCode(t.toUpperCase())}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={8}
                    />
                </View>
                <Pressable
                    style={({ pressed }) => [styles.primaryButton, (pressed || submitting) && { opacity: 0.86 }]}
                    disabled={submitting}
                    onPress={async () => {
                        if (submitting) return;
                        setSubmitting(true);
                        try {
                            // Retry once on failure — network blip at this step would send the user
                            // back through the whole onboarding flow on next launch.
                            let { error } = await markOnboardingComplete();
                            if (error) ({ error } = await markOnboardingComplete());
                            // Send the value-led welcome email (idempotent server-side, so a
                            // retry here never double-sends). Fire-and-forget — never block the
                            // user from entering the app on an email hiccup.
                            sendWelcomeEmail().catch((e) => console.warn('Welcome email failed', e));
                            // Process referral: manual code takes priority, else check deep-link capture
                            const deepCode = await AsyncStorage.getItem('pending_referral_code').catch(() => null);
                            const code = inviteCode.trim() || deepCode || null;
                            const goHome = () => router.replace('/(tabs)');
                            if (!code) { goHome(); return; }

                            // This screen is the ONLY place a code can be entered — invites
                            // count for first-time signups, nowhere later. So a transport
                            // failure gets one retry, and any outcome that leaves the code
                            // unapplied keeps the user HERE with the field open, rather than
                            // sending them home with a "later" that doesn't exist.
                            const applyCode = () => supabase.rpc('process_referral', { p_referral_code: code });
                            let { data, error: refErr } = await applyCode();
                            if (refErr) ({ data, error: refErr } = await applyCode());
                            const result = (data ?? null) as { success?: boolean; error?: string; status?: string } | null;

                            const stayAndFix = () => setInviteCode(code);
                            const dropCode = async () => {
                                await AsyncStorage.removeItem('pending_referral_code').catch(() => {});
                                goHome();
                            };

                            if (!refErr && result?.success) {
                                await AsyncStorage.removeItem('pending_referral_code').catch(() => {});
                                // Rewards pay on CONVERSION (first verified workout), not at
                                // code entry — see referral_conversion_check.
                                Alert.alert(
                                    'Invite code applied 🎉',
                                    'You and your friend both earn POWR once you log your first verified workout. Time to move!',
                                    [{ text: 'Let’s go', onPress: goHome }],
                                );
                                return;
                            }

                            const reason = refErr ? 'network' : (result?.error ?? 'network');
                            switch (reason) {
                                case 'invalid_code':
                                    Alert.alert(
                                        'Invite code not recognised',
                                        'Double-check the 8 characters against your friend’s message — this is the only place it can be entered.',
                                        [
                                            { text: 'Skip', style: 'cancel', onPress: dropCode },
                                            { text: 'Fix code', onPress: stayAndFix },
                                        ],
                                    );
                                    return;
                                case 'self_referral':
                                    Alert.alert('Invite code', "That's your own code — share it with a friend instead!", [
                                        { text: 'Continue', onPress: dropCode },
                                    ]);
                                    return;
case 'already_referred':
    Alert.alert('Invite code', 'That invite code is already applied to this account.', [
        { text: 'Continue', onPress: dropCode },
    ]);
    return;
                                case 'not_authenticated':
                                    Alert.alert('Invite code', 'Please sign in again to apply your code.', [
                                        { text: 'Continue', onPress: goHome },
                                    ]);
                                    return;
                                default:
                                    // Transport failure after a retry. The code is still in the
                                    // field (and in storage if it came from a link) — let them
                                    // try again from here; skipping means it's gone for good.
                                    Alert.alert(
                                        'Couldn’t apply your code',
                                        'Check your connection and try again — the code can only be applied now, during sign-up.',
                                        [
                                            { text: 'Skip', style: 'cancel', onPress: dropCode },
                                            { text: 'Try again', onPress: stayAndFix },
                                        ],
                                    );
                            }
                        } finally {
                            setSubmitting(false);
                        }
                    }}
                >
                    <Text style={styles.primaryLabel}>{submitting ? 'ONE SEC…' : 'LET\'S GO →'}</Text>
                </Pressable>
            </Animated.View>
        </View>
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
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },

    // Ring
    ringContainer: {
        width: CONTAINER,
        height: CONTAINER,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
    },
    darkHalo: {
        position: 'absolute',
        width: 292,
        height: 292,
        borderRadius: 146,
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.04)',
        shadowColor: GOLD,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.16,
        shadowRadius: 20,
    },
    ringInner: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    dayEyebrow: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 10,
        fontFamily: FONT_MEDIUM,
        fontWeight: '500',
        letterSpacing: 4,
        textTransform: 'uppercase',
        marginBottom: 6,
    },
    dayNumber: {
        color: '#FFFFFF',
        fontSize: 128,
        fontFamily: FONT_LIGHT,
        fontWeight: '100',
        lineHeight: 132,
        textAlign: 'center',
    },
    daySub: {
        color: 'rgba(255,255,255,0.32)',
        fontSize: 13,
        fontFamily: FONT_LIGHT,
        fontWeight: '300',
        letterSpacing: 0.3,
        marginTop: 4,
    },

    // Text block
    textBlock: {
        alignItems: 'center',
        marginTop: 48,
        marginBottom: 28,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 26,
        fontFamily: FONT_LIGHT,
        fontWeight: '300',
        letterSpacing: -0.4,
        textAlign: 'center',
        lineHeight: 32,
        marginBottom: 0,
    },
    body: {
        color: 'rgba(255,255,255,0.42)',
        fontSize: 14,
        fontWeight: '300',
        lineHeight: 20,
        letterSpacing: 0.1,
        textAlign: 'center',
    },

    // Inline earned row
    bonusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 6,
        paddingHorizontal: 0,
    },
    bonusDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: GOLD,
        marginRight: 10,
    },
    bonusLabel: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 12,
        fontFamily: FONT_REGULAR,
        fontWeight: '400',
        letterSpacing: 0.2,
        marginRight: 10,
    },
    bonusAmount: {
        color: GOLD,
        fontSize: 13,
        fontFamily: FONT_SEMIBOLD,
        fontWeight: '600',
        letterSpacing: 0.4,
    },

    // CTA
    bottom: {
        paddingHorizontal: 24,
    },
    inviteBlock: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.28)',
        backgroundColor: 'rgba(232,210,0,0.06)',
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 12,
        marginBottom: 14,
    },
    inviteTitle: {
        color: GOLD,
        fontSize: 14,
        fontFamily: FONT_SEMIBOLD,
        fontWeight: '600',
        letterSpacing: 0.2,
    },
    inviteSub: {
        color: 'rgba(255,255,255,0.62)',
        fontSize: 12,
        fontFamily: FONT_REGULAR,
        lineHeight: 17,
        marginTop: 3,
        marginBottom: 10,
    },
    codeInput: {
        height: 44,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.16)',
        backgroundColor: 'rgba(0,0,0,0.35)',
        color: '#F2F2F2',
        fontSize: 15,
        fontFamily: FONT_MEDIUM,
        letterSpacing: 2,
        textAlign: 'center',
        paddingHorizontal: 16,
    },
    primaryButton: {
        height: 52,
        borderRadius: 26,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryLabel: {
        color: '#0a0a0a',
        fontSize: 12,
        fontFamily: FONT_BOLD,
        fontWeight: '700',
        letterSpacing: 1.5,
    },
});

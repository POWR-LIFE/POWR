import { useAuth } from '@/context/AuthContext';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const GOLD = '#facc15';
const BG = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';

function StepDots({ current }: { current: number }) {
    return (
        <View style={dotStyles.row}>
            {[0, 1, 2].map(i => (
                <View
                    key={i}
                    style={[
                        dotStyles.dot,
                        i === current ? dotStyles.dotActive : dotStyles.dotInactive,
                    ]}
                />
            ))}
        </View>
    );
}

const dotStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: 6,
        justifyContent: 'center',
        marginBottom: 28,
    },
    dot: {
        height: 5,
        borderRadius: 3,
    },
    dotActive: {
        width: 20,
        backgroundColor: GOLD,
    },
    dotInactive: {
        width: 5,
        backgroundColor: 'rgba(255,255,255,0.15)',
    },
});

const AUTH_OPTIONS = [
    { id: 'apple',  label: 'Continue with Apple',  icon: '' },
    { id: 'google', label: 'Continue with Google', icon: 'G' },
    { id: 'email',  label: 'Continue with Email',  icon: '@' },
];

export default function OnboardingAccountScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { signInWithGoogle } = useAuth();
    const [loadingMethod, setLoadingMethod] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const headerFade = useRef(new Animated.Value(0)).current;
    const iconScale = useRef(new Animated.Value(0.8)).current;
    const buttonsFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.sequence([
            Animated.parallel([
                Animated.timing(headerFade, { toValue: 1, duration: 500, useNativeDriver: true }),
                Animated.spring(iconScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
            ]),
            Animated.timing(buttonsFade, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]).start();
    }, [headerFade, iconScale, buttonsFade]);

    const handleAuth = async (method: string) => {
        setError(null);
        if (method === 'google') {
            setLoadingMethod('google');
            const { error } = await signInWithGoogle();
            setLoadingMethod(null);
            if (error) { setError(error); return; }
            // onAuthStateChange in AuthContext will update session,
            // index.tsx will route to the correct screen
        } else if (method === 'email') {
            router.push('/auth-email');
        } else if (method === 'login') {
            router.push({ pathname: '/auth-email', params: { mode: 'signin' } });
        }
    };

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={[BG, '#0f0f0f', BG]}
                locations={[0, 0.5, 1]}
                style={StyleSheet.absoluteFillObject}
            />

            {/* Logo */}
            <View style={[styles.logo, { top: insets.top + 18 }]}>
                <Image
                    source={require('@/assets/images/powrlogotext.png')}
                    style={styles.logoImage}
                    contentFit="contain"
                />
            </View>

            {/* Center */}
            <View style={styles.center}>
                <Animated.View style={{ opacity: headerFade, alignItems: 'center' }}>
                    {/* Icon */}
                    <Animated.View style={[styles.iconBox, { transform: [{ scale: iconScale }] }]}>
                        <Text style={styles.iconText}>POWR</Text>
                    </Animated.View>

                    <Text style={styles.eyebrow}>STEP 1 OF 3</Text>
                    <Text style={styles.headline}>
                        Your streak{'\n'}
                        <Text style={styles.headlineGold}>is yours.</Text>
                    </Text>
                    <Text style={styles.body}>
                        Movement, streaks, points — everything{'\n'}you've earned, secured and with you.
                    </Text>
                </Animated.View>

                {/* Auth options */}
                <Animated.View style={[styles.authList, { opacity: buttonsFade }]}>
                    {AUTH_OPTIONS.map(opt => (
                        <Pressable
                            key={opt.id}
                            style={({ pressed }) => [
                                styles.authButton,
                                pressed && styles.authButtonPressed,
                                loadingMethod === opt.id && styles.authButtonPressed,
                            ]}
                            onPress={() => handleAuth(opt.id)}
                            disabled={loadingMethod !== null}
                        >
                            {loadingMethod === opt.id
                                ? <ActivityIndicator color="#F2F2F2" style={{ width: 22 }} />
                                : <Text style={styles.authIcon}>{opt.icon}</Text>
                            }
                            <Text style={styles.authLabel}>{opt.label}</Text>
                        </Pressable>
                    ))}
                    {error && (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    )}
                </Animated.View>
            </View>

            {/* Bottom */}
            <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 32, opacity: buttonsFade }]}>
                <StepDots current={0} />
                <Pressable onPress={() => handleAuth('login')}>
                    <Text style={styles.footerText}>
                        Already have an account?{'  '}
                        <Text style={styles.footerLink}>Log in</Text>
                    </Text>
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
    logo: {
        position: 'absolute',
        left: 20,
        zIndex: 10,
    },
    logoImage: {
        width: 100,
        height: 36,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    iconBox: {
        width: 72,
        height: 72,
        borderRadius: 20,
        backgroundColor: 'rgba(250,204,21,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(250,204,21,0.22)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 32,
    },
    iconText: {
        color: GOLD,
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 2,
    },
    eyebrow: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        marginBottom: 12,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 40,
        fontWeight: '200',
        letterSpacing: -1,
        lineHeight: 46,
        textAlign: 'center',
        marginBottom: 14,
    },
    headlineGold: {
        color: GOLD,
        fontWeight: '700',
    },
    body: {
        color: 'rgba(255,255,255,0.38)',
        fontSize: 14,
        fontWeight: '300',
        lineHeight: 22,
        textAlign: 'center',
        marginBottom: 40,
    },
    authList: {
        width: '100%',
        gap: 10,
    },
    authButton: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 52,
        borderRadius: 26,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 22,
        gap: 14,
    },
    authButtonPressed: {
        opacity: 0.75,
    },
    authIcon: {
        color: '#F2F2F2',
        fontSize: 15,
        fontWeight: '600',
        width: 22,
        textAlign: 'center',
    },
    authLabel: {
        color: '#F2F2F2',
        fontSize: 14,
        fontWeight: '400',
        flex: 1,
        textAlign: 'center',
        marginRight: 22,
    },
    errorBox: {
        backgroundColor: 'rgba(255,60,60,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,60,60,0.25)',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginTop: 4,
    },
    errorText: {
        color: '#ff6b6b',
        fontSize: 13,
        fontWeight: '300',
        textAlign: 'center',
        lineHeight: 18,
    },
    bottom: {
        paddingHorizontal: 24,
        alignItems: 'center',
    },
    footerText: {
        color: 'rgba(255,255,255,0.28)',
        fontSize: 13,
        fontWeight: '300',
    },
    footerLink: {
        color: GOLD,
        fontWeight: '600',
    },
});

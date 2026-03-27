import { useAuth } from '@/context/AuthContext';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';

const GOLD = '#E8D200';
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
        marginBottom: 20,
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

type AuthOption = {
    id: string;
    label: string;
    icon: React.ReactNode;
};

const AUTH_OPTIONS: AuthOption[] = [
    {
        id: 'apple',
        label: 'Continue with Apple',
        icon: <FontAwesome name="apple" size={19} color="#F2F2F2" />,
    },
    {
        id: 'google',
        label: 'Continue with Google',
        icon: <FontAwesome name="google" size={17} color="#F2F2F2" />,
    },
    {
        id: 'email',
        label: 'Continue with Email',
        icon: <Ionicons name="mail-outline" size={18} color="#F2F2F2" />,
    },
];

export default function OnboardingAccountScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { signInWithGoogle } = useAuth();
    const [loadingMethod, setLoadingMethod] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const headerFade = useRef(new Animated.Value(0)).current;
    const iconScale = useRef(new Animated.Value(0.85)).current;
    const buttonsFade = useRef(new Animated.Value(0)).current;
    const buttonsSlide = useRef(new Animated.Value(16)).current;

    useEffect(() => {
        Animated.sequence([
            Animated.parallel([
                Animated.timing(headerFade, { toValue: 1, duration: 500, useNativeDriver: true }),
                Animated.spring(iconScale, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }),
            ]),
            Animated.parallel([
                Animated.timing(buttonsFade, { toValue: 1, duration: 400, useNativeDriver: true }),
                Animated.timing(buttonsSlide, { toValue: 0, duration: 400, useNativeDriver: true }),
            ]),
        ]).start();
    }, [headerFade, iconScale, buttonsFade, buttonsSlide]);

    const handleAuth = async (method: string) => {
        setError(null);
        if (method === 'google') {
            setLoadingMethod('google');
            const { error } = await signInWithGoogle();
            setLoadingMethod(null);
            if (error) { setError(error); return; }
        } else if (method === 'email') {
            router.push('/auth-email');
        } else if (method === 'login') {
            router.push({ pathname: '/auth-email', params: { mode: 'signin' } });
        }
    };

    return (
        <View style={styles.container}>
            <GeometricBackground />

            {/* Back button */}
            <Pressable
                style={[styles.backButton, { top: insets.top + 14 }]}
                onPress={() => router.back()}
                hitSlop={24}
            >
                <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
            </Pressable>

            {/* Center content */}
            <View style={styles.center}>
                <Animated.View style={[styles.headerBlock, { opacity: headerFade }]}>
                    {/* App logo */}
                    <Animated.View style={[styles.logoContainer, { transform: [{ scale: iconScale }] }]}>
                        <Image
                            source={require('@/assets/images/powrlogotext.png')}
                            style={styles.logoImage}
                            contentFit="contain"
                        />
                    </Animated.View>


                    {/* Headline */}
                    <View style={styles.headlineRow}>
                        <Text style={styles.headline}>
                            Your streak{'\n'}
                            <Text style={styles.headlineGold}>is yours.</Text>
                        </Text>
                    </View>

                    {/* Body */}
                    <Text style={styles.body}>
                        Movement, streaks, points — everything{'\n'}you've earned, secured and with you.
                    </Text>
                </Animated.View>

                {/* Auth buttons */}
                <Animated.View
                    style={[
                        styles.authList,
                        { opacity: buttonsFade, transform: [{ translateY: buttonsSlide }] },
                    ]}
                >
                    {/* Social Row */}
                    <View style={styles.socialRow}>
                        {AUTH_OPTIONS.slice(0, 2).map((opt) => (
                            <Pressable
                                key={opt.id}
                                style={({ pressed }) => [
                                    styles.authButton,
                                    styles.authButtonHalf,
                                    (pressed || loadingMethod === opt.id) && styles.authButtonPressed,
                                ]}
                                onPress={() => handleAuth(opt.id)}
                                disabled={loadingMethod !== null}
                            >
                                <View style={[styles.authIconWrap, styles.authIconAbsolute]}>
                                    {loadingMethod === opt.id
                                        ? <ActivityIndicator color="#F2F2F2" size="small" />
                                        : opt.icon
                                    }
                                </View>
                                <Text style={styles.authLabelSocial}>
                                    {opt.label.split(' ').pop()}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    {/* Separator */}
                    <View style={styles.separatorContainer}>
                        <Text style={styles.separatorText}>or</Text>
                    </View>

                    {/* Email Button */}
                    <Pressable
                        style={({ pressed }) => [
                            styles.authButton,
                            (pressed || loadingMethod === 'email') && styles.authButtonPressed,
                        ]}
                        onPress={() => handleAuth('email')}
                        disabled={loadingMethod !== null}
                    >
                        <View style={[styles.authIconWrap, styles.authIconAbsolute]}>
                            {loadingMethod === 'email'
                                ? <ActivityIndicator color="#F2F2F2" size="small" />
                                : AUTH_OPTIONS[2].icon
                            }
                        </View>
                        <Text style={styles.authLabel}>
                            {AUTH_OPTIONS[2].label}
                        </Text>
                    </Pressable>

                    {error && (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    )}
                </Animated.View>
            </View>

            {/* Bottom */}
            <Animated.View
                style={[styles.bottom, { paddingBottom: insets.bottom + 28, opacity: buttonsFade }]}
            >
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
    backButton: {
        position: 'absolute',
        left: 16,
        zIndex: 20,
        padding: 4,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 28,
        zIndex: 1,
    },
    headerBlock: {
        alignItems: 'center',
        marginBottom: 36,
    },
    logoContainer: {
        width: 440,
        height: 146,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 32,
    },
    logoImage: {
        width: '100%',
        height: '100%',
    },
    headlineRow: {
        marginBottom: 14,
    },
    eyebrow: {
        color: 'rgba(255,255,255,0.20)',
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 3,
        textTransform: 'uppercase',
        marginBottom: 14,
    },
    headline: {
        color: '#F2F2F2',
        fontSize: 44,
        fontWeight: '200',
        letterSpacing: -1.5,
        lineHeight: 50,
        textAlign: 'center',
    },
    headlineGold: {
        color: GOLD,
        fontWeight: '700',
        letterSpacing: -1.5,
    },
    body: {
        color: 'rgba(255,255,255,0.35)',
        fontSize: 14,
        fontWeight: '300',
        lineHeight: 22,
        textAlign: 'center',
    },
    authList: {
        width: '100%',
        gap: 10,
    },
    authButton: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 54,
        borderRadius: 27,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 6,
    },
    authButtonPrimary: {
        borderColor: 'rgba(255,255,255,0.14)',
        backgroundColor: 'rgba(50,50,50,0.9)',
    },
    authButtonPressed: {
        opacity: 0.6,
    },
    socialRow: {
        flexDirection: 'row',
        gap: 10,
    },
    authButtonHalf: {
        flex: 1,
        justifyContent: 'center',
    },
    separatorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 10,
        gap: 12,
        paddingHorizontal: 4,
    },
    separatorLine: {
        flex: 1,
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    separatorText: {
        color: 'rgba(255,255,255,0.25)',
        fontSize: 12,
        fontWeight: '500',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    authIconWrap: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.30)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    authIconAbsolute: {
        position: 'absolute',
        left: 6,
    },
    authLabel: {
        color: 'rgba(255,255,255,0.75)',
        fontSize: 14,
        fontWeight: '400',
        flex: 1,
        textAlign: 'center',
        letterSpacing: 0.2,
    },
    authLabelPrimary: {
        color: '#F2F2F2',
        fontWeight: '500',
    },
    authLabelSocial: {
        color: 'rgba(255,255,255,0.85)',
        fontSize: 15,
        fontWeight: '600',
        letterSpacing: 0.2,
    },
    errorBox: {
        backgroundColor: 'rgba(255,60,60,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,60,60,0.25)',
        borderRadius: 12,
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
        zIndex: 1,
    },
    footerText: {
        color: 'rgba(255,255,255,0.25)',
        fontSize: 13,
        fontWeight: '300',
        letterSpacing: 0.1,
    },
    footerLink: {
        color: GOLD,
        fontWeight: '600',
    },
});

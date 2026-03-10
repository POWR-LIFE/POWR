import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { THEMES, useAppTheme } from '@/context/ThemeContext';

export default function OnboardingAccountScreen() {
    const { theme } = useAppTheme();
    const activeColor = THEMES.find(t => t.name === theme)?.primary || '#CEFF00';
    const router = useRouter();
    const insets = useSafeAreaInsets();

    // Fade-in
    const contentFade = useRef(new Animated.Value(0)).current;
    const buttonsFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.sequence([
            Animated.timing(contentFade, {
                toValue: 1,
                duration: 500,
                useNativeDriver: true,
            }),
            Animated.timing(buttonsFade, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
            }),
        ]).start();
    }, [contentFade, buttonsFade]);

    const handleAuth = (method: string) => {
        // Stub — actual auth implementation is separate work
        console.log(`Auth: ${method}`);
        router.push('/onboarding-achievement');
    };

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={['#0A0A0A', '#111111', '#0A0A0A']}
                locations={[0, 0.5, 1]}
                style={StyleSheet.absoluteFillObject}
            />

            {/* Top-left POWR icon */}
            <View style={[styles.logoContainer, { top: insets.top + 12 }]}>
                <Image
                    source={require('@/assets/images/powrlogotext.png')}
                    style={styles.logoIcon}
                    contentFit="contain"
                />
            </View>

            {/* Center content */}
            <View style={styles.centerContent}>
                <Animated.View style={[styles.headlineBlock, { opacity: contentFade }]}>
                    {/* Lock icon */}
                    <View style={styles.lockIcon}>
                        <Text style={styles.lockEmoji}>🔒</Text>
                    </View>

                    <Text style={styles.headline}>Save your progress</Text>
                    <Text style={styles.subtext}>
                        Your movement and streak are{'\n'}stored securely.
                    </Text>
                </Animated.View>

                {/* Auth buttons */}
                <Animated.View style={[styles.authButtons, { opacity: buttonsFade }]}>
                    <Pressable
                        style={styles.authButton}
                        onPress={() => handleAuth('apple')}
                    >
                        <Text style={styles.authIcon}></Text>
                        <Text style={styles.authButtonText}>Continue with Apple</Text>
                    </Pressable>

                    <Pressable
                        style={styles.authButton}
                        onPress={() => handleAuth('google')}
                    >
                        <Text style={styles.authIcon}>G</Text>
                        <Text style={styles.authButtonText}>Continue with Google</Text>
                    </Pressable>

                    <Pressable
                        style={styles.authButton}
                        onPress={() => handleAuth('email')}
                    >
                        <Text style={styles.authIcon}>✉</Text>
                        <Text style={styles.authButtonText}>Continue with Email</Text>
                    </Pressable>
                </Animated.View>
            </View>

            {/* Footer */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
                <Pressable onPress={() => handleAuth('login')}>
                    <Text style={styles.footerText}>
                        Already have an account?{' '}
                        <Text style={[styles.footerLink, { color: activeColor }]}>Log in</Text>
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
    logoContainer: {
        position: 'absolute',
        left: 20,
        zIndex: 10,
    },
    logoIcon: {
        width: 100,
        height: 36,
    },
    centerContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    headlineBlock: {
        alignItems: 'center',
        marginBottom: 48,
    },
    lockIcon: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'rgba(255,255,255,0.06)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
    },
    lockEmoji: {
        fontSize: 28,
    },
    headline: {
        color: '#FFFFFF',
        fontSize: 28,
        fontWeight: '800',
        textAlign: 'center',
        letterSpacing: -0.5,
        marginBottom: 12,
    },
    subtext: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 16,
        fontWeight: '400',
        textAlign: 'center',
        lineHeight: 24,
    },
    authButtons: {
        width: '100%',
        gap: 12,
    },
    authButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 54,
        borderRadius: 27,
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
        gap: 10,
    },
    authIcon: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '600',
    },
    authButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    footer: {
        paddingHorizontal: 24,
        alignItems: 'center',
    },
    footerText: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 14,
    },
    footerLink: {
        fontWeight: '600',
    },
});

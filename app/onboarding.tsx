import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, ResizeMode } from 'expo-av';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const FONT_LIGHT = 'Outfit_300Light';
const FONT_MEDIUM = 'Outfit_500Medium';
const FONT_SEMIBOLD = 'Outfit_600SemiBold';
const FONT_BOLD = 'Outfit_700Bold';

export default function OnboardingScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const line1Fade = useRef(new Animated.Value(0)).current;
    const buttonsFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.sequence([
            Animated.delay(900),
            Animated.timing(line1Fade, { toValue: 1, duration: 900, useNativeDriver: true }),
            Animated.timing(buttonsFade, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]).start();
    }, [line1Fade, buttonsFade]);

    return (
        <View style={styles.container}>
            {/* Background Video */}
            <Video
                source={{ uri: 'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/landing-page-assets/landing_hero.mp4' }}
                style={StyleSheet.absoluteFill}
                resizeMode={ResizeMode.COVER}
                shouldPlay
                isLooping
                isMuted
            />
{/* Dark overlay for text readability */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.2)' }]} />

            {/* Bottom content */}
            <View style={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
                {/* Headlines */}
                <View style={styles.headlineBlock}>
                    <Animated.Text style={[styles.headline, { opacity: line1Fade }]}>
                        Train.
                    </Animated.Text>
                    <Animated.Text style={[styles.headline, { opacity: line1Fade }]}>
                        Earn.
                    </Animated.Text>
                    <Animated.Text style={[styles.headline, { opacity: line1Fade }]}>
                        Repeat.
                    </Animated.Text>
                </View>

                {/* Buttons */}
                <Animated.View style={[styles.buttons, { opacity: buttonsFade }]}>
                    <Pressable
                        style={styles.primaryButton}
                        onPress={() => router.push('/onboarding-account')}
                    >
                        <Text style={styles.primaryLabel}>GET STARTED</Text>
                    </Pressable>

                    <Pressable
                        style={styles.ghostButton}
                        onPress={() => router.push('/onboarding-account')}
                    >
                        <Text style={styles.ghostLabel}>LOG IN</Text>
                    </Pressable>
                </Animated.View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BG,
    },
    content: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 24,
        zIndex: 10,
    },
    headlineBlock: {
        marginBottom: 14,
    },
    headline: {
        color: GOLD,
        fontSize: 44,
        fontFamily: FONT_MEDIUM,
        fontWeight: '500',
        letterSpacing: -1.5,
        lineHeight: 50,
    },
    buttons: {
        gap: 10,
        marginBottom: 18,
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
    ghostButton: {
        height: 52,
        borderRadius: 26,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.18)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    ghostLabel: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 12,
        fontFamily: FONT_SEMIBOLD,
        fontWeight: '600',
        letterSpacing: 1.5,
    },
});

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, ResizeMode } from 'expo-av';

const GOLD = '#E8D200';
const BG = '#0d0d0d';

export default function OnboardingScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const line1Fade = useRef(new Animated.Value(0)).current;
    const line2Fade = useRef(new Animated.Value(0)).current;
    const subFade = useRef(new Animated.Value(0)).current;
    const buttonsFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.sequence([
            Animated.delay(900),
            Animated.timing(line1Fade, { toValue: 1, duration: 900, useNativeDriver: true }),
            Animated.delay(200),
            Animated.timing(line2Fade, { toValue: 1, duration: 900, useNativeDriver: true }),
            Animated.delay(200),
            Animated.timing(subFade, { toValue: 1, duration: 700, useNativeDriver: true }),
            Animated.timing(buttonsFade, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]).start();
    }, [line1Fade, line2Fade, subFade, buttonsFade]);

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
                        Your last workout
                    </Animated.Text>
                    <Animated.Text style={[styles.headlineGoldLine, { opacity: line2Fade }]}>
                        earned you nothing.
                    </Animated.Text>
                </View>

                {/* Sub copy */}
                <Animated.Text style={[styles.subCopy, { opacity: subFade }]}>
                    POWR makes sure it counts. Every gym session, run, walk and ride - rewarded.
                </Animated.Text>

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

                {/* Legal */}
                <Animated.Text style={[styles.legal, { opacity: buttonsFade }]}>
                    Free to join · No credit card required
                </Animated.Text>
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
        color: '#F2F2F2',
        fontSize: 44,
        fontWeight: '200',
        letterSpacing: -1.5,
        lineHeight: 50,
    },
    headlineGoldLine: {
        color: GOLD,
        fontSize: 44,
        fontWeight: '400',
        letterSpacing: -1.5,
        lineHeight: 50,
    },
    headlineGold: {
        color: GOLD,
        fontWeight: '700',
    },
    subCopy: {
        color: 'rgba(255,255,255,0.45)',
        fontSize: 15,
        fontWeight: '300',
        lineHeight: 23,
        marginBottom: 32,
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
        fontWeight: '600',
        letterSpacing: 1.5,
    },
    legal: {
        color: 'rgba(255,255,255,0.2)',
        fontSize: 11,
        fontWeight: '300',
        textAlign: 'center',
        letterSpacing: 0.3,
    },
});

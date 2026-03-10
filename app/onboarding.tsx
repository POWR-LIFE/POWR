import { ResizeMode, Video } from 'expo-av';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { THEMES, useAppTheme } from '@/context/ThemeContext';

export default function OnboardingScreen() {
    const { theme } = useAppTheme();
    const activeColor = THEMES.find(t => t.name === theme)?.primary || '#CEFF00';
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const videoRef = useRef<Video>(null);

    // Animation values for the 3 headline lines
    const line1Fade = useRef(new Animated.Value(0)).current;
    const line2Fade = useRef(new Animated.Value(0)).current;
    const line3Fade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        // Staggered fade in animation over the course of the 8-second video
        Animated.sequence([
            Animated.delay(1000), // Wait 1 second before starting
            Animated.timing(line1Fade, {
                toValue: 1,
                duration: 800,
                useNativeDriver: true,
            }),
            Animated.delay(800), // Wait a bit
            Animated.timing(line2Fade, {
                toValue: 1,
                duration: 800,
                useNativeDriver: true,
            }),
            Animated.delay(800), // Wait a bit
            Animated.timing(line3Fade, {
                toValue: 1,
                duration: 800,
                useNativeDriver: true,
            }),
        ]).start();
    }, [line1Fade, line2Fade, line3Fade]);

    // Real gym video asset
    const videoSource = require('@/assets/images/hero_gym_entry.mp4');

    return (
        <View style={styles.container}>
            {/* Full-screen background video */}
            <Video
                ref={videoRef}
                source={videoSource}
                style={StyleSheet.absoluteFillObject}
                resizeMode={ResizeMode.COVER}
                shouldPlay={true}
                isLooping={true}
                isMuted={true}
                onReadyForDisplay={() => {
                    videoRef.current?.playAsync();
                }}
                onLoad={() => {
                    videoRef.current?.playAsync();
                }}
            />

            {/* Bottom gradient overlay for text legibility */}
            <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.85)']}
                locations={[0, 0.4, 1]}
                style={styles.gradientOverlay}
            />

            {/* POWR icon — top left */}
            <View style={[styles.logoContainer, { top: insets.top + 12 }]}>
                <Image
                    source={require('@/assets/images/powrlogotext.png')}
                    style={styles.logoIcon}
                    contentFit="contain"
                />
            </View>

            {/* Bottom content */}
            <View style={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
                {/* Headline (Animated and Staggered) */}
                <View style={styles.headlineContainer}>
                    <Animated.Text style={[styles.headline, { opacity: line1Fade }]}>
                        MADE TO <Text style={{ color: activeColor }}>MOVE</Text>
                    </Animated.Text>

                    <Animated.Text style={[styles.headline, { opacity: line2Fade }]}>
                        DESIGNED TO <Text style={{ color: activeColor }}>REWARD</Text>
                    </Animated.Text>

                    {/* <Animated.Text style={[styles.headline, { opacity: line3Fade }]}>
                        GET <Text style={{ color: activeColor }}>REWARDED</Text>
                    </Animated.Text> */}
                </View>

                {/* Button row */}
                <View style={styles.buttonRow}>
                    <Pressable
                        style={[styles.primaryButton, { backgroundColor: activeColor }]}
                        onPress={() => router.push('/onboarding-permission')}
                    >
                        <Text style={styles.primaryButtonText}>Start Today</Text>
                    </Pressable>

                    <Pressable
                        style={styles.secondaryButton}
                        onPress={() => console.log('Log In')}
                    >
                        <Text style={styles.secondaryButtonText}>Log In</Text>
                    </Pressable>
                </View>

                {/* Footnote */}
                <Text style={styles.footnote}>
                    Your POWR journey starts today.
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    gradientOverlay: {
        ...StyleSheet.absoluteFillObject,
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
    content: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 24,
        zIndex: 10,
    },
    headlineContainer: {
        marginBottom: 28,
    },
    headline: {
        color: '#FFFFFF',
        fontSize: 42,
        fontWeight: '900',
        letterSpacing: -1,
        lineHeight: 48,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 20,
    },
    primaryButton: {
        flex: 1,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryButtonText: {
        color: '#000',
        fontSize: 16,
        fontWeight: '700',
    },
    secondaryButton: {
        flex: 1,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.15)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
    },
    secondaryButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
    },
    footnote: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 12,
        textAlign: 'center',
        marginBottom: 8,
    },
});

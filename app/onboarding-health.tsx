import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { THEMES, useAppTheme } from '@/context/ThemeContext';

interface HealthSource {
    id: string;
    name: string;
    color: string;
    initial: string;
}

const HEALTH_SOURCES: HealthSource[] = [
    { id: 'apple-health', name: 'Apple Health', color: '#FF3B30', initial: '♥' },
    { id: 'google-fit', name: 'Google Fit', color: '#4285F4', initial: 'G' },
    { id: 'samsung-health', name: 'Samsung Health', color: '#1428A0', initial: 'S' },
    { id: 'whoop', name: 'Whoop', color: '#44D62C', initial: 'W' },
    { id: 'garmin', name: 'Garmin', color: '#007DC3', initial: 'G' },
    { id: 'fitbit', name: 'Fitbit', color: '#00B0B9', initial: 'F' },
];

export default function OnboardingHealthScreen() {
    const { theme } = useAppTheme();
    const activeColor = THEMES.find(t => t.name === theme)?.primary || '#CEFF00';
    const router = useRouter();
    const insets = useSafeAreaInsets();

    // Staggered row animations
    const rowAnims = useRef(HEALTH_SOURCES.map(() => new Animated.Value(0))).current;
    const headerFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.sequence([
            Animated.timing(headerFade, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
            }),
            Animated.stagger(
                100,
                rowAnims.map(anim =>
                    Animated.timing(anim, {
                        toValue: 1,
                        duration: 350,
                        useNativeDriver: true,
                    })
                )
            ),
        ]).start();
    }, [headerFade, rowAnims]);

    const handleConnect = (source: HealthSource) => {
        // Stub — actual SDK integration is separate work
        console.log(`Connect: ${source.name}`);
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

            <View style={[styles.content, { paddingTop: insets.top + 72 }]}>
                {/* Header */}
                <Animated.View style={{ opacity: headerFade }}>
                    <Text style={styles.title}>Connect with:</Text>
                </Animated.View>

                {/* Health source list */}
                <ScrollView
                    style={styles.listContainer}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                >
                    {HEALTH_SOURCES.map((source, index) => (
                        <Animated.View
                            key={source.id}
                            style={[
                                styles.sourceRow,
                                {
                                    opacity: rowAnims[index],
                                    transform: [{
                                        translateY: rowAnims[index].interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [20, 0],
                                        }),
                                    }],
                                },
                            ]}
                        >
                            {/* Brand icon circle */}
                            <View style={[styles.sourceIcon, { backgroundColor: source.color }]}>
                                <Text style={styles.sourceInitial}>{source.initial}</Text>
                            </View>

                            {/* Name */}
                            <Text style={styles.sourceName}>{source.name}</Text>

                            {/* Connect button */}
                            <Pressable
                                style={[styles.connectButton, { backgroundColor: activeColor }]}
                                onPress={() => handleConnect(source)}
                            >
                                <Text style={styles.connectButtonText}>Connect</Text>
                            </Pressable>
                        </Animated.View>
                    ))}
                </ScrollView>
            </View>

            {/* Bottom CTA */}
            <View style={[styles.bottomContent, { paddingBottom: insets.bottom + 24 }]}>
                <Pressable
                    style={[styles.continueButton, { backgroundColor: activeColor }]}
                    onPress={() => router.push('/onboarding-account')}
                >
                    <Text style={styles.continueButtonText}>Continue</Text>
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
    content: {
        flex: 1,
        paddingHorizontal: 24,
    },
    title: {
        color: '#FFFFFF',
        fontSize: 28,
        fontWeight: '800',
        marginBottom: 28,
        letterSpacing: -0.5,
    },
    listContainer: {
        flex: 1,
    },
    listContent: {
        gap: 12,
        paddingBottom: 20,
    },
    sourceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 16,
    },
    sourceIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sourceInitial: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
    },
    sourceName: {
        flex: 1,
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 14,
    },
    connectButton: {
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 20,
    },
    connectButtonText: {
        color: '#000',
        fontSize: 14,
        fontWeight: '700',
    },
    bottomContent: {
        paddingHorizontal: 24,
    },
    continueButton: {
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    continueButtonText: {
        color: '#000',
        fontSize: 16,
        fontWeight: '700',
    },
});

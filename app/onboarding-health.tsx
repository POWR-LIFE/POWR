import { FontAwesome5, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GeometricBackground from '@/components/GeometricBackground';

const GOLD = '#E8D200';
const BG = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';

interface HealthSource {
    id: string;
    name: string;
    color: string;
}

const HEALTH_SOURCES: HealthSource[] = [
    { id: 'apple-health',   name: 'Apple Health',   color: '#FF3B30' },
    { id: 'google-fit',     name: 'Google Fit',     color: '#4285F4' },
    { id: 'samsung-health', name: 'Samsung Health', color: '#1428A0' },
    { id: 'whoop',          name: 'Whoop',          color: '#44D62C' },
    { id: 'garmin',         name: 'Garmin',         color: '#007DC3' },
    { id: 'fitbit',         name: 'Fitbit',         color: '#00B0B9' },
];

function BrandIcon({ id }: { id: string }) {
    switch (id) {
        case 'apple-health':
            return <FontAwesome5 name="apple" size={21} color="#fff" />;
        case 'google-fit':
            return <FontAwesome5 name="google" size={20} color="#fff" />;
        case 'samsung-health':
            return <MaterialCommunityIcons name="cellphone" size={22} color="#fff" />;
        case 'whoop':
            return <MaterialCommunityIcons name="lightning-bolt" size={22} color="#fff" />;
        case 'garmin':
            return <MaterialCommunityIcons name="compass" size={22} color="#fff" />;
        case 'fitbit':
            return <MaterialCommunityIcons name="watch-variant" size={22} color="#fff" />;
        default:
            return null;
    }
}

function StepDots({ current }: { current: number }) {
    return (
        <View style={dotStyles.row}>
            {[0, 1, 2].map(i => (
                <View
                    key={i}
                    style={[dotStyles.dot, i === current ? dotStyles.dotActive : dotStyles.dotInactive]}
                />
            ))}
        </View>
    );
}

const dotStyles = StyleSheet.create({
    row: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 20, },
    dot: { height: 5, borderRadius: 3 },
    dotActive: { width: 20, backgroundColor: GOLD },
    dotInactive: { width: 5, backgroundColor: 'rgba(255,255,255,0.15)' },
});

export default function OnboardingHealthScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [connectedId, setConnectedId] = useState<string | null>(null);

    const headerFade = useRef(new Animated.Value(0)).current;
    const rowAnims = useRef(HEALTH_SOURCES.map(() => new Animated.Value(0))).current;
    const buttonFade = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.sequence([
            Animated.timing(headerFade, { toValue: 1, duration: 450, useNativeDriver: true }),
            Animated.stagger(
                70,
                rowAnims.map(anim =>
                    Animated.timing(anim, { toValue: 1, duration: 320, useNativeDriver: true })
                )
            ),
            Animated.timing(buttonFade, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]).start();
    }, []);

    function toggleConnect(id: string) {
        setConnectedId(prev => (prev === id ? null : id));
    }

    return (
        <View style={styles.container}>
            <GeometricBackground />
            {/* Ghost watermark */}
            <Image
                source={require('@/assets/images/powr_transparent.png')}
                style={styles.watermark}
                contentFit="contain"
            />

            {/* Back button */}
            <Pressable
                style={[styles.backButton, { top: insets.top + 14 }]}
                onPress={() => router.back()}
                hitSlop={24}
            >
                <Ionicons name="chevron-back" size={26} color="rgba(255,255,255,0.55)" />
            </Pressable>

            {/* Header */}
            <Animated.View style={[styles.header, { paddingTop: insets.top + 72, opacity: headerFade }]}>
                <Text style={styles.eyebrow}>CONNECT YOUR DATA</Text>
                <Text style={styles.headline}>
                    Connect your{'\n'}
                    <Text style={styles.headlineGold}>health data</Text>
                </Text>
                <Text style={styles.headerBody}>
                    Connect the apps you already use. Verified workouts earn 2× points.
                </Text>
            </Animated.View>

            {/* Source list */}
            <ScrollView
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
            >
                {HEALTH_SOURCES.map((source, i) => {
                    const isConnected = connectedId === source.id;
                    return (
                        <Animated.View
                            key={source.id}
                            style={{
                                opacity: rowAnims[i],
                                transform: [{
                                    translateY: rowAnims[i].interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [14, 0],
                                    }),
                                }],
                            }}
                        >
                            <Pressable
                                style={[styles.sourceRow, isConnected && styles.sourceRowConnected]}
                                onPress={() => toggleConnect(source.id)}
                            >
                                {/* Brand icon */}
                                <View style={styles.sourceIcon}>
                                    <BrandIcon id={source.id} />
                                </View>

                                {/* Info */}
                                <View style={styles.sourceInfo}>
                                    <View style={styles.sourceNameRow}>
                                        <Text style={styles.sourceName}>{source.name}</Text>
                                        {isConnected && (
                                            <View style={styles.pointsBadge}>
                                                <Text style={styles.pointsBadgeText}>2× PTS</Text>
                                            </View>
                                        )}
                                    </View>
                                </View>

                                {/* Connect / Connected pill */}
                                {isConnected ? (
                                    <View style={styles.connectedPill}>
                                        <MaterialCommunityIcons name="check" size={11} color={GOLD} style={{ marginRight: 3 }} />
                                        <Text style={[styles.pillLabel, { color: GOLD }]}>CONNECTED</Text>
                                    </View>
                                ) : (
                                    <View style={styles.connectPill}>
                                        <Text style={[styles.pillLabel, { color: GOLD }]}>CONNECT</Text>
                                    </View>
                                )}
                            </Pressable>
                        </Animated.View>
                    );
                })}
            </ScrollView>

            {/* Bottom */}
            <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom + 32, opacity: buttonFade }]}>
                <StepDots current={2} />

                <Pressable
                    style={styles.primaryButton}
                    onPress={() => router.push('/onboarding-achievement')}
                >
                    <Text style={styles.primaryLabel}>CONTINUE</Text>
                </Pressable>

                <Pressable
                    style={styles.skipButton}
                    onPress={() => router.push('/onboarding-achievement')}
                >
                    <Text style={styles.skipLabel}>Skip — connect later in settings</Text>
                </Pressable>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    backButton: {
        position: 'absolute',
        left: 16,
        zIndex: 20,
        padding: 4,
    },
    header: { paddingHorizontal: 24, marginBottom: 20 },
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
        marginBottom: 10,
    },
    headlineGold: { color: GOLD, fontWeight: '700' },
    headerBody: {
        color: 'rgba(255,255,255,0.38)',
        fontSize: 13,
        fontWeight: '300',
        lineHeight: 20,
    },
    list: { flex: 1 },
    listContent: { paddingHorizontal: 24, gap: 8, paddingBottom: 16 },
    sourceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 14,
        gap: 12,
    },
    sourceRowConnected: {
        borderColor: 'rgba(232,210,0,0.3)',
        backgroundColor: 'rgba(232,210,0,0.04)',
    },
    sourceIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.30)',
    },
    watermark: {
        position: 'absolute',
        width: 340,
        height: 340,
        top: -60,
        right: -80,
        opacity: 0.03,
    },
    sourceInfo: { flex: 1 },
    sourceNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 2,
    },
    sourceName: {
        color: '#F2F2F2',
        fontSize: 14,
        fontWeight: '500',
    },
    pointsBadge: {
        backgroundColor: 'rgba(232,210,0,0.12)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.25)',
        borderRadius: 4,
        paddingHorizontal: 5,
        paddingVertical: 2,
    },
    pointsBadgeText: {
        color: GOLD,
        fontSize: 8,
        fontWeight: '700',
        letterSpacing: 0.8,
    },
    connectPill: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.3)',
    },
    connectedPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.3)',
        backgroundColor: 'rgba(232,210,0,0.08)',
    },
    pillLabel: {
        fontSize: 9,
        fontWeight: '700',
        letterSpacing: 1.5,
    },
    bottom: { paddingHorizontal: 24 },
    primaryButton: {
        height: 52,
        borderRadius: 26,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    primaryLabel: {
        color: '#0a0a0a',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5,
    },
    skipButton: { alignItems: 'center', paddingVertical: 12 },
    skipLabel: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 12,
        fontWeight: '300',
        letterSpacing: 0.2,
    },
});

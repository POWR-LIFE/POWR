import { fontFamily } from '@/constants/tokens';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Image as RNImage, StyleSheet, Text, View } from 'react-native';

const GOLD = '#E8D200';
const APPLE_LOGO =
    'https://wjvvujnicwkruaeibttt.supabase.co/storage/v1/object/public/partner-logos/apple.png';

/**
 * The priming scene for the phone-health onboarding step: floating data chips
 * (steps / sleep / a verified workout) hovering around the connection itself —
 * platform medallion → gold data trail → POWR — with a +20 spark on the payoff.
 * No containing card: the pieces float straight on the screen background, in the
 * same visual language as the location/notification hero scenes. Plain Views +
 * icon fonts only, so jest render tests stay dependency-free.
 */
export default function HealthDataScene({
    platform,
    stepsToday,
    connected,
}: {
    platform: 'apple-health' | 'health-connect';
    stepsToday: number | null;
    connected: boolean;
}) {
    const isApple = platform === 'apple-health';
    return (
        <View style={styles.scene}>
            {/* Floating data chips — the things this connection starts counting */}
            <View style={[styles.chip, styles.chipSteps]}>
                <View style={styles.chipIcon}>
                    <Ionicons name="footsteps" size={13} color={GOLD} />
                </View>
                <View>
                    <Text style={styles.chipValue}>
                        {stepsToday != null ? stepsToday.toLocaleString() : '7,842'}
                    </Text>
                    <Text style={styles.chipLabel}>STEPS TODAY</Text>
                </View>
            </View>

            <View style={[styles.chip, styles.chipSleep]}>
                <View style={styles.chipIcon}>
                    <Ionicons name="moon" size={12} color="#9BB8FF" />
                </View>
                <View>
                    <Text style={styles.chipValue}>7h 20m</Text>
                    <Text style={styles.chipLabel}>SLEEP</Text>
                </View>
            </View>

            <View style={[styles.chip, styles.chipWorkout]}>
                <View style={styles.chipIcon}>
                    <MaterialCommunityIcons name="dumbbell" size={13} color={GOLD} />
                </View>
                <View>
                    <Text style={styles.chipValue}>Gym · 48 min</Text>
                    <Text style={styles.chipLabel}>WORKOUT</Text>
                </View>
                <View style={styles.verifiedTag}>
                    <Text style={styles.verifiedTagText}>2× PTS</Text>
                </View>
            </View>

            {/* The connection itself: platform → POWR */}
            <View style={styles.flowRow}>
                <View style={styles.platformIcon}>
                    {isApple ? (
                        <Image
                            source={{ uri: APPLE_LOGO }}
                            style={styles.platformLogo}
                            contentFit="contain"
                        />
                    ) : (
                        <MaterialCommunityIcons name="heart-pulse" size={26} color="#4285F4" />
                    )}
                </View>

                <View style={styles.flowDots}>
                    {[0, 1, 2, 3, 4].map(i => (
                        <View key={i} style={[styles.flowDot, { opacity: 0.25 + i * 0.17 }]} />
                    ))}
                </View>

                <View style={styles.powrWrap}>
                    <View style={styles.powrIcon}>
                        <RNImage
                            source={require('@/assets/images/ic_stat_powr_logo_black.png')}
                            style={styles.powrLogo}
                            resizeMode="contain"
                        />
                    </View>
                    <View style={styles.spark}>
                        {connected ? (
                            <MaterialCommunityIcons name="check" size={11} color="#0a0a0a" />
                        ) : (
                            <Text style={styles.sparkText}>+20</Text>
                        )}
                    </View>
                </View>
            </View>

            <Text style={styles.caption}>
                {connected
                    ? stepsToday != null
                        ? `${stepsToday.toLocaleString()} steps already counting`
                        : 'Connected — your data is flowing'
                    : isApple
                      ? 'Apple Watch + anything that writes to Apple Health'
                      : 'Google Fit, Galaxy & Pixel Watch & more'}
            </Text>
        </View>
    );
}

const FLOAT_SHADOW = {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
} as const;

const styles = StyleSheet.create({
    scene: {
        alignSelf: 'stretch',
        height: 252,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chip: {
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: 'rgba(24,24,24,0.97)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.09)',
        borderRadius: 14,
        paddingVertical: 8,
        paddingHorizontal: 11,
        ...FLOAT_SHADOW,
    },
    chipSteps: {
        top: 0,
        left: '4%',
        transform: [{ rotate: '-4deg' }],
    },
    chipSleep: {
        top: 24,
        right: '3%',
        transform: [{ rotate: '3deg' }],
    },
    chipWorkout: {
        bottom: 34,
        left: '8%',
        transform: [{ rotate: '2deg' }],
    },
    chipIcon: {
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: 'rgba(255,255,255,0.06)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    chipValue: {
        fontFamily: fontFamily.medium,
        fontSize: 13,
        color: '#F2F2F2',
    },
    chipLabel: {
        fontFamily: fontFamily.medium,
        fontSize: 7.5,
        letterSpacing: 1.2,
        color: 'rgba(255,255,255,0.35)',
        marginTop: 1,
    },
    verifiedTag: {
        marginLeft: 2,
        backgroundColor: 'rgba(232,210,0,0.14)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.3)',
        borderRadius: 6,
        paddingHorizontal: 5,
        paddingVertical: 2,
    },
    verifiedTagText: {
        fontFamily: fontFamily.bold,
        fontSize: 8,
        letterSpacing: 0.6,
        color: GOLD,
    },
    flowRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 6,
    },
    platformIcon: {
        width: 54,
        height: 54,
        borderRadius: 27,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        ...FLOAT_SHADOW,
    },
    platformLogo: {
        width: 28,
        height: 28,
    },
    flowDots: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    flowDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: GOLD,
    },
    powrWrap: {
        // Un-clipped wrapper so the spark can overhang the icon
    },
    powrIcon: {
        width: 54,
        height: 54,
        borderRadius: 15,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
        ...FLOAT_SHADOW,
    },
    powrLogo: {
        width: 30,
        height: 30,
        tintColor: '#0a0a0a',
    },
    spark: {
        position: 'absolute',
        top: -9,
        right: -9,
        minWidth: 24,
        height: 24,
        borderRadius: 12,
        paddingHorizontal: 4,
        backgroundColor: GOLD,
        borderWidth: 2,
        borderColor: '#0d0d0d',
        alignItems: 'center',
        justifyContent: 'center',
    },
    sparkText: {
        fontFamily: fontFamily.bold,
        fontSize: 9,
        color: '#0a0a0a',
        letterSpacing: 0.2,
    },
    caption: {
        position: 'absolute',
        bottom: 0,
        left: 24,
        right: 24,
        textAlign: 'center',
        fontFamily: fontFamily.light,
        fontSize: 11.5,
        color: 'rgba(255,255,255,0.35)',
    },
});

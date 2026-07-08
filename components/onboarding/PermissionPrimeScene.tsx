import { fontFamily } from '@/constants/tokens';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import PermissionPrimeMock, { PermissionMockKind } from './PermissionPrimeMock';
import PowrPushBanner from './PowrPushBanner';

const GOLD = '#E8D200';

/**
 * The full priming scene for the permission screens: a POWR-styled hero panel
 * with a push notification previewing the payoff, and the OS permission
 * dialog mock layered on top — so the system-white dialog reads as "this is
 * about to pop over the app", not as off-brand app UI.
 *
 * Each screen gets the hero that tells ITS story (they'd otherwise read as
 * the same screen twice): foreground = the app's map unlocking; background =
 * a lock screen receiving the check-in push while the app is closed;
 * notifications = the payday push itself.
 */

/** Foreground hero: the map this permission unlocks. */
function MapHero() {
    return (
        <View style={styles.hero}>
            {/* Street grid */}
            <View style={[styles.streetH, { top: '32%' }]} />
            <View style={[styles.streetH, { top: '68%' }]} />
            <View style={[styles.streetV, { left: '22%' }]} />
            <View style={[styles.streetV, { left: '74%' }]} />
            <View style={styles.streetDiagonal} />

            {/* Other spots on the map */}
            <View style={[styles.poiDot, { top: '30%', left: '12%' }]} />
            <View style={[styles.poiDot, { top: '24%', left: '85%' }]} />
            <View style={[styles.poiDot, { top: '80%', left: '32%' }]} />
            <View style={[styles.poiDot, styles.poiDotGold, { top: '38%', left: '64%' }]} />

            {/* The geofence around your gym */}
            <View style={styles.gymCluster}>
                <View style={styles.geofenceRing}>
                    <View style={styles.pinGlow}>
                        <View style={styles.pinDot} />
                    </View>
                    <View style={styles.gymChip}>
                        <Text style={styles.gymChipLabel}>YOUR GYM</Text>
                    </View>
                </View>
            </View>

            {/* The push this permission unlocks */}
            <View style={styles.banner}>
                <PowrPushBanner title="Detecting Partners nearby" body="Automatic check-ins enabled." />
            </View>
        </View>
    );
}

/**
 * Background hero: a locked phone getting the check-in push — the "app is
 * closed and it still worked" moment that "Always" access buys.
 */
function LockScreenHero() {
    return (
        <View style={[styles.hero, styles.lockScreen]}>
            <Ionicons name="lock-closed" size={12} color="rgba(255,255,255,0.35)" />
            <Text style={styles.lockClock}>17:03</Text>
            <Text style={styles.lockDate}>Tuesday 7 July</Text>
            <View style={styles.lockBanner}>
                <PowrPushBanner title="You’re in." body="Arrival detected — session started." />
            </View>
        </View>
    );
}

/** Notifications hero: the single push that makes the case — points landing. */
function NotificationHero() {
    return (
        <View style={[styles.hero, styles.notifHero]}>
            <PowrPushBanner title="Session recorded" body="48 min at your gym — +50 POWR banked." />
        </View>
    );
}

export default function PermissionPrimeScene({ kind }: { kind: PermissionMockKind }) {
    return (
        <View style={styles.scene}>
            {kind === 'location-foreground' ? (
                <MapHero />
            ) : kind === 'location-background' ? (
                <LockScreenHero />
            ) : (
                <NotificationHero />
            )}

            {/* The OS dialog, popping over the app */}
            <View style={styles.dialog}>
                <PermissionPrimeMock kind={kind} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    scene: {
        alignSelf: 'stretch',
    },
    hero: {
        height: 190,
        borderRadius: 20,
        backgroundColor: '#0f0f0f',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.07)',
        overflow: 'hidden',
    },
    lockScreen: {
        alignItems: 'center',
        paddingTop: 18,
    },
    lockClock: {
        fontFamily: fontFamily.extraLight,
        fontSize: 38,
        letterSpacing: 1,
        color: '#F2F2F2',
        marginTop: 2,
        lineHeight: 42,
    },
    lockDate: {
        fontFamily: fontFamily.light,
        fontSize: 11,
        color: 'rgba(255,255,255,0.35)',
        marginTop: 1,
    },
    lockBanner: {
        alignSelf: 'stretch',
        marginTop: 12,
        paddingHorizontal: 10,
    },
    notifHero: {
        height: 130,
        justifyContent: 'center',
        paddingHorizontal: 10,
    },
    streetH: {
        position: 'absolute',
        left: -8,
        right: -8,
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.055)',
    },
    streetV: {
        position: 'absolute',
        top: -8,
        bottom: -8,
        width: 1,
        backgroundColor: 'rgba(255,255,255,0.055)',
    },
    streetDiagonal: {
        position: 'absolute',
        left: '-12%',
        right: '-12%',
        top: '54%',
        height: 2,
        backgroundColor: 'rgba(255,255,255,0.07)',
        transform: [{ rotate: '16deg' }],
    },
    poiDot: {
        position: 'absolute',
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.16)',
    },
    poiDotGold: {
        backgroundColor: 'rgba(232,210,0,0.4)',
    },
    gymCluster: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 72,
        alignItems: 'center',
    },
    geofenceRing: {
        width: 88,
        height: 88,
        borderRadius: 44,
        borderWidth: 1.5,
        borderColor: 'rgba(232,210,0,0.5)',
        backgroundColor: 'rgba(232,210,0,0.05)',
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ translateX: 34 }],
    },
    pinGlow: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: 'rgba(232,210,0,0.22)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    pinDot: {
        width: 9,
        height: 9,
        borderRadius: 5,
        backgroundColor: GOLD,
    },
    gymChip: {
        marginTop: 5,
        backgroundColor: 'rgba(10,10,10,0.8)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.25)',
        borderRadius: 100,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    gymChipLabel: {
        fontFamily: fontFamily.medium,
        fontSize: 8,
        letterSpacing: 1.2,
        color: 'rgba(255,255,255,0.65)',
    },
    banner: {
        position: 'absolute',
        top: 10,
        left: 10,
        right: 10,
    },
    dialog: {
        marginTop: -26,
    },
});

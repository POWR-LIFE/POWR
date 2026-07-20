import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { fontFamily } from '@/constants/tokens';

const GOLD = '#E8D200';
const CARD_BG = '#141414';
const BORDER = '#222222';

/**
 * A preview of the notifications the user is opting into, styled exactly like
 * the in-app notification feed (dark card, gold icon bubble, Outfit type) —
 * POWR's own design language, not the OS's. Shown on the notification priming
 * surfaces so "enable alerts" is a picture of the payoff, not an abstract ask.
 */

const PREVIEWS = [
    {
        icon: 'flame',
        title: 'Session recorded',
        body: '48 min at your gym — +50 POWR banked.',
        time: 'now',
        unread: true,
    },
    {
        icon: 'gift',
        title: 'Reward drop nearby',
        body: 'A new reward just unlocked around the corner.',
        time: '2h',
        unread: true,
    },
    {
        icon: 'time-outline',
        title: 'Streak at risk',
        body: 'One session today keeps your 6-day streak alive.',
        time: '9h',
        unread: false,
    },
] as const;

export default function NotificationPreviewStack() {
    return (
        <View style={styles.card}>
            {PREVIEWS.map((n, i) => (
                <View key={n.title}>
                    {i > 0 && <View style={styles.divider} />}
                    <View style={styles.row}>
                        <View style={styles.iconBubble}>
                            <Ionicons name={n.icon} size={18} color={GOLD} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.title} numberOfLines={1}>{n.title}</Text>
                            <Text style={styles.body} numberOfLines={2}>{n.body}</Text>
                        </View>
                        <View style={styles.meta}>
                            <Text style={styles.time}>{n.time}</Text>
                            {n.unread && <View style={styles.unreadDot} />}
                        </View>
                    </View>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        alignSelf: 'stretch',
        backgroundColor: CARD_BG,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: BORDER,
        overflow: 'hidden',
    },
    divider: {
        height: 1,
        backgroundColor: BORDER,
        marginLeft: 62,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
    },
    iconBubble: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(232,210,0,0.10)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontFamily: fontFamily.medium,
        fontSize: 14,
        color: '#F2F2F2',
    },
    body: {
        fontFamily: fontFamily.light,
        fontSize: 12.5,
        color: 'rgba(255,255,255,0.45)',
        marginTop: 2,
        lineHeight: 17,
    },
    meta: {
        alignItems: 'flex-end',
        gap: 5,
    },
    time: {
        fontFamily: fontFamily.regular,
        fontSize: 11,
        color: 'rgba(255,255,255,0.28)',
    },
    unreadDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: GOLD,
    },
});

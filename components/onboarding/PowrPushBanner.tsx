import { Image, StyleSheet, Text, View } from 'react-native';
import { fontFamily } from '@/constants/tokens';

const GOLD = '#E8D200';

/**
 * A POWR push-notification lookalike — gold app icon, app name, timestamp,
 * title + body — used on the priming surfaces to make the payoff of a
 * permission concrete ("this is what your phone will show you").
 */
export default function PowrPushBanner({
    title,
    body,
    time = 'now',
}: {
    title: string;
    body: string;
    time?: string;
}) {
    return (
        <View style={styles.banner}>
            <View style={styles.appIcon}>
                <Image
                    source={require('@/assets/images/ic_stat_powr_logo_black.png')}
                    style={styles.appIconImage}
                    resizeMode="contain"
                />
            </View>
            <View style={{ flex: 1 }}>
                <View style={styles.metaRow}>
                    <Text style={styles.appName}>POWR</Text>
                    <Text style={styles.time}>· {time}</Text>
                </View>
                <Text style={styles.title} numberOfLines={1}>{title}</Text>
                <Text style={styles.body} numberOfLines={1}>{body}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: 'rgba(24,24,24,0.97)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.09)',
        borderRadius: 14,
        paddingVertical: 9,
        paddingHorizontal: 11,
        shadowColor: '#000',
        shadowOpacity: 0.45,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
    },
    appIcon: {
        width: 34,
        height: 34,
        borderRadius: 9,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
    },
    appIconImage: {
        width: 20,
        height: 20,
        tintColor: '#0a0a0a',
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginBottom: 1,
    },
    appName: {
        fontFamily: fontFamily.semiBold,
        fontSize: 9,
        letterSpacing: 1.2,
        color: 'rgba(255,255,255,0.45)',
    },
    time: {
        fontFamily: fontFamily.regular,
        fontSize: 9,
        color: 'rgba(255,255,255,0.3)',
    },
    title: {
        fontFamily: fontFamily.medium,
        fontSize: 13,
        color: '#F2F2F2',
    },
    body: {
        fontFamily: fontFamily.light,
        fontSize: 11.5,
        color: 'rgba(255,255,255,0.5)',
        marginTop: 1,
    },
});

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { viaPhoneCopy } from '@/lib/health/viaPhone';

const GOLD = '#E8D200';
const GREEN = '#4ade80';

type Props = {
    /** The paused wearable that was tapped (provider id + display name); null hides the sheet. */
    brand: { id: string; name: string } | null;
    /** The phone health store (Apple Health / Health Connect) is already connected. */
    phoneConnected: boolean;
    busy?: boolean;
    onConnectPhone: () => void;
    onClose: () => void;
};

/**
 * Shown when a member taps a wearable whose direct link is paused — Garmin
 * (see `HealthProviderMeta.paused`), or any Terra brand while the Terra pause
 * switch is on (lib/health/terraPause). The brand's own app still writes
 * workouts, steps and sleep to Apple Health / Health Connect, so the sheet
 * connects the phone store and points at the one setting in that app that
 * shares into it — the same two-step shape as the Samsung Health sheet in
 * onboarding. Words per brand: lib/health/viaPhone.
 */
export default function ViaPhoneSheet({ brand, phoneConnected, busy, onConnectPhone, onClose }: Props) {
    const insets = useSafeAreaInsets();
    const platform = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web';
    // Web has no phone health store to connect (getNativeProviderId() is null),
    // so it gets the explanation without a connect action.
    const web = platform === 'web';
    const store = platform === 'android' ? 'Health Connect' : 'Apple Health';
    const copy = brand ? viaPhoneCopy(brand.id, brand.name, platform) : null;

    return (
        <Modal visible={!!brand} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
                {copy && <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
                    <View style={styles.handle} />
                    <View style={styles.iconRow}>
                        <View style={styles.iconWrap}>
                            <MaterialCommunityIcons name="watch-variant" size={24} color={GOLD} />
                        </View>
                    </View>
                    <Text style={styles.title}>{copy.title}</Text>
                    <Text style={styles.reassurance}>{copy.body}</Text>
                    {!web && <View style={styles.steps}>
                        <View style={styles.stepRow}>
                            <Ionicons
                                name={phoneConnected ? 'checkmark-circle' : 'link'}
                                size={16}
                                color={phoneConnected ? GREEN : GOLD}
                            />
                            <View style={styles.stepInfo}>
                                <Text style={styles.stepTitle}>1. Connect {store}</Text>
                                <Text style={styles.stepDesc}>
                                    {phoneConnected ? 'Connected' : `POWR reads your ${brand!.name} data from it`}
                                </Text>
                            </View>
                        </View>
                        {copy.step2 && (
                            <View style={styles.stepRow}>
                                <Ionicons name="toggle" size={16} color={GOLD} />
                                <View style={styles.stepInfo}>
                                    <Text style={styles.stepTitle}>{copy.step2.title}</Text>
                                    <Text style={styles.stepDesc}>{copy.step2.desc}</Text>
                                </View>
                            </View>
                        )}
                        {copy.note && <Text style={styles.note}>{copy.note}</Text>}
                    </View>}
                    {web || phoneConnected ? (
                        <Pressable
                            style={({ pressed }) => [styles.connectBtn, pressed && { opacity: 0.8 }]}
                            onPress={onClose}
                        >
                            <Text style={styles.connectBtnText}>{web ? 'GOT IT' : 'DONE'}</Text>
                        </Pressable>
                    ) : (
                        <>
                            <Pressable
                                style={({ pressed }) => [styles.connectBtn, (pressed || busy) && { opacity: 0.8 }]}
                                onPress={onConnectPhone}
                                disabled={busy}
                            >
                                <Text style={styles.connectBtnText}>
                                    {busy ? 'CONNECTING…' : `CONNECT ${store.toUpperCase()}`}
                                </Text>
                            </Pressable>
                            <Pressable style={styles.skipBtn} onPress={onClose}>
                                <Text style={styles.skipBtnText}>Not now</Text>
                            </Pressable>
                        </>
                    )}
                </View>}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: '#121212',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 24,
        paddingTop: 12,
        gap: 16,
    },
    handle: {
        width: 40,
        height: 4,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 8,
    },
    iconRow: {
        alignItems: 'center',
    },
    iconWrap: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(232,210,0,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.2)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: 22,
        fontWeight: '200',
        color: '#F2F2F2',
        letterSpacing: -0.5,
        textAlign: 'center',
    },
    reassurance: {
        fontSize: 12,
        fontWeight: '300',
        color: 'rgba(255,255,255,0.3)',
        textAlign: 'center',
        lineHeight: 18,
    },
    steps: {
        gap: 14,
    },
    stepRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingVertical: 2,
    },
    stepInfo: {
        flex: 1,
        gap: 2,
    },
    stepTitle: {
        fontSize: 14,
        fontWeight: '400',
        color: '#F2F2F2',
    },
    stepDesc: {
        fontSize: 11,
        fontWeight: '300',
        color: 'rgba(255,255,255,0.4)',
        lineHeight: 16,
    },
    note: {
        fontSize: 11,
        fontWeight: '300',
        color: 'rgba(255,255,255,0.4)',
        lineHeight: 16,
        paddingLeft: 28,
    },
    connectBtn: {
        height: 48,
        borderRadius: 24,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
    },
    connectBtnText: {
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5,
        color: '#0a0a0a',
    },
    skipBtn: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    skipBtnText: {
        fontSize: 13,
        fontWeight: '300',
        color: 'rgba(255,255,255,0.3)',
    },
});

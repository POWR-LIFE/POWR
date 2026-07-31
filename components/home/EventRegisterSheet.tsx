import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { joinLiveEvent, type LiveEvent } from '@/lib/api/liveEvents';
import { eventDateRange } from '@/lib/liveEventDisplay';

const GOLD = '#E8D200';
const TEXT_PRIMARY = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';

function rankLabel(rank: number): string {
    return rank === 1 ? '1ST' : rank === 2 ? '2ND' : rank === 3 ? '3RD' : `${rank}TH`;
}

interface EventRegisterSheetProps {
    event: LiveEvent;
    visible: boolean;
    onClose: () => void;
}

/**
 * The registration half of the home event card: the pitch (dates, prizes,
 * how scoring works) and one JOIN button. Deliberately self-contained —
 * joining invalidates the shared ['liveEvent'] cache, which is what hides
 * the home card, then lands the user on the League tab where the event
 * lives from here on.
 */
export function EventRegisterSheet({ event, visible, onClose }: EventRegisterSheetProps) {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const queryClient = useQueryClient();

    const joinMutation = useMutation({
        mutationFn: () => joinLiveEvent(event.id),
        onSuccess: (viewer) => {
            if (!viewer?.joined) {
                Alert.alert('Couldn’t register', 'Something went wrong — please try again.');
                return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            void queryClient.invalidateQueries({ queryKey: ['liveEvent'] });
            onClose();
            router.push('/(tabs)/league');
        },
    });

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
                <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
                    <View style={styles.handle} />

                    <Text style={styles.eyebrow}>LIVE EVENT</Text>
                    <Text style={styles.name}>{event.name}</Text>
                    <Text style={styles.dates}>{eventDateRange(event)}</Text>

                    {event.promo_headline ? (
                        <Text style={styles.headline}>{event.promo_headline}</Text>
                    ) : null}

                    {event.prizes.length > 0 && (
                        <View style={styles.prizeBlock}>
                            {event.prizes.slice(0, 3).map((p) => (
                                <View key={p.rank} style={styles.prizeRow}>
                                    <Text style={styles.prizeRank}>{rankLabel(p.rank)}</Text>
                                    <Text style={styles.prizeLabel} numberOfLines={1}>{p.label}</Text>
                                </View>
                            ))}
                        </View>
                    )}

                    <Text style={styles.note}>
                        Everyone starts from zero — only points earned during the event window count.
                    </Text>

                    <Pressable
                        style={({ pressed }) => [styles.joinBtn, (pressed || joinMutation.isPending) && { opacity: 0.85 }]}
                        disabled={joinMutation.isPending}
                        onPress={() => {
                            Haptics.selectionAsync().catch(() => {});
                            joinMutation.mutate();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Register for the event"
                    >
                        <Text style={styles.joinBtnText}>
                            {joinMutation.isPending ? 'REGISTERING…' : 'COUNT ME IN'}
                        </Text>
                    </Pressable>

                    <Pressable style={styles.skipButton} onPress={onClose} accessibilityRole="button">
                        <Text style={styles.skipLabel}>Not now</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    sheet: {
        backgroundColor: '#141414',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderWidth: 1,
        borderColor: '#222222',
        paddingHorizontal: 24,
        paddingTop: 12,
    },
    handle: {
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.18)',
        marginBottom: 20,
    },
    eyebrow: { fontSize: 9, fontWeight: '800', color: GOLD, opacity: 0.7, letterSpacing: 2.5 },
    name: { fontSize: 28, fontWeight: '200', color: TEXT_PRIMARY, letterSpacing: -0.5, marginTop: 4 },
    dates: { fontSize: 13, fontWeight: '300', color: DIM, marginTop: 2 },
    headline: { fontSize: 14, fontWeight: '300', color: TEXT_PRIMARY, marginTop: 14, lineHeight: 20 },

    prizeBlock: { marginTop: 16, gap: 6 },
    prizeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    prizeRank: { width: 32, fontSize: 9, fontWeight: '700', color: GOLD, opacity: 0.7, letterSpacing: 1 },
    prizeLabel: { flex: 1, fontSize: 13, fontWeight: '300', color: DIM },

    note: { fontSize: 11, fontWeight: '400', color: DIM, marginTop: 16, lineHeight: 16 },

    joinBtn: {
        marginTop: 20,
        borderRadius: 100,
        backgroundColor: GOLD,
        paddingVertical: 14,
        alignItems: 'center',
    },
    joinBtnText: { fontSize: 12, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },
    skipButton: { alignItems: 'center', paddingVertical: 14 },
    skipLabel: { fontSize: 13, fontWeight: '400', color: DIM },
});

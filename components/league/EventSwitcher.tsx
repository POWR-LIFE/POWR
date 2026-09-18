import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { eventStatusLine } from '@/components/league/EventHeaderCard';
import { useSheetDragDismiss } from '@/hooks/useSheetDragDismiss';
import type { EventLeaderboard, LiveEvent } from '@/lib/api/liveEvents';
import { storageImage } from '@/lib/storageImage';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.5)';
const CARD_BG = '#141414';
const BORDER = '#222222';

/**
 * Which event the League tab is showing, as one quiet line under the screen
 * title — and the way to change it. Deliberately NOT a row of pills: the tab
 * already has LEADERBOARD | EVENT beneath this, and a second tab-shaped row is
 * the thing this page has been told off for before. With a single event there
 * is nothing to switch, so the caller doesn't render it at all.
 */
export function EventSwitcherLine({ event, onPress }: { event: LiveEvent; onPress: () => void }) {
    const venue = event.venue?.name;
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.line, pressed && { opacity: 0.6 }]}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 16 }}
            accessibilityRole="button"
            accessibilityLabel={`Showing ${event.name}${venue ? ` at ${venue}` : ''}. Tap to switch event.`}
        >
            {!!venue && <Text style={styles.lineVenue} numberOfLines={1}>{venue.toUpperCase()}</Text>}
            {!!venue && <View style={styles.lineDot} />}
            <Text style={styles.lineName} numberOfLines={1}>{event.name}</Text>
            <Ionicons name="chevron-down" size={12} color={GOLD} />
        </Pressable>
    );
}

/**
 * The one fact about the viewer's place in this event, short enough for a row.
 * Someone in several events needs the rows to tell them apart, so a live event
 * carries the rank — read from whatever the board query last cached, never
 * fetched here: the sheet must not start a poll per event.
 */
function standing(event: LiveEvent, board?: EventLeaderboard | null): { label: string; filled: boolean } {
    if (event.viewer.joined) {
        const rank = event.status === 'live' && !event.is_locked ? board?.viewer.rank : undefined;
        return { label: typeof rank === 'number' ? `RANK ${rank}` : 'YOU’RE IN', filled: false };
    }
    if (event.status === 'scheduled' || (event.status === 'live' && !event.is_locked)) {
        return { label: 'REGISTER', filled: true };
    }
    return { label: 'VIEW', filled: false };
}

export function EventSwitcherSheet({
    visible,
    onClose,
    events,
    activeId,
    onSelect,
}: {
    visible: boolean;
    onClose: () => void;
    events: LiveEvent[];
    activeId: string | null;
    onSelect: (event: LiveEvent) => void;
}) {
    const queryClient = useQueryClient();
    const { dragY, backdropOpacity, panHandlers, dismiss } = useSheetDragDismiss(onClose, visible);

    // Keep the early return — see LedgerFilterSheet: a lingering absoluteFill
    // backdrop silently eats every touch on the screen behind it.
    if (!visible) return null;

    const choose = (event: LiveEvent) => {
        void Haptics.selectionAsync();
        onSelect(event);
        dismiss();
    };

    return (
        <Modal visible transparent animationType="none" onRequestClose={dismiss}>
            <View style={styles.backdrop}>
                <Animated.View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, styles.scrim, { opacity: backdropOpacity }]}
                />
                <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
                <Animated.View style={[styles.sheet, { transform: [{ translateY: dragY }] }]}>
                    <View style={styles.dragHeader} {...panHandlers}>
                        <View style={styles.handle} />
                        <Text style={styles.eyebrow}>LIVE EVENTS</Text>
                        <Text style={styles.headline}>Which board?</Text>
                    </View>

                    {events.map(event => {
                        const isActive = event.id === activeId;
                        const logo = storageImage(event.venue?.logo_url, 256, 256);
                        const chip = !!logo && event.venue?.logo_bg !== 'dark';
                        const pill = standing(
                            event,
                            queryClient.getQueryData<EventLeaderboard | null>(['liveEventBoard', event.id, null]),
                        );
                        return (
                            <Pressable
                                key={event.id}
                                onPress={() => choose(event)}
                                accessibilityRole="button"
                                accessibilityState={{ selected: isActive }}
                                accessibilityLabel={`${event.name}. ${eventStatusLine(event)}`}
                                style={({ pressed }) => [
                                    styles.row,
                                    isActive && styles.rowActive,
                                    pressed && { opacity: 0.6 },
                                ]}
                            >
                                <View style={[styles.logoTile, chip && styles.logoTileChip]}>
                                    {logo ? (
                                        <ExpoImage source={{ uri: logo }} style={styles.logo} contentFit="contain" />
                                    ) : (
                                        <Ionicons name="trophy-outline" size={18} color={DIM} />
                                    )}
                                </View>
                                <View style={styles.rowBody}>
                                    <Text style={styles.rowName} numberOfLines={1}>{event.name}</Text>
                                    <View style={styles.rowStatusRow}>
                                        {event.status === 'live' && !event.is_locked && <View style={styles.liveDot} />}
                                        <Text style={styles.rowStatus} numberOfLines={1}>
                                            {eventStatusLine(event).split(' · ')[0]}
                                        </Text>
                                    </View>
                                </View>
                                <View style={[styles.pill, pill.filled && styles.pillFilled]}>
                                    <Text style={[styles.pillText, pill.filled && styles.pillTextFilled]}>
                                        {pill.label}
                                    </Text>
                                </View>
                            </Pressable>
                        );
                    })}

                    <Pressable
                        style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.5 }]}
                        onPress={dismiss}
                        hitSlop={{ top: 8, bottom: 8, left: 24, right: 24 }}
                        accessibilityRole="button"
                        accessibilityLabel="Close"
                    >
                        <Text style={styles.closeLabel}>Close</Text>
                    </Pressable>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    line: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 7,
        marginTop: 2,
        maxWidth: '100%',
    },
    lineVenue: { fontSize: 10, fontWeight: '800', letterSpacing: 2, color: GOLD },
    lineDot: { width: 2.5, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
    lineName: { fontSize: 12, fontWeight: '300', color: 'rgba(255,255,255,0.75)', flexShrink: 1 },

    backdrop: { flex: 1, justifyContent: 'flex-end' },
    scrim: { backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
        backgroundColor: CARD_BG,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: BORDER,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: Platform.OS === 'ios' ? 40 : 28,
        gap: 10,
    },
    dragHeader: { alignSelf: 'stretch', alignItems: 'center' },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.15)',
        marginBottom: 22,
    },
    eyebrow: {
        color: 'rgba(255,255,255,0.22)',
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 2.5,
        marginBottom: 10,
    },
    headline: {
        color: TEXT,
        fontSize: 22,
        fontWeight: '200',
        letterSpacing: -0.5,
        lineHeight: 28,
        marginBottom: 8,
    },

    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: 'rgba(255,255,255,0.02)',
    },
    rowActive: { borderColor: 'rgba(232,210,0,0.55)', backgroundColor: 'rgba(232,210,0,0.06)' },
    logoTile: {
        width: 64,
        height: 44,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a0a0a',
        paddingHorizontal: 8,
    },
    logoTileChip: { backgroundColor: '#FFFFFF' },
    logo: { width: '100%', height: 26 },
    rowBody: { flex: 1, gap: 4 },
    rowName: { fontSize: 16, fontWeight: '300', color: TEXT, letterSpacing: -0.2 },
    rowStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    liveDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: GOLD },
    rowStatus: { fontSize: 11, fontWeight: '400', color: DIM, flexShrink: 1 },
    pill: {
        borderRadius: 100,
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.6)',
        paddingHorizontal: 11,
        paddingVertical: 6,
    },
    pillFilled: { backgroundColor: GOLD, borderColor: GOLD },
    pillText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, color: GOLD },
    pillTextFilled: { color: '#0a0a0a' },

    closeButton: { alignSelf: 'center', marginTop: 8, paddingVertical: 6 },
    closeLabel: { fontSize: 13, fontWeight: '400', color: DIM },
});

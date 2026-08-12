import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EventLockup } from '@/components/events/EventLockup';
import type { LiveEvent } from '@/lib/api/liveEvents';
import { eventDateRange, lastDayOf } from '@/lib/liveEventDisplay';

const GOLD = '#E8D200';
const CARD_BG = 'rgba(40,40,40,0.85)';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.5)';
const GREEN = '#4ade80';

function statusLine(event: LiveEvent): string {
    if (event.status === 'scheduled') {
        const days = Math.max(
            0,
            Math.ceil((new Date(event.window_start_at).getTime() - Date.now()) / 86_400_000),
        );
        const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
        return `Starts ${when} · only points earned that week count`;
    }
    if (event.status === 'live' && !event.is_locked) {
        return `Live now — ends ${lastDayOf(event.window_end_at)}`;
    }
    if (event.is_locked && !event.revealed_at) {
        return 'Scores are locked 🔒 — winners announced in person';
    }
    return 'Winners announced';
}

function rankLabel(rank: number): string {
    return rank === 1 ? '1ST' : rank === 2 ? '2ND' : rank === 3 ? '3RD' : `${rank}TH`;
}

/**
 * What the event IS: identity, window, where it's up to, what's on the line.
 * Deliberately one job — the ticket block below it owns getting you onto the
 * board, and the board owns the scores. The old EventInviteCard did all three
 * in one box, which left the entry gate ranked ninth on a surface where it is
 * the whole mechanic.
 *
 * The JOIN CTA lives here rather than on the ticket because until you're
 * registered there is no ticket to show — Home is the primary registration
 * surface, but a per-event share link or QR can land someone here first.
 * The button doesn't join directly: it opens the shared EventRegisterFlow
 * (confirm → rules/QR/booking), so there is exactly one join path in the app.
 */
export function EventHeaderCard({
    event,
    onRegister,
}: {
    event: LiveEvent;
    onRegister: () => void;
}) {
    const canJoin =
        event.scope === 'opt_in' &&
        event.viewer.eligible &&
        !event.viewer.joined &&
        !event.viewer.disqualified &&
        (event.status === 'scheduled' || event.status === 'live');

    return (
        <View style={styles.card}>
            <EventLockup event={event} />

            {/* logo_only: the lockup IS the identity (the name still carries the
                register sheet, the boards and the a11y label). */}
            {!event.logo_only && <Text style={styles.name}>{event.name}</Text>}

            <Text style={styles.dates}>{eventDateRange(event)}</Text>
            <Text style={styles.statusLine}>{statusLine(event)}</Text>

            {event.prizes.length > 0 && (
                <View style={styles.prizeBlock}>
                    {event.prizes.slice(0, 3).map(p => (
                        <View key={p.rank} style={styles.prizeRow}>
                            <Text style={styles.prizeRank}>{rankLabel(p.rank)}</Text>
                            <Text style={styles.prizeLabel} numberOfLines={1}>
                                {p.label}
                            </Text>
                        </View>
                    ))}
                </View>
            )}

            {canJoin && (
                <Pressable
                    style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]}
                    onPress={() => {
                        Haptics.selectionAsync();
                        onRegister();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Register for ${event.name}`}
                >
                    <Text style={styles.joinBtnText}>JOIN THE WEEK</Text>
                </Pressable>
            )}
            {event.viewer.joined && (
                <Text style={styles.joinedText}>You’re in — every point you earn that week counts</Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 14,
        marginTop: 8,
        borderRadius: 18,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        paddingHorizontal: 18,
        paddingVertical: 16,
        gap: 4,
    },
    name: { fontSize: 24, fontWeight: '200', color: TEXT, letterSpacing: -0.5, marginTop: 10 },
    dates: { fontSize: 12, fontWeight: '300', color: DIM },
    statusLine: { fontSize: 11, fontWeight: '400', color: GOLD, marginTop: 4 },

    prizeBlock: { marginTop: 12, gap: 5 },
    prizeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    prizeRank: { width: 30, fontSize: 9, fontWeight: '700', color: GOLD, opacity: 0.7, letterSpacing: 1 },
    prizeLabel: { flex: 1, fontSize: 12, fontWeight: '300', color: DIM },

    joinBtn: {
        marginTop: 14,
        borderRadius: 100,
        backgroundColor: GOLD,
        paddingVertical: 11,
        alignItems: 'center',
    },
    joinBtnText: { fontSize: 11, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },
    joinedText: { fontSize: 11, fontWeight: '300', color: GREEN, marginTop: 12 },
});

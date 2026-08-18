import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EventLockup } from '@/components/events/EventLockup';
import { EventPrizeList } from '@/components/events/EventPrizeList';
import { RewardHeroMedia } from '@/components/rewards/RewardHeroMedia';
import type { LiveEvent } from '@/lib/api/liveEvents';
import { eventDateRange, isVideoUrl, lastDayOf } from '@/lib/liveEventDisplay';

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

    // Same source and same split as the home card: promo_media_url is one field
    // that may hold either a video or a still, so whichever it is takes the
    // background and the other stays null.
    const media = event.promo_media_url;
    const videoUrl = isVideoUrl(media) ? media : null;
    const imageUrl = videoUrl ? null : media;

    return (
        <View style={styles.card}>
            {media && (
                <>
                    <RewardHeroMedia
                        videoUrl={videoUrl}
                        imageUrl={imageUrl}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                    />

                    {/* Lightest at the top where the lockup sits, heaviest over
                        the dates/prizes/CTA below — this card is far more
                        text-dense than the home hero, so the bottom needs more
                        scrim than home's does to stay legible over bright video. */}
                    <LinearGradient
                        colors={['rgba(10,10,10,0.3)', 'rgba(10,10,10,0.55)', 'rgba(10,10,10,0.88)']}
                        locations={[0, 0.45, 1]}
                        style={StyleSheet.absoluteFillObject}
                    />
                </>
            )}

            <EventLockup event={event} />

            {/* logo_only: the lockup IS the identity (the name still carries the
                register sheet, the boards and the a11y label). */}
            {!event.logo_only && <Text style={styles.name}>{event.name}</Text>}

            <Text style={styles.dates}>{eventDateRange(event)}</Text>
            <Text style={styles.statusLine}>{statusLine(event)}</Text>

            <EventPrizeList prizes={event.prizes} size="card" />

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
        // Stays visible when the event has no promo media, and is what shows if
        // the video fails — promo_media_url being a video means there is no
        // poster still to fall back to.
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        // Required now the background is a full-bleed video: without it the
        // media paints past the 18px radius and squares off the card corners.
        overflow: 'hidden',
        paddingHorizontal: 18,
        paddingVertical: 16,
        gap: 4,
    },
    name: { fontSize: 24, fontWeight: '200', color: TEXT, letterSpacing: -0.5, marginTop: 10 },
    dates: { fontSize: 12, fontWeight: '300', color: DIM },
    statusLine: { fontSize: 11, fontWeight: '400', color: GOLD, marginTop: 4 },

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

import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EventLockup } from '@/components/events/EventLockup';
import { EventRegisterSheet } from '@/components/home/EventRegisterSheet';
import { RewardHeroMedia } from '@/components/rewards/RewardHeroMedia';
import {
    fetchActiveLiveEvent,
    fetchEventLeaderboard,
    type EventLeaderboard,
    type LiveEvent,
} from '@/lib/api/liveEvents';
import { eventStatusChip, isVideoUrl, shortDate } from '@/lib/liveEventDisplay';

const GOLD = '#E8D200';
const TEXT_PRIMARY = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';

/**
 * What the pill says once you're registered — the single most useful fact
 * about where you stand, short enough to sit in a pill.
 *
 * Ordered by what's actually actionable: an unmet entry gate outranks
 * everything, because until it's met nothing else about the event applies to
 * you. `is_gated` on the board is the server saying the same thing, so both
 * sources agree by construction.
 */
function registeredPill(
    event: LiveEvent,
    board: EventLeaderboard | null | undefined,
): { label: string; a11y: string } {
    // Preview deliberately gets the REAL pill: the point of an in-app preview
    // is to see exactly what the room will see. The only thing preview changes
    // is where a tap goes (the sheet, so the test registration can be reset).
    const gate = event.viewer.gate;
    if (gate && !gate.met) {
        return {
            label: `${gate.count} OF ${gate.required} FRIENDS`,
            a11y: `${gate.count} of ${gate.required} friends in — the leaderboard unlocks at ${gate.required}.`,
        };
    }

    if (event.is_locked) return { label: 'SCORES LOCKED', a11y: 'Scores are locked for the reveal.' };

    // Live and on the board: your rank is the fact worth carrying. Points
    // alone before a rank exists still beats a generic "you're in".
    if (event.status === 'live' && board && !board.is_gated) {
        const { rank, points } = board.viewer;
        if (typeof rank === 'number') return { label: `RANK ${rank}`, a11y: `You're ranked ${rank}.` };
        if (typeof points === 'number') return { label: `${points} POWR`, a11y: `You've earned ${points} POWR.` };
    }

    return { label: 'YOU’RE IN', a11y: 'You’re registered.' };
}

/**
 * The home-screen presence of whatever live event is on: promo video/image
 * background, venue logo, dates. Entirely driven by get_active_live_event(),
 * so a future event only needs its admin row filled in (promo media +
 * headline in the "Promo page" group) to take this slot.
 *
 * It carries the event the whole way through rather than only up to
 * registration. Before you join it sells the event and opens the register
 * sheet; after you join the pill flips to where you actually stand — gate
 * progress in the run-up, your score once the window opens — and tapping it
 * goes to the League tab, where the ticket and the board live. Home is where
 * the event is sold, so it shouldn't go quiet the moment someone says yes.
 */
export function LiveEventCard() {
    const [sheetOpen, setSheetOpen] = useState(false);
    const router = useRouter();

    // Shares useLiveEvent's cache key so home and League stay in sync, but
    // deliberately NOT the full hook — that would drag the invite-progress
    // query and the 60s board poll onto Home for the whole event window.
    const { data: event } = useQuery<LiveEvent | null>({
        queryKey: ['liveEvent', 'active'],
        queryFn: fetchActiveLiveEvent,
        staleTime: 60_000,
    });

    // Your standing, for the pill only. Shares League's board cache key so the
    // two never show different numbers, but sets NO refetchInterval — Home
    // reads whatever the tab last fetched (or fetches once on mount) rather
    // than putting a second 60s poll on the busiest screen in the app.
    const { data: board } = useQuery<EventLeaderboard | null>({
        queryKey: ['liveEventBoard', event?.id],
        queryFn: () => fetchEventLeaderboard(event!.id),
        enabled: !!event && event.viewer.joined && event.status === 'live' && !event.is_locked,
        staleTime: 60_000,
    });

    if (!event) return null;
    if (event.status !== 'scheduled' && event.status !== 'live') return null;
    if (event.scope !== 'opt_in') return null;
    if (!event.viewer.eligible || event.viewer.disqualified) return null;

    const registered = event.viewer.joined;

    // Locked means scores are being verified for the in-person reveal: there
    // is nothing left to register for, so the card only survives the lock for
    // people who are actually in the event.
    if (event.is_locked && !registered) return null;

    const media = event.promo_media_url;
    const videoUrl = isVideoUrl(media) ? media : null;
    const imageUrl = videoUrl ? null : media;
    const large = event.logo_only;

    // Preview keeps the register sheet reachable after joining so the flow can
    // be reset and run again; a real registration sends you to the tab that
    // owns the event from here on.
    const opensSheet = !registered || !!event.is_preview;
    const pill = registeredPill(event, board);

    return (
        <>
            <Pressable
                onPress={() => (opensSheet ? setSheetOpen(true) : router.push('/(tabs)/league'))}
                style={({ pressed }) => [pressed && { opacity: 0.92 }]}
                accessibilityRole="button"
                accessibilityLabel={
                    !registered
                        ? `Live event: ${event.name}. Tap to register.`
                        : event.is_preview
                            ? `Live event: ${event.name}. Registered — tap to reset the preview.`
                            : `Live event: ${event.name}. ${pill.a11y} Tap to open the League tab.`
                }
            >
                <View style={styles.card}>
                    <View style={styles.heroContainer}>
                        <RewardHeroMedia
                            videoUrl={videoUrl}
                            imageUrl={imageUrl}
                            style={styles.heroMedia}
                            contentFit="cover"
                        />

                        <LinearGradient
                            colors={['rgba(10,10,10,0.25)', 'rgba(10,10,10,0.1)', 'rgba(10,10,10,0.55)', 'rgba(10,10,10,0.9)']}
                            locations={[0, 0.35, 0.7, 1]}
                            style={StyleSheet.absoluteFillObject}
                        />

                        <View style={styles.topRow}>
                            <Text style={styles.eyebrowText}>LIVE EVENT</Text>
                            <View style={[styles.statusChip, event.is_preview && styles.statusChipPreview]}>
                                {event.status === 'live' && !event.is_preview && <View style={styles.liveDot} />}
                                <Text style={[styles.statusText, event.is_preview && styles.statusTextPreview]}>
                                    {event.is_preview ? `PREVIEW · ${eventStatusChip(event)}` : eventStatusChip(event)}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.bottomSection}>
                            <EventLockup event={event} size={large ? 'large' : 'normal'} />

                            {/* logo_only: the lockup IS the identity (name stays in the
                                a11y label and the register sheet). */}
                            {!event.logo_only && (
                                <Text style={styles.name} numberOfLines={1}>{event.name}</Text>
                            )}

                            <View style={styles.bottomRow}>
                                {/* Start date only — the register sheet carries the full window. */}
                                <Text style={styles.subline} numberOfLines={2}>
                                    {event.promo_headline ?? shortDate(event.window_start_at)}
                                </Text>
                                <View style={[styles.registerPill, registered && styles.registeredPill]}>
                                    <Text style={[styles.registerText, registered && styles.registeredText]}>
                                        {registered ? pill.label : 'REGISTER'}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    </View>
                </View>
            </Pressable>

            <EventRegisterSheet event={event} visible={sheetOpen} onClose={() => setSheetOpen(false)} />
        </>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: '#141414',
    },
    heroContainer: {
        height: 220,
        position: 'relative',
    },
    heroMedia: {
        ...StyleSheet.absoluteFillObject,
    },
    topRow: {
        position: 'absolute',
        top: 12,
        left: 12,
        right: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    eyebrowText: {
        fontSize: 9,
        fontWeight: '800',
        color: GOLD,
        letterSpacing: 2.5,
        textShadowColor: 'rgba(0,0,0,0.6)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    statusChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(0,0,0,0.4)',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
    },
    statusChipPreview: { backgroundColor: GOLD },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
    statusText: { fontSize: 9, fontWeight: '700', color: TEXT_PRIMARY, letterSpacing: 1.5 },
    statusTextPreview: { color: '#0a0a0a', fontWeight: '800' },

    bottomSection: {
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 14,
        gap: 8,
    },
    name: {
        fontSize: 26,
        fontWeight: '200',
        color: TEXT_PRIMARY,
        letterSpacing: -0.5,
    },
    bottomRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 12,
    },
    subline: {
        flex: 1,
        fontSize: 12,
        fontWeight: '300',
        color: DIM,
        lineHeight: 16,
    },
    registerPill: {
        backgroundColor: GOLD,
        borderRadius: 100,
        paddingHorizontal: 16,
        paddingVertical: 9,
    },
    registerText: { fontSize: 10, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },
    registeredPill: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.6)',
    },
    registeredText: { color: GOLD },
});

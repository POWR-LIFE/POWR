import { useQuery } from '@tanstack/react-query';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EventRegisterSheet } from '@/components/home/EventRegisterSheet';
import { RewardHeroMedia } from '@/components/rewards/RewardHeroMedia';
import { fetchActiveLiveEvent, type LiveEvent } from '@/lib/api/liveEvents';
import { eventDateRange, eventStatusChip, isVideoUrl } from '@/lib/liveEventDisplay';
import { storageImage } from '@/lib/storageImage';

const GOLD = '#E8D200';
const TEXT_PRIMARY = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';

/**
 * The home-screen sell for whatever live event is coming up: promo video/image
 * background, venue logo, dates — tap to register. Entirely driven by
 * get_active_live_event(), so a future event only needs its admin row filled
 * in (promo media + headline in the "Promo page" group) to take this slot.
 *
 * Registration is its one job. It renders only while there is something to
 * register FOR: an opt-in event that is scheduled or live-and-unlocked, for
 * an eligible viewer who hasn't joined. Once they register (or for global
 * events, where everyone is counted automatically) the card disappears and
 * the event lives on the League tab.
 */
export function LiveEventCard() {
    const [sheetOpen, setSheetOpen] = useState(false);

    // Shares useLiveEvent's cache key so home and League stay in sync, but
    // deliberately NOT the full hook — that would drag the invite-progress
    // query and the 60s board poll onto Home for the whole event window.
    const { data: event } = useQuery<LiveEvent | null>({
        queryKey: ['liveEvent', 'active'],
        queryFn: fetchActiveLiveEvent,
        staleTime: 60_000,
    });

    if (!event) return null;
    if (event.status !== 'scheduled' && event.status !== 'live') return null;
    if (event.is_locked) return null;
    if (event.scope !== 'opt_in') return null;
    if (!event.viewer.eligible || event.viewer.disqualified) return null;
    // Registered users lose the card — except in preview, where it stays so
    // the flow can be reset and re-run (the sheet offers the reset).
    if (event.viewer.joined && !event.is_preview) return null;

    const registered = event.viewer.joined;

    const media = event.promo_media_url;
    const videoUrl = isVideoUrl(media) ? media : null;
    const imageUrl = videoUrl ? null : media;
    // Identity mark: per-event upload wins, then the venue partner's logo,
    // then the bundled POWR wordmark — the card never goes markless.
    const uploadedLogo = storageImage(event.logo_url, 512, 512);
    const logoUri = uploadedLogo ?? storageImage(event.venue?.logo_url, 512, 512);
    // Promo-page convention: only venue logos marked 'dark' sit on the artwork
    // raw; everything else gets a white chip so any mark survives. Uploads are
    // always chipped (no bg metadata); the white POWR wordmark sits raw.
    const chipLogo = !!logoUri && (!!uploadedLogo || event.venue?.logo_bg !== 'dark');

    return (
        <>
            <Pressable
                onPress={() => setSheetOpen(true)}
                style={({ pressed }) => [pressed && { opacity: 0.92 }]}
                accessibilityRole="button"
                accessibilityLabel={registered
                    ? `Live event: ${event.name}. Registered — tap to reset the preview.`
                    : `Live event: ${event.name}. Tap to register.`}
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
                            <View style={[styles.logoWrap, chipLogo && styles.logoChip]}>
                                <ExpoImage
                                    source={logoUri ? { uri: logoUri } : require('@/assets/images/powrlogotext.png')}
                                    style={logoUri ? styles.logoImage : styles.powrLogo}
                                    contentFit="contain"
                                />
                            </View>

                            <Text style={styles.name} numberOfLines={1}>{event.name}</Text>

                            <View style={styles.bottomRow}>
                                <Text style={styles.subline} numberOfLines={2}>
                                    {event.promo_headline ?? eventDateRange(event)}
                                </Text>
                                <View style={[styles.registerPill, registered && styles.registeredPill]}>
                                    <Text style={[styles.registerText, registered && styles.registeredText]}>
                                        {registered ? 'REGISTERED' : 'REGISTER'}
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
    logoWrap: {
        alignSelf: 'flex-start',
    },
    logoChip: {
        backgroundColor: '#FFFFFF',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
    logoImage: {
        width: 76,
        height: 34,
    },
    // The bundled wordmark is a square canvas with its own padding — the chip
    // dimensions would shrink it to a speck, so it gets a square box instead.
    powrLogo: {
        width: 46,
        height: 46,
        marginBottom: -8,
        marginLeft: -6,
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

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EventLockup } from '@/components/events/EventLockup';
import { RewardHeroMedia } from '@/components/rewards/RewardHeroMedia';
import type { LiveEvent } from '@/lib/api/liveEvents';
import { eventDateRange, eventNightLine, isVideoUrl, lastDayOf } from '@/lib/liveEventDisplay';

const GOLD = '#E8D200';
const CARD_BG = 'rgba(40,40,40,0.85)';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.5)';

/** One line on where the event is up to — shared with the compact board header. */
export function eventStatusLine(event: LiveEvent): string {
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
 * One fact per line: icon, then the fact. Three of these is the whole meta
 * block, which is the point — the card has to carry when-scoring, when-the-
 * night-is and where without turning into a paragraph, so each row is a
 * single short string and nothing wraps in normal use.
 *
 * `onPress` makes a row actionable; only the venue row uses it today, and it
 * renders a chevron so the row is visibly tappable rather than relying on
 * people guessing.
 */
function MetaRow({
    icon,
    text,
    onPress,
    a11y,
}: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    text: string;
    onPress?: () => void;
    a11y?: string;
}) {
    const body = (
        <>
            <Ionicons name={icon} size={13} color={DIM} style={styles.metaIcon} />
            <Text style={[styles.metaText, onPress && styles.metaTextLink]} numberOfLines={1}>
                {text}
            </Text>
            {onPress && <Ionicons name="chevron-forward" size={13} color={GOLD} />}
        </>
    );

    if (!onPress) return <View style={styles.metaRow}>{body}</View>;

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.metaRow, pressed && { opacity: 0.6 }]}
            accessibilityRole="link"
            accessibilityLabel={a11y ?? text}
            // The rows are 17px tall by design; without this the tap target is
            // below the 44px minimum and the chevron becomes decorative.
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
            {body}
        </Pressable>
    );
}

/**
 * What the event IS: identity, window, where it’s up to. (What’s on the line
 * — the prizes — is the gallery block directly beneath, not part of this card.)
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
    const router = useRouter();

    // Discover keys a venue on its partners UUID and needs somewhere to point
    // the camera, so the location row is only a link when BOTH arrived in the
    // payload. Older payloads (pre-20260821 RPC) carry neither, and a partner
    // with no geometry carries the id but no coordinates — either way the row
    // still shows the venue name, it just stops being tappable.
    const venue = event.venue;
    const canOpenMap = !!venue?.id && typeof venue.lat === 'number' && typeof venue.lng === 'number';
    const night = eventNightLine(event);

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
                        the dates/CTA below — this card is far more
                        text-dense than the home hero, so the bottom needs more
                        scrim than home's does to stay legible over bright video. */}
                    <LinearGradient
                        colors={['rgba(10,10,10,0.3)', 'rgba(10,10,10,0.55)', 'rgba(10,10,10,0.88)']}
                        locations={[0, 0.45, 1]}
                        style={StyleSheet.absoluteFillObject}
                    />
                </>
            )}

            {/* The lockup takes its natural width (alignSelf: flex-start), so the
                pill can sit hard right without a fixed-width guess. */}
            <View style={styles.topRow}>
                <EventLockup event={event} />
                {night && (
                    <View style={styles.eventPill}>
                        <Text style={styles.eventPillLabel}>EVENT</Text>
                        <Text style={styles.eventPillValue}>{night.replace(', ', ' · ').toUpperCase()}</Text>
                    </View>
                )}
            </View>

            {/* logo_only: the lockup IS the identity (the name still carries the
                register sheet, the boards and the a11y label). */}
            {!event.logo_only && <Text style={styles.name}>{event.name}</Text>}

            {/* The two supporting facts; the night itself is the pill above,
                where it can't be mistaken for another grey date row. The card
                used to carry the scoring window ALONE, which is the least
                actionable of the three for someone deciding whether to come. */}
            <View style={styles.meta}>
                <MetaRow
                    icon="calendar-outline"
                    text={`Scoring ${eventDateRange(event)}`}
                />
                {venue?.name && (
                    <MetaRow
                        icon="location-outline"
                        text={venue.name}
                        onPress={
                            canOpenMap
                                ? () => {
                                    Haptics.selectionAsync();
                                    router.push({
                                        pathname: '/(tabs)/discover',
                                        params: { venue: venue.id!, lat: String(venue.lat), lng: String(venue.lng) },
                                    });
                                }
                                : undefined
                        }
                        a11y={`${venue.name}${venue.address ? `, ${venue.address}` : ''}. Opens the map.`}
                    />
                )}
            </View>

            <Text style={styles.statusLine}>{eventStatusLine(event)}</Text>


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
    topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    // The one fact the card could not state before: when to actually turn up.
    // Gold and cornered rather than another grey meta row, because it is the
    // thing someone scanning the card is looking for and the scoring window
    // was being mistaken for it.
    eventPill: {
        marginLeft: 'auto',
        alignItems: 'center',
        gap: 2,
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.5)',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    eventPillLabel: { fontSize: 8, fontWeight: '800', color: 'rgba(255,255,255,0.7)', letterSpacing: 1.4 },
    eventPillValue: { fontSize: 11, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.3 },

    meta: { marginTop: 6, gap: 5 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    // Nudged down a hair: Ionicons' glyphs sit high in their box, so centring
    // the icon box leaves the mark reading above the text baseline.
    metaIcon: { marginTop: 1 },
    metaText: { flex: 1, fontSize: 12, fontWeight: '300', color: DIM },
    metaTextLink: { color: TEXT, fontWeight: '400' },
    statusLine: { fontSize: 11, fontWeight: '400', color: GOLD, marginTop: 8 },

    joinBtn: {
        marginTop: 14,
        borderRadius: 100,
        backgroundColor: GOLD,
        paddingVertical: 11,
        alignItems: 'center',
    },
    joinBtnText: { fontSize: 11, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },
});

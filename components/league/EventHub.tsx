import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Image as NativeImage, type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EventLockup } from '@/components/events/EventLockup';
import { RewardHeroMedia } from '@/components/rewards/RewardHeroMedia';
import {
    fetchEventLeaderboard,
    type EventBoardEntry,
    type EventLeaderboard,
    type LiveEvent,
} from '@/lib/api/liveEvents';
import {
    eventNightLine,
    eventStatusChip,
    isVideoUrl,
    lastDayOf,
    registrationLine,
    scoringLine,
} from '@/lib/liveEventDisplay';
import { memberLabel } from '@/lib/memberName';

const GOLD = '#E8D200';
const SILVER = '#c0c0c0';
const BRONZE = '#cd7f32';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.3)';

type Section = 'live' | 'upcoming' | 'results';

const SECTION_LABEL: Record<Section, string> = {
    live: 'LIVE NOW',
    upcoming: 'UPCOMING',
    results: 'RESULTS',
};

/** Where an event sits on the hub. A live event whose board has sealed is
 *  waiting on its reveal — it reads with the finished ones, not as "live". */
function sectionOf(event: LiveEvent): Section {
    if (event.status === 'live' && !event.is_locked) return 'live';
    if (event.status === 'scheduled' || event.status === 'announced') return 'upcoming';
    return 'results';
}

/** One line on where the event is up to — the hub's version of the header
 *  card's status line, short enough to sit beside the lockup. */
function factLine(event: LiveEvent): string {
    if (event.status === 'announced') return registrationLine(event);
    if (event.status === 'scheduled') return scoringLine(event);
    if (event.status === 'live' && !event.is_locked) return `Live now — ends ${lastDayOf(event.window_end_at)}`;
    if (!event.revealed_at) return 'Scores sealed — revealed at the final';
    return 'Winners announced';
}

/** The top-right chip, in the Home card's words where the two overlap. */
function statusChip(event: LiveEvent): string {
    if (event.status === 'announced' || event.status === 'scheduled') return eventStatusChip(event);
    if (event.status === 'live' && !event.is_locked) return 'LIVE NOW';
    if (!event.revealed_at) return 'SEALED';
    return 'RESULTS';
}

/** The pill: what this event wants from you, or where you stand in it. Same
 *  vocabulary as the Home card, so a member reads the two the same way. */
function standingPill(event: LiveEvent, board?: EventLeaderboard | null): { label: string; filled: boolean } {
    if (event.viewer.joined) {
        const rank = event.status === 'live' && !event.is_locked ? board?.viewer.rank : undefined;
        return { label: typeof rank === 'number' ? `RANK ${rank}` : 'YOU’RE IN', filled: false };
    }
    if (event.status === 'announced') return { label: 'SOON', filled: false };
    const canJoin =
        event.scope === 'opt_in' &&
        event.viewer.eligible &&
        !event.viewer.disqualified &&
        (event.status === 'scheduled' || (event.status === 'live' && !event.is_locked));
    if (canJoin) return { label: 'REGISTER', filled: true };
    return { label: 'VIEW', filled: false };
}

/** The viewer's own line under the facts, when there's anything to say. The
 *  live rank lives on the pill, so the line carries the points beside it. */
function youLine(event: LiveEvent, board?: EventLeaderboard | null): string | null {
    const v = board?.viewer;
    if (!v) return null;
    if (event.revealed_at && typeof v.rank === 'number') return `You finished #${v.rank}`;
    if (typeof v.points === 'number' && v.points > 0) return `You · ${v.points.toLocaleString()} pts this week`;
    return null;
}

const PODIUM = [GOLD, SILVER, BRONZE];

function PodiumLine({ rows }: { rows: EventBoardEntry[] }) {
    return (
        <View style={styles.podium}>
            {rows.slice(0, 3).map((r, i) => (
                <View key={r.user_id} style={styles.podiumCell}>
                    <Text style={[styles.podiumRank, { color: PODIUM[i] }]}>{r.rank}</Text>
                    <Text style={styles.podiumName} numberOfLines={1}>
                        {memberLabel(r.display_name, r.username).split(/\s+/)[0]}
                    </Text>
                    <Text style={styles.podiumPts}>{r.points.toLocaleString()}</Text>
                </View>
            ))}
        </View>
    );
}

function EventHubCard({
    event,
    playVideo,
    onPress,
    onLayout,
}: {
    event: LiveEvent;
    /** Only one hub card decodes video at a time — see EventHub. */
    playVideo: boolean;
    onPress: () => void;
    onLayout: (e: LayoutChangeEvent) => void;
}) {
    // Same cache key as the League board and the Home card (the trailing null
    // is the preview state) so all three show one number. Only events that
    // have a board ask for one: nothing exists before scoring starts.
    const hasBoard = event.status !== 'scheduled' && event.status !== 'announced';
    const { data: board } = useQuery<EventLeaderboard | null>({
        queryKey: ['liveEventBoard', event.id, null],
        queryFn: () => fetchEventLeaderboard(event.id, null),
        enabled: hasBoard,
        refetchInterval: 60_000,
        staleTime: 30_000,
    });

    const pill = standingPill(event, board);
    const night = eventNightLine(event);
    const you = youLine(event, board);
    const podium = board?.results ?? board?.standings ?? null;
    const live = event.status === 'live' && !event.is_locked;

    // The event's own artwork, as on Home: one field that may hold a video or
    // a still. A video card that isn't the one playing shows its dark ground.
    const media = event.promo_media_url;
    const isVideo = isVideoUrl(media);

    return (
        <Pressable
            onLayout={onLayout}
            onPress={() => {
                void Haptics.selectionAsync();
                onPress();
            }}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.88 }]}
            accessibilityRole="button"
            accessibilityLabel={`${event.name}. ${factLine(event)}.${night ? ` Event night ${night}.` : ''}${you ? ` ${you}.` : ''} Tap to open.`}
        >
            {!!media && (
                <>
                    <RewardHeroMedia
                        videoUrl={isVideo && playVideo ? media : null}
                        imageUrl={isVideo ? null : media}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                    />
                    {/* Heavier at the bottom, where the facts and the board sit. */}
                    <LinearGradient
                        colors={['rgba(10,10,10,0.35)', 'rgba(10,10,10,0.15)', 'rgba(10,10,10,0.7)', 'rgba(10,10,10,0.92)']}
                        locations={[0, 0.3, 0.65, 1]}
                        style={StyleSheet.absoluteFillObject}
                    />
                    {/* The lockup and every line sit on the left — same left
                        shade as the Home card so white logos survive bright art. */}
                    <LinearGradient
                        colors={['rgba(10,10,10,0.8)', 'rgba(10,10,10,0.45)', 'rgba(10,10,10,0)']}
                        locations={[0, 0.5, 0.9]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={StyleSheet.absoluteFillObject}
                    />
                </>
            )}

            <View style={styles.top}>
                <EventLockup event={event} />
                <View style={[styles.chip, event.is_preview && styles.chipPreview]}>
                    {live && !event.is_preview && <View style={styles.liveDot} />}
                    <Text style={[styles.chipText, event.is_preview && styles.chipTextPreview]} numberOfLines={1}>
                        {event.is_preview ? `PREVIEW · ${statusChip(event)}` : statusChip(event)}
                    </Text>
                </View>
            </View>

            <View style={styles.facts}>
                {/* logo_only: the lockup IS the identity, exactly as on Home. */}
                {!event.logo_only && <Text style={styles.name} numberOfLines={1}>{event.name}</Text>}
                <Text style={styles.fact} numberOfLines={1}>{factLine(event)}</Text>
                {night && (
                    <View style={styles.factRow}>
                        <Ionicons name="flag" size={11} color={GOLD} />
                        <Text style={styles.night} numberOfLines={1}>{night}</Text>
                    </View>
                )}
            </View>

            {/* The board at a glance — top three, live or final. Absent while
                the board is sealed or gated: the server sends nothing to show. */}
            {podium && podium.length > 0 && <PodiumLine rows={podium} />}

            <View style={styles.bottom}>
                <Text style={styles.you} numberOfLines={1}>{you ?? ''}</Text>
                <View style={[styles.pill, pill.filled && styles.pillFilled]}>
                    <Text style={[styles.pillText, pill.filled && styles.pillTextFilled]}>{pill.label}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
            </View>
        </Pressable>
    );
}

// ─── More to come ────────────────────────────────────────────────────────────

/** The solid white POWR mark, high-res — the card's only artwork. */
const POWR_MARK_SOLID = 'https://auth.powr.life/storage/v1/object/public/landing-page-assets/powr_transparent.png';

/**
 * The space under a short hub, as one quiet statement instead of blank: a
 * large, barely-there POWR mark bleeding off the right edge, one ultra-light
 * line and a gold hairline. Restraint over gimmick — it replaced a pair of
 * "?" teaser cards that read cheap, then a crowd photo (Jamie: "just use a
 * POWR logo in the background, faded", 2026-10-06). Shown while there are
 * fewer than four events; not a button, there's nothing behind it yet.
 * Promises no venue and no date.
 */
function MoreToComeCard() {
    return (
        <View
            style={[styles.card, styles.moreCard]}
            accessible
            accessibilityLabel="More to come. New venues are joining POWR. You'll see them here first."
        >
            {/* react-native's Image, like the lockup's mark: plain alpha on a
                plain card, no expo-image compositing surprises. */}
            <NativeImage source={{ uri: POWR_MARK_SOLID }} style={styles.moreMark} resizeMode="contain" />

            <Text style={styles.moreEyebrow}>COMING SOON</Text>
            <View style={styles.moreBody}>
                <Text style={styles.moreTitle}>More to come.</Text>
                <View style={styles.moreRule} />
                <Text style={styles.moreLine}>New venues are joining POWR. You&apos;ll see them here first.</Text>
            </View>
        </View>
    );
}

/**
 * Every event in one place: the League tab's front page whenever more than one
 * event is on. Grouped by where each is up to (live, upcoming, results) in the
 * order the list arrives — already "yours first, live first" from
 * useLiveEvents. A card carries the one fact that matters and where the viewer
 * stands; tapping it opens that event's full page (leaderboard + event), which
 * stays exactly what a single-event League always was.
 */
export function EventHub({
    events,
    onOpen,
    bottomInset,
}: {
    events: LiveEvent[];
    onOpen: (event: LiveEvent) => void;
    bottomInset: number;
}) {
    const sections = (['live', 'upcoming', 'results'] as Section[])
        .map(key => ({ key, items: events.filter(e => sectionOf(e) === key) }))
        .filter(s => s.items.length > 0);
    const ordered = sections.flatMap(s => s.items);

    // One video decoder at a time: two hardware H.264 players starve an
    // Android device's codec and can take the app down natively (see
    // RewardHeroMedia). The first video card at least half on screen plays;
    // any other video card holds its dark ground until it's the one in view.
    // Cards are direct children of the scroll content (sections are
    // fragments), so their layout y is already in scroll coordinates.
    const [scrollY, setScrollY] = useState(0);
    const [viewH, setViewH] = useState(0);
    const [layouts, setLayouts] = useState<Record<string, { y: number; h: number }>>({});
    const onCardLayout = (id: string) => (e: LayoutChangeEvent) => {
        const { y, height } = e.nativeEvent.layout;
        setLayouts(prev => (prev[id]?.y === y && prev[id]?.h === height ? prev : { ...prev, [id]: { y, h: height } }));
    };
    const halfVisible = (id: string) => {
        const l = layouts[id];
        if (!l || !viewH) return false;
        const shown = Math.min(l.y + l.h, scrollY + viewH) - Math.max(l.y, scrollY);
        return shown >= l.h / 2;
    };
    const playingId = ordered.find(e => isVideoUrl(e.promo_media_url) && halfVisible(e.id))?.id ?? null;

    return (
        <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingTop: 6, paddingBottom: bottomInset + 24, gap: 10 }}
            showsVerticalScrollIndicator={false}
            onLayout={e => setViewH(e.nativeEvent.layout.height)}
            onScroll={e => setScrollY(e.nativeEvent.contentOffset.y)}
            scrollEventThrottle={100}
        >
            {sections.map(section => (
                <React.Fragment key={section.key}>
                    <Text style={styles.sectionLabel}>{SECTION_LABEL[section.key]}</Text>
                    {section.items.map(event => (
                        <EventHubCard
                            key={event.id}
                            event={event}
                            playVideo={event.id === playingId}
                            onPress={() => onOpen(event)}
                            onLayout={onCardLayout(event.id)}
                        />
                    ))}
                </React.Fragment>
            ))}

            {/* The rest of a short list, as anticipation rather than blank. */}
            {events.length < 4 && <MoreToComeCard />}
        </ScrollView>
    );
}

/**
 * Back to the hub, where people look for it: a round back button at the far
 * left of the League header, the shape every app uses for "go back". It
 * replaced a small "‹ All events" text link that a first-time user didn't read
 * as navigation at all (2026-10-06).
 */
export function EventHubBackButton({ onPress }: { onPress: () => void }) {
    return (
        <Pressable
            onPress={() => {
                void Haptics.selectionAsync();
                onPress();
            }}
            style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back to all events"
        >
            <Ionicons name="chevron-back" size={22} color={TEXT} style={{ marginLeft: -2 }} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    sectionLabel: {
        marginHorizontal: 18,
        marginTop: 8,
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 2.5,
        color: MUTED,
    },
    card: {
        marginHorizontal: 14,
        minHeight: 200,
        borderRadius: 18,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        // The artwork paints edge to edge and must keep the 18px corners.
        overflow: 'hidden',
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 12,
        gap: 12,
        justifyContent: 'space-between',
    },
    top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        gap: 6,
        backgroundColor: 'rgba(0,0,0,0.45)',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
    },
    chipPreview: { backgroundColor: GOLD },
    chipText: { fontSize: 9, fontWeight: '700', color: TEXT, letterSpacing: 1.5 },
    chipTextPreview: { color: '#0a0a0a', fontWeight: '800' },
    facts: { gap: 4 },
    name: { fontSize: 22, fontWeight: '200', color: TEXT, letterSpacing: -0.5 },
    factRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
    fact: { fontSize: 12, fontWeight: '500', color: GOLD },
    night: { flexShrink: 1, fontSize: 12, fontWeight: '500', color: TEXT },

    podium: {
        flexDirection: 'row',
        gap: 8,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.12)',
    },
    podiumCell: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 5, minWidth: 0 },
    podiumRank: { fontSize: 12, fontWeight: '800' },
    podiumName: { flexShrink: 1, fontSize: 12, fontWeight: '300', color: TEXT },
    podiumPts: { fontSize: 11, fontWeight: '300', color: 'rgba(255,255,255,0.65)' },

    bottom: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    you: { flex: 1, fontSize: 12, fontWeight: '500', color: TEXT },
    pill: {
        borderRadius: 100,
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.6)',
        backgroundColor: 'rgba(0,0,0,0.35)',
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    pillFilled: { backgroundColor: GOLD, borderColor: GOLD },
    pillText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, color: GOLD },
    pillTextFilled: { color: '#0a0a0a' },

    moreCard: {
        minHeight: 210,
        justifyContent: 'space-between',
        backgroundColor: 'rgba(22,22,22,0.92)',
        borderColor: 'rgba(232,210,0,0.16)',
    },
    // The mark's ink sits mid-canvas, so the canvas overhangs the card: the
    // P lands large on the right half and bleeds off the edge.
    moreMark: {
        position: 'absolute',
        width: 340,
        height: 340,
        right: -90,
        top: -55,
        opacity: 0.06,
    },
    moreEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 2.5, color: GOLD },
    moreBody: { gap: 10 },
    moreTitle: { fontSize: 30, fontWeight: '200', color: TEXT, letterSpacing: -0.8 },
    moreRule: { width: 36, height: 1, backgroundColor: GOLD, opacity: 0.8 },
    moreLine: { fontSize: 13, fontWeight: '300', color: 'rgba(255,255,255,0.7)', lineHeight: 19, maxWidth: 280 },
    back: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.18)',
        marginRight: 12,
    },
});

import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Dimensions, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PodiumAvatarRing } from '@/components/league/PodiumAvatarRing';
import { SegmentBar } from '@/components/league/SegmentBar';
import { usePoints } from '@/hooks/usePoints';
import { fetchProfile } from '@/lib/api/user';
import { inviteCodeLine } from '@/lib/eventInviteLink';
import { memberInitials } from '@/lib/memberName';

/**
 * The League tab between events — no live event configured, global
 * leaderboard not yet open. Same two-segment bar as event mode and nothing
 * else that looks like a tab. Each segment is one editorial page: a
 * headline, one visual, one number, one line. No cards, no lists.
 *
 *   LEADERBOARD — the podium with the viewer in the champion's seat and the
 *                 other two empty (the live podium's rings, still turning),
 *                 and their all-time total as the one number on the page.
 *   EVENTS      — the shape of a live event in three numbered beats and the
 *                 viewer's own code, ready to share, exactly as the live
 *                 ticket carries it: friends brought now count next time.
 *
 * Nothing claims a date. Copy says "soon" / "in the works" until it's real.
 */

const GOLD = '#E8D200';
const GOLD_SOFT = '#FFE97A';
const SILVER = '#c0c0c0';
const SILVER_SOFT = '#E0E0E0';
const BRONZE = '#cd7f32';
const BRONZE_SOFT = '#E8A464';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.5)';
const MUTED = 'rgba(255,255,255,0.25)';
const CARD_BG = 'rgba(40,40,40,0.85)';

const SCREEN_W = Dimensions.get('window').width;

type PreviewSegment = 'board' | 'events';

const SEGMENTS: { key: PreviewSegment; label: string }[] = [
    { key: 'board', label: 'LEADERBOARD' },
    { key: 'events', label: 'EVENTS' },
];

export function LeaguePreview() {
    const insets = useSafeAreaInsets();
    const [segment, setSegment] = useState<PreviewSegment>('board');

    return (
        <>
            <SegmentBar items={SEGMENTS} value={segment} onChange={setSegment} />
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingTop: 36, paddingBottom: insets.bottom + 40 }}
                showsVerticalScrollIndicator={false}
            >
                {segment === 'board' ? <BoardSegment /> : <EventsSegment />}
            </ScrollView>
        </>
    );
}

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────

function BoardSegment() {
    const { totalEarned } = usePoints();
    const { data: profile } = useQuery({
        queryKey: ['profile', 'me'],
        queryFn: fetchProfile,
        staleTime: 5 * 60_000,
    });

    return (
        <>
            <Headline
                eyebrow="GLOBAL LEADERBOARD"
                light="Every move."
                bold="One board."
                line="Weekly podiums and all-time rankings, open to everyone on POWR. Coming soon."
            />

            <EmptyPodium
                avatarUrl={profile?.avatar_url ?? null}
                initials={memberInitials(profile?.display_name, profile?.username)}
            />

            {/* The one number on the page — the style guide's stat stack:
                label, then the number large and light in gold, then the unit. */}
            <View style={styles.stat}>
                <Text style={styles.statLabel}>YOU BRING</Text>
                <Text style={styles.statNum}>{totalEarned.toLocaleString()}</Text>
                <Text style={styles.statUnit}>POINTS ALL TIME</Text>
                <Text style={styles.statLine}>Already counted. You start where you stand.</Text>
            </View>

            <Pillars items={['WEEKLY PODIUMS', 'ALL-TIME LADDER', 'STANDARD & PRO']} />
        </>
    );
}

/** The live podium — same columns, rings, metals and platforms — with the
 *  viewer in the champion's seat and nobody in the other two. The rings
 *  still turn: the places exist, the race hasn't. */
function EmptyPodium({ avatarUrl, initials }: { avatarUrl: string | null; initials: string }) {
    const COL_W = Math.floor((SCREEN_W - 32) / 3);
    const META = {
        1: { colour: GOLD, colourSoft: GOLD_SOFT, platformH: 92, avatarSize: 72, label: '1ST' },
        2: { colour: SILVER, colourSoft: SILVER_SOFT, platformH: 62, avatarSize: 56, label: '2ND' },
        3: { colour: BRONZE, colourSoft: BRONZE_SOFT, platformH: 44, avatarSize: 46, label: '3RD' },
    } as const;
    const order = [2, 1, 3] as const;

    return (
        <View style={styles.podium} accessibilityLabel="Podium, seats not yet taken">
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                {order.map(rank => {
                    const meta = META[rank];
                    const isFirst = rank === 1;
                    return (
                        <View key={rank} style={{ width: COL_W, alignItems: 'center' }}>
                            <View style={{ marginBottom: isFirst ? 8 : 10 }}>
                                {isFirst ? (
                                    <Ionicons name="trophy" size={20} color={GOLD} />
                                ) : (
                                    <Text style={{ fontSize: 8, fontWeight: '700', letterSpacing: 2, color: meta.colour, opacity: 0.7 }}>
                                        {meta.label}
                                    </Text>
                                )}
                            </View>
                            <View style={{ marginBottom: 14 }}>
                                <PodiumAvatarRing avatarSize={meta.avatarSize} colour={meta.colour} colourSoft={meta.colourSoft} isFirst={isFirst}>
                                    <View
                                        style={{
                                            width: meta.avatarSize, height: meta.avatarSize,
                                            borderRadius: meta.avatarSize / 2, overflow: 'hidden',
                                            borderWidth: isFirst ? 2 : 1.5,
                                            borderColor: isFirst ? meta.colour : `${meta.colour}55`,
                                            backgroundColor: CARD_BG,
                                            alignItems: 'center', justifyContent: 'center',
                                        }}
                                    >
                                        {isFirst && avatarUrl ? (
                                            <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                                        ) : isFirst ? (
                                            <Text style={{ fontSize: meta.avatarSize * 0.3, fontWeight: '500', color: meta.colour }}>
                                                {initials}
                                            </Text>
                                        ) : null}
                                    </View>
                                </PodiumAvatarRing>
                            </View>
                            <LinearGradient
                                colors={[`${meta.colour}22`, `${meta.colour}06`]}
                                style={{
                                    width: COL_W, height: meta.platformH,
                                    borderTopLeftRadius: 8, borderTopRightRadius: 8,
                                    alignItems: 'center', justifyContent: 'center',
                                    borderTopWidth: 2, borderTopColor: meta.colour,
                                }}
                            >
                                <Text style={{ fontSize: isFirst ? 11 : 9, fontWeight: '700', color: meta.colour, opacity: 0.55, letterSpacing: 2.5 }}>
                                    {isFirst ? 'CHAMPION' : meta.label}
                                </Text>
                            </LinearGradient>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────

/** The same smart-link the My QR screen encodes: a non-user who opens it
 *  lands on the store, a user lands on add-friend with the code filled. */
function friendLink(code: string): string {
    return `https://powr.life/app?to=add-friend&ref=${code}`;
}

function EventsSegment() {
    const router = useRouter();
    const { data: profile } = useQuery({
        queryKey: ['profile', 'me'],
        queryFn: fetchProfile,
        staleTime: 5 * 60_000,
    });
    const code = profile?.referral_code ?? null;
    const link = code ? friendLink(code) : null;
    const message = code && link ? `Join me on POWR. ${inviteCodeLine(code)}\n${link}` : null;
    const [copied, setCopied] = useState(false);

    const handleShare = async () => {
        if (!link || !message) return;
        void Haptics.selectionAsync();
        try {
            await Share.share({ message, url: link });
        } catch {
            // user dismissed — no-op
        }
    };
    // Copies code + link, not the bare link: the code is the only part that
    // survives a store install.
    const handleCopy = async () => {
        if (!message) return;
        await Clipboard.setStringAsync(message);
        void Haptics.selectionAsync();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <>
            <Headline
                eyebrow="LIVE EVENTS"
                light="One week to score."
                bold="One night to win."
                line="The next event is in the works. Registration opens here first."
            />

            {/* Three beats down a hairline — the whole event, no card around it. */}
            <View style={styles.beats}>
                <Beat n="01" title="Register" line="In the app. Your place on the board opens with it." />
                <Beat n="02" title="Score for a week" line="Everyone starts level. Only points earned inside the window count." />
                <Beat n="03" title="Revealed live" line="Scores seal before the night. Winners are announced at the venue." last />
            </View>

            {/* The viewer's code, as the live ticket carries it: SHARE, the
                code itself (tap to copy), and the QR. Same row, same order. */}
            <View style={styles.crew}>
                <Text style={styles.crewLine}>Friends you bring count on event week. Your code works now.</Text>
                <View style={styles.codeRow}>
                    <Pressable
                        style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.85 }]}
                        onPress={handleShare}
                        disabled={!link}
                        accessibilityRole="button"
                        accessibilityLabel="Share your invite link"
                    >
                        <Ionicons name="share-outline" size={14} color="#0a0a0a" />
                        <Text style={styles.shareBtnText}>SHARE</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.codeChip, pressed && { opacity: 0.7 }]}
                        onPress={handleCopy}
                        disabled={!message}
                        accessibilityRole="button"
                        accessibilityLabel="Copy your invite code and link"
                    >
                        <Text style={styles.codeText}>{code ?? '········'}</Text>
                        <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color={copied ? GOLD : MUTED} />
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.qrBtn, pressed && { opacity: 0.7 }]}
                        onPress={() => router.push('/my-qr')}
                        accessibilityRole="button"
                        accessibilityLabel="Show your POWR QR code"
                    >
                        <Ionicons name="qr-code-outline" size={16} color={DIM} />
                    </Pressable>
                </View>
            </View>
        </>
    );
}

function Beat({ n, title, line, last }: { n: string; title: string; line: string; last?: boolean }) {
    return (
        <View style={styles.beat}>
            <View style={styles.beatRail}>
                <Text style={styles.beatNum}>{n}</Text>
                {!last && <View style={styles.beatLine} />}
            </View>
            <View style={[styles.beatBody, last && { paddingBottom: 0 }]}>
                <Text style={styles.beatTitle}>{title}</Text>
                <Text style={styles.beatText}>{line}</Text>
            </View>
        </View>
    );
}

// ─── Shared ───────────────────────────────────────────────────────────────────

/** Eyebrow, two-line headline (light white over bold gold — the brand's
 *  pairing), one line under it. */
function Headline({ eyebrow, light, bold, line }: { eyebrow: string; light: string; bold: string; line: string }) {
    return (
        <View style={styles.head}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Text style={styles.headLight}>{light}</Text>
            <Text style={styles.headBold}>{bold}</Text>
            <Text style={styles.headLine}>{line}</Text>
        </View>
    );
}

/** Small uppercase words with dots between — a footer, not a feature list. */
function Pillars({ items }: { items: string[] }) {
    return (
        <View style={styles.pillars}>
            {items.map((it, i) => (
                <React.Fragment key={it}>
                    {i > 0 && <View style={styles.pillarDot} />}
                    <Text style={styles.pillarText}>{it}</Text>
                </React.Fragment>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    head: { paddingHorizontal: 24, gap: 2 },
    eyebrow: { fontSize: 9, fontWeight: '700', color: GOLD, letterSpacing: 3, marginBottom: 14 },
    headLight: { fontSize: 34, fontWeight: '200', color: TEXT, letterSpacing: -1, lineHeight: 38 },
    headBold: { fontSize: 34, fontWeight: '700', color: GOLD, letterSpacing: -1, lineHeight: 38 },
    headLine: { fontSize: 13, fontWeight: '300', color: DIM, lineHeight: 19, marginTop: 14, maxWidth: 300 },

    podium: { paddingHorizontal: 16, marginTop: 44 },

    stat: { alignItems: 'center', marginTop: 40, paddingHorizontal: 24 },
    statLabel: { fontSize: 9, fontWeight: '500', color: MUTED, letterSpacing: 2.5 },
    statNum: { fontSize: 64, fontWeight: '100', color: GOLD, letterSpacing: -2.5, lineHeight: 70, marginTop: 6 },
    statUnit: { fontSize: 9, fontWeight: '500', color: MUTED, letterSpacing: 2.5, marginTop: 2 },
    statLine: { fontSize: 12, fontWeight: '300', color: DIM, marginTop: 16, textAlign: 'center' },

    pillars: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        marginTop: 44, marginHorizontal: 24, paddingTop: 18,
        borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)',
    },
    pillarText: { fontSize: 8, fontWeight: '500', color: MUTED, letterSpacing: 1.8 },
    pillarDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(232,210,0,0.6)' },

    beats: { paddingHorizontal: 24, marginTop: 40 },
    beat: { flexDirection: 'row', gap: 18 },
    beatRail: { width: 34, alignItems: 'center' },
    beatNum: { fontSize: 24, fontWeight: '100', color: GOLD, letterSpacing: -1, lineHeight: 28 },
    beatLine: { flex: 1, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(232,210,0,0.35)', marginVertical: 8 },
    beatBody: { flex: 1, paddingTop: 3, paddingBottom: 30, gap: 4 },
    beatTitle: { fontSize: 17, fontWeight: '300', color: TEXT, letterSpacing: -0.3 },
    beatText: { fontSize: 12, fontWeight: '300', color: DIM, lineHeight: 18 },

    crew: { marginTop: 40, marginHorizontal: 24, paddingTop: 26, gap: 14,
        borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
    crewLine: { fontSize: 12, fontWeight: '300', color: DIM, lineHeight: 17 },

    // ── Code row: lifted from EventTicketCard so the two surfaces match
    codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    shareBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        backgroundColor: GOLD, borderRadius: 100, paddingVertical: 10,
    },
    shareBtnText: { fontSize: 11, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },
    codeChip: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
        backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 12, paddingVertical: 9, minWidth: 118,
    },
    codeText: { fontSize: 13, fontWeight: '600', color: TEXT, letterSpacing: 2 },
    qrBtn: {
        width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(0,0,0,0.25)',
    },
});

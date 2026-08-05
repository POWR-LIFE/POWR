import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/social/Avatar';
import type { InviteFriend, InviteProgress, LiveEvent } from '@/lib/api/liveEvents';
import { fetchProfile } from '@/lib/api/user';
import { eventInviteLink } from '@/lib/eventInviteLink';
import type { Friend } from '@/lib/social/types';

const GOLD = '#E8D200';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM = 'rgba(255,255,255,0.5)';

const MAX_FACES = 6;

/** The Avatar component speaks Friend; invite rows carry no friendship at all. */
function asFriend(f: InviteFriend, i: number): Friend {
    const name = f.display_name ?? f.username ?? 'A friend';
    return {
        id: f.username ?? name ?? `invite-${i}`,
        username: f.username ?? '',
        displayName: name,
        avatarUrl: f.avatar_url,
        status: 'accepted',
    };
}

/**
 * How we name an invited friend in a sentence. First name only when we have a
 * name at all — splitting the "A friend" fallback on whitespace would read as
 * "A still needs their first verified workout", which is how a null
 * display_name turns into gibberish rather than a graceful degrade.
 */
function friendLabel(f: InviteFriend): string {
    const name = f.display_name ?? f.username;
    return name ? name.split(' ')[0] : 'A friend';
}

function joinNames(names: string[], max = 2): string {
    if (names.length <= max) {
        return names.length === 2 ? `${names[0]} and ${names[1]}` : names.join(', ');
    }
    return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/**
 * Getting onto the board — the one job of this card, and with an entry gate
 * set it is the whole mechanic of the event, so it gets the loudest thing on
 * the tab: the count, the bar, and Share as a full-width primary.
 *
 * Two modes, same shape. With `viewer.gate` the count is the ticket (N friends
 * = you appear on the leaderboard at all). Without one it falls back to the
 * invite milestone, which is a bonus rather than a gate — same layout, quieter
 * promise. Both read their numbers from the server so the card can never
 * disagree with the scorer.
 */
export function EventTicketCard({
    event,
    invites,
}: {
    event: LiveEvent;
    invites: InviteProgress | null;
}) {
    const router = useRouter();
    const [code, setCode] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let active = true;
        fetchProfile().then(p => {
            if (active) setCode(p?.referral_code ?? null);
        });
        return () => {
            active = false;
        };
    }, []);

    const gate = event.viewer.gate ?? null;
    const milestoneN = invites?.event?.milestone_n ?? event.invite_milestone_n;
    const convertedForEvent = invites?.event?.converted_for_event ?? 0;
    const milestonePaid = invites?.event?.milestone_paid ?? false;

    const friends = invites?.friends ?? [];
    const pendingNames = friends.filter(f => !f.converted).map(friendLabel);
    // Converted first: the faces that already count lead the row.
    const faces = [...friends].sort((a, b) => Number(b.converted) - Number(a.converted));

    const count = gate ? gate.count : convertedForEvent;
    const target = gate ? gate.required : milestoneN;
    const met = gate ? gate.met : milestonePaid;
    const countingConversions = gate ? gate.counting === 'conversions' : true;

    const link = code ? eventInviteLink(event.slug, code) : null;

    const handleShare = async () => {
        if (!link) return;
        Haptics.selectionAsync();
        try {
            await Share.share({
                message:
                    `Join me for ${event.name} on POWR 💪\n` +
                    `Sign up with my code ${code} — we both earn +${event.invite_bonus_points} POWR after your first workout.\n` +
                    link,
                url: link,
            });
        } catch {
            // user dismissed — no-op
        }
    };

    const handleCopy = async () => {
        if (!link) return;
        await Clipboard.setStringAsync(link);
        Haptics.selectionAsync();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <View style={[styles.card, gate && !met && styles.cardGated]}>
            <Text style={styles.eyebrow}>{gate ? 'YOUR TICKET' : 'INVITE FRIENDS'}</Text>

            {/* ── The count, as big as it deserves to be ── */}
            {met ? (
                <View style={styles.metRow}>
                    <Ionicons name="lock-open" size={18} color={GOLD} />
                    <Text style={styles.metText}>
                        {gate ? 'You’re on the leaderboard' : 'Milestone earned'}
                    </Text>
                </View>
            ) : (
                <>
                    <View style={styles.countRow}>
                        <Text style={styles.count}>{Math.min(count, target)}</Text>
                        <Text style={styles.countOf}>/ {target}</Text>
                    </View>
                    <Text style={styles.countLabel}>
                        {countingConversions
                            ? 'friends with a verified workout'
                            : 'friends signed up with your code'}
                    </Text>
                    {target > 0 && (
                        <View style={styles.progressTrack}>
                            <View
                                style={[
                                    styles.progressFill,
                                    { width: `${Math.min(100, (count / target) * 100)}%` },
                                ]}
                            />
                        </View>
                    )}
                </>
            )}

            <Text style={styles.explainer}>
                {gate && !met
                    ? `${gate.required} friends signing up with your code${
                          gate.counting === 'conversions' ? ' and logging their first verified workout' : ''
                      } puts you on the leaderboard. `
                    : ''}
                You each get +{event.invite_bonus_points} POWR when a friend joins with your code and logs
                their first verified workout.
                {!gate && milestoneN > 0 && event.invite_milestone_bonus > 0
                    ? ` +${event.invite_milestone_bonus} more when ${milestoneN} friends make it.`
                    : ''}
            </Text>

            {/* ── Share is the action this card exists for ── */}
            <Pressable
                style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.85 }]}
                onPress={handleShare}
                disabled={!link}
                accessibilityRole="button"
                accessibilityLabel="Share your invite link"
            >
                <Ionicons name="share-outline" size={15} color="#0a0a0a" />
                <Text style={styles.shareBtnText}>SHARE YOUR CODE</Text>
            </Pressable>

            <View style={styles.codeRow}>
                <Pressable
                    style={({ pressed }) => [styles.codeChip, pressed && { opacity: 0.7 }]}
                    onPress={handleCopy}
                    accessibilityRole="button"
                    accessibilityLabel="Copy your invite link"
                >
                    <Text style={styles.codeText}>{code ?? '········'}</Text>
                    <Ionicons
                        name={copied ? 'checkmark' : 'copy-outline'}
                        size={13}
                        color={copied ? GOLD : MUTED}
                    />
                </Pressable>
                <Pressable
                    style={({ pressed }) => [styles.qrBtn, pressed && { opacity: 0.7 }]}
                    onPress={() =>
                        router.push({ pathname: '/event-qr', params: { slug: event.slug, name: event.name } })
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Show the event QR code"
                >
                    <Ionicons name="qr-code-outline" size={16} color={DIM} />
                </Pressable>
            </View>

            {/* ── Who you've already brought ── */}
            {friends.length > 0 && (
                <View style={styles.friendBlock}>
                    <View style={styles.faces}>
                        {/* Not a stacked avatar pile: each face carries a state
                            (converted ✓ vs still pending) and overlapping them
                            hides the one you most need to see. */}
                        {faces.slice(0, MAX_FACES).map((f, i) => (
                            <Avatar
                                key={`${f.username ?? f.display_name}-${i}`}
                                friend={asFriend(f, i)}
                                size={30}
                                completed={f.converted}
                                pending={!f.converted}
                            />
                        ))}
                        {friends.length > MAX_FACES && (
                            <View style={styles.moreBubble}>
                                <Text style={styles.moreText}>+{friends.length - MAX_FACES}</Text>
                            </View>
                        )}
                    </View>
                    {pendingNames.length > 0 && (
                        <Text style={styles.pendingLine}>
                            {joinNames(pendingNames)} still {pendingNames.length === 1 ? 'needs' : 'need'} their
                            first verified workout
                        </Text>
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 14,
        marginTop: 10,
        borderRadius: 18,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 18,
        paddingVertical: 18,
    },
    // An unmet gate is the one thing standing between you and the board —
    // the card says so before you've read a word of it.
    cardGated: { borderColor: 'rgba(232,210,0,0.35)' },

    eyebrow: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.6, letterSpacing: 2.5 },

    countRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 10 },
    count: { fontSize: 46, fontWeight: '100', color: GOLD, letterSpacing: -2, lineHeight: 50 },
    countOf: { fontSize: 20, fontWeight: '200', color: DIM, letterSpacing: -0.5 },
    countLabel: { fontSize: 12, fontWeight: '300', color: DIM, marginTop: 2 },
    progressTrack: {
        height: 3,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
        marginTop: 12,
    },
    progressFill: { height: '100%', borderRadius: 2, backgroundColor: GOLD },

    metRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
    metText: { fontSize: 18, fontWeight: '300', color: TEXT, letterSpacing: -0.3 },

    explainer: { fontSize: 11, fontWeight: '300', color: DIM, lineHeight: 16, marginTop: 14 },

    shareBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginTop: 14,
        backgroundColor: GOLD,
        borderRadius: 100,
        paddingVertical: 12,
    },
    shareBtnText: { fontSize: 11, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },

    codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    codeChip: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: 'rgba(0,0,0,0.25)',
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    codeText: { fontSize: 14, fontWeight: '600', color: TEXT, letterSpacing: 2 },
    qrBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: 'rgba(0,0,0,0.25)',
    },

    friendBlock: { marginTop: 16, gap: 8 },
    faces: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    moreBubble: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#2A2A2A',
        borderWidth: 1,
        borderColor: BORDER,
    },
    moreText: { fontSize: 10, fontWeight: '700', color: DIM },
    pendingLine: { fontSize: 11, fontWeight: '300', color: MUTED, lineHeight: 15 },
});

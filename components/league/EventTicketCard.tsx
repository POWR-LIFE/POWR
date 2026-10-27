import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/social/Avatar';
import { useAuth } from '@/context/AuthContext';
import type { InviteFriend, InviteProgress, LiveEvent } from '@/lib/api/liveEvents';
import { fetchProfile } from '@/lib/api/user';
import { openEventBooking } from '@/lib/eventBookingLink';
import { eventInviteLink, eventInviteMessage } from '@/lib/eventInviteLink';
import i18n from '@/lib/i18n';
import { inviteRewardLine, shortDate } from '@/lib/liveEventDisplay';
import type { Friend } from '@/lib/social/types';

const GOLD = '#E8D200';
// The Home cards' surface (ChallengeCard/TogetherSection): near-black on
// the geometric background, hairline edge — not the League grey.
const CARD_BG = '#111111';
const BORDER = '#222222';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM = 'rgba(255,255,255,0.5)';
const GREEN = '#4ade80';

/** Rows shown before "Show all" — enough to see who's there without the card
 *  turning into a scroll of its own. */
const MAX_ROWS = 3;

/** The Avatar component speaks Friend; invite rows carry no friendship at all. */
function asFriend(f: InviteFriend, i: number): Friend {
    const name = f.display_name ?? f.username ?? i18n.t('events:ticket.friendFallback');
    return {
        id: f.username ?? name ?? `invite-${i}`,
        username: f.username ?? '',
        displayName: name,
        avatarUrl: f.avatar_url,
        status: 'accepted',
    };
}

function friendName(f: InviteFriend): string {
    return f.display_name ?? f.username ?? i18n.t('events:ticket.friendFallback');
}

/**
 * Whether this friend is one of the ones the big number counts. The server
 * decides — it knows the event's basis (entry gate vs invite milestone) and
 * its cut-off date, and the flags it sends sum to the count above. The
 * `?? converted` fallback is for a payload written before the flag existed.
 */
function isCounting(f: InviteFriend): boolean {
    return f.counts_for_event ?? f.converted;
}

/**
 * The one line under each name. It has to answer "why isn't this one in my
 * total?" without ever implying we lost them — every reason here is a real
 * rule of the event, in the order they can apply.
 */
function inviteState(f: InviteFriend, countingConversions: boolean): string {
    if (isCounting(f)) {
        return countingConversions
            ? i18n.t('events:ticket.state.countsWorkout')
            : i18n.t('events:ticket.state.countsSignup');
    }
    // Signups-counted events can only exclude a friend on the date: they
    // joined before this event's invites started counting.
    if (!countingConversions) return i18n.t('events:ticket.state.joinedBefore');
    if (!f.converted) return i18n.t('events:ticket.state.needsWorkout');
    return i18n.t('events:ticket.state.joinedBefore');
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
    const { t } = useTranslation();
    const { user } = useAuth();
    const [code, setCode] = useState<string | null>(null);
    const [displayName, setDisplayName] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [rulesOpen, setRulesOpen] = useState(false);
    const [allFriends, setAllFriends] = useState(false);

    useEffect(() => {
        let active = true;
        fetchProfile().then(p => {
            if (active) {
                setCode(p?.referral_code ?? null);
                setDisplayName(p?.display_name ?? null);
            }
        });
        return () => {
            active = false;
        };
    }, []);

    const gate = event.viewer.gate ?? null;
    // 'deadline' mode: you're on the live board already — the count keeps
    // your place in the final standings. 'entry' (or an older payload with
    // no mode): the count is the door.
    const keepPlace = gate?.mode === 'deadline';
    const gateBy = gate?.deadline_at ? shortDate(gate.deadline_at) : null;
    const milestoneN = invites?.event?.milestone_n ?? event.invite_milestone_n;
    const convertedForEvent = invites?.event?.converted_for_event ?? 0;
    const milestonePaid = invites?.event?.milestone_paid ?? false;

    // Already ordered by the server: the ones that count first, then the
    // newest signups.
    const friends = invites?.friends ?? [];
    const shownFriends = allFriends ? friends : friends.slice(0, MAX_ROWS);
    const countingFriends = friends.filter(isCounting).length;

    const count = gate ? gate.count : convertedForEvent;
    const target = gate ? gate.required : milestoneN;
    const met = gate ? gate.met : milestonePaid;
    const countingConversions = gate ? gate.counting === 'conversions' : true;

    const link = code ? eventInviteLink(event.slug, code) : null;
    const message = link
        ? eventInviteMessage({ eventName: event.name, link, code, bonusPoints: event.invite_bonus_points })
        : null;

    const rules = event.rules ?? [];
    const bookingUrl = event.booking_url ?? null;
    const booking = event.viewer.booking ?? null;
    const bookingConfirmed = booking?.confirmed ?? false;
    // null → "the venue", written into each sentence whole so a translation
    // never has to bend around an inserted article.
    const venueName = event.venue?.name ?? null;

    const handleShare = async () => {
        if (!link || !message) return;
        Haptics.selectionAsync();
        try {
            await Share.share({ message, url: link });
        } catch {
            // user dismissed — no-op
        }
    };

    // Copies the whole invite (code + link), not the bare link: the code is
    // the only part that survives a store install.
    const handleCopy = async () => {
        if (!message) return;
        await Clipboard.setStringAsync(message);
        Haptics.selectionAsync();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <View style={[styles.card, gate && !met && styles.cardGated]}>
            {/* ── Eyebrow with the count on its right: "YOUR TICKET · 0 / 3"
                reads as one line, and the label + bar sit under it. The
                EVENT segment has to fit a screen with the hero and the prizes
                above it, so this card earns its height line by line. */}
            <View style={styles.eyebrowRow}>
                <Text style={styles.eyebrow}>{gate ? t('events:ticket.eyebrow.ticket') : t('events:ticket.eyebrow.invite')}</Text>
                {!met && (
                    <>
                        <Text style={styles.count}>{Math.min(count, target)}</Text>
                        <Text style={styles.countOf}>/ {target}</Text>
                    </>
                )}
            </View>

            {met ? (
                <View style={styles.metRow}>
                    <Ionicons name="lock-open" size={16} color={GOLD} />
                    <Text style={styles.metText}>
                        {gate
                            ? keepPlace ? t('events:ticket.met.keepPlace') : t('events:ticket.met.onBoard')
                            : t('events:ticket.met.milestone')}
                    </Text>
                </View>
            ) : (
                <>
                    <Text style={styles.countLabel} numberOfLines={2}>
                        {countingConversions
                            ? t('events:ticket.countLabel.conversions')
                            : t('events:ticket.countLabel.signups')}
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

            <Text style={styles.explainer} numberOfLines={2}>
                {gate && !met
                    ? keepPlace
                        ? gateBy
                            ? t('events:ticket.explainer.keepPlaceBy', { required: gate.required, date: gateBy, points: event.invite_bonus_points })
                            : t('events:ticket.explainer.keepPlace', { required: gate.required, points: event.invite_bonus_points })
                        : t('events:ticket.explainer.onBoard', { required: gate.required, points: event.invite_bonus_points })
                    : !gate && milestoneN > 0 && event.invite_milestone_bonus > 0
                        ? `${inviteRewardLine(event)} ${t('events:ticket.explainer.milestone', { bonus: event.invite_milestone_bonus, n: milestoneN })}`
                        : inviteRewardLine(event)}
            </Text>

            {/* ── Share is the action this card exists for; code + QR ride
                the same row rather than a second one — until SHARE can't fit
                beside them (larger system text, PARTAGER / COMPARTIR on a
                narrow phone): then the row wraps and SHARE goes full width
                above them, rather than spilling out of its pill. ── */}
            <View style={styles.codeRow}>
                <Pressable
                    style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.85 }]}
                    onPress={handleShare}
                    disabled={!link}
                    accessibilityRole="button"
                    accessibilityLabel={t('events:invite.shareA11y')}
                >
                    <Ionicons name="share-outline" size={14} color="#0a0a0a" />
                    <Text style={styles.shareBtnText} numberOfLines={1} adjustsFontSizeToFit>{t('events:invite.share')}</Text>
                </Pressable>
                <View style={styles.codeTools}>
                    <Pressable
                        style={({ pressed }) => [styles.codeChip, pressed && { opacity: 0.7 }]}
                        onPress={handleCopy}
                        accessibilityRole="button"
                        accessibilityLabel={t('events:invite.copyA11y')}
                    >
                        <Text style={styles.codeText} numberOfLines={1} adjustsFontSizeToFit>{code ?? '········'}</Text>
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
                        accessibilityLabel={t('events:ticket.qrA11y')}
                    >
                        <Ionicons name="qr-code-outline" size={16} color={DIM} />
                    </Pressable>
                    {/* The same invite as SHARE, as a picture: the event card with
                        your code on it, for Stories and chats that want an image. */}
                    <Pressable
                        style={({ pressed }) => [styles.qrBtn, pressed && { opacity: 0.7 }]}
                        onPress={() => router.push({ pathname: '/share-event', params: { slug: event.slug } })}
                        accessibilityRole="button"
                        accessibilityLabel={t('events:invite.cardA11y')}
                    >
                        <Ionicons name="image-outline" size={16} color={DIM} />
                    </Pressable>
                </View>
            </View>

            {/* ── Your physical spot: the venue's own booking system ──
                Hidden until the admin sets booking_url (the link typically
                lands weeks after registrations open). `confirmed` derives from
                the venue's uploaded export by email — positive-only, so the
                unconfirmed copy invites, it never asserts "not booked". */}
            {bookingConfirmed ? (
                <View style={styles.bookedRow}>
                    <Ionicons name="checkmark-circle" size={16} color={GREEN} />
                    <Text style={styles.bookedText}>
                        {venueName != null ? t('events:booking.bookedWith', { venue: venueName }) : t('events:booking.bookedWithVenue')}
                    </Text>
                </View>
            ) : bookingUrl ? (
                <>
                    <Pressable
                        style={({ pressed }) => [styles.bookBtn, pressed && { opacity: 0.85 }]}
                        onPress={() => {
                            Haptics.selectionAsync().catch(() => {});
                            openEventBooking(event, { email: user?.email, name: displayName });
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={
                            venueName != null
                                ? t('events:booking.bookA11y', { venue: venueName })
                                : t('events:booking.bookA11yVenue')
                        }
                    >
                        <Text style={styles.bookBtnText}>{t('events:booking.book')}</Text>
                        <Ionicons name="open-outline" size={14} color="#0a0a0a" />
                    </Pressable>
                    {booking?.opened_at ? (
                        <Text style={styles.bookHint}>
                            {venueName != null
                                ? t('events:booking.syncHint', { venue: venueName })
                                : t('events:booking.syncHintVenue')}
                        </Text>
                    ) : null}
                </>
            ) : null}

            {/* ── Who you've already brought ──
                Named rows, not a stacked avatar pile: the number above is
                only half the answer, and the half people ask about is which
                friends are in it. Every friend you've ever brought is listed,
                including the ones this event doesn't count — a list that
                silently drops them is how "I invited four people and it says
                1" turns into a support message. */}
            {friends.length > 0 && (
                <View style={styles.friendBlock}>
                    <Text style={styles.friendHeading}>
                        {t('events:ticket.friendsCount', {
                            count: countingFriends,
                            total: t('events:ticket.friendsTotal', { count: friends.length }),
                        })}
                    </Text>
                    {shownFriends.map((f, i) => {
                        const counting = isCounting(f);
                        return (
                            <View key={`${f.username ?? f.display_name}-${i}`} style={styles.friendRow}>
                                <Avatar
                                    friend={asFriend(f, i)}
                                    size={30}
                                    completed={counting}
                                    pending={!counting}
                                />
                                <View style={styles.friendText}>
                                    <Text style={styles.friendNameText} numberOfLines={1}>
                                        {friendName(f)}
                                    </Text>
                                    <Text
                                        style={[styles.friendState, counting && styles.friendStateOn]}
                                        numberOfLines={1}
                                    >
                                        {inviteState(f, countingConversions)}
                                    </Text>
                                </View>
                                {counting && <Ionicons name="checkmark-circle" size={16} color={GOLD} />}
                            </View>
                        );
                    })}
                    {friends.length > MAX_ROWS && (
                        <Pressable
                            style={({ pressed }) => [styles.moreToggle, pressed && { opacity: 0.7 }]}
                            onPress={() => setAllFriends(open => !open)}
                            accessibilityRole="button"
                        >
                            <Text style={styles.moreToggleText}>
                                {allFriends ? t('events:ticket.showFewer') : t('events:ticket.showAll', { n: friends.length })}
                            </Text>
                            <Ionicons
                                name={allFriends ? 'chevron-up' : 'chevron-down'}
                                size={12}
                                color={MUTED}
                            />
                        </Pressable>
                    )}
                </View>
            )}

            {/* ── The rules you signed up under — collapsed, always reachable.
                The success sheet shows them once; this is where they live. */}
            {rules.length > 0 && (
                <View style={styles.rulesBlock}>
                    <Pressable
                        style={({ pressed }) => [styles.rulesToggle, pressed && { opacity: 0.7 }]}
                        onPress={() => setRulesOpen(open => !open)}
                        accessibilityRole="button"
                        accessibilityLabel={rulesOpen ? t('events:ticket.rulesHideA11y') : t('events:ticket.rulesShowA11y')}
                    >
                        <Text style={styles.rulesToggleText}>{t('events:ticket.rules')}</Text>
                        <Ionicons
                            name={rulesOpen ? 'chevron-up' : 'chevron-down'}
                            size={13}
                            color={MUTED}
                        />
                    </Pressable>
                    {rulesOpen &&
                        rules.map((rule, i) => (
                            <View key={i} style={styles.ruleRow}>
                                <Text style={styles.ruleBullet}>•</Text>
                                <Text style={styles.ruleText}>{rule}</Text>
                            </View>
                        ))}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 14,
        marginTop: 2,
        borderRadius: 18,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    // An unmet gate is the one thing standing between you and the board —
    // the card says so before you've read a word of it.
    cardGated: { borderColor: 'rgba(232,210,0,0.35)' },

    eyebrowRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
    eyebrow: { flex: 1, fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.6, letterSpacing: 2.5 },

    count: { fontSize: 22, fontWeight: '100', color: GOLD, letterSpacing: -1, lineHeight: 26 },
    countOf: { fontSize: 13, fontWeight: '200', color: DIM, letterSpacing: -0.5 },
    countLabel: { fontSize: 11, fontWeight: '300', color: DIM, marginTop: 4 },
    progressTrack: {
        height: 3,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
        marginTop: 8,
    },
    progressFill: { height: '100%', borderRadius: 2, backgroundColor: GOLD },

    metRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
    metText: { flex: 1, fontSize: 15, fontWeight: '300', color: TEXT, letterSpacing: -0.3 },

    explainer: { fontSize: 11, fontWeight: '300', color: DIM, lineHeight: 15, marginTop: 8 },

    shareBtn: {
        // Sized by its label, never narrower: the row wraps first.
        flexGrow: 1,
        flexShrink: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: GOLD,
        borderRadius: 100,
        paddingVertical: 10,
        paddingHorizontal: 6,
    },
    // Shrinking is the last resort, for a label too wide even for a
    // full-width pill (the largest accessibility text sizes).
    shareBtnText: { flexShrink: 1, fontSize: 11, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },

    codeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
    // The code chip's 118 minimum plus both circles and their gaps — the
    // most this group gives up before SHARE moves to a line of its own.
    codeTools: {
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 118 + 2 * (36 + 8),
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    codeChip: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: 'rgba(0,0,0,0.25)',
        paddingHorizontal: 12,
        paddingVertical: 9,
        minWidth: 118,
    },
    codeText: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: TEXT, letterSpacing: 2 },
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

    bookBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginTop: 10,
        backgroundColor: GOLD,
        borderRadius: 100,
        paddingVertical: 10,
    },
    bookBtnText: { fontSize: 11, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },
    bookHint: { fontSize: 10, fontWeight: '400', color: MUTED, marginTop: 8, lineHeight: 14 },
    bookedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginTop: 10,
    },
    bookedText: { fontSize: 12, fontWeight: '400', color: GREEN },

    rulesBlock: { marginTop: 12, gap: 6 },
    rulesToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    rulesToggleText: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.6, letterSpacing: 2.5 },
    ruleRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    ruleBullet: { fontSize: 11, lineHeight: 16, color: GOLD },
    ruleText: { flex: 1, fontSize: 11, fontWeight: '300', color: DIM, lineHeight: 16 },

    friendBlock: { marginTop: 12, gap: 8 },
    friendHeading: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.6, letterSpacing: 2.5, textTransform: 'uppercase' },
    friendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    friendText: { flex: 1, gap: 1 },
    friendNameText: { fontSize: 13, fontWeight: '400', color: TEXT, letterSpacing: -0.2 },
    friendState: { fontSize: 10.5, fontWeight: '300', color: MUTED },
    friendStateOn: { color: DIM },
    moreToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 2 },
    moreToggleText: { fontSize: 8, fontWeight: '800', color: MUTED, letterSpacing: 2 },
});

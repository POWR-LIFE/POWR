import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { trackTap } from '@/lib/analytics';
import type { SeriesInviteBoard } from '@/lib/api/series';
import { REFERRAL_BONUS_POINTS, seriesInviteLink, seriesInviteMessage } from '@/lib/seriesInvite';
import { inviteNext } from './SeriesInvite';
import { CARD_BG, CARD_BORDER, DIM, GOLD, MUTED, TEXT, TEXT_2 } from './SeriesLane';
import { useSeasonCard } from './season';

/**
 * The Series invite — the live events' ticket card, for the Series. Opens
 * from INVITE A FRIEND (Jamie 10-28: the button went straight to the phone's
 * share sheet; it should offer what the events do): the count, SHARE as the
 * primary, and the code to copy, your QR and the share card beside it.
 *
 * The count is the invite race, read off the server's invite board so it can
 * never disagree with Squad Builder: friends in (joined with your code AND
 * logged a verified workout), the ones still to work out as joining, and the
 * bar is your run at whoever's one place above you. Without a board (mid
 * round, or before the invite period opens) it's the invite alone. No 0 as
 * a stat: with nobody in yet the line is the ask, not a zero.
 */
export function SeriesInviteCard({ board, code, seasonName, startsAt, onCard }: {
    board: SeriesInviteBoard | null;
    code: string | null;
    seasonName: string;
    /** When the round starts (ms): the message says the day, or that it's on. */
    startsAt: number;
    /** The invite as a picture (the share card); hidden when there's nowhere to send it. */
    onCard?: () => void;
}) {
    const { t } = useTranslation();
    const router = useRouter();
    const sc = useSeasonCard();
    const [copied, setCopied] = useState(false);

    const me = board?.open ? board.me : null;
    const friends = me?.friends ?? 0;
    const joining = me?.joining ?? 0;
    // The one place above you: passing them takes one more friend than theirs
    // (ties go to whoever got there first).
    const above = board && me?.rank != null && me.rank > 1 ? board.rows.find((r) => r.rank === me.rank! - 1) : undefined;
    const target = above ? above.friends + 1 : null;
    const fill = me?.rank == null ? null : me.rank === 1 ? 1 : target ? Math.min(1, friends / target) : null;

    const link = code ? seriesInviteLink(code) : null;
    const message = link ? seriesInviteMessage({ seasonName, link, startsAt }) : null;

    const handleShare = async () => {
        if (!link || !message) return;
        trackTap('series_invite', { via: 'share' });
        void Haptics.selectionAsync();
        try {
            await Share.share({ message, url: link });
        } catch {
            // dismissed
        }
    };

    // Copies the whole invite (the words + link), not the bare link, so a
    // pasted invite reads as the sent one.
    const handleCopy = async () => {
        if (!message) return;
        trackTap('series_invite', { via: 'copy' });
        await Clipboard.setStringAsync(message);
        void Haptics.selectionAsync();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <View style={[s.card, sc]}>
            {/* ── Eyebrow with the count on its right: "INVITE FRIENDS · 2 / 3"
                reads as one line — your friends in, and what passes the
                person above you. Nobody in yet: the eyebrow alone. */}
            <View style={s.eyebrowRow}>
                <Text style={s.eyebrow}>{t('series:invite.eyebrow')}</Text>
                {friends > 0 && (
                    <>
                        <Text style={s.count}>{friends}</Text>
                        {target != null && <Text style={s.countOf}>/ {target}</Text>}
                    </>
                )}
                {joining > 0 && <Text style={s.joiningTag}>{t('series:invite.joiningTag', { n: joining })}</Text>}
            </View>

            {me ? (
                <>
                    <Text style={s.countLabel} numberOfLines={2}>
                        {friends > 0 ? t('series:invite.countLabel') : inviteNext(board!)}
                    </Text>
                    {fill != null && (
                        <View style={s.progressTrack}>
                            <View style={[s.progressFill, { width: `${Math.round(fill * 100)}%` }]} />
                        </View>
                    )}
                    {friends > 0 && <Text style={s.next} numberOfLines={1}>{inviteNext(board!)}</Text>}
                </>
            ) : null}

            <Text style={s.explainer} numberOfLines={3}>
                {`${t('events:display.inviteRewardOnWorkout', { points: REFERRAL_BONUS_POINTS })} ${t('series:invite.squad')}`}
            </Text>

            {/* ── Share is the action this card exists for; code + QR + card
                ride the same row, and the row wraps (SHARE full width above
                them) when PARTAGER / COMPARTIR can't fit beside them. ── */}
            <View style={s.codeRow}>
                <Pressable
                    style={({ pressed }) => [s.shareBtn, pressed && { opacity: 0.85 }, !link && { opacity: 0.5 }]}
                    onPress={() => { void handleShare(); }}
                    disabled={!link}
                    accessibilityRole="button"
                    accessibilityLabel={t('events:invite.shareA11y')}
                >
                    <Ionicons name="share-outline" size={14} color="#0a0a0a" />
                    <Text style={s.shareBtnText} numberOfLines={1} adjustsFontSizeToFit>{t('events:invite.share')}</Text>
                </Pressable>
                <View style={[s.codeTools, { minWidth: 118 + (onCard ? 2 : 1) * (36 + 8) }]}>
                    <Pressable
                        style={({ pressed }) => [s.codeChip, pressed && { opacity: 0.7 }]}
                        onPress={() => { void handleCopy(); }}
                        disabled={!message}
                        accessibilityRole="button"
                        accessibilityLabel={t('events:invite.copyA11y')}
                    >
                        <Text style={s.codeText} numberOfLines={1} adjustsFontSizeToFit>{code ?? '········'}</Text>
                        <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color={copied ? GOLD : MUTED} />
                    </Pressable>
                    {/* My QR: the same smart-link, for a friend standing next to you. */}
                    <Pressable
                        style={({ pressed }) => [s.roundBtn, pressed && { opacity: 0.7 }]}
                        onPress={() => { trackTap('series_invite', { via: 'qr' }); router.push('/my-qr'); }}
                        accessibilityRole="button"
                        accessibilityLabel={t('series:invite.qrA11y')}
                    >
                        <Ionicons name="qr-code-outline" size={16} color={DIM} />
                    </Pressable>
                    {/* The same invite as SHARE, as a picture: the season's card
                        with your code on it, for Stories and chats that want an image. */}
                    {onCard && (
                        <Pressable
                            style={({ pressed }) => [s.roundBtn, pressed && { opacity: 0.7 }]}
                            onPress={() => { trackTap('series_invite', { via: 'card' }); onCard(); }}
                            accessibilityRole="button"
                            accessibilityLabel={t('series:invite.cardA11y')}
                        >
                            <Ionicons name="image-outline" size={16} color={DIM} />
                        </Pressable>
                    )}
                </View>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    card: {
        borderRadius: 18,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: CARD_BORDER,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    eyebrowRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
    eyebrow: { flex: 1, fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.6, letterSpacing: 2.5 },
    count: { fontSize: 22, fontWeight: '100', color: GOLD, letterSpacing: -1, lineHeight: 26 },
    countOf: { fontSize: 13, fontWeight: '200', color: DIM, letterSpacing: -0.5 },
    joiningTag: { marginLeft: 6, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.8, color: TEXT_2 },
    countLabel: { fontSize: 11, fontWeight: '300', color: DIM, marginTop: 4 },
    progressTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 8 },
    progressFill: { height: '100%', borderRadius: 2, backgroundColor: GOLD },
    next: { fontSize: 13, fontWeight: '400', color: TEXT, marginTop: 8 },
    explainer: { fontSize: 11, fontWeight: '300', color: DIM, lineHeight: 15, marginTop: 8 },

    codeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
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
    shareBtnText: { flexShrink: 1, fontSize: 11, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },
    // The code chip's 118 minimum plus the circles and their gaps — the most
    // this group gives up before SHARE moves to a line of its own.
    codeTools: { flexGrow: 1, flexBasis: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
    codeChip: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: CARD_BORDER,
        backgroundColor: 'rgba(0,0,0,0.25)',
        paddingHorizontal: 12,
        paddingVertical: 9,
        minWidth: 118,
    },
    codeText: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: TEXT, letterSpacing: 2 },
    roundBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: CARD_BORDER,
        backgroundColor: 'rgba(0,0,0,0.25)',
    },
});

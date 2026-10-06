import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import type { LiveEvent } from '@/lib/api/liveEvents';
import { fetchProfile } from '@/lib/api/user';
import { eventInviteLink, eventInviteMessage } from '@/lib/eventInviteLink';

const GOLD = '#E8D200';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';

/** The one sentence above the buttons: why send it now, in the event's terms. */
function pitch(event: LiveEvent): string {
    if (event.status === 'announced') return 'Registration opens soon — get your friends ready. Your invite code goes with it.';
    if (event.status === 'scheduled') return 'Bring your friends in before scoring starts. Your invite code goes with it.';
    if (event.status === 'live' && !event.is_locked) return 'Still time to bring friends in. Your invite code goes with it.';
    return 'Show people what happened. Your invite code goes with it.';
}

/**
 * Sharing, in plain sight on the event page. The header card's corner icon is
 * easy to miss and the ticket card's share tools only exist once you're
 * registered — so before that (and for a Coming soon event, where sharing is
 * the only thing to do) this is how the event travels:
 *
 *   SHARE CARD → /share-event: the event as a social card with the viewer's
 *                code, posted or sent as a link whose preview IS the card;
 *   SEND LINK  → the system share sheet with the same invite text the ticket
 *                card sends (name, code line, link), so a friend who installs
 *                from the store still arrives with the code.
 *
 * Previews are drafts nobody else can open yet, so the panel says so rather
 * than letting a tester send a link that lands on nothing.
 */
export function EventSharePanel({ event }: { event: LiveEvent }) {
    const router = useRouter();
    const { data: code } = useQuery({
        queryKey: ['eventShare', 'referralCode'],
        queryFn: async () => (await fetchProfile())?.referral_code ?? null,
        staleTime: 10 * 60_000,
    });

    const link = eventInviteLink(event.slug, code ?? null);

    const openCard = () => {
        void Haptics.selectionAsync();
        router.push({ pathname: '/share-event', params: { slug: event.slug } });
    };

    const sendLink = async () => {
        void Haptics.selectionAsync();
        const message = eventInviteMessage({
            eventName: event.name,
            link,
            code: code ?? null,
            bonusPoints: event.invite_bonus_points,
        });
        try {
            await Share.share({ message, url: link });
        } catch {
            // dismissed — nothing to do
        }
    };

    return (
        <View style={styles.card}>
            <Text style={styles.label}>SHARE THE EVENT</Text>
            <Text style={styles.pitch}>{pitch(event)}</Text>

            <View style={styles.row}>
                <Pressable
                    onPress={openCard}
                    style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Share ${event.name} as a card`}
                >
                    <Ionicons name="image-outline" size={15} color="#0a0a0a" />
                    <Text style={[styles.btnText, styles.btnTextPrimary]}>SHARE CARD</Text>
                </Pressable>
                <Pressable
                    onPress={sendLink}
                    style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Send a link to ${event.name}`}
                >
                    <Ionicons name="paper-plane-outline" size={15} color={GOLD} />
                    <Text style={styles.btnText}>SEND LINK</Text>
                </Pressable>
            </View>

            {!!code && (
                <Text style={styles.code}>
                    Your code <Text style={styles.codeValue}>{code}</Text> travels with both.
                </Text>
            )}
            {event.is_preview && (
                <Text style={styles.previewNote}>
                    Preview — friends can open this event once it&apos;s public.
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 14,
        borderRadius: 18,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 18,
        paddingVertical: 16,
        gap: 10,
    },
    label: { fontSize: 10, fontWeight: '800', letterSpacing: 2.5, color: GOLD },
    pitch: { fontSize: 13, fontWeight: '300', color: TEXT, lineHeight: 19 },
    row: { flexDirection: 'row', gap: 10, marginTop: 4 },
    btn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 100,
        paddingVertical: 11,
    },
    btnPrimary: { backgroundColor: GOLD },
    btnGhost: { borderWidth: 1, borderColor: 'rgba(232,210,0,0.6)' },
    btnText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: GOLD },
    btnTextPrimary: { color: '#0a0a0a' },
    code: { fontSize: 11, fontWeight: '400', color: DIM },
    codeValue: { fontWeight: '700', color: TEXT, letterSpacing: 1 },
    previewNote: { fontSize: 11, fontWeight: '400', color: 'rgba(232,210,0,0.75)' },
});

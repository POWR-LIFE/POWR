import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/social/Avatar';
import { colours, fontFamily } from '@/constants/tokens';
import { useFriends } from '@/hooks/useFriends';
import { CREW_MAX, CREW_MIN } from '@/lib/crew';
import { SAMPLE_FRIENDS } from '@/lib/dev/crewPrototype';
import type { Friend } from '@/lib/social/types';

const GOLD = colours.accent;
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const SHEET_BG = '#121212';

/** Friends you can pick — the crew includes you. */
const PICK_MIN = CREW_MIN - 1;
const PICK_MAX = CREW_MAX - 1;

export interface CrewSetupSheetProps {
    visible: boolean;
    onClose: () => void;
    onStart: (friends: Friend[]) => void;
}

/**
 * Pick 2–4 friends, or share a link to someone not on POWR yet. The link is
 * the growth half of Crew Charge: a crew can't charge alone, so starting one
 * is a reason to bring people in.
 */
export function CrewSetupSheet({ visible, onClose, onStart }: CrewSetupSheetProps) {
    const insets = useSafeAreaInsets();
    const { friends, loading } = useFriends();
    const [picked, setPicked] = useState<string[]>([]);

    useEffect(() => {
        if (visible) setPicked([]);
    }, [visible]);

    const eligible = useMemo(() => friends.filter(f => f.status === 'accepted' && f.togetherEnabled !== false), [friends]);
    // Real friends where there are enough to make a crew; stand-ins otherwise,
    // so the flow can still be walked on an account with a thin friend list.
    const usingSamples = !loading && eligible.length < PICK_MIN;
    const list = usingSamples ? SAMPLE_FRIENDS : eligible;

    const toggle = (id: string) => {
        setPicked(p => {
            if (p.includes(id)) return p.filter(x => x !== id);
            if (p.length >= PICK_MAX) return p;
            Haptics.selectionAsync().catch(() => {});
            return [...p, id];
        });
    };

    const shareInvite = async () => {
        try {
            await Share.share({
                message: 'Start a crew with me on POWR. Every move we make charges one battery, and when it’s full we all get a Drop. https://powr.life',
            });
        } catch {
            // Share sheet dismissed or unavailable — nothing to do.
        }
    };

    const ready = picked.length >= PICK_MIN;

    return (
        <Modal visible={visible} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
                <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
                    <View style={styles.handle} />

                    <View style={{ gap: 6 }}>
                        <Text style={styles.label}>CREW CHARGE</Text>
                        <Text style={styles.title}>
                            Pick your crew.
                        </Text>
                        <Text style={styles.body}>
                            {PICK_MIN} to {PICK_MAX} friends. Everyone’s movement fills one battery. Full, you all get a Crew Drop.
                        </Text>
                    </View>

                    <View style={styles.countRow}>
                        <Text style={styles.sectionLabel}>{usingSamples ? 'SAMPLE FRIENDS' : 'YOUR FRIENDS'}</Text>
                        <Text style={styles.count}>
                            {picked.length}
                            <Text style={styles.countDenom}>/{PICK_MAX}</Text>
                        </Text>
                    </View>

                    <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ gap: 6 }}>
                        {loading && eligible.length === 0 && <Text style={styles.body}>Loading your friends…</Text>}
                        {list.map(f => {
                            const on = picked.includes(f.id);
                            const full = !on && picked.length >= PICK_MAX;
                            return (
                                <Pressable
                                    key={f.id}
                                    onPress={() => toggle(f.id)}
                                    disabled={full}
                                    accessibilityRole="checkbox"
                                    accessibilityState={{ checked: on, disabled: full }}
                                    accessibilityLabel={f.displayName}
                                    style={[styles.friendRow, on && styles.friendRowOn, full && { opacity: 0.4 }]}
                                >
                                    <Avatar friend={f} size={36} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.friendName} numberOfLines={1}>{f.displayName}</Text>
                                        {!!f.username && <Text style={styles.friendUser} numberOfLines={1}>@{f.username}</Text>}
                                    </View>
                                    <View style={[styles.check, on && styles.checkOn]}>
                                        {on && <Ionicons name="checkmark" size={14} color={colours.onAccent} />}
                                    </View>
                                </Pressable>
                            );
                        })}
                    </ScrollView>

                    <View style={styles.inviteRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.inviteTitle}>Not on POWR yet?</Text>
                            <Text style={styles.inviteBody}>Send a link. They join your crew when they sign up.</Text>
                        </View>
                        <Pressable onPress={shareInvite} accessibilityRole="button" accessibilityLabel="Share invite link" style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}>
                            <Text style={styles.ghostText}>SHARE LINK</Text>
                        </Pressable>
                    </View>

                    <Pressable
                        onPress={() => onStart(list.filter(f => picked.includes(f.id)))}
                        disabled={!ready}
                        accessibilityRole="button"
                        accessibilityLabel="Start crew"
                        style={({ pressed }) => [styles.cta, !ready && styles.ctaOff, pressed && ready && { opacity: 0.85 }]}
                    >
                        <Text style={[styles.ctaText, !ready && { color: MUTED }]}>
                            {ready ? `START CREW OF ${picked.length + 1}` : `PICK ${PICK_MIN - picked.length} MORE`}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
        backgroundColor: SHEET_BG,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 18,
        paddingTop: 10,
        maxHeight: '88%',
        gap: 16,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 4 },
    label: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 2, color: GOLD },
    title: { fontFamily: fontFamily.light, fontSize: 24, color: TEXT, letterSpacing: -0.4 },
    body: { fontFamily: fontFamily.light, fontSize: 13, lineHeight: 19, color: SECONDARY },

    countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sectionLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 2, color: SECONDARY },
    count: { fontFamily: fontFamily.light, fontSize: 13, color: TEXT, fontVariant: ['tabular-nums'] },
    countDenom: { color: MUTED },

    friendRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255,255,255,0.08)',
        backgroundColor: 'rgba(255,255,255,0.02)',
    },
    friendRowOn: { borderColor: 'rgba(232,210,0,0.5)', backgroundColor: 'rgba(232,210,0,0.05)' },
    friendName: { fontFamily: fontFamily.regular, fontSize: 14, color: TEXT },
    friendUser: { fontFamily: fontFamily.light, fontSize: 11, color: MUTED },
    check: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkOn: { backgroundColor: GOLD, borderColor: GOLD },

    inviteRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(255,255,255,0.08)',
        paddingTop: 14,
    },
    inviteTitle: { fontFamily: fontFamily.regular, fontSize: 13, color: TEXT },
    inviteBody: { fontFamily: fontFamily.light, fontSize: 11.5, color: SECONDARY, marginTop: 2 },
    ghostBtn: { borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
    ghostText: { fontFamily: fontFamily.bold, fontSize: 10, letterSpacing: 1.2, color: GOLD },

    cta: { backgroundColor: GOLD, borderRadius: 24, paddingVertical: 14, alignItems: 'center' },
    ctaOff: { backgroundColor: 'rgba(255,255,255,0.06)' },
    ctaText: { fontFamily: fontFamily.bold, fontSize: 12, letterSpacing: 1.5, color: colours.onAccent },
});

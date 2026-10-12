import * as Haptics from 'expo-haptics';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/social/Avatar';
import { colours, fontFamily } from '@/constants/tokens';
import { formatKm, memberCharge, STEPS_PER_KM, type CrewBattery } from '@/lib/crew';
import type { Friend } from '@/lib/social/types';

const GOLD = colours.accent;
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const SHEET_BG = '#121212';

export interface CrewSheetMember {
    id: string;
    name: string;
    isYou: boolean;
    steps: number;
    minutes: number;
    friend: Friend;
    joined: boolean;
    nudged: boolean;
}

export interface CrewSheetProps {
    visible: boolean;
    name: string;
    members: CrewSheetMember[];
    battery: CrewBattery;
    onNudge: (id: string) => void;
    onClose: () => void;
}

/** Who's put in what today, and a nudge for whoever hasn't moved. */
export function CrewSheet({ visible, name, members, battery, onNudge, onClose }: CrewSheetProps) {
    const insets = useSafeAreaInsets();
    const quietIds = new Set(battery.quiet.map(q => q.id));

    return (
        <Modal visible={visible} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
                <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
                    <View style={styles.handle} />

                    <View style={{ gap: 6 }}>
                        <Text style={styles.title}>{name}</Text>
                        <Text style={styles.body}>
                            Everything anyone does today fills the bar. Full, you each get a Crew Drop. Resets at 06:00.
                        </Text>
                    </View>

                    <View style={{ gap: 8 }}>
                        <View style={styles.barTrack}>
                            <View style={[styles.barFill, { width: `${Math.round(battery.pct * 100)}%` }]} />
                        </View>
                        <Text style={styles.barCaption}>
                            <Text style={styles.em}>{Math.floor(battery.pct * 100)}%</Text>
                            {battery.charged ? ' · charged' : ` · ${formatKm(battery.remainingKm)} to go`}
                        </Text>
                    </View>

                    <View style={{ gap: 6 }}>
                        {members.map(m => {
                            const km = memberCharge(m) / STEPS_PER_KM;
                            const quiet = m.joined && quietIds.has(m.id);
                            return (
                                <View key={m.id} style={styles.member}>
                                    <Avatar friend={m.friend} size={36} pending={!m.joined} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.memberName}>{m.isYou ? 'You' : m.friend.displayName}</Text>
                                        <Text style={styles.memberSub}>
                                            {!m.joined ? 'Invited' : km > 0 ? `${formatKm(km)} today` : 'Not moved yet'}
                                        </Text>
                                    </View>
                                    {quiet && !m.nudged && (
                                        <Pressable
                                            onPress={() => {
                                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                                                onNudge(m.id);
                                            }}
                                            accessibilityRole="button"
                                            accessibilityLabel={`Nudge ${m.name}`}
                                            style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }]}
                                        >
                                            <Text style={styles.ghostText}>Nudge</Text>
                                        </Pressable>
                                    )}
                                    {quiet && m.nudged && <Text style={styles.nudged}>Nudged</Text>}
                                </View>
                            );
                        })}
                    </View>
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
        gap: 20,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 4 },
    title: { fontFamily: fontFamily.light, fontSize: 24, color: TEXT, letterSpacing: -0.4 },
    body: { fontFamily: fontFamily.light, fontSize: 13, lineHeight: 19, color: SECONDARY },

    barTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: 2, backgroundColor: GOLD },
    barCaption: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY },
    em: { fontFamily: fontFamily.medium, color: GOLD },

    member: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
    memberName: { fontFamily: fontFamily.regular, fontSize: 14, color: TEXT },
    memberSub: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, marginTop: 1 },
    ghost: { borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
    ghostText: { fontFamily: fontFamily.medium, fontSize: 12, color: GOLD },
    nudged: { fontFamily: fontFamily.light, fontSize: 12, color: MUTED },
});

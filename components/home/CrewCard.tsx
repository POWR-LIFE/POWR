import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSeasonCard } from '@/components/series/season';
import Animated, { Easing, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { CrewSetupSheet } from '@/components/crew/CrewSetupSheet';
import { CrewSheet, type CrewSheetMember } from '@/components/crew/CrewSheet';
import { CARD_BG, GOLD, GREEN, kit, MUTED, nextResetIso, outcomeLine, SECONDARY, SectionHeader } from '@/components/drop/cardKit';
import { DropReveal } from '@/components/drop/DropReveal';
import { Avatar } from '@/components/social/Avatar';
import { Countdown } from '@/components/social/Countdown';
import { crewBattery, formatKm } from '@/lib/crew';
import { crewSim, useCrewPrototype } from '@/lib/dev/crewPrototype';
import { useDropPrototype } from '@/lib/dev/dropPrototype';
import type { Friend } from '@/lib/social/types';

/** Track strength per crew position — index 0 is always you. */
const SHADES = [1, 0.7, 0.5, 0.36, 0.26];
const MAX_VISIBLE_AVATARS = 5;

/**
 * Crew Charge on Home — a CREW section built exactly like a TOGETHER
 * challenge card (avatars + reward header, light title, labelled track,
 * nudge/time footer), because it is one: a pooled daily goal with friends.
 * Everything anyone does fills the shared track; full means a Crew Drop for
 * everyone. Your own movement is read from the Drop, so one walk moves both.
 */
export function CrewCard({ youName }: { youName: string }) {
    // While the Series is on for the member (always in dev): the card wears the active Series season.
    const sc = useSeasonCard();
    const crew = useCrewPrototype();
    const drop = useDropPrototype();
    const [picking, setPicking] = useState(false);
    const [viewing, setViewing] = useState(false);
    const [revealing, setRevealing] = useState(false);
    const resetAt = useMemo(() => nextResetIso(), []);

    const enter = useSharedValue(0);
    useEffect(() => {
        enter.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
    }, [enter]);
    const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateY: (1 - enter.value) * 10 }] }));

    const you: Friend = { id: 'you', username: '', displayName: youName, status: 'accepted' };
    const members: CrewSheetMember[] = [
        { id: 'you', name: 'You', isYou: true, steps: drop.steps, minutes: drop.minutes, friend: you, joined: true, nudged: false },
        ...crew.mates.map(m => ({
            id: m.friend.id,
            name: m.friend.displayName.split(' ')[0],
            isYou: false,
            steps: m.steps,
            minutes: m.minutes,
            friend: m.friend,
            joined: m.joined,
            nudged: m.nudged,
        })),
    ];
    // Sized to everyone invited, not just who's in so far — otherwise your own
    // steps fill a one-person track while the invites are still out.
    const battery = crewBattery(members.map(m => (m.joined ? m : { ...m, steps: 0, minutes: 0 })));
    const joinedCount = members.filter(m => m.joined).length;

    const shareInvite = async () => {
        try {
            await Share.share({ message: 'Join my crew on POWR. Everything we do fills one bar, and when it’s full we all get a Drop. https://powr.life' });
        } catch {
            // dismissed
        }
    };

    if (crew.phase === 'none') {
        return (
            <View>
                <SectionHeader label="Crew" />
                {/* TogetherSection's slim empty doorway, word for word in shape. */}
                <Pressable
                    style={({ pressed }) => [kit.emptySlim, pressed && { opacity: 0.9 }]}
                    onPress={() => setPicking(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Start a crew"
                >
                    <View style={kit.emptySlimIcon}>
                        <Ionicons name="people" size={15} color={GOLD} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={kit.emptySlimTitle}>Start a crew</Text>
                        <Text style={kit.emptySlimBody}>2–4 friends, one shared daily goal, a Drop for everyone.</Text>
                    </View>
                    <Ionicons name="arrow-forward" size={16} color={SECONDARY} />
                </Pressable>
                <CrewSetupSheet
                    visible={picking}
                    onClose={() => setPicking(false)}
                    onStart={friends => {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                        crewSim.start(friends, `${youName.split(' ')[0]}’s crew`);
                        setPicking(false);
                    }}
                />
            </View>
        );
    }

    const forming = crew.phase === 'forming';
    const charged = crew.phase === 'active' && battery.charged;
    const ready = charged && !crew.opened;
    const opened = charged && crew.opened;
    const invited = members.filter(m => !m.joined);
    const quiet = members.find(m => m.joined && battery.quiet.some(q => q.id === m.id));

    const waitingLabel = invited.length === 1 ? `Waiting on ${invited[0].name}` : `Waiting on ${invited.length} to accept`;

    return (
        <View>
            <SectionHeader label="Crew" action={{ text: 'Invite', icon: 'add', onPress: shareInvite }} />

            <Animated.View style={enterStyle}>
                <Pressable
                    onPress={() => setViewing(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${crew.name}`}
                    style={({ pressed }) => [kit.card, sc, ready && kit.cardLit, pressed && { opacity: 0.95 }]}
                >
                    {/* Who's in + where the bar is */}
                    <View style={kit.header}>
                        <View style={styles.avatars}>
                            {members.slice(0, MAX_VISIBLE_AVATARS).map((m, i) => (
                                <View key={m.id} style={[styles.avatarWrap, i > 0 && { marginLeft: -10 }]}>
                                    <Avatar friend={m.friend} size={30} pending={!m.joined} />
                                </View>
                            ))}
                        </View>
                        {opened && crew.reward ? (
                            <View style={kit.points}>
                                <Text style={kit.pointsValue}>{crew.reward.headline}</Text>
                                <Text style={kit.pointsLabel}>each</Text>
                            </View>
                        ) : (
                            <View style={kit.points}>
                                <Text style={kit.pointsValue}>{Math.floor(battery.pct * 100)}%</Text>
                                <Text style={kit.pointsLabel}>charged</Text>
                            </View>
                        )}
                    </View>

                    <View style={kit.titleBlock}>
                        <View style={kit.titleRow}>
                            <Ionicons name="people-outline" size={18} color={GOLD} />
                            <Text style={kit.title} numberOfLines={1}>{crew.name}</Text>
                        </View>
                        <Text style={kit.goal}>Everyone’s movement fills one bar. Full, you each get a Crew Drop.</Text>
                    </View>

                    {opened && crew.reward ? (
                        <View style={kit.outcomeBlock}>
                            <Ionicons name="checkmark-circle" size={15} color={GREEN} />
                            <Text style={kit.outcomeText} numberOfLines={2}>{outcomeLine(crew.reward)}</Text>
                        </View>
                    ) : (
                        <View style={kit.progressBlock}>
                            <View style={kit.progressMeta}>
                                <Text style={kit.progressLabel} numberOfLines={1}>{forming ? waitingLabel : 'Group total'}</Text>
                                {!forming && (
                                    <Text style={kit.progressValue}>
                                        {charged ? 'Charged' : `${formatKm(battery.remainingKm)} to go`}
                                    </Text>
                                )}
                            </View>
                            <View style={[kit.track, styles.segments]}>
                                {battery.slices.map((s, i) =>
                                    s.share > 0 ? (
                                        <Animated.View
                                            key={s.id}
                                            layout={LinearTransition.duration(500)}
                                            style={[styles.segment, { width: `${s.share * 100}%`, opacity: SHADES[i] ?? 0.25 }]}
                                        />
                                    ) : null,
                                )}
                            </View>
                        </View>
                    )}

                    {ready ? (
                        <Pressable
                            onPress={() => {
                                Haptics.selectionAsync().catch(() => {});
                                crewSim.prepare();
                                setRevealing(true);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Open the Crew Drop"
                            style={({ pressed }) => [kit.acceptBtn, pressed && { opacity: 0.85 }]}
                        >
                            <Text style={kit.acceptText}>Open the Crew Drop</Text>
                        </Pressable>
                    ) : (
                        <View style={kit.footer}>
                            {forming ? (
                                <View />
                            ) : quiet && !charged ? (
                                quiet.nudged ? (
                                    <Text style={kit.footerMuted}>Nudged {quiet.name}</Text>
                                ) : (
                                    <Pressable
                                        hitSlop={8}
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                                            crewSim.nudge(quiet.id);
                                        }}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Nudge ${quiet.name}`}
                                    >
                                        <Text style={kit.footerGold}>Nudge {quiet.name}</Text>
                                    </Pressable>
                                )
                            ) : (
                                <Text style={kit.footerMuted}>{opened ? 'Next charge' : `${joinedCount} moving`}</Text>
                            )}
                            {forming ? (
                                <View style={styles.timeChip}>
                                    <Ionicons name="hourglass-outline" size={11} color={MUTED} />
                                    <Text style={[kit.timeText, { color: MUTED }]}>Not started</Text>
                                </View>
                            ) : (
                                <Countdown endsAt={resetAt} iconName="time-outline" iconColor={SECONDARY} style={kit.timeText} suffix={opened ? '' : ' left'} />
                            )}
                        </View>
                    )}
                </Pressable>
            </Animated.View>

            <CrewSheet
                visible={viewing}
                name={crew.name}
                members={members}
                battery={battery}
                onNudge={crewSim.nudge}
                onClose={() => setViewing(false)}
            />

            <DropReveal
                visible={revealing}
                kicker={`CREW DROP  ·  ${joinedCount} OF YOU`}
                subtitle="Charged by your crew"
                reward={crew.reward}
                onOpened={crewSim.markOpened}
                onClose={() => setRevealing(false)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    avatars: { flexDirection: 'row', alignItems: 'center' },
    avatarWrap: { borderRadius: 18, borderWidth: 1.5, borderColor: CARD_BG },
    segments: { flexDirection: 'row', gap: 1 },
    segment: { height: 4, backgroundColor: GOLD },
    timeChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});

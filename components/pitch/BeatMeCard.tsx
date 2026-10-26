import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSeasonCard } from '@/components/series/season';

import { CARD_BG, GOLD, GREEN, kit, MUTED, nextMidnightIso, SECONDARY, SectionHeader, StatusChip } from '@/components/drop/cardKit';
import { Avatar } from '@/components/social/Avatar';
import { Countdown } from '@/components/social/Countdown';
import { formatSteps } from '@/lib/drop';
import { useDropPrototype } from '@/lib/dev/dropPrototype';
import { pitchSim, usePitchPrototype } from '@/lib/dev/pitchPrototype';
import type { Friend } from '@/lib/social/types';

const RIVAL: Friend = { id: 'sample-james', username: 'james', displayName: 'James', status: 'accepted', togetherEnabled: true };

/**
 * BEAT ME — one rival, today only. The pitch measures it in POWR ("James is
 * 340 POWR ahead"), but daily earn is capped (walking 5, gym 30), so a POWR
 * gap that size can't happen in a day. It's measured in steps here, which is
 * what actually moves minute to minute.
 *
 * Most members have no friends on POWR yet, so the rival falls back to your
 * own yesterday ("by this time yesterday you'd done 6,600 steps") — the same
 * race, playable alone, on day one.
 */
export function BeatMeCard({ youName }: { youName: string }) {
    // Off-season card. During a Series round Home shows SeriesRivalCard
    // instead (app/(tabs)/index.tsx decides, from useSeriesToday).
    return <BeatMeClassic youName={youName} />;
}

function BeatMeClassic({ youName }: { youName: string }) {
    // While the Series is on for the member (always in dev): the card wears the active Series season.
    const sc = useSeasonCard();
    const pitch = usePitchPrototype();
    const drop = useDropPrototype();
    const resetAt = useMemo(() => nextMidnightIso(), []);
    const you: Friend = { id: 'you', username: '', displayName: youName, status: 'accepted' };

    const mine = drop.steps;
    const theirs = pitch.beatMe.rivalSteps;
    const gap = theirs - mine;
    const ahead = gap < 0;
    const { phase } = pitch.beatMe;
    const max = Math.max(mine, theirs, 1);
    const solo = pitch.beatMe.rival === 'yesterday';
    const name = solo ? 'Yesterday' : RIVAL.displayName;
    // Copy per rival: a friend is "him"; yesterday is "it".
    const copy = solo
        ? {
            suggest: 'Yesterday is ahead',
            suggestAhead: 'You’re ahead of yesterday',
            goalAhead: `${formatSteps(-gap)} steps clear of this time yesterday. Make it count.`,
            ctaAhead: 'Race yesterday',
            live: 'You vs yesterday',
            won: 'You beat yesterday',
            lost: 'Yesterday held on',
            goal: `By this time yesterday you’d done ${formatSteps(theirs)} steps. Beat it before midnight.`,
            liveGoal: 'Today only. More steps than yesterday by midnight takes it.',
            cta: 'Beat yesterday',
            pass: 'to pass it',
            chipLost: 'Yesterday won',
        }
        : {
            suggest: 'James is ahead today',
            suggestAhead: 'You’re ahead of James',
            goalAhead: `${formatSteps(-gap)} steps clear. Make it official before midnight.`,
            ctaAhead: 'Race James today',
            live: 'You vs James',
            won: 'You beat James',
            lost: 'James held on',
            goal: `${formatSteps(Math.max(0, gap))} steps between you. Catch him before midnight.`,
            liveGoal: 'Today only. Whoever has more steps at midnight takes it.',
            cta: 'Beat James today',
            pass: 'to pass him',
            chipLost: 'James won',
        };

    return (
        <View>
            <SectionHeader label="Head to head" />
            <View style={[kit.card, sc, phase === 'live' && ahead && kit.cardLit]}>
                <View style={kit.header}>
                    <View style={styles.avatars}>
                        <View style={styles.avatarWrap}><Avatar friend={you} size={30} /></View>
                        <View style={[styles.avatarWrap, { marginLeft: -10 }]}>
                            {solo ? (
                                <View style={styles.yesterday}>
                                    <Ionicons name="time-outline" size={15} color={SECONDARY} />
                                </View>
                            ) : (
                                <Avatar friend={RIVAL} size={30} />
                            )}
                        </View>
                    </View>
                    {phase === 'ended' ? (
                        <StatusChip icon={ahead ? 'trophy-outline' : 'close-circle-outline'} text={ahead ? 'You won' : copy.chipLost} tone={ahead ? 'green' : 'muted'} />
                    ) : (
                        <View style={kit.points}>
                            <Text style={kit.pointsValue}>{formatSteps(Math.abs(gap))}</Text>
                            <Text style={kit.pointsLabel}>{ahead ? 'steps ahead' : 'steps behind'}</Text>
                        </View>
                    )}
                </View>

                <View style={kit.titleBlock}>
                    <View style={kit.titleRow}>
                        <Ionicons name="flash-outline" size={18} color={GOLD} />
                        <Text style={kit.title} numberOfLines={1}>
                            {phase === 'suggest' ? (ahead ? copy.suggestAhead : copy.suggest) : phase === 'live' ? copy.live : ahead ? copy.won : copy.lost}
                        </Text>
                    </View>
                    <Text style={kit.goal}>
                        {phase === 'suggest' ? (ahead ? copy.goalAhead : copy.goal) : phase === 'live' ? copy.liveGoal : 'Go again tomorrow.'}
                    </Text>
                </View>

                {phase !== 'suggest' && (
                    <View style={kit.progressBlock}>
                        <Bar label="You" value={mine} max={max} lead={mine >= theirs} />
                        <Bar label={name} value={theirs} max={max} lead={theirs > mine} />
                    </View>
                )}

                {phase === 'suggest' ? (
                    <Pressable
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                            pitchSim.startBeatMe();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={ahead ? copy.ctaAhead : copy.cta}
                        style={({ pressed }) => [kit.acceptBtn, pressed && { opacity: 0.85 }]}
                    >
                        <Text style={kit.acceptText}>{ahead ? copy.ctaAhead : copy.cta}</Text>
                    </Pressable>
                ) : phase === 'live' ? (
                    <View style={kit.footer}>
                        <Text style={ahead ? kit.footerGold : kit.footerMuted}>
                            {ahead ? `You’re ahead by ${formatSteps(-gap)}` : `${formatSteps(gap)} ${copy.pass}`}
                        </Text>
                        <Countdown endsAt={resetAt} iconName="time-outline" iconColor={SECONDARY} style={kit.timeText} />
                    </View>
                ) : (
                    <View style={kit.outcomeBlock}>
                        <Ionicons name={ahead ? 'checkmark-circle' : 'close-circle-outline'} size={15} color={ahead ? GREEN : MUTED} />
                        <Text style={[kit.outcomeText, !ahead && { color: SECONDARY }]}>
                            {ahead ? `Won by ${formatSteps(-gap)} steps` : `Lost by ${formatSteps(gap)} steps`}
                        </Text>
                    </View>
                )}
            </View>
        </View>
    );
}

function Bar({ label, value, max, lead }: { label: string; value: number; max: number; lead: boolean }) {
    return (
        <View style={{ gap: 6 }}>
            <View style={kit.progressMeta}>
                <Text style={kit.progressLabel}>{label}</Text>
                <Text style={[kit.progressValue, !lead && { color: SECONDARY }]}>{formatSteps(value)}</Text>
            </View>
            <View style={kit.track}>
                <View style={[kit.fill, { width: `${(value / max) * 100}%` }, !lead && { backgroundColor: MUTED }]} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    avatars: { flexDirection: 'row', alignItems: 'center' },
    avatarWrap: { borderRadius: 18, borderWidth: 1.5, borderColor: CARD_BG },
    yesterday: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center' },
});

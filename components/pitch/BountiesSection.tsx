import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';

import { GOLD, GREEN, kit, nextMidnightIso, SECONDARY, SectionHeader, StatusChip } from '@/components/drop/cardKit';
import { Countdown } from '@/components/social/Countdown';
import { formatSteps } from '@/lib/drop';
import { useDropPrototype } from '@/lib/dev/dropPrototype';
import { usePitchPrototype } from '@/lib/dev/pitchPrototype';

interface Bounty {
    key: string;
    chip: string;
    chipIcon: keyof typeof Ionicons.glyphMap;
    reward: string;
    rewardLabel: string;
    title: string;
    cap: number;
    claimed: number;
    unit: 'min' | 'steps';
    need: number;
}

/**
 * BOUNTIES — limited, first-come rewards that show their inventory running
 * out (the pitch's "184 / 300 claimed"). One area bounty, one sponsored by a
 * real partner. Rewards are sized to the economy (+50 POWR, not 1,000). At
 * today's scale the cap is what 15 active people can actually fill.
 */
export function BountiesSection() {
    const pitch = usePitchPrototype();
    const drop = useDropPrototype();
    const endsAt = useMemo(() => nextMidnightIso(), []);
    const today = pitch.scale === 'today';
    const extra = Math.floor((pitch.bounty.claimed - 184) / 20);

    const bounties: Bounty[] = [
        {
            key: 'area',
            chip: 'Battersea',
            chipIcon: 'location-outline',
            reward: '+50',
            rewardLabel: 'POWR',
            title: 'Battersea Bounty',
            cap: today ? 10 : 300,
            claimed: today ? Math.min(10, 2 + extra) : pitch.bounty.claimed,
            unit: 'min',
            need: 30,
        },
        {
            key: 'partner',
            chip: 'Partner · HUEL',
            chipIcon: 'pricetag-outline',
            reward: '£10',
            rewardLabel: 'credit',
            title: 'HUEL Bounty',
            cap: today ? 10 : 500,
            claimed: today ? Math.min(10, 1 + extra) : pitch.bounty.partnerClaimed,
            unit: 'steps',
            need: 10000,
        },
    ];

    return (
        <View>
            <SectionHeader label="Bounties" />
            <View style={{ gap: 10 }}>
                {bounties.map(b => {
                    const left = Math.max(0, b.cap - b.claimed);
                    const mine = b.unit === 'min' ? drop.minutes : drop.steps;
                    const done = mine >= b.need;
                    const gotIn = done && left > 0;
                    return (
                        <View key={b.key} style={[kit.card, gotIn && kit.cardLit]}>
                            <View style={kit.header}>
                                <StatusChip icon={b.chipIcon} text={b.chip} tone={b.key === 'partner' ? 'gold' : 'muted'} />
                                <View style={kit.points}>
                                    <Text style={kit.pointsValue}>{b.reward}</Text>
                                    <Text style={kit.pointsLabel}>{b.rewardLabel}</Text>
                                </View>
                            </View>

                            <View style={kit.titleBlock}>
                                <View style={kit.titleRow}>
                                    <Ionicons name="flag-outline" size={18} color={GOLD} />
                                    <Text style={kit.title} numberOfLines={1}>{b.title}</Text>
                                </View>
                                <Text style={kit.goal}>
                                    First {b.cap.toLocaleString('en-GB')} to {b.unit === 'min' ? `log ${b.need} active minutes` : `hit ${formatSteps(b.need)} steps`} before midnight.
                                </Text>
                            </View>

                            <View style={kit.progressBlock}>
                                <View style={kit.progressMeta}>
                                    <Text style={kit.progressLabel}>Left</Text>
                                    <Text style={kit.progressValue}>
                                        {left.toLocaleString('en-GB')} of {b.cap.toLocaleString('en-GB')}
                                    </Text>
                                </View>
                                {/* The inventory draining — this bar only goes down. */}
                                <View style={kit.track}>
                                    <View style={[kit.fill, { width: `${(left / b.cap) * 100}%` }]} />
                                </View>
                                {!gotIn && (
                                    <Text style={kit.momentumLine}>
                                        <Text style={kit.momentumLabel}>You </Text>
                                        {b.unit === 'min'
                                            ? `${Math.min(mine, b.need)} / ${b.need} active min`
                                            : `${formatSteps(Math.min(mine, b.need))} / ${formatSteps(b.need)} steps`}
                                    </Text>
                                )}
                            </View>

                            {gotIn ? (
                                <View style={kit.outcomeBlock}>
                                    <Ionicons name="checkmark-circle" size={15} color={GREEN} />
                                    <Text style={kit.outcomeText}>You got one. {b.reward} {b.rewardLabel} is yours.</Text>
                                </View>
                            ) : (
                                <View style={kit.footer}>
                                    <Text style={left > 0 ? kit.footerGold : kit.footerMuted}>
                                        {left > 0 ? `${left} left` : 'All claimed'}
                                    </Text>
                                    <Countdown endsAt={endsAt} iconName="time-outline" iconColor={SECONDARY} style={kit.timeText} />
                                </View>
                            )}
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

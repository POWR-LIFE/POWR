import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { GOLD, kit, MUTED, SECONDARY, SectionHeader } from '@/components/drop/cardKit';
import { fontFamily } from '@/constants/tokens';
import { todayTarget, useDropPrototype } from '@/lib/dev/dropPrototype';
import { usePitchPrototype } from '@/lib/dev/pitchPrototype';
import { dropProgress, nextMove } from '@/lib/drop';
import { compact, peopleToPass, pulseBase, pulseRank, stepsToKm } from '@/lib/pitch';

/** Steps the prototype starts the day on — rank movement is measured from here. */
const DAY_START_STEPS = 3200;

/**
 * POWR PULSE + NEXT MOVE, the pitch's opening: how many are moving right now,
 * where you stand today, and the one move that matters. The SIM's SCALE chip
 * swaps between prod as it is (two people moving) and the pitch's picture
 * (2,814) — the card is only as alive as the numbers in it.
 */
export function PulseCard() {
    const pitch = usePitchPrototype();
    const drop = useDropPrototype();
    const base = pulseBase(pitch.scale);

    // A live count drifts; prod-sized numbers barely do.
    const [moving, setMoving] = useState(base.movingNow);
    useEffect(() => {
        setMoving(base.movingNow);
        const spread = pitch.scale === 'pitch' ? 14 : 1;
        const id = setInterval(() => {
            setMoving(m => Math.max(0, Math.round(m + (Math.random() - 0.45) * spread)));
        }, 2500);
        return () => clearInterval(id);
    }, [base.movingNow, pitch.scale]);

    const dot = useSharedValue(1);
    useEffect(() => {
        dot.value = withRepeat(withSequence(withTiming(0.3, { duration: 900 }), withTiming(1, { duration: 900 })), -1);
    }, [dot]);
    const dotStyle = useAnimatedStyle(() => ({ opacity: dot.value }));

    const added = Math.max(0, drop.steps - DAY_START_STEPS);
    const rank = pulseRank(base, added);
    const rankUp = base.rankUp + (base.rank - rank);

    const tier = todayTarget(drop);
    let next: React.ReactNode;
    if (drop.opened || dropProgress(tier, drop.steps, drop.minutes) >= 1) {
        next = <>Today’s Drop is open. <Text style={styles.nextEm}>Keep climbing.</Text></>;
    } else {
        const move = nextMove(tier, drop.steps, drop.minutes);
        const stepsLeft = Math.max(0, tier.steps - drop.steps);
        const km = stepsToKm(stepsLeft);
        const pass = peopleToPass(base, rank, stepsLeft);
        next = move.route === 'steps' ? (
            <>
                <Text style={styles.nextEm}>{km.toFixed(1)} km</Text>  ·  pass {pass} {pass === 1 ? 'person' : 'people'}  ·  opens today’s Drop
            </>
        ) : (
            <>
                <Text style={styles.nextEm}>{move.left}</Text>  ·  opens today’s Drop
            </>
        );
    }

    return (
        <View>
            <SectionHeader label="POWR Pulse" />
            <View style={kit.card}>
                <View style={kit.header}>
                    <View style={[kit.chip, kit.chipGold]}>
                        <Animated.View style={[styles.liveDot, dotStyle]} />
                        <Text style={[kit.chipText, { color: GOLD }]}>Live · London</Text>
                    </View>
                    <View style={kit.points}>
                        <Text style={kit.pointsValue}>#{rank.toLocaleString('en-GB')}</Text>
                        <Text style={kit.pointsLabel}>today</Text>
                    </View>
                </View>

                <View style={kit.titleBlock}>
                    <View style={kit.titleRow}>
                        <Ionicons name="pulse" size={18} color={GOLD} />
                        <Text style={kit.title} numberOfLines={1}>
                            {moving.toLocaleString('en-GB')} {moving === 1 ? 'person' : 'people'} moving now
                        </Text>
                    </View>
                    <Text style={kit.goal}>
                        London has earned {compact(base.cityPowr)} POWR today
                        {base.areas ? ` · ${base.areas.lead} is beating ${base.areas.trail}` : ''}
                    </Text>
                </View>

                <View style={kit.progressBlock}>
                    <View style={kit.progressMeta}>
                        <Text style={kit.progressLabel}>You · of {base.of.toLocaleString('en-GB')} today</Text>
                        <Text style={kit.progressValue}>↑ {rankUp} {rankUp === 1 ? 'place' : 'places'}</Text>
                    </View>
                    <View style={kit.track}>
                        <View style={[kit.fill, { width: `${Math.round((1 - (rank - 1) / Math.max(1, base.of - 1)) * 100)}%` }]} />
                    </View>
                    <Text style={kit.momentumLine}>
                        <Text style={kit.momentumLabel}>Friends </Text>
                        {base.friendsActive} active today
                    </Text>
                </View>

                {/* NEXT MOVE — the pitch's one clear objective */}
                <View style={styles.next}>
                    <Text style={styles.nextLabel}>NEXT MOVE</Text>
                    <Text style={styles.nextLine}>{next}</Text>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
    next: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(255,255,255,0.07)',
        paddingTop: 12,
        gap: 4,
    },
    nextLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1.5, color: MUTED },
    nextLine: { fontFamily: fontFamily.light, fontSize: 13, lineHeight: 18, color: SECONDARY },
    nextEm: { fontFamily: fontFamily.semiBold, color: GOLD },
});

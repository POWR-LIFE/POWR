import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { BORDER, FAINT, GOLD, MUTED, SECONDARY, TEXT } from '@/components/drop/cardKit';
import { fontFamily } from '@/constants/tokens';
import { DROP_POOLS, DROP_TIERS, formatSteps, type DropReward, type DropTier } from '@/lib/drop';

/** How many of the three bars each target lights: a bigger move, a bigger Drop. */
const BARS: Record<DropTier, number> = { light: 1, steady: 2, long: 3 };
const BAR_H = [8, 12, 16];

/**
 * The morning pick: three tiles, each with a three-bar size mark (one, two or
 * three lit) — not the P, which Home already carries on the level badge and
 * the reveal keeps for itself. Under them, what the chosen size can hold.
 */
export function TargetTiles({ choice, onChoose }: { choice: DropTier; onChoose: (t: DropTier) => void }) {
    return (
        <View style={{ gap: 14 }}>
            <View style={s.row} accessibilityRole="radiogroup">
                {DROP_TIERS.map(t => (
                    <Tile
                        key={t.id}
                        id={t.id}
                        label={t.label}
                        steps={t.steps}
                        minutes={t.minutes}
                        on={t.id === choice}
                        onPress={() => {
                            if (t.id !== choice) Haptics.selectionAsync().catch(() => {});
                            onChoose(t.id);
                        }}
                    />
                ))}
            </View>

            <Animated.View key={choice} entering={FadeIn.duration(220)} style={s.inside}>
                <Text style={s.insideLabel}>Could be inside</Text>
                <View style={s.chips}>
                    {DROP_POOLS[choice].map(r => (
                        <View key={r.kind} style={s.chip}>
                            <Text style={s.chipText}>{teaser(r)}</Text>
                        </View>
                    ))}
                </View>
            </Animated.View>
        </View>
    );
}

function Tile({ id, label, steps, minutes, on, onPress }: {
    id: DropTier; label: string; steps: number; minutes: number; on: boolean; onPress: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            style={({ pressed }) => [s.tile, on && s.tileOn, pressed && { opacity: 0.85 }]}
        >
            <View style={s.bars}>
                {BAR_H.map((h, i) => (
                    <View
                        key={h}
                        style={[
                            s.bar,
                            { height: h },
                            i < BARS[id] ? { backgroundColor: on ? GOLD : '#5A5A5A' } : s.barOff,
                        ]}
                    />
                ))}
            </View>
            <View style={{ gap: 2 }}>
                <Text style={[s.label, !on && s.labelOff]}>{label}</Text>
                <Text style={s.spec}>{formatSteps(steps)} steps</Text>
                <Text style={s.alt}>or {minutes} min</Text>
            </View>
        </Pressable>
    );
}

/** One short phrase per possible reward: "+20 POWR", "2× next workout". */
export function teaser(r: DropReward): string {
    switch (r.kind) {
        case 'points': return `${r.headline} POWR`;
        case 'vault': return `${r.headline} to your Vault`;
        case 'boost': return `${r.headline} next workout`;
        case 'partner': return `${r.headline.toLowerCase()} at a partner`;
        case 'event': return 'Free event entry';
        case 'series': return r.series === 'ticket' ? '+1 Draw ticket' : '2× Series points';
    }
}

const s = StyleSheet.create({
    row: { flexDirection: 'row', gap: 8 },
    tile: {
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 12,
        paddingTop: 14,
        paddingBottom: 12,
        gap: 12,
    },
    tileOn: { borderColor: 'rgba(232,210,0,0.35)', backgroundColor: 'rgba(232,210,0,0.05)' },
    bars: { height: 16, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
    bar: { width: 4, borderRadius: 1.5 },
    barOff: { backgroundColor: '#262626' },
    label: { fontFamily: fontFamily.regular, fontSize: 15, color: TEXT, letterSpacing: -0.2 },
    labelOff: { color: '#BBBBBB' },
    spec: { fontFamily: fontFamily.regular, fontSize: 11, color: SECONDARY },
    alt: { fontFamily: fontFamily.regular, fontSize: 10, color: MUTED },

    inside: { gap: 8 },
    insideLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1.5, color: FAINT, textTransform: 'uppercase' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { borderRadius: 100, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 5 },
    chipText: { fontFamily: fontFamily.regular, fontSize: 11, color: '#CCCCCC' },
});

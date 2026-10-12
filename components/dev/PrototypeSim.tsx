import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInLeft, FadeOutLeft } from 'react-native-reanimated';

import { fontFamily } from '@/constants/tokens';
import { crewSim } from '@/lib/dev/crewPrototype';
import { dropSim } from '@/lib/dev/dropPrototype';

/**
 * DESIGN SCAFFOLD — one floating SIM button for the Drop and Crew prototypes,
 * so the cards themselves look like the real thing instead of carrying a row
 * of dev chips each. Rendered only behind DROP_PROTOTYPE (false outside
 * __DEV__). Chip labels double as accessibility labels for the web harness.
 */
export function PrototypeSim() {
    const [open, setOpen] = useState(false);

    const groups: { title: string; chips: { label: string; run: () => void }[] }[] = [
        {
            title: 'DROP',
            chips: [
                { label: '+1K STEPS', run: () => dropSim.addSteps(1000) },
                { label: '+10 MIN', run: () => dropSim.addMinutes(10) },
                { label: 'COMEBACK', run: dropSim.comeback },
                { label: 'NEW DAY', run: dropSim.newDay },
            ],
        },
        {
            title: 'CREW',
            chips: [
                { label: 'THEY JOIN', run: crewSim.allJoin },
                { label: 'CREW MOVES', run: crewSim.crewMoves },
                { label: 'NUDGED ONE MOVES', run: crewSim.nudgedMove },
                { label: 'NO CREW', run: crewSim.reset },
            ],
        },
    ];

    return (
        // A slim tab on the left edge, mid-screen: the cards' buttons all sit on
        // the right, so nothing real is ever under it.
        <View pointerEvents="box-none" style={styles.wrap}>
            <Pressable
                onPress={() => setOpen(o => !o)}
                accessibilityRole="button"
                accessibilityLabel={open ? 'Close simulator' : 'Open simulator'}
                hitSlop={{ top: 8, bottom: 8, right: 10 }}
                style={({ pressed }) => [styles.tab, open && styles.tabOpen, pressed && { opacity: 0.7 }]}
            >
                <Text style={[styles.tabText, open && { color: '#ddd' }]}>{open ? '×' : 'SIM'}</Text>
            </Pressable>
            {open && (
                <Animated.View entering={FadeInLeft.duration(180)} exiting={FadeOutLeft.duration(140)} style={styles.panel}>
                    {groups.map(g => (
                        <View key={g.title} style={styles.group}>
                            <Text style={styles.groupTitle}>{g.title}</Text>
                            <View style={styles.chips}>
                                {g.chips.map(c => (
                                    <Pressable
                                        key={c.label}
                                        onPress={c.run}
                                        accessibilityRole="button"
                                        accessibilityLabel={c.label}
                                        style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}
                                    >
                                        <Text style={styles.chipText}>{c.label}</Text>
                                    </Pressable>
                                ))}
                            </View>
                        </View>
                    ))}
                </Animated.View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { position: 'absolute', left: 0, top: '42%', flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    panel: {
        width: 268,
        backgroundColor: '#151515',
        borderRadius: 14,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#3a3a3a',
        padding: 12,
        gap: 12,
    },
    group: { gap: 6 },
    groupTitle: { fontFamily: fontFamily.medium, fontSize: 8, letterSpacing: 1.8, color: '#666' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: '#3a3a3a', paddingHorizontal: 10, paddingVertical: 6 },
    chipText: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1.2, color: '#aaa' },
    tab: {
        width: 18,
        height: 58,
        borderTopRightRadius: 9,
        borderBottomRightRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(21,21,21,0.92)',
        borderWidth: 1,
        borderLeftWidth: 0,
        borderStyle: 'dashed',
        borderColor: '#444',
    },
    tabOpen: { borderColor: '#666' },
    tabText: {
        width: 40,
        textAlign: 'center',
        transform: [{ rotate: '-90deg' }],
        fontFamily: fontFamily.medium,
        fontSize: 8,
        letterSpacing: 1.6,
        color: '#888',
    },
});

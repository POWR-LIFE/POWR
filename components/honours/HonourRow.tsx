import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type Honour, sortHonours } from '@/constants/honours';
import { HonourIcon } from './HonourIcon';

/**
 * A member's honours in one line: up to `max` icons, heaviest first, then
 * "+N" for the rest. Sized for the line under a name on the board.
 */
export function HonourRow({ honours, max = 3, size = 13 }: { honours: Honour[]; max?: number; size?: number }) {
    const list = sortHonours(honours);
    if (list.length === 0) return null;
    const shown = list.slice(0, max);
    const more = list.length - shown.length;
    return (
        <View style={s.row} accessibilityLabel={list.map((h) => `${h.kind} ${h.tier}`).join(', ')}>
            {shown.map((h) => <HonourIcon key={h.kind} kind={h.kind} tier={h.tier} size={size} />)}
            {more > 0 && <Text style={s.more}>+{more}</Text>}
        </View>
    );
}

const s = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    more: { fontSize: 10, fontWeight: '500', color: 'rgba(255,255,255,0.5)', marginLeft: -1 },
});

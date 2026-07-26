import React from 'react';
import { View } from 'react-native';

/**
 * Holds the previous chart on screen, dimmed, while the next lookback window loads.
 *
 * The breakdown tabs used to null their data slot on every [type, offset] change,
 * so one arrow tap swapped the whole month panel — metric pair, separator, label
 * and 5-7 heatmap rows, ~350px — for a ~105px "Loading…" placeholder, collapsing
 * the section and jumping the page twice per step. It happened even stepping back
 * to a window just viewed. Keeping the stale panel mounted removes the jump.
 *
 * The dimming is load-bearing, not decoration: TimeStepper's label advances with
 * the offset prop immediately (so the tap still feels answered), which means for
 * one round trip the numbers on screen belong to the previous window. Dimmed,
 * that reads as "being replaced"; undimmed it would read as this window's data,
 * which is worse than the collapse it replaces.
 *
 * pointerEvents is gated for the same reason: a stale heatmap cell is still a
 * live Pressable, and tapping one would open PointsBreakdownSheet pinned to a
 * date from the window the user just left.
 */
export function StalePanel({ stale, children }: { stale: boolean; children: React.ReactNode }) {
    return (
        <View
            style={stale ? { opacity: 0.35 } : undefined}
            pointerEvents={stale ? 'none' : 'auto'}
        >
            {children}
        </View>
    );
}

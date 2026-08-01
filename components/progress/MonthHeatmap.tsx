import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { localDateStr } from '@/lib/api/activity';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM = 'rgba(255,255,255,0.45)';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * One day in the month grid. `date` is a LOCAL date key (see localDateStr) —
 * never re-derive it with toISOString, which lands on the previous day anywhere
 * east of Greenwich and shifted every cell one column right of its real date.
 *
 * Leading and trailing cells carry a REAL neighbouring-month date with
 * `inRange: false`; the grid starts on the Monday on-or-before the 1st. That's
 * why the date numeral is gated on inRange — printing the previous month's tail
 * is exactly the crowding this is meant to avoid.
 */
export type HeatCell = { date: string; inRange: boolean; value: number };

/**
 * The month calendar shared by Movement, Workouts and Sleep.
 *
 * Extracted because all three carried a character-identical copy of the header
 * row, the 7-column grid, the cell Pressable and six StyleSheet entries — they
 * differed only in which field the value came from and which colour ramp filled
 * it. Adding the date numeral to three copies would have tripled the surface for
 * them to drift apart on.
 *
 * Each tab still owns its own colour: `fill` maps a value to a background, and
 * `isSolid` says whether that background is saturated enough that light ink on
 * top would disappear. Colour stays local; layout is shared.
 */
export function MonthHeatmap({
    rows,
    fill,
    isSolid,
    selected,
    onSelect,
}: {
    rows: HeatCell[][];
    fill: (value: number) => string;
    /** True when the fill is dark/strong enough to need light-on-dark inverted. */
    isSolid: (value: number) => boolean;
    selected: string | null;
    onSelect: (date: string | null) => void;
}) {
    const today = localDateStr(new Date());

    return (
        <>
            <View style={styles.heatmapRow}>
                {DAY_LABELS.map(d => (
                    <View key={d} style={styles.heatmapCellCompact}>
                        <Text style={styles.heatmapHeaderText}>{d.charAt(0)}</Text>
                    </View>
                ))}
            </View>

            {rows.map((row, ri) => (
                <View key={ri} style={styles.heatmapRow}>
                    {row.map((cell, ci) => {
                        // Only days that actually recorded something respond to a tap.
                        const hasData = cell.inRange && cell.value > 0;
                        const Cell: any = hasData ? Pressable : View;
                        const isToday = cell.inRange && cell.date === today;
                        // The numeral sits ON the fill, and the ramp runs from
                        // near-black to full brand colour — so a single ink colour
                        // is unreadable at one end or the other. Flip it at the
                        // point the fill goes solid.
                        const ink = isSolid(cell.value) ? 'rgba(0,0,0,0.62)' : DIM;
                        return (
                            <Cell
                                key={ci}
                                style={styles.heatmapCellCompact}
                                {...(hasData ? {
                                    // Cells are ~42x30 — below the touch minimum, so the
                                    // slop does the work rather than a sparser grid.
                                    onPress: () => onSelect(selected === cell.date ? null : cell.date),
                                    hitSlop: 6,
                                    accessibilityRole: 'button',
                                    accessibilityLabel: `${cell.date} — see what you earned`,
                                } : {})}
                            >
                                <View style={[
                                    styles.heatmapDot,
                                    { backgroundColor: cell.inRange ? fill(cell.value) : 'transparent' },
                                    selected === cell.date && styles.heatmapDotSelected,
                                ]}>
                                    {cell.inRange && (
                                        <Text style={[
                                            styles.heatmapDayNum,
                                            { color: ink },
                                            // Today is the anchor the whole grid is read
                                            // against, so it gets the one emphasis left:
                                            // weight, not colour (gold means "selected"
                                            // and the ramp already means "how much").
                                            isToday && styles.heatmapDayNumToday,
                                            isToday && !isSolid(cell.value) && { color: TEXT },
                                        ]}>
                                            {Number(cell.date.slice(8, 10))}
                                        </Text>
                                    )}
                                </View>
                            </Cell>
                        );
                    })}
                </View>
            ))}
        </>
    );
}

/** The Less▪▪▪More scale, shown under ramps that have more than two stops. */
export function HeatmapLegend({ colours }: { colours: string[] }) {
    return (
        <View style={styles.heatmapLegend}>
            <Text style={styles.heatmapLegendLabel}>Less</Text>
            {colours.map((c, i) => (
                <View key={i} style={[styles.heatmapLegendDot, { backgroundColor: c }]} />
            ))}
            <Text style={styles.heatmapLegendLabel}>More</Text>
        </View>
    );
}

/** Shared so a tab can render the same chevron affordance beside its grid. */
export const HeatmapChevron = () => <Ionicons name="chevron-forward" size={12} color={MUTED} />;

const styles = StyleSheet.create({
    heatmapRow: {
        flexDirection: 'row',
        gap: 4,
    },
    // 30 rather than the old 26: the date numeral needs room to sit without
    // touching the cell edge. Six rows plus the header grows the grid by ~28px,
    // well inside tabContentPage's 480 minHeight, so nothing reflows.
    heatmapCellCompact: {
        flex: 1,
        height: 30,
        alignItems: 'center',
        justifyContent: 'center',
    },
    heatmapDot: {
        width: '100%',
        height: '100%',
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // Selection has to be a BORDER: these charts already spend their two other
    // emphasis signals — fill strength means "how much" and gold means "best" —
    // so re-using either would collide. RN draws borders inside the box, which a
    // centred numeral is unaffected by.
    heatmapDotSelected: {
        borderWidth: 1.5,
        borderColor: GOLD,
    },
    heatmapHeaderText: {
        fontSize: 9,
        fontWeight: '400',
        color: MUTED,
    },
    // Same 9px as the weekday header so the grid reads as one scale. Bigger
    // starts reading as a calendar rather than a heatmap.
    heatmapDayNum: {
        fontSize: 9,
        lineHeight: 11,
        fontWeight: '400',
    },
    heatmapDayNumToday: {
        fontWeight: '700',
    },
    heatmapLegend: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        marginTop: 2,
    },
    heatmapLegendLabel: {
        fontSize: 8,
        color: MUTED,
    },
    heatmapLegendDot: {
        width: 10,
        height: 10,
        borderRadius: 2,
    },
});

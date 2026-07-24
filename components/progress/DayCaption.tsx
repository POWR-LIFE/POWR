import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

const GOLD  = '#E8D200';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM   = 'rgba(255,255,255,0.5)';

/** Local midnight `days` after `base`. */
export function addDays(base: Date, days: number): Date {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * The line under a chart describing the day the user just tapped, and the way
 * through to that day's full points breakdown.
 *
 * Built on the house `insightRow` slot every chart already ends with — same
 * icon size, gap and type — so a selection reads as one more insight rather than
 * new furniture. Copy follows the existing convention (MovementTab's "Best day:
 * Wed — 8,432 steps"): label, em dash, spelled-out units.
 */
export function DayCaption({
    date, sessions, durationMin, points, onPress,
}: {
    date: Date;
    sessions: number;
    durationMin: number;
    /** 0 renders as "no POWR" rather than being omitted — a tapped day that
     *  earned nothing is a real answer, and silence would read as a failure. */
    points: number;
    onPress: () => void;
}) {
    const label = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const bits: string[] = [];
    if (sessions > 0) bits.push(`${sessions} session${sessions === 1 ? '' : 's'}`);
    if (durationMin > 0) bits.push(formatDuration(durationMin));
    bits.push(points > 0 ? `${points} POWR` : 'no POWR');

    return (
        <Pressable
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            onPress={onPress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${bits.join(', ')}. Open the full breakdown.`}
        >
            <Ionicons name="calendar-outline" size={12} color={GOLD} />
            <Text style={styles.text}>{label} — {bits.join(' · ')}</Text>
            <Ionicons name="chevron-forward" size={12} color={MUTED} />
        </Pressable>
    );
}

function formatDuration(mins: number): string {
    if (mins >= 60) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins}m`;
}

const styles = StyleSheet.create({
    // Mirrors insightRow / insightText, duplicated verbatim in all three tabs.
    row: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    text: { fontSize: 12, fontWeight: '300', color: DIM, flex: 1 },
});

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { FAINT, GOLD, TEXT } from '@/components/drop/cardKit';
import { fontFamily } from '@/constants/tokens';
import type { DropDayResult } from '@/lib/dev/dropPrototype';

/** StreakCard's day keys, so the letters match the streak strip above. */
const DAYS = [
    'home:weekdays.mon', 'home:weekdays.tue', 'home:weekdays.wed', 'home:weekdays.thu',
    'home:weekdays.fri', 'home:weekdays.sat', 'home:weekdays.sun',
];

const DOT = 10;

export type DropTodayState = 'unset' | 'sealed' | 'opened';

/**
 * This week's Drops, Mon–Sun, on the StreakCard's day columns: one dot per
 * day (the P is kept for the reveal — Home already has the level badge's).
 * Opened = solid gold, missed = a grey ring, today = a ring filling gold as
 * you move (white until a target is set), later days faint.
 */
export function DropWeek({ week, dayIndex, today, fill }: {
    week: DropDayResult[];
    dayIndex: number;
    today: DropTodayState;
    /** The live Drop's fill — the same value the card's track runs on. */
    fill: SharedValue<number>;
}) {
    const { t } = useTranslation();
    return (
        <View style={s.strip}>
            {DAYS.map((key, i) => {
                const isToday = i === dayIndex;
                const isFuture = i > dayIndex;
                const past = week[i];
                let mark: React.ReactNode;
                if (isToday) {
                    mark = today === 'opened'
                        ? <View style={[s.dot, s.dotOpened]} />
                        : today === 'sealed'
                            ? <TodayDot fill={fill} />
                            : <View style={[s.dot, { borderColor: TEXT }]} />;
                } else if (isFuture) {
                    mark = <View style={[s.dot, { borderColor: '#262626' }]} />;
                } else {
                    mark = past === 'opened'
                        ? <View style={[s.dot, s.dotOpened]} />
                        : <View style={[s.dot, { borderColor: '#4A4A4A' }]} />;
                }
                return (
                    <View key={key} style={s.col}>
                        <Text style={[s.day, isToday && s.dayToday, isFuture && s.dayFuture]}>{t(key)}</Text>
                        <View style={s.markBox}>{mark}</View>
                    </View>
                );
            })}
        </View>
    );
}

/** Today, sealed: a gold ring whose centre fills with the live progress. */
function TodayDot({ fill }: { fill: SharedValue<number> }) {
    const inner = useAnimatedStyle(() => ({ transform: [{ scale: Math.max(0, Math.min(1, fill.value)) }] }));
    return (
        <View style={[s.dot, { borderColor: GOLD, alignItems: 'center', justifyContent: 'center' }]}>
            <Animated.View style={[s.dotInner, inner]} />
        </View>
    );
}

/** "4 opened this week" — counts today once it's open. */
export function openedThisWeek(week: DropDayResult[], todayOpened: boolean): number {
    return week.filter(r => r === 'opened').length + (todayOpened ? 1 : 0);
}

const s = StyleSheet.create({
    strip: { flexDirection: 'row', justifyContent: 'space-between' },
    col: { flex: 1, alignItems: 'center', gap: 7 },
    day: { fontFamily: fontFamily.medium, fontSize: 9, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.3 },
    dayToday: { color: '#FFFFFF' },
    dayFuture: { color: FAINT },
    markBox: { height: DOT + 2, justifyContent: 'center', alignItems: 'center' },
    dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1.5 },
    dotOpened: { backgroundColor: GOLD, borderColor: GOLD },
    dotInner: { width: DOT - 3, height: DOT - 3, borderRadius: (DOT - 3) / 2, backgroundColor: GOLD },
});

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colours, spacing, typography } from '@/constants/tokens';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const RING_SIZE = 32;
const STROKE = 2;
const RADIUS = (RING_SIZE - STROKE * 2) / 2;
const CENTER = RING_SIZE / 2;

interface WeeklyRingsProps {
  /** Array of 7 booleans — true = active day. Index 0 = Monday. */
  activeDays: boolean[];
  /** Index of today (0–6). Days after today are shown dimmed. */
  todayIndex: number;
}

export function WeeklyRings({ activeDays, todayIndex }: WeeklyRingsProps) {
  return (
    <View style={styles.row}>
      {DAYS.map((day, i) => {
        const isActive = activeDays[i] ?? false;
        const isToday = i === todayIndex;
        const isFuture = i > todayIndex;

        return (
          <View key={i} style={styles.dayColumn}>
            <Svg width={RING_SIZE} height={RING_SIZE}>
              {/* Track circle */}
              <Circle
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill={isActive ? colours.accent : 'none'}
                stroke={
                  isActive
                    ? colours.accent
                    : isToday
                    ? colours.accent
                    : isFuture
                    ? colours.surface2
                    : colours.border
                }
                strokeWidth={STROKE}
                opacity={isFuture ? 0.3 : 1}
              />
            </Svg>
            <Text style={[styles.dayLabel, isToday && styles.dayLabelToday, isFuture && styles.dayLabelFuture]}>
              {day}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  dayColumn: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  dayLabel: {
    fontFamily: typography.label.fontFamily,
    fontSize: 9,
    letterSpacing: 0.5,
    color: colours.textMuted,
    textTransform: 'uppercase',
  },
  dayLabelToday: {
    color: colours.accent,
  },
  dayLabelFuture: {
    opacity: 0.3,
  },
});

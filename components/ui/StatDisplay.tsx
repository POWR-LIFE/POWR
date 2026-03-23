import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colours, spacing, typography } from '@/constants/tokens';

export type StatSize = 'sm' | 'md' | 'lg';

interface StatDisplayProps {
  value: string | number;
  label?: string;
  unit?: string;
  size?: StatSize;
  /** Override the value colour — defaults to gold accent */
  valueColour?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * POWR stat display — vertically stacked: LABEL → NUMBER → unit
 * Used for points balances, streak counts, distances, etc.
 */
export function StatDisplay({
  value,
  label,
  unit,
  size = 'md',
  valueColour = colours.accent,
  style,
}: StatDisplayProps) {
  const valueFontSize = size === 'sm' ? 48 : size === 'lg' ? 96 : 72;

  return (
    <View style={[styles.container, style]}>
      {label && (
        <Text style={styles.label}>{label.toUpperCase()}</Text>
      )}
      <Text
        style={[styles.value, { fontSize: valueFontSize, lineHeight: valueFontSize, color: valueColour }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {unit && (
        <Text style={styles.unit}>{unit.toUpperCase()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    fontFamily: typography.label.fontFamily,
    fontSize: 10,
    letterSpacing: 2,
    lineHeight: 10,
    color: colours.textMuted,
    textTransform: 'uppercase',
  },
  value: {
    fontFamily: typography.stat.fontFamily,
    letterSpacing: -2,
    color: colours.accent,
  },
  unit: {
    fontFamily: typography.label.fontFamily,
    fontSize: 10,
    letterSpacing: 2,
    lineHeight: 10,
    color: colours.textMuted,
    textTransform: 'uppercase',
  },
});

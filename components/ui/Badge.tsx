import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colours, components, spacing, typography } from '@/constants/tokens';

interface BadgeProps {
  label: string;
  active?: boolean;
  /** Dot colour — shows a small coloured dot before the label */
  dot?: string;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, active = false, dot, style }: BadgeProps) {
  return (
    <View style={[styles.badge, active && styles.active, style]}>
      {dot && <View style={[styles.dot, { backgroundColor: dot }]} />}
      <Text style={[styles.label, active && styles.activeLabel]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: components.badge.paddingH,
    paddingVertical: components.badge.paddingV,
    borderRadius: components.badge.borderRadius,
    borderWidth: components.badge.borderWidth,
    borderColor: components.badge.border,
    alignSelf: 'flex-start',
  },
  active: {
    borderColor: components.badge.activeBorder,
    backgroundColor: components.badge.activeBackground,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 999,
  },
  label: {
    fontFamily: typography.label.fontFamily,
    fontSize: 9,
    letterSpacing: 1.5,
    lineHeight: 9,
    color: colours.textMuted,
    textTransform: 'uppercase',
  },
  activeLabel: {
    color: colours.accent,
  },
});

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ProBadgeProps {
  size?: 'sm' | 'md';
}

export function ProBadge({ size = 'md' }: ProBadgeProps) {
  const isSmall = size === 'sm';
  return (
    <View style={[styles.badge, isSmall && styles.badgeSm]}>
      <Ionicons name="star" size={isSmall ? 9 : 11} color="#080808" />
      <Text style={[styles.label, isSmall && styles.labelSm]}>PRO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    backgroundColor: '#E8D200',
  },
  badgeSm: {
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  label: {
    color: '#080808',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  labelSm: {
    fontSize: 9,
  },
});

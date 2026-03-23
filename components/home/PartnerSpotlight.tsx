import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colours, spacing, typography } from '@/constants/tokens';

interface PartnerSpotlightProps {
  partnerName: string;
  rewardTitle: string;
  powrCost: number;
  category: string;
  categoryColour: string;
  userBalance: number;
  onPress?: () => void;
}

export function PartnerSpotlight({
  partnerName,
  rewardTitle,
  powrCost,
  category,
  categoryColour,
  userBalance,
  onPress,
}: PartnerSpotlightProps) {
  const canAfford = userBalance >= powrCost;
  const progress = Math.min(userBalance / powrCost, 1);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      {/* Header row */}
      <View style={styles.header}>
        <View style={styles.labelRow}>
          <Text style={styles.sectionLabel}>FEATURED REWARD</Text>
        </View>
        <View style={[styles.categoryBadge, { borderColor: categoryColour }]}>
          <Text style={[styles.categoryText, { color: categoryColour }]}>
            {category.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Partner + reward info */}
      <View style={styles.body}>
        {/* Partner icon placeholder */}
        <View style={[styles.partnerIcon, { backgroundColor: categoryColour + '18' }]}>
          <Ionicons name="gift" size={24} color={categoryColour} />
        </View>

        <View style={styles.textBlock}>
          <Text style={styles.partnerName}>{partnerName}</Text>
          <Text style={styles.rewardTitle} numberOfLines={2}>{rewardTitle}</Text>
        </View>

        <View style={styles.costBlock}>
          <Text style={styles.costValue}>{powrCost}</Text>
          <Text style={styles.costLabel}>POWR</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
      </View>

      {/* Afford status */}
      <Text style={[styles.affordText, canAfford && styles.affordTextReady]}>
        {canAfford
          ? '✓ You can redeem this now'
          : `${powrCost - userBalance} more POWR needed`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.surface1,
    borderWidth: 1,
    borderColor: colours.border,
    borderRadius: 6,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionLabel: {
    fontFamily: typography.label.fontFamily,
    fontSize: 9,
    letterSpacing: 2,
    color: colours.textMuted,
    textTransform: 'uppercase',
  },
  categoryBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  categoryText: {
    fontFamily: typography.label.fontFamily,
    fontSize: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  partnerIcon: {
    width: 48,
    height: 48,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textBlock: {
    flex: 1,
    gap: 3,
  },
  partnerName: {
    fontFamily: typography.label.fontFamily,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colours.textMuted,
    textTransform: 'uppercase',
  },
  rewardTitle: {
    fontFamily: typography.h3.fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: colours.textPrimary,
  },
  costBlock: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  costValue: {
    fontFamily: typography.stat.fontFamily,
    fontSize: 28,
    letterSpacing: -1,
    lineHeight: 28,
    color: colours.accent,
  },
  costLabel: {
    fontFamily: typography.label.fontFamily,
    fontSize: 8,
    letterSpacing: 1.5,
    color: colours.textMuted,
    textTransform: 'uppercase',
  },
  progressTrack: {
    height: 2,
    backgroundColor: colours.surface2,
    borderRadius: 1,
    overflow: 'hidden',
  },
  progressFill: {
    height: 2,
    backgroundColor: colours.accent,
    borderRadius: 1,
  },
  affordText: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 11,
    color: colours.textMuted,
  },
  affordTextReady: {
    color: colours.success,
  },
});

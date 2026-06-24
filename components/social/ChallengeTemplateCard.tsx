import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { fontFamily } from '@/constants/tokens';
import type { ChallengeTemplate, IconSpec } from '@/lib/social/types';

// ─── Palette (matches SharedChallengeCard) ───────────────────────────────────
const GOLD = '#E8D200';
const GREEN = '#00CC66';
const ORANGE = '#FF5C00';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const FAINT = '#444444';
const CARD_BG = '#111111';
const BORDER = '#222222';

const TIER_COLOR: Record<string, string> = { easy: GREEN, medium: GOLD, hard: ORANGE };
const TIER_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

// Same height as SharedChallengeCard so the browse carousel reads as one band.
const CARD_MIN_HEIGHT = 180;

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

export interface ChallengeTemplateCardProps {
  template: ChallengeTemplate;
  /** Stagger index for the mount entry animation. */
  index?: number;
  onPress?: (template: ChallengeTemplate) => void;
}

/**
 * Browse card for a challenge you could start with friends. Shown in the
 * "Together" empty-state carousel — tapping opens the create flow preselected to
 * this template. Mirrors SharedChallengeCard's layout (header / title / footer)
 * so an empty plate and an active one feel like the same surface.
 */
export function ChallengeTemplateCard({ template, index = 0, onPress }: ChallengeTemplateCardProps) {
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withDelay(index * 80, withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) }));
  }, [enter, index]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 10 }],
  }));

  const tierColor = TIER_COLOR[template.tier] ?? GOLD;

  return (
    <Animated.View style={enterStyle}>
      <Pressable
        onPress={() => { Haptics.selectionAsync(); onPress?.(template); }}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.95 }]}
        accessibilityRole="button"
        accessibilityLabel={`Challenge friends to ${template.title}`}
      >
        {/* Icon + the reward — mirrors the active card's avatars/points header */}
        <View style={styles.header}>
          <View style={styles.iconBubble}>
            <CatIcon spec={template.icon} size={22} color={GOLD} />
          </View>
          <View style={styles.points}>
            <Text style={styles.pointsValue}>+{template.basePoints}</Text>
            <Text style={styles.pointsLabel}>pts</Text>
          </View>
        </View>

        {/* What it is */}
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={2}>{template.title}</Text>
          <Text style={styles.goal} numberOfLines={2}>{template.goal}</Text>
        </View>

        {/* Tier + the call to action */}
        <View style={styles.footer}>
          <View style={[styles.tierChip, { borderColor: tierColor }]}>
            <Text style={[styles.tierText, { color: tierColor }]}>{TIER_LABEL[template.tier] ?? template.tier}</Text>
          </View>
          <View style={styles.cta}>
            <Text style={styles.ctaText}>Challenge friends</Text>
            <Ionicons name="arrow-forward" size={14} color={GOLD} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    minHeight: CARD_MIN_HEIGHT,
    justifyContent: 'space-between',
  },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconBubble: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(232,210,0,0.10)', alignItems: 'center', justifyContent: 'center',
  },
  points: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  pointsValue: { fontFamily: fontFamily.extraLight, fontSize: 24, color: GOLD, lineHeight: 24 },
  pointsLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1, color: FAINT, textTransform: 'uppercase' },

  titleBlock: { gap: 4 },
  title: { fontFamily: fontFamily.light, fontSize: 22, color: TEXT, letterSpacing: -0.3 },
  goal: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, lineHeight: 17 },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tierChip: { borderWidth: 1, borderRadius: 100, paddingHorizontal: 9, paddingVertical: 3 },
  tierText: { fontFamily: fontFamily.semiBold, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ctaText: { fontFamily: fontFamily.medium, fontSize: 12, color: GOLD, letterSpacing: 0.2 },
});

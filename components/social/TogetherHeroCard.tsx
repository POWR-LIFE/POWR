import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { fontFamily } from '@/constants/tokens';
import { durationLabel } from '@/hooks/useSharedChallenges';
import { BONUS_DEFAULTS, type BonusConfig } from '@/lib/social/bonus';
import type { ChallengeTemplate } from '@/lib/social/types';
import { ChallengeBadge } from './ChallengeBadge';

// ─── Palette (matches the challenge cards) ────────────────────────────────────
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

export interface TogetherHeroCardProps {
  template: ChallengeTemplate;
  bonusConfig?: Partial<BonusConfig>;
  onPress: (template: ChallengeTemplate) => void;
}

/**
 * Featured "Together" card for the empty state — one confident hero (a medallion
 * badge, the reward, the group-bonus hook and a single CTA) instead of a row of
 * equal-weight browse cards. Tapping anywhere opens the create flow preselected
 * to this template. Discovery of everything else lives behind "See all".
 */
export function TogetherHeroCard({ template, bonusConfig, onPress }: TogetherHeroCardProps) {
  const tierColor = TIER_COLOR[template.tier] ?? GOLD;
  const perHead = { ...BONUS_DEFAULTS, ...bonusConfig }.perHead;

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) });
  }, [enter]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 12 }],
  }));

  return (
    <Animated.View style={enterStyle}>
      <Pressable
        onPress={() => { Haptics.selectionAsync(); onPress(template); }}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.96 }]}
        accessibilityRole="button"
        accessibilityLabel={`Challenge friends to ${template.title}`}
      >
        {/* Badge + reward */}
        <View style={styles.header}>
          <ChallengeBadge icon={template.icon} tier={template.tier} size={64} />
          <View style={styles.points}>
            <Text style={styles.pointsValue}>+{template.basePoints}</Text>
            <Text style={styles.pointsLabel}>pts</Text>
          </View>
        </View>

        {/* What it is (run length rides on the goal line — timing has no other home here) */}
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={2}>{template.title}</Text>
          <Text style={styles.goal} numberOfLines={2}>
            {template.goal}
            {template.durationHours ? ` · ${durationLabel(template.durationHours)}` : ''}
          </Text>
        </View>

        {/* Tier + the group-bonus hook (the centrepiece mechanic) */}
        <View style={styles.metaRow}>
          <View style={[styles.tierChip, { borderColor: tierColor }]}>
            <Text style={[styles.tierText, { color: tierColor }]}>{TIER_LABEL[template.tier] ?? template.tier}</Text>
          </View>
          <View style={styles.bonusHook}>
            <Ionicons name="people" size={12} color={GOLD} />
            <Text style={styles.bonusText}>+{perHead} bonus each per friend who finishes</Text>
          </View>
        </View>

        {/* Single decisive CTA (whole card is pressable — this is the affordance) */}
        <View style={styles.cta}>
          <Text style={styles.ctaText}>Challenge friends</Text>
          <Ionicons name="arrow-forward" size={16} color={CARD_BG} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    gap: 16,
  },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  points: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  pointsValue: { fontFamily: fontFamily.extraLight, fontSize: 30, color: GOLD, lineHeight: 30, letterSpacing: -0.5 },
  pointsLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 2, color: FAINT, textTransform: 'uppercase' },

  titleBlock: { gap: 6 },
  title: { fontFamily: fontFamily.light, fontSize: 28, color: TEXT, letterSpacing: -0.3, lineHeight: 32 },
  goal: { fontFamily: fontFamily.light, fontSize: 13, color: SECONDARY, lineHeight: 18 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tierChip: { borderWidth: 1, borderRadius: 100, paddingHorizontal: 9, paddingVertical: 3 },
  tierText: { fontFamily: fontFamily.semiBold, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' },
  bonusHook: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  bonusText: { flex: 1, fontFamily: fontFamily.light, fontSize: 11.5, color: SECONDARY },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GOLD, borderRadius: 100, paddingVertical: 14,
  },
  ctaText: { fontFamily: fontFamily.bold, fontSize: 13, color: CARD_BG, letterSpacing: 0.3 },
});

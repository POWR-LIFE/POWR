import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Avatar } from '@/components/social/Avatar';
import { fontFamily } from '@/constants/tokens';
import { durationLabel } from '@/hooks/useSharedChallenges';
import type { ChallengeTemplate, Friend, IconSpec } from '@/lib/social/types';

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
// Soft grey-white for the oversized corner watermark — keeps the card a premium
// dark surface instead of a tier-coloured block. Alpha lives in styles.watermark.
const WATERMARK = '#FFFFFF';

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
  /** Friends to pitch the challenge WITH (and preselect on tap) — real faces
   *  turn "a feature exists" into "you, Elliot & Sorine, this week". */
  crew?: Friend[];
  /** Bonus maths for the pitch line; without it the crew strip shows faces only. */
  bonusConfig?: { perHead: number; maxBonus: number };
}

/** "You, Elliot & Sorine — finish together for +15 each on top" */
function crewPitch(crew: Friend[], bonus: { perHead: number; maxBonus: number }): string {
  const names = crew.slice(0, 2).map((f) => f.displayName.split(' ')[0] || f.username);
  const extra = crew.length - names.length;
  const who = extra > 0 ? `${names.join(', ')} +${extra}` : names.join(' & ');
  const each = Math.min(bonus.maxBonus, bonus.perHead * crew.length);
  return `You & ${who} — finish together for +${each} each on top`;
}

/**
 * Browse card for a challenge you could start with friends. Shown in the
 * "Together" empty-state carousel — tapping opens the create flow preselected to
 * this template. Mirrors SharedChallengeCard's layout (header / title / footer)
 * so an empty plate and an active one feel like the same surface.
 */
export function ChallengeTemplateCard({ template, index = 0, onPress, crew, bonusConfig }: ChallengeTemplateCardProps) {
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
        {/* Backdrop: an oversized, ghosted activity icon bleeding off the
            bottom-right in a soft grey-white — adds depth without colour so the
            card reads premium. Clipped to the rounded corners (overflow: hidden). */}
        <View style={styles.watermark} pointerEvents="none">
          <CatIcon spec={template.icon} size={150} color={WATERMARK} />
        </View>

        {/* Icon + the reward — mirrors the active card's avatars/points header.
            Bare white glyph (no bubble) to match the premium, colour-free look. */}
        <View style={styles.header}>
          <CatIcon spec={template.icon} size={26} color={TEXT} />
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

        {/* Who with, and what it pays — the group bonus is the feature's whole
            pitch, so it goes on the card, not three taps deep. A user with no
            invitable friends yet gets the honest alternative: race the Pacer. */}
        {crew && crew.length > 0 ? (
          <View style={styles.crewRow}>
            <View style={styles.crewAvatars}>
              {crew.slice(0, 3).map((f, i) => (
                <View key={f.id} style={[styles.crewAvatar, i > 0 && styles.crewAvatarOverlap]}>
                  <Avatar friend={f} size={22} />
                </View>
              ))}
            </View>
            {bonusConfig && (
              <Text style={styles.crewText} numberOfLines={2}>{crewPitch(crew, bonusConfig)}</Text>
            )}
          </View>
        ) : crew ? (
          <View style={styles.crewRow}>
            <Ionicons name="flash" size={14} color={SECONDARY} />
            <Text style={styles.crewText} numberOfLines={2}>
              No crew yet? Start solo and race the Pacer — beat the pace, bank the points.
            </Text>
          </View>
        ) : null}

        {/* Tier + run length + the call to action */}
        <View style={styles.footer}>
          <View style={styles.metaRow}>
            <View style={[styles.tierChip, { borderColor: tierColor }]}>
              <Text style={[styles.tierText, { color: tierColor }]}>{TIER_LABEL[template.tier] ?? template.tier}</Text>
            </View>
            {template.durationHours ? (
              <View style={styles.durationChip}>
                <Ionicons name="time-outline" size={10} color={SECONDARY} />
                <Text style={styles.durationText}>{durationLabel(template.durationHours)}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.cta}>
            <Text style={styles.ctaText}>{crew && crew.length === 0 ? 'Race the Pacer' : 'Challenge friends'}</Text>
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
    overflow: 'hidden',
    position: 'relative',
  },
  // ghosted activity icon bleeding off the bottom-right corner
  watermark: { position: 'absolute', right: -34, bottom: -38, opacity: 0.06, transform: [{ rotate: '-12deg' }] },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  points: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  pointsValue: { fontFamily: fontFamily.extraLight, fontSize: 24, color: GOLD, lineHeight: 24 },
  pointsLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1, color: FAINT, textTransform: 'uppercase' },

  titleBlock: { gap: 4 },
  title: { fontFamily: fontFamily.light, fontSize: 22, color: TEXT, letterSpacing: -0.3 },
  goal: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, lineHeight: 17 },

  // crew pitch strip — faces + the bonus each of them would earn
  crewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  crewAvatars: { flexDirection: 'row', alignItems: 'center' },
  crewAvatar: { borderRadius: 12, borderWidth: 1.5, borderColor: CARD_BG },
  crewAvatarOverlap: { marginLeft: -7 },
  crewText: { flex: 1, fontFamily: fontFamily.light, fontSize: 11, color: SECONDARY, lineHeight: 15 },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tierChip: { borderWidth: 1, borderRadius: 100, paddingHorizontal: 9, paddingVertical: 3 },
  tierText: { fontFamily: fontFamily.semiBold, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' },
  durationChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderColor: BORDER, borderRadius: 100,
    paddingHorizontal: 9, paddingVertical: 3,
  },
  durationText: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 0.5, color: SECONDARY },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ctaText: { fontFamily: fontFamily.medium, fontSize: 12, color: GOLD, letterSpacing: 0.2 },
});

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Avatar } from '@/components/social/Avatar';
import { fontFamily } from '@/constants/tokens';
import type { PulseCandidate } from '@/lib/social/friendPulse';

// ─── Palette (matches SharedChallengeCard / ChallengeTemplateCard) ───────────
const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const FAINT = '#444444';
const MUTED = '#555555';
const CARD_BG = '#111111';
const BORDER = '#222222';
const WATERMARK = '#FFFFFF';

// Same height as its carousel siblings so the band never jumps between slides.
const CARD_MIN_HEIGHT = 180;

const PULSE_NOUN: Record<string, string> = { gym: 'a gym session', running: 'a run', cycling: 'a ride' };
const PULSE_ICON: Record<string, string> = { gym: 'barbell-outline', running: 'footsteps-outline', cycling: 'bicycle' };

function firstName(p: PulseCandidate): string {
  return p.friend.displayName.split(' ')[0] || p.friend.username;
}

/** "Elliot just did a gym session." */
export function pulseHeadline(p: PulseCandidate): string {
  const ageH = (Date.now() - Date.parse(p.startedAt)) / 3_600_000;
  return `${firstName(p)} ${ageH <= 3 ? 'just did' : 'recently did'} ${PULSE_NOUN[p.type] ?? 'a workout'}.`;
}

export interface FriendPulseCardProps {
  pulse: PulseCandidate;
  /** Stagger index for the mount entry animation. */
  index?: number;
  bonusConfig?: { perHead: number; maxBonus: number };
  onPress?: () => void;
  onDismiss?: () => void;
}

/**
 * A friend's fresh workout as a first-class Together card — social proof and a
 * target in one slide of the carousel, not a footnote under it. Tapping opens
 * the create sheet preselected to the friend (and a template in their
 * discipline); the (X) hands off to the pacing cool-offs in friendPulse.
 */
export function FriendPulseCard({ pulse, index = 0, bonusConfig, onPress, onDismiss }: FriendPulseCardProps) {
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withDelay(index * 80, withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) }));
  }, [enter, index]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 10 }],
  }));

  const name = firstName(pulse);
  const bonusEach = bonusConfig ? Math.min(bonusConfig.maxBonus, bonusConfig.perHead) : 0;

  return (
    <Animated.View style={enterStyle}>
      <Pressable
        onPress={() => { Haptics.selectionAsync(); onPress?.(); }}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.95 }]}
        accessibilityRole="button"
        accessibilityLabel={`${pulseHeadline(pulse)} Challenge them`}
      >
        {/* Ghosted activity icon, same treatment as the template cards. */}
        <View style={styles.watermark} pointerEvents="none">
          <Ionicons name={(PULSE_ICON[pulse.type] ?? 'flash-outline') as any} size={150} color={WATERMARK} />
        </View>

        {/* Who — and the way out for anyone tired of seeing them. */}
        <View style={styles.header}>
          <View style={styles.who}>
            <Avatar friend={pulse.friend} size={30} />
            <View style={styles.liveChip}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Active today</Text>
            </View>
          </View>
          {!!onDismiss && (
            <Pressable
              hitSlop={10}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss suggestion"
            >
              <Ionicons name="close" size={14} color={MUTED} />
            </Pressable>
          )}
        </View>

        {/* What happened, and what it's worth doing about it. */}
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={2}>{pulseHeadline(pulse)}</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {bonusEach > 0
              ? `Take on a challenge together — finish it and you both earn +${bonusEach} on top.`
              : 'Take on a challenge together.'}
          </Text>
        </View>

        <View style={styles.footer}>
          <View />
          <View style={styles.cta}>
            <Text style={styles.ctaText}>Challenge {name}</Text>
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
  watermark: { position: 'absolute', right: -34, bottom: -38, opacity: 0.06, transform: [{ rotate: '-12deg' }] },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: BORDER, borderRadius: 100,
    paddingHorizontal: 9, paddingVertical: 3,
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD },
  liveText: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1, color: SECONDARY, textTransform: 'uppercase' },

  titleBlock: { gap: 4 },
  title: { fontFamily: fontFamily.light, fontSize: 20, color: TEXT, letterSpacing: -0.3 },
  sub: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, lineHeight: 17 },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ctaText: { fontFamily: fontFamily.medium, fontSize: 12, color: GOLD, letterSpacing: 0.2 },
  // keeps the label pattern consistent with template cards should a meta row land here
  metaLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1.5, color: FAINT, textTransform: 'uppercase' },
});

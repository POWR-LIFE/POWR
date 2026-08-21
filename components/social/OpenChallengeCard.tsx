import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { fontFamily } from '@/constants/tokens';
import { durationLabel } from '@/hooks/useSharedChallenges';
import type { IconSpec, OpenChallenge } from '@/lib/social/types';

// ─── Palette (matches ChallengeTemplateCard / SharedChallengeCard) ───────────
const GOLD = '#E8D200';
const GREEN = '#00CC66';
const ORANGE = '#FF5C00';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const FAINT = '#444444';
const CARD_BG = '#111111';
const BORDER = '#222222';

const TIER_COLOR: Record<string, string> = { easy: GREEN, medium: GOLD, hard: ORANGE };

// Same height as the other two carousel cards so the band reads as one shelf.
const CARD_MIN_HEIGHT = 180;

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

export interface OpenChallengeCardProps {
  challenge: OpenChallenge;
  /** True while this card's take is in flight. */
  busy?: boolean;
  onTake?: (challenge: OpenChallenge) => void;
}

/**
 * One challenge on the open board — someone you don't know has posted it and
 * the first taker races them.
 *
 * The person is the whole point, so they lead the card: a face, a first name,
 * and the fact that they are waiting. Everything the template card puts first
 * (glyph, points) sits behind that here, because "Sarah is waiting for someone"
 * is a reason to tap and "5K run · 48h" is only the detail.
 */
export function OpenChallengeCard({ challenge, busy, onTake }: OpenChallengeCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const tierColor = TIER_COLOR[challenge.template.tier] ?? GOLD;
  const avatar = challenge.creatorAvatar;
  const initial = (challenge.creatorName || '?').trim().charAt(0).toUpperCase();

  return (
    <Pressable
      onPress={() => { if (!busy) { Haptics.selectionAsync(); onTake?.(challenge); } }}
      disabled={busy}
      style={({ pressed }) => [styles.card, pressed && !busy && { opacity: 0.95 }, busy && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityState={{ busy: !!busy }}
      accessibilityLabel={`Take ${challenge.creatorName}'s ${challenge.template.title} challenge`}
    >
      {/* Who posted it. A stranger gets a first name and a face — never a
          username, a level or a history (see get_open_challenges). */}
      <View style={styles.header}>
        <View style={styles.who}>
          {avatar && !imageFailed ? (
            <Image
              source={{ uri: avatar }}
              style={styles.avatar}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
          <View style={styles.whoText}>
            <Text style={styles.name} numberOfLines={1}>{challenge.creatorName}</Text>
            <Text style={styles.waiting} numberOfLines={1}>
              {challenge.slotsLeft > 1 ? `${challenge.slotsLeft} spots open` : 'waiting for someone'}
            </Text>
          </View>
        </View>
        <View style={styles.points}>
          <Text style={styles.pointsValue}>+{challenge.basePoints}</Text>
          <Text style={styles.pointsLabel}>pts</Text>
        </View>
      </View>

      {/* What you'd be taking on */}
      <View style={styles.titleBlock}>
        <Text style={styles.title} numberOfLines={2}>{challenge.template.title}</Text>
        {!!challenge.template.goal && (
          <Text style={styles.goal} numberOfLines={2}>{challenge.template.goal}</Text>
        )}
      </View>

      {/* Category + run length + the call to action. The clock is deliberately
          described as starting on the take: an open challenge's window opens
          when someone takes it, not when it was posted, so both sides race the
          same duration (see tryStartForming's open-board exception). */}
      <View style={styles.footer}>
        <View style={styles.metaRow}>
          <View style={[styles.chip, { borderColor: tierColor }]}>
            <CatIcon spec={challenge.template.icon} size={10} color={tierColor} />
            <Text style={[styles.chipText, { color: tierColor }]}>{challenge.template.categoryLabel}</Text>
          </View>
          {challenge.durationHours ? (
            <View style={styles.chip}>
              <Ionicons name="time-outline" size={10} color={SECONDARY} />
              <Text style={styles.chipText}>{durationLabel(challenge.durationHours)}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.cta}>
          {busy ? (
            <ActivityIndicator size="small" color={GOLD} />
          ) : (
            <>
              <Text style={styles.ctaText}>Take it</Text>
              <Ionicons name="arrow-forward" size={14} color={GOLD} />
            </>
          )}
        </View>
      </View>
    </Pressable>
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
  },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1C1C1C' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: fontFamily.medium, fontSize: 14, color: SECONDARY },
  whoText: { flex: 1 },
  name: { fontFamily: fontFamily.medium, fontSize: 14, color: TEXT, letterSpacing: -0.2 },
  waiting: { fontFamily: fontFamily.light, fontSize: 11, color: SECONDARY, marginTop: 1 },

  points: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  pointsValue: { fontFamily: fontFamily.extraLight, fontSize: 24, color: GOLD, lineHeight: 24 },
  pointsLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1, color: FAINT, textTransform: 'uppercase' },

  titleBlock: { gap: 4 },
  title: { fontFamily: fontFamily.light, fontSize: 22, color: TEXT, letterSpacing: -0.3 },
  goal: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, lineHeight: 17 },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderColor: BORDER, borderRadius: 100,
    paddingHorizontal: 9, paddingVertical: 3,
  },
  chipText: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 0.5, color: SECONDARY },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 60, justifyContent: 'flex-end' },
  ctaText: { fontFamily: fontFamily.medium, fontSize: 12, color: GOLD, letterSpacing: 0.2 },
});

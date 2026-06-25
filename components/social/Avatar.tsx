import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { fontFamily } from '@/constants/tokens';
import type { Friend } from '@/lib/social/types';

const GOLD = '#E8D200';
const GREEN = '#00CC66';
const CARD_BG = '#1E1E1E';

/** Deterministic muted colour per person so avatars are distinguishable. */
const AVATAR_BG = ['#3A3A3A', '#43391C', '#1C3A2E', '#1C2E3A', '#3A1C2E', '#2E1C3A'];
function bgFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_BG[h % AVATAR_BG.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface AvatarProps {
  friend: Friend;
  size?: number;
  /** Gold ✓ ring + badge — the person individually finished their part. */
  completed?: boolean;
  /** Dimmed — invite not yet accepted. */
  pending?: boolean;
  /** Outline only, used for the "you" / selectable states. */
  selected?: boolean;
}

export function Avatar({ friend, size = 40, completed, pending, selected }: AvatarProps) {
  const radius = size / 2;
  const fontSize = Math.round(size * 0.36);

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.base,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: friend.avatarUrl ? 'transparent' : bgFor(friend.id),
          },
          selected && styles.selectedRing,
          completed && styles.completedRing,
          pending && styles.pending,
        ]}
      >
        {friend.avatarUrl ? (
          <Image source={{ uri: friend.avatarUrl }} style={{ width: size, height: size, borderRadius: radius }} />
        ) : (
          <Text style={[styles.initials, { fontSize }]}>{initials(friend.displayName)}</Text>
        )}
      </View>

      {completed && (
        <View style={[styles.badge, styles.badgeDone]}>
          <Ionicons name="checkmark" size={Math.round(size * 0.28)} color={CARD_BG} />
        </View>
      )}
      {selected && !completed && (
        <View style={[styles.badge, styles.badgeSelected]}>
          <Ionicons name="checkmark" size={Math.round(size * 0.28)} color={CARD_BG} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  selectedRing: { borderWidth: 2, borderColor: GOLD },
  completedRing: { borderWidth: 2, borderColor: GREEN },
  pending: { opacity: 0.4 },
  initials: { fontFamily: fontFamily.semiBold, color: '#F2F2F2', letterSpacing: 0.3 },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: CARD_BG,
  },
  badgeDone: { backgroundColor: GREEN },
  badgeSelected: { backgroundColor: GOLD },
});

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, RadialGradient, Stop } from 'react-native-svg';

import type { IconSpec } from '@/lib/social/types';

// ─── Palette ──────────────────────────────────────────────────────────────────
const GOLD = '#E8D200';
const GREEN = '#00CC66';
const ORANGE = '#FF5C00';

type Tier = 'easy' | 'medium' | 'hard';

/** Per-tier rim gradient (light top → dark bottom) for a metallic medallion edge. */
const RIM: Record<Tier, { light: string; dark: string; ring: string; icon: string }> = {
  easy: { light: '#3DE08A', dark: '#0E7A42', ring: GREEN, icon: GREEN },
  medium: { light: '#FFE94D', dark: '#B8A600', ring: GOLD, icon: GOLD },
  hard: { light: '#FF8A3D', dark: '#C24600', ring: ORANGE, icon: ORANGE },
};

const PETALS = 11;

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

export interface ChallengeBadgeProps {
  icon: IconSpec;
  tier?: Tier;
  /** Overall diameter in px. */
  size?: number;
  /** Override the centred icon colour (defaults to the tier colour). */
  iconColor?: string;
}

/**
 * Strava-style scalloped "medal" badge — a tier-coloured flower rim with a
 * metallic gradient, an embossed inner ring, a dark face and the activity icon
 * centred on top. Pure presentational; used by the Together hero + browse cards.
 */
export function ChallengeBadge({ icon, tier = 'medium', size = 64, iconColor }: ChallengeBadgeProps) {
  // useId keeps the SVG <Defs> gradient ids unique so multiple badges on screen
  // don't share (and clobber) each other's fills.
  const uid = useId().replace(/:/g, '_');
  const rimId = `rim_${uid}`;
  const faceId = `face_${uid}`;

  const rim = RIM[tier];
  const c = size / 2;
  const rPetal = size * 0.088;
  const rBase = c - rPetal; // petals sit on this circle; outer extent = c (fills the box)
  const rFace = rBase * 0.72;
  const rRing = rBase * 0.8;

  const petals = Array.from({ length: PETALS }, (_, i) => {
    const a = (i / PETALS) * Math.PI * 2 - Math.PI / 2;
    return { x: c + rBase * Math.cos(a), y: c + rBase * Math.sin(a) };
  });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={rimId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={rim.light} />
            <Stop offset="1" stopColor={rim.dark} />
          </LinearGradient>
          <RadialGradient id={faceId} cx="50%" cy="42%" r="65%">
            <Stop offset="0" stopColor="#202020" />
            <Stop offset="1" stopColor="#0A0A0A" />
          </RadialGradient>
        </Defs>

        {/* Scalloped rim — base disc + a ring of petal bumps, one metallic fill */}
        <Circle cx={c} cy={c} r={rBase} fill={`url(#${rimId})`} />
        {petals.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={rPetal} fill={`url(#${rimId})`} />
        ))}

        {/* Dark face + embossed inner ring */}
        <Circle cx={c} cy={c} r={rFace} fill={`url(#${faceId})`} />
        <Circle
          cx={c}
          cy={c}
          r={rRing}
          fill="none"
          stroke={rim.ring}
          strokeOpacity={0.45}
          strokeWidth={Math.max(1, size * 0.018)}
        />

        {/* Top sheen */}
        <Ellipse cx={c} cy={size * 0.3} rx={rBase * 0.5} ry={rBase * 0.22} fill="#FFFFFF" opacity={0.06} />
      </Svg>

      {/* Activity icon centred over the medallion */}
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <CatIcon spec={icon} size={size * 0.4} color={iconColor ?? rim.icon} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});

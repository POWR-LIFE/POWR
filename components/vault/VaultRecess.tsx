import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * The shadow the vault sits in.
 *
 * Without it the door reads as a sticker floating on the page. A recessed
 * object darkens the surface immediately around its rim and that darkening
 * falls off with distance — so this is a HALO, not a plain vignette: fully
 * clear under the door itself, darkest right at the rim, gone by the edge of
 * the box. A gradient that starts dark at the centre would just dim the
 * artwork.
 *
 * ⚠ SVG GRADIENTS ONLY. react-native-svg *filters* (FeGaussianBlur and
 * friends) are unusably slow at this size and were the reason an earlier SVG
 * door was abandoned — see VaultPotDoor's header. A plain radial gradient is a
 * different thing and is cheap: it is one quad, no per-pixel filter pass.
 */

/**
 * How far past the door's own box the halo reaches.
 *
 * ⚠ THIS IS CLIPPED BY THE SCROLL VIEWPORT. The recess lives inside the
 * SectionList's content, so any part of it above the top of the list is cut
 * off — and because the halo is still dark up there, the cut showed as a hard
 * horizontal LINE under the header on device. (It never appeared on web, where
 * the safe-area inset is 0 and the door sits lower.) Two rules follow:
 *   1. keep this small, and
 *   2. `listContent` must carry a paddingTop of at least `size * this`.
 * Raising one without the other brings the line straight back.
 */
export const RECESS_OVERHANG = 0.1;

/**
 * Radius of the door's outer rim as a fraction of its square box.
 *
 * ⚠ MEASURED FROM THE MODEL, NOT EYEBALLED — guessing this is what put a
 * visible GAP between the door and its shadow. The outermost geometry is
 * `ring(0.945, 0.995, …)` at z≈0.046; the camera (fov 22°, z=7.3) gives a
 * half-height there of (7.3 − 0.046)·tan 11° = 1.410 model units, which maps to
 * size/2 px. So the rim is 0.995 / (2 × 1.410) = 0.353 of size. Change the
 * camera or the outer ring and this has to be recomputed.
 */
const DOOR_RIM_FRAC = 0.3528;

/**
 * Where the rim lands as a fraction of the gradient's radius. The gradient uses
 * r="50%", so its radius is half the box = size·(0.5 + OVERHANG). Deriving this
 * rather than hardcoding a percentage is what keeps the shadow attached to the
 * door when either constant moves.
 */
const RIM = DOOR_RIM_FRAC / (0.5 + RECESS_OVERHANG);

/** Fraction of the way from the rim out to the edge of the gradient. */
const out = (t: number) => `${((RIM + (1 - RIM) * t) * 100).toFixed(1)}%`;

export function VaultRecess({ size }: { size: number }) {
  const box = size * (1 + RECESS_OVERHANG * 2);

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { width: box, height: box, left: -size * RECESS_OVERHANG, top: -size * RECESS_OVERHANG }]}
    >
      <Svg width={box} height={box}>
        <Defs>
          <RadialGradient id="vault_recess" cx="50%" cy="50%" r="50%">
            {/* Clear under the door, ramping up only just before the rim. */}
            <Stop offset="0%" stopColor="#000000" stopOpacity="0" />
            <Stop offset={`${(RIM * 78).toFixed(1)}%`} stopColor="#000000" stopOpacity="0" />
            {/* Rim contact — the darkest point, hard against the door edge.
                ⚠ The page is already near-black (#07090A), so a black halo has
                little room to darken. What actually sells the recess is the
                halo occluding GeometricBackground's pale line work behind it. */}
            <Stop offset={`${(RIM * 100).toFixed(1)}%`} stopColor="#000000" stopOpacity="0.85" />
            <Stop offset={out(0.33)} stopColor="#000000" stopOpacity="0.44" />
            <Stop offset={out(0.67)} stopColor="#000000" stopOpacity="0.15" />
            <Stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={box} height={box} fill="url(#vault_recess)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
});

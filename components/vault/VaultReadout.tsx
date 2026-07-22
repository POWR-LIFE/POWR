import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ACCENT, ACCENT_SOFT, MUTED } from './potTokens';

/**
 * What is behind the vault door's glass: the contents.
 *
 * The porthole used to run the countdown, with the amount in plain text under
 * the door. That was inside out — a porthole is a window onto what is IN the
 * vault, and the POWR is the thing the screen exists to show. The clock moved
 * out to VaultTimer, below the door.
 *
 * Two things shape the implementation:
 *
 *  1. Nothing in here ticks. That is the point of the split: this re-renders
 *     when the balance changes and at no other time, while the once-a-second
 *     work is isolated in a leaf component outside the door's Animated graph.
 *
 *  2. Everything is a fraction of the porthole diameter, never an absolute
 *     size. The door scales with the viewport, and glyphs that don't scale
 *     with it spill past the glass on small screens.
 */

/**
 * Largest figure that still fits inside the glass.
 *
 * The content column is 80% of the diameter: at the height the figure sits,
 * that is the widest a straight line can run inside the circle without kissing
 * the bevel. A fixed size was fine for a two-digit day count but not for a
 * balance — tabular digits at this weight advance ~0.56em and a thousands
 * separator ~0.30em, so "1,240" at the old size ran past the column and hung
 * out over the bezel. Solving for the column width means the figure shrinks
 * only as far as it actually has to.
 */
function figureSize(text: string, boxWidth: number, max: number): number {
  const digits = (text.match(/\d/g) ?? []).length;
  const separators = text.length - digits;
  const ems = digits * 0.56 + separators * 0.3;
  return Math.min(max, Math.floor(boxWidth / Math.max(ems, 1)));
}

export interface VaultReadoutProps {
  /** Porthole diameter in px — every glyph is sized off this. */
  diameter: number;
  /**
   * POWR behind the glass. Once something has matured this is the matured
   * portion rather than the whole vault, so that the figure and the dial that
   * takes it agree.
   */
  amount?: number | null;
  /** Something has matured — labels the figure as claimable, not just held. */
  ready?: boolean;
  /** Deposits still in flight — show nothing rather than claiming EMPTY. */
  loading?: boolean;
  /**
   * The level floor is in force for this user: the porthole says SEALED and
   * prices the door open in POWR-to-level instead of showing contents — the
   * card that used to carry this under the door is gone (Jamie: the vault
   * itself should say it). Takes precedence over everything above: what is
   * banked is listed below the door, and a sealed door's one message is what
   * opens it.
   */
  sealed?: { minLevel: number; toGo: number } | null;
}

export function VaultReadout({
  diameter,
  amount = null,
  ready = false,
  loading = false,
  sealed = null,
}: VaultReadoutProps) {
  // Type scale, as fractions of the glass.
  const u = (f: number) => Math.round(diameter * f);
  const boxWidth = diameter * 0.8;

  if (sealed) {
    return (
      <View style={[styles.stack, { width: boxWidth }]}>
        <Text style={[styles.label, { fontSize: u(0.072) }]}>SEALED</Text>
        {sealed.toGo > 0 ? (
          <>
            <Text
              style={[
                styles.figure,
                { fontSize: figureSize(sealed.toGo.toLocaleString(), boxWidth, u(0.3)) },
              ]}
            >
              {sealed.toGo.toLocaleString()}
            </Text>
            <Text style={[styles.sealedUnit, { fontSize: u(0.066) }]}>
              POWR TO LEVEL {sealed.minLevel}
            </Text>
          </>
        ) : (
          /* No gap to price (level table lookup failed) — state the condition
             rather than showing a zero that reads as "free to open". */
          <Text style={[styles.sealedUnit, { fontSize: u(0.072) }]}>
            OPENS AT LEVEL {sealed.minLevel}
          </Text>
        )}
      </View>
    );
  }

  // Blank, not EMPTY: the door mounts before the deposits query resolves, and
  // an empty vault is a claim this component cannot yet make.
  if (loading) return null;

  if (!amount) {
    return (
      <View style={[styles.stack, { width: boxWidth }]}>
        <Text style={[styles.empty, { fontSize: u(0.155) }]}>EMPTY</Text>
      </View>
    );
  }

  const text = amount.toLocaleString();

  return (
    <View style={[styles.stack, { width: boxWidth }]}>
      <Text style={[styles.label, { fontSize: u(0.072) }]}>
        {ready ? 'MATURED' : 'IN THE VAULT'}
      </Text>
      <Text style={[styles.figure, { fontSize: figureSize(text, boxWidth, u(0.3)) }]}>
        {text}
      </Text>
      <Text style={[styles.unit, { fontSize: u(0.08) }]}>POWR</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { alignItems: 'center', justifyContent: 'center' },

  label: { fontWeight: '700', letterSpacing: 1.4, color: ACCENT_SOFT, opacity: 0.75 },

  figure: {
    fontWeight: '200',
    letterSpacing: -1,
    color: ACCENT,
    fontVariant: ['tabular-nums'],
    // Tight leading: the default line box on a light weight this large opens a
    // gap the circle has no room for.
    includeFontPadding: false,
  },
  unit: { fontWeight: '400', letterSpacing: 2, color: ACCENT_SOFT, opacity: 0.8, marginTop: 1 },
  // Tighter tracking than `unit`: "POWR TO LEVEL 10" is four times the run of
  // "POWR", and at letterSpacing 2 it kisses the bevel.
  sealedUnit: { fontWeight: '400', letterSpacing: 1.2, color: ACCENT_SOFT, opacity: 0.8, marginTop: 1 },

  empty: { fontWeight: '300', letterSpacing: 2, color: MUTED },
});

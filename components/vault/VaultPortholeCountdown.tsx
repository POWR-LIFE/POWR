import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ACCENT, ACCENT_SOFT, DIM } from './potTokens';

/**
 * COMING SOON, behind the glass: the pre-launch porthole runs the countdown
 * to `vault_launch_at`.
 *
 * The clock was deliberately moved OUT of the porthole when the Vault went
 * live ("a porthole is a window onto what is IN the vault" — VaultReadout).
 * Pre-launch is the one state where the time IS the contents: nothing can be
 * inspected or claimed yet, and the opening date is the only thing the door
 * has to say. The announcement card that used to sit under the door is gone
 * for the same reason — the vault itself carries it.
 *
 * A separate leaf for the same reason VaultTimer is one: this ticks once a
 * second, and that re-render must touch three <Text>s — never the GL door or
 * the Animated graph around it.
 *
 * Sized in fractions of the porthole diameter, like VaultReadout — the door
 * scales with the viewport and absolute glyphs spill past the glass.
 */
export function VaultPortholeCountdown({
  diameter,
  target,
}: {
  /** Porthole diameter in px — every glyph is sized off this. */
  diameter: number;
  /** ISO instant the doors open. */
  target: string;
}) {
  const u = (f: number) => Math.round(diameter * f);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const totalSec = Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
  const days = Math.floor(totalSec / 86400);
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(Math.floor((totalSec % 86400) / 3600))}:${pad(
    Math.floor((totalSec % 3600) / 60),
  )}:${pad(totalSec % 60)}`;

  return (
    <View style={[styles.stack, { width: diameter * 0.8 }]}>
      <Text style={[styles.label, { fontSize: u(0.072) }]}>COMING SOON</Text>
      {days > 0 ? (
        <>
          <Text style={[styles.figure, { fontSize: u(0.26) }]}>
            {days}
            <Text style={[styles.unit, { fontSize: u(0.15) }]}>d</Text>
          </Text>
          <Text style={[styles.clock, { fontSize: u(0.1) }]}>{clock}</Text>
        </>
      ) : (
        /* On the last day the clock IS the countdown — same rule as
           VaultTimer: it takes the figure treatment rather than trailing a
           "0d" that never moves. */
        <Text style={[styles.figure, { fontSize: u(0.185) }]}>{clock}</Text>
      )}
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
    // Tight leading — same reason as VaultReadout: the default line box on a
    // light weight this large opens a gap the circle has no room for.
    includeFontPadding: false,
  },
  unit: { fontWeight: '300', color: ACCENT },

  clock: {
    fontWeight: '200',
    letterSpacing: 0.5,
    color: DIM,
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
});

import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { ACCENT, DIM, MUTED } from './potTokens';

/**
 * The countdown under the door.
 *
 * It used to sit behind the porthole glass, which put the clock where the
 * contents belong — see VaultReadout. Down here it reads as the caption to the
 * vault rather than the thing inside it.
 *
 * It is a separate component so that a second passing re-renders two <Text>s
 * and nothing else: the door above owns a GL view and the hold-gesture
 * Animated graph, and neither should be touched once a second.
 */

/** Whole days remaining, plus the live clock beneath them. */
function split(targetIso: string, now: number) {
  const totalSec = Math.max(0, Math.floor((new Date(targetIso).getTime() - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    days: Math.floor(totalSec / 86400),
    clock: `${pad(Math.floor((totalSec % 86400) / 3600))}:${pad(
      Math.floor((totalSec % 3600) / 60),
    )}:${pad(totalSec % 60)}`,
  };
}

export interface VaultTimerProps {
  /** When the soonest deposit matures. */
  vestsAt: string;
  /**
   * When its vest window opened. Only drives the fuse below the digits — the
   * countdown itself needs no start, so this stays optional and the fuse is
   * simply absent when the caller can't say where the window began.
   */
  startAt?: string | null;
  /**
   * What is being counted down to. The timer serves every state of the screen,
   * so the caller frames it: a Vault Day opens rather than unlocks, and once
   * something has matured this is the NEXT unlock, not the only one.
   */
  label?: string;
  /** Spacing only — the timer sits under a card in some states and not others. */
  style?: StyleProp<ViewStyle>;
}

export function VaultTimer({
  vestsAt,
  startAt = null,
  label = 'UNLOCKS IN',
  style,
}: VaultTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { days, clock } = split(vestsAt, now);

  // The fuse: fraction of the window still to run. Recomputed on the same tick
  // as the digits deliberately — derived from a prop it would drift from the
  // clock it sits under, which is the one thing this element must never do.
  let remaining: number | null = null;
  if (startAt) {
    const start = new Date(startAt).getTime();
    const end = new Date(vestsAt).getTime();
    remaining = end > start ? Math.min(1, Math.max(0, (end - now) / (end - start))) : 0;
  }

  return (
    <View style={[styles.stack, style]}>
      <Text style={styles.label}>{label}</Text>
      {/* On the last day the clock IS the countdown, so it takes the figure
          size and the accent rather than trailing a "0d" that never moves. */}
      {days > 0 ? (
        <Text style={styles.line}>
          <Text style={styles.days}>{days}</Text>
          <Text style={styles.unit}>d</Text>
          <Text style={styles.clock}>  {clock}</Text>
        </Text>
      ) : (
        <Text style={styles.line}>
          <Text style={styles.days}>{clock}</Text>
        </Text>
      )}

      {/* Burns down from BOTH ends toward the middle, so the vest window reads
          as closing in rather than filling up. Centred track + a percentage
          width is what makes it symmetrical; the gradient's transparent stops
          keep the ends soft, so it never reads as a progress BAR with two hard
          edges — at a glance it is a fuse, not a meter. */}
      {remaining != null && (
        <View style={styles.fuseTrack}>
          <LinearGradient
            colors={FUSE_COLOURS}
            locations={[0, 0.5, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.fuse, { width: `${remaining * 100}%` }]}
          />
        </View>
      )}
    </View>
  );
}

// Gold at the centre, nothing at the ends. Held here rather than inline so the
// array identity is stable across the once-a-second re-render.
const FUSE_COLOURS = ['rgba(232,210,0,0)', 'rgba(232,210,0,0.55)', 'rgba(232,210,0,0)'] as const;

const styles = StyleSheet.create({
  stack: { alignItems: 'center' },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 2, color: MUTED },
  line: { marginTop: 6, textAlign: 'center' },
  days: {
    fontSize: 27, fontWeight: '200', letterSpacing: -0.5, color: ACCENT,
    fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: 17, fontWeight: '300', color: ACCENT },
  clock: {
    fontSize: 23, fontWeight: '200', letterSpacing: 0.5, color: DIM,
    fontVariant: ['tabular-nums'],
  },

  // Fixed track, centred content — the fuse shrinks toward this centre line.
  fuseTrack: { width: 210, height: 1, marginTop: 14, alignItems: 'center' },
  fuse: { height: 1 },
});

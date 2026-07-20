import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { rangeLabel, type LookbackPeriod } from '@/lib/progressLookback';

const TEXT  = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';
const DIM   = 'rgba(255,255,255,0.5)';

/**
 * ‹ date-range › stepper under the D/W/M pill. Steps one day/week/month back
 * or forward; the forward chevron hides at the current period, and tapping
 * the label while in the past snaps back to today.
 */
export function TimeStepper({
  period, offset, onOffsetChange,
}: {
  period: LookbackPeriod;
  offset: number;
  onOffsetChange: (offset: number) => void;
}) {
  const atNow = offset === 0;
  return (
    <View style={styles.row}>
      <Pressable hitSlop={10} style={styles.arrow} onPress={() => onOffsetChange(offset - 1)}>
        <Ionicons name="chevron-back" size={13} color={DIM} />
      </Pressable>
      <Pressable
        style={styles.labelWrap}
        disabled={atNow}
        onPress={() => onOffsetChange(0)}
        hitSlop={6}
      >
        <Text style={[styles.label, !atNow && styles.labelPast]}>{rangeLabel(period, offset)}</Text>
        {!atNow && <Ionicons name="refresh-outline" size={10} color={MUTED} style={styles.returnIcon} />}
      </Pressable>
      <Pressable
        hitSlop={10}
        style={[styles.arrow, atNow && styles.arrowHidden]}
        disabled={atNow}
        onPress={() => onOffsetChange(Math.min(0, offset + 1))}
      >
        <Ionicons name="chevron-forward" size={13} color={DIM} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, marginTop: -6,
  },
  arrow: {
    paddingHorizontal: 8, paddingVertical: 4,
  },
  arrowHidden: { opacity: 0 },
  labelWrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, minWidth: 128,
  },
  label: {
    fontSize: 10, fontWeight: '400', letterSpacing: 0.8, color: MUTED,
    textAlign: 'center',
  },
  labelPast: { color: TEXT },
  returnIcon: { marginTop: 1 },
});

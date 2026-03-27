import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.25)';

interface WeekStatsBarProps {
  sessions: number;
  steps: number;
  powrEarned: number;
}

function formatSteps(steps: number): string {
  if (steps >= 1000) return `${(steps / 1000).toFixed(1)}k`;
  return String(steps);
}

export function WeekStatsBar({ sessions, steps, powrEarned }: WeekStatsBarProps) {
  return (
    <View style={styles.card}>
      <StatCol value={String(sessions)} label="Sessions" />
      <View style={styles.divider} />
      <StatCol value={formatSteps(steps)} label="Steps" />
      <View style={styles.divider} />
      <StatCol value={String(powrEarned)} label="POWR earned" gold />
    </View>
  );
}

function StatCol({ value, label, gold }: { value: string; label: string; gold?: boolean }) {
  return (
    <View style={styles.col}>
      <Text style={[styles.value, gold && { color: GOLD }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(40,40,40,0.85)',
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  col: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  value: {
    fontSize: 22,
    fontWeight: '100',
    letterSpacing: -1,
    color: TEXT,
  },
  label: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: MUTED,
    textTransform: 'uppercase',
  },
  divider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});

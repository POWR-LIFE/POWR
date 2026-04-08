import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LevelDef } from '@/constants/levels';

const GOLD = '#E8D200';

interface RingMetric {
  label: string;
  icon: string;
  value: string;
  max: string;
  pct: number; // 0–1
  colour: string;
  gradId: string;
  gradStart: string;
  gradEnd: string;
}

interface LevelCardProps {
  levelNumber: number;
  levelName: string;
  xp: number;
  xpMax: number;
  metrics: [RingMetric, RingMetric, RingMetric];
  nextLevelHint: string;
  currentLevel: LevelDef;
}

export function LevelCard({ levelNumber, levelName, xp, xpMax, metrics, nextLevelHint, currentLevel }: LevelCardProps) {
  const overallPct = Math.min(xp / xpMax, 1);
  const pill = currentLevel.pill;

  return (
    <View style={styles.card}>
      {/* Top row: level number, name, XP */}
      <View style={styles.topRow}>
        <Text style={styles.lvNum}>{levelNumber}</Text>
        <Text style={styles.lvName}>{levelName}</Text>
        <View style={styles.xpBox}>
          <Text style={styles.xpVal}>{xp.toLocaleString()}</Text>
          <Text style={styles.xpMax}>/ {xpMax.toLocaleString()} XP</Text>
        </View>
      </View>

      {/* Three metric columns side by side */}
      <View style={styles.metricsRow}>
        {metrics.map((m) => (
          <View key={m.gradId} style={styles.metricCol}>
            <Ionicons name={m.icon as any} size={16} color={m.colour} />
            <Text style={[styles.metricVal, { color: m.colour }]}>{m.value}</Text>
            <Text style={styles.metricMax}>/{m.max}</Text>
            <View style={styles.barWrap}>
              <View style={[styles.bar, { width: `${m.pct * 100}%` as any, backgroundColor: m.colour }]} />
            </View>
          </View>
        ))}
      </View>

      {/* Next level hint */}
      <View style={styles.nextLevel}>
        <Text style={styles.nextLevelText}>{nextLevelHint}</Text>
        <View style={[styles.nextLevelBadge, { backgroundColor: pill.bg, borderColor: pill.border }]}>
          <Text style={[styles.nextLevelBadgeText, { color: pill.text }]}>{currentLevel.name.toUpperCase()}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(40,40,40,0.85)',
    padding: 14,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    flexWrap: 'wrap',
  },
  lvNum: {
    fontSize: 20,
    fontWeight: '100',
    color: GOLD,
    lineHeight: 20,
  },
  lvName: {
    fontSize: 11,
    fontWeight: '300',
    color: '#F2F2F2',
  },
  xpBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginLeft: 'auto',
  },
  xpVal: {
    fontSize: 9,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.75)',
    width: 26,
    textAlign: 'right',
  },
  xpMax: {
    fontSize: 9,
    fontWeight: '300',
    color: '#F2F2F2',
    width: 56,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  metricVal: {
    fontSize: 13,
    fontWeight: '300',
    lineHeight: 14,
  },
  metricMax: {
    fontSize: 9,
    fontWeight: '300',
    color: '#F2F2F2',
    marginTop: -4,
  },
  barWrap: {
    width: '100%',
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 1,
  },
  nextLevel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: 'rgba(135,135,135,0.07)',
  },
  nextLevelText: {
    fontSize: 9,
    fontWeight: '300',
    color: '#F2F2F2',
  },
  nextLevelBadge: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  nextLevelBadgeText: {
    fontSize: 8,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});

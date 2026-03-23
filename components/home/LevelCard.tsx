import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

const GOLD = '#facc15';
const ORANGE = '#f97316';
const GREEN = '#4ade80';

// Ring geometry
const SIZE = 88;
const CX = SIZE / 2;
const CY = SIZE / 2;
const STROKE = 4;
const RADII = [38, 29, 20] as const; // outer → inner

function ringCircumference(r: number) {
  return 2 * Math.PI * r;
}

function strokeOffset(r: number, pct: number) {
  const c = ringCircumference(r);
  return c - pct * c;
}

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
}

export function LevelCard({ levelNumber, levelName, xp, xpMax, metrics, nextLevelHint }: LevelCardProps) {
  const overallPct = Math.min(xp / xpMax, 1);

  return (
    <View style={styles.card}>
      <View style={styles.main}>
        {/* Concentric rings */}
        <View style={styles.ringsWrap}>
          <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <Defs>
              {metrics.map((m) => (
                <LinearGradient key={m.gradId} id={m.gradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <Stop offset="0%" stopColor={m.gradStart} />
                  <Stop offset="100%" stopColor={m.gradEnd} />
                </LinearGradient>
              ))}
            </Defs>

            {RADII.map((r, i) => {
              const m = metrics[i];
              const c = ringCircumference(r);
              return (
                <React.Fragment key={r}>
                  {/* Track */}
                  <Circle
                    cx={CX} cy={CY} r={r}
                    fill="none"
                    stroke="rgba(255,255,255,0.07)"
                    strokeWidth={STROKE}
                  />
                  {/* Progress */}
                  <Circle
                    cx={CX} cy={CY} r={r}
                    fill="none"
                    stroke={`url(#${m.gradId})`}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={strokeOffset(r, m.pct)}
                    transform={`rotate(-90 ${CX} ${CY})`}
                  />
                </React.Fragment>
              );
            })}
          </Svg>

          {/* Center readout */}
          <View style={styles.ringCenter}>
            <Text style={styles.rcPct}>{Math.round(overallPct * 100)}%</Text>
            <Text style={styles.rcSub}>LVL {levelNumber}</Text>
          </View>
        </View>

        {/* Level info */}
        <View style={styles.info}>
          <View style={styles.topRow}>
            <Text style={styles.lvNum}>{levelNumber}</Text>
            <Text style={styles.lvName}>{levelName}</Text>
            <Text style={styles.xp}>
              <Text style={styles.xpStrong}>{xp.toLocaleString()}</Text>
              {` / ${xpMax.toLocaleString()} XP`}
            </Text>
          </View>

          {/* Legend rows */}
          <View style={styles.legend}>
            {metrics.map((m) => (
              <View key={m.gradId} style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: m.colour }]} />
                <View style={styles.barWrap}>
                  <View style={[styles.bar, { width: `${m.pct * 100}%` as any, backgroundColor: m.colour }]} />
                </View>
                <Text style={[styles.legendVal, { color: m.colour }]}>{m.value}</Text>
                <Text style={styles.legendMax}>/{m.max}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* Next level hint */}
      <View style={styles.nextLevel}>
        <Text style={styles.nextLevelText}>{nextLevelHint}</Text>
        <View style={styles.nextLevelBadge}>
          <Text style={styles.nextLevelBadgeText}>GRINDER</Text>
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
    padding: 12,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ringsWrap: {
    width: SIZE,
    height: SIZE,
    flexShrink: 0,
    position: 'relative',
  },
  ringCenter: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  rcPct: {
    fontSize: 15,
    fontWeight: '200',
    color: '#F2F2F2',
    lineHeight: 16,
  },
  rcSub: {
    fontSize: 7,
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    marginBottom: 10,
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
    color: 'rgba(255,255,255,0.5)',
  },
  xp: {
    fontSize: 9,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.25)',
    marginLeft: 'auto',
  },
  xpStrong: {
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500',
  },
  legend: {
    gap: 7,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  barWrap: {
    flex: 1,
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 1,
  },
  legendVal: {
    fontSize: 9,
    fontWeight: '400',
    minWidth: 24,
    textAlign: 'right',
  },
  legendMax: {
    fontSize: 9,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.25)',
  },
  nextLevel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: 'rgba(135,135,135,0.07)',
  },
  nextLevelText: {
    fontSize: 9,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.5)',
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

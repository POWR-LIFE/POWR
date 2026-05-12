import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { WeeklyRingData } from './WeeklyActivityRings';

const CIRCLE_SIZE = 48;
const CIRCLE_R    = 19;
const CIRCLE_SW   = 4;

function MiniCircle({ data, onPress }: { data: WeeklyRingData; onPress?: () => void }) {
  const pct   = Math.min(data.pct, 1);
  const circ  = 2 * Math.PI * CIRCLE_R;
  const offset = circ - pct * circ;
  const label = `${Math.round(pct * 100)}%`;
  const IconComp = data.iconLib === 'material-community' ? MaterialCommunityIcons : Ionicons;

  return (
    <Pressable style={styles.item} onPress={onPress}>
      <View style={styles.circleWrap}>
        <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE}>
          <Circle
            cx={CIRCLE_SIZE / 2} cy={CIRCLE_SIZE / 2} r={CIRCLE_R}
            fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={CIRCLE_SW}
          />
          <Circle
            cx={CIRCLE_SIZE / 2} cy={CIRCLE_SIZE / 2} r={CIRCLE_R}
            fill="none" stroke={data.colour} strokeWidth={CIRCLE_SW}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${CIRCLE_SIZE / 2} ${CIRCLE_SIZE / 2})`}
          />
        </Svg>
        <View style={styles.circleLabel}>
          <Text style={[styles.pctText, { color: data.colour }]}>{label}</Text>
        </View>
      </View>
      <IconComp name={data.icon as any} size={14} color="#F2F2F2" />
    </Pressable>
  );
}

interface StickyActivityIndicatorsProps {
  rings: WeeklyRingData[];
  onPressRing?: (type: string) => void;
}

export function StickyActivityIndicators({ rings, onPressRing }: StickyActivityIndicatorsProps) {
  return (
    <View style={styles.row}>
      {rings.map((d) => (
        <MiniCircle key={d.type} data={d} onPress={() => onPressRing?.(d.type)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    flex: 1,
  },
  item: {
    alignItems: 'center',
    gap: 4,
  },
  circleWrap: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    position: 'relative',
  },
  circleLabel: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pctText: {
    fontSize: 11,
    fontWeight: '600',
  },
});

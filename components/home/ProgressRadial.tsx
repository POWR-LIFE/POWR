import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

const GOLD = '#E8D200';

interface Tick {
  label: string;
  active: boolean;
  isToday: boolean;
}

interface ProgressRadialProps {
  pct: number;
  value: string;
  maxLabel: string;
  subLabel: string;
  gradientColors: string[];
  ticks?: Tick[];
  size?: number;
  iconName?: any;
  iconLib?: 'ionicons' | 'material-community';
  pointsValue?: number;
}

export function ProgressRadial({
  pct,
  value,
  maxLabel,
  subLabel,
  gradientColors,
  ticks,
  size = 210,
  iconName,
  iconLib = 'ionicons',
  pointsValue,
}: ProgressRadialProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34; // approx 72 for size 210
  const strokeWidth = size * 0.043; // approx 9 for size 210
  const circumference = 2 * Math.PI * r;
  const offset = circumference - pct * circumference;

  const tickInnerR = r + strokeWidth / 2 + 4;

  const getValueFontSize = (val: string) => {
    const scale = size / 210;
    if (val.length <= 2) return Math.round(56 * scale);
    if (val.length <= 4) return Math.round(46 * scale);
    return Math.round(36 * scale);
  };
  const maxLabelSize = Math.round((value.length > 4 ? 12 : 14) * (size / 210));
  const subLabelSize = Math.max(6, Math.round(7 * (size / 210)));

  const PAD = 16;
  return (
    <View style={[styles.container, { width: size + PAD * 2, height: size + PAD * 2 }]}>
      <Svg width={size + PAD * 2} height={size + PAD * 2} viewBox={`${-PAD} ${-PAD} ${size + PAD * 2} ${size + PAD * 2}`}>
        <Defs>
          <LinearGradient id="radial-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            {gradientColors.map((color, i) => (
              <Stop 
                key={color} 
                offset={`${(i / (gradientColors.length - 1)) * 100}%`} 
                stopColor={color} 
              />
            ))}
          </LinearGradient>
        </Defs>

        {/* Background Circle */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={strokeWidth}
        />

        {/* Progress Circle */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="url(#radial-grad)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />

        {/* Ticks */}
        {ticks && ticks.map((tick, i) => {
          const angleDeg = i * (360 / ticks.length) - 90;
          const angleRad = angleDeg * (Math.PI / 180);
          const tickR1 = tickInnerR;
          const tickR2 = tickR1 + (tick.active ? 10 : 6);
          const labelR = tickR2 + 8;
          
          return (
            <React.Fragment key={i}>
              <Line
                x1={cx + tickR1 * Math.cos(angleRad)}
                y1={cy + tickR1 * Math.sin(angleRad)}
                x2={cx + tickR2 * Math.cos(angleRad)}
                y2={cy + tickR2 * Math.sin(angleRad)}
                stroke={tick.active ? GOLD : tick.isToday ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)'}
                strokeWidth={tick.active ? 2.5 : 1.5}
                strokeLinecap="round"
              />
              <SvgText
                x={cx + labelR * Math.cos(angleRad)}
                y={cy + labelR * Math.sin(angleRad) + 3}
                textAnchor="middle"
                fontSize={8}
                fontWeight={tick.isToday ? '700' : tick.active ? '500' : '400'}
                fill={tick.active ? GOLD : tick.isToday ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.22)'}
              >
                {tick.label.toUpperCase()}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>


      <View style={styles.center}>
        <View style={styles.countRow}>
          <Text style={[styles.bigNum, { fontSize: getValueFontSize(value), lineHeight: getValueFontSize(value) + 2 }]}>{value}</Text>
          <Text style={[styles.maxLabel, { fontSize: maxLabelSize }]}>{maxLabel}</Text>
        </View>
        <Text style={[styles.subLabel, { fontSize: subLabelSize }]}>{subLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  bigNum: {
    fontSize: 56,
    fontWeight: '100',
    color: '#F2F2F2',
    letterSpacing: -2,
    lineHeight: 58,
  },
  maxLabel: {
    fontWeight: '300',
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: -0.5,
    marginLeft: 4,
    marginBottom: 8,
  },
  subLabel: {
    fontSize: 7,
    fontWeight: '500',
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.25)',
    textTransform: 'uppercase',
  },
  badge: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});

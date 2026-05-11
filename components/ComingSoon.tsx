import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

const GOLD = '#E8D200';
const GOLD_SOFT = '#FFE97A';
const TEXT = '#F2F2F2';
const MUTED = 'rgba(255,255,255,0.35)';

const SIZE = 168;
const STROKE = 1.5;
const R_OUTER = (SIZE - STROKE) / 2;
const R_INNER = R_OUTER - 10;
const C_OUTER = 2 * Math.PI * R_OUTER;
const C_INNER = 2 * Math.PI * R_INNER;

interface ComingSoonProps {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
}

export function ComingSoon({
  eyebrow = 'IN DEVELOPMENT',
  title = 'Coming Soon',
  subtitle = "We're putting the finishing touches on this.",
}: ComingSoonProps) {
  const outerRot = useSharedValue(0);
  const innerRot = useSharedValue(0);

  useEffect(() => {
    outerRot.value = withRepeat(
      withTiming(360, { duration: 9000, easing: Easing.linear }),
      -1,
      false,
    );
    innerRot.value = withRepeat(
      withTiming(-360, { duration: 14000, easing: Easing.linear }),
      -1,
      false,
    );
  }, []);

  const outerSpin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${outerRot.value}deg` }],
  }));
  const innerSpin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${innerRot.value}deg` }],
  }));

  return (
    <View style={styles.container}>
      <View style={styles.ringWrap}>
        {/* Outer rotating progress arc */}
        <Animated.View style={[StyleSheet.absoluteFill, outerSpin]}>
          <Svg width={SIZE} height={SIZE}>
            <Defs>
              <LinearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={GOLD_SOFT} stopOpacity="1" />
                <Stop offset="1" stopColor={GOLD} stopOpacity="0.2" />
              </LinearGradient>
            </Defs>
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R_OUTER}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={STROKE}
              fill="none"
            />
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R_OUTER}
              stroke="url(#goldGrad)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${C_OUTER * 0.75} ${C_OUTER * 0.25}`}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          </Svg>
        </Animated.View>

        {/* Inner counter-rotating arc */}
        <Animated.View style={[StyleSheet.absoluteFill, innerSpin]}>
          <Svg width={SIZE} height={SIZE}>
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R_INNER}
              stroke="rgba(255,255,255,0.04)"
              strokeWidth={STROKE * 0.6}
              fill="none"
            />
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R_INNER}
              stroke={GOLD}
              strokeOpacity={0.45}
              strokeWidth={STROKE * 0.6}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${C_INNER * 0.5} ${C_INNER * 0.5}`}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          </Svg>
        </Animated.View>

        {/* Logo */}
        <View style={styles.logoWrap}>
          <Image
            source={require('@/assets/images/powr_transparent.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
      </View>

      <View style={styles.textBlock}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 24,
    gap: 28,
  },
  ringWrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    width: SIZE * 0.5,
    height: SIZE * 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  textBlock: {
    alignItems: 'center',
    gap: 8,
  },
  eyebrow: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 3,
    color: GOLD,
    opacity: 0.7,
  },
  title: {
    fontSize: 22,
    fontWeight: '200',
    letterSpacing: -0.4,
    color: TEXT,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '300',
    color: MUTED,
    textAlign: 'center',
    letterSpacing: 0.3,
    maxWidth: 280,
    lineHeight: 19,
  },
});

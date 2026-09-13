import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';

/**
 * The podium's placement rings: two arcs in the place's metal turning against
 * each other around the avatar. Shared by the live leaderboard podium and the
 * between-events preview so an empty seat and a won one are the same object.
 */
export function PodiumAvatarRing({
  avatarSize,
  colour,
  colourSoft,
  isFirst,
  children,
}: {
  avatarSize: number;
  colour: string;
  colourSoft: string;
  isFirst: boolean;
  children: React.ReactNode;
}) {
  const outerRot = useSharedValue(0);
  const innerRot = useSharedValue(0);

  useEffect(() => {
    outerRot.value = withRepeat(
      withTiming(360, { duration: isFirst ? 7000 : 11000, easing: Easing.linear }),
      -1,
      false,
    );
    innerRot.value = withRepeat(
      withTiming(-360, { duration: isFirst ? 12000 : 18000, easing: Easing.linear }),
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

  const PAD = 14;
  const SZ = avatarSize + PAD * 2;
  const STROKE = 1.5;
  const R_O = (SZ - STROKE) / 2 - 2;
  const R_I = R_O - 7;
  const C_O = 2 * Math.PI * R_O;
  const C_I = 2 * Math.PI * R_I;
  const gradId = `pag_${colour.replace('#', '')}`;

  return (
    <View style={{
      width: SZ, height: SZ,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: colour,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: isFirst ? 0.85 : 0.5,
      shadowRadius: isFirst ? 22 : 11,
    }}>
      {/* Outer clockwise arc */}
      <Animated.View style={[StyleSheet.absoluteFill, outerSpin]}>
        <Svg width={SZ} height={SZ}>
          <Defs>
            <SvgLinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colourSoft} stopOpacity="1" />
              <Stop offset="1" stopColor={colour} stopOpacity="0.1" />
            </SvgLinearGradient>
          </Defs>
          <Circle cx={SZ / 2} cy={SZ / 2} r={R_O} stroke="rgba(255,255,255,0.05)" strokeWidth={STROKE} fill="none" />
          <Circle
            cx={SZ / 2} cy={SZ / 2} r={R_O}
            stroke={`url(#${gradId})`}
            strokeWidth={STROKE} strokeLinecap="round" fill="none"
            strokeDasharray={`${C_O * 0.72} ${C_O * 0.28}`}
            transform={`rotate(-90 ${SZ / 2} ${SZ / 2})`}
          />
        </Svg>
      </Animated.View>

      {/* Inner counter-clockwise arc */}
      <Animated.View style={[StyleSheet.absoluteFill, innerSpin]}>
        <Svg width={SZ} height={SZ}>
          <Circle cx={SZ / 2} cy={SZ / 2} r={R_I} stroke="rgba(255,255,255,0.04)" strokeWidth={STROKE * 0.6} fill="none" />
          <Circle
            cx={SZ / 2} cy={SZ / 2} r={R_I}
            stroke={colour} strokeOpacity={isFirst ? 0.55 : 0.35}
            strokeWidth={STROKE * 0.6} strokeLinecap="round" fill="none"
            strokeDasharray={`${C_I * 0.45} ${C_I * 0.55}`}
            transform={`rotate(-90 ${SZ / 2} ${SZ / 2})`}
          />
        </Svg>
      </Animated.View>

      {/* Avatar */}
      {children}
    </View>
  );
}

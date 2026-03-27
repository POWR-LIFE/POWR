import React from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient as SvgLinearGradient,
  Polygon,
  RadialGradient as SvgRadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

const { width: W, height: H } = Dimensions.get('window');

export function GeometricBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">

      {/* Base — cool dark grey to near-black */}
      <LinearGradient
        colors={['#181818', '#0e0e0e', '#060606']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        <Defs>

          {/* Soft white bloom — top-left */}
          <SvgRadialGradient id="whiteBloom" cx="15%" cy="8%" r="75%">
            <Stop offset="0%"   stopColor="#ffffff" stopOpacity="0.12" />
            <Stop offset="45%"  stopColor="#ffffff" stopOpacity="0.04" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0"    />
          </SvgRadialGradient>

          {/* Top-left lit panel */}
          <SvgLinearGradient id="topPanel" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%"   stopColor="#ffffff" stopOpacity="0.07" />
            <Stop offset="60%"  stopColor="#ffffff" stopOpacity="0.02" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0"    />
          </SvgLinearGradient>

          {/* Right accent panel */}
          <SvgLinearGradient id="rightPanel" x1="100%" y1="0%" x2="40%" y2="100%">
            <Stop offset="0%"   stopColor="#ffffff" stopOpacity="0.05" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0"    />
          </SvgLinearGradient>

          {/* Bottom shadow panel */}
          <SvgLinearGradient id="bottomPanel" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%"   stopColor="#000000" stopOpacity="0.40" />
            <Stop offset="100%" stopColor="#000000" stopOpacity="0"    />
          </SvgLinearGradient>

        </Defs>

        {/* Full-screen soft white bloom */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#whiteBloom)" />

        {/* Top-left lit panel */}
        <Polygon
          points={`0,0  ${W * 0.88},0  ${W * 0.35},${H * 0.42}  0,${H * 0.28}`}
          fill="url(#topPanel)"
        />

        {/* Right accent panel */}
        <Polygon
          points={`${W},0  ${W},${H * 0.65}  ${W * 0.58},${H * 0.38}  ${W * 0.72},0`}
          fill="url(#rightPanel)"
        />

        {/* Bottom shadow panel */}
        <Polygon
          points={`0,${H * 0.62}  ${W * 0.55},${H * 0.45}  ${W},${H * 0.6}  ${W},${H}  0,${H}`}
          fill="url(#bottomPanel)"
        />

        {/* Right panel boundary */}
        <Line
          x1={W * 0.72} y1={0}
          x2={W * 0.58} y2={H * 0.38}
          stroke="#ffffff" strokeWidth={0.6} strokeOpacity={0.12}
        />

        {/* Large arc — right edge */}
        <Circle
          cx={W + 60}  cy={H * 0.44}
          r={200}
          fill="none"
          stroke="#ffffff" strokeWidth={1.0} strokeOpacity={0.09}
        />
        <Circle
          cx={W + 60}  cy={H * 0.44}
          r={265}
          fill="none"
          stroke="#ffffff" strokeWidth={0.6} strokeOpacity={0.05}
        />

        {/* Nodes — right panel corners */}
        <Circle cx={W * 0.72} cy={0}        r={2} fill="#ffffff" fillOpacity={0.30} />
        <Circle cx={W * 0.58} cy={H * 0.38} r={2} fill="#ffffff" fillOpacity={0.22} />

      </Svg>
    </View>
  );
}

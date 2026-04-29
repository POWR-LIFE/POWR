import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Svg, {
    Circle,
    Defs,
    Line,
    Polygon,
    Rect,
    Stop,
    LinearGradient as SvgLinearGradient,
    RadialGradient as SvgRadialGradient,
} from 'react-native-svg';

const { width: W, height: H } = Dimensions.get('window');

/**
 * Profile-specific geometric background.
 * Differs from the home background:
 *  - Gold radial bloom centred behind the avatar area (top-centre)
 *  - Secondary gold bloom mid-screen (behind the POWR points stat)
 *  - Polygon panels tinted gold rather than pure white
 *  - Gold diagonal boundary lines + node dots
 *  - Retained dark base gradient and structural depth
 */
export function ProfileGeometricBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">

      {/* Base — same dark ramp as home */}
      <LinearGradient
        colors={['#181818', '#0e0e0e', '#060606']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        <Defs>

          {/* Soft white bloom — top-left, adds depth */}
          <SvgRadialGradient id="pf_whiteBloom" cx="10%" cy="5%" r="60%">
            <Stop offset="0%"   stopColor="#ffffff" stopOpacity="0.08" />
            <Stop offset="50%"  stopColor="#ffffff" stopOpacity="0.02" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0"    />
          </SvgRadialGradient>

          {/* Top panel — white tint */}
          <SvgLinearGradient id="pf_topPanel" x1="50%" y1="0%" x2="50%" y2="100%">
            <Stop offset="0%"   stopColor="#ffffff" stopOpacity="0.04" />
            <Stop offset="60%"  stopColor="#ffffff" stopOpacity="0.01" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0"    />
          </SvgLinearGradient>

          {/* Left panel — faint white sweep */}
          <SvgLinearGradient id="pf_leftPanel" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%"   stopColor="#ffffff" stopOpacity="0.03" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0"    />
          </SvgLinearGradient>

          {/* Right panel — white accent */}
          <SvgLinearGradient id="pf_rightPanel" x1="100%" y1="0%" x2="40%" y2="100%">
            <Stop offset="0%"   stopColor="#ffffff" stopOpacity="0.04" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0"    />
          </SvgLinearGradient>

          {/* Bottom shadow */}
          <SvgLinearGradient id="pf_bottomPanel" x1="0%" y1="0%" x2="50%" y2="100%">
            <Stop offset="0%"   stopColor="#000000" stopOpacity="0.35" />
            <Stop offset="100%" stopColor="#000000" stopOpacity="0"    />
          </SvgLinearGradient>

        </Defs>

        {/* ── Fills ─────────────────────────────────────────── */}

        {/* Soft white bloom */}
        <Rect x={0} y={0} width={W} height={H} fill="url(#pf_whiteBloom)" />

        {/* Top triangle panel — centred V shape over hero area */}
        <Polygon
          points={`0,0  ${W},0  ${W * 0.62},${H * 0.36}  ${W * 0.38},${H * 0.36}`}
          fill="url(#pf_topPanel)"
        />

        {/* Left panel sweep */}
        <Polygon
          points={`0,0  ${W * 0.44},0  ${W * 0.22},${H * 0.55}  0,${H * 0.38}`}
          fill="url(#pf_leftPanel)"
        />

        {/* Right panel */}
        <Polygon
          points={`${W},0  ${W},${H * 0.60}  ${W * 0.62},${H * 0.36}  ${W * 0.76},0`}
          fill="url(#pf_rightPanel)"
        />

        {/* Bottom shadow */}
        <Polygon
          points={`0,${H * 0.65}  ${W * 0.5},${H * 0.48}  ${W},${H * 0.62}  ${W},${H}  0,${H}`}
          fill="url(#pf_bottomPanel)"
        />

        {/* ── Structural lines ──────────────────────────────── */}

        {/* Left panel edge — white */}
        <Line
          x1={W * 0.44} y1={0}
          x2={W * 0.22} y2={H * 0.55}
          stroke="#ffffff" strokeWidth={0.7} strokeOpacity={0.10}
        />

        {/* Right panel edge — white */}
        <Line
          x1={W * 0.76} y1={0}
          x2={W * 0.62} y2={H * 0.36}
          stroke="#ffffff" strokeWidth={0.5} strokeOpacity={0.10}
        />

        {/* Central convergence line — white, top to mid */}
        <Line
          x1={W * 0.5} y1={0}
          x2={W * 0.5} y2={H * 0.28}
          stroke="#ffffff" strokeWidth={0.5} strokeOpacity={0.08}
        />

        {/* ── Concentric arcs — bottom-right, white ─────────── */}
        <Circle
          cx={W + 40} cy={H * 0.50}
          r={210}
          fill="none"
          stroke="#ffffff" strokeWidth={0.8} strokeOpacity={0.07}
        />
        <Circle
          cx={W + 40} cy={H * 0.50}
          r={290}
          fill="none"
          stroke="#ffffff" strokeWidth={0.5} strokeOpacity={0.04}
        />

        {/* ── Arcs — top-centre behind avatar ───────────────── */}
        <Circle
          cx={W * 0.5} cy={0}
          r={W * 0.55}
          fill="none"
          stroke="#ffffff" strokeWidth={0.8} strokeOpacity={0.08}
        />
        <Circle
          cx={W * 0.5} cy={0}
          r={W * 0.75}
          fill="none"
          stroke="#ffffff" strokeWidth={0.5} strokeOpacity={0.04}
        />

        {/* ── Node dots ─────────────────────────────────────── */}
        <Circle cx={W * 0.44} cy={0}        r={2.5} fill="#ffffff" fillOpacity={0.20} />
        <Circle cx={W * 0.22} cy={H * 0.55} r={2}   fill="#ffffff" fillOpacity={0.12} />
        <Circle cx={W * 0.76} cy={0}        r={2}   fill="#ffffff" fillOpacity={0.25} />
        <Circle cx={W * 0.62} cy={H * 0.36} r={2}   fill="#ffffff" fillOpacity={0.18} />
        <Circle cx={W * 0.5}  cy={0}        r={3}   fill="#ffffff" fillOpacity={0.20} />

      </Svg>
    </View>
  );
}

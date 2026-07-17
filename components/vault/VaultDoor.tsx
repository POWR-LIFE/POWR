import React from 'react';
import Svg, { Circle, Line } from 'react-native-svg';

const GOLD = '#E8D200';

/**
 * A bank-vault door drawn in SVG: bolted outer rim, visible recessed door
 * face with an inner seam, and a spoked handle wheel (spokes contained
 * within the wheel — past it they read as a ship's helm). Parametric on
 * size and accent colour — white monochrome on the Rewards balance row,
 * gold as the Vault screen centrepiece.
 */
export function VaultDoor({ size, color = GOLD }: { size: number; color?: string }) {
  // Bolts sit on a ring between the rim and the door face.
  const bolts = Array.from({ length: 8 }, (_, i) => {
    const angle = ((i * 45 + 22.5) * Math.PI) / 180;
    return { cx: 50 + 43 * Math.cos(angle), cy: 50 + 43 * Math.sin(angle) };
  });
  // Six spokes from hub to wheel rim, offset so none points straight up.
  const spokes = [0, 60, 120, 180, 240, 300].map((deg) => {
    const a = ((deg + 30) * Math.PI) / 180;
    return { x1: 50 + 6 * Math.cos(a), y1: 50 + 6 * Math.sin(a), x2: 50 + 17 * Math.cos(a), y2: 50 + 17 * Math.sin(a) };
  });

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Outer rim */}
      <Circle cx={50} cy={50} r={48} stroke={color} strokeOpacity={0.55} strokeWidth={2.5} fill="rgba(20,20,20,0.92)" />
      {/* Bolts */}
      {bolts.map((b, i) => (
        <Circle key={i} cx={b.cx} cy={b.cy} r={1.8} fill={color} fillOpacity={0.6} />
      ))}
      {/* Recessed door face + inner seam for depth */}
      <Circle cx={50} cy={50} r={37} stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} fill="rgba(255,255,255,0.03)" />
      <Circle cx={50} cy={50} r={29} stroke="rgba(255,255,255,0.10)" strokeWidth={1} fill="none" />
      {/* Handle wheel with contained spokes */}
      <Circle cx={50} cy={50} r={18} stroke={color} strokeWidth={2.5} fill="rgba(0,0,0,0.3)" />
      {spokes.map((s, i) => (
        <Line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={color} strokeWidth={2} strokeLinecap="round" />
      ))}
      {/* Hub */}
      <Circle cx={50} cy={50} r={6} stroke={color} strokeWidth={1.5} fill="rgba(20,20,20,1)" />
    </Svg>
  );
}

import React from 'react';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

const GOLD = '#E8D200';

/**
 * The Vault as a glyph: a floor-safe, front on — rounded-square body on two
 * feet, hinge stubs, corner bolts, and a small contained dial. Parametric on
 * size and accent colour; white monochrome on the Rewards balance row.
 *
 * Two designs came before this, both worth not repeating:
 *
 *  1. A round bank-vault door (concentric rings + a spoked wheel). At 54px a
 *     circle full of spokes IS the tyre glyph — Jamie caught it. The circle
 *     was the problem, not the detailing: no amount of bolts fixed the read.
 *  2. A baked render of the real 3D door. Unmistakable, but a photoreal
 *     object sat too heavy against the page's line iconography — Jamie:
 *     "less intrusive". The hero owns the render; this row wants a glyph.
 *
 *  The square body is what locks the read to "safe": four spokes stay, but
 *  contained in a small dial inside a rectangle they can't be a wheel.
 */
export function VaultDoor({ size, color = GOLD }: { size: number; color?: string }) {
  // Dial spokes: an X, contained within the dial ring — past it they read as
  // a ship's helm (same rule as the old round door).
  const spokes = [45, 135, 225, 315].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return {
      x1: 50 + 4.5 * Math.cos(a), y1: 47 + 4.5 * Math.sin(a),
      x2: 50 + 11.5 * Math.cos(a), y2: 47 + 11.5 * Math.sin(a),
    };
  });
  const bolts = [
    { cx: 26, cy: 26 }, { cx: 74, cy: 26 },
    { cx: 26, cy: 68 }, { cx: 74, cy: 68 },
  ];

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Body */}
      <Rect x={10} y={10} width={80} height={74} rx={12} stroke={color} strokeOpacity={0.55} strokeWidth={2.5} fill="rgba(20,20,20,0.92)" />
      {/* Feet — the strongest "safe, not wheel" cue at small sizes */}
      <Rect x={19} y={84} width={9} height={6} rx={2} fill={color} fillOpacity={0.45} />
      <Rect x={72} y={84} width={9} height={6} rx={2} fill={color} fillOpacity={0.45} />
      {/* Hinge stubs on the right edge */}
      <Rect x={89} y={26} width={6} height={11} rx={2.5} fill={color} fillOpacity={0.55} />
      <Rect x={89} y={57} width={6} height={11} rx={2.5} fill={color} fillOpacity={0.55} />
      {/* Recessed door face */}
      <Rect x={19} y={19} width={62} height={56} rx={8} stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} fill="rgba(255,255,255,0.03)" />
      {/* Corner bolts */}
      {bolts.map((b, i) => (
        <Circle key={i} cx={b.cx} cy={b.cy} r={1.8} fill={color} fillOpacity={0.6} />
      ))}
      {/* Dial */}
      <Circle cx={50} cy={47} r={13} stroke={color} strokeWidth={2.5} fill="rgba(0,0,0,0.3)" />
      {spokes.map((s, i) => (
        <Line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={color} strokeWidth={2} strokeLinecap="round" />
      ))}
      <Circle cx={50} cy={47} r={4} stroke={color} strokeWidth={1.5} fill="rgba(20,20,20,1)" />
    </Svg>
  );
}

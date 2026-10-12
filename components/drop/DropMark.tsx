import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { colours } from '@/constants/tokens';

/**
 * The POWR P as a vessel — the Drop's one object, on the Home card and the
 * reveal alike.
 *
 * The mark is two pieces (the leg and the bowl) with a slanted gap between
 * them, traced from assets/images/POWRP.png. That gap is what makes "the P
 * cracks open" literal: `split` pushes the two pieces apart along it.
 *
 * `fill` (0..1) floods both pieces with gold from the bottom up, measured over
 * the whole mark so the level reads as one line across the gap. It's a clip,
 * not an SVG mask: each piece's filled copy sits inside a bottom-anchored View
 * whose height animates — Reanimated drives that on the UI thread.
 */

const VB_W = 706;
const VB_H = 513;
export const DROP_MARK_ASPECT = VB_W / VB_H;

/** Horizontal shift per unit of height along the slant. */
const K = 0.39;

type Pt = [number, number];

/** Closed polygon with a quadratic-rounded corner of radius r[i] at each point. */
function roundedPath(pts: Pt[], r: number[]): string {
    const toward = (a: Pt, b: Pt, d: number): Pt => {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        return [a[0] + (dx / len) * d, a[1] + (dy / len) * d];
    };
    const f = (p: Pt) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    let d = '';
    pts.forEach((p, i) => {
        const prev = pts[(i - 1 + pts.length) % pts.length];
        const next = pts[(i + 1) % pts.length];
        const a = toward(p, prev, r[i]);
        const b = toward(p, next, r[i]);
        d += `${i === 0 ? 'M' : 'L'}${f(a)} Q${f(p)} ${f(b)} `;
    });
    return `${d}Z`;
}

const LEG_TOP = 15;
const LEG_BOTTOM = 497;
const LEG_RIGHT_TOP = 465;
const GAP = 24;
const BOWL_BOTTOM = 355;
const BOWL_RIGHT_TOP = 692;

const LEG = roundedPath(
    [
        [15 + K * (LEG_BOTTOM - LEG_TOP), LEG_TOP],
        [LEG_RIGHT_TOP, LEG_TOP],
        [LEG_RIGHT_TOP - K * (LEG_BOTTOM - LEG_TOP), LEG_BOTTOM],
        [15, LEG_BOTTOM],
    ],
    [40, 8, 40, 8],
);

const BOWL = roundedPath(
    [
        [LEG_RIGHT_TOP + GAP, LEG_TOP],
        [BOWL_RIGHT_TOP, LEG_TOP],
        [BOWL_RIGHT_TOP - K * (BOWL_BOTTOM - LEG_TOP), BOWL_BOTTOM],
        [LEG_RIGHT_TOP + GAP - K * (BOWL_BOTTOM - LEG_TOP), BOWL_BOTTOM],
    ],
    [34, 44, 48, 6],
);

/** Angle of the gap, for anything drawn along it (the reveal's light line). */
export const DROP_GAP_DEG = (Math.atan(K) * 180) / Math.PI;

export interface DropMarkProps {
    /** Height in dp; width follows the mark's aspect. */
    height: number;
    fill: SharedValue<number>;
    /** 0 = whole, 1 = cracked open. Omit for a mark that never splits. */
    split?: SharedValue<number>;
    /** Outline weight in dp. */
    stroke?: number;
    color?: string;
    /** Faint gold inside the outline, so an empty mark still reads as a vessel. */
    tint?: number;
}

export function DropMark({ height, fill, split, stroke = 1.5, color = colours.accent, tint = 0.07 }: DropMarkProps) {
    const width = height * DROP_MARK_ASPECT;
    // Stroke is in viewBox units — convert so the line is the same on any size.
    const sw = stroke * (VB_H / height);

    const fillStyle = useAnimatedStyle(() => ({
        height: Math.max(0, Math.min(1, fill.value)) * height,
    }));

    // The pieces part sideways out of the gap, the bowl out and up, the leg out
    // and down, each with a small turn so it reads as cracking, not sliding.
    // Wide enough at s=1 to clear a reward line set where the P stood.
    // Distances are in fractions of the mark's height.
    const bowlStyle = useAnimatedStyle(() => {
        const s = split?.value ?? 0;
        return {
            opacity: interpolate(s, [0, 0.5, 1], [1, 0.85, 0.14]),
            transform: [
                { translateX: s * height * 0.7 },
                { translateY: -s * height * 0.14 },
                { rotate: `${s * 8}deg` },
            ],
        };
    });
    const legStyle = useAnimatedStyle(() => {
        const s = split?.value ?? 0;
        return {
            opacity: interpolate(s, [0, 0.5, 1], [1, 0.85, 0.14]),
            transform: [
                { translateX: -s * height * 0.7 },
                { translateY: s * height * 0.12 },
                { rotate: `${-s * 8}deg` },
            ],
        };
    });

    const piece = (d: string, style: typeof bowlStyle, key: string) => (
        <Animated.View key={key} style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
            <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} style={StyleSheet.absoluteFill}>
                <Path d={d} fill={color} fillOpacity={tint} />
            </Svg>
            <Animated.View style={[styles.fillClip, { width }, fillStyle]}>
                <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} style={styles.fillArt}>
                    <Path d={d} fill={color} />
                </Svg>
            </Animated.View>
            <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} style={StyleSheet.absoluteFill}>
                <Path d={d} fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
            </Svg>
        </Animated.View>
    );

    return (
        <View style={{ width, height }} accessible={false}>
            {piece(LEG, legStyle, 'leg')}
            {piece(BOWL, bowlStyle, 'bowl')}
        </View>
    );
}

const styles = StyleSheet.create({
    fillClip: { position: 'absolute', left: 0, bottom: 0, overflow: 'hidden' },
    fillArt: { position: 'absolute', left: 0, bottom: 0 },
});

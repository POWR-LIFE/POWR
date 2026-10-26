import React, { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { ClipPath, Defs, G, Path } from 'react-native-svg';

import {
    POWR_MARK_BOWL,
    POWR_MARK_GAP_K,
    POWR_MARK_GAP_W,
    POWR_MARK_GAP_X,
    POWR_MARK_LEG,
    POWR_MARK_VB_H,
    POWR_MARK_VB_W,
} from '@/components/drop/powrMark';
import { colours } from '@/constants/tokens';

/**
 * The POWR P as a vessel — the Drop's one object, on the Home card and the
 * reveal alike.
 *
 * The shape is the logo's own (components/drop/powrMark, rebuilt from the
 * artwork): two pieces, the leg and the bowl, with a slanted channel between
 * them. That channel is what makes "the P cracks open" literal: `split` pushes
 * the two pieces apart along it.
 *
 * `fill` (0..1) floods both pieces with gold from the bottom up, measured over
 * the whole mark so the level reads as one line across the channel. It's a
 * clip, not an SVG mask: each piece's filled copy sits inside a bottom-anchored
 * View whose height animates — Reanimated drives that on the UI thread.
 *
 * Two things keep the pieces from reading as one blob:
 *  - the outline is drawn INSIDE each piece (a double-width stroke clipped to
 *    the piece), so it never eats into the channel;
 *  - below MIN_GAP_PX the pieces are nudged apart just enough to keep a
 *    visible channel — the usual small-size optical adjustment for a mark.
 */

const VB_W = POWR_MARK_VB_W;
const VB_H = POWR_MARK_VB_H;
export const DROP_MARK_ASPECT = VB_W / VB_H;

/** Angle of the channel, for anything drawn along it (the reveal's light line). */
export const DROP_GAP_DEG = (Math.atan(POWR_MARK_GAP_K) * 180) / Math.PI;
/** The channel's centre at mid-height, as a fraction of the mark's width. */
export const DROP_GAP_X = POWR_MARK_GAP_X;

/** The narrowest the channel may render, in dp, before the pieces are nudged apart. */
const MIN_GAP_PX = 1.6;

/** dp each piece moves sideways (away from the other) so the channel stays visible. */
function smallSizeNudge(height: number): number {
    const gapPx = POWR_MARK_GAP_W * (height / VB_H);
    return gapPx >= MIN_GAP_PX ? 0 : (MIN_GAP_PX - gapPx) / 2;
}

/** A clip id that's safe inside url(#…) — useId's colons aren't. */
function useClipIds(): { leg: string; bowl: string } {
    const base = useId().replace(/[^a-zA-Z0-9_-]/g, '');
    return { leg: `pm-leg-${base}`, bowl: `pm-bowl-${base}` };
}

/** One piece's outline, kept inside the piece so the channel stays clean. */
function InsideOutline({ d, id, color, width }: { d: string; id: string; color: string; width: number }) {
    return (
        <>
            <Defs>
                <ClipPath id={id}>
                    <Path d={d} />
                </ClipPath>
            </Defs>
            <Path d={d} fill="none" stroke={color} strokeWidth={width * 2} clipPath={`url(#${id})`} />
        </>
    );
}

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
    const nudge = smallSizeNudge(height);
    const ids = useClipIds();

    const fillStyle = useAnimatedStyle(() => ({
        height: Math.max(0, Math.min(1, fill.value)) * height,
    }));

    // The pieces part sideways out of the channel, the bowl out and up, the leg
    // out and down, each with a small turn so it reads as cracking, not
    // sliding. Wide enough at s=1 to clear a reward line set where the P stood.
    // Distances are in fractions of the mark's height.
    const bowlStyle = useAnimatedStyle(() => {
        const s = split?.value ?? 0;
        return {
            opacity: interpolate(s, [0, 0.5, 1], [1, 0.85, 0.14]),
            transform: [
                { translateX: nudge + s * height * 0.7 },
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
                { translateX: -nudge - s * height * 0.7 },
                { translateY: s * height * 0.12 },
                { rotate: `${-s * 8}deg` },
            ],
        };
    });

    const piece = (d: string, style: typeof bowlStyle, key: 'leg' | 'bowl') => (
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
                <InsideOutline d={d} id={ids[key]} color={color} width={sw} />
            </Svg>
        </Animated.View>
    );

    return (
        <View style={{ width, height }} accessible={false}>
            {piece(POWR_MARK_LEG, legStyle, 'leg')}
            {piece(POWR_MARK_BOWL, bowlStyle, 'bowl')}
        </View>
    );
}

const styles = StyleSheet.create({
    fillClip: { position: 'absolute', left: 0, bottom: 0, overflow: 'hidden' },
    fillArt: { position: 'absolute', left: 0, bottom: 0 },
});

/**
 * The same P as a static glyph, for small repeated marks (the week strip).
 * `solid` fills it; otherwise it's an inside outline with a faint tint.
 */
export function DropGlyph({ height, color, solid = false, stroke = 1.2 }: { height: number; color: string; solid?: boolean; stroke?: number }) {
    const width = height * DROP_MARK_ASPECT;
    const scale = height / VB_H;
    const sw = stroke / scale;
    const nudge = smallSizeNudge(height) / scale; // in viewBox units
    const ids = useClipIds();

    const pieces: { d: string; key: 'leg' | 'bowl'; dx: number }[] = [
        { d: POWR_MARK_LEG, key: 'leg', dx: -nudge },
        { d: POWR_MARK_BOWL, key: 'bowl', dx: nudge },
    ];

    return (
        <Svg
            width={width + 2 * nudge * scale}
            height={height}
            viewBox={`${-nudge} 0 ${VB_W + 2 * nudge} ${VB_H}`}
            accessible={false}
        >
            {pieces.map(p => (
                <G key={p.key} transform={`translate(${p.dx} 0)`}>
                    {solid ? (
                        <Path d={p.d} fill={color} />
                    ) : (
                        <>
                            <Path d={p.d} fill={color} fillOpacity={0.06} />
                            <InsideOutline d={p.d} id={ids[p.key]} color={color} width={sw} />
                        </>
                    )}
                </G>
            ))}
        </Svg>
    );
}

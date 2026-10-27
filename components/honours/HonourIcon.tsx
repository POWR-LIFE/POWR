import React, { useRef } from 'react';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

import type { HonourKind, HonourTier } from '@/constants/honours';

/**
 * The honour icons as drawn in #design (POWR · Trophies): 64-box line icons,
 * 2.6 strokes, each tier a metal gradient along the diagonal. Paths are the
 * supplied SVGs, unchanged.
 */
const PATHS: Record<HonourKind, string[]> = {
    king: ['M10 46 L6 20 L21 31 L32 14 L43 31 L58 20 L54 46 Z', 'M10 54 H54'],
    on_fire: ['M32 5 C37 17 49 25 49 39 C49 50 41 58 32 58 C23 58 15 50 15 39 C15 30 20 24 24 18 C26 25 28 29 31 31 C34 23 34 13 32 5 Z'],
    power: ['M37 4 L13 36 H30 L26 60 L51 26 H34 Z'],
    diamond: ['M18 10 H46 L58 25 L32 57 L6 25 Z', 'M6 25 H58 M24 10 L20 25 L32 57 L44 25 L40 10'],
    wings: [
        'M6 40 C10 22 32 10 60 6 C53 15 42 20 31 23 L55 21 C48 28 38 31 28 32 L49 34 C42 40 33 42 24 42 L41 46 C33 51 21 54 12 51 C7 49 5 45 6 40 Z',
        'M12 42 C16 32 24 26 31 23',
    ],
    hive: [
        'M46.20 23.80 L53.30 27.90 L53.30 36.10 L46.20 40.20 L39.10 36.10 L39.10 27.90 Z',
        'M39.10 36.10 L46.20 40.20 L46.20 48.40 L39.10 52.50 L32.00 48.40 L32.00 40.20 Z',
        'M24.90 36.10 L32.00 40.20 L32.00 48.40 L24.90 52.50 L17.80 48.40 L17.80 40.20 Z',
        'M17.80 23.80 L24.90 27.90 L24.90 36.10 L17.80 40.20 L10.70 36.10 L10.70 27.90 Z',
        'M24.90 11.50 L32.00 15.60 L32.00 23.80 L24.90 27.90 L17.80 23.80 L17.80 15.60 Z',
        'M39.10 11.50 L46.20 15.60 L46.20 23.80 L39.10 27.90 L32.00 23.80 L32.00 15.60 Z',
        'M32.00 23.80 L39.10 27.90 L39.10 36.10 L32.00 40.20 L24.90 36.10 L24.90 27.90 Z',
    ],
    strength: [
        'M8 54 C22 57 38 56 50 53 V19 C49 15 45 12.5 31 10 L27.5 17.5 L30.5 22.5',
        'M30.5 22.5 L37 19.5',
        'M30.5 22.5 C34.5 24 38.5 24.2 42.5 23.6',
        'M42.5 27 C42.3 33 39.5 38 35 42.5',
        'M6 41.5 C16 34 30 35.5 38.5 47.5',
        'M11.5 48 C16.5 49.5 21 49.6 25.5 49',
    ],
};
/** The crown's three jewels; the wings lean 8° as supplied. */
const KING_DOTS: [number, number][] = [[6, 16], [32, 9.5], [58, 16]];

/** Gold, silver, bronze as supplied; platinum is a cooler, brighter silver until the set's own arrives. */
export const TIER_STOPS: Record<HonourTier, [string, string, string, string]> = {
    platinum: ['#FFFFFF', '#E3ECF5', '#A6B6C7', '#F2F7FC'],
    gold: ['#FFF1C2', '#E9C46A', '#B8862B', '#F7DF9A'],
    silver: ['#FFFFFF', '#C7CDD4', '#7E8792', '#E6EAEE'],
    bronze: ['#F8C9A8', '#C9825A', '#8A4B2C', '#E9A985'],
};
/** One flat colour per tier, for text beside an icon. */
export const TIER_COLOUR: Record<HonourTier, string> = { platinum: '#E3ECF5', gold: '#E9C46A', silver: '#C7CDD4', bronze: '#C9825A' };

let seq = 0;

export function HonourIcon({ kind, tier, size = 14 }: { kind: HonourKind; tier: HonourTier; size?: number }) {
    // Gradient ids are global to the screen's SVG tree: one per instance.
    const id = useRef(`hn${++seq}`).current;
    const [a, b, c, d] = TIER_STOPS[tier];
    const paths = PATHS[kind];
    return (
        <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
            <Defs>
                <LinearGradient id={id} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                    <Stop offset="0" stopColor={a} />
                    <Stop offset="0.38" stopColor={b} />
                    <Stop offset="0.7" stopColor={c} />
                    <Stop offset="1" stopColor={d} />
                </LinearGradient>
            </Defs>
            <G
                stroke={`url(#${id})`}
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                rotation={kind === 'wings' ? -8 : 0}
                origin="32, 32"
            >
                {paths.map((p, i) => <Path key={i} d={p} />)}
                {kind === 'king' && KING_DOTS.map(([cx, cy]) => <Circle key={cx} cx={cx} cy={cy} r={2.6} />)}
            </G>
        </Svg>
    );
}

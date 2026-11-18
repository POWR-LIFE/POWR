import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, Path, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

import { HonourIcon, TIER_STOPS } from '@/components/honours/HonourIcon';
import type { HonourTier } from '@/constants/honours';
import { fontFamily } from '@/constants/tokens';
import type { NamedPrize } from '@/lib/api/series';
import { TEXT } from './SeriesLane';

/*
 * The marks the Series uses for its ways to win, shared by the How to win
 * sheet and the Ways to win carousel so both draw the same thing: 1, 2, 3 in
 * rings of their metal, then a glyph per title in the honour icons' hand.
 */

/** Gold, silver and bronze for 1st, 2nd and 3rd. */
export const PLACE_TIERS: HonourTier[] = ['gold', 'silver', 'bronze'];

export type TitleGlyphKind = 'on_fire' | 'wings' | 'star' | 'hive' | 'ticket';

/** The titles anyone can win, in the order they're numbered (04–07). */
export const TITLES: { key: NamedPrize; glyph: TitleGlyphKind }[] = [
    { key: 'hot_streak', glyph: 'on_fire' },
    { key: 'biggest_mover', glyph: 'wings' },
    { key: 'rookie', glyph: 'star' },
    { key: 'patient_zero', glyph: 'hive' },
];

/** A title's number, on from the top three: hot_streak → "04". */
export const titleNo = (k: NamedPrize) => String(TITLES.findIndex((x) => x.key === k) + 4).padStart(2, '0');

/** A star in the honour icons' hand: 64 box, 2.6 stroke. */
const STAR = 'M32 7 L39.05 23.29 L56.73 24.97 L43.41 36.71 L47.28 54.03 L32 45 L16.72 54.03 L20.59 36.71 L7.27 24.97 L24.95 23.29 Z';
/** A ticket (Every Move Counts, the draw), same hand: notched sides, a torn line. */
const TICKET = 'M12 17 H52 A4 4 0 0 1 56 21 V26.5 A5.5 5.5 0 0 0 56 37.5 V43 A4 4 0 0 1 52 47 H12 A4 4 0 0 1 8 43 V37.5 A5.5 5.5 0 0 0 8 26.5 V21 A4 4 0 0 1 12 17 Z';

export function TitleGlyph({ kind, size = 30, color = TEXT }: { kind: TitleGlyphKind; size?: number; color?: string }) {
    if (kind === 'star' || kind === 'ticket') {
        return (
            <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
                <Path d={kind === 'star' ? STAR : TICKET} stroke={color} strokeWidth={2.6} strokeLinejoin="round" />
                {kind === 'ticket' && <Line x1={41} y1={22} x2={41} y2={42} stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeDasharray="1 5.5" />}
            </Svg>
        );
    }
    return <HonourIcon kind={kind} tier="silver" size={size} color={color} />;
}

let seq = 0;

/** 1, 2, 3 in a ring of their metal. */
export function PlaceRing({ n, tier, size = 40 }: { n: number; tier: HonourTier; size?: number }) {
    const id = useRef(`ring${++seq}`).current;
    const [a, b, c, d] = TIER_STOPS[tier];
    const r = size / 2 - 1.5;
    return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
                <Defs>
                    <SvgGradient id={id} x1="0" y1="0" x2={String(size)} y2={String(size)} gradientUnits="userSpaceOnUse">
                        <Stop offset="0" stopColor={a} />
                        <Stop offset="0.38" stopColor={b} />
                        <Stop offset="0.7" stopColor={c} />
                        <Stop offset="1" stopColor={d} />
                    </SvgGradient>
                </Defs>
                <Circle cx={size / 2} cy={size / 2} r={r} stroke={`url(#${id})`} strokeWidth={size >= 36 ? 2 : 1.6} fill="none" />
            </Svg>
            <Text style={[s.ringNo, { fontSize: Math.round(size * 0.45) }]} allowFontScaling={false}>{n}</Text>
        </View>
    );
}

const s = StyleSheet.create({
    ringNo: { fontFamily: fontFamily.light, color: TEXT },
});

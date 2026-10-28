import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useSyncExternalStore } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useSeriesEnabled, useSeriesSeason } from '@/lib/api/series';
import { SERIES_PROTOTYPE } from '@/lib/dev/seriesPrototype';
import { P_BOWL, P_LEG } from './pCrowd';

/*
 * The Series runs in seasons, set in /admin/series, and the app wears the season it's in:
 * every screen's background, the tab bar and the cards. Each season is one ground colour and a name; its card, border, line,
 * sheet and background tints are mixed from that ground into POWR's near-black
 * (seasonTint), so a new season needs one colour. The mark is always butter,
 * and POWR gold still means something to read or act on. Autumn and Winter
 * come from Sorine's identity lookbook; Spring and Summer are proposals, and
 * every name, number and date after Autumn is a placeholder.
 */

export type SeasonKey = 'autumn' | 'winter' | 'spring' | 'summer';
export type SeasonDef = {
    key: SeasonKey;
    ground: string;
    groundName: string;
    fromLookbook: boolean;
    name: string;
    words: string;
    no: string;
    dates: string;
    span: string;
};

export const SEASONS: Record<SeasonKey, SeasonDef> = {
    autumn: {
        key: 'autumn', ground: '#013E37', groundName: 'Dark green', fromLookbook: true, name: 'Autumn Series', words: 'AUTUMN SERIES',
        no: 'Nº 01 — AW26', dates: '1–15 NOV', span: 'ROUND 01 · 1–15 NOV',
    },
    winter: {
        key: 'winter', ground: '#13294B', groundName: 'Navy', fromLookbook: true, name: 'Winter Series', words: 'WINTER SERIES',
        no: 'Nº 02 — AW26', dates: 'JAN 2027', span: 'ROUND 01 · JAN 2027',
    },
    spring: {
        key: 'spring', ground: '#4A1E43', groundName: 'Plum', fromLookbook: false, name: 'Spring Series', words: 'SPRING SERIES',
        no: 'Nº 03 — SS27', dates: 'APR 2027', span: 'ROUND 01 · APR 2027',
    },
    summer: {
        key: 'summer', ground: '#5A2A14', groundName: 'Rust', fromLookbook: false, name: 'Summer Series', words: 'SUMMER SERIES',
        no: 'Nº 04 — SS27', dates: 'JUL 2027', span: 'ROUND 01 · JUL 2027',
    },
};
export const SEASON_ORDER: SeasonKey[] = ['autumn', 'winter', 'spring', 'summer'];

export const BUTTER = '#FFEFB3';
const CARD_PLAIN = '#111111';

// The POWR P, as supplied (traced from the logo artwork): P_LEG / P_BOWL live in pCrowd.
const P_ASPECT = 760.59 / 531.05;

const rgbOf = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const mixHex = (a: string, b: string, t: number) => {
    const A = rgbOf(a);
    const B = rgbOf(b);
    return `#${A.map((x, i) => Math.round(x * t + B[i] * (1 - t)).toString(16).padStart(2, '0')).join('')}`;
};
export const hexA = (h: string, a: number) => `rgba(${rgbOf(h).join(',')},${a})`;

export type SeasonTint = { ground: string; deep: string; card: string; border: string; hair: string; sheet: string; avatar: string };
/** Everything a season needs, from its one ground colour. */
export function seasonTint(g: string): SeasonTint {
    return {
        ground: g,
        deep: mixHex(g, '#030303', 0.24),
        card: mixHex(g, '#0B0B0B', 0.16),
        border: mixHex(g, '#1A1A1A', 0.3),
        hair: hexA(mixHex(g, '#FFFFFF', 0.25), 0.09),
        sheet: mixHex(g, '#121212', 0.18),
        avatar: mixHex(g, '#141414', 0.2),
    };
}
const TINTS = Object.fromEntries(SEASON_ORDER.map((k) => [k, seasonTint(SEASONS[k].ground)])) as Record<SeasonKey, SeasonTint>;

// Which season to wear: 'follow' = the one set in /admin/series; the dev panel
// can force one ('none' = plain POWR, for comparison).
let current: SeasonKey | 'none' | 'follow' = 'follow';
/*
 * The lockup's second line. The Series is global, so it's no longer a city:
 * by default it's the round you're in. The dev panel can try the others.
 */
export type LockupLine = 'round' | 'world' | 'open';
export const LOCKUP_LINES: Record<LockupLine, string> = { round: 'ROUND 01', world: 'WORLDWIDE', open: 'OPEN TO ALL' };
let line: LockupLine = 'round';
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
    subs.add(f);
    return () => { subs.delete(f); };
};
export const seasonDev = {
    set(k: SeasonKey | 'none' | 'follow') { current = k; subs.forEach((f) => f()); },
    setLine(l: LockupLine) { line = l; subs.forEach((f) => f()); },
};

/**
 * The active Series season: its definition, and its tint (null = no season
 * look). The whole app wears the tint (shared background, tab bar, cards), so
 * it's on only while the Series is on for this member (series_live in
 * /admin/series), or in the dev prototype.
 */
export function useSeason() {
    const forced = useSyncExternalStore(subscribe, () => current);
    const lineKey = useSyncExternalStore(subscribe, () => line);
    const seriesOn = useSeriesEnabled();
    const server = useSeriesSeason();
    const key: SeasonKey | 'none' = forced === 'follow' ? server?.look ?? 'autumn' : forced;
    // The look comes from SEASONS; the name, Nº and code from the season set in admin.
    const def = useMemo<SeasonDef>(() => {
        const base = SEASONS[key === 'none' ? 'autumn' : key];
        if (!server || server.look !== base.key) return base;
        const no = `Nº ${String(server.number).padStart(2, '0')}${server.code ? ` — ${server.code}` : ''}`;
        return { ...base, name: server.name, words: server.name.toUpperCase(), no, span: `${(server.round ?? 'Round 01').toUpperCase()} · ${no}` };
    }, [key, server]);
    const roundLine = lineKey === 'round' && server?.round && server.look === def.key ? server.round.toUpperCase() : LOCKUP_LINES[lineKey];
    return {
        key, def, forced, tint: key === 'none' || !(SERIES_PROTOTYPE || seriesOn) ? null : TINTS[key], lineKey, line: roundLine,
    };
}

/** A card's fill and border in the season (spread into a style array). */
export function useSeasonCard(keepBorder = false) {
    const { tint } = useSeason();
    if (!tint) return null;
    return keepBorder ? { backgroundColor: tint.card } : { backgroundColor: tint.card, borderColor: tint.border };
}

/** The card colour behind the Series card's fade, season or not. */
export const plainCard = CARD_PLAIN;

/**
 * Sorine's simplified lockup: the P as supplied, a hairline, then the season
 * and the round (the slot her lookbook gave a city; the Series is global).
 * Without words it's the P alone.
 */
export function SeriesLockup({ height: h, def, words = true, color = BUTTER }: { height: number; def: SeasonDef; words?: boolean; color?: string }) {
    const { line } = useSeason();
    const word = { fontSize: h * 0.24, lineHeight: h * 0.3, fontWeight: '500' as const, letterSpacing: h * 0.24 * 0.32, color };
    return (
        <View style={{ flexDirection: 'row', height: h, gap: h * 0.16 }} accessible accessibilityLabel={`${def.name}, ${line.toLowerCase()}`}>
            <Svg width={h * P_ASPECT} height={h} viewBox="0 0 760.59 531.05">
                <Path d={P_LEG} fill={color} />
                <Path d={P_BOWL} fill={color} />
            </Svg>
            {words && (
                <>
                    <View style={{ width: 1, backgroundColor: hexA(BUTTER, 0.5) }} />
                    <View style={{ height: h, justifyContent: 'space-between', marginLeft: h * 0.22 }}>
                        <Text allowFontScaling={false} style={word}>{def.words}</Text>
                        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: hexA(BUTTER, 0.3) }} />
                        <Text allowFontScaling={false} style={word}>{line}</Text>
                    </View>
                </>
            )}
        </View>
    );
}

/** The League tab's background in the season: a deep tint and the season's light at the top. */
export function SeasonBackdrop() {
    const { tint } = useSeason();
    const { width: W, height: H } = useWindowDimensions();
    if (!tint) return null;
    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <LinearGradient
                colors={[hexA(tint.deep, 0.94), hexA(tint.deep, 0.6), 'rgba(0,0,0,0)']}
                locations={[0, 0.45, 1]}
                style={StyleSheet.absoluteFill}
            />
            <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
                <Defs>
                    <RadialGradient id="seasonGlow" cx="20%" cy="0%" r="85%">
                        <Stop offset="0%" stopColor={tint.ground} stopOpacity={0.85} />
                        <Stop offset="70%" stopColor={tint.ground} stopOpacity={0} />
                    </RadialGradient>
                </Defs>
                <Rect x={0} y={0} width={W} height={H * 0.6} fill="url(#seasonGlow)" />
            </Svg>
        </View>
    );
}

/** The page's sign-off: the season's stamp, in its full colours. */
export function SeasonStamp() {
    const { def, tint } = useSeason();
    if (!tint) return null;
    return (
        <View style={[st.stamp, { backgroundColor: def.ground }]}>
            <View style={st.row}><Text style={st.txt}>POWR ATHLETIC CLUB</Text><Text style={st.txt}>{def.no}</Text></View>
            <SeriesLockup height={34} def={def} />
            <View style={st.row}><Text style={st.txt}>{def.span}</Text><Text style={st.txt}>EVERY MOVE COUNTS.</Text></View>
        </View>
    );
}

const st = StyleSheet.create({
    stamp: { marginHorizontal: 16, marginTop: 14, padding: 18, paddingTop: 16, borderRadius: 18, gap: 16, alignItems: 'flex-start' },
    row: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    txt: { fontSize: 7, fontWeight: '600', letterSpacing: 1.6, color: hexA(BUTTER, 0.65) },
});

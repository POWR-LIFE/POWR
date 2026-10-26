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
 *
 * Each season has its own mark beside the P in the lockup: a leaf, a
 * snowflake, a blossom, a sun. They're drawn the way the P is, solid shapes set
 * apart by a gap (the leaf's vein, the snowflake's and blossom's centres, the
 * sun's rays), so they sit with it as one family.
 */

export type SeasonKey = 'autumn' | 'winter' | 'spring' | 'summer';
export type SeasonDef = {
    key: SeasonKey;
    ground: string;
    groundName: string;
    fromLookbook: boolean;
    name: string;
    words: string;
    /** The season's mark, a path in a 100 × 100 box. */
    icon: string;
    no: string;
    dates: string;
    span: string;
};

const SEASON_ICONS = {
    'autumn': 'M36.94 79.41C69.44 84.32 91.18 50.68 73 10.16C28.82 14.68 10.56 50.32 31.06 76.01L63 27.48ZM30.12 78.94L24.12 89.33A2.75 2.75 0 0 0 28.88 92.08L34.88 81.69A2.75 2.75 0 0 0 30.12 78.94Z',
    'winter': 'M53.75 39L53.75 4A3.75 3.75 0 0 0 46.25 4L46.25 39A3.75 3.75 0 0 0 53.75 39ZM51.86 18.34L41.22 10.88A3.25 3.25 0 0 0 37.49 16.21L48.14 23.66A3.25 3.25 0 0 0 51.86 18.34ZM51.86 23.66L62.51 16.21A3.25 3.25 0 0 0 58.78 10.88L48.14 18.34A3.25 3.25 0 0 0 51.86 23.66ZM61.4 47.75L91.71 30.25A3.75 3.75 0 0 0 87.96 23.75L57.65 41.25A3.75 3.75 0 0 0 61.4 47.75ZM78.35 35.78L79.49 22.83A3.25 3.25 0 0 0 73.01 22.27L71.88 35.22A3.25 3.25 0 0 0 78.35 35.78ZM73.74 38.45L85.52 43.94A3.25 3.25 0 0 0 88.27 38.05L76.49 32.55A3.25 3.25 0 0 0 73.74 38.45ZM57.65 58.75L87.96 76.25A3.75 3.75 0 0 0 91.71 69.75L61.4 52.25A3.75 3.75 0 0 0 57.65 58.75ZM76.49 67.45L88.27 61.95A3.25 3.25 0 0 0 85.52 56.06L73.74 61.55A3.25 3.25 0 0 0 76.49 67.45ZM71.88 64.78L73.01 77.73A3.25 3.25 0 0 0 79.49 77.17L78.35 64.22A3.25 3.25 0 0 0 71.88 64.78ZM46.25 61L46.25 96A3.75 3.75 0 0 0 53.75 96L53.75 61A3.75 3.75 0 0 0 46.25 61ZM48.14 81.66L58.78 89.12A3.25 3.25 0 0 0 62.51 83.79L51.86 76.34A3.25 3.25 0 0 0 48.14 81.66ZM48.14 76.34L37.49 83.79A3.25 3.25 0 0 0 41.22 89.12L51.86 81.66A3.25 3.25 0 0 0 48.14 76.34ZM38.6 52.25L8.29 69.75A3.75 3.75 0 0 0 12.04 76.25L42.35 58.75A3.75 3.75 0 0 0 38.6 52.25ZM21.65 64.22L20.51 77.17A3.25 3.25 0 0 0 26.99 77.73L28.12 64.78A3.25 3.25 0 0 0 21.65 64.22ZM26.26 61.55L14.48 56.06A3.25 3.25 0 0 0 11.73 61.95L23.51 67.45A3.25 3.25 0 0 0 26.26 61.55ZM42.35 41.25L12.04 23.75A3.75 3.75 0 0 0 8.29 30.25L38.6 47.75A3.75 3.75 0 0 0 42.35 41.25ZM23.51 32.55L11.73 38.05A3.25 3.25 0 0 0 14.48 43.94L26.26 38.45A3.25 3.25 0 0 0 23.51 32.55ZM28.12 35.22L26.99 22.27A3.25 3.25 0 0 0 20.51 22.83L21.65 35.78A3.25 3.25 0 0 0 28.12 35.22Z',
    'spring': 'M43 50A7 7 0 1 0 57 50A7 7 0 1 0 43 50ZM50 38C58.25 34 66 20 60.5 10C55.25 3 44.75 3 39.5 10C34 20 41.75 34 50 38ZM61.41 46.29C67.77 52.9 83.48 55.95 91.29 47.63C96.32 40.47 93.08 30.48 84.8 27.65C73.59 25.51 62.67 37.21 61.41 46.29ZM57.05 59.71C52.73 67.79 54.69 83.68 65.02 88.53C73.38 91.11 81.87 84.94 82.01 76.19C80.58 64.87 66.08 58.1 57.05 59.71ZM42.95 59.71C33.92 58.1 19.42 64.87 17.99 76.19C18.13 84.94 26.62 91.11 34.98 88.53C45.31 83.68 47.27 67.79 42.95 59.71ZM38.59 46.29C37.33 37.21 26.41 25.51 15.2 27.65C6.92 30.48 3.68 40.47 8.71 47.63C16.52 55.95 32.23 52.9 38.59 46.29Z',
    'summer': 'M29 50A21 21 0 1 0 71 50A21 21 0 1 0 29 50ZM54.25 19L54.25 5A4.25 4.25 0 0 0 45.75 5L45.75 19A4.25 4.25 0 0 0 54.25 19ZM74.93 31.08L84.83 21.19A4.25 4.25 0 0 0 78.81 15.17L68.92 25.07A4.25 4.25 0 0 0 74.93 31.08ZM81 54.25L95 54.25A4.25 4.25 0 0 0 95 45.75L81 45.75A4.25 4.25 0 0 0 81 54.25ZM68.92 74.93L78.81 84.83A4.25 4.25 0 0 0 84.83 78.81L74.93 68.92A4.25 4.25 0 0 0 68.92 74.93ZM45.75 81L45.75 95A4.25 4.25 0 0 0 54.25 95L54.25 81A4.25 4.25 0 0 0 45.75 81ZM25.07 68.92L15.17 78.81A4.25 4.25 0 0 0 21.19 84.83L31.08 74.93A4.25 4.25 0 0 0 25.07 68.92ZM19 45.75L5 45.75A4.25 4.25 0 0 0 5 54.25L19 54.25A4.25 4.25 0 0 0 19 45.75ZM31.08 25.07L21.19 15.17A4.25 4.25 0 0 0 15.17 21.19L25.07 31.08A4.25 4.25 0 0 0 31.08 25.07Z'
};

export const SEASONS: Record<SeasonKey, SeasonDef> = {
    autumn: {
        key: 'autumn', ground: '#013E37', groundName: 'Dark green', fromLookbook: true, name: 'Autumn Series', words: 'AUTUMN SERIES',
        icon: SEASON_ICONS.autumn, no: 'Nº 01 — AW26', dates: '1–15 NOV', span: 'ROUND 01 · 1–15 NOV',
    },
    winter: {
        key: 'winter', ground: '#13294B', groundName: 'Navy', fromLookbook: true, name: 'Winter Series', words: 'WINTER SERIES',
        icon: SEASON_ICONS.winter, no: 'Nº 02 — AW26', dates: 'JAN 2027', span: 'ROUND 01 · JAN 2027',
    },
    spring: {
        key: 'spring', ground: '#4A1E43', groundName: 'Plum', fromLookbook: false, name: 'Spring Series', words: 'SPRING SERIES',
        icon: SEASON_ICONS.spring, no: 'Nº 03 — SS27', dates: 'APR 2027', span: 'ROUND 01 · APR 2027',
    },
    summer: {
        key: 'summer', ground: '#5A2A14', groundName: 'Rust', fromLookbook: false, name: 'Summer Series', words: 'SUMMER SERIES',
        icon: SEASON_ICONS.summer, no: 'Nº 04 — SS27', dates: 'JUL 2027', span: 'ROUND 01 · JUL 2027',
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
 * Sorine's simplified lockup: the P as supplied, a hairline, the season's
 * mark, then the season and the round (the slot her lookbook gave a city; the
 * Series is global).
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
            <View style={{ width: 1, backgroundColor: hexA(BUTTER, 0.5) }} />
            <View style={{ height: h, justifyContent: 'center' }}>
                <Svg width={h * 0.7} height={h * 0.7} viewBox="0 0 100 100">
                    <Path d={def.icon} fill={color} />
                </Svg>
            </View>
            {words && (
                <View style={{ height: h, justifyContent: 'space-between', marginLeft: h * 0.22 }}>
                    <Text allowFontScaling={false} style={word}>{def.words}</Text>
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: hexA(BUTTER, 0.3) }} />
                    <Text allowFontScaling={false} style={word}>{line}</Text>
                </View>
            )}
        </View>
    );
}

/** The season's mark alone (no P: Home keeps the P to the level badge). */
export function SeasonMark({ size, def, color = BUTTER }: { size: number; def: SeasonDef; color?: string }) {
    return (
        <Svg width={size} height={size} viewBox="0 0 100 100">
            <Path d={def.icon} fill={color} />
        </Svg>
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

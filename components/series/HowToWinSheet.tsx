import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Path, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

import { HonourIcon, TIER_STOPS } from '@/components/honours/HonourIcon';
import type { HonourTier } from '@/constants/honours';
import { fontFamily } from '@/constants/tokens';
import type { NamedPrize } from '@/lib/api/series';
import { GOLD, TEXT } from './SeriesLane';
import { NAMED, PLACE_NAMES, type PrizeKey } from './SeriesPrizes';
import { Sheet, type SheetLook } from './SeriesSheets';
import { placeOrdinal } from './seriesView';
import { mixHex, useSeason } from './season';

const LINE = 'rgba(255,255,255,0.09)';
const SOFT = 'rgba(255,255,255,0.62)';
const FAINT = 'rgba(255,255,255,0.42)';
/** The button's gold, lit from the top. */
const CTA = ['#E2CE47', '#A39539'] as const;
const ON_CTA = '#11150d';

const TIERS: HonourTier[] = ['gold', 'silver', 'bronze'];

/** The titles anyone can win, numbered on from the top three (04–07). */
const TITLES: { key: NamedPrize; glyph: 'on_fire' | 'wings' | 'star' | 'hive' }[] = [
    { key: 'hot_streak', glyph: 'on_fire' },
    { key: 'biggest_mover', glyph: 'wings' },
    { key: 'rookie', glyph: 'star' },
    { key: 'patient_zero', glyph: 'hive' },
];

/** A star in the honour icons' hand: 64 box, 2.6 stroke. */
const STAR = 'M32 7 L39.05 23.29 L56.73 24.97 L43.41 36.71 L47.28 54.03 L32 45 L16.72 54.03 L20.59 36.71 L7.27 24.97 L24.95 23.29 Z';

function Glyph({ kind, size = 30 }: { kind: (typeof TITLES)[number]['glyph']; size?: number }) {
    if (kind !== 'star') return <HonourIcon kind={kind} tier="silver" size={size} color={TEXT} />;
    return (
        <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
            <Path d={STAR} stroke={TEXT} strokeWidth={2.6} strokeLinejoin="round" />
        </Svg>
    );
}

let seq = 0;

/** 1, 2, 3 in a ring of their metal. */
function PlaceRing({ n, tier, size = 40 }: { n: number; tier: HonourTier; size?: number }) {
    const id = useRef(`htw${++seq}`).current;
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
                <Circle cx={size / 2} cy={size / 2} r={r} stroke={`url(#${id})`} strokeWidth={2} fill="none" />
            </Svg>
            <Text style={s.ringNo} allowFontScaling={false}>{n}</Text>
        </View>
    );
}

/**
 * How to win a round, on one sheet: the round's dates, three steps, the top
 * three places and the four titles anyone can win. A place or a title opens its
 * own drawer (prize, how it's decided, who's on course) while a round is on.
 */
export function HowToWinSheet({
    visible, onClose, span, days, winners, lastDay, onBoard, onPrize,
}: {
    visible: boolean;
    onClose: () => void;
    /** The round's first to last day: "15–30 Nov". */
    span: string;
    days: number;
    /** The day the winners land: "Tue 1 Dec". */
    winners: string;
    /** The last day, without its weekday: "30 Nov". */
    lastDay: string;
    /** Close and show the board. Only while a round is on. */
    onBoard?: () => void;
    /** Close and open one prize's drawer. Only while a round is on. */
    onPrize?: (k: PrizeKey) => void;
}) {
    const { t } = useTranslation();
    const { def, tint } = useSeason();
    // The season's ground, deeper than the other sheets, lit from the top right.
    const look: SheetLook | undefined = tint
        ? { bg: mixHex(tint.ground, '#121212', 0.36), glow: mixHex(tint.ground, '#FFFFFF', 0.3), glowOpacity: 0.34, radius: 28, tall: true }
        : undefined;

    const steps = [
        { no: '01', title: t('series:sheets.win.move'), line: t('series:sheets.win.moveLine') },
        { no: '02', title: t('series:sheets.win.climb'), line: t('series:sheets.win.climbLine') },
        // "30 nov." never splits across two lines.
        { no: '03', title: t('series:sheets.win.win'), line: t('series:sheets.win.winLine', { date: lastDay.replace(/ /g, ' ') }) },
    ];
    const lines: Record<NamedPrize, string> = {
        hot_streak: t('series:sheets.win.lines.unbreakable'),
        biggest_mover: t('series:sheets.win.lines.levelUp'),
        rookie: t('series:sheets.win.lines.rookie'),
        patient_zero: t('series:sheets.win.lines.squadBuilder'),
    };
    const rows = [TITLES.slice(0, 2), TITLES.slice(2, 4)];

    const cta = onBoard ? (
        <Pressable
            onPress={onBoard}
            style={({ pressed }) => [s.cta, pressed && { opacity: 0.88 }]}
            accessibilityRole="button"
            accessibilityLabel={t('series:sheets.win.boardA11y')}
        >
            <LinearGradient colors={CTA} style={StyleSheet.absoluteFill} />
            <Text style={s.ctaText}>{t('series:sheets.win.board')}</Text>
            <Ionicons name="arrow-forward" size={16} color={ON_CTA} />
        </Pressable>
    ) : undefined;

    return (
        <Sheet visible={visible} onClose={onClose} look={look} footer={cta}>
            <View style={s.head}>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.eyebrow} numberOfLines={1}>{def.words}</Text>
                    <Text style={s.title} accessibilityRole="header">{t('series:sheets.win.title')}</Text>
                </View>
                <Pressable
                    onPress={onClose}
                    hitSlop={8}
                    style={({ pressed }) => [s.close, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('series:sheets.close')}
                >
                    <Ionicons name="close" size={20} color={TEXT} />
                </Pressable>
            </View>

            <View style={s.when}>
                <Text style={s.whenText}>
                    <Text style={s.strong}>{span}</Text>{' · '}{t('series:sheets.win.days', { count: days })}
                </Text>
                <Text style={s.whenText}>
                    <Trans i18nKey="series:sheets.win.winners" values={{ date: winners }} components={{ b: <Text style={s.strong} /> }} />
                </Text>
            </View>

            <Text style={s.label}>{t('series:sheets.win.how')}</Text>
            <View style={[s.card, s.steps]}>
                {steps.map((x, i) => (
                    <View key={x.no} style={[s.step, i > 0 && s.stepRule]}>
                        <Text style={s.stepNo}>{x.no}</Text>
                        <Text style={s.stepTitle} numberOfLines={1} adjustsFontSizeToFit>{x.title}</Text>
                        <Text style={s.stepLine}>{x.line}</Text>
                    </View>
                ))}
            </View>

            <Text style={s.label}>{t('series:sheets.win.top')}</Text>
            <View style={s.places}>
                {PLACE_NAMES.map((name, i) => {
                    const line = t('series:sheets.win.onPoints', { ord: placeOrdinal(i + 1) });
                    return (
                        <Pressable
                            key={name}
                            disabled={!onPrize}
                            onPress={() => onPrize?.('top3')}
                            style={({ pressed }) => [s.card, s.place, pressed && s.pressed]}
                            accessibilityRole={onPrize ? 'button' : undefined}
                            accessibilityLabel={onPrize ? t('series:sheets.win.prizeA11y', { title: name, line }) : `${name}, ${line}`}
                        >
                            <PlaceRing n={i + 1} tier={TIERS[i]} />
                            <Text style={s.placeName} numberOfLines={1} adjustsFontSizeToFit>{name}</Text>
                            <Text style={s.placeLine} numberOfLines={1} adjustsFontSizeToFit>{line}</Text>
                        </Pressable>
                    );
                })}
            </View>

            <Text style={s.label}>{t('series:sheets.win.titles')}</Text>
            <View style={{ gap: 9 }}>
                {rows.map((row) => (
                    <View key={row[0].key} style={s.tileRow}>
                        {row.map((x) => {
                            const no = String(TITLES.indexOf(x) + 4).padStart(2, '0');
                            const name = NAMED[x.key].title;
                            return (
                                <Pressable
                                    key={x.key}
                                    disabled={!onPrize}
                                    onPress={() => onPrize?.(x.key)}
                                    style={({ pressed }) => [s.card, s.tile, pressed && s.pressed]}
                                    accessibilityRole={onPrize ? 'button' : undefined}
                                    accessibilityLabel={onPrize ? t('series:sheets.win.prizeA11y', { title: name, line: lines[x.key] }) : `${name}, ${lines[x.key]}`}
                                >
                                    <View style={s.tileIcon}>
                                        <Glyph kind={x.glyph} />
                                        <Text style={s.tileNo}>{no}</Text>
                                    </View>
                                    <View style={{ flex: 1, minWidth: 0 }}>
                                        <Text style={s.tileName} numberOfLines={2}>{name}</Text>
                                        <Text style={s.tileLine} numberOfLines={2}>{lines[x.key]}</Text>
                                    </View>
                                </Pressable>
                            );
                        })}
                    </View>
                ))}
            </View>

            <Text style={s.foot}>
                <Trans i18nKey="series:sheets.win.oneEach" components={{ b: <Text style={s.strong} /> }} />
            </Text>

        </Sheet>
    );
}

const card = { borderWidth: 1, borderColor: LINE, borderRadius: 16 } as const;

const s = StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    eyebrow: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: 3.6, color: GOLD, marginTop: 2 },
    title: { fontFamily: fontFamily.light, fontSize: 36, lineHeight: 42, letterSpacing: -0.8, color: TEXT, marginTop: 10 },
    close: {
        width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.09)', marginTop: 0,
    },
    when: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 2, marginTop: 10 },
    whenText: { fontFamily: fontFamily.light, fontSize: 15, color: SOFT },
    strong: { fontFamily: fontFamily.medium, color: TEXT },

    label: { fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: 3.6, color: FAINT, marginTop: 22, marginBottom: 12 },
    card,
    pressed: { backgroundColor: 'rgba(255,255,255,0.04)' },

    steps: { flexDirection: 'row' },
    step: { flex: 1, paddingHorizontal: 11, paddingTop: 15, paddingBottom: 16 },
    stepRule: { borderLeftWidth: 1, borderLeftColor: LINE },
    stepNo: { fontFamily: fontFamily.medium, fontSize: 13, letterSpacing: 1.5, color: GOLD },
    stepTitle: { fontFamily: fontFamily.regular, fontSize: 19, color: TEXT, marginTop: 8 },
    stepLine: { fontFamily: fontFamily.light, fontSize: 12.5, lineHeight: 17, color: SOFT, marginTop: 6 },

    places: { flexDirection: 'row', gap: 8 },
    place: { flex: 1, alignItems: 'center', paddingTop: 15, paddingBottom: 15, paddingHorizontal: 6 },
    ringNo: { fontFamily: fontFamily.light, fontSize: 18, color: TEXT },
    placeName: { fontFamily: fontFamily.regular, fontSize: 16, color: TEXT, marginTop: 10 },
    placeLine: { fontFamily: fontFamily.light, fontSize: 13, color: SOFT, marginTop: 3 },

    tileRow: { flexDirection: 'row', gap: 9 },
    tile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingLeft: 12, paddingRight: 8, minHeight: 76 },
    tileIcon: { width: 32, alignItems: 'center', gap: 6 },
    tileNo: { fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: 2, color: FAINT },
    tileName: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 20, color: TEXT },
    tileLine: { fontFamily: fontFamily.light, fontSize: 13, lineHeight: 17, color: SOFT, marginTop: 2 },

    foot: { fontFamily: fontFamily.light, fontSize: 13.5, lineHeight: 19, color: SOFT, textAlign: 'center', marginTop: 16, marginBottom: 4 },
    cta: {
        height: 52, borderRadius: 26, overflow: 'hidden', marginTop: 14,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    },
    ctaText: { fontFamily: fontFamily.semiBold, fontSize: 13.5, letterSpacing: 3.6, color: ON_CTA },
});

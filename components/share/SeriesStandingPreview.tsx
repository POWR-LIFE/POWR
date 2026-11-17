import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useEffect } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { HonourIcon } from '@/components/honours/HonourIcon';
import { mixHex, type SeasonDef, SeriesLockup } from '@/components/series/season';
import { type Honour, sortHonours } from '@/constants/honours';
import { fontFamily } from '@/constants/tokens';
import { seriesNum } from '@/lib/api/series';
import { flagEmoji } from '@/lib/dev/seriesPrototype';
import type { CardClimb } from '@/lib/seriesShareCard';

/** The link preview's size: 1200×630, the landscape shape chat apps show large. */
export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 630;

const TEXT = '#F2F2F2';
const DIM = 'rgba(242,242,242,0.55)';
const LABEL = 'rgba(242,242,242,0.62)';
const GOLD = '#E8D200';

interface SeriesStandingPreviewProps extends ViewProps {
    def: SeasonDef;
    roundName: string;
    /** Day of the round (1-based) while it runs; null once it's over. */
    day: number | null;
    days: number;
    name: string;
    country: string | null;
    city: string | null;
    rank: number;
    climb: CardClimb;
    honours: Honour[];
    /** Width in dp it lays out at; captured at PREVIEW_WIDTH × PREVIEW_HEIGHT. */
    width: number;
    onReady?: () => void;
}

/**
 * The standing card as a link preview: what WhatsApp, iMessage and the rest
 * draw above the link when a member taps Share. A tall image gets the small
 * thumbnail beside the text; a landscape one gets the big picture across the
 * bubble, so this is the card's headline (who, where you stand, today's climb,
 * your best trophies) laid out wide. share-card-og hands it to the crawler
 * (share_cards.preview_path); the 4:5 card stays the one you post or save.
 * Sized for a phone's chat bubble (~1/4 scale): nothing smaller than 24.
 */
export const SeriesStandingPreview = forwardRef<View, SeriesStandingPreviewProps>(
    ({ def, roundName, day, days, name, country, city, rank, climb, honours, width, onReady, style, ...rest }, ref) => {
        const { t } = useTranslation();
        const height = (width * PREVIEW_HEIGHT) / PREVIEW_WIDTH;
        const s = width / PREVIEW_WIDTH;
        // Vector only (P, icons): ready as soon as it's mounted.
        useEffect(() => { onReady?.(); }, [onReady]);

        const top3 = sortHonours(honours).slice(0, 3);
        const roundLine = day != null
            ? t('series:shareCard.dayOf', { round: roundName, day: seriesNum(day), days: seriesNum(days) })
            : t('series:shareCard.final', { round: roundName });
        const rankText = seriesNum(rank);
        const rankSize = (rankText.length >= 5 ? 196 : 240) * s;
        const label = { fontSize: 25 * s, lineHeight: 30 * s, letterSpacing: 7 * s };

        return (
            <View ref={ref} collapsable={false} style={[styles.root, { width, height, backgroundColor: def.ground }, style]} {...rest}>
                <LinearGradient
                    colors={[mixHex(def.ground, '#1B2B28', 0.45), mixHex(def.ground, '#000000', 0.55), mixHex(def.ground, '#000000', 0.74)]}
                    locations={[0, 0.5, 1]}
                    start={{ x: 0.2, y: 0 }}
                    end={{ x: 0.8, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                />
                <Svg width={width} height={height} style={StyleSheet.absoluteFillObject}>
                    <Defs>
                        <RadialGradient id="previewGlow" cx="70%" cy="0%" rx="60%" ry="80%" fx="70%" fy="0%">
                            <Stop offset="0" stopColor="#7FB8A8" stopOpacity="0.18" />
                            <Stop offset="1" stopColor="#7FB8A8" stopOpacity="0" />
                        </RadialGradient>
                    </Defs>
                    <Rect x="0" y="0" width={width} height={height} fill="url(#previewGlow)" />
                </Svg>

                <View style={{ flex: 1, paddingHorizontal: 72 * s, paddingTop: 60 * s, paddingBottom: 56 * s }}>
                    {/* ── The P, the season and the day ───────────────────── */}
                    <View style={styles.between}>
                        <SeriesLockup height={60 * s} def={def} words={false} color={TEXT} />
                        <View style={{ alignItems: 'flex-end' }}>
                            <Text allowFontScaling={false} style={[styles.season, { fontSize: 30 * s, lineHeight: 36 * s, letterSpacing: 10 * s }]}>
                                {def.name.toUpperCase()}
                            </Text>
                            <Text allowFontScaling={false} style={[styles.roundLine, { fontSize: 24 * s, lineHeight: 30 * s, letterSpacing: 7 * s, marginTop: 10 * s }]}>
                                {roundLine.toUpperCase()}
                            </Text>
                        </View>
                    </View>

                    {/* ── You, where you stand, today's climb ─────────────── */}
                    <View style={[styles.between, { flex: 1, alignItems: 'flex-end' }]}>
                        <View style={{ flex: 1, marginRight: 40 * s }}>
                            <View style={styles.row}>
                                <Text allowFontScaling={false} numberOfLines={1} style={[styles.name, { fontSize: 52 * s, lineHeight: 62 * s, letterSpacing: -0.5 * s }]}>
                                    {name}
                                </Text>
                                {country && /^[A-Z]{2}$/i.test(country) && (
                                    <Text allowFontScaling={false} style={{ fontSize: 34 * s, lineHeight: 44 * s, marginLeft: 18 * s }}>{flagEmoji(country)}</Text>
                                )}
                            </View>
                            <View style={[styles.row, { alignItems: 'flex-start', height: 228 * s, marginTop: 4 * s }]}>
                                <Text allowFontScaling={false} style={[styles.hash, { fontSize: 80 * s, lineHeight: 80 * s, marginTop: 44 * s, marginRight: 8 * s }]}>#</Text>
                                <Text allowFontScaling={false} style={[styles.rank, { fontSize: rankSize, lineHeight: 228 * s, letterSpacing: -6 * s }]}>{rankText}</Text>
                            </View>
                            <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, label, { marginTop: 6 * s }]}>
                                {(city ? t('series:shareCard.cityRank', { city }) : t('series:shareCard.seriesRank')).toUpperCase()}
                            </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                            {top3.length > 0 && (
                                <View style={[styles.row, { gap: 26 * s, marginBottom: 44 * s }]}>
                                    {top3.map((h) => <HonourIcon key={h.kind} kind={h.kind} tier={h.tier} size={54 * s} />)}
                                </View>
                            )}
                            <View style={styles.row}>
                                {climb.key === 'climb' && (
                                    <Text allowFontScaling={false} style={[styles.gold, { fontSize: 44 * s, lineHeight: 104 * s, marginRight: 16 * s }]}>▲</Text>
                                )}
                                <Text allowFontScaling={false} style={[styles.climb, { fontSize: 96 * s, lineHeight: 104 * s, letterSpacing: -1 * s }]}>{seriesNum(climb.value)}</Text>
                            </View>
                            <Text allowFontScaling={false} style={[styles.label, label, { marginTop: 6 * s }]}>
                                {t(climb.key === 'climb' ? 'series:shareCard.climb' : 'series:shareCard.racingLabel').toUpperCase()}
                            </Text>
                        </View>
                    </View>
                </View>
            </View>
        );
    },
);
SeriesStandingPreview.displayName = 'SeriesStandingPreview';

const styles = StyleSheet.create({
    root: { overflow: 'hidden', position: 'relative' },
    row: { flexDirection: 'row', alignItems: 'center' },
    between: { flexDirection: 'row', justifyContent: 'space-between' },
    season: { fontFamily: fontFamily.medium, color: TEXT },
    roundLine: { fontFamily: fontFamily.regular, color: DIM },
    name: { fontFamily: fontFamily.light, color: TEXT, flexShrink: 1 },
    hash: { fontFamily: fontFamily.light, color: GOLD },
    rank: { fontFamily: fontFamily.extraLight, color: TEXT, includeFontPadding: false },
    gold: { color: GOLD },
    climb: { fontFamily: fontFamily.medium, color: GOLD },
    label: { fontFamily: fontFamily.regular, color: LABEL },
});

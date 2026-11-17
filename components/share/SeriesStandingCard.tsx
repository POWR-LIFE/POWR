import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useEffect } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { HonourIcon, TIER_COLOUR } from '@/components/honours/HonourIcon';
import { BUTTER, mixHex, type SeasonDef, SeriesLockup } from '@/components/series/season';
import { type Honour, honourLine, honourName, sortHonours, tierName } from '@/constants/honours';
import { fontFamily } from '@/constants/tokens';
import { seriesNum } from '@/lib/api/series';
import { flagEmoji } from '@/lib/dev/seriesPrototype';
import { getFormatLocale } from '@/lib/i18n';
import { seriesInviteLink } from '@/lib/seriesInvite';
import { type CardClimb, type CardStat, cabinet, nextHonour } from '@/lib/seriesShareCard';
import { formatMemberId } from '@/shared/memberId';

/** Height ÷ width: the card is 4:5, 1080×1350 when posted or saved. */
export const STANDING_CARD_RATIO = 5 / 4;

const TEXT = '#F2F2F2';
const DIM = 'rgba(242,242,242,0.55)';
const LABEL = 'rgba(242,242,242,0.62)';
const GHOST = 'rgba(255,255,255,0.2)';
const GHOST_TEXT = 'rgba(255,255,255,0.28)';
const RULE = 'rgba(255,255,255,0.14)';
const GOLD = '#E8D200';

interface SeriesStandingCardProps extends ViewProps {
    def: SeasonDef;
    roundName: string;
    /** Day of the round (1-based) while it runs; null once it's over. */
    day: number | null;
    days: number;
    name: string;
    /** ISO country code for the flag; null hides it. */
    country: string | null;
    /** Your city (gym or picked); null = no city, so the rank is the whole board's. */
    city: string | null;
    rank: number;
    climb: CardClimb;
    stats: CardStat[];
    honours: Honour[];
    /** The sharer's code: the QR opens add-friend with it. Null = the app link alone. */
    referralCode: string | null;
    /** Width in dp the card renders at. Height is derived 4:5. */
    width: number;
    onReady?: () => void;
}

/**
 * The Series share card once you're racing: who you are, where you stand
 * (your place in your city, the places you've climbed today), three numbers
 * from the round, your trophy cabinet and the one to chase next, and a QR
 * that brings a friend into your squad. Drawn on a 1080-wide grid and scaled,
 * captured with react-native-view-shot like every other card. Every number
 * is the server's (lib/seriesShareCard.ts picks which ones, never a 0).
 */
export const SeriesStandingCard = forwardRef<View, SeriesStandingCardProps>(
    ({ def, roundName, day, days, name, country, city, rank, climb, stats, honours, referralCode, width, onReady, style, ...rest }, ref) => {
        const { t } = useTranslation();
        const height = width * STANDING_CARD_RATIO;
        const s = width / 1080;
        // Vector only (P, icons, QR are SVG): ready as soon as it's mounted.
        useEffect(() => { onReady?.(); }, [onReady]);

        const box = cabinet(honours);
        const next = nextHonour(honours);
        const top3 = sortHonours(honours).slice(0, 3);
        const roundLine = day != null
            ? t('series:shareCard.dayOf', { round: roundName, day: seriesNum(day), days: seriesNum(days) })
            : t('series:shareCard.final', { round: roundName });
        const rankText = seriesNum(rank);
        // Five or more characters ("1,234") would crowd the climb beside it.
        const rankSize = (rankText.length >= 5 ? 140 : 172) * s;
        const label = { fontSize: 17 * s, lineHeight: 22 * s, letterSpacing: 6 * s };
        // The short Series link (powr.life/series/<code>, which sends a person on
        // to add-friend with the code): fewer characters, bigger dots, so it
        // still scans off a 480-wide copy. The in-app scanner reads it too.
        const qr = referralCode ? seriesInviteLink(referralCode) : 'https://powr.life/app';

        return (
            <View ref={ref} collapsable={false} style={[styles.root, { width, height, backgroundColor: def.ground }, style]} {...rest}>
                <LinearGradient
                    colors={[mixHex(def.ground, '#1B2B28', 0.45), mixHex(def.ground, '#000000', 0.55), mixHex(def.ground, '#000000', 0.74)]}
                    locations={[0, 0.55, 1]}
                    style={StyleSheet.absoluteFillObject}
                />
                {/* A soft light from the top, as on the design. */}
                <Svg width={width} height={height} style={StyleSheet.absoluteFillObject}>
                    <Defs>
                        <RadialGradient id="standingGlow" cx="62%" cy="6%" rx="70%" ry="46%" fx="62%" fy="6%">
                            <Stop offset="0" stopColor="#7FB8A8" stopOpacity="0.16" />
                            <Stop offset="1" stopColor="#7FB8A8" stopOpacity="0" />
                        </RadialGradient>
                    </Defs>
                    <Rect x="0" y="0" width={width} height={height} fill="url(#standingGlow)" />
                </Svg>

                <View style={{ flex: 1, paddingHorizontal: 88 * s, paddingTop: 69 * s, paddingBottom: 59 * s }}>
                    {/* ── The P, the season and the day ───────────────────── */}
                    <View style={styles.between}>
                        <SeriesLockup height={67 * s} def={def} words={false} color={TEXT} />
                        <View style={{ alignItems: 'flex-end' }}>
                            <Text allowFontScaling={false} style={[styles.season, { fontSize: 25 * s, lineHeight: 30 * s, letterSpacing: 9 * s }]}>
                                {def.name.toUpperCase()}
                            </Text>
                            <Text allowFontScaling={false} style={[styles.roundLine, { fontSize: 19 * s, lineHeight: 24 * s, letterSpacing: 6.5 * s, marginTop: 15 * s }]}>
                                {roundLine.toUpperCase()}
                            </Text>
                        </View>
                    </View>

                    {/* ── You ─────────────────────────────────────────────── */}
                    <View style={[styles.between, { alignItems: 'flex-end', marginTop: 35 * s }]}>
                        <View style={{ flex: 1, marginRight: 24 * s }}>
                            <View style={styles.row}>
                                <Text allowFontScaling={false} numberOfLines={1} style={[styles.name, { fontSize: 56 * s, lineHeight: 66 * s, letterSpacing: -0.5 * s }]}>
                                    {name}
                                </Text>
                                {country && /^[A-Z]{2}$/i.test(country) && (
                                    <Text allowFontScaling={false} style={{ fontSize: 34 * s, lineHeight: 44 * s, marginLeft: 20 * s }}>{flagEmoji(country)}</Text>
                                )}
                            </View>
                            <Text allowFontScaling={false} numberOfLines={1} style={[styles.city, { fontSize: 22 * s, lineHeight: 28 * s, height: 28 * s, marginTop: 12 * s }]}>
                                {city ?? ''}
                            </Text>
                        </View>
                        {top3.length > 0 && (
                            <View style={[styles.row, { gap: 18 * s, marginBottom: 5 * s }]}>
                                {top3.map((h) => <HonourIcon key={h.kind} kind={h.kind} tier={h.tier} size={34 * s} />)}
                            </View>
                        )}
                    </View>

                    {/* ── Where you stand ─────────────────────────────────── */}
                    <View style={[styles.between, { marginTop: 18 * s, alignItems: 'flex-start' }]}>
                        <View style={[styles.row, { alignItems: 'flex-start', height: 172 * s }]}>
                            <Text allowFontScaling={false} style={[styles.hash, { fontSize: 64 * s, lineHeight: 64 * s, marginTop: 30 * s, marginRight: 6 * s }]}>#</Text>
                            <Text allowFontScaling={false} style={[styles.rank, { fontSize: rankSize, lineHeight: 172 * s, letterSpacing: -4 * s }]}>{rankText}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', marginTop: 49 * s }}>
                            <View style={[styles.row, { alignItems: 'center' }]}>
                                {climb.key === 'climb' && (
                                    <Text allowFontScaling={false} style={[styles.gold, { fontSize: 30 * s, lineHeight: 66 * s, marginRight: 14 * s }]}>▲</Text>
                                )}
                                <Text allowFontScaling={false} style={[styles.climb, { fontSize: 60 * s, lineHeight: 66 * s }]}>{seriesNum(climb.value)}</Text>
                            </View>
                            <Text allowFontScaling={false} style={[styles.label, label, { marginTop: 8 * s }]}>
                                {t(climb.key === 'climb' ? 'series:shareCard.climb' : 'series:shareCard.racingLabel').toUpperCase()}
                            </Text>
                        </View>
                    </View>
                    <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, label, { marginTop: 8 * s }]}>
                        {(city ? t('series:shareCard.cityRank', { city }) : t('series:shareCard.seriesRank')).toUpperCase()}
                    </Text>

                    <View style={[styles.rule, { marginTop: 27 * s }]} />

                    {/* ── The round in three numbers ──────────────────────── */}
                    <View style={[styles.row, { marginTop: 25 * s, alignItems: 'stretch' }]}>
                        {stats.map((st, i) => (
                            <View
                                key={st.key}
                                style={{
                                    flex: 1,
                                    paddingLeft: i > 0 ? 40 * s : 0,
                                    borderLeftWidth: i > 0 ? Math.max(1, 1.5 * s) : 0,
                                    borderLeftColor: RULE,
                                }}
                            >
                                {/* The unit is a sibling, not nested: a nested smaller
                                    font changes the line box and drops the label. */}
                                <View style={[styles.row, { alignItems: 'baseline', height: 60 * s }]}>
                                    <Text allowFontScaling={false} numberOfLines={1} style={[styles.stat, { fontSize: 54 * s, lineHeight: 60 * s, letterSpacing: -0.5 * s }]}>
                                        {statValue(st)}
                                    </Text>
                                    {(st.key === 'run' || st.key === 'ride') && (
                                        <Text allowFontScaling={false} style={[styles.unit, { fontSize: 26 * s, lineHeight: 60 * s, marginLeft: 8 * s }]}>km</Text>
                                    )}
                                </View>
                                <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, label, { marginTop: 5 * s }]}>
                                    {t(`series:shareCard.stat.${st.key}`).toUpperCase()}
                                </Text>
                            </View>
                        ))}
                    </View>

                    <View style={[styles.rule, { marginTop: 27 * s }]} />

                    {/* ── The trophy cabinet ──────────────────────────────── */}
                    <View style={[styles.between, { marginTop: 29 * s, alignItems: 'center' }]}>
                        <Text allowFontScaling={false} style={[styles.label, label]}>{t('series:shareCard.cabinet').toUpperCase()}</Text>
                        {box.earned > 0 ? (
                            <Text allowFontScaling={false} style={[styles.dim, { fontSize: 21 * s, lineHeight: 22 * s }]}>
                                <Text style={styles.goldStrong}>{seriesNum(box.earned)}</Text>
                                {` ${t('series:shareCard.ofTotal', { total: seriesNum(box.total) })}`}
                            </Text>
                        ) : (
                            <Text allowFontScaling={false} style={[styles.dim, { fontSize: 21 * s, lineHeight: 22 * s }]}>
                                {t('series:shareCard.toWin', { total: seriesNum(box.total) })}
                            </Text>
                        )}
                    </View>
                    <View style={[styles.row, { marginTop: 26 * s, alignItems: 'flex-start' }]}>
                        {box.columns.map((col) => (
                            <View key={col.kind} style={{ flex: 1, alignItems: 'center' }}>
                                {col.slots.map((slot, i) => (
                                    <View key={i} style={{ height: 56 * s, alignItems: 'center', justifyContent: 'center' }}>
                                        {slot && (
                                            <HonourIcon kind={col.kind} tier={slot.tier} size={38 * s} color={slot.earned ? undefined : GHOST} />
                                        )}
                                    </View>
                                ))}
                                <Text
                                    allowFontScaling={false}
                                    numberOfLines={1}
                                    style={[styles.kind, { fontSize: 16 * s, lineHeight: 20 * s, marginTop: 14 * s, color: col.any ? TEXT : GHOST_TEXT }]}
                                >
                                    {honourName(col.kind)}
                                </Text>
                            </View>
                        ))}
                    </View>

                    {/* ── The one to chase ────────────────────────────────── */}
                    {next && (
                        <View style={{ marginTop: 25 * s }}>
                            <View style={[styles.between, { alignItems: 'center' }]}>
                                <View style={[styles.row, { flexShrink: 1 }]}>
                                    <Text allowFontScaling={false} style={[styles.label, label]}>{t('series:shareCard.next').toUpperCase()}</Text>
                                    <Text allowFontScaling={false} numberOfLines={1} style={[styles.nextName, { fontSize: 24 * s, lineHeight: 30 * s, marginLeft: 28 * s }]}>
                                        {honourName(next.kind)}
                                        <Text style={{ color: TIER_COLOUR[next.tier], fontFamily: fontFamily.regular }}>{` ${tierName(next.tier)}`}</Text>
                                    </Text>
                                </View>
                                <Text allowFontScaling={false} numberOfLines={1} style={[styles.dim, { fontSize: 18.5 * s, lineHeight: 24 * s, marginLeft: 20 * s, flexShrink: 1 }]}>
                                    {nextText(next, t)}
                                </Text>
                            </View>
                            {next.have != null && next.have > 0 && (
                                <View style={[styles.track, { height: 4 * s, borderRadius: 2 * s, marginTop: 13 * s }]}>
                                    <View style={{ width: `${Math.min(100, (next.have / next.need) * 100)}%`, height: '100%', borderRadius: 2 * s, backgroundColor: GOLD }} />
                                </View>
                            )}
                        </View>
                    )}

                    <View style={{ flex: 1 }} />

                    {/* ── The ask ─────────────────────────────────────────── */}
                    <View style={[styles.between, { alignItems: 'flex-end' }]}>
                        <View style={{ marginBottom: -4 * s }}>
                            <Text allowFontScaling={false} style={[styles.motto, { fontSize: 25 * s, lineHeight: 32 * s }]}>{t('series:shareCard.everyMove')}</Text>
                            <Text allowFontScaling={false} style={[styles.label, label, { marginTop: 19 * s }]}>POWR.LIFE</Text>
                        </View>
                        <View style={[styles.row, { alignItems: 'center' }]}>
                            <View style={{ alignItems: 'flex-end', marginRight: 28 * s }}>
                                <Text allowFontScaling={false} style={[styles.squad, { fontSize: 26 * s, lineHeight: 32 * s }]}>{t('series:shareCard.squad')}</Text>
                                <Text allowFontScaling={false} style={[styles.dim, { fontSize: 17 * s, lineHeight: 25 * s, marginTop: 10 * s, textAlign: 'right', maxWidth: 205 * s }]}>
                                    {t(referralCode ? 'series:shareCard.scanOrCode' : 'series:shareCard.scan')}
                                </Text>
                                {/* Seen on the phone that would have to scan it (Stories,
                                    chats), the QR can't be scanned: the code can be typed. */}
                                {referralCode && (
                                    <Text allowFontScaling={false} style={[styles.code, { fontSize: 23 * s, lineHeight: 30 * s, letterSpacing: 3 * s, marginTop: 6 * s }]}>
                                        {formatMemberId(referralCode)}
                                    </Text>
                                )}
                            </View>
                            {/* The season's ground on butter: on brand, and still dark on light for every scanner. */}
                            <View style={{ padding: 13 * s, borderRadius: 16 * s, backgroundColor: BUTTER }}>
                                <QRCode value={qr} size={121 * s} color={def.ground} backgroundColor={BUTTER} ecl="M" />
                            </View>
                        </View>
                    </View>
                </View>
            </View>
        );
    },
);
SeriesStandingCard.displayName = 'SeriesStandingCard';

function statValue(st: CardStat): string {
    if (st.key === 'run' || st.key === 'ride') {
        return st.value.toLocaleString(getFormatLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    }
    return seriesNum(st.value);
}

/** "34 of 40 weeks"; the rule instead when there's no count yet (never "0 of …"). */
function nextText(next: NonNullable<ReturnType<typeof nextHonour>>, t: (k: string, o?: Record<string, unknown>) => string): string {
    if (next.unit === 'top') return t('series:shareCard.progress.top');
    if (next.have == null || next.have <= 0 || !next.unit) return honourLine(next.kind);
    return t(`series:shareCard.progress.${next.unit}`, { have: seriesNum(next.have), need: seriesNum(next.need) });
}

const styles = StyleSheet.create({
    root: { overflow: 'hidden', position: 'relative' },
    row: { flexDirection: 'row', alignItems: 'center' },
    between: { flexDirection: 'row', justifyContent: 'space-between' },
    season: { fontFamily: fontFamily.medium, color: TEXT },
    roundLine: { fontFamily: fontFamily.regular, color: DIM },
    name: { fontFamily: fontFamily.light, color: TEXT, flexShrink: 1 },
    city: { fontFamily: fontFamily.light, color: DIM },
    hash: { fontFamily: fontFamily.light, color: GOLD },
    rank: { fontFamily: fontFamily.extraLight, color: TEXT, includeFontPadding: false },
    gold: { color: GOLD },
    goldStrong: { color: GOLD, fontFamily: fontFamily.medium },
    climb: { fontFamily: fontFamily.medium, color: GOLD },
    label: { fontFamily: fontFamily.regular, color: LABEL },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: RULE },
    stat: { fontFamily: fontFamily.regular, color: TEXT },
    unit: { fontFamily: fontFamily.light, color: DIM },
    dim: { fontFamily: fontFamily.light, color: DIM },
    kind: { fontFamily: fontFamily.regular },
    nextName: { fontFamily: fontFamily.light, color: TEXT },
    track: { backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
    motto: { fontFamily: fontFamily.light, color: TEXT },
    squad: { fontFamily: fontFamily.regular, color: TEXT },
    code: { fontFamily: fontFamily.medium, color: GOLD },
});

import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useEffect } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BUTTER, hexA, mixHex, type SeasonDef, SeriesLockup } from '@/components/series/season';
import { fontFamily } from '@/constants/tokens';
import { seriesDate, seriesNum } from '@/lib/api/series';

/**
 * Chat clients centre-crop a 9:16 image to roughly 3:4 in the bubble, taking
 * ~12.5% off the top and bottom. Everything that has to survive the crop —
 * the club line at the top, the code and the URL at the bottom — sits inside
 * this band. Same constant as EventShareCard, for the same reason.
 */
const CROP_SAFE_Y = 250;

const TEXT = '#F2F2F2';

interface SeriesShareCardProps extends ViewProps {
    def: SeasonDef;
    roundName: string;
    /** When the round starts (ms); on or after it the card says the round is on. */
    startsAt: number;
    days: number;
    /** The sharer's code, spelled out on the card — the only part of an invite
     *  that survives Instagram/TikTok stripping the caption. Null hides the row. */
    referralCode: string | null;
    /** Width in dp the card renders at. Height is derived 9:16. */
    width: number;
    /** Fires once the card can be captured (nothing remote on it: at once). */
    onReady?: () => void;
    now?: number;
}

/**
 * The Series as a social card — what a member sends when they want a friend
 * in the Series, not just a link to it. Sorine's editorial card (the season's
 * ground, POWR ATHLETIC CLUB, the lockup, EVERY MOVE COUNTS.) stretched to
 * 9:16, with the three facts a friend needs — when the round starts, how
 * long it runs, that it's free — and the invite at the bottom: the code in
 * butter and POWR.LIFE, because Stories strip the caption and the image has
 * to carry the whole ask on its own. Rendered at 720×1280 / 1080×1920 and
 * captured with react-native-view-shot, exactly like EventShareCard.
 */
export const SeriesShareCard = forwardRef<View, SeriesShareCardProps>(
    ({ def, roundName, startsAt, days, referralCode, width, onReady, now = Date.now(), style, ...rest }, ref) => {
        const { t } = useTranslation();
        const height = (width * 16) / 9;
        // Scale tokens proportionally to width — base sizes designed for 1080dp.
        const s = width / 1080;
        // Vector only (the P is an SVG path): ready as soon as it's mounted.
        useEffect(() => { onReady?.(); }, [onReady]);

        const running = now >= startsAt;
        const day = running ? Math.min(days, Math.floor((now - startsAt) / 86_400_000) + 1) : 0;

        return (
            <View ref={ref} collapsable={false} style={[styles.root, { width, height, backgroundColor: def.ground }, style]} {...rest}>
                <LinearGradient
                    colors={[def.ground, mixHex(def.ground, '#000000', 0.35), mixHex(def.ground, '#000000', 0.6)]}
                    locations={[0, 0.6, 1]}
                    style={StyleSheet.absoluteFillObject}
                />
                <View style={[styles.column, { paddingHorizontal: 80 * s, paddingTop: CROP_SAFE_Y * s, paddingBottom: CROP_SAFE_Y * s }]}>
                    {/* ── Top: the club line, as on Sorine's card ─────────── */}
                    <View>
                        <View style={styles.row}>
                            <Text style={[styles.tiny, { fontSize: 24 * s, letterSpacing: 6 * s }]}>POWR ATHLETIC CLUB</Text>
                            <Text style={[styles.tiny, { fontSize: 24 * s, letterSpacing: 6 * s }]}>{def.no}</Text>
                        </View>
                        <View style={[styles.rule, { marginTop: 28 * s }]} />
                    </View>

                    {/* ── Middle: the lockup, the words, the facts ────────── */}
                    <View style={styles.middle}>
                        <SeriesLockup height={150 * s} def={def} />
                        <Text style={[styles.words, { fontSize: 84 * s, lineHeight: 92 * s, letterSpacing: -2 * s, marginTop: 72 * s }]} numberOfLines={2}>
                            {def.name}
                        </Text>
                        <Text style={[styles.headline, { fontSize: 36 * s, lineHeight: 46 * s, marginTop: 18 * s }]} numberOfLines={2}>
                            {t('series:shareCard.headline')}
                        </Text>

                        <View style={{ marginTop: 72 * s, gap: 26 * s }}>
                            {running ? (
                                <Fact s={s} label={t('series:shareCard.onNow')} value={t('series:shareCard.dayOf', { round: roundName, day: seriesNum(day), days: seriesNum(days) })} />
                            ) : (
                                <Fact s={s} label={t('series:shareCard.starts')} value={`${roundName} · ${seriesDate(new Date(startsAt).toISOString())}`} />
                            )}
                            <Fact s={s} label={t('series:shareCard.days')} value={seriesNum(days)} />
                            <Fact s={s} label={t('series:shareCard.entry')} value={t('series:shareCard.free')} />
                        </View>
                    </View>

                    {/* ── Bottom: the invite ──────────────────────────────── */}
                    <View>
                        <View style={[styles.rule, { marginBottom: 40 * s }]} />
                        {referralCode ? (
                            <View style={styles.codeRow}>
                                <Text style={[styles.codeLabel, { fontSize: 22 * s, letterSpacing: 4 * s }]}>
                                    {t('events:shareCard.joinWithCode')}
                                </Text>
                                <Text style={[styles.code, { fontSize: 44 * s, letterSpacing: 6 * s, marginLeft: 28 * s }]}>
                                    {referralCode}
                                </Text>
                            </View>
                        ) : (
                            <Text style={[styles.codeLabel, { fontSize: 22 * s, letterSpacing: 4 * s }]}>
                                {t('events:shareCard.joinOnPowr')}
                            </Text>
                        )}
                        {/* Instagram/TikTok strip share-sheet text, so the image
                            itself must carry where to find us. */}
                        <View style={[styles.row, { marginTop: 44 * s }]}>
                            <Text style={[styles.tiny, { fontSize: 24 * s, letterSpacing: 6 * s }]}>EVERY MOVE COUNTS.</Text>
                            <Text style={[styles.tiny, { fontSize: 24 * s, letterSpacing: 6 * s }]}>POWR.LIFE</Text>
                        </View>
                    </View>
                </View>
            </View>
        );
    },
);
SeriesShareCard.displayName = 'SeriesShareCard';

/** One labelled fact — label in the gutter, value beside it. */
function Fact({ s, label, value }: { s: number; label: string; value: string }) {
    return (
        <View style={styles.factRow}>
            <Text style={[styles.factLabel, { fontSize: 20 * s, letterSpacing: 4 * s, width: 210 * s, marginTop: 8 * s }]}>
                {label}
            </Text>
            <Text style={[styles.factValue, { fontSize: 36 * s, lineHeight: 44 * s }]} numberOfLines={2}>
                {value}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { overflow: 'hidden', position: 'relative' },
    column: { flex: 1, justifyContent: 'space-between' },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    tiny: { fontFamily: fontFamily.medium, color: hexA(BUTTER, 0.6) },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: hexA(BUTTER, 0.35) },
    middle: { flex: 1, justifyContent: 'center' },
    words: { fontFamily: fontFamily.extraLight, color: TEXT },
    headline: { fontFamily: fontFamily.light, color: hexA(BUTTER, 0.8) },
    factRow: { flexDirection: 'row', alignItems: 'flex-start' },
    factLabel: { fontFamily: fontFamily.medium, color: hexA(BUTTER, 0.5) },
    factValue: { flex: 1, fontFamily: fontFamily.light, color: TEXT },
    codeRow: { flexDirection: 'row', alignItems: 'baseline' },
    codeLabel: { fontFamily: fontFamily.medium, color: hexA(BUTTER, 0.6) },
    code: { fontFamily: fontFamily.medium, color: BUTTER },
});

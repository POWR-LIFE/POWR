import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { HomeCard, type HomeStat, HomeNote, HomeStats } from '@/components/home/HomeCard';
import { fontFamily } from '@/constants/tokens';
import { trackTap } from '@/lib/analytics';
import { seriesNum } from '@/lib/api/series';
import { type SeriesToday, seriesDrawChip, seriesNextMove, useDropMove } from './SeriesToday';
import { BUTTER, hexA, mixHex, plainCard, useSeason } from './season';

/**
 * The Series on Home while a round runs, as one card in Home's one layout
 * (components/home/HomeCard): the Series as its title, then three numbers:
 * your place (and today's move), the gap to your rival, your Draw days. Then
 * the one move that matters. Everything else (moments, prizes, the board)
 * is on the League tab the card opens.
 *
 * Replaces the rival card, "Since yesterday" and the prize row: what changed
 * since you looked is the ▲/▼ on your place, and who you're racing is the
 * middle number.
 *
 * It wears the season like League's Series card, kept simple: a band of the
 * season's ground fading into the card behind the title, and the season's
 * mark and name in butter (no P: Home keeps the P to the level badge).
 */
export function SeriesRoundCard({ today: t }: { today: SeriesToday }) {
    // `t` is the round here, so the translator goes by another name.
    const { t: tr } = useTranslation();
    // The Drop's quicker route, but only when it also passes your rival: else it's the Drop card's business.
    const drop = useDropMove(t);
    const move = seriesNextMove(t, drop?.passes ? drop : null);

    const { place, gap, draw } = roundCardStats(t, tr);

    const dress = useSeriesDress(t.season, tr('series:roundCard.dayOf', { name: t.roundName, day: t.day, days: t.days }));

    return (
        <HomeCard
            title={tr('series:roundCard.dayOf', { name: t.season, day: t.day, days: t.days })}
            {...dress}
            onPress={() => {
                trackTap('series_home_open', { from: 'card' });
                router.push({ pathname: '/(tabs)/league', params: { focus: 'rival', at: String(Date.now()) } });
            }}
            label={tr('series:roundCard.a11y', {
                season: t.season,
                place: `${place.value} ${place.label}`,
                gap: `${gap.value} ${gap.label}`,
                draw: `${draw.value} ${draw.label}`,
                move,
            })}
        >
            <HomeStats items={[place, gap, draw]} />
            <HomeNote icon="flash-outline" lead={tr('series:roundCard.next')} text={move} />
        </HomeCard>
    );
}

/**
 * The card's three numbers: your place, the gap to your rival, your Draw days.
 * Never a 0 or a dash (Jamie): until you have points, how many are racing;
 * with no gap to show, the days left; with nothing logged, the days the Draw takes.
 */
export function roundCardStats(t: SeriesToday, tr: (k: string, o?: Record<string, unknown>) => string): { place: HomeStat; gap: HomeStat; draw: HomeStat } {
    const r = t.rival;
    const first = r ? r.p.name.split(' ')[0] : '';
    const unranked = t.points === 0 && !t.blind;
    // Days still to race, today included: the number to show until there's a rank or a gap.
    const daysLeft: HomeStat = { value: `${Math.max(1, t.days - t.day + 1)}`, label: tr('series:roundCard.daysLeft', { count: Math.max(1, t.days - t.day + 1) }) };
    // Never a 0 or a dash (Jamie): on 0 points, how many are racing, not a rank among everyone tied on zero.
    const place: HomeStat = t.blind
        ? { value: '?', label: tr('series:roundCard.rankHidden') }
        : unranked
            ? { value: seriesNum(t.total), label: tr('series:roundCard.racing') }
            : { value: `#${seriesNum(t.rank)}`, label: tr('series:roundCard.of', { n: seriesNum(t.total) }), tone: 'gold', move: t.move };
    const gap: HomeStat = !r || (r.gap === 0 && !(t.blind || r.sealed))
        ? daysLeft
        : t.blind || r.sealed
            ? { value: '?', label: tr('series:roundCard.ptsTo', { name: first }) }
            : r.ahead
                ? { value: seriesNum(r.gap), label: tr('series:roundCard.ptsClear', { name: first }), tone: 'green' }
                : { value: seriesNum(r.gap), label: tr('series:roundCard.ptsTo', { name: first }) };
    const chip = seriesDrawChip(t);
    const { logged, need } = t.draw;
    const draw: HomeStat = logged >= need
        ? { value: `${need}/${need}`, label: tr('series:roundCard.inDraw'), tone: 'green' }
        : chip?.tone === 'out'
            ? { value: tr('series:homeCards.out'), label: tr('series:roundCard.drawOut'), tone: 'red' }
            : logged === 0
                // Nothing logged yet: the days it takes, not 0/10.
                ? { value: `${need}`, label: chip?.tone === 'warn' ? tr('series:roundCard.drawMoveToday') : tr('series:homeCards.drawDays'), tone: chip?.tone === 'warn' ? 'orange' : undefined }
                : {
                    value: `${logged}/${need}`,
                    label: chip?.tone === 'warn' ? tr('series:roundCard.drawMoveToday') : tr('series:roundCard.drawDays'),
                    tone: chip?.tone === 'warn' ? 'orange' : undefined,
                };
    return { place, gap, draw };
}

/**
 * How the Series dresses on Home, whatever state it's in: a band of the
 * season's ground fading into the card behind the title, the season's mark,
 * its name in butter and one line under it. Spread into a HomeCard.
 */
export function useSeriesDress(season: string, sub: string) {
    const { def, tint } = useSeason();
    const card = tint?.card ?? plainCard;
    return {
        backdrop: (
            <LinearGradient
                colors={[def.ground, def.ground, mixHex(def.ground, card, 0.5), card]}
                locations={[0, 0.2, 0.42, 0.72]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
            />
        ),
        head: (
            <View style={s.head}>
                <View style={s.words}>
                    <Text style={s.season} numberOfLines={1}>{season.toUpperCase()}</Text>
                    <Text style={s.day} numberOfLines={1}>{sub.toUpperCase()}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={hexA(BUTTER, 0.7)} />
            </View>
        ),
        style: tint ? { borderColor: tint.border } : { borderColor: hexA(def.ground, 0.9) },
    };
}

const s = StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    words: { flex: 1, minWidth: 0, gap: 3 },
    season: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 2.2, color: BUTTER },
    day: { fontFamily: fontFamily.medium, fontSize: 8.5, letterSpacing: 1.6, color: hexA(BUTTER, 0.6) },
});

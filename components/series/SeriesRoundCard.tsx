import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HomeCard, type HomeStat, HomeNote, HomeStats } from '@/components/home/HomeCard';
import { fontFamily } from '@/constants/tokens';
import { trackTap } from '@/lib/analytics';
import { fmt, ordinal } from '@/lib/dev/seriesPrototype';
import { type SeriesToday, seriesDrawChip, seriesNextMove, useDropMove } from './SeriesToday';
import { BUTTER, hexA, mixHex, plainCard, SeasonMark, useSeason } from './season';

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
    const r = t.rival;
    const h = t.heat;
    const first = r ? r.p.name.split(' ')[0] : '';
    const unranked = t.points === 0 && !t.blind;
    // The Drop's quicker route, but only when it also passes your rival: else it's the Drop card's business.
    const drop = useDropMove(t);
    const move = seriesNextMove(t, drop?.passes ? drop : null);

    const place: HomeStat = t.blind
        ? { value: '?', label: 'Rank hidden' }
        : unranked
            ? { value: '—', label: 'Not ranked yet' }
            : h
                ? { value: ordinal(h.rank), label: 'In your heat', tone: 'gold', move: h.move }
                : { value: `#${fmt(t.rank)}`, label: `Of ${fmt(t.total)}`, tone: 'gold', move: t.move };
    const gap: HomeStat = !r
        ? { value: '—', label: 'No rival yet' }
        : t.blind || r.sealed
            ? { value: '?', label: `Pts to ${first}` }
            : r.ahead
                ? { value: fmt(r.gap), label: `Pts clear of ${first}`, tone: 'green' }
                : { value: fmt(r.gap), label: `Pts to ${first}` };
    const chip = seriesDrawChip(t);
    const { logged, need } = t.draw;
    const draw: HomeStat = {
        value: `${Math.min(logged, need)}/${need}`,
        label: logged >= need ? 'In the draw' : chip?.tone === 'warn' ? 'Draw · move today' : chip?.tone === 'out' ? 'Draw out of reach' : 'Draw days',
        tone: logged >= need ? 'green' : chip?.tone === 'warn' ? 'orange' : chip?.tone === 'out' ? 'red' : undefined,
    };

    const dress = useSeriesDress(t.season, `${t.roundName} · day ${t.day} of ${t.days}`);

    return (
        <HomeCard
            title={`${t.season} · day ${t.day} of ${t.days}`}
            {...dress}
            onPress={() => {
                trackTap('series_home_open', { from: 'card' });
                router.push({ pathname: '/(tabs)/league', params: { focus: 'rival', at: String(Date.now()) } });
            }}
            label={`${t.season}. ${place.value} ${place.label}. ${gap.value} ${gap.label}. ${draw.value} ${draw.label}. Next: ${move}. Opens the League.`}
        >
            <HomeStats items={[place, gap, draw]} />
            <HomeNote icon="flash-outline" lead="Next" text={move} />
        </HomeCard>
    );
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
                <SeasonMark size={24} def={def} />
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

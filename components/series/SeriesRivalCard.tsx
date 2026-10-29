import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSeasonCard } from './season';

import { CARD_BG, GOLD, GREEN, kit, MUTED, StatusChip } from '@/components/drop/cardKit';
import { Avatar } from '@/components/social/Avatar';
import { seriesNum } from '@/lib/api/series';
import type { Rival } from '@/lib/dev/seriesPrototype';
import type { Friend } from '@/lib/social/types';
import { RED, RollNumber } from './SeriesLane';
import { type SeriesToday, useDropMove } from './SeriesToday';
import { gapToday } from './todayMove';

/**
 * Home's head-to-head while a Series round is running: the same rival League
 * shows (the person just ahead of you, or a friend within reach), counted in
 * Series points, with the gap turned into something to do. Tapping opens
 * League on your next move. Reads Home's one Series source (useSeriesToday),
 * live or, in dev builds before a round, the sample.
 *
 * It heads the Series block under your own progress (streak, rings, level),
 * and its header carries the Series and your place: "AUTUMN SERIES · #313 ▲1".
 * It's Home's one "do this next": while today's Drop (dev) is still
 * sealed, the goal line is the Drop's quicker route and what else it does
 * ("Walk 18 min opens today’s Drop · passes Arjun").
 */
export function SeriesRivalCard({ youName, today, rival }: { youName: string; today: SeriesToday; rival: Rival }) {
    const { t } = useTranslation();
    // The card wears the active Series season.
    const sc = useSeasonCard();
    const r = { ...rival, sealed: rival.sealed || today.blind };
    const first = r.p.name.split(' ')[0];

    // Today's Drop, while it's sealed: its quicker route is the next move (the top line says the same).
    const next = useDropMove(today);

    // You passed them: say so for a moment, then introduce the next one up.
    const prev = useRef(r.p);
    const [passed, setPassed] = useState<string | null>(null);
    useEffect(() => {
        const old = prev.current;
        if (old.name === r.p.name) return undefined;
        prev.current = r.p;
        if (old.pts >= r.mePts) return undefined;
        setPassed(old.name.split(' ')[0]);
        const t = setTimeout(() => setPassed(null), 4500);
        return () => clearTimeout(t);
    }, [r.p, r.mePts]);

    const open = () => {
        void Haptics.selectionAsync();
        router.push({ pathname: '/(tabs)/league', params: { focus: 'rival', at: String(Date.now()) } });
    };
    const you: Friend = { id: 'you', username: '', displayName: youName, status: 'accepted' };
    const them: Friend = { id: r.p.id, username: '', displayName: r.p.name, status: 'accepted' };
    const daysLeft = Math.max(0, today.days - today.day);
    const title = passed
        ? t('series:rival.youPassed', { name: passed })
        : r.sealed
            ? t('series:rival.sealed', { name: first })
            : r.ahead ? t('series:rival.chasing', { name: first }) : t('series:rival.justAhead', { name: first });
    const goal = passed
        ? t('series:rival.newRival', { name: r.p.name, n: seriesNum(r.gap), how: next ? `${next.head} ${next.tail}` : r.how })
        : r.sealed
            ? t('series:rival.blind')
            : r.friend
                ? t('series:rival.goalFriend', { how: r.how, season: today.season })
                : r.ahead
                    ? t('series:rival.goalBehind', { how: r.how, season: today.season })
                    : t('series:rival.goalAbove', { how: r.how, rank: seriesNum(r.rank ?? r.meRank - 1), season: today.season });

    return (
        <View>
            <SeriesHeader today={today} onOpen={open} />
            <Pressable
                onPress={open}
                style={({ pressed }) => [kit.card, sc, passed && kit.cardLit, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={t('series:rival.a11y', { title, goal: next && !passed ? `${next.head} ${next.tail}.` : goal })}
            >
                {/* The gap is the card's number, friend or not; while you've just
                    passed someone the win leads instead. */}
                <View style={kit.header}>
                    <View style={styles.who}>
                        <View style={styles.avatars}>
                            <View style={styles.avatarWrap}><Avatar friend={you} size={30} /></View>
                            <View style={[styles.avatarWrap, { marginLeft: -10 }]}><Avatar friend={them} size={30} /></View>
                        </View>
                        {r.friend && !passed && <StatusChip icon="people-outline" text={t('series:rival.friend')} tone="gold" />}
                    </View>
                    {passed ? (
                        <StatusChip icon="trending-up-outline" text={t('series:rival.passed')} tone="green" />
                    ) : (
                        <View style={kit.points}>
                            {r.sealed ? <Text style={kit.pointsValue}>?</Text> : <RollNumber value={r.gap} style={kit.pointsValue} />}
                            {/* Sealed, the gap is "?": always the plural. */}
                            <Text style={kit.pointsLabel}>
                                {r.ahead
                                    ? t('series:rival.ptsAhead', { count: r.sealed ? 2 : r.gap })
                                    : t('series:rival.ptsBehind', { count: r.sealed ? 2 : r.gap })}
                            </Text>
                        </View>
                    )}
                </View>

                <View style={kit.titleBlock}>
                    <View style={kit.titleRow}>
                        <Ionicons name={passed ? 'trending-up-outline' : r.friend ? 'people-outline' : 'trophy-outline'} size={18} color={GOLD} />
                        <Text style={kit.title} numberOfLines={1}>{title}</Text>
                    </View>
                    {next && !passed ? (
                        <Text style={kit.goal}>
                            <Text style={{ color: GOLD, fontWeight: '600' }}>{next.head}</Text> {next.tail}.
                        </Text>
                    ) : (
                        <Text style={kit.goal}>{goal}</Text>
                    )}
                </View>

                <View style={kit.progressBlock}>
                    <GapBar r={r} first={first} />
                </View>

                {/* What's coming next is a reason to come back: the next moment, else the season. */}
                <View style={kit.footer}>
                    {today.nextMoment ? (
                        <View style={styles.next}>
                            <Ionicons name={today.nextMoment.icon} size={12} color={GOLD} />
                            <Text style={kit.footerMuted} numberOfLines={1}>
                                <Text style={{ color: GOLD }}>{t('series:rival.next', { name: today.nextMoment.name })}</Text>
                                {today.nextMoment.when ? ` · ${today.nextMoment.when}` : ''}
                            </Text>
                        </View>
                    ) : (
                        <Text style={kit.footerMuted}>{today.season}</Text>
                    )}
                    <Text style={kit.timeText}>{daysLeft === 0 ? t('series:rival.lastDay') : t('series:rival.daysLeft', { count: daysLeft })}</Text>
                </View>
            </Pressable>
        </View>
    );
}

/** The Series block's header: which Series, your place and today's move, and the way to League. */
function SeriesHeader({ today, onOpen }: { today: SeriesToday; onOpen: () => void }) {
    const { t } = useTranslation();
    const unranked = today.points === 0 && !today.blind;
    const place = today.blind
        ? t('series:rival.rankHidden')
        : unranked ? t('series:rival.notRanked') : `#${seriesNum(today.rank)}`;
    const move = today.blind || unranked ? 0 : today.move;
    return (
        <View style={kit.sectionRow}>
            <Text style={[kit.sectionLabel, styles.headLine]} numberOfLines={1}>
                {today.season}
                <Text style={{ color: MUTED }}>{'  ·  '}</Text>
                <Text style={{ color: GOLD }}>{place}</Text>
                {move !== 0 && <Text style={{ color: move > 0 ? GREEN : RED }}>{`  ${move > 0 ? '▲' : '▼'}${Math.abs(move)}`}</Text>}
            </Text>
            <Pressable hitSlop={8} style={kit.newBtn} onPress={onOpen} accessibilityRole="button" accessibilityLabel={t('series:rival.openA11y')}>
                <Ionicons name="chevron-forward" size={14} color={GOLD} />
                <Text style={kit.newBtnText}>{t('series:rival.league')}</Text>
            </Pressable>
        </View>
    );
}

/** Today against the gap, in one bar (gapToday says which and how full). */
function GapBar({ r, first }: { r: Rival; first: string }) {
    const g = gapToday(r, first);
    const color = g.tone === 'gold' ? GOLD : g.tone === 'green' ? GREEN : MUTED;
    return <Meter label={g.label} value={g.value} fill={g.fill} color={color} warn={g.tone === 'grey'} />;
}

function Meter({ label, value, fill, color, warn }: { label: string; value: string; fill: number; color: string; warn?: boolean }) {
    return (
        <View style={{ gap: 6 }}>
            <View style={kit.progressMeta}>
                <Text style={kit.progressLabel} numberOfLines={1}>{label}</Text>
                <Text style={[kit.progressValue, { color: warn ? RED : color }]}>{value}</Text>
            </View>
            <View style={kit.track}>
                <View style={[kit.fill, { width: `${Math.min(1, fill) * 100}%`, backgroundColor: color }]} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headLine: { flex: 1, marginRight: 12 },
    next: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 10 },
    avatars: { flexDirection: 'row', alignItems: 'center' },
    avatarWrap: { borderRadius: 18, borderWidth: 1.5, borderColor: CARD_BG },
});

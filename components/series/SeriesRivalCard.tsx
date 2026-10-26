import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSeasonCard } from './season';

import { CARD_BG, GOLD, GREEN, kit, MUTED, StatusChip } from '@/components/drop/cardKit';
import { Avatar } from '@/components/social/Avatar';
import { fmt, ordinal, type Rival } from '@/lib/dev/seriesPrototype';
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
 * and its header carries the Series and your place: "AUTUMN SERIES · 10TH IN
 * HEAT ▲1". It's Home's one "do this next": while today's Drop (dev) is still
 * sealed, the goal line is the Drop's quicker route and what else it does
 * ("Walk 18 min opens today’s Drop · passes Arjun").
 */
export function SeriesRivalCard({ youName, today, rival }: { youName: string; today: SeriesToday; rival: Rival }) {
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
        ? `You passed ${passed}`
        : r.sealed ? `${first} is sealed` : r.ahead ? `${first} is chasing you` : `${first} is just ahead`;
    const goal = passed
        ? `New rival: ${r.p.name}, ${fmt(r.gap)} pts ahead. ${next ? `${next.head} ${next.tail}` : r.how}.`
        : r.sealed
            ? 'Blind Mode: every rank is hidden. Keep moving.'
            : `${r.how}. ${r.friend ? 'Your friend, just above you' : r.ahead ? 'Right behind you' : `Just above you at #${fmt(r.rank ?? r.meRank - 1)}`} in the ${today.season}.`;

    return (
        <View>
            <SeriesHeader today={today} onOpen={open} />
            <Pressable
                onPress={open}
                style={({ pressed }) => [kit.card, sc, passed && kit.cardLit, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={`${title}. ${next && !passed ? `${next.head} ${next.tail}.` : goal} Opens the League.`}
            >
                {/* The gap is the card's number, friend or not; while you've just
                    passed someone the win leads instead. */}
                <View style={kit.header}>
                    <View style={styles.who}>
                        <View style={styles.avatars}>
                            <View style={styles.avatarWrap}><Avatar friend={you} size={30} /></View>
                            <View style={[styles.avatarWrap, { marginLeft: -10 }]}><Avatar friend={them} size={30} /></View>
                        </View>
                        {r.friend && !passed && <StatusChip icon="people-outline" text="Friend" tone="gold" />}
                    </View>
                    {passed ? (
                        <StatusChip icon="trending-up-outline" text="Passed" tone="green" />
                    ) : (
                        <View style={kit.points}>
                            {r.sealed ? <Text style={kit.pointsValue}>?</Text> : <RollNumber value={r.gap} style={kit.pointsValue} />}
                            <Text style={kit.pointsLabel}>{`${r.gap === 1 && !r.sealed ? 'pt' : 'pts'} ${r.ahead ? 'ahead' : 'behind'}`}</Text>
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
                                <Text style={{ color: GOLD }}>Next: {today.nextMoment.name}</Text>
                                {today.nextMoment.when ? ` · ${today.nextMoment.when}` : ''}
                            </Text>
                        </View>
                    ) : (
                        <Text style={kit.footerMuted}>{today.season}</Text>
                    )}
                    <Text style={kit.timeText}>{daysLeft === 0 ? 'Last day' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}</Text>
                </View>
            </Pressable>
        </View>
    );
}

/** The Series block's header: which Series, your place and today's move, and the way to League. */
function SeriesHeader({ today, onOpen }: { today: SeriesToday; onOpen: () => void }) {
    const h = today.heat;
    const unranked = today.points === 0 && !today.blind;
    const place = today.blind ? 'RANK HIDDEN' : unranked ? 'NOT RANKED' : h ? `${ordinal(h.rank).toUpperCase()} IN HEAT` : `#${fmt(today.rank)}`;
    const move = today.blind || unranked ? 0 : h ? h.move : today.move;
    return (
        <View style={kit.sectionRow}>
            <Text style={[kit.sectionLabel, styles.headLine]} numberOfLines={1}>
                {today.season}
                <Text style={{ color: MUTED }}>{'  ·  '}</Text>
                <Text style={{ color: GOLD }}>{place}</Text>
                {move !== 0 && <Text style={{ color: move > 0 ? GREEN : RED }}>{`  ${move > 0 ? '▲' : '▼'}${Math.abs(move)}`}</Text>}
            </Text>
            <Pressable hitSlop={8} style={kit.newBtn} onPress={onOpen} accessibilityRole="button" accessibilityLabel="Open the League">
                <Ionicons name="chevron-forward" size={14} color={GOLD} />
                <Text style={kit.newBtnText}>League</Text>
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

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
    Easing,
    FadeIn,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
    ZoomIn,
} from 'react-native-reanimated';

import { DropGlyph, DropMark } from '@/components/drop/DropMark';
import type { DropReward } from '@/lib/drop';
import { type DuelResult, firstName, fmt } from '@/lib/dev/seriesPrototype';
import {
    CARD_BG,
    CARD_BORDER,
    GOLD,
    GREEN,
    HAIR,
    SectionLabel,
    TEXT,
    TEXT_3,
} from './SeriesLane';
import { useSeasonCard } from './season';


/** A slow sweep of light across something sealed, so it reads as something to open. */
function Sheen() {
    const x = useSharedValue(-1);
    useEffect(() => { x.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.ease) }), -1, false); }, [x]);
    const st = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 140 }] }));
    return (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st]}>
            <LinearGradient
                colors={['rgba(232,210,0,0)', 'rgba(232,210,0,0.16)', 'rgba(232,210,0,0)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ width: 80, height: '100%' }}
            />
        </Animated.View>
    );
}

type DropState = { phase: 'sealed' | 'ready' | 'opened'; progress: number; reward: DropReward | null; doubleLeft: number };

/** One readout: a small label, one number, one quiet line under it. */
function Cell({ label, gold, children, meta, first, tight }: { label: string; gold?: boolean; children: React.ReactNode; meta: React.ReactNode; first?: boolean; tight?: boolean }) {
    return (
        <View style={[s.cell, tight && s.cellTight, !first && s.cellRule]}>
            <Text style={[s.cellLabel, gold && { color: GOLD }]} numberOfLines={1}>{label}</Text>
            <View style={s.cellValueRow}>{children}</View>
            {typeof meta === 'string' ? <Text style={s.cellMeta} numberOfLines={1}>{meta}</Text> : meta}
        </View>
    );
}

/**
 * Today, in three numbers under the next move: the Drop (Home's Drop, the one
 * daily reveal), The Draw and your extra tickets. The Golden P's challenge joins
 * as a fourth on the night you take it. Each one opens its detail.
 *
 * On live data the Drop and tickets aren't on the server yet, so it's The Draw
 * and the day of the round (drop and tickets null, round set).
 */
export function TodayReadouts({
    drop, logged, need, tickets, golden, onOpenDrop, onDraw, drawnOn, round,
}: {
    drop: DropState | null;
    logged: number;
    need: number;
    tickets: number | null;
    golden: { minutes: number; need: number; done: boolean } | null;
    onOpenDrop: () => void;
    onDraw: () => void;
    /** When The Draw is drawn, short: "16 Nov". */
    drawnOn: string;
    round?: { day: number; days: number };
}) {
    const inDraw = logged >= need;
    const tight = !!golden;
    const pct = drop ? Math.floor(drop.progress * 100) : 0;
    const r = drop?.reward;
    const dropCell = !drop ? null : drop.phase === 'ready' ? (
        <Pressable
            onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onOpenDrop(); }}
            style={({ pressed }) => [s.cell, tight && s.cellTight, s.cellReady, pressed && { opacity: 0.75 }]}
            accessibilityRole="button"
            accessibilityLabel="Open today’s Drop"
        >
            <Sheen />
            <Text style={[s.cellLabel, { color: GOLD }]}>DROP</Text>
            <View style={s.cellValueRow}>
                <Ionicons name="lock-open-outline" size={13} color={GOLD} />
                <Text style={s.cellOpen}>OPEN</Text>
            </View>
            <Text style={[s.cellMeta, { color: 'rgba(232,210,0,0.7)' }]}>ready</Text>
        </Pressable>
    ) : drop.phase === 'opened' && r ? (
        <Animated.View entering={ZoomIn.springify().damping(13)} style={[s.cell, tight && s.cellTight]}>
            <Text style={s.cellLabel}>DROP</Text>
            <View style={s.cellValueRow}><Text style={[s.cellValue, { color: GOLD }]}>{r.headline}</Text></View>
            <Text style={s.cellMeta} numberOfLines={1}>
                {r.series === 'double60'
                    ? (drop.doubleLeft > 0 ? `${drop.doubleLeft} min left` : 'used')
                    : r.series === 'ticket' ? 'ticket' : r.unit === 'POWR' ? 'POWR' : r.unit.toLowerCase()}
            </Text>
        </Animated.View>
    ) : (
        <Cell
            first
            tight={tight}
            label="DROP"
            meta={<View style={s.cellTrack}><View style={[s.cellFill, { width: `${pct}%` }]} /></View>}
        >
            <Text style={s.cellValue}>{pct}</Text><Text style={s.cellUnit}>%</Text>
        </Cell>
    );
    return (
        <View style={s.cells}>
            {dropCell && <View style={s.cellPress}>{dropCell}</View>}
            <Pressable onPress={onDraw} style={({ pressed }) => [s.cellPress, pressed && { opacity: 0.7 }]} accessibilityRole="button"
                accessibilityLabel={inDraw ? 'You’re in The Draw' : `The Draw: ${logged} of ${need} days logged`}
            >
                <Cell first={!dropCell} tight={tight} label="DRAW" meta={inDraw ? drawnOn : 'days'}>
                    {inDraw
                        ? <Text style={[s.cellValue, { color: GREEN }]}>In</Text>
                        : <><Text style={s.cellValue}>{logged}</Text><Text style={s.cellUnit}>/{need}</Text></>}
                </Cell>
            </Pressable>
            {tickets != null ? (
                <Pressable onPress={onDraw} style={({ pressed }) => [s.cellPress, pressed && { opacity: 0.7 }]} accessibilityRole="button"
                    accessibilityLabel={`${tickets} extra Draw ticket${tickets === 1 ? '' : 's'}`}
                >
                    <Cell tight={tight} label="TICKETS" meta="extra">
                        <Ionicons name="ticket-outline" size={14} color={tickets ? GOLD : TEXT_3} style={{ marginRight: 5, marginBottom: 3 }} />
                        <Text style={s.cellValue}>{tickets}</Text>
                    </Cell>
                </Pressable>
            ) : round ? (
                <View style={s.cellPress}>
                    <Cell tight={tight} label="ROUND" meta={`${Math.max(0, round.days - round.day)} days left`}>
                        <Text style={s.cellValue}>{round.day}</Text><Text style={s.cellUnit}>/{round.days}</Text>
                    </Cell>
                </View>
            ) : null}
            {golden && (
                <Animated.View entering={FadeIn.duration(400)} style={s.cellPress}>
                    <Cell tight label="GOLDEN P" gold meta={golden.done ? 'Huel hamper' : 'tonight'}>
                        {golden.done
                            ? <Text style={[s.cellValue, { color: GREEN }]}>Done</Text>
                            : <><Text style={s.cellValue}>{golden.minutes}</Text><Text style={s.cellUnit}>/{golden.need}</Text></>}
                    </Cell>
                </Animated.View>
            )}
        </View>
    );
}

/** The Golden P, wherever it has turned up: small, gold, breathing. Easy to miss on purpose. */
export function GoldenPMark({ onFind }: { onFind: () => void }) {
    const v = useSharedValue(0);
    useEffect(() => { v.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }), -1, true); }, [v]);
    const st = useAnimatedStyle(() => ({ transform: [{ scale: 1 + v.value * 0.12 }], opacity: 0.75 + v.value * 0.25 }));
    return (
        <Pressable
            onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); onFind(); }}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Something gold"
        >
            <Animated.View style={[s.goldenMark, st]}>
                <DropGlyph height={15} color={GOLD} solid />
            </Animated.View>
        </Pressable>
    );
}

/** You found the Golden P: tonight's challenge, and what it's for. */
export function GoldenPSheet({
    visible, finder, of, need, onAccept, onClose,
}: {
    visible: boolean;
    finder: number;
    of: number;
    need: number;
    onAccept: () => void;
    onClose: () => void;
}) {
    const full = useSharedValue(1);
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={s.gScrim}>
                <Animated.View entering={ZoomIn.springify().damping(12)} style={s.gCard}>
                    <DropMark height={110} fill={full} color={GOLD} />
                    <Text style={s.gEyebrow}>THE GOLDEN P</Text>
                    <Text style={s.gTitle}>You found it. <Text style={s.gTitleGold}>#{finder} of {of}.</Text></Text>
                    <Text style={s.gBody}>{need} active minutes before midnight wins a Huel hamper.</Text>
                    <Pressable
                        style={({ pressed }) => [s.gBtn, pressed && { opacity: 0.85 }]}
                        onPress={() => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onAccept(); }}
                        accessibilityRole="button"
                    >
                        <Text style={s.gBtnText}>TAKE THE CHALLENGE</Text>
                    </Pressable>
                    <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
                        <Text style={s.gLater}>Not tonight</Text>
                    </Pressable>
                </Animated.View>
            </View>
        </Modal>
    );
}

/** Monday: how last week's duels ended, with a one-tap rematch. */
export function DuelResults({
    results, rematched, onRematch,
}: {
    results: DuelResult[];
    rematched: string[];
    onRematch: (id: string) => void;
}) {
    const won = results.filter((r) => r.you > r.them).length;
    const sc = useSeasonCard();
    return (
        <>
            <SectionLabel text="Last week" right={`${won} won · ${results.length - won} lost · +${won} Draw ticket${won === 1 ? '' : 's'}`} />
            <View style={[s.card, { paddingVertical: 4 }, sc]}>
                {results.map((r, i) => {
                    const win = r.you > r.them;
                    const sent = rematched.includes(r.id);
                    return (
                        <View key={r.id} style={s.dRow}>
                            {i > 0 && <View style={[s.hair, { left: 50 }]} />}
                            <Ionicons name={win ? 'checkmark-circle' : 'close-circle-outline'} size={20} color={win ? GREEN : TEXT_3} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={s.dText} numberOfLines={1}>{win ? `You beat ${r.name}` : `${firstName(r.name)} beat you`}</Text>
                                <Text style={s.dScore}>{win ? `${fmt(r.you)}–${fmt(r.them)}` : `${fmt(r.them)}–${fmt(r.you)}`}</Text>
                            </View>
                            <Pressable
                                onPress={() => onRematch(r.id)}
                                disabled={sent}
                                style={({ pressed }) => [s.rematch, sent && s.rematchSent, pressed && { opacity: 0.7 }]}
                                accessibilityRole="button"
                                accessibilityLabel={sent ? `Rematch sent to ${r.name}` : `Rematch ${r.name}`}
                            >
                                <Text style={[s.rematchText, sent && { color: TEXT_3 }]}>{sent ? 'SENT' : 'REMATCH'}</Text>
                            </Pressable>
                        </View>
                    );
                })}
            </View>
        </>
    );
}

const s = StyleSheet.create({
    cells: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR },
    cellPress: { flex: 1, flexBasis: 0, minWidth: 0 },
    cell: { flex: 1, minWidth: 0, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 12, gap: 2, overflow: 'hidden' },
    cellRule: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: HAIR },
    cellTight: { paddingHorizontal: 11 },
    cellReady: { backgroundColor: 'rgba(232,210,0,0.05)' },
    cellLabel: { fontSize: 8, fontWeight: '700', letterSpacing: 1.8, color: TEXT_3 },
    cellValueRow: { flexDirection: 'row', alignItems: 'flex-end', minHeight: 28, gap: 0 },
    cellValue: { fontSize: 24, lineHeight: 28, fontWeight: '200', color: TEXT, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
    cellUnit: { fontSize: 12, lineHeight: 22, fontWeight: '300', color: TEXT_3, marginLeft: 1 },
    cellOpen: { marginLeft: 6, marginBottom: 5, fontSize: 13, fontWeight: '700', letterSpacing: 2.2, color: GOLD },
    cellMeta: { fontSize: 10, fontWeight: '300', color: TEXT_3 },
    cellTrack: { marginTop: 6, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
    cellFill: { height: '100%', backgroundColor: GOLD },

    goldenMark: {
        width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(232,210,0,0.10)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.45)',
    },
    gScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    gCard: {
        width: 320, maxWidth: '100%', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingTop: 28, paddingBottom: 18,
        borderRadius: 22, backgroundColor: '#101010', borderWidth: 1, borderColor: 'rgba(232,210,0,0.4)',
    },
    gEyebrow: { marginTop: 14, fontSize: 9, fontWeight: '700', letterSpacing: 2.4, color: GOLD },
    gTitle: { fontSize: 24, fontWeight: '200', color: TEXT, textAlign: 'center', letterSpacing: -0.4 },
    gTitleGold: { fontWeight: '700', color: GOLD },
    gBody: { marginTop: 4, fontSize: 14, fontWeight: '300', color: TEXT, textAlign: 'center', lineHeight: 20 },
    gBody2: { fontSize: 12, fontWeight: '300', color: TEXT_3, textAlign: 'center', lineHeight: 18 },
    gBtn: { alignSelf: 'stretch', marginTop: 12, height: 46, borderRadius: 23, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
    gBtnText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: '#0a0a0a' },
    gLater: { marginTop: 6, fontSize: 12, color: TEXT_3 },
    card: { marginHorizontal: 16, borderRadius: 18, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, overflow: 'hidden' },
    hair: { position: 'absolute', left: 58, right: 16, top: 0, height: StyleSheet.hairlineWidth, backgroundColor: HAIR },

    dRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    dText: { fontSize: 14, fontWeight: '300', color: TEXT },
    dScore: { marginTop: 2, fontSize: 11, fontWeight: '300', color: TEXT_3, fontVariant: ['tabular-nums'] },
    rematch: { height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(232,210,0,0.4)', alignItems: 'center', justifyContent: 'center' },
    rematchSent: { borderColor: CARD_BORDER },
    rematchText: { fontSize: 9, fontWeight: '700', letterSpacing: 1.4, color: GOLD },
});

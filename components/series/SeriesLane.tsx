import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { type StyleProp, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Animated, {
    Easing,
    FadeIn,
    FadeOut,
    LinearTransition,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { HonourRow } from '@/components/honours/HonourRow';
import { flagEmoji, fmt, initialsOf, type Person, TITLES, type TitleKey } from '@/lib/dev/seriesPrototype';
import type { Hit } from './useSeriesSim';

// Same palette as the League tab (app/(tabs)/league.tsx).
export const GOLD = '#E8D200';
export const GREEN = '#4ade80';
export const RED = '#f87171';
export const EMBER = '#E58A3A';
export const SILVER = '#c0c0c0';
export const BRONZE = '#cd7f32';
// Cards match the rest of the app (Home's Together / This week, the event ticket).
export const CARD_BG = '#111111';
export const CARD_BORDER = '#222222';
/** Avatars stay a step lighter than the card so they read as discs. */
export const AVATAR_BG = '#1b1b1b';
export const BORDER = 'rgba(255,255,255,0.08)';
/** Row dividers: hairlines inset to the name column. */
export const HAIR = 'rgba(255,255,255,0.10)';
export const TEXT = '#F2F2F2';
export const MUTED = 'rgba(255,255,255,0.25)';
export const DIM = 'rgba(255,255,255,0.5)';
/** The Series screen's two quieter text steps, lifted so small type still reads on #111. */
export const TEXT_2 = 'rgba(255,255,255,0.7)';
export const TEXT_3 = 'rgba(255,255,255,0.5)';
/** Your row, wherever it sits in a list. */
export const YOU_TINT: [string, string] = ['rgba(232,210,0,0.09)', 'rgba(232,210,0,0.03)'];
export const YOU_LINE = 'rgba(232,210,0,0.22)';
export const LANE_H = 60;

/** Rows glide to their new place when someone overtakes. */
export const ROW_LAYOUT = LinearTransition.duration(650).easing(Easing.bezier(0.2, 0.8, 0.2, 1));

/** Counts up to `value` instead of jumping, like the Gym Clash screens. */
export function RollNumber({ value, style }: { value: number; style?: StyleProp<TextStyle> }) {
    const [shown, setShown] = useState(value);
    const from = useRef(value);
    useEffect(() => {
        const start = from.current;
        if (start === value) return undefined;
        const t0 = Date.now();
        let raf = 0;
        const step = () => {
            const q = Math.min(1, (Date.now() - t0) / 900);
            const v = Math.round(start + (value - start) * (1 - Math.pow(1 - q, 3)));
            from.current = v;
            setShown(v);
            if (q < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [value]);
    return <Text style={style}>{fmt(shown)}</Text>;
}

/** The League tab's ▲ n / ▼ n chip (RankMove), places since midnight. */
export function MoveChip({ delta, size = 'sm' }: { delta: number; size?: 'sm' | 'lg' }) {
    if (!delta) return null;
    const up = delta > 0;
    const colour = up ? GREEN : RED;
    const lg = size === 'lg';
    return (
        <View style={[s.move, lg && s.moveLg, { backgroundColor: `${colour}1A` }]}>
            <Ionicons name={up ? 'caret-up' : 'caret-down'} size={lg ? 12 : 9} color={colour} />
            <Text style={[s.moveText, lg && s.moveTextLg, { color: colour }]}>{Math.abs(delta)}</Text>
        </View>
    );
}

export function TitlePill({ title, extra, label }: { title: TitleKey; extra?: string; label?: string }) {
    const def = TITLES[title];
    const c = def.ember ? EMBER : GOLD;
    return (
        <View style={[s.pill, { backgroundColor: `${c}1A`, borderColor: `${c}40` }]}>
            <Ionicons name={def.icon} size={9} color={c} />
            <Text style={[s.pillText, { color: c }]} numberOfLines={1}>{label ?? def.label}{extra ?? ''}</Text>
        </View>
    );
}

/** Section heading: label, hairline, an optional note on the right (the League tab's sectionRow). */
export function SectionLabel({ text, right, accessory }: { text: string; right?: string; accessory?: React.ReactNode }) {
    return (
        <View style={s.secRow}>
            <Text style={s.secLabel}>{text}</Text>
            <View style={s.secLine} />
            {right ? <Text style={s.secRight} numberOfLines={1}>{right}</Text> : null}
            {accessory}
        </View>
    );
}

/** "306 MORE" between hairlines: the people a list skips. */
export function MoreLine({ text }: { text: string }) {
    return (
        <View style={s.more}>
            <View style={s.moreLine} />
            <Text style={s.moreText}>{text.toUpperCase()}</Text>
            <View style={s.moreLine} />
        </View>
    );
}

function Flash({ colour }: { colour: string }) {
    const op = useSharedValue(1);
    useEffect(() => { op.value = withTiming(0, { duration: 1400 }); }, [op]);
    const st = useAnimatedStyle(() => ({ opacity: op.value }));
    return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colour }, st]} />;
}

/** The race's columns, shared by the header and every row so the moves and points line up. */
export const RACE_COLS = { rank: 36, flag: 20, move: 46, pts: 64 };

/** A member's flag, or their initials when there isn't one (live data). */
function Flag({ code, initials, accent }: { code?: string; initials: string; accent: string | null }) {
    if (!code) {
        return (
            <View style={[s.flagBox, s.flagInitials]}>
                <Text style={[s.initials, { fontSize: 8 }, accent ? { color: accent } : null]}>{initials}</Text>
            </View>
        );
    }
    return (
        <View style={s.flagBox} accessibilityElementsHidden>
            <Text style={s.flagEmoji} allowFontScaling={false}>{flagEmoji(code)}</Text>
        </View>
    );
}

/** Places since midnight, in the race's Today column: ▲ green, ▼ red, a dash for none. */
function Move({ delta }: { delta: number | null }) {
    if (!delta) return <View style={s.moveCol}><Text style={s.moveNone}>—</Text></View>;
    const up = delta > 0;
    return (
        <View style={s.moveCol}>
            <Ionicons name={up ? 'caret-up' : 'caret-down'} size={11} color={up ? GREEN : RED} />
            <Text style={[s.moveNum, { color: up ? GREEN : RED }]}>{Math.abs(delta)}</Text>
        </View>
    );
}

/** The race's column labels. */
export function RaceHeader() {
    const { t } = useTranslation();
    return (
        <View style={s.head}>
            <Text style={[s.headText, { width: RACE_COLS.rank, textAlign: 'center' }]}>{t('series:lane.rank')}</Text>
            <Text style={[s.headText, { flex: 1, marginLeft: RACE_COLS.flag + 12 }]}>{t('series:lane.member')}</Text>
            <Text style={[s.headText, { width: RACE_COLS.move, textAlign: 'center' }]}>{t('series:lane.today')}</Text>
            <Text style={[s.headText, { width: RACE_COLS.pts, textAlign: 'right' }]}>{t('series:lane.points')}</Text>
        </View>
    );
}

/**
 * One row of the Series race: rank, flag, name, today's move, points, each in
 * its own column so the arrows and points line up down the board. Medal colours
 * only on the top 3; under the name, the leader's tag or last round's place.
 */
export function SeriesLane({
    p, rank, hit, title, isMe, dark, first, you, hideRank,
}: {
    p: Person;
    rank: number;
    hit?: Hit;
    title: TitleKey | null;
    isMe: boolean;
    dark: boolean;
    first: boolean;
    you: { name: string; initials: string; avatarUrl: string | null };
    /** Blind Mode: your own row keeps its points but not its place. */
    hideRank?: boolean;
}) {
    const { t } = useTranslation();
    const MEDAL: Record<number, string> = { 1: GOLD, 2: SILVER, 3: BRONZE };
    const isTop = !dark && rank <= 3;
    const accent = isTop ? MEDAL[rank] : isMe ? GOLD : null;
    const name = isMe ? `${you.name}${t('events:board.youSuffix')}` : p.name;
    const initials = isMe ? you.initials : initialsOf(p.name);
    // One tag at most: the leader's. Everyone else shows where they finished last round.
    const tag = title === 'leader' ? title : null;
    // Their honours (the small line icons); a sealed row keeps nothing but its name.
    const honours = dark ? [] : p.honours ?? [];
    return (
        <Animated.View
            layout={ROW_LAYOUT}
            entering={FadeIn.duration(300)}
            exiting={FadeOut.duration(200)}
            style={[s.row, isMe && s.rowMe]}
        >
            {isMe && <LinearGradient colors={YOU_TINT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />}
            {!first && !isMe && <View style={s.hair} />}
            {hit && <Flash key={hit.key} colour="rgba(255,255,255,0.05)" />}

            <View style={s.rankCol}>
                {dark
                    ? <Ionicons name="lock-closed-outline" size={12} color={TEXT_3} />
                    : <Text style={[s.rank, accent ? { color: accent, fontWeight: isMe ? '500' : '400' } : null]}>{hideRank ? '?' : rank}</Text>}
            </View>

            <Flag code={p.flag} initials={initials} accent={accent} />

            <View style={s.middle}>
                <View style={s.nameRow}>
                    <Text style={[s.name, isTop && { color: TEXT }, isMe && s.nameMe]} numberOfLines={1}>{name}</Text>
                    {/* What a session just added, beside the name so it never sits on the row below. */}
                    {hit && !dark && (
                        <Animated.Text
                            entering={FadeIn.duration(200)}
                            exiting={FadeOut.duration(300)}
                            style={s.plus}
                        >
                            {`+${fmt(hit.pts)}${hit.x2 ? ' ×2' : ''}`}
                        </Animated.Text>
                    )}
                </View>
                {/* The line under the name: the leader's tag or last round's place,
                    then their honours. Three or fewer sit after the place; more than
                    three take the line, with a count (the column is ~110 px wide). */}
                {(() => {
                    const many = honours.length > 3;
                    const place = p.last == null ? t('series:lane.newThisRound') : honours.length ? t('series:lane.lastShort', { rank: fmt(p.last) }) : t('series:lane.lastRound', { rank: fmt(p.last) });
                    return (
                        <View style={s.subRow}>
                            {tag ? <TitlePill title={tag} /> : !many && <Text style={[s.sub, { flexShrink: 1 }]} numberOfLines={1}>{place}</Text>}
                            {honours.length > 0 && (
                                <>
                                    {(tag || !many) && <View style={s.subDiv} />}
                                    <HonourRow honours={honours} max={tag ? 2 : 3} />
                                </>
                            )}
                        </View>
                    );
                })()}
            </View>

            <Move delta={dark || hideRank ? null : p.mid - rank} />

            <View style={s.ptsCol}>
                {dark ? (
                    <Ionicons name="eye-off-outline" size={14} color={TEXT_3} />
                ) : (
                    <RollNumber value={p.pts} style={[s.pts, isTop && { color: TEXT }, isMe && s.ptsMe]} />
                )}
            </View>
        </Animated.View>
    );
}

const s = StyleSheet.create({
    row: { height: LANE_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
    rowMe: { marginHorizontal: 6, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: YOU_LINE, overflow: 'hidden' },
    hair: { position: 'absolute', left: 58, right: 16, top: 0, height: StyleSheet.hairlineWidth, backgroundColor: HAIR },
    rankCol: { width: 36, alignItems: 'center' },
    flagBox: { width: 20, height: 14, borderRadius: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    flagEmoji: { fontSize: 16, lineHeight: 19, textAlign: 'center', includeFontPadding: false },
    flagInitials: { width: 20, height: 20, borderRadius: 10, backgroundColor: AVATAR_BG, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
    sub: { fontSize: 11, fontWeight: '300', color: TEXT_3 },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 13 },
    subDiv: { width: StyleSheet.hairlineWidth, height: 11, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 2 },
    moveCol: { width: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
    moveNum: { fontSize: 13, fontWeight: '500', fontVariant: ['tabular-nums'] },
    moveNone: { fontSize: 13, fontWeight: '300', color: TEXT_3 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIR },
    headText: { fontSize: 8, fontWeight: '600', letterSpacing: 1.2, color: TEXT_3 },
    rank: { fontSize: 15, fontWeight: '300', color: TEXT_3, fontVariant: ['tabular-nums'] },
    move: { flexDirection: 'row', alignItems: 'center', gap: 1, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6 },
    moveLg: { gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
    moveText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3, lineHeight: 11 },
    moveTextLg: { fontSize: 12, lineHeight: 14 },
    initials: { fontSize: 12, fontWeight: '500', color: TEXT_2 },
    middle: { flex: 1, gap: 4, minWidth: 0 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
    name: { flexShrink: 1, fontSize: 14, fontWeight: '300', color: 'rgba(255,255,255,0.8)' },
    nameMe: { color: TEXT, fontWeight: '400' },
    pill: { maxWidth: '100%', alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100, borderWidth: 1 },
    pillText: { flexShrink: 1, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
    ptsCol: { alignItems: 'flex-end', width: 64 },
    pts: { fontSize: 15, fontWeight: '300', letterSpacing: -0.2, color: TEXT_3, fontVariant: ['tabular-nums'] },
    ptsMe: { color: GOLD, fontWeight: '400' },
    plus: { flexShrink: 0, fontSize: 11, fontWeight: '600', color: GREEN, letterSpacing: 0.2, fontVariant: ['tabular-nums'] },

    secRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, gap: 10 },
    secLabel: { fontSize: 9, fontWeight: '500', letterSpacing: 2.2, color: TEXT, textTransform: 'uppercase' },
    secLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: HAIR },
    secRight: { flexShrink: 1, fontSize: 10, fontWeight: '300', color: TEXT_3 },
    more: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 58 },
    moreLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: HAIR },
    moreText: { fontSize: 9, fontWeight: '500', letterSpacing: 1.8, color: TEXT_3 },
});

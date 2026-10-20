import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
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
    withDelay,
    withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { getLevelInfo } from '@/constants/levels';
import { fmt, initialsOf, type Person, TITLES, type TitleKey } from '@/lib/dev/seriesPrototype';
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
export const AVATAR_BG = 'rgba(40,40,40,0.85)';
export const BORDER = 'rgba(255,255,255,0.08)';
export const AVATAR_RING = 'rgba(255,255,255,0.14)';
export const TEXT = '#F2F2F2';
export const MUTED = 'rgba(255,255,255,0.25)';
export const DIM = 'rgba(255,255,255,0.5)';

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
            <Ionicons name={up ? 'caret-up' : 'caret-down'} size={lg ? 12 : 8} color={colour} />
            <Text style={[s.moveText, lg && s.moveTextLg, { color: colour }]}>{Math.abs(delta)}</Text>
        </View>
    );
}

export function LevelPill({ totalEarned }: { totalEarned: number }) {
    const { t } = useTranslation();
    const { current } = getLevelInfo(totalEarned);
    return (
        <View style={[s.pill, { backgroundColor: current.pill.bg, borderColor: current.pill.border }]}>
            <Text style={[s.pillText, { color: current.pill.text }]}>{t('events:board.level', { level: current.level })}</Text>
        </View>
    );
}

export function TitlePill({ title }: { title: TitleKey }) {
    const def = TITLES[title];
    const c = def.ember ? EMBER : GOLD;
    return (
        <View style={[s.pill, s.titlePill, { backgroundColor: `${c}1A`, borderColor: `${c}40` }]}>
            <Ionicons name={def.icon} size={9} color={c} />
            <Text style={[s.pillText, { color: c }]}>{def.label}</Text>
        </View>
    );
}

function LaneBar({ frac, hit, lead, tone }: { frac: number; hit?: Hit; lead: number; tone: 'gold' | 'you' | 'ember' }) {
    // Sized in percent, not measured pixels: a row that is still animating in
    // reports a zero width, which left the first rows with empty bars.
    const pct = useSharedValue(0);
    useEffect(() => {
        pct.value = withTiming(Math.min(100, Math.max(2, frac * 100)), { duration: 1200, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
    }, [frac, pct]);
    const fill = useAnimatedStyle(() => ({ width: `${pct.value}%` }));
    const colours: [string, string, string] = tone === 'you'
        ? ['#b7a400', GOLD, '#f6ea8a']
        : tone === 'ember'
            ? ['rgba(229,138,58,0.35)', 'rgba(229,138,58,0.75)', '#f5c08e']
            : ['rgba(232,210,0,0.22)', 'rgba(232,210,0,0.55)', 'rgba(246,234,138,0.9)'];
    return (
        <View style={s.track}>
            <Animated.View style={[s.fill, fill]}>
                <LinearGradient colors={colours} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
            {hit && (
                <Delta
                    key={hit.key}
                    left={Math.min(96, (hit.old / lead) * 100)}
                    width={Math.max(2, (hit.pts / lead) * 100)}
                    colour={hit.ember ? EMBER : GREEN}
                />
            )}
        </View>
    );
}

/** The points that just landed, drawn on the bar in green, then faded. */
function Delta({ left, width, colour }: { left: number; width: number; colour: string }) {
    const op = useSharedValue(1);
    useEffect(() => { op.value = withDelay(1300, withTiming(0, { duration: 1100 })); }, [op]);
    const st = useAnimatedStyle(() => ({ opacity: op.value }));
    return <Animated.View style={[s.delta, { left: `${left}%`, width: `${width}%`, backgroundColor: colour }, st]} />;
}

function Flash({ colour }: { colour: string }) {
    const op = useSharedValue(1);
    useEffect(() => { op.value = withTiming(0, { duration: 1400 }); }, [op]);
    const st = useAnimatedStyle(() => ({ opacity: op.value }));
    return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colour }, st]} />;
}

export type LaneMeta =
    | { kind: 'title'; title: TitleKey }
    | { kind: 'level' }
    | { kind: 'gap'; text: string }
    | { kind: 'sealed' };

/**
 * One row of the Series race: the League tab's standings row (rank badge with
 * its move chip, ringed avatar, name, one line of meta, points + PTS) with
 * the Gym Clash bar under the name, measured against the leader.
 */
export function SeriesLane({
    p, rank, lead, hit, meta, isMe, wanted, dark, first, you,
}: {
    p: Person;
    rank: number;
    lead: number;
    hit?: Hit;
    meta: LaneMeta;
    isMe: boolean;
    wanted: boolean;
    dark: boolean;
    first: boolean;
    you: { name: string; initials: string; avatarUrl: string | null };
}) {
    const { t } = useTranslation();
    const MEDAL: Record<number, string> = { 1: GOLD, 2: SILVER, 3: BRONZE };
    const isTop = !dark && rank <= 3;
    const accent = wanted ? EMBER : isTop ? MEDAL[rank] : isMe ? GOLD : MUTED;
    const name = isMe ? `${you.name}${t('events:board.youSuffix')}` : p.name;
    const initials = isMe ? you.initials : initialsOf(p.name);
    return (
        <Animated.View
            layout={ROW_LAYOUT}
            entering={FadeIn.duration(300)}
            exiting={FadeOut.duration(200)}
            style={[
                s.row,
                !first && s.rowDivider,
                isMe && s.rowMe,
                (isTop || wanted) && { borderLeftWidth: 2, borderLeftColor: `${accent}55`, paddingLeft: 14 },
            ]}
        >
            {hit && <Flash key={hit.key} colour={hit.ember ? 'rgba(229,138,58,0.12)' : 'rgba(255,255,255,0.05)'} />}
            <View style={s.rankCol}>
                <View style={[s.rankBadge, (isTop || isMe || wanted) && { backgroundColor: `${accent}14`, borderWidth: 1, borderColor: `${accent}35` }]}>
                    {dark
                        ? <Ionicons name="lock-closed-outline" size={11} color={MUTED} />
                        : <Text style={[s.rank, { color: accent }]}>{rank}</Text>}
                </View>
                {!dark && <MoveChip delta={p.mid - rank} />}
            </View>

            <View style={[s.ring, isTop && { borderColor: `${accent}70` }, isMe && !isTop && { borderColor: `${GOLD}55` }, wanted && { borderColor: `${EMBER}90`, borderStyle: 'dashed' }]}>
                <View style={s.avatar}>
                    {isMe && you.avatarUrl ? (
                        <Image source={{ uri: you.avatarUrl }} style={{ flex: 1 }} contentFit="cover" />
                    ) : (
                        <View style={s.initialsBox}>
                            <Text style={[s.initials, { color: isTop || isMe ? accent : DIM }]}>{initials}</Text>
                        </View>
                    )}
                </View>
            </View>

            <View style={s.middle}>
                <Text style={[s.name, isMe && s.nameMe, isTop && { color: TEXT, fontWeight: '400' }]} numberOfLines={1}>{name}</Text>
                <View style={s.meta}>
                    {meta.kind === 'title' && <TitlePill title={meta.title} />}
                    {meta.kind === 'level' && <LevelPill totalEarned={p.totalEarned} />}
                    {meta.kind === 'gap' && <Text style={s.metaText}>{meta.text}</Text>}
                    {meta.kind === 'sealed' && <Text style={s.metaText}>Position sealed</Text>}
                </View>
                {!dark && <LaneBar frac={p.pts / lead} hit={hit} lead={lead} tone={wanted ? 'ember' : isMe ? 'you' : 'gold'} />}
            </View>

            <View style={s.ptsCol}>
                {dark ? (
                    <Ionicons name="eye-off-outline" size={14} color={MUTED} />
                ) : (
                    <>
                        <RollNumber value={p.pts} style={[s.pts, { color: accent }]} />
                        {hit
                            ? <Text style={[s.plus, hit.ember && { color: EMBER }]}>+{fmt(hit.pts)}{hit.x2 ? ' ×2' : ''}</Text>
                            : <Text style={s.ptsLabel}>{t('events:board.pts')}</Text>}
                    </>
                )}
            </View>
        </Animated.View>
    );
}

const s = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 16, gap: 12, overflow: 'hidden' },
    rowDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },
    rowMe: { backgroundColor: 'rgba(232,210,0,0.05)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.18)', borderRadius: 12 },
    rankCol: { alignItems: 'center', gap: 3, width: 32 },
    rankBadge: { minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
    rank: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, color: MUTED, textAlign: 'center' },
    move: { flexDirection: 'row', alignItems: 'center', gap: 1, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6 },
    moveLg: { gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
    moveText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.3, lineHeight: 10 },
    moveTextLg: { fontSize: 12, lineHeight: 14 },
    ring: { width: 36, height: 36, borderRadius: 18, padding: 2, borderWidth: 1, borderColor: AVATAR_RING },
    avatar: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: AVATAR_BG },
    initialsBox: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: AVATAR_BG },
    initials: { fontSize: 12, fontWeight: '500' },
    middle: { flex: 1, gap: 4, minWidth: 0 },
    name: { fontSize: 14, fontWeight: '300', color: DIM },
    nameMe: { color: TEXT, fontWeight: '400' },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 16 },
    metaText: { fontSize: 11, fontWeight: '300', color: DIM },
    pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100, borderWidth: 1 },
    titlePill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    pillText: { fontSize: 8, fontWeight: '700', letterSpacing: 1 },
    track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
    fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, overflow: 'hidden' },
    delta: { position: 'absolute', top: 0, bottom: 0, borderRadius: 2, minWidth: 6 },
    ptsCol: { alignItems: 'flex-end', gap: 1, minWidth: 56 },
    pts: { fontSize: 14, fontWeight: '400', color: TEXT, fontVariant: ['tabular-nums'] },
    ptsLabel: { fontSize: 7, fontWeight: '700', color: MUTED, letterSpacing: 1.5 },
    plus: { fontSize: 9, fontWeight: '700', color: GREEN, letterSpacing: 0.5 },
});

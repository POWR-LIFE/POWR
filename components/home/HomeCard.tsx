import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useSeasonCard } from '@/components/series/season';
import { fontFamily } from '@/constants/tokens';

/*
 * Home's one card (2026-10-25, after WHOOP's home screen). Every card on Home
 * is built from these, so they all read the same way:
 *
 *   1. a title INSIDE the card, top left, in caps; one thing top right (a
 *      chevron when the card opens something, or a short value like a clock)
 *   2. one row of data: numbers with short caps labels, never sentences
 *   3. at most one button: dark and full width; gold only for the one thing
 *      to do now
 *
 * Colour is for data: gold is your own number (and that one gold button),
 * green/orange/red only when a number is good/at risk/lost. Labels and titles
 * stay white or grey. Nothing is hidden to get there: the numbers stay on the
 * card; it's the sentences explaining them that go.
 */
export const HC = {
    bg: '#111111',
    border: '#222222',
    text: '#F2F2F2',
    label: '#7A7A7A',
    faint: '#4A4A4A',
    hair: 'rgba(255,255,255,0.08)',
    gold: '#E8D200',
    green: '#4ade80',
    orange: '#f97316',
    red: '#f87171',
};

export function HomeCard({
    title, right, onPress, lit, action, children, label, style, head, backdrop,
}: {
    title: string;
    /** A custom title row (the Series wears its season); `title` still names the card for screen readers. */
    head?: React.ReactNode;
    /** Painted behind everything, clipped to the card (the Series' season band). */
    backdrop?: React.ReactNode;
    /** Top right: a short value (a clock, "3 of 7"). With onPress and nothing here, a chevron. */
    right?: React.ReactNode;
    /** The whole card opens this. */
    onPress?: () => void;
    /** A gold edge: something's ready for you. */
    lit?: boolean;
    action?: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; primary?: boolean };
    children: React.ReactNode;
    /** Spoken label for the card as a whole. */
    label?: string;
    style?: StyleProp<ViewStyle>;
}) {
    const sc = useSeasonCard();
    const body = (
        <>
            {backdrop}
            {head ?? (
                <View style={s.head}>
                    <Text style={s.title} numberOfLines={1}>{title}</Text>
                    {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={HC.label} /> : null)}
                </View>
            )}
            {children}
            {action && <HomeAction {...action} />}
        </>
    );
    const cardStyle = [s.card, sc, lit && s.lit, backdrop ? s.clip : null, style];
    if (!onPress) return <View style={cardStyle}>{body}</View>;
    return (
        <Pressable
            onPress={() => { void Haptics.selectionAsync(); onPress(); }}
            style={({ pressed }) => [...cardStyle, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={label ?? title}
        >
            {body}
        </Pressable>
    );
}

/** The card's one button: dark and full width, or gold when it's the thing to do now. */
export function HomeAction({ icon, label, onPress, primary }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; primary?: boolean }) {
    return (
        <Pressable
            onPress={() => { void Haptics.selectionAsync(); onPress(); }}
            style={({ pressed }) => [s.btn, primary && s.btnGold, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={label}
        >
            <Ionicons name={icon} size={15} color={primary ? '#0a0a0a' : HC.text} />
            <Text style={[s.btnText, primary && { color: '#0a0a0a' }]}>{label.toUpperCase()}</Text>
        </Pressable>
    );
}

export type HomeStat = {
    value: string;
    label: string;
    /** gold = yours; green/orange/red = good/at risk/lost. */
    tone?: 'gold' | 'green' | 'orange' | 'red';
    /** A small mark after the value: ▲3 / ▼2. */
    move?: number;
};

/** One row of numbers with caps labels, split by hairlines. */
export function HomeStats({ items }: { items: HomeStat[] }) {
    return (
        <View style={s.stats}>
            {items.map((it, i) => (
                <React.Fragment key={it.label}>
                    {i > 0 && <View style={s.rule} />}
                    <View style={s.stat}>
                        <View style={s.valueRow}>
                            <Text style={[s.value, it.tone && { color: HC[it.tone] }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{it.value}</Text>
                            {!!it.move && (
                                <Text style={[s.move, { color: it.move > 0 ? HC.green : HC.red }]}>{`${it.move > 0 ? '▲' : '▼'}${Math.abs(it.move)}`}</Text>
                            )}
                        </View>
                        <Text style={s.label} numberOfLines={2}>{it.label}</Text>
                    </View>
                </React.Fragment>
            ))}
        </View>
    );
}

/** A caps line under the data, for the one thing to know: "NEXT · 30 ACTIVE MIN PASSES HANNAH". */
export function HomeNote({ icon, lead, text, tone }: { icon?: React.ComponentProps<typeof Ionicons>['name']; lead?: string; text: string; tone?: 'gold' | 'green' | 'orange' }) {
    const c = tone ? HC[tone] : HC.text;
    return (
        <View style={s.note}>
            {icon && <Ionicons name={icon} size={12} color={tone ? c : HC.label} />}
            <Text style={s.noteText} numberOfLines={1}>
                {lead ? <Text style={{ color: HC.label }}>{`${lead.toUpperCase()}  `}</Text> : null}
                <Text style={{ color: c }}>{text.toUpperCase()}</Text>
            </Text>
        </View>
    );
}

export const homeCardStyles = StyleSheet.create({
    /** For a value in the top right (a clock): small, grey. */
    rightText: { fontFamily: fontFamily.regular, fontSize: 11, color: HC.label },
});

const s = StyleSheet.create({
    card: { backgroundColor: HC.bg, borderRadius: 18, borderWidth: 1, borderColor: HC.border, paddingHorizontal: 16, paddingTop: 15, paddingBottom: 16, gap: 16 },
    lit: { borderColor: 'rgba(232,210,0,0.35)' },
    clip: { overflow: 'hidden' },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 18 },
    title: { flex: 1, fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 1.8, color: HC.text, textTransform: 'uppercase' },

    stats: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
    rule: { width: StyleSheet.hairlineWidth, backgroundColor: HC.hair },
    stat: { flex: 1, minWidth: 0, gap: 3 },
    valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
    value: { flexShrink: 1, fontFamily: fontFamily.light, fontSize: 24, lineHeight: 28, color: HC.text, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
    move: { fontFamily: fontFamily.semiBold, fontSize: 11 },
    label: { fontFamily: fontFamily.medium, fontSize: 8.5, lineHeight: 12, letterSpacing: 1.2, color: HC.label, textTransform: 'uppercase' },

    note: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: -4 },
    noteText: { flex: 1, fontFamily: fontFamily.medium, fontSize: 9.5, letterSpacing: 1.1 },

    btn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
        paddingVertical: 13, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    },
    btnGold: { backgroundColor: HC.gold, borderColor: HC.gold },
    btnText: { fontFamily: fontFamily.semiBold, fontSize: 11, letterSpacing: 1.4, color: HC.text },
});

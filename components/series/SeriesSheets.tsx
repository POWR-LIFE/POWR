import { Ionicons } from '@expo/vector-icons';
import { Image, type ImageSource } from 'expo-image';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fmt, type HeatMeta, type Scale } from '@/lib/dev/seriesPrototype';
import { CARD_BG, CARD_BORDER, DIM, EMBER, GOLD, GREEN, HAIR, MUTED, TEXT, TEXT_2, TEXT_3 } from './SeriesLane';
import { BUTTER, hexA, SeriesLockup, useSeason } from './season';

const ON_GOLD = '#0a0a0a';

/**
 * A bottom sheet in the app's dark style. The handle works: drag it down to
 * close (it springs back if you let go early), or tap it.
 */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
    const insets = useSafeAreaInsets();
    const { tint } = useSeason();
    const drag = useRef(new Animated.Value(0)).current;
    useEffect(() => { if (visible) drag.setValue(0); }, [visible, drag]);
    const pan = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 3,
        onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
            if (Math.abs(g.dy) < 4 && Math.abs(g.dx) < 4) { onClose(); return; }
            if (g.dy > 90 || g.vy > 0.8) {
                Animated.timing(drag, { toValue: 700, duration: 180, useNativeDriver: true }).start(() => onClose());
            } else {
                Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
            }
        },
        onPanResponderTerminate: () => { Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(); },
    }), [drag, onClose]);
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
            <Animated.View style={[s.sheet, tint && { backgroundColor: tint.sheet }, { paddingBottom: Math.max(28, insets.bottom + 12), transform: [{ translateY: drag }] }]}>
                <View {...pan.panHandlers} style={s.grabZone} accessibilityRole="button" accessibilityLabel="Close">
                    <View style={s.grab} />
                </View>
                {children}
            </Animated.View>
        </Modal>
    );
}

export function SheetHead({ light, bold, onClose }: { light: string; bold: string; onClose: () => void }) {
    return (
        <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{light}<Text style={s.sheetTitleBold}>{bold}</Text></Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={DIM} />
            </Pressable>
        </View>
    );
}

/** What gets shared: the season's square editorial card from Sorine's lookbook, with your rank. */
export function ShareCard({ big, line }: { big: string; line: string }) {
    const { def, line: round } = useSeason();
    return (
        <View style={[s.card, { backgroundColor: def.ground }]} accessibilityLabel={`Share card: ${def.name}, ${round.toLowerCase()}, ${big}, ${line}`}>
            <View style={s.cardRow}><Text style={s.cardTiny}>POWR ATHLETIC CLUB</Text><Text style={s.cardTiny}>{def.no}</Text></View>
            <View style={s.cardRule} />
            <View style={{ alignItems: 'center', marginTop: 10 }}><SeriesLockup height={48} def={def} words={false} /></View>
            <Text style={s.cardWords}>{def.words}<Text style={{ color: hexA(BUTTER, 0.5) }}>{'  |  '}</Text>{round}</Text>
            <Text style={s.cardRank}>{big}</Text>
            <Text style={s.cardLine}>{line}</Text>
            <View style={[s.cardRule, { marginTop: 'auto' }]} />
            <View style={s.cardRow}><Text style={s.cardTiny}>EVERY MOVE COUNTS.</Text><Text style={s.cardTiny}>POWR.LIFE</Text></View>
        </View>
    );
}

export function ShareSheet({ visible, onClose, big, line, onShare }: { visible: boolean; onClose: () => void; big: string; line: string; onShare: () => void }) {
    return (
        <Sheet visible={visible} onClose={onClose}>
            <SheetHead light="Share your " bold="rank" onClose={onClose} />
            <ShareCard big={big} line={line} />
            <Pressable style={({ pressed }) => [s.solid, pressed && { opacity: 0.85 }]} onPress={onShare}>
                <Text style={s.solidText}>SHARE</Text>
            </Pressable>
        </Sheet>
    );
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** One line in a drawer: a picture or icon, a short title, one short line, and where you stand. */
export type InfoRow = {
    key: string;
    title: string;
    line?: string;
    icon?: IconName;
    img?: ImageSource;
    /** A small label over the title: 1ST, 2ND, 3RD. */
    eyebrow?: { text: string; color: string };
    right?: string;
    tone?: 'gold' | 'green' | 'muted' | 'ember';
};
const TONE_C = { gold: GOLD, green: GREEN, muted: TEXT_3, ember: EMBER };

/** The drawers' one layout: rows, nothing to read twice. */
export function InfoList({ rows, onRowLayout }: { rows: InfoRow[]; onRowLayout?: (key: string, y: number) => void }) {
    return (
        <View style={s.info}>
            {rows.map((r, i) => (
                <View key={r.key} style={[s.infoRow, i > 0 && s.infoRule]} onLayout={onRowLayout ? (e) => onRowLayout(r.key, e.nativeEvent.layout.y) : undefined}>
                    {r.img
                        ? <Image source={r.img} style={s.infoPic} contentFit="cover" />
                        : (
                            <View style={[s.infoPic, s.infoIcon, r.tone === 'ember' && { borderColor: 'rgba(229,138,58,0.35)', backgroundColor: 'rgba(229,138,58,0.08)' }]}>
                                <Ionicons name={r.icon ?? 'ellipse-outline'} size={18} color={r.tone === 'ember' ? EMBER : GOLD} />
                            </View>
                        )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                        {r.eyebrow && <Text style={[s.infoEyebrow, { color: r.eyebrow.color }]}>{r.eyebrow.text}</Text>}
                        <Text style={s.infoTitle} numberOfLines={1}>{r.title}</Text>
                        {r.line ? <Text style={s.infoLine} numberOfLines={1}>{r.line}</Text> : null}
                    </View>
                    {r.right ? <Text style={[s.infoRight, { color: TONE_C[r.tone ?? 'muted'] }]}>{r.right}</Text> : null}
                </View>
            ))}
        </View>
    );
}

/** How the Series works, in six lines. What you can win has its own drawer. */
export function RulesSheet({
    visible, onClose, onPrizes, live = false, days = 15, need = 10, when = 'on the 16th', boosts = false, blindMode = false, heat = null, mostWanted = false,
}: {
    visible: boolean;
    onClose: () => void;
    onPrizes?: () => void;
    /** Live data: only the rules the server runs (no boosts, Blind Mode or bounty yet). */
    live?: boolean;
    days?: number;
    need?: number;
    /** When the winners land: "on the 16th". */
    when?: string;
    /** Live: the round has boost moments / a Blind Mode (set in /admin/series). */
    boosts?: boolean;
    blindMode?: boolean;
    /** Your heat, when there is one: it leads the list. */
    heat?: HeatMeta | null;
    /** The round has Most Wanted, so the bounty is on. */
    mostWanted?: boolean;
}) {
    const heatLine = heat
        ? [heat.div > 1 ? `top ${heat.up} move up` : null, heat.down > 0 ? `bottom ${heat.down} drop` : null].filter(Boolean).join(', ')
        : '';
    const rows: InfoRow[] = [
        ...(heat ? [{
            key: 'heat', icon: 'people-outline' as const, title: `Your heat: ${heat.size} at your pace`,
            line: heatLine ? `Set for the round · ${heatLine}` : 'Set for the round',
        }] : []),
        { key: 'round', icon: 'calendar-outline', title: `${days} days, one board`, line: live ? `Winners ${when}` : '1–15 Nov · winners on the 16th' },
        { key: 'score', icon: 'walk-outline', title: 'Your POWR points count', line: 'Up to 120 active minutes a day' },
        ...(live && !boosts ? [] : [{ key: 'boost', icon: 'flash-outline' as const, title: 'Boosts up to ×2', line: live ? 'The round’s moments: they never stack' : 'Streaks, the Drop and the round’s moments' }]),
        { key: 'draw', icon: 'ticket-outline', title: 'Every Move Counts', line: `A draw: be active on ${need} of the ${days} days` },
        ...(live && !blindMode ? [] : [{ key: 'blind', icon: 'eye-off-outline' as const, title: 'Blind Mode', line: live ? 'Every rank hidden while it’s on' : 'Every rank hidden for 48 hours' }]),
        ...(mostWanted ? [{ key: 'bounty', icon: 'locate-outline' as const, title: 'The bounty', line: 'Take the lead to claim it · most claims wins', tone: 'ember' as const }] : []),
        { key: 'one', icon: 'gift-outline', title: 'One prize each', line: 'Win two and the next in line takes the other' },
    ];
    return (
        <Sheet visible={visible} onClose={onClose}>
            <SheetHead light="How it " bold="works" onClose={onClose} />
            <InfoList rows={rows} />
            {onPrizes && (
                <Pressable onPress={onPrizes} style={({ pressed }) => [s.sheetLink, pressed && { opacity: 0.6 }]} accessibilityRole="button">
                    <Text style={s.sheetLinkText}>What you can win</Text>
                    <Ionicons name="arrow-forward" size={15} color={TEXT} />
                </Pressable>
            )}
        </Sheet>
    );
}

/** The end-of-round summary: one card per member, made to be shared. */
export function YourFile({
    visible, onClose, scale, onShare, prizes = [],
}: {
    visible: boolean;
    onClose: () => void;
    scale: Scale;
    onShare: () => void;
    /** The round's named prizes, the one you won lit (one prize each). */
    prizes?: { key: string; label: string; icon: IconName; won: boolean }[];
}) {
    const insets = useSafeAreaInsets();
    const f = scale === 'pitch'
        ? { rank: 298, total: 5000, pct: 6, climb: 55, passed: 214, best: 1240 }
        : { rank: 17, total: 130, pct: 13, climb: 9, passed: 31, best: 310 };
    const Stat = ({ k, v, sub }: { k: string; v: string; sub: string }) => (
        <View style={s.fileCell}><Text style={s.fileK}>{k}</Text><Text style={s.fileV}>{v}</Text><Text style={s.fileSub} numberOfLines={1}>{sub}</Text></View>
    );
    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <View style={[s.file, { paddingTop: insets.top + 14 }]}>
                <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
                    <View style={s.sheetHead}>
                        <Text style={s.fileTop}>FILE 01 / AW26 · YOUR FILE</Text>
                        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={22} color={DIM} /></Pressable>
                    </View>
                    <Text style={s.fileH}>Round 01, <Text style={s.fileHB}>closed.</Text></Text>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                        <Text style={s.fileHash}>#</Text>
                        <Text style={s.fileRank}>{f.rank}</Text>
                    </View>
                    <Text style={s.fileLine}>of {fmt(f.total)} · Top {f.pct}% · <Text style={{ color: GREEN, fontWeight: '600' }}>▲ {f.climb}</Text> across the round</Text>
                    <View style={s.fileGrid}>
                        <Stat k="BEST DAY" v="Sat 8 Nov" sub={`${fmt(f.best)} pts`} />
                        <Stat k="DAYS LOGGED" v="13 of 15" sub="You’re in The Draw" />
                        <Stat k="PEOPLE PASSED" v={String(f.passed)} sub="Rival beaten: Tom Fitzgerald" />
                        <Stat k="YOUR PRIZE" v={prizes.find((x) => x.won)?.label ?? 'None this time'} sub={prizes.some((x) => x.won) ? '13 days in a row' : 'One prize each'} />
                    </View>
                    <Text style={[s.fileK, { marginBottom: 10 }]}>THE ROUND’S PRIZES · ONE EACH</Text>
                    <View style={s.titles}>
                        {prizes.map((x) => (
                            <View key={x.key} style={s.titleCell}>
                                <View style={[s.titleDisc, x.won && s.titleDiscOn]}>
                                    <Ionicons name={x.icon} size={16} color={x.won ? '#0a0a0a' : 'rgba(255,255,255,0.25)'} />
                                </View>
                                <Text style={[s.titleName, x.won && { color: TEXT }]} numberOfLines={2}>{x.label.toUpperCase()}</Text>
                            </View>
                        ))}
                    </View>
                    <Text style={[s.fileK, { marginBottom: 10 }]}>YOUR CARD</Text>
                    {/* Never a big-board place (pacers fill it): the places you climbed. */}
                    <ShareCard big={`▲${f.climb}`} line="PLACES CLIMBED · ROUND 01" />
                    <Pressable style={({ pressed }) => [s.solid, pressed && { opacity: 0.85 }]} onPress={onShare}>
                        <Text style={s.solidText}>SHARE MY FILE</Text>
                    </Pressable>
                    <Text style={s.fine}>Opens after the reveal, live on Instagram, 16 Nov at 20:00</Text>
                </ScrollView>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    info: { marginTop: 8 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11 },
    infoRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR },
    infoPic: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#0b0b0b' },
    infoIcon: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(232,210,0,0.25)', backgroundColor: 'rgba(232,210,0,0.06)' },
    infoEyebrow: { fontSize: 8, fontWeight: '700', letterSpacing: 1.6, marginBottom: 1 },
    infoTitle: { fontSize: 15, fontWeight: '400', color: TEXT },
    infoLine: { marginTop: 2, fontSize: 12, fontWeight: '300', color: TEXT_2 },
    infoRight: { fontSize: 9, fontWeight: '700', letterSpacing: 1.3, textAlign: 'right' },
    sheetLink: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingVertical: 10 },
    sheetLinkText: { fontSize: 15, fontWeight: '400', color: TEXT },
    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
        position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%', backgroundColor: '#161616',
        borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 20, paddingTop: 10,
    },
    grabZone: { alignSelf: 'stretch', marginTop: -10, marginHorizontal: -20, paddingTop: 12, paddingBottom: 16, alignItems: 'center' },
    grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)' },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    sheetTitle: { fontSize: 24, fontWeight: '200', color: TEXT, letterSpacing: -0.5 },
    sheetTitleBold: { fontWeight: '700', color: GOLD },
    rulesH: { fontSize: 9, fontWeight: '600', letterSpacing: 2, color: GOLD, marginTop: 18, marginBottom: 6 },
    rulesP: { fontSize: 13, fontWeight: '300', color: DIM, lineHeight: 20, marginBottom: 4 },
    rulesB: { color: TEXT, fontWeight: '500' },
    yr: { borderRadius: 14, borderWidth: 1, borderColor: CARD_BORDER, backgroundColor: 'rgba(255,255,255,0.02)', overflow: 'hidden' },
    yrRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
    yrDiv: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.10)' },
    yrTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    yrTitle: { flexShrink: 1, fontSize: 13, fontWeight: '500', color: TEXT },
    yrStatus: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
    yrBody: { fontSize: 12, fontWeight: '300', lineHeight: 16, color: DIM },

    card: { width: 250, aspectRatio: 0.8, alignSelf: 'center', marginVertical: 14, borderRadius: 18, padding: 16, gap: 10 },
    cardRow: { flexDirection: 'row', justifyContent: 'space-between' },
    cardTiny: { fontSize: 7, fontWeight: '600', letterSpacing: 1.6, color: hexA(BUTTER, 0.7) },
    cardRule: { height: StyleSheet.hairlineWidth, backgroundColor: hexA(BUTTER, 0.25) },
    cardWords: { textAlign: 'center', fontSize: 8, fontWeight: '500', letterSpacing: 2.6, color: BUTTER },
    cardRank: { marginTop: 4, textAlign: 'center', fontSize: 52, fontWeight: '100', letterSpacing: -2, color: BUTTER, fontVariant: ['tabular-nums'] },
    cardLine: { textAlign: 'center', fontSize: 8, fontWeight: '700', letterSpacing: 1.6, color: hexA(BUTTER, 0.8) },
    solid: { height: 46, borderRadius: 23, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
    solidText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: ON_GOLD },

    file: { flex: 1, backgroundColor: '#101010', paddingHorizontal: 20 },
    fileTop: { fontSize: 9, fontWeight: '600', letterSpacing: 2, color: MUTED },
    fileH: { fontSize: 28, fontWeight: '200', color: TEXT, letterSpacing: -0.5, marginTop: 10, marginBottom: 6 },
    fileHB: { fontWeight: '700', color: GOLD },
    fileHash: { fontSize: 34, fontWeight: '200', color: GOLD, opacity: 0.6, marginTop: 12 },
    fileRank: { fontSize: 80, fontWeight: '100', color: GOLD, letterSpacing: -3, lineHeight: 84, fontVariant: ['tabular-nums'] },
    fileLine: { fontSize: 13, fontWeight: '300', color: DIM, marginTop: 6, marginBottom: 18 },
    fileGrid: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: CARD_BORDER, marginBottom: 22 },
    fileCell: { width: '50%', padding: 14, gap: 3, backgroundColor: CARD_BG, borderColor: CARD_BORDER, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
    fileK: { fontSize: 8, fontWeight: '700', letterSpacing: 2, color: MUTED },
    fileV: { fontSize: 17, fontWeight: '400', color: TEXT },
    fileSub: { fontSize: 11, fontWeight: '300', color: MUTED },
    fine: { fontSize: 10, color: MUTED, textAlign: 'center', marginTop: 12 },
    titles: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, marginBottom: 24 },
    titleCell: { width: '20%', alignItems: 'center', gap: 6 },
    titleDisc: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
    titleDiscOn: { backgroundColor: GOLD, borderColor: GOLD },
    titleName: { fontSize: 7, fontWeight: '700', letterSpacing: 0.8, color: MUTED, textAlign: 'center' },

});

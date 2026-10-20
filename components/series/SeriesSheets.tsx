import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { ClipPath, Defs, Path } from 'react-native-svg';

import { fmt, type Scale } from '@/lib/dev/seriesPrototype';
import { CARD_BG, CARD_BORDER, DIM, EMBER, GOLD, GREEN, MUTED, TEXT } from './SeriesLane';

const ON_GOLD = '#0a0a0a';
// The POWR P, traced from the logo artwork (same geometry as the shared mock).
const LEG = 'M251.65 0.00 L505.45 0.00 A78.00 78.00 0 0 0 465.67 41.58 L283.61 490.33 A65.25 65.25 0 0 1 223.14 531.05 L0.00 531.05 L201.84 33.54 A53.75 53.75 0 0 1 251.65 0.00 Z';
const BOWL = 'M556.68 0.00 L719.59 0.00 A41.00 41.00 0 0 1 757.59 56.41 L644.27 335.71 A68.25 68.25 0 0 1 581.03 378.30 L361.61 378.30 L499.46 38.54 A61.75 61.75 0 0 1 556.68 0.00 Z';

/** A bottom sheet in the app's dark style. */
function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
    const insets = useSafeAreaInsets();
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
            <View style={[s.sheet, { paddingBottom: Math.max(28, insets.bottom + 12) }]}>
                <View style={s.grab} />
                {children}
            </View>
        </Modal>
    );
}

function SheetHead({ light, bold, onClose }: { light: string; bold: string; onClose: () => void }) {
    return (
        <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{light}<Text style={s.sheetTitleBold}>{bold}</Text></Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={DIM} />
            </Pressable>
        </View>
    );
}

/** The inverse lockup card from the brand file: what gets shared. */
export function ShareCard({ big, line }: { big: string; line: string }) {
    return (
        <View style={s.card} accessibilityLabel={`Share card: Autumn Series, ${big}, ${line}`}>
            <View style={s.cardRow}><Text style={s.cardTiny}>AUTUMN SERIES</Text><Text style={s.cardTiny}>AW26</Text></View>
            <Svg width={58} height={41} viewBox="0 0 760.59 531.05" style={{ marginTop: 8 }}>
                <Defs><ClipPath id="seriesBowl"><Path d={BOWL} /></ClipPath></Defs>
                <Path d={LEG} fill={ON_GOLD} />
                <Path d={BOWL} fill="none" stroke={ON_GOLD} strokeWidth={70} clipPath="url(#seriesBowl)" />
            </Svg>
            <View>
                <Text style={s.cardBold}>AUTUMN</Text>
                <Text style={s.cardLight}>SERIES</Text>
            </View>
            <Text style={s.cardRank}>{big}</Text>
            <Text style={s.cardLine}>{line}</Text>
            <View style={[s.cardRow, { marginTop: 'auto' }]}><Text style={s.cardFoot}>Every move counts.</Text><Text style={s.cardFoot}>powr.life</Text></View>
        </View>
    );
}

export function ShareSheet({ visible, onClose, big, line, onShare }: { visible: boolean; onClose: () => void; big: string; line: string; onShare: () => void }) {
    return (
        <Sheet visible={visible} onClose={onClose}>
            <SheetHead light="Share your " bold="position" onClose={onClose} />
            <ShareCard big={big} line={line} />
            <Pressable style={({ pressed }) => [s.solid, pressed && { opacity: 0.85 }]} onPress={onShare}>
                <Text style={s.solidText}>SHARE</Text>
            </Pressable>
        </Sheet>
    );
}

export function RulesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const H = ({ t, ember }: { t: string; ember?: boolean }) => <Text style={[s.rulesH, ember && { color: EMBER }]}>{t}</Text>;
    const P = ({ children }: { children: React.ReactNode }) => <Text style={s.rulesP}>{children}</Text>;
    const B = ({ children }: { children: React.ReactNode }) => <Text style={s.rulesB}>{children}</Text>;
    return (
        <Sheet visible={visible} onClose={onClose}>
            <SheetHead light="How the " bold="Series works" onClose={onClose} />
            <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
                <H t="FORMAT" />
                <P>Two rounds of 15 days: <B>1–15 Nov</B> and <B>1–15 Dec</B>. Everyone on POWR is entered. Results land on the 16th.</P>
                <H t="SCORING" />
                <P>Series points are the POWR points you already earn from verified movement, times whatever you hold. Only your first <B>120 active minutes a day</B> count.</P>
                <H t="MULTIPLIERS · CAPPED AT ×2.0" />
                <P><B>Hot Streak</B> ×1.1 at 3 days, ×1.25 at 7, ×1.5 at 12. One Rest Token a round.</P>
                <P><B>Flash Window</B> ×2 for an hour, three a round, 15 minutes’ notice by push.</P>
                <P><B>Rain Check</B> ×1.25 on outdoor sessions when it rains in London.</P>
                <P><B>Final 48</B> ×1.5 for everyone outside the top 10.</P>
                <H t="THE BOUNTY" ember />
                <P>When #1 leads #2 by <B>15% or more at midnight</B>, they become Most Wanted. The pot opens at 1,000 pts and grows 500 a night. First to overtake takes it.</P>
                <H t="LIVE EVENTS" />
                <P>Venue competitions like <B>ONE LDN x POWR</B> have their own board and prizes. A session counts on both if you’re in both. Check in on event night for ×2 Series points.</P>
                <H t="PRIZES" />
                <P><B>Top 3 overall</B> · partner prize boxes [1ST / 2ND / 3RD PRIZE]</P>
                <P><B>The Draw</B> · log 10 of 15 days to be in it [PRIZE]</P>
                <P><B>Golden Ticket</B> · one hidden in a random verified session</P>
                <H t="BLACKOUT" />
                <P>For the final 48 hours the top 10 goes dark. Revealed live on Instagram on the 16th at 20:00.</P>
            </ScrollView>
        </Sheet>
    );
}

/** The end-of-round summary: one card per member, made to be shared. */
export function YourFile({ visible, onClose, scale, onShare }: { visible: boolean; onClose: () => void; scale: Scale; onShare: () => void }) {
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
                        <Stat k="TITLE WORN" v="Hot Streak" sub="9 days running" />
                    </View>
                    <Text style={[s.fileK, { marginBottom: 10 }]}>YOUR CARD</Text>
                    <ShareCard big={`#${f.rank}`} line={`TOP ${f.pct}% · ROUND 01`} />
                    <Pressable style={({ pressed }) => [s.solid, pressed && { opacity: 0.85 }]} onPress={onShare}>
                        <Text style={s.solidText}>SHARE MY FILE</Text>
                    </Pressable>
                    <Text style={s.fine}>Opens after the reveal, live on Instagram, 16 Nov at 20:00</Text>
                </ScrollView>
            </View>
        </Modal>
    );
}

/** One ticket hidden in one verified session per round. */
export function GoldenTicket({ visible, onClaim }: { visible: boolean; onClaim: () => void }) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClaim}>
            <Animated.View entering={FadeIn.duration(300)} style={s.gtScrim}>
                <Animated.View entering={ZoomIn.springify().damping(11)} style={s.ticket}>
                    <LinearGradient colors={['#f6ea8a', GOLD, '#c2ad00']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                    <View style={[s.notch, { left: -12 }]} />
                    <View style={[s.notch, { right: -12 }]} />
                    <View style={s.tkTop}>
                        <Text style={s.tkSmall}>AUTUMN SERIES · ROUND 01</Text>
                        <Text style={s.tkH}>GOLDEN{'\n'}TICKET</Text>
                        <Text style={s.tkP}>Your 34-min walk was the one. One ticket was hidden this round, and it landed on you.</Text>
                    </View>
                    <View style={s.tear}>{Array.from({ length: 22 }, (_, i) => <View key={i} style={s.tearDash} />)}</View>
                    <Text style={s.tkSmall}>A PRIZE BOX IS ON ITS WAY</Text>
                    <Text style={s.tkPrize}>[PRIZE BOX]</Text>
                    <Pressable style={({ pressed }) => [s.tkBtn, pressed && { opacity: 0.85 }]} onPress={() => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onClaim(); }}>
                        <Text style={s.tkBtnText}>CLAIM IT</Text>
                    </Pressable>
                </Animated.View>
            </Animated.View>
        </Modal>
    );
}

const s = StyleSheet.create({
    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
        position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%', backgroundColor: '#161616',
        borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 20, paddingTop: 10,
    },
    grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'center', marginBottom: 14 },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    sheetTitle: { fontSize: 24, fontWeight: '200', color: TEXT, letterSpacing: -0.5 },
    sheetTitleBold: { fontWeight: '700', color: GOLD },
    rulesH: { fontSize: 9, fontWeight: '600', letterSpacing: 2, color: GOLD, marginTop: 18, marginBottom: 6 },
    rulesP: { fontSize: 13, fontWeight: '300', color: DIM, lineHeight: 20, marginBottom: 4 },
    rulesB: { color: TEXT, fontWeight: '500' },

    card: { width: 250, aspectRatio: 0.8, alignSelf: 'center', marginVertical: 14, borderRadius: 14, backgroundColor: GOLD, padding: 16, gap: 8 },
    cardRow: { flexDirection: 'row', justifyContent: 'space-between' },
    cardTiny: { fontSize: 8, fontWeight: '600', letterSpacing: 1.8, color: ON_GOLD },
    cardBold: { fontSize: 30, fontWeight: '800', color: ON_GOLD, letterSpacing: -0.5, lineHeight: 30 },
    cardLight: { fontSize: 30, fontWeight: '300', color: ON_GOLD, letterSpacing: -0.5, lineHeight: 30 },
    cardRank: { fontSize: 46, fontWeight: '200', color: ON_GOLD, letterSpacing: -2, marginTop: 4, fontVariant: ['tabular-nums'] },
    cardLine: { fontSize: 9, fontWeight: '700', letterSpacing: 1.6, color: ON_GOLD },
    cardFoot: { fontSize: 9, fontWeight: '500', color: ON_GOLD },
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

    gtScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.86)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    ticket: { width: 300, maxWidth: '100%', borderRadius: 18, overflow: 'hidden', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18 },
    notch: { position: 'absolute', top: 178, width: 24, height: 24, borderRadius: 12, backgroundColor: '#0b0b0b', zIndex: 2 },
    tkTop: { height: 168 },
    tkSmall: { fontSize: 9, fontWeight: '700', letterSpacing: 2, color: ON_GOLD },
    tkH: { fontSize: 40, fontWeight: '800', color: ON_GOLD, letterSpacing: -1, lineHeight: 38, marginTop: 12 },
    tkP: { fontSize: 12, color: ON_GOLD, lineHeight: 17, marginTop: 'auto' },
    tear: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, marginBottom: 14 },
    tearDash: { width: 6, height: 2, backgroundColor: 'rgba(10,10,10,0.35)' },
    tkPrize: { fontSize: 18, fontWeight: '600', color: ON_GOLD, marginTop: 2 },
    tkBtn: { marginTop: 16, height: 46, borderRadius: 23, backgroundColor: ON_GOLD, alignItems: 'center', justifyContent: 'center' },
    tkBtnText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: GOLD },
});

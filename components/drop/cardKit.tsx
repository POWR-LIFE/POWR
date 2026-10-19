import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontFamily } from '@/constants/tokens';
import type { DropReward } from '@/lib/drop';

/**
 * The Drop and Crew cards are built from Home's existing card language, not a
 * new one: the section header is TogetherSection's / ChallengeCard's, and the
 * card body is SharedChallengeCard's (header row with the reward on the right,
 * light 22 title + goal line, labelled 4px track, bonus/time footer, full-width
 * gold action). Values are copied from those files — keep them in step.
 */

export const GOLD = '#E8D200';
export const GREEN = '#00CC66';
export const TEXT = '#F2F2F2';
export const SECONDARY = '#888888';
export const MUTED = '#555555';
export const FAINT = '#444444';
export const CARD_BG = '#111111';
export const BORDER = '#222222';

/** Next 06:00 local — when the Drop and the crew bar reset. */
export function nextResetIso(now: Date = new Date()): string {
    const d = new Date(now);
    d.setHours(6, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
}

/** Next local midnight — when day-long races (Beat Me, Bounties) end. */
export function nextMidnightIso(now: Date = new Date()): string {
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    return d.toISOString();
}

/** The outcome line once a Drop is open: "On your next workout. Up to +30 POWR…". */
export function outcomeLine(r: DropReward): string {
    if (r.kind === 'points') return r.detail;
    const u = r.unit.toLowerCase().replace(/powr/g, 'POWR');
    return `${u.charAt(0).toUpperCase()}${u.slice(1)}. ${r.detail}`;
}

/** TogetherSection's section header: hairline above, label left, one action right. */
export function SectionHeader({ label, action }: { label: string; action?: { text: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void } }) {
    return (
        <View style={kit.sectionRow}>
            <Text style={kit.sectionLabel}>{label}</Text>
            {action && (
                <Pressable hitSlop={8} style={kit.newBtn} onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.text}>
                    {action.icon && <Ionicons name={action.icon} size={14} color={GOLD} />}
                    <Text style={kit.newBtnText}>{action.text}</Text>
                </Pressable>
            )}
        </View>
    );
}

/** Small status pill for the card's top-left, where a challenge shows its avatars. */
export function StatusChip({ icon, text, tone = 'muted' }: { icon: keyof typeof Ionicons.glyphMap; text: string; tone?: 'muted' | 'gold' | 'green' }) {
    const color = tone === 'gold' ? GOLD : tone === 'green' ? GREEN : SECONDARY;
    return (
        <View style={[kit.chip, tone === 'gold' && kit.chipGold]}>
            <Ionicons name={icon} size={12} color={color} />
            <Text style={[kit.chipText, { color }]}>{text}</Text>
        </View>
    );
}

export const kit = StyleSheet.create({
    // TogetherSection / ChallengeCard section header
    sectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingTop: 16,
        marginTop: 8,
        marginBottom: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(255,255,255,0.07)',
    },
    sectionLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 2, color: TEXT, textTransform: 'uppercase' },
    newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    newBtnText: { fontFamily: fontFamily.medium, fontSize: 11, color: GOLD, letterSpacing: 0.2 },

    // SharedChallengeCard body
    card: {
        backgroundColor: CARD_BG,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: BORDER,
        padding: 16,
        gap: 16,
    },
    cardLit: { borderColor: 'rgba(232,210,0,0.35)' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 30 },
    points: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
    pointsValue: { fontFamily: fontFamily.extraLight, fontSize: 24, color: GOLD, lineHeight: 26 },
    pointsLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1, color: FAINT, textTransform: 'uppercase' },

    titleBlock: { gap: 4 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    title: { flex: 1, fontFamily: fontFamily.light, fontSize: 22, color: TEXT, letterSpacing: -0.3 },
    goal: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, lineHeight: 17 },

    progressBlock: { gap: 8 },
    progressMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    progressLabel: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 1.5, color: FAINT, textTransform: 'uppercase' },
    progressValue: { fontFamily: fontFamily.semiBold, fontSize: 12, color: GOLD },
    track: { height: 4, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' },
    fill: { height: 4, borderRadius: 2, backgroundColor: GOLD },
    momentumLine: { fontFamily: fontFamily.regular, fontSize: 11, color: SECONDARY },
    momentumLabel: { fontFamily: fontFamily.medium, color: FAINT, textTransform: 'uppercase', letterSpacing: 1, fontSize: 9 },

    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    footerGold: { fontFamily: fontFamily.semiBold, fontSize: 11, color: GOLD },
    footerMuted: { fontFamily: fontFamily.regular, fontSize: 11, color: MUTED },
    timeText: { fontFamily: fontFamily.regular, fontSize: 11, color: SECONDARY },

    outcomeBlock: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 2 },
    outcomeText: { flex: 1, fontFamily: fontFamily.regular, fontSize: 12.5, color: GREEN, lineHeight: 17 },

    acceptBtn: { backgroundColor: GOLD, borderRadius: 100, paddingVertical: 11, alignItems: 'center' },
    acceptText: { fontFamily: fontFamily.bold, fontSize: 12, color: CARD_BG, letterSpacing: 0.5 },

    // ChallengeCard rows (used for the target picker)
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.07)' },
    rowIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
    rowIconOn: { backgroundColor: 'rgba(232,210,0,0.12)' },
    rowTitle: { flex: 1, fontFamily: fontFamily.regular, fontSize: 14, color: TEXT, letterSpacing: -0.2 },
    rowReadout: { fontFamily: fontFamily.regular, fontSize: 11, color: SECONDARY },
    rowUnit: { color: MUTED, fontSize: 10 },

    // TogetherSection's slim empty doorway
    emptySlim: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: BORDER,
        paddingVertical: 13, paddingHorizontal: 14,
    },
    emptySlimIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(232,210,0,0.10)', alignItems: 'center', justifyContent: 'center' },
    emptySlimTitle: { fontFamily: fontFamily.regular, fontSize: 14, color: TEXT },
    emptySlimBody: { fontFamily: fontFamily.light, fontSize: 11.5, color: SECONDARY, marginTop: 1 },

    chip: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        borderRadius: 100, borderWidth: 1, borderColor: BORDER,
        paddingHorizontal: 10, paddingVertical: 5,
    },
    chipGold: { borderColor: 'rgba(232,210,0,0.35)', backgroundColor: 'rgba(232,210,0,0.06)' },
    chipText: { fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: 0.2 },
});

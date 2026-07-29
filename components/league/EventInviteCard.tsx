import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { fetchProfile } from '@/lib/api/user';
import type { InviteProgress, LiveEvent } from '@/lib/api/liveEvents';

const GOLD    = '#E8D200';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';
const GREEN   = '#4ade80';

/** Same smart-link the friend QR uses — `ref=` doubles as referral attribution. */
function inviteLink(referralCode: string): string {
    return `https://powr.life/app?to=add-friend&ref=${referralCode}`;
}

function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The window is half-open [start, end) — show the last day people can score, not the boundary. */
function lastDayOf(endIso: string): string {
    return shortDate(new Date(new Date(endIso).getTime() - 60_000).toISOString());
}

function statusLine(event: LiveEvent): string {
    if (event.status === 'scheduled') {
        const days = Math.max(0, Math.ceil((new Date(event.window_start_at).getTime() - Date.now()) / 86_400_000));
        const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
        return `Starts ${when} · only points earned that week count`;
    }
    if (event.status === 'live' && !event.is_locked) {
        return `Live now — ends ${lastDayOf(event.window_end_at)}`;
    }
    if (event.is_locked && !event.revealed_at) {
        return 'Scores are locked 🔒 — winners announced in person';
    }
    return 'Winners announced';
}

function firstNames(names: string[], max = 2): string {
    const firsts = names.map(n => n.split(' ')[0]);
    if (firsts.length <= max) {
        return firsts.length === 2 ? `${firsts[0]} and ${firsts[1]}` : firsts.join(', ');
    }
    return `${firsts.slice(0, max).join(', ')} and ${firsts.length - max} more`;
}

export function EventInviteCard({
    event,
    invites,
    onJoin,
    joining,
}: {
    event: LiveEvent;
    invites: InviteProgress | null;
    onJoin: (eventId: string) => Promise<unknown>;
    joining: boolean;
}) {
    const router = useRouter();
    const [code, setCode] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let active = true;
        fetchProfile().then(p => { if (active) setCode(p?.referral_code ?? null); });
        return () => { active = false; };
    }, []);

    const invitesOpen = (event.status === 'scheduled' || event.status === 'live')
        && (!event.conversion_deadline_at || Date.now() < new Date(event.conversion_deadline_at).getTime());
    const canJoin = event.scope === 'opt_in'
        && event.viewer.eligible && !event.viewer.joined && !event.viewer.disqualified
        && (event.status === 'scheduled' || event.status === 'live');

    const milestoneN = invites?.event?.milestone_n ?? event.invite_milestone_n;
    const convertedForEvent = invites?.event?.converted_for_event ?? 0;
    const milestonePaid = invites?.event?.milestone_paid ?? false;
    const pendingNames = (invites?.friends ?? [])
        .filter(f => !f.converted)
        .map(f => f.display_name ?? f.username ?? 'A friend');

    const handleShare = async () => {
        if (!code) return;
        Haptics.selectionAsync();
        try {
            await Share.share({
                message:
                    `Join me for ${event.name} on POWR 💪\n` +
                    `Sign up with my code ${code} — we both earn +${event.invite_bonus_points} POWR after your first workout.\n` +
                    inviteLink(code),
                url: inviteLink(code),
            });
        } catch {
            // user dismissed — no-op
        }
    };

    const handleCopy = async () => {
        if (!code) return;
        await Clipboard.setStringAsync(inviteLink(code));
        Haptics.selectionAsync();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <View style={styles.card}>
            {/* ── Event header ── */}
            <Text style={styles.eyebrow}>LIVE EVENT</Text>
            <Text style={styles.name}>{event.name}</Text>
            <Text style={styles.dates}>
                {shortDate(event.window_start_at)} → {lastDayOf(event.window_end_at)}
            </Text>
            <Text style={styles.statusLine}>{statusLine(event)}</Text>

            {event.prizes.length > 0 && (
                <View style={styles.prizeBlock}>
                    {event.prizes.slice(0, 3).map(p => (
                        <View key={p.rank} style={styles.prizeRow}>
                            <Text style={styles.prizeRank}>
                                {p.rank === 1 ? '1ST' : p.rank === 2 ? '2ND' : p.rank === 3 ? '3RD' : `${p.rank}TH`}
                            </Text>
                            <Text style={styles.prizeLabel} numberOfLines={1}>{p.label}</Text>
                        </View>
                    ))}
                </View>
            )}

            {/* ── Join ── */}
            {canJoin && (
                <Pressable
                    style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]}
                    disabled={joining}
                    onPress={() => { Haptics.selectionAsync(); void onJoin(event.id); }}
                    accessibilityRole="button"
                    accessibilityLabel="Join the week"
                >
                    <Text style={styles.joinBtnText}>{joining ? 'JOINING…' : 'JOIN THE WEEK'}</Text>
                </Pressable>
            )}
            {event.viewer.joined && (
                <View style={styles.joinedRow}>
                    <Ionicons name="checkmark-circle" size={15} color={GREEN} />
                    <Text style={styles.joinedText}>You’re in — every point you earn that week counts</Text>
                </View>
            )}

            {/* ── Invite friends ── */}
            {invitesOpen && (
                <View style={styles.inviteBlock}>
                    <View style={styles.divider} />
                    <Text style={styles.inviteTitle}>INVITE FRIENDS</Text>
                    <Text style={styles.inviteExplainer}>
                        You each get +{event.invite_bonus_points} POWR when a friend joins with your code and
                        logs their first verified workout.
                        {milestoneN > 0 && event.invite_milestone_bonus > 0
                            ? ` +${event.invite_milestone_bonus} more when ${milestoneN} friends make it.`
                            : ''}
                    </Text>

                    <View style={styles.codeRow}>
                        <Pressable
                            style={({ pressed }) => [styles.codeChip, pressed && { opacity: 0.7 }]}
                            onPress={handleCopy}
                            accessibilityRole="button"
                            accessibilityLabel="Copy your invite link"
                        >
                            <Text style={styles.codeText}>{code ?? '········'}</Text>
                            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color={copied ? GOLD : MUTED} />
                        </Pressable>
                        <Pressable
                            style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.85 }]}
                            onPress={handleShare}
                            accessibilityRole="button"
                            accessibilityLabel="Share your invite link"
                        >
                            <Ionicons name="share-outline" size={14} color="#0a0a0a" />
                            <Text style={styles.shareBtnText}>Share</Text>
                        </Pressable>
                        <Pressable
                            style={({ pressed }) => [styles.qrBtn, pressed && { opacity: 0.7 }]}
                            onPress={() => router.push('/my-qr')}
                            accessibilityRole="button"
                            accessibilityLabel="Show your QR code"
                        >
                            <Ionicons name="qr-code-outline" size={16} color={DIM} />
                        </Pressable>
                    </View>

                    {/* Progress */}
                    {(invites?.total ?? 0) > 0 && (
                        <View style={styles.progressBlock}>
                            <View style={styles.progressRow}>
                                <Text style={styles.progressCount}>
                                    {milestonePaid
                                        ? `${convertedForEvent} converted`
                                        : `${convertedForEvent} of ${milestoneN} converted`}
                                </Text>
                                {milestonePaid && (
                                    <View style={styles.milestoneChip}>
                                        <Ionicons name="trophy" size={10} color={GOLD} />
                                        <Text style={styles.milestoneChipText}>MILESTONE EARNED</Text>
                                    </View>
                                )}
                            </View>
                            {milestoneN > 0 && !milestonePaid && (
                                <View style={styles.progressTrack}>
                                    <View style={[styles.progressFill,
                                        { width: `${Math.min(100, (convertedForEvent / milestoneN) * 100)}%` }]} />
                                </View>
                            )}
                            {pendingNames.length > 0 && (
                                <Text style={styles.pendingLine}>
                                    {firstNames(pendingNames)} still {pendingNames.length === 1 ? 'needs' : 'need'} their
                                    first verified workout
                                </Text>
                            )}
                        </View>
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 14, marginTop: 8,
        borderRadius: 18,
        backgroundColor: CARD_BG,
        borderWidth: 1, borderColor: 'rgba(232,210,0,0.22)',
        paddingHorizontal: 18, paddingVertical: 16,
        gap: 4,
    },
    eyebrow: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.6, letterSpacing: 2.5 },
    name: { fontSize: 24, fontWeight: '200', color: TEXT, letterSpacing: -0.5 },
    dates: { fontSize: 12, fontWeight: '300', color: DIM },
    statusLine: { fontSize: 11, fontWeight: '400', color: GOLD, marginTop: 4 },

    prizeBlock: { marginTop: 10, gap: 5 },
    prizeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    prizeRank: { width: 30, fontSize: 9, fontWeight: '700', color: GOLD, opacity: 0.7, letterSpacing: 1 },
    prizeLabel: { flex: 1, fontSize: 12, fontWeight: '300', color: DIM },

    joinBtn: {
        marginTop: 12, borderRadius: 100,
        backgroundColor: GOLD, paddingVertical: 11, alignItems: 'center',
    },
    joinBtnText: { fontSize: 11, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },
    joinedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
    joinedText: { fontSize: 11, fontWeight: '300', color: GREEN, flex: 1 },

    inviteBlock: { marginTop: 12 },
    divider: { height: 1, backgroundColor: BORDER, marginBottom: 12 },
    inviteTitle: { fontSize: 8, fontWeight: '800', color: TEXT, opacity: 0.5, letterSpacing: 2.5 },
    inviteExplainer: { fontSize: 11, fontWeight: '300', color: DIM, lineHeight: 16, marginTop: 6 },

    codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
    codeChip: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        borderRadius: 10, borderWidth: 1, borderColor: BORDER,
        backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 12, paddingVertical: 9,
    },
    codeText: { fontSize: 14, fontWeight: '600', color: TEXT, letterSpacing: 2 },
    shareBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: GOLD, borderRadius: 100, paddingHorizontal: 16, paddingVertical: 9,
    },
    shareBtnText: { fontSize: 12, fontWeight: '700', color: '#0a0a0a' },
    qrBtn: {
        width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: BORDER, backgroundColor: 'rgba(0,0,0,0.25)',
    },

    progressBlock: { marginTop: 12, gap: 6 },
    progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    progressCount: { fontSize: 12, fontWeight: '500', color: TEXT },
    progressTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 2, backgroundColor: GOLD },
    milestoneChip: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        borderRadius: 100, paddingHorizontal: 8, paddingVertical: 3,
        backgroundColor: 'rgba(232,210,0,0.1)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.3)',
    },
    milestoneChipText: { fontSize: 7, fontWeight: '800', color: GOLD, letterSpacing: 1.5 },
    pendingLine: { fontSize: 11, fontWeight: '300', color: MUTED, lineHeight: 15 },
});

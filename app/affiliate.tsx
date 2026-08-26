import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import {
    affiliateLink,
    affiliateShareText,
    fetchAffiliateOverview,
    ladderPosition,
    openAffiliatePortal,
    stepName,
} from '@/lib/api/affiliate';
import { rewardLogoUri } from '@/lib/storageImage';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.5)';
const MUTED = 'rgba(255,255,255,0.3)';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';

/**
 * The in-app affiliate home (Jamie, 2026-08-26: "app AND web"). The phone
 * version does the 30-second jobs — copy the code, share the link, see the
 * numbers, see what's next — and hands off to the web portal, already signed
 * in, for the desk work (QR download, full tables, shipping address).
 */
export default function AffiliateScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [copied, setCopied] = useState(false);
    const [opening, setOpening] = useState(false);

    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: ['affiliate', 'overview', 30],
        queryFn: () => fetchAffiliateOverview(30),
        staleTime: 60_000,
    });

    const copyCode = async () => {
        if (!data) return;
        await Clipboard.setStringAsync(data.profile.code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
    };

    const share = async () => {
        if (!data) return;
        try {
            await Share.share({ message: affiliateShareText(data.profile.code, data.profile.handle) });
        } catch { /* dismissed */ }
    };

    const openPortal = async (path = '') => {
        setOpening(true);
        try { await openAffiliatePortal(path); } finally { setOpening(false); }
    };

    const pos = data ? ladderPosition(data) : null;
    const next = pos?.next ?? null;
    const nextImage = next?.creator_rewards?.image_url ? rewardLogoUri(next.creator_rewards.image_url) : null;

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <GeometricBackground />
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
                    <Ionicons name="chevron-back" size={22} color={DIM} />
                </Pressable>
                <Text style={styles.headerTitle}>Affiliate</Text>
                <View style={styles.headerAction}>
                    <Pressable onPress={() => openPortal()} hitSlop={8} accessibilityLabel="Open the full portal" disabled={opening}>
                        {opening ? <ActivityIndicator color={GOLD} size="small" /> : <Ionicons name="open-outline" size={20} color={DIM} />}
                    </Pressable>
                </View>
            </View>

            {isLoading ? (
                <View style={styles.center}><ActivityIndicator color={GOLD} /></View>
            ) : isError ? (
                <View style={styles.center}>
                    <Text style={styles.body}>Couldn’t load your affiliate numbers.</Text>
                    <Pressable onPress={() => refetch()} style={styles.ghostBtn}><Text style={styles.ghostBtnText}>TRY AGAIN</Text></Pressable>
                </View>
            ) : !data ? (
                <View style={styles.center}>
                    <Ionicons name="sparkles-outline" size={28} color={GOLD} style={{ marginBottom: 12 }} />
                    <Text style={styles.title}>Not on the programme yet</Text>
                    <Text style={styles.body}>The affiliate programme is invite-only. If you’ve been told you’re in, make sure you’re signed in with the same account.</Text>
                </View>
            ) : (
                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
                    {data.profile.status !== 'active' && (
                        <View style={styles.pausedNote}>
                            <Text style={styles.pausedLabel}>{data.profile.status.toUpperCase()}</Text>
                            <Text style={styles.pausedBody}>Your link still works, but new signups aren’t earning right now. Get in touch and we’ll sort it.</Text>
                        </View>
                    )}

                    {/* Code hero — the product. */}
                    <View style={[styles.card, styles.codeCard]}>
                        <View style={styles.codeGlow} pointerEvents="none" />
                        <Text style={styles.eyebrow}>YOUR CODE</Text>
                        <Pressable onPress={copyCode} accessibilityRole="button" accessibilityLabel="Copy your code">
                            <Text style={styles.code}>{data.profile.code}</Text>
                            <View style={styles.copyRow}>
                                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color={copied ? GOLD : MUTED} />
                                <Text style={[styles.copyText, copied && { color: GOLD }]}>{copied ? 'COPIED' : 'TAP TO COPY'}</Text>
                            </View>
                        </Pressable>
                        <Text style={styles.link}>{affiliateLink(data.profile.handle).replace('https://', '')}</Text>
                        <Pressable onPress={share} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                            <Ionicons name="share-outline" size={16} color="#080808" />
                            <Text style={styles.ctaText}>SHARE YOUR LINK</Text>
                        </Pressable>
                        <Text style={styles.foot}>Say the code out loud in videos — on iPhone the App Store can’t carry it through an install.</Text>
                    </View>

                    {/* Next up */}
                    {pos && data.steps.length > 0 && (
                        <View style={[styles.card, styles.nextCard]}>
                            <View style={styles.nextRow}>
                                {nextImage ? (
                                    <Image source={{ uri: nextImage }} style={styles.nextImage} />
                                ) : (
                                    <View style={[styles.nextImage, styles.nextImageFallback]}>
                                        <Ionicons name={next ? 'gift-outline' : 'trophy-outline'} size={22} color={GOLD} />
                                    </View>
                                )}
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text style={styles.eyebrowGold}>{next ? 'NEXT UP' : 'EVERY STEP REACHED'}</Text>
                                    <Text style={styles.nextTitle} numberOfLines={2}>{next ? stepName(next) : 'You’ve cleared the ladder.'}</Text>
                                    <Text style={styles.nextSub}>
                                        {next
                                            ? `${pos.remaining} more ${pos.remaining === 1 ? pos.basisWord.replace(/s$/, '') : pos.basisWord} to unlock${next.points > 0 ? ` · +${next.points.toLocaleString()} pts` : ''}`
                                            : 'Every conversion still earns points. Keep going.'}
                                    </Text>
                                </View>
                            </View>
                            <View style={styles.barTrack}>
                                <View style={[styles.barFill, { width: `${pos.pct}%` }]} />
                            </View>
                            <View style={styles.barLabels}>
                                <Text style={styles.barLabel}>{pos.basis} {pos.basisWord}</Text>
                                {next && <Text style={[styles.barLabel, { color: GOLD }]}>{next.n}</Text>}
                            </View>
                        </View>
                    )}

                    {/* The numbers */}
                    <Text style={styles.sectionLabel}>LAST 30 DAYS</Text>
                    <View style={styles.grid}>
                        <Stat icon="finger-print-outline" label="LINK TAPS" value={data.funnel?.clicks ?? 0} />
                        <Stat icon="person-add-outline" label="SIGNUPS" value={data.funnel?.signups ?? 0} />
                        <Stat icon="checkmark-circle-outline" label="CONVERTED" value={data.funnel?.converted ?? 0} accent />
                        <Stat icon="diamond-outline" label="POINTS" value={data.funnel?.points_earned ?? 0} accent hint="all time" />
                    </View>

                    {/* Ladder, compact */}
                    {pos && data.steps.length > 0 && (
                        <>
                            <Text style={styles.sectionLabel}>THE LADDER</Text>
                            <View style={styles.card}>
                                {data.steps.map((s, i) => {
                                    const hit = data.reachedStepIds.includes(s.id);
                                    const isNext = next?.id === s.id;
                                    return (
                                        <View key={s.id} style={[styles.rung, i < data.steps.length - 1 && styles.rungBorder]}>
                                            <View style={[styles.rungDot, hit && styles.rungDotHit, isNext && styles.rungDotNext]}>
                                                {hit ? <Ionicons name="checkmark" size={12} color="#080808" /> : isNext ? <View style={styles.rungDotInner} /> : <Ionicons name="lock-closed" size={10} color={MUTED} />}
                                            </View>
                                            <View style={{ flex: 1, minWidth: 0 }}>
                                                <Text style={[styles.rungName, !hit && !isNext && { color: DIM }]} numberOfLines={1}>{stepName(s)}</Text>
                                                <Text style={styles.rungMeta}>
                                                    {s.n} {pos.basisWord}{s.creator_rewards?.value_label ? ` · ${s.creator_rewards.value_label}` : ''}{s.points > 0 ? ` · +${s.points.toLocaleString()} pts` : ''}
                                                </Text>
                                            </View>
                                            {hit && <Text style={styles.reached}>REACHED</Text>}
                                            {isNext && <Text style={styles.here}>YOU’RE HERE</Text>}
                                        </View>
                                    );
                                })}
                            </View>
                        </>
                    )}

                    {/* The desk */}
                    <Pressable onPress={() => openPortal()} disabled={opening} style={({ pressed }) => [styles.card, styles.portalCard, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                        <View style={{ flex: 1 }}>
                            <Text style={styles.portalTitle}>Open the full portal</Text>
                            <Text style={styles.portalSub}>Daily taps, every signup, your QR code, rewards ledger and shipping address — on the web, and you’re already signed in.</Text>
                        </View>
                        {opening ? <ActivityIndicator color={GOLD} /> : <Ionicons name="arrow-forward" size={18} color={GOLD} />}
                    </Pressable>
                </ScrollView>
            )}
        </View>
    );
}

function Stat({ icon, label, value, accent, hint }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: number; accent?: boolean; hint?: string }) {
    return (
        <View style={[styles.card, styles.stat]}>
            <View style={styles.statHead}>
                <Ionicons name={icon} size={13} color={accent ? GOLD : MUTED} />
                <Text style={styles.statLabel}>{label}</Text>
            </View>
            <Text style={[styles.statValue, !accent && { color: DIM }]}>{value.toLocaleString()}</Text>
            {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#0d0d0d' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
    backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '400', letterSpacing: 0.5, color: TEXT },
    headerAction: { minWidth: 36, alignItems: 'flex-end', justifyContent: 'center' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    content: { paddingHorizontal: 16, paddingTop: 4 },

    title: { fontSize: 20, fontWeight: '300', color: TEXT, textAlign: 'center', marginBottom: 8 },
    body: { fontSize: 13, fontWeight: '300', lineHeight: 19, color: DIM, textAlign: 'center' },
    ghostBtn: { marginTop: 16, height: 40, paddingHorizontal: 18, borderRadius: 20, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
    ghostBtnText: { fontSize: 10, fontWeight: '800', letterSpacing: 2, color: DIM },

    card: { backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: 16, marginBottom: 12, overflow: 'hidden' },
    eyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 2.5, color: MUTED, marginBottom: 10 },
    eyebrowGold: { fontSize: 9, fontWeight: '800', letterSpacing: 2.5, color: GOLD, marginBottom: 6 },
    sectionLabel: { fontSize: 9, fontWeight: '500', letterSpacing: 2, color: MUTED, paddingHorizontal: 4, marginTop: 8, marginBottom: 10 },

    pausedNote: { backgroundColor: 'rgba(251,191,36,0.06)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)', borderRadius: 14, padding: 14, marginBottom: 12 },
    pausedLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 2.5, color: '#fbbf24', marginBottom: 4 },
    pausedBody: { fontSize: 12, fontWeight: '300', lineHeight: 17, color: DIM },

    codeCard: { borderColor: 'rgba(232,210,0,0.35)', backgroundColor: '#111' },
    codeGlow: { position: 'absolute', top: -90, right: -90, width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(232,210,0,0.10)' },
    code: { fontSize: 40, fontWeight: '900', letterSpacing: 5, color: TEXT, marginBottom: 8 },
    copyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
    copyText: { fontSize: 9, fontWeight: '800', letterSpacing: 2.5, color: MUTED },
    link: { fontSize: 12, color: DIM, fontVariant: ['tabular-nums'], marginBottom: 14 },
    cta: { height: 46, borderRadius: 23, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
    ctaText: { fontSize: 11, fontWeight: '800', letterSpacing: 2, color: '#080808' },
    foot: { fontSize: 11, fontWeight: '300', lineHeight: 16, color: MUTED, marginTop: 12 },

    nextCard: { borderColor: 'rgba(232,210,0,0.3)' },
    nextRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
    nextImage: { width: 64, height: 64, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(232,210,0,0.3)' },
    nextImageFallback: { backgroundColor: 'rgba(232,210,0,0.1)', alignItems: 'center', justifyContent: 'center' },
    nextTitle: { fontSize: 22, fontWeight: '300', letterSpacing: -0.4, color: TEXT, marginBottom: 4 },
    nextSub: { fontSize: 12, fontWeight: '300', color: DIM, lineHeight: 17 },
    barTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: 4, backgroundColor: GOLD },
    barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
    barLabel: { fontSize: 10, fontWeight: '700', color: MUTED, fontVariant: ['tabular-nums'] },

    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
    stat: { width: '48%', flexGrow: 1, marginBottom: 0, padding: 14 },
    statHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    statLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 2, color: MUTED },
    statValue: { fontSize: 28, fontWeight: '300', letterSpacing: -0.5, color: TEXT, fontVariant: ['tabular-nums'] },
    statHint: { fontSize: 10, color: MUTED, marginTop: 2 },

    rung: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    rungBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
    rungDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)' },
    rungDotHit: { backgroundColor: GOLD, borderColor: GOLD },
    rungDotNext: { borderColor: GOLD },
    rungDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD },
    rungName: { fontSize: 14, fontWeight: '500', color: TEXT },
    rungMeta: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: MUTED, marginTop: 2 },
    reached: { fontSize: 8, fontWeight: '800', letterSpacing: 2, color: GOLD },
    here: { fontSize: 8, fontWeight: '800', letterSpacing: 2, color: DIM },

    portalCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderColor: 'rgba(232,210,0,0.25)' },
    portalTitle: { fontSize: 15, fontWeight: '500', color: TEXT, marginBottom: 4 },
    portalSub: { fontSize: 12, fontWeight: '300', lineHeight: 17, color: DIM },
});

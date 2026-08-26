import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Easing,
    Image,
    Pressable,
    RefreshControl,
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
    FULFILMENT_LABEL,
    isAffiliateReady,
    ladderPosition,
    markAffiliateShared,
    openAffiliatePortal,
    readinessSteps,
    stepName,
    type AffiliateOverview,
    type AffiliateStep,
    type LadderPosition,
    type ReadinessStep,
} from '@/lib/api/affiliate';
import { rewardLogoUri } from '@/lib/storageImage';

const GOLD = '#E8D200';
const GOLD_DEEP = '#B8A600';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';
const MUTED = 'rgba(255,255,255,0.3)';
const FAINT = 'rgba(255,255,255,0.12)';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER = 'rgba(255,255,255,0.08)';
const QUERY_KEY = ['affiliate', 'overview', 'v2', 30] as const;

/**
 * The in-app affiliate home (Jamie, 2026-08-26: "app AND web"). The phone
 * does the 30-second jobs — copy the code, share the link, see the numbers,
 * see what's next — and hands off to the web portal, already signed in, for
 * the desk work (QR download, full tables, shipping address).
 *
 * Readiness: the ONLY hard gate is the programme terms. Until they're
 * accepted the code is shown but sharing is locked; photo/bio and the first
 * share are nudges. Address is asked for at the moment a parcel is owed.
 */
export default function AffiliateScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const qc = useQueryClient();
    const [copied, setCopied] = useState(false);
    const [opening, setOpening] = useState(false);

    const { data, isLoading, isError, refetch, isRefetching } = useQuery({
        queryKey: QUERY_KEY,
        queryFn: () => fetchAffiliateOverview(30),
        staleTime: 60_000,
    });

    const shared = useMutation({
        mutationFn: markAffiliateShared,
        onSettled: () => qc.invalidateQueries({ queryKey: ['affiliate'] }),
    });

    const ready = data ? isAffiliateReady(data.profile) : false;

    const copyCode = async () => {
        if (!data) return;
        await Clipboard.setStringAsync(data.profile.code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
    };

    const share = async () => {
        if (!data || !ready) return;
        try {
            const res = await Share.share({ message: affiliateShareText(data.profile.code, data.profile.handle) });
            // iOS reports the sheet outcome; Android always says 'sharedAction'.
            // Either way "they opened the share sheet and didn't cancel" is the
            // first-share moment we're after.
            if (res.action === Share.sharedAction && !data.profile.first_shared_at) shared.mutate();
        } catch { /* dismissed */ }
    };

    const openPortal = async (path = '') => {
        setOpening(true);
        try { await openAffiliatePortal(path); } finally { setOpening(false); }
    };

    const pos = data ? ladderPosition(data) : null;

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <GeometricBackground />
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
                    <Ionicons name="chevron-back" size={22} color={DIM} />
                </Pressable>
                <Text style={styles.headerTitle}>Affiliate</Text>
                <View style={styles.headerAction}>
                    <Pressable onPress={() => openPortal()} hitSlop={8} accessibilityLabel="Open the full portal" disabled={opening || !data}>
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
            ) : !data || !pos ? (
                <View style={styles.center}>
                    <Ionicons name="sparkles-outline" size={28} color={GOLD} style={{ marginBottom: 12 }} />
                    <Text style={styles.title}>Not on the programme yet</Text>
                    <Text style={styles.body}>The affiliate programme is invite-only. If you’ve been told you’re in, make sure you’re signed in with the same account.</Text>
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={GOLD} />}
                >
                    <Identity data={data} />

                    {data.profile.status !== 'active' && (
                        <View style={styles.pausedNote}>
                            <Text style={styles.pausedLabel}>{data.profile.status.toUpperCase()}</Text>
                            <Text style={styles.pausedBody}>Your link still works, but new signups aren’t earning right now. Get in touch and we’ll sort it.</Text>
                        </View>
                    )}

                    <Readiness steps={readinessSteps(data.profile)} onTerms={() => router.push('/affiliate-terms?accept=1')} onProfile={() => router.push('/affiliate-profile')} onShare={share} />

                    <CodeHero data={data} ready={ready} copied={copied} onCopy={copyCode} onShare={share} onTerms={() => router.push('/affiliate-terms?accept=1')} />

                    {data.steps.length > 0 && <NextUp pos={pos} />}

                    <Text style={styles.sectionLabel}>LAST 30 DAYS</Text>
                    <View style={styles.grid}>
                        <Stat icon="finger-print-outline" label="LINK TAPS" value={data.funnel?.clicks ?? 0} />
                        <Stat icon="person-add-outline" label="SIGNUPS" value={data.funnel?.signups ?? 0} />
                        <Stat icon="checkmark-circle-outline" label="CONVERTED" value={data.funnel?.converted ?? 0} accent />
                        <Stat icon="diamond-outline" label="POINTS" value={data.funnel?.points_earned ?? 0} accent hint="all time" />
                    </View>

                    {data.steps.length > 0 && (
                        <>
                            <View style={styles.sectionRow}>
                                <Text style={styles.sectionLabel}>THE LADDER</Text>
                                <Text style={styles.sectionMeta}>{pos.basis} {pos.basisWord.toUpperCase()}</Text>
                            </View>
                            <Ladder data={data} pos={pos} onAddress={() => openPortal('/settings')} />
                        </>
                    )}

                    {data.earnings.length > 0 && (
                        <>
                            <Text style={styles.sectionLabel}>RECENT EARNINGS</Text>
                            <View style={styles.card}>
                                {data.earnings.map((e, i) => (
                                    <View key={e.id} style={[styles.earnRow, i < data.earnings.length - 1 && styles.earnBorder]}>
                                        <View style={[styles.earnIcon, e.kind === 'milestone' && styles.earnIconMilestone]}>
                                            <Ionicons name={e.kind === 'milestone' ? 'trophy' : e.kind === 'signup' ? 'person-add' : 'flash'} size={12} color={e.kind === 'milestone' ? '#080808' : GOLD} />
                                        </View>
                                        <View style={{ flex: 1, minWidth: 0 }}>
                                            <Text style={styles.earnNote} numberOfLines={1}>{e.note ?? e.kind}</Text>
                                            <Text style={styles.earnDate}>{fmtDate(e.created_at)}</Text>
                                        </View>
                                        <Text style={styles.earnPts}>+{e.points_amount.toLocaleString()}</Text>
                                    </View>
                                ))}
                            </View>
                        </>
                    )}

                    <Pressable onPress={() => openPortal()} disabled={opening} style={({ pressed }) => [styles.card, styles.portalCard, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                        <View style={styles.portalIcon}><Ionicons name="desktop-outline" size={18} color={GOLD} /></View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.portalTitle}>Open the full portal</Text>
                            <Text style={styles.portalSub}>Daily taps, every signup, your QR code, the rewards ledger and your delivery address — and you’re already signed in.</Text>
                        </View>
                        {opening ? <ActivityIndicator color={GOLD} /> : <Ionicons name="arrow-forward" size={18} color={GOLD} />}
                    </Pressable>
                </ScrollView>
            )}
        </View>
    );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Identity({ data }: { data: AffiliateOverview }) {
    const p = data.profile;
    return (
        <View style={styles.identity}>
            {p.avatar_url ? <Image source={{ uri: p.avatar_url }} style={styles.identityAvatar} /> : (
                <View style={[styles.identityAvatar, styles.identityAvatarEmpty]}><Text style={styles.identityInitial}>{(p.display_name || '?')[0]}</Text></View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.identityName} numberOfLines={1}>{p.display_name}</Text>
                <Text style={styles.identityHandle} numberOfLines={1}>{affiliateLink(p.handle).replace('https://', '')}</Text>
            </View>
            <View style={[styles.statusDot, p.status !== 'active' && { backgroundColor: '#fbbf24', shadowColor: '#fbbf24' }]} />
        </View>
    );
}

const READY_COPY: Record<ReadinessStep['key'], { title: string; sub: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
    terms: { title: 'Accept the affiliate terms', sub: 'Fair play and how to label your posts. Two minutes.', icon: 'document-text-outline' },
    profile: { title: 'Add a photo and a line about you', sub: 'It’s what people see when they tap your link.', icon: 'person-circle-outline' },
    share: { title: 'Share your link once', sub: 'Story, bio, group chat — anywhere counts.', icon: 'share-social-outline' },
};

function Readiness({ steps, onTerms, onProfile, onShare }: { steps: ReadinessStep[]; onTerms: () => void; onProfile: () => void; onShare: () => void }) {
    const remaining = steps.filter((s) => !s.done);
    if (remaining.length === 0) return null;
    const termsDone = steps.find((s) => s.key === 'terms')?.done;
    const done = steps.length - remaining.length;
    return (
        <View style={[styles.card, styles.readyCard]}>
            <LinearGradient colors={['rgba(232,210,0,0.14)', 'rgba(232,210,0,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
            <View style={styles.readyHead}>
                <Text style={styles.eyebrowGold}>GET AFFILIATE-READY</Text>
                <Text style={styles.readyCount}>{done}/{steps.length}</Text>
            </View>
            {steps.map((s) => {
                const c = READY_COPY[s.key];
                const locked = s.key === 'share' && !termsDone;
                const onPress = s.key === 'terms' ? onTerms : s.key === 'profile' ? onProfile : onShare;
                return (
                    <Pressable key={s.key} onPress={onPress} disabled={s.done || locked} style={({ pressed }) => [styles.readyRow, pressed && { opacity: 0.8 }]} accessibilityRole="button">
                        <View style={[styles.readyTick, s.done && styles.readyTickDone]}>
                            {s.done ? <Ionicons name="checkmark" size={13} color="#080808" /> : <Ionicons name={c.icon} size={14} color={locked ? MUTED : GOLD} />}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[styles.readyTitle, s.done && styles.readyTitleDone, locked && { color: MUTED }]}>{c.title}{s.required && !s.done ? ' · required' : ''}</Text>
                            {!s.done && <Text style={styles.readySub}>{locked ? 'Accept the terms first.' : c.sub}</Text>}
                        </View>
                        {!s.done && !locked && <Ionicons name="chevron-forward" size={16} color={MUTED} />}
                    </Pressable>
                );
            })}
        </View>
    );
}

function CodeHero({ data, ready, copied, onCopy, onShare, onTerms }: { data: AffiliateOverview; ready: boolean; copied: boolean; onCopy: () => void; onShare: () => void; onTerms: () => void }) {
    return (
        <View style={[styles.card, styles.codeCard]}>
            <LinearGradient colors={['#151513', '#0c0c0c']} style={StyleSheet.absoluteFill} pointerEvents="none" />
            <View style={styles.codeGlow} pointerEvents="none" />
            <Text style={styles.eyebrowGold}>YOUR CODE</Text>
            <Pressable onPress={onCopy} accessibilityRole="button" accessibilityLabel="Copy your code">
                <Text style={styles.code}>{data.profile.code}</Text>
                <View style={styles.copyRow}>
                    <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color={copied ? GOLD : MUTED} />
                    <Text style={[styles.copyText, copied && { color: GOLD }]}>{copied ? 'COPIED' : 'TAP TO COPY'}</Text>
                </View>
            </Pressable>
            {ready ? (
                <View style={styles.ctaRow}>
                    <Pressable onPress={onShare} style={({ pressed }) => [styles.cta, { flex: 1 }, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                        <Ionicons name="share-outline" size={16} color="#080808" />
                        <Text style={styles.ctaText}>SHARE YOUR LINK</Text>
                    </Pressable>
                    <Pressable onPress={onCopy} style={({ pressed }) => [styles.ctaGhost, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="Copy code">
                        <Ionicons name="copy-outline" size={16} color={GOLD} />
                    </Pressable>
                </View>
            ) : (
                <Pressable onPress={onTerms} style={({ pressed }) => [styles.lockedCta, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                    <Ionicons name="lock-closed" size={14} color={GOLD} />
                    <Text style={styles.lockedCtaText}>ACCEPT THE TERMS TO START SHARING</Text>
                </Pressable>
            )}
            <Text style={styles.foot}>Say the code out loud in videos — on iPhone the App Store can’t carry it through an install.</Text>
        </View>
    );
}

function NextUp({ pos }: { pos: LadderPosition }) {
    const next = pos.next;
    const img = next?.creator_rewards?.image_url ? rewardLogoUri(next.creator_rewards.image_url) : null;
    const width = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(width, { toValue: pos.pct, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }, [pos.pct, width]);

    return (
        <View style={[styles.card, styles.nextCard]}>
            <LinearGradient colors={['rgba(232,210,0,0.16)', 'rgba(232,210,0,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
            <View style={styles.nextRow}>
                <View style={styles.nextImageWrap}>
                    <View style={styles.nextImageGlow} pointerEvents="none" />
                    {img ? <Image source={{ uri: img }} style={styles.nextImage} /> : (
                        <View style={[styles.nextImage, styles.nextImageFallback]}><Ionicons name={next ? 'gift' : 'trophy'} size={28} color={GOLD} /></View>
                    )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.eyebrowGold}>{next ? 'NEXT UP' : 'EVERY STEP REACHED'}</Text>
                    <Text style={styles.nextTitle} numberOfLines={2}>{next ? stepName(next) : 'You’ve cleared the ladder.'}</Text>
                    {next ? (
                        <View style={styles.nextCountRow}>
                            <Text style={styles.nextCount}>{pos.remaining}</Text>
                            <Text style={styles.nextCountLabel}>more {pos.remaining === 1 ? pos.basisWord.replace(/s$/, '') : pos.basisWord}{next.creator_rewards?.value_label ? ` · worth ${next.creator_rewards.value_label.replace(/^worth\s+/i, '')}` : ''}</Text>
                        </View>
                    ) : (
                        <Text style={styles.nextSub}>Every conversion still earns points. Keep going.</Text>
                    )}
                </View>
            </View>
            <View style={styles.barTrack}>
                <Animated.View style={[styles.barFillWrap, { width: width.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]}>
                    <LinearGradient colors={[GOLD_DEEP, GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.barFill} />
                </Animated.View>
            </View>
            <View style={styles.barLabels}>
                <Text style={styles.barLabel}>{pos.basis} {pos.basisWord}</Text>
                {next && <Text style={[styles.barLabel, { color: GOLD }]}>{next.n}{next.points > 0 ? ` · +${next.points.toLocaleString()} pts` : ''}</Text>}
            </View>
        </View>
    );
}

function Ladder({ data, pos, onAddress }: { data: AffiliateOverview; pos: LadderPosition; onAddress: () => void }) {
    return (
        <View style={styles.ladder}>
            {data.steps.map((s, i) => {
                const milestone = (data.milestones ?? []).find((m) => m.step_id === s.id) ?? null;
                const hit = !!milestone;
                const isNext = pos.next?.id === s.id;
                const last = i === data.steps.length - 1;
                // The rail: gold up to the current rung, the current segment
                // fills with progress, everything below is faint.
                const railAbove = i === 0 ? 'none' : hit || isNext ? 'gold' : 'faint';
                const railBelow = last ? 'none' : hit ? 'gold' : isNext ? 'partial' : 'faint';
                return (
                    <Rung
                        key={s.id}
                        step={s}
                        hit={hit}
                        isNext={isNext}
                        locked={!hit && !isNext}
                        railAbove={railAbove}
                        railBelow={railBelow}
                        pct={isNext ? pos.pct : hit ? 100 : 0}
                        basis={pos.basis}
                        basisWord={pos.basisWord}
                        parcel={milestone ? FULFILMENT_LABEL[milestone.fulfilment_status] : null}
                        tracking={milestone?.tracking_number ? `${milestone.carrier ? `${milestone.carrier} ` : ''}${milestone.tracking_number}` : null}
                        needsAddress={milestone?.fulfilment_status === 'owed' && !data.profile.shipping_address}
                        onAddress={onAddress}
                    />
                );
            })}
        </View>
    );
}

type Rail = 'none' | 'gold' | 'partial' | 'faint';

function Rung({ step, hit, isNext, locked, railAbove, railBelow, pct, basis, basisWord, parcel, tracking, needsAddress, onAddress }: {
    step: AffiliateStep; hit: boolean; isNext: boolean; locked: boolean; railAbove: Rail; railBelow: Rail; pct: number;
    basis: number; basisWord: string; parcel: string | null; tracking: string | null; needsAddress: boolean; onAddress: () => void;
}) {
    const img = step.creator_rewards?.image_url ? rewardLogoUri(step.creator_rewards.image_url) : null;
    const pulse = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (!isNext) return;
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, [isNext, pulse]);

    const railColor = (r: Rail) => r === 'gold' ? GOLD : r === 'faint' ? FAINT : 'transparent';

    return (
        <View style={styles.rung}>
            {/* Rail column */}
            <View style={styles.railCol}>
                <View style={[styles.railSeg, { backgroundColor: railColor(railAbove) }]} />
                <View style={styles.nodeWrap}>
                    {isNext && (
                        <Animated.View style={[styles.nodeHalo, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.5] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }] }]} />
                    )}
                    <View style={[styles.node, hit && styles.nodeHit, isNext && styles.nodeNext, locked && styles.nodeLocked]}>
                        {hit ? <Ionicons name="checkmark" size={13} color="#080808" /> : isNext ? <View style={styles.nodeCore} /> : <Ionicons name="lock-closed" size={9} color={MUTED} />}
                    </View>
                </View>
                <View style={[styles.railSeg, { backgroundColor: railColor(railBelow) }]}>
                    {railBelow === 'partial' && <View style={[styles.railPartial, { height: `${Math.max(6, pct)}%` }]} />}
                </View>
            </View>

            {/* Card */}
            <View style={[styles.rungCard, hit && styles.rungCardHit, isNext && styles.rungCardNext, locked && styles.rungCardLocked]}>
                {hit && <LinearGradient colors={['rgba(232,210,0,0.14)', 'rgba(232,210,0,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />}
                <View style={styles.rungTop}>
                    <View style={[styles.rungImageWrap, hit && styles.rungImageWrapHit, isNext && styles.rungImageWrapNext]}>
                        {img ? <Image source={{ uri: img }} style={[styles.rungImage, locked && { opacity: 0.45 }]} /> : (
                            <View style={[styles.rungImage, styles.rungImageFallback]}><Ionicons name={step.creator_rewards ? 'gift-outline' : 'diamond-outline'} size={20} color={locked ? MUTED : GOLD} /></View>
                        )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={styles.rungTitleRow}>
                            <Text style={[styles.rungName, locked && { color: DIM }]} numberOfLines={1}>{stepName(step)}</Text>
                            {hit && <View style={styles.chipGold}><Text style={styles.chipGoldText}>REACHED</Text></View>}
                            {isNext && <View style={styles.chipOutline}><Text style={styles.chipOutlineText}>YOU’RE HERE</Text></View>}
                        </View>
                        <Text style={styles.rungMeta}>{step.n} {basisWord.toUpperCase()}{step.creator_rewards?.value_label ? ` · ${step.creator_rewards.value_label.toUpperCase()}` : ''}</Text>
                        {step.creator_rewards?.description && !locked ? <Text style={styles.rungDesc} numberOfLines={2}>{step.creator_rewards.description}</Text> : null}
                    </View>
                    {step.points > 0 && (
                        <View style={[styles.ptsPill, locked && styles.ptsPillLocked]}>
                            <Text style={[styles.ptsPillText, locked && { color: MUTED }]}>+{step.points.toLocaleString()}</Text>
                            <Text style={[styles.ptsPillUnit, locked && { color: MUTED }]}>PTS</Text>
                        </View>
                    )}
                </View>

                {isNext && (
                    <View style={styles.rungProgress}>
                        <View style={styles.miniTrack}><LinearGradient colors={[GOLD_DEEP, GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.miniFill, { width: `${Math.max(2, pct)}%` }]} /></View>
                        <Text style={styles.miniLabel}>{basis} of {step.n} · {step.n - basis} to go</Text>
                    </View>
                )}
                {parcel && (
                    <View style={styles.parcelRow}>
                        <Ionicons name="cube-outline" size={12} color={GOLD} />
                        <Text style={styles.parcelText}>{parcel.toUpperCase()}</Text>
                        {tracking ? <Text style={styles.parcelTracking}>{tracking}</Text> : null}
                    </View>
                )}
                {needsAddress && (
                    <Pressable onPress={onAddress} hitSlop={6} style={styles.addressRow} accessibilityRole="button">
                        <Ionicons name="location-outline" size={12} color="#fbbf24" />
                        <Text style={styles.addressText}>Add your address so we can send this</Text>
                        <Ionicons name="open-outline" size={11} color="#fbbf24" />
                    </Pressable>
                )}
            </View>
        </View>
    );
}

function Stat({ icon, label, value, accent, hint }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: number; accent?: boolean; hint?: string }) {
    return (
        <View style={[styles.card, styles.stat]}>
            <View style={styles.statHead}>
                <View style={[styles.statIcon, accent && styles.statIconAccent]}><Ionicons name={icon} size={12} color={accent ? '#080808' : GOLD} /></View>
                <Text style={styles.statLabel}>{label}</Text>
            </View>
            <Text style={[styles.statValue, !accent && { color: DIM }]}>{value.toLocaleString()}</Text>
            {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
        </View>
    );
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Styles ──────────────────────────────────────────────────────────────────

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

    card: { backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 16, marginBottom: 12, overflow: 'hidden' },
    eyebrowGold: { fontSize: 9, fontWeight: '800', letterSpacing: 2.5, color: GOLD, marginBottom: 8 },
    sectionLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 2.2, color: MUTED, paddingHorizontal: 4, marginTop: 10, marginBottom: 10 },
    sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingRight: 4 },
    sectionMeta: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: GOLD, fontVariant: ['tabular-nums'] },

    identity: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingBottom: 14 },
    identityAvatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(232,210,0,0.5)' },
    identityAvatarEmpty: { backgroundColor: 'rgba(232,210,0,0.1)', alignItems: 'center', justifyContent: 'center' },
    identityInitial: { fontSize: 16, fontWeight: '800', color: GOLD },
    identityName: { fontSize: 16, fontWeight: '600', color: TEXT },
    identityHandle: { fontSize: 12, color: DIM, marginTop: 2 },
    statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD, shadowColor: GOLD, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },

    pausedNote: { backgroundColor: 'rgba(251,191,36,0.06)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)', borderRadius: 14, padding: 14, marginBottom: 12 },
    pausedLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 2.5, color: '#fbbf24', marginBottom: 4 },
    pausedBody: { fontSize: 12, fontWeight: '300', lineHeight: 17, color: DIM },

    readyCard: { borderColor: 'rgba(232,210,0,0.35)', paddingBottom: 6 },
    readyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    readyCount: { fontSize: 11, fontWeight: '800', color: GOLD, fontVariant: ['tabular-nums'] },
    readyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    readyTick: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(232,210,0,0.4)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(232,210,0,0.06)' },
    readyTickDone: { backgroundColor: GOLD, borderColor: GOLD },
    readyTitle: { fontSize: 14, fontWeight: '500', color: TEXT },
    readyTitleDone: { color: DIM, textDecorationLine: 'line-through' },
    readySub: { fontSize: 12, fontWeight: '300', color: DIM, marginTop: 2 },

    codeCard: { borderColor: 'rgba(232,210,0,0.4)', padding: 20 },
    codeGlow: { position: 'absolute', top: -110, right: -110, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(232,210,0,0.12)' },
    code: { fontSize: 42, fontWeight: '900', letterSpacing: 6, color: TEXT, marginBottom: 6, textShadowColor: 'rgba(232,210,0,0.35)', textShadowRadius: 18, textShadowOffset: { width: 0, height: 0 } },
    copyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
    copyText: { fontSize: 9, fontWeight: '800', letterSpacing: 2.5, color: MUTED },
    ctaRow: { flexDirection: 'row', gap: 10 },
    cta: { height: 48, borderRadius: 24, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, shadowColor: GOLD, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
    ctaText: { fontSize: 11, fontWeight: '800', letterSpacing: 2, color: '#080808' },
    ctaGhost: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(232,210,0,0.45)', alignItems: 'center', justifyContent: 'center' },
    lockedCta: { height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(232,210,0,0.45)', backgroundColor: 'rgba(232,210,0,0.06)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
    lockedCtaText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, color: GOLD },
    foot: { fontSize: 11, fontWeight: '300', lineHeight: 16, color: MUTED, marginTop: 14 },

    nextCard: { borderColor: 'rgba(232,210,0,0.4)', padding: 18 },
    nextRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
    nextImageWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
    nextImageGlow: { position: 'absolute', width: 84, height: 84, borderRadius: 42, backgroundColor: 'rgba(232,210,0,0.28)', transform: [{ scale: 1.25 }] },
    nextImage: { width: 80, height: 80, borderRadius: 20, borderWidth: 1.5, borderColor: 'rgba(232,210,0,0.6)' },
    nextImageFallback: { backgroundColor: 'rgba(232,210,0,0.12)', alignItems: 'center', justifyContent: 'center' },
    nextTitle: { fontSize: 24, fontWeight: '300', letterSpacing: -0.5, color: TEXT, marginBottom: 6 },
    nextCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
    nextCount: { fontSize: 30, fontWeight: '700', color: GOLD, fontVariant: ['tabular-nums'], letterSpacing: -1 },
    nextCountLabel: { fontSize: 13, fontWeight: '300', color: DIM, flexShrink: 1 },
    nextSub: { fontSize: 12, fontWeight: '300', color: DIM, lineHeight: 17 },
    barTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
    barFillWrap: { height: '100%' },
    barFill: { flex: 1, borderRadius: 5, shadowColor: GOLD, shadowOpacity: 0.8, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
    barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
    barLabel: { fontSize: 10, fontWeight: '700', color: MUTED, fontVariant: ['tabular-nums'] },

    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
    stat: { width: '48%', flexGrow: 1, marginBottom: 0, padding: 14 },
    statHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    statIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(232,210,0,0.1)', alignItems: 'center', justifyContent: 'center' },
    statIconAccent: { backgroundColor: GOLD },
    statLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 2, color: MUTED },
    statValue: { fontSize: 30, fontWeight: '300', letterSpacing: -0.6, color: TEXT, fontVariant: ['tabular-nums'] },
    statHint: { fontSize: 10, color: MUTED, marginTop: 2 },

    ladder: { marginBottom: 4 },
    rung: { flexDirection: 'row', alignItems: 'stretch' },
    railCol: { width: 34, alignItems: 'center' },
    railSeg: { width: 2, flex: 1, borderRadius: 1, overflow: 'hidden' },
    railPartial: { width: 2, backgroundColor: GOLD, borderRadius: 1 },
    nodeWrap: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
    nodeHalo: { position: 'absolute', width: 34, height: 34, borderRadius: 17, backgroundColor: GOLD },
    node: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: FAINT, backgroundColor: '#161616', alignItems: 'center', justifyContent: 'center' },
    nodeHit: { backgroundColor: GOLD, borderColor: GOLD, shadowColor: GOLD, shadowOpacity: 0.7, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
    nodeNext: { borderColor: GOLD },
    nodeLocked: {},
    nodeCore: { width: 9, height: 9, borderRadius: 5, backgroundColor: GOLD },
    rungCard: { flex: 1, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 14, marginBottom: 10, marginLeft: 6, overflow: 'hidden' },
    rungCardHit: { borderColor: 'rgba(232,210,0,0.45)' },
    rungCardNext: { borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(48,48,48,0.9)' },
    rungCardLocked: { backgroundColor: 'rgba(30,30,30,0.7)' },
    rungTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rungImageWrap: { width: 60, height: 60, borderRadius: 16, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.04)' },
    rungImageWrapHit: { borderColor: 'rgba(232,210,0,0.6)' },
    rungImageWrapNext: { borderColor: 'rgba(255,255,255,0.25)' },
    rungImage: { width: '100%', height: '100%' },
    rungImageFallback: { alignItems: 'center', justifyContent: 'center' },
    rungTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
    rungName: { fontSize: 15, fontWeight: '600', color: TEXT, flexShrink: 1 },
    rungMeta: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: MUTED },
    rungDesc: { fontSize: 12, fontWeight: '300', color: DIM, marginTop: 4, lineHeight: 16 },
    chipGold: { paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
    chipGoldText: { fontSize: 8, fontWeight: '800', letterSpacing: 1.5, color: '#080808' },
    chipOutline: { paddingHorizontal: 7, height: 18, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
    chipOutlineText: { fontSize: 8, fontWeight: '800', letterSpacing: 1.5, color: DIM },
    ptsPill: { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(232,210,0,0.1)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.3)' },
    ptsPillLocked: { backgroundColor: 'transparent', borderColor: FAINT },
    ptsPillText: { fontSize: 14, fontWeight: '800', color: GOLD, fontVariant: ['tabular-nums'] },
    ptsPillUnit: { fontSize: 8, fontWeight: '800', letterSpacing: 1.5, color: GOLD, marginTop: -1 },
    rungProgress: { marginTop: 12 },
    miniTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' },
    miniFill: { height: '100%', borderRadius: 3 },
    miniLabel: { fontSize: 10, fontWeight: '700', color: MUTED, marginTop: 6, fontVariant: ['tabular-nums'] },
    parcelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
    parcelText: { fontSize: 9, fontWeight: '800', letterSpacing: 2, color: GOLD },
    parcelTracking: { fontSize: 11, color: DIM, fontVariant: ['tabular-nums'] },
    addressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
    addressText: { fontSize: 11, fontWeight: '600', color: '#fbbf24', textDecorationLine: 'underline' },

    earnRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    earnBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
    earnIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(232,210,0,0.1)', alignItems: 'center', justifyContent: 'center' },
    earnIconMilestone: { backgroundColor: GOLD },
    earnNote: { fontSize: 13, fontWeight: '400', color: TEXT },
    earnDate: { fontSize: 10, color: MUTED, marginTop: 2 },
    earnPts: { fontSize: 15, fontWeight: '800', color: GOLD, fontVariant: ['tabular-nums'] },

    portalCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderColor: 'rgba(232,210,0,0.25)', marginTop: 4 },
    portalIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(232,210,0,0.1)', alignItems: 'center', justifyContent: 'center' },
    portalTitle: { fontSize: 15, fontWeight: '500', color: TEXT, marginBottom: 4 },
    portalSub: { fontSize: 12, fontWeight: '300', lineHeight: 17, color: DIM },
});

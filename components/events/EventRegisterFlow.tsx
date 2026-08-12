import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    Modal,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSheetDragDismiss } from '@/hooks/useSheetDragDismiss';
import {
    joinLiveEvent,
    resetLiveEventPreview,
    type LiveEvent,
    type LiveEventViewer,
} from '@/lib/api/liveEvents';
import { fetchProfile } from '@/lib/api/user';
import { openEventBooking } from '@/lib/eventBookingLink';
import { eventInviteLink } from '@/lib/eventInviteLink';
import { consentLine, eventDateRange } from '@/lib/liveEventDisplay';
import { useAuth } from '@/context/AuthContext';

const GOLD = '#E8D200';
const TEXT_PRIMARY = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';
const MUTED = 'rgba(255,255,255,0.3)';
const BORDER = '#222222';
const GREEN = '#4ade80';

function rankLabel(rank: number): string {
    return rank === 1 ? '1ST' : rank === 2 ? '2ND' : rank === 3 ? '3RD' : `${rank}TH`;
}

/** Pitch shows a taste; the full list waits on the other side of REGISTER. */
const RULES_PREVIEW_MAX = 4;

interface EventRegisterFlowProps {
    event: LiveEvent;
    visible: boolean;
    onClose: () => void;
    /** Where the sheet was opened from. Home hands off to the League tab on
     *  Done (the event lives there from then on); League just closes. */
    origin: 'home' | 'league';
}

/**
 * The registration moment, whole: one sheet, two stages.
 *
 *   pitch    — what the event is (dates, prizes, rules taste) plus the
 *              consent line, and ONE deliberate REGISTER. This is the
 *              "are you sure" step: nothing registers until it's tapped.
 *   success  — "you're in": the full rules, your invite QR/link (the entry
 *              gate is the event's whole mechanic, so it's handed over the
 *              second you join), and the venue booking handoff.
 *
 * Stages swap inside a single RN <Modal> (redeem-modal's confirm→success
 * pattern) — never a second Modal, which iOS silently drops. Both Home and
 * League open THIS component, so there is exactly one join path in the app.
 *
 * Re-entry: opening the sheet as an already-registered previewer lands
 * straight on 'success' (that's where RESET lives). Registered non-preview
 * users don't reopen the sheet at all — the League ticket card carries the
 * rules/QR/booking permanently.
 */
export function EventRegisterFlow({ event, visible, onClose, origin }: EventRegisterFlowProps) {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const queryClient = useQueryClient();
    const { user } = useAuth();

    const [stage, setStage] = useState<'pitch' | 'success'>('pitch');
    const [joinedViewer, setJoinedViewer] = useState<LiveEventViewer | null>(null);
    const [profile, setProfile] = useState<{ code: string | null; name: string | null }>({
        code: null,
        name: null,
    });
    const [copied, setCopied] = useState(false);

    // Something to run AFTER the sheet has animated away (push a route, switch
    // tab). Routing mid-dismiss is how a router modal ends up presented under
    // a still-mounted RN Modal on iOS — so everything waits for the close.
    const afterDismissRef = useRef<(() => void) | null>(null);
    const { dragY, backdropOpacity, panHandlers, dismiss } = useSheetDragDismiss(() => {
        onClose();
        const after = afterDismissRef.current;
        afterDismissRef.current = null;
        after?.();
    }, visible);

    const dismissThen = (after?: () => void) => {
        afterDismissRef.current = after ?? null;
        dismiss();
    };

    useEffect(() => {
        if (!visible) return;
        // Seed the stage from live viewer state each open: a registered
        // previewer lands on 'success' (where RESET lives), everyone else on
        // the pitch. joinedViewer only outlives this while the sheet is up.
        setStage(event.viewer.joined ? 'success' : 'pitch');
        setJoinedViewer(null);
        setCopied(false);
    }, [visible, event.viewer.joined]);

    useEffect(() => {
        let active = true;
        fetchProfile().then((p) => {
            if (active) setProfile({ code: p?.referral_code ?? null, name: p?.display_name ?? null });
        });
        return () => {
            active = false;
        };
    }, []);

    const joinMutation = useMutation({
        mutationFn: () => joinLiveEvent(event.id),
        onSuccess: (viewer) => {
            if (!viewer?.joined) {
                Alert.alert('Couldn’t register', 'Something went wrong — please try again.');
                return;
            }
            // Render success from the returned viewer immediately — the cache
            // invalidation refills behind it without a flicker.
            setJoinedViewer(viewer);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            setStage('success');
            void queryClient.invalidateQueries({ queryKey: ['liveEvent'] });
            void queryClient.invalidateQueries({ queryKey: ['liveEventInvites'] });
        },
        onError: (error: { code?: string; message?: string }) => {
            // P0001/P0002 are deliberate raises with human-readable copy
            // ("Your account was created after the eligibility cutoff") —
            // surface them verbatim instead of a generic shrug.
            const deliberate = error?.code === 'P0001' || error?.code === 'P0002';
            Alert.alert(
                'Couldn’t register',
                deliberate && error.message ? error.message : 'Something went wrong — please try again.',
            );
        },
    });

    // Preview only: un-register so the flow can be run again — back to the
    // pitch with the sheet still up, so the loop is join → reset → join.
    const resetMutation = useMutation({
        mutationFn: () => resetLiveEventPreview(event.id),
        onSuccess: (viewer) => {
            if (!viewer || viewer.joined) {
                Alert.alert('Couldn’t reset', 'Something went wrong — please try again.');
                return;
            }
            Haptics.selectionAsync().catch(() => {});
            setJoinedViewer(null);
            setStage('pitch');
            void queryClient.invalidateQueries({ queryKey: ['liveEvent'] });
            void queryClient.invalidateQueries({ queryKey: ['liveEventInvites'] });
        },
    });

    const viewer = joinedViewer ?? event.viewer;
    const gate = viewer.gate ?? null;
    const rules = event.rules ?? [];
    const bookingUrl = event.booking_url ?? null;
    const bookingConfirmed = viewer.booking?.confirmed ?? false;
    const consent = consentLine(event);
    const link = profile.code ? eventInviteLink(event.slug, profile.code) : null;

    const handleShare = async () => {
        if (!link) return;
        Haptics.selectionAsync();
        try {
            await Share.share({
                message:
                    `Join me for ${event.name} on POWR 💪\n` +
                    `Sign up with my code ${profile.code} — we both earn +${event.invite_bonus_points} POWR after your first workout.\n` +
                    link,
                url: link,
            });
        } catch {
            // user dismissed — no-op
        }
    };

    const handleCopy = async () => {
        if (!link) return;
        await Clipboard.setStringAsync(link);
        Haptics.selectionAsync();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleBook = () => {
        Haptics.selectionAsync().catch(() => {});
        openEventBooking(event, { email: user?.email, name: profile.name });
    };

    const handleDone = () => {
        dismissThen(origin === 'home' ? () => router.push('/(tabs)/league') : undefined);
    };

    const openFullQr = () => {
        dismissThen(() =>
            router.push({ pathname: '/event-qr', params: { slug: event.slug, name: event.name } }),
        );
    };

    const previewRules = rules.length > RULES_PREVIEW_MAX ? rules.slice(0, 3) : rules;
    const previewMore = rules.length - previewRules.length;

    return (
        <Modal visible={visible} transparent animationType="none" onRequestClose={() => dismiss()}>
            <View style={styles.container}>
                <Animated.View style={[styles.scrim, { opacity: backdropOpacity }]} />
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={() => dismiss()}
                    accessibilityLabel="Close"
                />
                <Animated.View
                    style={[
                        styles.sheet,
                        { paddingBottom: insets.bottom + 20, transform: [{ translateY: dragY }] },
                    ]}
                >
                    <View style={styles.dragHeader} {...panHandlers}>
                        <View style={styles.handle} />
                    </View>

                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.body}
                        bounces={false}
                    >
                        {stage === 'pitch' ? (
                            <>
                                <Text style={styles.eyebrow}>LIVE EVENT</Text>
                                <Text style={styles.name}>{event.name}</Text>
                                <Text style={styles.dates}>{eventDateRange(event)}</Text>

                                {event.promo_headline ? (
                                    <Text style={styles.headline}>{event.promo_headline}</Text>
                                ) : null}

                                {event.prizes.length > 0 && (
                                    <View style={styles.prizeBlock}>
                                        {event.prizes.slice(0, 3).map((p) => (
                                            <View key={p.rank} style={styles.prizeRow}>
                                                <Text style={styles.prizeRank}>{rankLabel(p.rank)}</Text>
                                                <Text style={styles.prizeLabel} numberOfLines={1}>
                                                    {p.label}
                                                </Text>
                                            </View>
                                        ))}
                                    </View>
                                )}

                                {previewRules.length > 0 && (
                                    <View style={styles.rulesBlock}>
                                        <Text style={styles.blockEyebrow}>THE RULES</Text>
                                        {previewRules.map((rule, i) => (
                                            <View key={i} style={styles.ruleRow}>
                                                <Text style={styles.ruleBullet}>•</Text>
                                                <Text style={styles.ruleText}>{rule}</Text>
                                            </View>
                                        ))}
                                        {previewMore > 0 && (
                                            <Text style={styles.ruleMore}>
                                                +{previewMore} more once you’re in
                                            </Text>
                                        )}
                                    </View>
                                )}

                                <Text style={styles.note}>
                                    {'Everyone starts from zero — only points earned during the event window count.' +
                                        (gate
                                            ? ` To get on the leaderboard, ${gate.required} friends need to sign up with your code — your share link is next.`
                                            : '')}
                                </Text>

                                {consent ? <Text style={styles.consent}>{consent}</Text> : null}

                                <Pressable
                                    style={({ pressed }) => [
                                        styles.primaryBtn,
                                        (pressed || joinMutation.isPending) && { opacity: 0.85 },
                                    ]}
                                    disabled={joinMutation.isPending}
                                    onPress={() => {
                                        Haptics.selectionAsync().catch(() => {});
                                        joinMutation.mutate();
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel="Register for the event"
                                >
                                    <Text style={styles.primaryBtnText}>
                                        {joinMutation.isPending ? 'REGISTERING…' : 'COUNT ME IN'}
                                    </Text>
                                </Pressable>

                                <Pressable
                                    style={styles.skipButton}
                                    onPress={() => dismiss()}
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.skipLabel}>Not now</Text>
                                </Pressable>
                            </>
                        ) : (
                            <>
                                <View style={styles.inRow}>
                                    <Ionicons name="checkmark-circle" size={22} color={GOLD} />
                                    <Text style={styles.inText}>You’re in</Text>
                                </View>
                                <Text style={styles.inSub}>
                                    {event.name} · {eventDateRange(event)}
                                </Text>

                                {rules.length > 0 && (
                                    <View style={styles.rulesBlock}>
                                        <Text style={styles.blockEyebrow}>THE RULES</Text>
                                        {rules.map((rule, i) => (
                                            <View key={i} style={styles.ruleRow}>
                                                <Text style={styles.ruleBullet}>•</Text>
                                                <Text style={styles.ruleText}>{rule}</Text>
                                            </View>
                                        ))}
                                    </View>
                                )}

                                <View style={styles.recruitBlock}>
                                    <Text style={styles.blockEyebrow}>
                                        {gate ? 'YOUR TICKET TO THE BOARD' : 'BRING YOUR CREW'}
                                    </Text>
                                    <Text style={styles.recruitText}>
                                        {gate
                                            ? `${gate.required} friends signing up with your code${
                                                  gate.counting === 'conversions'
                                                      ? ' and logging their first verified workout'
                                                      : ''
                                              } puts you on the leaderboard. You each get +${event.invite_bonus_points} POWR too.`
                                            : `You each get +${event.invite_bonus_points} POWR when a friend joins with your code and logs their first verified workout.`}
                                    </Text>

                                    <View style={styles.qrRow}>
                                        <Pressable
                                            style={({ pressed }) => [styles.qrCard, pressed && { opacity: 0.85 }]}
                                            onPress={openFullQr}
                                            accessibilityRole="button"
                                            accessibilityLabel="Show the full-screen event QR code"
                                        >
                                            {link ? (
                                                <QRCode value={link} size={96} color="#0a0a0a" backgroundColor="#FFFFFF" />
                                            ) : (
                                                <View style={{ width: 96, height: 96 }} />
                                            )}
                                        </Pressable>
                                        <View style={styles.qrSide}>
                                            <Pressable
                                                style={({ pressed }) => [styles.codeChip, pressed && { opacity: 0.7 }]}
                                                onPress={handleCopy}
                                                accessibilityRole="button"
                                                accessibilityLabel="Copy your invite link"
                                            >
                                                <Text style={styles.codeText}>{profile.code ?? '········'}</Text>
                                                <Ionicons
                                                    name={copied ? 'checkmark' : 'copy-outline'}
                                                    size={13}
                                                    color={copied ? GOLD : MUTED}
                                                />
                                            </Pressable>
                                            <Pressable
                                                style={({ pressed }) => [
                                                    styles.shareBtn,
                                                    !bookingUrl && styles.shareBtnPrimary,
                                                    pressed && { opacity: 0.85 },
                                                ]}
                                                onPress={handleShare}
                                                disabled={!link}
                                                accessibilityRole="button"
                                                accessibilityLabel="Share your invite link"
                                            >
                                                <Ionicons
                                                    name="share-outline"
                                                    size={14}
                                                    color={!bookingUrl ? '#0a0a0a' : GOLD}
                                                />
                                                <Text
                                                    style={[
                                                        styles.shareBtnText,
                                                        !bookingUrl && styles.shareBtnTextPrimary,
                                                    ]}
                                                >
                                                    SHARE
                                                </Text>
                                            </Pressable>
                                        </View>
                                    </View>
                                </View>

                                {bookingConfirmed ? (
                                    <View style={styles.bookedRow}>
                                        <Ionicons name="checkmark-circle" size={16} color={GREEN} />
                                        <Text style={styles.bookedText}>
                                            Booked with {event.venue?.name ?? 'the venue'}
                                        </Text>
                                    </View>
                                ) : bookingUrl ? (
                                    <Pressable
                                        style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
                                        onPress={handleBook}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Book your place with ${event.venue?.name ?? 'the venue'}`}
                                    >
                                        <View style={styles.bookBtnInner}>
                                            <Text style={styles.primaryBtnText}>BOOK YOUR PLACE</Text>
                                            <Ionicons name="open-outline" size={14} color="#0a0a0a" />
                                        </View>
                                    </Pressable>
                                ) : event.venue?.name ? (
                                    <Text style={styles.bookingSoon}>
                                        Your booking link with {event.venue.name} lands here soon.
                                    </Text>
                                ) : null}

                                {event.is_preview && (
                                    <Pressable
                                        style={({ pressed }) => [
                                            styles.resetBtn,
                                            (pressed || resetMutation.isPending) && { opacity: 0.85 },
                                        ]}
                                        disabled={resetMutation.isPending}
                                        onPress={() => resetMutation.mutate()}
                                        accessibilityRole="button"
                                        accessibilityLabel="Reset test registration"
                                    >
                                        <Text style={styles.resetBtnText}>
                                            {resetMutation.isPending ? 'RESETTING…' : 'RESET TEST REGISTRATION'}
                                        </Text>
                                    </Pressable>
                                )}

                                <Pressable
                                    style={styles.skipButton}
                                    onPress={handleDone}
                                    accessibilityRole="button"
                                    accessibilityLabel="Done"
                                >
                                    <Text style={styles.skipLabel}>Done</Text>
                                </Pressable>
                            </>
                        )}
                    </ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'flex-end' },
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
        backgroundColor: '#141414',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderWidth: 1,
        borderColor: BORDER,
        maxHeight: '90%',
    },
    dragHeader: { paddingTop: 12, paddingBottom: 8, alignItems: 'center' },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.18)',
    },
    body: { paddingHorizontal: 24, paddingBottom: 4 },

    eyebrow: { fontSize: 9, fontWeight: '800', color: GOLD, opacity: 0.7, letterSpacing: 2.5 },
    name: { fontSize: 28, fontWeight: '200', color: TEXT_PRIMARY, letterSpacing: -0.5, marginTop: 4 },
    dates: { fontSize: 13, fontWeight: '300', color: DIM, marginTop: 2 },
    headline: { fontSize: 14, fontWeight: '300', color: TEXT_PRIMARY, marginTop: 14, lineHeight: 20 },

    prizeBlock: { marginTop: 16, gap: 6 },
    prizeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    prizeRank: { width: 32, fontSize: 9, fontWeight: '700', color: GOLD, opacity: 0.7, letterSpacing: 1 },
    prizeLabel: { flex: 1, fontSize: 13, fontWeight: '300', color: DIM },

    blockEyebrow: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.6, letterSpacing: 2.5 },
    rulesBlock: { marginTop: 16, gap: 6 },
    ruleRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    ruleBullet: { fontSize: 12, lineHeight: 17, color: GOLD },
    ruleText: { flex: 1, fontSize: 12, fontWeight: '300', color: DIM, lineHeight: 17 },
    ruleMore: { fontSize: 11, fontWeight: '400', color: MUTED, marginTop: 2 },

    note: { fontSize: 11, fontWeight: '400', color: DIM, marginTop: 16, lineHeight: 16 },
    consent: { fontSize: 10, fontWeight: '400', color: MUTED, marginTop: 10, lineHeight: 14 },

    primaryBtn: {
        marginTop: 18,
        borderRadius: 100,
        backgroundColor: GOLD,
        paddingVertical: 14,
        alignItems: 'center',
    },
    primaryBtnText: { fontSize: 12, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1.5 },
    bookBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },

    skipButton: { alignItems: 'center', paddingVertical: 14 },
    skipLabel: { fontSize: 13, fontWeight: '400', color: DIM },

    // ── success stage ──
    inRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    inText: { fontSize: 24, fontWeight: '200', color: TEXT_PRIMARY, letterSpacing: -0.5 },
    inSub: { fontSize: 12, fontWeight: '300', color: DIM, marginTop: 4 },

    recruitBlock: { marginTop: 18, gap: 8 },
    recruitText: { fontSize: 12, fontWeight: '300', color: DIM, lineHeight: 17 },
    qrRow: { flexDirection: 'row', gap: 12, marginTop: 8, alignItems: 'center' },
    qrCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    qrSide: { flex: 1, gap: 8 },
    codeChip: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: 'rgba(0,0,0,0.25)',
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    codeText: { fontSize: 14, fontWeight: '600', color: TEXT_PRIMARY, letterSpacing: 2 },
    shareBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderRadius: 100,
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.6)',
        paddingVertical: 10,
    },
    shareBtnPrimary: { backgroundColor: GOLD, borderColor: GOLD },
    shareBtnText: { fontSize: 11, fontWeight: '800', color: GOLD, letterSpacing: 1.5 },
    shareBtnTextPrimary: { color: '#0a0a0a' },

    bookedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginTop: 18,
        paddingVertical: 12,
    },
    bookedText: { fontSize: 13, fontWeight: '400', color: GREEN },
    bookingSoon: {
        fontSize: 11,
        fontWeight: '400',
        color: MUTED,
        marginTop: 16,
        lineHeight: 15,
        textAlign: 'center',
    },

    resetBtn: {
        marginTop: 12,
        borderRadius: 100,
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.6)',
        paddingVertical: 13,
        alignItems: 'center',
    },
    resetBtnText: { fontSize: 12, fontWeight: '800', color: GOLD, letterSpacing: 1.5 },
});

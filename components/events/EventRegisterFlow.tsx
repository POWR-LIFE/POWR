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
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EventPrizeList } from '@/components/events/EventPrizeList';
import { useSheetDragDismiss } from '@/hooks/useSheetDragDismiss';
import {
    joinLiveEvent,
    resetLiveEventPreview,
    type LiveEvent,
    type LiveEventViewer,
} from '@/lib/api/liveEvents';
import { fetchProfile } from '@/lib/api/user';
import { openEventBooking } from '@/lib/eventBookingLink';
import { eventInviteLink, eventInviteMessage } from '@/lib/eventInviteLink';
import { liveEventJoinErrorText } from '@/lib/i18n/serverText';
import { consentLine, eventDateRange, inviteRewardLine } from '@/lib/liveEventDisplay';
import { useAuth } from '@/context/AuthContext';

const GOLD = '#E8D200';
const TEXT_PRIMARY = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';
const MUTED = 'rgba(255,255,255,0.3)';
const BORDER = '#222222';
const GREEN = '#4ade80';

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
    const { t } = useTranslation();

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
                Alert.alert(t('events:register.errorTitle'), t('events:register.errorBody'));
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
            // surface them instead of a generic shrug: verbatim in English,
            // in the reader's language otherwise (lib/i18n/serverText.ts).
            const deliberate = error?.code === 'P0001' || error?.code === 'P0002';
            Alert.alert(
                t('events:register.errorTitle'),
                deliberate && error.message ? liveEventJoinErrorText(error.message) : t('events:register.errorBody'),
            );
        },
    });

    // Preview only: un-register so the flow can be run again — back to the
    // pitch with the sheet still up, so the loop is join → reset → join.
    const resetMutation = useMutation({
        mutationFn: () => resetLiveEventPreview(event.id),
        onSuccess: (viewer) => {
            if (!viewer || viewer.joined) {
                Alert.alert(t('events:register.resetErrorTitle'), t('events:register.errorBody'));
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
    const message = link
        ? eventInviteMessage({ eventName: event.name, link, code: profile.code, bonusPoints: event.invite_bonus_points })
        : null;

    const handleShare = async () => {
        if (!link || !message) return;
        Haptics.selectionAsync();
        try {
            await Share.share({ message, url: link });
        } catch {
            // user dismissed — no-op
        }
    };

    // Code + link, same text as Share — a bare link loses the code at the store.
    const handleCopy = async () => {
        if (!message) return;
        await Clipboard.setStringAsync(message);
        Haptics.selectionAsync();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleBook = () => {
        Haptics.selectionAsync().catch(() => {});
        openEventBooking(event, { email: user?.email, name: profile.name });
    };

    const handleDone = () => {
        dismissThen(
            origin === 'home'
                // Pinned: with several events on, League must open on the one
                // just joined, not whichever ranks first.
                ? () => router.push({ pathname: '/(tabs)/league', params: { event: event.slug, at: String(Date.now()) } })
                : undefined,
        );
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
                    accessibilityLabel={t('events:register.closeA11y')}
                />
                <Animated.View
                    style={[
                        styles.sheet,
                        { paddingBottom: insets.bottom + 20, transform: [{ translateY: dragY }] },
                    ]}
                >
                    {/* The title block lives IN the header, not the body: the header is
                        the only thing that owns the drag, so it has to be a real band to
                        grab (the working sheets all do this) — a bare 24px strip round
                        the 4px handle is missed by nearly every touch, which then lands
                        on a ScrollView that doesn't bounce, and nothing moves. Text only
                        in here: the hook claims the gesture on touch-down. */}
                    <View style={styles.dragHeader} {...panHandlers}>
                        <View style={styles.handle} />
                        {stage === 'pitch' ? (
                            <>
                                <Text style={styles.eyebrow}>{t('events:register.eyebrow')}</Text>
                                <Text style={styles.name}>{event.name}</Text>
                                <Text style={styles.dates}>{eventDateRange(event)}</Text>
                            </>
                        ) : (
                            <>
                                <View style={styles.inRow}>
                                    <Ionicons name="checkmark-circle" size={22} color={GOLD} />
                                    <Text style={styles.inText}>{t('events:register.youreIn')}</Text>
                                </View>
                                <Text style={styles.inSub}>
                                    {event.name} · {eventDateRange(event)}
                                </Text>
                            </>
                        )}
                    </View>

                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.body}
                        bounces={false}
                    >
                        {stage === 'pitch' ? (
                            <>
                                {event.promo_headline ? (
                                    <Text style={styles.headline}>{event.promo_headline}</Text>
                                ) : null}

                                <EventPrizeList prizes={event.prizes} size="sheet" />

                                {previewRules.length > 0 && (
                                    <View style={styles.rulesBlock}>
                                        <Text style={styles.blockEyebrow}>{t('events:register.rules')}</Text>
                                        {previewRules.map((rule, i) => (
                                            <View key={i} style={styles.ruleRow}>
                                                <Text style={styles.ruleBullet}>•</Text>
                                                <Text style={styles.ruleText}>{rule}</Text>
                                            </View>
                                        ))}
                                        {previewMore > 0 && (
                                            <Text style={styles.ruleMore}>
                                                {t('events:register.rulesMore', { n: previewMore })}
                                            </Text>
                                        )}
                                    </View>
                                )}

                                <Text style={styles.note}>
                                    {gate
                                        ? t('events:register.noteGate', { required: gate.required })
                                        : t('events:register.note')}
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
                                    accessibilityLabel={t('events:register.registerA11y')}
                                >
                                    <Text style={styles.primaryBtnText}>
                                        {joinMutation.isPending ? t('events:register.registering') : t('events:register.countMeIn')}
                                    </Text>
                                </Pressable>

                                <Pressable
                                    style={styles.skipButton}
                                    onPress={() => dismiss()}
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.skipLabel}>{t('events:register.notNow')}</Text>
                                </Pressable>
                            </>
                        ) : (
                            <>
                                {rules.length > 0 && (
                                    <View style={styles.rulesBlock}>
                                        <Text style={styles.blockEyebrow}>{t('events:register.rules')}</Text>
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
                                        {gate ? t('events:register.ticketEyebrow') : t('events:register.crewEyebrow')}
                                    </Text>
                                    <Text style={styles.recruitText}>
                                        {gate
                                            ? gate.counting === 'conversions'
                                                ? t('events:register.recruitConversions', { required: gate.required, reward: inviteRewardLine(event) })
                                                : t('events:register.recruit', { required: gate.required, reward: inviteRewardLine(event) })
                                            : inviteRewardLine(event)}
                                    </Text>

                                    <View style={styles.qrRow}>
                                        <Pressable
                                            style={({ pressed }) => [styles.qrCard, pressed && { opacity: 0.85 }]}
                                            onPress={openFullQr}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('events:register.qrA11y')}
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
                                                accessibilityLabel={t('events:invite.copyA11y')}
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
                                                accessibilityLabel={t('events:invite.shareA11y')}
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
                                                    {t('events:invite.share')}
                                                </Text>
                                            </Pressable>
                                        </View>
                                    </View>
                                </View>

                                {bookingConfirmed ? (
                                    <View style={styles.bookedRow}>
                                        <Ionicons name="checkmark-circle" size={16} color={GREEN} />
                                        <Text style={styles.bookedText}>
                                            {event.venue?.name != null
                                                ? t('events:booking.bookedWith', { venue: event.venue.name })
                                                : t('events:booking.bookedWithVenue')}
                                        </Text>
                                    </View>
                                ) : bookingUrl ? (
                                    <Pressable
                                        style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
                                        onPress={handleBook}
                                        accessibilityRole="button"
                                        accessibilityLabel={
                                            event.venue?.name != null
                                                ? t('events:booking.bookA11y', { venue: event.venue.name })
                                                : t('events:booking.bookA11yVenue')
                                        }
                                    >
                                        <View style={styles.bookBtnInner}>
                                            <Text style={styles.primaryBtnText}>{t('events:booking.book')}</Text>
                                            <Ionicons name="open-outline" size={14} color="#0a0a0a" />
                                        </View>
                                    </Pressable>
                                ) : event.venue?.name && event.managed_by !== 'gym' ? (
                                    // POWR adds the venue's booking link when bookings open; a
                                    // gym's own event has one only if the gym added it.
                                    <Text style={styles.bookingSoon}>
                                        {t('events:register.bookingSoon', { venue: event.venue.name })}
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
                                        accessibilityLabel={t('events:register.resetA11y')}
                                    >
                                        <Text style={styles.resetBtnText}>
                                            {resetMutation.isPending ? t('events:register.resetting') : t('events:register.reset')}
                                        </Text>
                                    </Pressable>
                                )}

                                <Pressable
                                    style={styles.skipButton}
                                    onPress={handleDone}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('events:register.done')}
                                >
                                    <Text style={styles.skipLabel}>{t('events:register.done')}</Text>
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
    // Full-width band: handle + title block, so the whole top of the sheet is
    // the grab target (see the header comment in the JSX).
    dragHeader: { paddingTop: 12, paddingBottom: 4, paddingHorizontal: 24 },
    handle: {
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.18)',
        marginBottom: 14,
    },
    body: { paddingHorizontal: 24, paddingBottom: 4 },

    eyebrow: { fontSize: 9, fontWeight: '800', color: GOLD, opacity: 0.7, letterSpacing: 2.5 },
    name: { fontSize: 28, fontWeight: '200', color: TEXT_PRIMARY, letterSpacing: -0.5, marginTop: 4 },
    dates: { fontSize: 13, fontWeight: '300', color: DIM, marginTop: 2 },
    headline: { fontSize: 14, fontWeight: '300', color: TEXT_PRIMARY, marginTop: 14, lineHeight: 20 },

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

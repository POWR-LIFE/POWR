import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
    creatorInviteCardState,
    fetchCreatorInviteEligibility,
    requestCreatorInvite,
} from '@/lib/api/creatorInvite';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';
const MUTED = 'rgba(255,255,255,0.3)';

const APPROVED_SEEN_KEY = 'creator-invite-approved-dismissed';

/**
 * The earned invite. Renders nothing for almost everyone; for a member who
 * has crossed the converted-referral bar it asks — once — whether they want
 * to be a POWR Affiliate (user-facing name; code stays creator_*), then tracks the request until an admin answers.
 * Eligibility and the request both live server-side (creator_invite_*
 * RPCs); this card only shows what the server says.
 */
export function CreatorInviteCard() {
    const qc = useQueryClient();
    const router = useRouter();
    const { t } = useTranslation();
    const [approvedDismissed, setApprovedDismissed] = useState<boolean | null>(null);

    const { data } = useQuery({
        queryKey: ['creatorInvite', 'eligibility'],
        queryFn: fetchCreatorInviteEligibility,
        staleTime: 5 * 60_000,
    });

    useEffect(() => {
        AsyncStorage.getItem(APPROVED_SEEN_KEY)
            .then(v => setApprovedDismissed(v === '1'))
            .catch(() => setApprovedDismissed(false));
    }, []);

    const ask = useMutation({
        mutationFn: requestCreatorInvite,
        onSettled: () => qc.invalidateQueries({ queryKey: ['creatorInvite'] }),
    });

    const state = creatorInviteCardState(data);
    if (state === 'hidden') return null;
    if (state === 'approved' && approvedDismissed !== false) return null;

    const openPortal = () => router.push('/affiliate');
    const dismissApproved = () => {
        setApprovedDismissed(true);
        AsyncStorage.setItem(APPROVED_SEEN_KEY, '1').catch(() => {});
    };

    const converted = data?.converted ?? 0;

    return (
        <View style={styles.card} accessibilityRole="summary">
            <View style={styles.glow} pointerEvents="none" />
            <View style={styles.header}>
                <View style={styles.iconWrap}>
                    <Ionicons name="sparkles" size={16} color={GOLD} />
                </View>
                <Text style={styles.eyebrow}>
                    {state === 'approved' ? t('home:creatorInvite.eyebrow.approved') : state === 'pending' ? t('home:creatorInvite.eyebrow.pending') : t('home:creatorInvite.eyebrow.eligible')}
                </Text>
                {state === 'approved' && (
                    <Pressable onPress={dismissApproved} hitSlop={12} accessibilityLabel={t('home:creatorInvite.dismiss')}>
                        <Ionicons name="close" size={16} color={MUTED} />
                    </Pressable>
                )}
            </View>

            {state === 'eligible' && (
                <>
                    <Text style={styles.title}>{t('home:creatorInvite.eligible.title')}</Text>
                    <Text style={styles.body}>
                        {t('home:creatorInvite.eligible.body', { count: converted })}
                    </Text>
                    <Pressable
                        onPress={() => ask.mutate()}
                        disabled={ask.isPending}
                        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
                        accessibilityRole="button"
                    >
                        {ask.isPending
                            ? <ActivityIndicator color="#080808" />
                            : <Text style={styles.ctaText}>{t('home:creatorInvite.eligible.cta')}</Text>}
                    </Pressable>
                    {ask.isError && <Text style={styles.err}>{t('home:creatorInvite.eligible.error')}</Text>}
                    <Text style={styles.foot}>{t('home:creatorInvite.eligible.foot')}</Text>
                </>
            )}

            {state === 'pending' && (
                <>
                    <Text style={styles.title}>{t('home:creatorInvite.pending.title')}</Text>
                    <Text style={styles.body}>
                        {t('home:creatorInvite.pending.body')}
                    </Text>
                </>
            )}

            {state === 'approved' && (
                <>
                    <Text style={styles.title}>{t('home:creatorInvite.approved.title')}</Text>
                    <Text style={styles.body}>
                        {t('home:creatorInvite.approved.body')}
                    </Text>
                    <Pressable onPress={openPortal} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                        <Text style={styles.ctaText}>{t('home:creatorInvite.approved.cta')}</Text>
                        <Ionicons name="arrow-forward" size={14} color="#080808" />
                    </Pressable>
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: 'rgba(40,40,40,0.85)',
        borderWidth: 1,
        borderColor: 'rgba(232,210,0,0.35)',
        borderRadius: 16,
        padding: 18,
        marginBottom: 16,
        overflow: 'hidden',
    },
    glow: {
        position: 'absolute',
        top: -80,
        right: -80,
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: 'rgba(232,210,0,0.10)',
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
    iconWrap: {
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: 'rgba(232,210,0,0.12)',
        alignItems: 'center', justifyContent: 'center',
    },
    eyebrow: { flex: 1, fontSize: 9, fontWeight: '800', letterSpacing: 2.5, color: GOLD },
    title: { fontSize: 20, fontWeight: '300', letterSpacing: -0.4, color: TEXT, marginBottom: 6 },
    body: { fontSize: 13, fontWeight: '300', lineHeight: 19, color: DIM, marginBottom: 14 },
    cta: {
        height: 44, borderRadius: 22, backgroundColor: GOLD,
        alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
    },
    ctaText: { fontSize: 11, fontWeight: '800', letterSpacing: 2, color: '#080808' },
    err: { fontSize: 11, color: '#ef4444', marginTop: 8 },
    foot: { fontSize: 10, color: MUTED, marginTop: 10, textAlign: 'center' },
});

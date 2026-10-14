import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { acceptAffiliateTerms } from '@/lib/api/affiliate';
import { AFFILIATE_TERMS, AFFILIATE_TERMS_VERSION } from '@/shared/affiliateTerms';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';
const MUTED = 'rgba(255,255,255,0.3)';

/** The programme terms. `?accept=1` shows the accept button (first time);
 *  without it this is just the reference copy. */
export default function AffiliateTermsScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const qc = useQueryClient();
    const { t } = useTranslation();
    const { accept } = useLocalSearchParams<{ accept?: string }>();
    const canAccept = accept === '1';

    const accepting = useMutation({
        mutationFn: () => acceptAffiliateTerms(AFFILIATE_TERMS_VERSION),
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: ['affiliate'] });
            router.back();
        },
    });

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <GeometricBackground />
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8} accessibilityLabel={t('common:actions.back')}>
                    <Ionicons name="chevron-back" size={22} color={DIM} />
                </Pressable>
                <Text style={styles.headerTitle}>{t('affiliate:terms.title')}</Text>
                <View style={styles.backBtn} />
            </View>
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + (canAccept ? 120 : 40) }]} showsVerticalScrollIndicator={false}>
                <Text style={styles.eyebrow}>{t('affiliate:terms.eyebrow', { version: AFFILIATE_TERMS_VERSION.toUpperCase() })}</Text>
                {/* The lede, the terms and the consent line below stay in English:
                    they're the legal text, which gets a proper legal translation
                    rather than an in-app draft. Only the chrome is on keys. */}
                <Text style={styles.lede}>Eight short sections. The two that matter most: play fair, and tell people it’s an affiliate link.</Text>
                {AFFILIATE_TERMS.map((s, i) => (
                    <View key={s.title} style={styles.section}>
                        <View style={styles.sectionHead}>
                            <Text style={styles.sectionNum}>{String(i + 1).padStart(2, '0')}</Text>
                            <Text style={styles.sectionTitle}>{s.title}</Text>
                        </View>
                        {s.body.map((p, j) => <Text key={j} style={styles.para}>{p}</Text>)}
                    </View>
                ))}
            </ScrollView>
            {canAccept && (
                <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
                    {accepting.isError && <Text style={styles.err}>{t('affiliate:terms.saveError')}</Text>}
                    <Pressable onPress={() => accepting.mutate()} disabled={accepting.isPending} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                        {accepting.isPending ? <ActivityIndicator color="#080808" /> : <Text style={styles.ctaText}>{t('affiliate:terms.agree')}</Text>}
                    </Pressable>
                    <Text style={styles.foot}>You’re confirming you’re 18 or over and will label your posts as affiliate links.</Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#0d0d0d' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
    backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '400', letterSpacing: 0.5, color: TEXT },
    content: { paddingHorizontal: 20, paddingTop: 8 },
    eyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 2.5, color: GOLD, marginBottom: 10 },
    lede: { fontSize: 15, fontWeight: '300', lineHeight: 22, color: DIM, marginBottom: 24 },
    section: { marginBottom: 22 },
    sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 8 },
    sectionNum: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: GOLD, fontVariant: ['tabular-nums'] },
    sectionTitle: { fontSize: 17, fontWeight: '500', color: TEXT, flexShrink: 1 },
    para: { fontSize: 14, fontWeight: '300', lineHeight: 21, color: DIM, marginBottom: 8 },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14, backgroundColor: 'rgba(13,13,13,0.96)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
    cta: { height: 50, borderRadius: 25, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
    ctaText: { fontSize: 11, fontWeight: '800', letterSpacing: 2, color: '#080808' },
    foot: { fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 10, lineHeight: 15 },
    err: { fontSize: 11, color: '#ef4444', textAlign: 'center', marginBottom: 8 },
});

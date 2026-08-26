import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { fetchAffiliateOverview, fetchMemberAvatar, updateAffiliateProfile } from '@/lib/api/affiliate';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const DIM = 'rgba(255,255,255,0.55)';
const MUTED = 'rgba(255,255,255,0.3)';
const BORDER = 'rgba(255,255,255,0.08)';

/**
 * What the link page shows: name, photo, one line. The photo is one tap —
 * "use my POWR photo" — because an affiliate already has one in the app and
 * shouldn't be asked to upload it twice.
 */
export default function AffiliateProfileScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const qc = useQueryClient();

    const { data } = useQuery({ queryKey: ['affiliate', 'overview', 'v2', 30], queryFn: () => fetchAffiliateOverview(30), staleTime: 60_000 });
    const { data: memberAvatar } = useQuery({ queryKey: ['affiliate', 'memberAvatar'], queryFn: fetchMemberAvatar });

    const [name, setName] = useState('');
    const [bio, setBio] = useState('');
    const [avatar, setAvatar] = useState<string | null>(null);
    const [seeded, setSeeded] = useState(false);

    useEffect(() => {
        if (!data || seeded) return;
        setName(data.profile.display_name ?? '');
        setBio(data.profile.bio ?? '');
        setAvatar(data.profile.avatar_url ?? null);
        setSeeded(true);
    }, [data, seeded]);

    const save = useMutation({
        mutationFn: async () => {
            if (!data) throw new Error('no profile');
            await updateAffiliateProfile(data.profile.id, { display_name: name.trim() || data.profile.display_name, bio: bio.trim() || null, avatar_url: avatar });
        },
        onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['affiliate'] }); router.back(); },
    });

    const handle = data?.profile.handle;

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <GeometricBackground />
            <View style={styles.header}>
                <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
                    <Ionicons name="chevron-back" size={22} color={DIM} />
                </Pressable>
                <Text style={styles.headerTitle}>Your link page</Text>
                <View style={styles.backBtn} />
            </View>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                    <Text style={styles.lede}>This is what someone sees when they tap your link{handle ? ` — powr.life/join/${handle}` : ''}. A face and a line turn a code into a person.</Text>

                    {/* Preview */}
                    <View style={styles.preview}>
                        {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : (
                            <View style={[styles.avatar, styles.avatarEmpty]}><Ionicons name="person" size={26} color={MUTED} /></View>
                        )}
                        <Text style={styles.previewName}>{name.trim() || 'Your name'}</Text>
                        <Text style={styles.previewBio}>{bio.trim() || 'One line about you'}</Text>
                        <View style={styles.previewPill}><Text style={styles.previewPillText}>JOIN POWR WITH {data?.profile.code ?? 'YOUR CODE'}</Text></View>
                    </View>

                    <Text style={styles.label}>PHOTO</Text>
                    <View style={styles.row}>
                        {memberAvatar && memberAvatar !== avatar ? (
                            <Pressable onPress={() => setAvatar(memberAvatar)} style={styles.ghostBtn}><Ionicons name="person-circle-outline" size={16} color={GOLD} /><Text style={styles.ghostBtnText}>USE MY POWR PHOTO</Text></Pressable>
                        ) : avatar ? (
                            <Pressable onPress={() => setAvatar(null)} style={styles.ghostBtn}><Ionicons name="close" size={14} color={DIM} /><Text style={[styles.ghostBtnText, { color: DIM }]}>REMOVE</Text></Pressable>
                        ) : (
                            <Text style={styles.hint}>Add a photo to your POWR profile first (Settings › Edit Profile) and it’ll appear here.</Text>
                        )}
                    </View>

                    <Text style={styles.label}>DISPLAY NAME</Text>
                    <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Your name" placeholderTextColor={MUTED} maxLength={60} />

                    <Text style={styles.label}>ONE LINE ABOUT YOU</Text>
                    <TextInput value={bio} onChangeText={setBio} style={[styles.input, styles.inputMulti]} placeholder="Coach at Iron Works, marathon addict, here to get you moving" placeholderTextColor={MUTED} maxLength={140} multiline />
                    <Text style={styles.counter}>{bio.length}/140</Text>

                    {save.isError && <Text style={styles.err}>Couldn’t save — try again.</Text>}
                    <Pressable onPress={() => save.mutate()} disabled={save.isPending || !data} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                        {save.isPending ? <ActivityIndicator color="#080808" /> : <Text style={styles.ctaText}>SAVE</Text>}
                    </Pressable>
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#0d0d0d' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
    backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '400', letterSpacing: 0.5, color: TEXT },
    content: { paddingHorizontal: 20, paddingTop: 8 },
    lede: { fontSize: 14, fontWeight: '300', lineHeight: 20, color: DIM, marginBottom: 20 },
    preview: { alignItems: 'center', backgroundColor: 'rgba(40,40,40,0.85)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.25)', borderRadius: 20, padding: 22, marginBottom: 24 },
    avatar: { width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: GOLD, marginBottom: 12 },
    avatarEmpty: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
    previewName: { fontSize: 20, fontWeight: '500', color: TEXT, marginBottom: 4 },
    previewBio: { fontSize: 13, fontWeight: '300', color: DIM, textAlign: 'center', marginBottom: 14 },
    previewPill: { paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
    previewPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: '#080808' },
    label: { fontSize: 9, fontWeight: '800', letterSpacing: 2.5, color: MUTED, marginBottom: 8, marginTop: 6 },
    row: { marginBottom: 16 },
    ghostBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(232,210,0,0.35)' },
    ghostBtnText: { fontSize: 10, fontWeight: '800', letterSpacing: 2, color: GOLD },
    hint: { fontSize: 12, fontWeight: '300', color: MUTED, lineHeight: 17 },
    input: { height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, color: TEXT, fontSize: 15, marginBottom: 14 },
    inputMulti: { height: 92, paddingTop: 12, textAlignVertical: 'top', marginBottom: 4 },
    counter: { fontSize: 10, color: MUTED, textAlign: 'right', marginBottom: 20 },
    cta: { height: 50, borderRadius: 25, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
    ctaText: { fontSize: 11, fontWeight: '800', letterSpacing: 2, color: '#080808' },
    err: { fontSize: 11, color: '#ef4444', textAlign: 'center', marginBottom: 8 },
});

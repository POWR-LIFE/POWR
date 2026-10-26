import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrototypeSim } from '@/components/dev/PrototypeSim';
import { CrewCard } from '@/components/home/CrewCard';
import { BountiesSection } from '@/components/pitch/BountiesSection';
import { HuntCard } from '@/components/pitch/HuntCard';
import { PulseCard } from '@/components/pitch/PulseCard';
import { PushPreview } from '@/components/pitch/PushPreview';
import { fontFamily } from '@/constants/tokens';
import { useAuth } from '@/context/AuthContext';
import { DROP_PROTOTYPE } from '@/lib/dev/dropPrototype';

/**
 * DESIGN SCAFFOLD — the parts of the engagement pitch that did NOT make Home.
 * Home keeps two: Today's Drop (the personal daily pull) and Beat Me (the
 * social one). Everything else is here, each labelled with where it would
 * really live, so it can still be judged on screen. Reached from the SIM tab;
 * the route only exists for the prototype (see lib/dev/pitchPrototype).
 */
export default function PitchOffHomeScreen() {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const youName = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'You';
    if (!DROP_PROTOTYPE) return null;

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
                    <Ionicons name="chevron-back" size={20} color="#888888" />
                </Pressable>
                <Text style={styles.headerTitle}>OFF HOME</Text>
                <View style={styles.headerBtn} />
            </View>

            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
                <Text style={styles.intro}>
                    The rest of the pitch. Home keeps Today’s Drop and Beat Me; these live elsewhere or wait for scale.
                </Text>

                <Where text="League tab · with friends, alongside Together challenges" />
                <CrewCard youName={youName} />

                <Where text="League tab · on live events, and as a brand placement" />
                <BountiesSection />

                <Where text="League tab · a weekly event format, run by hand" />
                <HuntCard />

                <Where text="Parked · needs thousands of daily users, or one gym or event" />
                <PulseCard />
            </ScrollView>

            <PrototypeSim />
            <PushPreview />
        </View>
    );
}

function Where({ text }: { text: string }) {
    return (
        <View style={styles.where}>
            <Ionicons name="location-outline" size={12} color="#E8D200" />
            <Text style={styles.whereText}>{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#0d0d0d' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
    headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: 2, color: '#F2F2F2' },
    content: { paddingHorizontal: 10 },
    intro: { fontFamily: fontFamily.light, fontSize: 13, lineHeight: 19, color: '#888888', paddingHorizontal: 14, paddingTop: 8 },
    where: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, marginTop: 28, marginBottom: -4 },
    whereText: { fontFamily: fontFamily.regular, fontSize: 11.5, color: '#E8D200' },
});

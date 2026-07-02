import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { ChallengeTemplateCard } from '@/components/social/ChallengeTemplateCard';
import { CreateChallengeSheet } from '@/components/social/CreateChallengeSheet';
import { fontFamily } from '@/constants/tokens';
import { useSharedChallenges } from '@/hooks/useSharedChallenges';

// ─── Palette ──────────────────────────────────────────────────────────────────
const GOLD = '#E8D200';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const DIM = 'rgba(255,255,255,0.5)';

type ChallengesTab = 'solo' | 'together';

/**
 * Challenges browse page — the discovery surface for shared ("together")
 * challenges. Vertical, categorised list of everything you can start; tapping a
 * card opens the focused invite sheet. Active challenges + invites stay on Home
 * (TogetherSection); this page owns browsing + creation. See scope §8.
 */
export default function ChallengesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    loading,
    templates,
    friends,
    search,
    sendRequest,
    bonusConfig,
    durations,
    defaultDurationHours,
    openChallenges,
    openCount,
    cap,
    atCap,
    createChallenge,
    leaveChallenge,
  } = useSharedChallenges();

  const [sheetVisible, setSheetVisible] = useState(false);
  const [presetTemplateId, setPresetTemplateId] = useState<string | null>(null);
  const [tab, setTab] = useState<ChallengesTab>('solo');

  const openCreate = (templateId: string) => {
    setPresetTemplateId(templateId);
    setSheetVisible(true);
  };

  // Split by mode into tabs — either list can grow large, so they don't share a
  // scroll. Solo = each does their own part; Together = effort pools to one total.
  const solo = useMemo(() => templates.filter((t) => t.mode !== 'pooled'), [templates]);
  const together = useMemo(() => templates.filter((t) => t.mode === 'pooled'), [templates]);
  const activeList = tab === 'solo' ? solo : together;

  const TABS: { key: ChallengesTab; label: string; sub: string }[] = [
    { key: 'solo', label: 'Solo', sub: 'Each of you does your own part.' },
    { key: 'together', label: 'Together', sub: 'Pool your effort toward one shared goal.' },
  ];
  const activeSub = TABS.find((t) => t.key === tab)?.sub ?? '';

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={20} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>CHALLENGES</Text>
        <Pressable
          onPress={() => router.push('/friends')}
          hitSlop={12}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="View friends"
        >
          <Ionicons name="people" size={18} color={DIM} />
        </Pressable>
      </View>

      {/* Concurrency cap — set expectations before they tap into a full plate. */}
      {atCap && (
        <View style={styles.capBanner}>
          <Ionicons name="layers-outline" size={15} color={GOLD} />
          <Text style={styles.capBannerText}>
            You're in {openCount} of {cap} challenges — finish or leave one to start another.
          </Text>
        </View>
      )}

      {/* Solo / Together tabs — each list scrolls on its own. */}
      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const isActive = t.key === tab;
          return (
            <Pressable
              key={t.key}
              style={[styles.tabBtn, isActive && styles.tabBtnActive]}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 12 }}
      >
        <Text style={styles.intro}>{activeSub} Everyone earns a growing bonus when you all finish.</Text>

        {loading && templates.length === 0 ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : activeList.length === 0 ? (
          <Text style={styles.muted}>
            {tab === 'solo' ? 'No solo challenges right now.' : 'No together challenges right now.'}
          </Text>
        ) : (
          activeList.map((t, i) => (
            <ChallengeTemplateCard
              key={t.id}
              template={t}
              index={i}
              onPress={(tpl) => openCreate(tpl.id)}
            />
          ))
        )}
      </ScrollView>

      <CreateChallengeSheet
        visible={sheetVisible}
        templates={templates}
        initialTemplateId={presetTemplateId}
        friends={friends}
        search={search}
        sendRequest={sendRequest}
        bonusConfig={bonusConfig}
        durations={durations}
        defaultDurationHours={defaultDurationHours}
        plateFull={atCap}
        openCount={openCount}
        cap={cap}
        openChallenges={openChallenges}
        onLeave={leaveChallenge}
        onClose={() => setSheetVisible(false)}
        onCreate={createChallenge}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 11, letterSpacing: 2.5, color: TEXT },

  capBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 4,
    backgroundColor: 'rgba(232,210,0,0.08)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.25)',
    paddingVertical: 10, paddingHorizontal: 12,
  },
  capBannerText: { flex: 1, fontFamily: fontFamily.regular, fontSize: 12, color: TEXT, lineHeight: 16 },

  intro: { fontFamily: fontFamily.light, fontSize: 13, color: SECONDARY, lineHeight: 18 },
  muted: { fontFamily: fontFamily.light, fontSize: 14, color: SECONDARY, textAlign: 'center', paddingVertical: 24 },

  // Solo / Together tabs
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16, marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 3,
  },
  tabBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  tabBtnActive: { borderColor: TEXT },
  tabLabel: { fontFamily: fontFamily.medium, fontSize: 12.5, color: SECONDARY, letterSpacing: 0.3 },
  tabLabelActive: { color: TEXT },
});

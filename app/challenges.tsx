import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { ChallengeTemplateCard } from '@/components/social/ChallengeTemplateCard';
import { OpenChallengeCard } from '@/components/social/OpenChallengeCard';
import { OpenBoardPrompt } from '@/components/social/OpenBoardPrompt';
import { CreateChallengeSheet } from '@/components/social/CreateChallengeSheet';
import { fontFamily } from '@/constants/tokens';
import { lastCrew, starterCrew } from '@/lib/social/crew';
import { useOpenChallengeBoard } from '@/hooks/useOpenChallengeBoard';
import { useSharedChallenges } from '@/hooks/useSharedChallenges';

// ─── Palette ──────────────────────────────────────────────────────────────────
const GOLD = '#E8D200';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const DIM = 'rgba(255,255,255,0.5)';

type ChallengesTab = 'parallel' | 'pooled';

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
    openChallenges,
    openCount,
    cap,
    atCap,
    createChallenge,
    leaveChallenge,
    all,
    selfId,
  } = useSharedChallenges();

  // Same default as Home's sheet: your last crew is one Send away.
  const defaultCrew = useMemo(() => lastCrew(all, selfId), [all, selfId]);
  // Faces on the browse cards, and what the sheet opens preselected to: your
  // usual crew first, topped up with your other friends.
  const starter = useMemo(() => starterCrew(friends, defaultCrew), [friends, defaultCrew]);

  // The open board lives here permanently — Home only surfaces it to users with
  // nothing live, but this is the browse page, and someone with one challenge
  // running is exactly who might take a second.
  const { board, taking, takeChallenge, optedIn, teaserCount, setOptedIn } = useOpenChallengeBoard();
  const takeOpen = useCallback(async (id: string) => {
    const res = await takeChallenge(id);
    if (!res.ok && res.error) Alert.alert('Couldn’t take that one', res.error);
    else if (res.ok && res.challengeId) router.push(`/shared-challenge?id=${res.challengeId}`);
  }, [takeChallenge, router]);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [presetPostOpen, setPresetPostOpen] = useState(false);
  const [presetTemplateId, setPresetTemplateId] = useState<string | null>(null);
  const [tab, setTab] = useState<ChallengesTab>('parallel');

  const openCreate = (templateId: string) => {
    setPresetTemplateId(templateId);
    setPresetPostOpen(false);
    setSheetVisible(true);
  };
  const openBoardPost = () => {
    setPresetTemplateId(null);
    setPresetPostOpen(true);
    setSheetVisible(true);
  };

  // Deep-link create: other surfaces (weekly-challenge celebration, level-up,
  // notifications) push `/challenges?create=1[&template=…|&category=…][&crew=a,b]`
  // to land straight in a prefilled create sheet. One-shot: waits for templates,
  // then opens once — back-navigation must not re-trigger it.
  const params = useLocalSearchParams<{ create?: string; template?: string; category?: string; crew?: string }>();
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || params.create !== '1' || templates.length === 0) return;
    autoOpened.current = true;
    const byId = typeof params.template === 'string' && templates.some((t) => t.id === params.template)
      ? params.template : null;
    const byCategory = !byId && typeof params.category === 'string'
      ? (templates.find((t) => t.category === params.category && t.mode !== 'pooled')?.id
          ?? templates.find((t) => t.category === params.category)?.id ?? null)
      : null;
    setPresetTemplateId(byId ?? byCategory);
    setSheetVisible(true);
  }, [params.create, params.template, params.category, templates]);
  const paramCrew = useMemo(
    () => (typeof params.crew === 'string' && params.crew.length > 0 ? params.crew.split(',') : null),
    [params.crew],
  );

  // Split by mode into tabs — either list can grow large, so they don't share a
  // scroll. "Solo" is reserved for genuinely-alone starts, so the parallel mode
  // is labelled by its shape instead: side by side = each does their own part;
  // team total = effort pools to one number.
  const parallel = useMemo(() => templates.filter((t) => t.mode !== 'pooled'), [templates]);
  const pooled = useMemo(() => templates.filter((t) => t.mode === 'pooled'), [templates]);
  const activeList = tab === 'parallel' ? parallel : pooled;

  const TABS: { key: ChallengesTab; label: string; sub: string }[] = [
    { key: 'parallel', label: 'Side by side', sub: 'Each of you does your own part.' },
    { key: 'pooled', label: 'Team total', sub: 'Pool your effort toward one shared goal.' },
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

      {/* Side by side / Team total tabs — each list scrolls on its own. */}
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

        {/* Open board — real people already waiting. It leads the page because a
            posted challenge is a live opponent and a template is only an idea.
            Renders nothing at all when the shelf is empty: a board that has to
            announce it found nobody is worse than no board. */}
        {/* The way in. Renders for anyone who hasn't opted in (with a live count
            of what they're missing) and for an opted-in user staring at an empty
            shelf — the only thing that seeds a cold board is someone posting
            first, so it asks. */}
        <OpenBoardPrompt
          optedIn={optedIn}
          teaserCount={teaserCount}
          boardCount={board.length}
          onEnable={() => setOptedIn(true)}
          onPost={openBoardPost}
        />

        {board.length > 0 && (
          <View style={styles.boardBlock}>
            <View style={styles.boardHeader}>
              <Text style={styles.boardTitle}>Open challenges</Text>
              <Text style={styles.boardHint}>First to take it races them</Text>
            </View>
            {board.map((c) => (
              <OpenChallengeCard
                key={c.id}
                challenge={c}
                busy={taking.has(c.id)}
                onTake={(oc) => takeOpen(oc.id)}
              />
            ))}
          </View>
        )}

        {loading && templates.length === 0 ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : activeList.length === 0 ? (
          <Text style={styles.muted}>
            {tab === 'parallel' ? 'No side-by-side challenges right now.' : 'No team-total challenges right now.'}
          </Text>
        ) : (
          activeList.map((t, i) => (
            <ChallengeTemplateCard
              key={t.id}
              template={t}
              index={i}
              crew={starter}
              bonusConfig={bonusConfig}
              onPress={(tpl) => openCreate(tpl.id)}
            />
          ))
        )}
      </ScrollView>

      <CreateChallengeSheet
        visible={sheetVisible}
        templates={templates}
        initialTemplateId={presetTemplateId}
        /* The faces on the card ARE the preselection — `starter` already leads
           with your last crew, so the sheet can't open on a different set than
           the one the card just pitched. */
        initialFriendIds={paramCrew ?? starter.map((f) => f.id)}
        friends={friends}
        search={search}
        sendRequest={sendRequest}
        bonusConfig={bonusConfig}
        openBoard={{ optedIn, setOptedIn }}
        initialPostOpen={presetPostOpen}
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

  boardBlock: { gap: 12, marginBottom: 4 },
  boardHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  boardTitle: { fontFamily: fontFamily.medium, fontSize: 13, color: TEXT, letterSpacing: 0.2 },
  boardHint: { fontFamily: fontFamily.light, fontSize: 11, color: SECONDARY },
  intro: { fontFamily: fontFamily.light, fontSize: 13, color: SECONDARY, lineHeight: 18 },
  muted: { fontFamily: fontFamily.light, fontSize: 14, color: SECONDARY, textAlign: 'center', paddingVertical: 24 },

  // Side by side / Team total tabs
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

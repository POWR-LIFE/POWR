import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fontFamily } from '@/constants/tokens';
import { useChallengeSettled } from '@/hooks/useChallengeSettled';
import { lastCrew, rematchCrew } from '@/lib/social/crew';
import { useSharedChallenges } from '@/hooks/useSharedChallenges';
import { usePoints } from '@/hooks/usePoints';
import { useNotifications } from '@/context/NotificationsContext';
import { buildSharedChallengeShareInput } from '@/lib/social/share';
import type { SharedChallenge } from '@/lib/social/types';
import { CreateChallengeSheet } from '@/components/social/CreateChallengeSheet';
import { ChallengeTemplateCard } from '@/components/social/ChallengeTemplateCard';
import { SharedChallengeCard } from '@/components/social/SharedChallengeCard';
import { SharedChallengeCelebration } from '@/components/social/SharedChallengeCelebration';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const BORDER = '#222222';
const CARD_BG = '#111111';

// Carousel sizing — card width leaves a GAP + a NEXT_PEEK sliver of the next card
// visible, so the "swipe for more" affordance is obvious. Home content padding is
// 10 each side; SCREEN_W − 20 is the fallback before onLayout measures the band.
const SCREEN_W = Dimensions.get('window').width;
const CAROUSEL_GAP = 12;
const NEXT_PEEK = 22;

// Beat before presenting, matching StreakRescueModal. Keeps the overlay from
// mounting into Home's first paint (where RN occasionally drops the
// presentation) and gives the settled-challenge refetch a moment to land.
const SETTLE_MS = 700;

export interface TogetherSectionProps {
  onOpenChallenge?: (challenge: SharedChallenge) => void;
  /** Another modal owns the screen. Two RN <Modal>s presented at once means one
   *  of them silently never appears on iOS — and a challenge settling awards
   *  points, so the level-up celebration is exactly the modal most likely to be
   *  up at the same instant. Hold, don't drop: the celebration is only marked
   *  seen on dismissal, so it presents as soon as this clears. */
  deferred?: boolean;
}

/**
 * Home "Together" section: pending invites + active shared challenges, and a
 * doorway into the /challenges browse page (which owns discovery + creation).
 * Reads from useSharedChallenges. See docs/shared-challenges-scope.md.
 */
export function TogetherSection({ onOpenChallenge, deferred = false }: TogetherSectionProps) {
  const router = useRouter();
  const {
    loading,
    error,
    all,
    active,
    pendingInvites,
    openChallenges,
    openCount,
    cap,
    atCap,
    friends,
    search,
    sendRequest,
    templates,
    bonusConfig,
    createChallenge,
    acceptInvite,
    declineInvite,
    leaveChallenge,
    dismissChallenge,
    newlyCompletedId,
    clearCelebration,
    refresh,
    selfId,
  } = useSharedChallenges();
  const { balance, refresh: refreshPoints } = usePoints();
  const { refreshPendingActions } = useNotifications();

  // Home keeps its own useSharedChallenges instance; with no shared store it can
  // drift from the truth when progress changes elsewhere (the detail screen's own
  // re-eval, or the cron backstop). Refetch whenever the home tab regains focus so
  // the card never lingers on a stale value while detail shows the real one.
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  // Responding to an invite here (on the home tab) won't fire a tab-focus event,
  // so refresh the avatar badge directly once the mutation settles.
  const handleAccept = (id: string) => { void acceptInvite(id).then(refreshPendingActions); };
  const handleDecline = (id: string) => { void declineInvite(id).then(refreshPendingActions); };

  // Tapping a carousel card opens the invite sheet here on Home (preselected) for
  // the quick path; the header button opens the full /challenges browse page.
  const [sheetVisible, setSheetVisible] = useState(false);
  const [presetTemplateId, setPresetTemplateId] = useState<string | null>(null);
  const [presetFriendIds, setPresetFriendIds] = useState<string[] | null>(null);
  const openCreate = (templateId: string | null, friendIds?: string[]) => {
    setPresetTemplateId(templateId);
    setPresetFriendIds(friendIds ?? null);
    setSheetVisible(true);
  };
  const goToChallenges = () => router.push('/challenges');

  // Default preselection: the crew from your last created challenge, so the
  // usual partners are one Send away. An explicit rematch overrides it.
  const defaultCrew = useMemo(() => lastCrew(all, selfId), [all, selfId]);

  // "Run it back" — reopen the create sheet primed with the ended challenge's
  // template + crew. One confirm instead of a silent recreate: the sheet
  // already owns every edge (slots full, template retired, a friend gone),
  // and it lets you swap out the one who ghosted. A retired template falls
  // back to the generic picker with the crew kept.
  const handleRematch = useCallback((challenge: SharedChallenge) => {
    const templateStillLive = templates.some((t) => t.id === challenge.template.id);
    openCreate(templateStillLive ? challenge.template.id : null, rematchCrew(challenge));
  }, [templates]);

  // Two celebration triggers, one overlay. `newlyCompletedId` is "you finished
  // YOUR part" — fires mid-challenge off a backend completion event. `settled`
  // is the challenge itself resolving, which for a parallel challenge lands up
  // to 72h later and is the moment the group bonus actually exists. Settlement
  // wins when both are pending: it's the final word, and the one whose number
  // was really banked.
  // `loading || error`, not just `loading`: load() flips loading to false on the
  // RPC error path while deliberately leaving `all` untouched, so a failed first
  // fetch would otherwise seed the account off an empty list — marking it
  // initialised with nothing seen, and then announcing the whole 3-day
  // settlement backlog as brand new on the first successful refresh.
  const { pending: settledChallenge, ack: ackSettled } = useChallengeSettled(all, loading || error);
  const celebrated = settledChallenge
    ?? (newlyCompletedId ? active.find((c) => c.id === newlyCompletedId) ?? null : null);
  const isSettled = !!settledChallenge;

  // Keyed on the id, not the challenge object: `all` is replaced wholesale on
  // every refetch, so an object-identity dep would restart the timer on each
  // load and the overlay might never reach its own delay.
  const celebratedId = celebrated?.id ?? null;
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  useEffect(() => {
    if (!celebratedId) { setCelebrationVisible(false); return; }
    // Gate the transition to visible only — never yank an overlay the user is
    // already reading if something else goes pending mid-read.
    if (deferred) return;
    // The settled overlay prints the balance as-is, on the basis that the award
    // already landed. Nothing invalidates the points cache when a challenge
    // settles, so ask for a refetch now; the prop is live, so the figure
    // corrects itself as soon as the query returns.
    if (isSettled) refreshPoints();
    const timer = setTimeout(() => setCelebrationVisible(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [celebratedId, deferred, isSettled, refreshPoints]);

  const dismissCelebration = useCallback(() => {
    setCelebrationVisible(false);
    // Settlement is acked durably (AsyncStorage); the per-part flag is session
    // state on the challenges hook. Clear BOTH every time: a pooled challenge
    // settles the instant your contribution completes the pool, so both
    // triggers fire for the same id and acking only the winner leaves
    // `newlyCompletedId` set — the overlay would re-present later in the
    // session, with the wrong non-settled copy.
    if (isSettled) ackSettled();
    clearCelebration();
  }, [isSettled, ackSettled, clearCelebration]);

  const [bandWidth, setBandWidth] = useState(0);

  const cardWidth = (bandWidth || SCREEN_W - 20) - CAROUSEL_GAP - NEXT_PEEK;
  const snap = cardWidth + CAROUSEL_GAP;

  const openChallenge = (challenge: SharedChallenge) => {
    if (onOpenChallenge) return onOpenChallenge(challenge);
    router.push({ pathname: '/shared-challenge', params: { id: challenge.id } });
  };

  // Pending invites first (they need a response), then the user's active ones.
  const inviteIds = new Set(pendingInvites.map((c) => c.id));
  const ordered = [...pendingInvites, ...active.filter((c) => !inviteIds.has(c.id))];

  return (
    <View>
      <View style={styles.sectionRow}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionLabel}>TOGETHER</Text>
          {/* Cap is only worth flagging at the boundary — otherwise it's just noise. */}
          {atCap && (
            <View
              style={styles.fullChip}
              accessibilityLabel={`Challenge slots full, ${openCount} of ${cap}`}
            >
              <Text style={styles.fullChipText}>Full</Text>
            </View>
          )}
          {pendingInvites.length > 0 && (
            <View style={styles.newChip}>
              <Text style={styles.newChipText}>{pendingInvites.length} new</Text>
            </View>
          )}
        </View>
        <View style={styles.headerActions}>
          <Pressable
            hitSlop={8}
            style={styles.friendsBtn}
            onPress={() => router.push('/friends')}
            accessibilityRole="button"
            accessibilityLabel="View friends"
          >
            <Ionicons name="people" size={15} color={SECONDARY} />
          </Pressable>
          <Pressable hitSlop={8} style={styles.newBtn} onPress={goToChallenges}>
            <Ionicons name="add" size={14} color={GOLD} />
            <Text style={styles.newBtnText}>Challenge friends</Text>
          </Pressable>
        </View>
      </View>

      {loading && ordered.length === 0 ? (
        <View style={styles.skeleton}>
          <View style={styles.skelLineWide} />
          <View style={styles.skelLine} />
          <View style={styles.skelRow}>
            <View style={styles.skelDots} />
            <View style={styles.skelMeta} />
          </View>
        </View>
      ) : ordered.length === 0 ? (
        templates.length === 0 ? (
          /* Fallback while templates load: a slim doorway into the browse page. */
          <Pressable style={styles.emptySlim} onPress={goToChallenges}>
            <View style={styles.emptySlimIcon}>
              <Ionicons name="people" size={15} color={GOLD} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emptySlimTitle}>Take on a challenge together</Text>
              <Text style={styles.emptySlimBody}>Browse challenges — everyone earns a growing bonus.</Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={SECONDARY} />
          </Pressable>
        ) : (
          /* Browse carousel — flick through the challenges you could start. Tapping
             one opens the create flow preselected to it. Same peek/snap sizing as
             the active-challenges carousel below. */
          <>
            <Text style={styles.browseIntro}>
              Take one on with friends — everyone earns a growing bonus.
            </Text>
            <View onLayout={(e) => setBandWidth(e.nativeEvent.layout.width)}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={snap}
                snapToAlignment="start"
                disableIntervalMomentum
              >
                {templates.map((t, i) => (
                  <View
                    key={t.id}
                    style={{ width: cardWidth, marginRight: i === templates.length - 1 ? 0 : CAROUSEL_GAP }}
                  >
                    <ChallengeTemplateCard template={t} index={i} onPress={(tpl) => openCreate(tpl.id)} />
                  </View>
                ))}
              </ScrollView>
            </View>
          </>
        )
      ) : ordered.length === 1 ? (
        <SharedChallengeCard
          challenge={ordered[0]}
          index={0}
          atCap={atCap}
          onPress={openChallenge}
          onAccept={(ch) => handleAccept(ch.id)}
          onDecline={(ch) => handleDecline(ch.id)}
          onDismiss={(ch) => void dismissChallenge(ch.id)}
          onRematch={handleRematch}
        />
      ) : (
        /* Carousel — keeps the hero band one card tall however many you're in.
           Invites are ordered first so the time-sensitive card is the default view. */
        <View onLayout={(e) => setBandWidth(e.nativeEvent.layout.width)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={snap}
            snapToAlignment="start"
            disableIntervalMomentum
          >
            {ordered.map((c, i) => (
              <View
                key={c.id}
                style={{ width: cardWidth, marginRight: i === ordered.length - 1 ? 0 : CAROUSEL_GAP }}
              >
                <SharedChallengeCard
                  challenge={c}
                  index={i}
                  atCap={atCap}
                  onPress={openChallenge}
                  onAccept={(ch) => handleAccept(ch.id)}
                  onDecline={(ch) => handleDecline(ch.id)}
                  onDismiss={(ch) => void dismissChallenge(ch.id)}
                  onRematch={handleRematch}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <CreateChallengeSheet
        visible={sheetVisible}
        templates={templates}
        initialTemplateId={presetTemplateId}
        initialFriendIds={presetFriendIds ?? defaultCrew}
        friends={friends}
        search={search}
        sendRequest={sendRequest}
        bonusConfig={bonusConfig}
        plateFull={atCap}
        openCount={openCount}
        cap={cap}
        openChallenges={openChallenges}
        onLeave={leaveChallenge}
        onClose={() => setSheetVisible(false)}
        onCreate={createChallenge}
      />

      <Modal
        visible={celebrationVisible && !!celebrated}
        transparent
        animationType="fade"
        onRequestClose={dismissCelebration}
      >
        {celebrated && (
          <SharedChallengeCelebration
            /* Remount per challenge: the entry animations and the points
               count-up run once on mount, so swapping the challenge underneath
               a visible overlay would leave the headline frozen on the previous
               one's total. */
            key={celebrated.id}
            challenge={celebrated}
            totalBalance={balance}
            bonusConfig={bonusConfig}
            settled={isSettled}
            onDone={dismissCelebration}
            /* Settled only: mid-challenge the run is still going, so there is
               nothing to re-run yet. Snapshot → dismiss → open after a beat:
               two RN Modals up at once means one silently never presents, so
               the create sheet must wait for this overlay's fade-out. */
            onRematch={isSettled ? () => {
              const finished = celebrated;
              dismissCelebration();
              setTimeout(() => handleRematch(finished), 500);
            } : undefined}
            onShare={() => {
              // Snapshot before dismissing — dismissal nulls `celebrated`.
              const input = buildSharedChallengeShareInput(celebrated, bonusConfig);
              dismissCelebration(); // the Modal would otherwise cover the pushed screen
              router.push({
                pathname: '/share-stats',
                params: { mode: 'challenge', challenge: JSON.stringify(input) },
              });
            }}
          />
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 16,
    marginTop: 8,
    marginBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 9,
    letterSpacing: 2,
    color: TEXT,
    textTransform: 'uppercase',
  },
  // "Full" tag — neutral, shown only at the cap (informational, not a CTA)
  fullChip: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 100, paddingHorizontal: 7, paddingVertical: 2 },
  fullChipText: { fontFamily: fontFamily.semiBold, fontSize: 9, letterSpacing: 0.5, color: SECONDARY, textTransform: 'uppercase' },
  // pending-invite chip — adds urgency without breaking the 9px eyebrow convention
  newChip: { backgroundColor: GOLD, borderRadius: 100, paddingHorizontal: 7, paddingVertical: 2 },
  newChipText: { fontFamily: fontFamily.semiBold, fontSize: 9, letterSpacing: 0.5, color: '#0a0a0a', textTransform: 'uppercase' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  friendsBtn: { flexDirection: 'row', alignItems: 'center' },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  newBtnText: { fontFamily: fontFamily.medium, fontSize: 11, color: GOLD, letterSpacing: 0.2 },

  emptySlim: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 13, paddingHorizontal: 14,
  },
  emptySlimIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(232,210,0,0.10)', alignItems: 'center', justifyContent: 'center',
  },
  emptySlimTitle: { fontFamily: fontFamily.regular, fontSize: 14, color: TEXT },
  emptySlimBody: { fontFamily: fontFamily.light, fontSize: 11.5, color: SECONDARY, marginTop: 1 },

  // browse-carousel lead-in (empty state)
  browseIntro: {
    fontFamily: fontFamily.light, fontSize: 12.5, color: SECONDARY,
    paddingHorizontal: 14, marginBottom: 12, lineHeight: 17,
  },

  // loading skeleton
  skeleton: {
    backgroundColor: CARD_BG, borderRadius: 20, borderWidth: 1, borderColor: BORDER,
    padding: 16, gap: 12,
  },
  skelLineWide: { height: 18, width: '55%', borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)' },
  skelLine: { height: 11, width: '38%', borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.05)' },
  skelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  skelDots: { height: 28, width: 96, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)' },
  skelMeta: { height: 11, width: 84, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.05)' },
});

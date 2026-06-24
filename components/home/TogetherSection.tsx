import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fontFamily } from '@/constants/tokens';
import { useSharedChallenges } from '@/hooks/useSharedChallenges';
import { usePoints } from '@/hooks/usePoints';
import type { SharedChallenge } from '@/lib/social/types';
import { CreateChallengeSheet } from '@/components/social/CreateChallengeSheet';
import { SharedChallengeCard } from '@/components/social/SharedChallengeCard';
import { SharedChallengeCelebration } from '@/components/social/SharedChallengeCelebration';

const GOLD = '#E8D200';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const BORDER = '#222222';
const CARD_BG = '#111111';

// Carousel sizing — card width leaves a GAP + a NEXT_PEEK sliver of the next card
// visible, so the "swipe for more" affordance is obvious. Home content padding is
// 10 each side; SCREEN_W − 20 is the fallback before onLayout measures the band.
const SCREEN_W = Dimensions.get('window').width;
const CAROUSEL_GAP = 12;
const NEXT_PEEK = 22;

export interface TogetherSectionProps {
  onOpenChallenge?: (challenge: SharedChallenge) => void;
}

/**
 * Home "Together" section: pending invites + active shared challenges, plus the
 * entry point into the create flow. Reads from useSharedChallenges (mock-backed
 * for now). See docs/shared-challenges-scope.md.
 */
export function TogetherSection({ onOpenChallenge }: TogetherSectionProps) {
  const router = useRouter();
  const {
    loading,
    active,
    pendingInvites,
    openChallenges,
    openCount,
    cap,
    atCap,
    friends,
    templates,
    createChallenge,
    acceptInvite,
    declineInvite,
    leaveChallenge,
    newlyCompletedId,
    clearCelebration,
  } = useSharedChallenges();
  const { balance } = usePoints();
  const [sheetVisible, setSheetVisible] = useState(false);

  // Celebration fires when the user completes their part — driven by the hook so
  // the real trigger is a backend completion event setting `newlyCompletedId`.
  const celebrated = newlyCompletedId
    ? active.find((c) => c.id === newlyCompletedId) ?? null
    : null;
  const [bandWidth, setBandWidth] = useState(0);

  const cardWidth = (bandWidth || SCREEN_W - 20) - CAROUSEL_GAP - NEXT_PEEK;
  const snap = cardWidth + CAROUSEL_GAP;

  const openChallenge = (challenge: SharedChallenge) => {
    if (onOpenChallenge) return onOpenChallenge(challenge);
    router.push({
      pathname: '/shared-challenge',
      params: { challenge: JSON.stringify(challenge) },
    });
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
          <Pressable hitSlop={8} style={styles.newBtn} onPress={() => setSheetVisible(true)}>
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
        /* Slim one-line invite — never dead space, never dominates the hero slot. */
        <Pressable style={styles.emptySlim} onPress={() => setSheetVisible(true)}>
          <View style={styles.emptySlimIcon}>
            <Ionicons name="people" size={15} color={GOLD} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.emptySlimTitle}>Take on a challenge together</Text>
            <Text style={styles.emptySlimBody}>Invite friends — everyone earns a growing bonus.</Text>
          </View>
          <Ionicons name="arrow-forward" size={16} color={SECONDARY} />
        </Pressable>
      ) : ordered.length === 1 ? (
        <SharedChallengeCard
          challenge={ordered[0]}
          index={0}
          atCap={atCap}
          onPress={openChallenge}
          onAccept={(ch) => acceptInvite(ch.id)}
          onDecline={(ch) => declineInvite(ch.id)}
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
                  onAccept={(ch) => acceptInvite(ch.id)}
                  onDecline={(ch) => declineInvite(ch.id)}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <CreateChallengeSheet
        visible={sheetVisible}
        templates={templates}
        friends={friends}
        plateFull={atCap}
        openCount={openCount}
        cap={cap}
        openChallenges={openChallenges}
        onLeave={leaveChallenge}
        onClose={() => setSheetVisible(false)}
        onCreate={createChallenge}
      />

      <Modal visible={!!celebrated} transparent animationType="fade" onRequestClose={clearCelebration}>
        {celebrated && (
          <SharedChallengeCelebration
            challenge={celebrated}
            totalBalance={balance}
            onDone={clearCelebration}
            onShare={() => router.push({ pathname: '/share-stats', params: { mode: 'streak' } })}
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

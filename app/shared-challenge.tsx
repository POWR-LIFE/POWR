import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { Avatar } from '@/components/social/Avatar';
import { Countdown } from '@/components/social/Countdown';
import { InvitePeopleSheet } from '@/components/social/InvitePeopleSheet';
import { SharedChallengeCelebration } from '@/components/social/SharedChallengeCelebration';
import { UserProfileSheet } from '@/components/UserProfileSheet';
import { fontFamily } from '@/constants/tokens';
import { durationLabel, useSharedChallenges } from '@/hooks/useSharedChallenges';
import { earnedPoints, groupBonus, maxBonusForGroup } from '@/lib/social/bonus';
import type { IconSpec, Participant, SharedChallenge } from '@/lib/social/types';

// ─── Palette ──────────────────────────────────────────────────────────────────
const GOLD = '#E8D200';
const GREEN = '#00CC66';
const ORANGE = '#FF5C00';
const BG = '#0d0d0d';
const TEXT = '#F2F2F2';
const SECONDARY = '#888888';
const MUTED = '#555555';
const FAINT = '#444444';
const DIM = 'rgba(255,255,255,0.5)';
const CARD_BG = '#141414';
const BORDER = '#222222';

const TIER_COLOR: Record<string, string> = { easy: GREEN, medium: GOLD, hard: ORANGE };

function CatIcon({ spec, size, color }: { spec: IconSpec; size: number; color: string }) {
  if (spec.lib === 'mc') return <MaterialCommunityIcons name={spec.name as any} size={size} color={color} />;
  return <Ionicons name={spec.name as any} size={size} color={color} />;
}

type Pool = NonNullable<SharedChallenge['pool']>;

/** Compact value for pool readouts: steps "42k", distance "5.0 km", counts "3". */
function fmtPoolValue(v: number, unit: string): string {
  if (unit === 'km' || unit === 'mi') return `${(v / (unit === 'mi' ? 1609.34 : 1000)).toFixed(1)} ${unit}`;
  if (unit === 'steps') return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
  return `${Math.round(v)}`;
}
function poolHeadline(pool: Pool): string {
  return `${fmtPoolValue(pool.total, pool.unit)} / ${fmtPoolValue(pool.target, pool.unit)}${pool.unit === 'steps' ? ' steps' : ''}`;
}

/** "1 / 3" readout for parallel goals — the raw count from fraction × target,
 *  compacting large targets (46k / 70k). Falls back to "%" when no target. */
function countText(progress: number, target: number): string {
  const current = Math.min(Math.round(progress * target), target);
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n));
  return `${fmt(current)} / ${fmt(target)}`;
}

function StatePill({ p, target }: { p: Participant; target?: number }) {
  if (p.completed) return <Text style={[styles.statePill, { color: GREEN }]}>Done</Text>;
  if (p.state === 'invited') return <Text style={[styles.statePill, { color: MUTED }]}>Invited</Text>;
  if (p.state === 'declined') return <Text style={[styles.statePill, { color: ORANGE }]}>Declined</Text>;
  return (
    <Text style={[styles.statePill, { color: GOLD }]}>
      {target ? countText(p.progress, target) : `${Math.round(p.progress * 100)}%`}
    </Text>
  );
}

function ParticipantRow({ p, pool, goalTarget, onPress }: { p: Participant; pool?: Pool; goalTarget?: number; onPress?: () => void }) {
  return (
    <Pressable
      style={styles.pRow}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `View ${p.friend.displayName}'s profile` : undefined}
    >
      <Avatar friend={p.friend} size={40} completed={p.completed} pending={p.state === 'invited'} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={styles.pNameRow}>
          <Text style={styles.pName}>
            {p.isSelf ? 'You' : p.friend.displayName}
          </Text>
          {pool ? (
            <Text style={[styles.statePill, { color: (p.contribution ?? 0) > 0 ? GOLD : MUTED }]}>
              {p.state === 'invited' ? 'Invited' : fmtPoolValue(p.contribution ?? 0, pool.unit)}
            </Text>
          ) : (
            <StatePill p={p} target={goalTarget} />
          )}
        </View>
        {!pool && (
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(Math.min(p.progress, 1) * 100)}%`, backgroundColor: p.completed ? GREEN : GOLD },
              ]}
            />
          </View>
        )}
      </View>
    </Pressable>
  );
}

export default function SharedChallengeDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ challenge?: string; id?: string }>();
  const { acceptInvite, declineInvite, leaveChallenge, inviteToChallenge, fetchById, getById, bonusConfig, loading, error, refresh, friends, search, sendRequest } = useSharedChallenges();
  const [showCelebration, setShowCelebration] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // Tap a participant to view their profile / add them. Relationship is unknown
  // here, so the sheet resolves it via RPC.
  const [sheetUserId, setSheetUserId] = useState<string | null>(null);
  // Historical fallback: the list RPC drops challenges 3 days after settlement,
  // but notification links live forever — resolve those by id instead of
  // dead-ending on "not available".
  const [fetched, setFetched] = useState<SharedChallenge | null>(null);
  const [fetchingById, setFetchingById] = useState(false);

  // Prefer the live hook record (by id — used by Home nav + notification deep
  // links); fall back to a serialized challenge param for older nav paths.
  const challenge = useMemo<SharedChallenge | null>(() => {
    if (params.id) return getById(params.id) ?? fetched;
    if (!params.challenge) return null;
    try {
      return JSON.parse(params.challenge) as SharedChallenge;
    } catch {
      return null;
    }
  }, [params.id, params.challenge, getById, fetched]);

  // Once the list has loaded and still doesn't know this id, try the durable
  // by-id lookup (works for completed >3d / expired / cancelled challenges).
  useEffect(() => {
    if (!params.id || loading || fetched) return;
    if (getById(params.id)) return;
    let cancelled = false;
    setFetchingById(true);
    fetchById(params.id)
      .then((c) => { if (!cancelled && c) setFetched(c); })
      .finally(() => { if (!cancelled) setFetchingById(false); });
    return () => { cancelled = true; };
  }, [params.id, loading, fetched, getById, fetchById]);

  if (!challenge) {
    // Three distinct states so we never dead-end on a blank screen:
    //   loading  → first fetch in flight (or a manual retry)
    //   error    → the fetch failed; the challenge may well still exist, so offer
    //              a retry instead of wrongly declaring it gone
    //   missing  → loaded cleanly but it's genuinely not in our list
    const isLoading = retrying || fetchingById || (!!params.id && loading);
    const isError = !isLoading && error;

    const handleRetry = async () => {
      if (retrying) return;
      Haptics.selectionAsync();
      setRetrying(true);
      try {
        await refresh();
      } finally {
        setRetrying(false);
      }
    };

    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <GeometricBackground />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={20} color={DIM} />
          </Pressable>
          <Text style={styles.headerTitle}>CHALLENGE</Text>
          <View style={styles.headerBtn} />
        </View>
        <View style={styles.emptyWrap}>
          {isLoading ? (
            <Text style={styles.emptyText}>Loading…</Text>
          ) : isError ? (
            <>
              <Ionicons name="cloud-offline-outline" size={28} color={MUTED} style={styles.emptyIcon} />
              <Text style={styles.emptyTitle}>Couldn’t load this challenge</Text>
              <Text style={styles.emptyText}>Check your connection and try again.</Text>
              <Pressable style={styles.emptyBtn} onPress={handleRetry} accessibilityRole="button" accessibilityLabel="Try again">
                <Ionicons name="refresh" size={15} color={GOLD} />
                <Text style={styles.emptyBtnText}>Try again</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Ionicons name="people-outline" size={28} color={MUTED} style={styles.emptyIcon} />
              <Text style={styles.emptyTitle}>Challenge not available</Text>
              <Text style={styles.emptyText}>It may have ended or been cancelled.</Text>
              <Pressable style={styles.emptyBtn} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
                <Ionicons name="chevron-back" size={15} color={GOLD} />
                <Text style={styles.emptyBtnText}>Go back</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  const { template, participants } = challenge;
  const pool = challenge.pool;
  const pooled = !!pool;
  const poolPct = pool && pool.target > 0 ? Math.min(1, pool.total / pool.target) : 0;
  const self = participants.find((p) => p.isSelf);
  const others = participants.filter((p) => !p.isSelf);
  const accepted = participants.filter((p) => p.state !== 'invited' && p.state !== 'declined');
  const finished = participants.filter((p) => p.completed);
  // Anyone still in the challenge (invited or committed) can't be re-invited.
  // `state` from the RPC only ever surfaces live rows, but guard declined/left
  // explicitly so a re-invite path stays open for them. Plain derivation — no
  // hook — because we're below the `!challenge` early return (hooks up there
  // would violate the rules of hooks) and it's a handful of rows at most.
  const alreadyInIds = new Set(
    participants.filter((p) => p.state !== 'declined' && p.state !== 'left').map((p) => p.friend.id),
  );

  // What YOU'RE on track for: bonus scales with OTHER finishers (co-completers).
  const coCompleters = others.filter((p) => p.completed).length;
  const current = earnedPoints(template.basePoints, coCompleters, bonusConfig);
  const potential = template.basePoints + maxBonusForGroup(accepted.length, bonusConfig);

  // Sort: you first, then done, then in-progress, then invited.
  const order = (p: Participant) =>
    p.isSelf ? 0 : p.completed ? 1 : p.state === 'invited' ? 3 : 2;
  const sorted = [...participants].sort((a, b) => order(a) - order(b));

  const isInvited = self?.state === 'invited';
  const isCreator = challenge.creatorId === self?.friend.id;
  // Terminal statuses — reachable via the 3-day linger and the by-id fallback
  // (old notification links). The game's over: no accept/invite/leave, just the
  // outcome and its share.
  const challengeOver =
    challenge.status === 'completed' || challenge.status === 'expired' || challenge.status === 'cancelled';
  // Forming until everyone's accepted — the clock (endsAt) only runs after that.
  const forming = participants.some((p) => p.state === 'invited');

  // Leaving / cancelling was a one-tap action that, for a pair, ends the
  // challenge for BOTH people (dropping below two live members cancels it).
  // Confirm first, and make the consequence explicit. `willCancelForAll` is true
  // when the creator cancels, or when leaving would drop the group under two.
  const willCancelForAll = isCreator || participants.length <= 2;
  const confirmLeave = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const title = isCreator ? 'Cancel challenge?' : 'Leave challenge?';
    const message = isCreator
      ? `This ends “${template.title}” for everyone. This can’t be undone.`
      : willCancelForAll
        ? `You’ll drop out of “${template.title}”. With no one else left, it ends for everyone.`
        : `You’ll drop out of “${template.title}”. The others keep going.`;
    Alert.alert(title, message, [
      { text: isCreator ? 'Keep challenge' : 'Stay in', style: 'cancel' },
      {
        text: isCreator ? 'Cancel challenge' : 'Leave',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          leaveChallenge(challenge.id);
          router.back();
        },
      },
    ]);
  };

  const handleShare = async () => {
    const url = `https://powr.life/app?challenge=${challenge.id}`;
    try {
      const runLength = challenge.durationHours ? ` in ${durationLabel(challenge.durationHours)}` : '';
      await Share.share({ message: `Join my POWR challenge "${template.title}" — ${template.goal}${runLength}. ${url}`, url });
    } catch {
      /* dismissed */
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={20} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>TOGETHER</Text>
        <Pressable onPress={handleShare} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Share challenge">
          <Ionicons name="share-outline" size={18} color={DIM} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <CatIcon spec={template.icon} size={34} color={GOLD} />
          <Text style={styles.heroTitle}>{template.title}</Text>
          <Text style={styles.heroGoal}>{template.goal}</Text>
          <View style={styles.heroTags}>
            <View style={styles.tag}>
              <Ionicons name="people" size={11} color={SECONDARY} />
              <Text style={styles.tagText}>{accepted.length} in</Text>
            </View>
            <View style={styles.tag}>
              <Text style={[styles.tagText, { color: TIER_COLOR[template.tier] }]}>{template.tier.toUpperCase()}</Text>
            </View>
            {/* While forming, the accept countdown says nothing about how long the
                game will run — surface the chosen run length until the clock starts. */}
            {forming && challenge.durationHours ? (
              <View style={styles.tag}>
                <Ionicons name="timer-outline" size={11} color={SECONDARY} />
                <Text style={[styles.tagText, { textTransform: 'none' }]}>{durationLabel(challenge.durationHours)}</Text>
              </View>
            ) : null}
            <View style={styles.tag}>
              <Ionicons name={forming ? 'hourglass-outline' : 'time-outline'} size={11} color={SECONDARY} />
              {!forming && challenge.endsAt ? (
                <Countdown endsAt={challenge.endsAt} style={[styles.tagText, { textTransform: 'none' }]} />
              ) : forming && challenge.acceptBy ? (
                <Countdown endsAt={challenge.acceptBy} suffix=" to accept" style={[styles.tagText, { textTransform: 'none' }]} />
              ) : (
                <Text style={styles.tagText}>{forming ? 'Not started' : challenge.expiresIn}</Text>
              )}
            </View>
          </View>
        </View>

        {/* Pooled: shared combined-total progress (replaces the per-you bonus card) */}
        {pooled && pool && (
          <View style={styles.bonusCard}>
            <View style={styles.pNameRow}>
              <Text style={styles.sectionLabel}>GROUP TOTAL</Text>
              <Text style={[styles.poolPctText, poolPct >= 1 && { color: GREEN }]}>{Math.round(poolPct * 100)}%</Text>
            </View>
            <Text style={styles.poolHeadline}>{poolHeadline(pool)}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(poolPct * 100)}%` }, poolPct >= 1 && { backgroundColor: GREEN }]} />
            </View>
            <Text style={styles.bonusHint}>
              {poolPct >= 1
                ? `Target smashed — everyone who chipped in earns +${template.basePoints}${maxBonusForGroup(accepted.length, bonusConfig) > 0 ? ` plus up to +${maxBonusForGroup(accepted.length, bonusConfig)} bonus` : ''}.`
                : `Add to the total to win. Everyone who contributes earns +${template.basePoints}, and the bonus grows with each friend who chips in — up to +${maxBonusForGroup(accepted.length, bonusConfig)}.`}
            </Text>
          </View>
        )}

        {/* Bonus breakdown (solo co-op only) */}
        {!pooled && (
        <View style={styles.bonusCard}>
          <Text style={styles.sectionLabel}>YOUR POINTS</Text>
          <View style={styles.bonusMath}>
            <View style={styles.bonusCol}>
              <Text style={styles.bonusNum}>{current.base}</Text>
              <Text style={styles.bonusColLabel}>base</Text>
            </View>
            <Text style={styles.bonusPlus}>+</Text>
            <View style={styles.bonusCol}>
              <Text style={[styles.bonusNum, { color: current.bonus > 0 ? GOLD : MUTED }]}>{current.bonus}</Text>
              <Text style={styles.bonusColLabel}>group bonus</Text>
            </View>
            <Text style={styles.bonusPlus}>=</Text>
            <View style={styles.bonusCol}>
              <Text style={[styles.bonusNum, styles.bonusTotal]}>{current.total}</Text>
              <Text style={styles.bonusColLabel}>so far</Text>
            </View>
          </View>
          <Text style={styles.bonusHint}>
            {coCompleters > 0
              ? `${coCompleters} ${coCompleters === 1 ? 'friend has' : 'friends have'} finished — your bonus grows with each one.`
              : 'Your bonus grows each time a friend finishes.'}
            {potential > current.total ? ` Up to ${potential} if everyone finishes.` : ''}
          </Text>
        </View>
        )}

        {/* Participants */}
        <View style={styles.listCard}>
          <View style={styles.listHeader}>
            <Text style={styles.sectionLabel}>{pooled ? 'CONTRIBUTORS' : 'PARTICIPANTS'}</Text>
            <Text style={styles.listCount}>
              {pooled ? (
                <Text>{accepted.length} in</Text>
              ) : (
                <>
                  <Text style={{ color: GREEN, fontFamily: fontFamily.semiBold }}>{finished.length}</Text>
                  <Text> of {accepted.length} done</Text>
                </>
              )}
            </Text>
          </View>
          <View style={{ gap: 14, marginTop: 12 }}>
            {sorted.map((p) => (
              <ParticipantRow
                key={p.friend.id}
                p={p}
                pool={pool}
                goalTarget={challenge.goalTarget}
                onPress={p.isSelf ? undefined : () => setSheetUserId(p.friend.id)}
              />
            ))}
          </View>
        </View>

        {isInvited && !challengeOver ? (
          /* Pending-invite — Accept / Decline */
          <>
            <Text style={styles.invitePrompt}>
              {challenge.pendingInviteFromName ?? 'A friend'} invited you. Finish together for{' '}
              <Text style={{ color: GOLD, fontFamily: fontFamily.semiBold }}>
                up to +{maxBonusForGroup(accepted.length, bonusConfig)} bonus
              </Text>
              .
            </Text>
            {/* Joining an already-running challenge: be honest about the clock —
                they inherit the time that's left, not a fresh run. */}
            {!forming && challenge.endsAt ? (
              <Text style={styles.inviteSub}>
                This one’s already underway — you’d be joining with{' '}
                <Countdown endsAt={challenge.endsAt} suffix="" style={styles.inviteSubStrong} /> left.
              </Text>
            ) : null}
            <Pressable
              style={styles.acceptBtn}
              onPress={() => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                acceptInvite(challenge.id);
                router.back();
              }}
            >
              <Text style={styles.acceptText}>Accept challenge</Text>
            </Pressable>
            <Pressable
              style={styles.leave}
              onPress={() => { Haptics.selectionAsync(); declineInvite(challenge.id); router.back(); }}
            >
              <Text style={styles.leaveText}>Decline</Text>
            </Pressable>
          </>
        ) : challengeOver ? (
          /* Finished (completed/expired/cancelled) — outcome is read-only; the
             only live action is sharing the result. */
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.actionBtn, styles.actionGhost]}
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel="Share challenge result"
            >
              <Ionicons name="share-outline" size={15} color={SECONDARY} />
              <Text style={styles.actionGhostText}>Share result</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Grow the group. Only the creator can invite people straight into
                the challenge; everyone else can still share a link. */}
            <View style={styles.actionRow}>
              {isCreator && (
                <Pressable
                  style={[styles.actionBtn, styles.actionPrimary]}
                  onPress={() => { Haptics.selectionAsync(); setShowInvite(true); }}
                  accessibilityRole="button"
                  accessibilityLabel="Invite people to this challenge"
                >
                  <Ionicons name="person-add-outline" size={16} color={GOLD} />
                  <Text style={styles.actionPrimaryText}>Invite people</Text>
                </Pressable>
              )}
              <Pressable
                style={[styles.actionBtn, styles.actionGhost]}
                onPress={handleShare}
                accessibilityRole="button"
                accessibilityLabel="Share challenge link"
              >
                <Ionicons name="share-outline" size={15} color={SECONDARY} />
                <Text style={styles.actionGhostText}>Share link</Text>
              </Pressable>
            </View>

            {/* Leave / cancel */}
            <Pressable
              style={styles.leave}
              onPress={confirmLeave}
              accessibilityRole="button"
              accessibilityLabel={isCreator ? 'Cancel challenge' : 'Leave challenge'}
            >
              <Text style={styles.leaveText}>{isCreator ? 'Cancel challenge' : 'Leave challenge'}</Text>
            </Pressable>
          </>
        )}

        {/* Preview the completion celebration (mock-only; remove with backend). */}
        {__DEV__ && (
          <Pressable style={styles.devPreview} onPress={() => setShowCelebration(true)}>
            <Ionicons name="play" size={12} color={MUTED} />
            <Text style={styles.devPreviewText}>Preview celebration</Text>
          </Pressable>
        )}
      </ScrollView>

      {showCelebration && (
        <SharedChallengeCelebration
          challenge={challenge}
          onDone={() => setShowCelebration(false)}
          onShare={handleShare}
        />
      )}

      <InvitePeopleSheet
        visible={showInvite}
        onClose={() => setShowInvite(false)}
        friends={friends}
        alreadyInIds={alreadyInIds}
        onInvite={(ids) => inviteToChallenge(challenge.id, ids)}
        search={search}
        sendRequest={sendRequest}
      />

      <UserProfileSheet
        userId={sheetUserId}
        onChanged={refresh}
        onClose={() => setSheetUserId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 11, letterSpacing: 2.5, color: TEXT },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 6 },
  emptyIcon: { marginBottom: 4 },
  emptyTitle: { fontFamily: fontFamily.regular, fontSize: 16, color: TEXT, textAlign: 'center' },
  emptyText: { fontFamily: fontFamily.light, fontSize: 14, color: SECONDARY, textAlign: 'center' },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14,
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.3)', borderRadius: 100,
    paddingHorizontal: 18, paddingVertical: 11,
  },
  emptyBtnText: { fontFamily: fontFamily.medium, fontSize: 13, color: GOLD, letterSpacing: 0.3 },

  sectionLabel: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 2, color: FAINT, textTransform: 'uppercase' },

  // hero
  hero: { alignItems: 'center', gap: 10, paddingVertical: 8 },
  heroTitle: { fontFamily: fontFamily.light, fontSize: 30, color: TEXT, letterSpacing: -0.5, textAlign: 'center', marginTop: 2 },
  heroGoal: { fontFamily: fontFamily.light, fontSize: 14, color: SECONDARY, textAlign: 'center' },
  heroTags: { flexDirection: 'row', gap: 6, marginTop: 6 },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: BORDER, borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4,
  },
  tagText: { fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 0.5, color: SECONDARY, textTransform: 'uppercase' },

  // bonus card
  bonusCard: { backgroundColor: CARD_BG, borderRadius: 18, borderWidth: 1, borderColor: BORDER, padding: 18, gap: 14 },
  bonusMath: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bonusCol: { alignItems: 'center', gap: 4, flex: 1 },
  bonusNum: { fontFamily: fontFamily.extraLight, fontSize: 34, color: TEXT, lineHeight: 36 },
  bonusTotal: { color: GOLD },
  bonusColLabel: { fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1.5, color: FAINT, textTransform: 'uppercase' },
  bonusPlus: { fontFamily: fontFamily.extraLight, fontSize: 22, color: MUTED, paddingHorizontal: 4 },
  bonusHint: { fontFamily: fontFamily.light, fontSize: 12, color: SECONDARY, lineHeight: 18, textAlign: 'center' },
  poolHeadline: { fontFamily: fontFamily.extraLight, fontSize: 30, color: GOLD, letterSpacing: -0.5 },
  poolPctText: { fontFamily: fontFamily.semiBold, fontSize: 13, color: GOLD },

  // participant list
  listCard: { backgroundColor: CARD_BG, borderRadius: 18, borderWidth: 1, borderColor: BORDER, padding: 18 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listCount: { fontFamily: fontFamily.regular, fontSize: 12, color: SECONDARY },
  pRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pName: { fontFamily: fontFamily.regular, fontSize: 14, color: TEXT },
  statePill: { fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: 0.3 },
  track: { height: 4, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },

  // actions
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderRadius: 100, paddingVertical: 14,
  },
  actionPrimary: { borderColor: 'rgba(232,210,0,0.3)' },
  actionPrimaryText: { fontFamily: fontFamily.medium, fontSize: 13, color: GOLD, letterSpacing: 0.3 },
  actionGhost: { borderColor: BORDER },
  actionGhostText: { fontFamily: fontFamily.medium, fontSize: 13, color: SECONDARY, letterSpacing: 0.3 },
  leave: { alignItems: 'center', paddingVertical: 8 },
  leaveText: { fontFamily: fontFamily.regular, fontSize: 13, color: MUTED },

  // pending invite
  invitePrompt: { fontFamily: fontFamily.light, fontSize: 14, color: SECONDARY, lineHeight: 20, textAlign: 'center', paddingHorizontal: 8 },
  inviteSub: { fontFamily: fontFamily.light, fontSize: 12.5, color: MUTED, lineHeight: 18, textAlign: 'center', paddingHorizontal: 8, marginTop: -4 },
  inviteSubStrong: { fontFamily: fontFamily.medium, fontSize: 12.5, color: SECONDARY },
  acceptBtn: { backgroundColor: GOLD, borderRadius: 100, paddingVertical: 15, alignItems: 'center' },
  acceptText: { fontFamily: fontFamily.bold, fontSize: 13, color: '#0a0a0a', letterSpacing: 0.5 },

  // dev-only preview
  devPreview: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginTop: 4, opacity: 0.5 },
  devPreviewText: { fontFamily: fontFamily.regular, fontSize: 11, color: MUTED, letterSpacing: 0.3 },
});

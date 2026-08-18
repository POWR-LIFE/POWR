import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { GeometricBackground } from '@/components/home/GeometricBackground';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeaderActions } from '@/components/HeaderActions';
import { ComingSoon } from '@/components/ComingSoon';
import { EventPrizeGallery } from '@/components/events/EventPrizeGallery';
import { EventRegisterFlow } from '@/components/events/EventRegisterFlow';
import { EventHeaderCard } from '@/components/league/EventHeaderCard';
import { EventTicketCard } from '@/components/league/EventTicketCard';
import { ProBadge } from '@/components/ui/ProBadge';
import { UserProfileSheet } from '@/components/UserProfileSheet';
import { usePoints } from '@/hooks/usePoints';
import { useLiveEvent } from '@/hooks/useLiveEvent';
import { useAuth } from '@/context/AuthContext';
import { fetchLeaderboard, type LeaderboardEntry, type LeaderboardMetric } from '@/lib/api/leaderboard';
import type { BoardPreviewState, EventBoardEntry, EventLeaderboard, LiveEvent } from '@/lib/api/liveEvents';

// ─── Constants ────────────────────────────────────────────────────────────────

const GOLD        = '#E8D200';
const GOLD_SOFT   = '#FFE97A';
const GREEN       = '#4ade80';
const RED         = '#f87171';
const SILVER      = '#c0c0c0';
const SILVER_SOFT = '#E0E0E0';
const BRONZE      = '#cd7f32';
const BRONZE_SOFT = '#E8A464';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

const SCREEN_W = Dimensions.get('window').width;
const TAB_W    = SCREEN_W / 2;

// ─── Leaderboard flag ────────────────────────────────────────────────────────
/** Flip to false to show the ComingSoon screen instead of the real leaderboard */
const LEAGUE_LIVE = false;

// ─── Podium rank metadata ─────────────────────────────────────────────────────

const RANK_META = {
  1: { colour: GOLD,   platformH: 74, avatarSize: 52 },
  2: { colour: SILVER, platformH: 52, avatarSize: 44 },
  3: { colour: BRONZE, platformH: 36, avatarSize: 40 },
} as const;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LeagueScreen() {
  const insets    = useSafeAreaInsets();
  const router    = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const { user }  = useAuth();

  const [activeTab, setActiveTab] = useState(0); // 0=Standard, 1=Pro
  const [metric, setMetric] = useState<LeaderboardMetric>('weekly');
  const [standardEntries, setStandardEntries] = useState<LeaderboardEntry[]>([]);
  const [proEntries, setProEntries] = useState<LeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserPoints, setSelectedUserPoints] = useState<number | undefined>(undefined);
  const indicatorX = useSharedValue(0);

  const { tab, event: eventSlug } = useLocalSearchParams<{ tab?: string; event?: string }>();

  const { weeklyEarned, totalEarned } = usePoints();
  const myPoints = metric === 'weekly' ? weeklyEarned : totalEarned;

  // Board state a preview tester has stepped to. null = whatever the event's
  // admin-set preview_board_state says, which is also what every non-previewer
  // gets — the server ignores this argument for anyone else.
  const [boardPreview, setBoardPreview] = useState<BoardPreviewState | null>(null);

  const { event: activeEvent, invites, board: eventBoard } =
    useLiveEvent(typeof eventSlug === 'string' ? eventSlug : undefined, boardPreview);
  const [registerOpen, setRegisterOpen] = useState(false);

  // Load leaderboard data when metric changes (only when live)
  useEffect(() => {
    if (!LEAGUE_LIVE) return;
    setLoadingLeaderboard(true);
    Promise.all([
      fetchLeaderboard(false, metric),
      fetchLeaderboard(true, metric),
    ]).then(([std, pro]) => {
      setStandardEntries(std);
      setProEntries(pro);
      setLoadingLeaderboard(false);
    });
  }, [metric]);

  useEffect(() => {
    if (tab === 'pro') goToTab(1);
  }, [tab]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }));

  function goToTab(index: number) {
    setActiveTab(index);
    scrollRef.current?.scrollTo({ x: index * SCREEN_W, animated: true });
    indicatorX.value = withTiming(index * TAB_W, { duration: 220 });
  }

  function onMomentumScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    setActiveTab(index);
    indicatorX.value = withTiming(index * TAB_W, { duration: 220 });
  }

  function openUserSheet(entry: LeaderboardEntry) {
    setSelectedUserId(entry.user_id);
    setSelectedUserPoints(entry.points);
  }

  const currentEntries = activeTab === 0 ? standardEntries : proEntries;
  const myEntry = currentEntries.find(e => e.user_id === user?.id);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      {/* ── Screen header ─────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.title}>League</Text>
        <HeaderActions />
      </View>

      {!LEAGUE_LIVE ? (
        /* Event mode: when an event is configured the tab carries the event.
           Three blocks, one job each — what the event IS (header), how you get
           onto the board (ticket), and the board itself. No event → the
           original teaser. */
        activeEvent ? (
          <>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 8 }}
              showsVerticalScrollIndicator={false}
            >
              <EventHeaderCard
                event={activeEvent}
                onRegister={() => setRegisterOpen(true)}
              />
              {/* What's on the line — its own block, not a footnote inside
                  the hero: artwork gets a gallery, tap opens the spotlight. */}
              <EventPrizeGallery prizes={activeEvent.prizes} />
              {/* The ticket only means anything once you're in the event, and
                  only while there's still time to convert an invite. */}
              {activeEvent.viewer.joined && invitesOpen(activeEvent) && (
                <EventTicketCard event={activeEvent} invites={invites} />
              )}
              {/* Testers only — walks the board through every state it can be
                  in without an admin flipping a column between each step. */}
              {activeEvent.is_preview && (
                <BoardPreviewSwitcher value={boardPreview} onChange={setBoardPreview} />
              )}
              <EventBoardSection
                event={activeEvent}
                board={eventBoard}
                onPressUser={openUserSheet}
                ticketAbove={activeEvent.viewer.joined && invitesOpen(activeEvent)}
              />
            </ScrollView>
            <EventRegisterFlow
              event={activeEvent}
              visible={registerOpen}
              onClose={() => setRegisterOpen(false)}
              origin="league"
            />
            <UserProfileSheet
              userId={selectedUserId}
              myPoints={myPoints}
              userPoints={selectedUserPoints}
              onClose={() => { setSelectedUserId(null); setSelectedUserPoints(undefined); }}
            />
          </>
        ) : (
          <ComingSoon
            eyebrow="KEEP MOVING"
            title="The league is waiting for you."
            subtitle="Train consistently to unlock weekly podiums and rankings."
          />
        )
      ) : (
        <>
          {/* Standard / Pro tab bar */}
          <View style={styles.topTabBar}>
            <Pressable style={styles.topTab} onPress={() => goToTab(0)}>
              <Text style={[styles.topTabText, activeTab === 0 && styles.topTabTextActive]}>STANDARD</Text>
            </Pressable>
            <Pressable style={styles.topTab} onPress={() => goToTab(1)}>
              <Text style={[styles.topTabText, activeTab === 1 && styles.topTabTextActive]}>PRO</Text>
            </Pressable>
            <Animated.View style={[styles.tabIndicator, indicatorStyle]} />
          </View>

          {/* Weekly / All-time metric toggle */}
          <View style={styles.metricRow}>
            <Pressable
              style={[styles.metricBtn, metric === 'weekly' && styles.metricBtnActive]}
              onPress={() => setMetric('weekly')}
            >
              <Text style={[styles.metricBtnText, metric === 'weekly' && styles.metricBtnTextActive]}>WEEKLY</Text>
            </Pressable>
            <Pressable
              style={[styles.metricBtn, metric === 'alltime' && styles.metricBtnActive]}
              onPress={() => setMetric('alltime')}
            >
              <Text style={[styles.metricBtnText, metric === 'alltime' && styles.metricBtnTextActive]}>ALL TIME</Text>
            </Pressable>
          </View>

          {/* Paged content — Standard | Pro */}
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumScrollEnd}
            style={styles.pager}
            scrollEnabled={false}
          >
            {([standardEntries, proEntries] as LeaderboardEntry[][]).map((entries, tabIdx) => (
              <View key={tabIdx} style={styles.page}>
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={[styles.pageContent, { paddingBottom: insets.bottom + 24 }]}
                  showsVerticalScrollIndicator={false}
                >
                  {loadingLeaderboard ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyText}>Loading…</Text>
                    </View>
                  ) : entries.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyText}>No entries yet</Text>
                    </View>
                  ) : (
                    <>
                      {entries.length >= 3 && (
                        <>
                          <View style={styles.sectionRow}>
                            <Text style={styles.sectionLabel}>TOP 3</Text>
                            <View style={styles.sectionLine} />
                          </View>
                          <RealPodium entries={entries.slice(0, 3)} onPress={openUserSheet} />
                        </>
                      )}
                      <View style={styles.sectionRow}>
                        <Text style={styles.sectionLabel}>STANDINGS</Text>
                        <View style={styles.sectionLine} />
                      </View>
                      <View style={styles.standingsCard}>
                        {entries.slice(entries.length >= 3 ? 3 : 0).map((entry, idx, arr) => (
                          <Pressable
                            key={entry.user_id}
                            onPress={() => openUserSheet(entry)}
                            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                          >
                            <RealLeaderRow
                              entry={entry}
                              isMe={entry.user_id === user?.id}
                              showPro={tabIdx === 1}
                            />
                            {idx < arr.length - 1 && <View style={styles.rowDivider} />}
                          </Pressable>
                        ))}
                      </View>
                      {myEntry && activeTab === tabIdx && (
                        <NearYouSection
                          entries={entries}
                          myEntry={myEntry}
                          metric={metric}
                          onPress={openUserSheet}
                          showPro={tabIdx === 1}
                        />
                      )}
                    </>
                  )}
                </ScrollView>
              </View>
            ))}
          </ScrollView>

          <UserProfileSheet
            userId={selectedUserId}
            myPoints={myPoints}
            userPoints={selectedUserPoints}
            onClose={() => { setSelectedUserId(null); setSelectedUserPoints(undefined); }}
          />
        </>
      )}
    </View>
  );
}

/**
 * Whether an invite can still count for this event — the window is open and
 * the conversion deadline (if the event sets one) hasn't passed. Past it the
 * ticket card is just a promise we can't keep, so it comes off the tab.
 */
function invitesOpen(event: LiveEvent): boolean {
  if (event.status !== 'scheduled' && event.status !== 'live') return false;
  if (!event.conversion_deadline_at) return true;
  return Date.now() < new Date(event.conversion_deadline_at).getTime();
}

// ─── BoardPreviewSwitcher ─────────────────────────────────────────────────────

/**
 * The board lifecycle, walkable in place. Rendered ONLY when the server has
 * already told us this viewer is a previewer on a draft (`is_preview`), and
 * the state it picks is re-validated server-side against the same previewer
 * check — so this is a convenience, never the access control.
 *
 * It exists because the states were previously only reachable by an admin
 * editing `preview_board_state` on the event: one value shared by every
 * tester, changed for everyone at once, and nobody could step through the
 * sequence themselves. AUTO hands control back to that column.
 */
function BoardPreviewSwitcher({
  value,
  onChange,
}: {
  value: BoardPreviewState | null;
  onChange: (next: BoardPreviewState | null) => void;
}) {
  // 'auto' is modelled as null so the app sends nothing and the event's own
  // setting decides — distinct from explicitly forcing 'auto'.
  const options: { label: string; state: BoardPreviewState | null }[] = [
    { label: 'AUTO', state: null },
    { label: 'GATED', state: 'gated' },
    { label: 'LIVE', state: 'live' },
    { label: 'SEALED', state: 'locked' },
    { label: 'WINNERS', state: 'revealed' },
  ];

  return (
    <View style={styles.previewSwitcher}>
      <Text style={styles.previewSwitcherLabel}>PREVIEW · BOARD STATE</Text>
      <View style={styles.previewSwitcherRow}>
        {options.map(o => {
          const active = value === o.state;
          return (
            <Pressable
              key={o.label}
              onPress={() => {
                Haptics.selectionAsync();
                onChange(o.state);
              }}
              style={[styles.previewSwitcherPill, active && styles.previewSwitcherPillOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Preview the ${o.label.toLowerCase()} board state`}
            >
              <Text style={[styles.previewSwitcherText, active && styles.previewSwitcherTextOn]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── EventBoardSection ────────────────────────────────────────────────────────
// The event-mode board (ticket 5). Server-driven: standings exist only while
// the board is live and visible, nothing score-shaped arrives while locked
// (that absence IS the blur — never fill it client-side), and after Reveal the
// frozen live_event_results snapshot renders as the winners card.

const asEntries = (rows: EventBoardEntry[] | undefined): LeaderboardEntry[] =>
  (rows ?? []).map(r => ({
    user_id: r.user_id,
    display_name: r.display_name,
    username: r.username,
    avatar_url: r.avatar_url,
    level: 0,
    is_pro: r.is_pro,
    points: r.points,
    rank: r.rank,
  }));

function EventBoardSection({
  event,
  board,
  onPressUser,
  ticketAbove,
}: {
  event: LiveEvent;
  board: EventLeaderboard | null;
  onPressUser: (e: LeaderboardEntry) => void;
  /** The ticket card is rendered above this section — it already carries the
   *  gate count, the progress line and the share tools. */
  ticketAbove: boolean;
}) {
  // Pre-week: the header card above already carries the countdown. A preview
  // payload FORCED into a real state (gated / sealed / live / winners) still
  // renders — that walkthrough is the point; auto-scheduled mirrors the real
  // nothing.
  if (!board) return null;
  // is_gated belongs here with the rest: it is a forced state like any other,
  // and a gated payload carries nothing score-shaped, so testing it against
  // standings/results alone silently dropped it on a pre-window event.
  const previewForced =
    board.is_preview &&
    (board.is_locked || board.is_gated || !!board.standings || !!board.results);
  if (event.status === 'scheduled' && !previewForced) {
    // A blank is ambiguous inside a preview walkthrough — say why it's empty
    // rather than leaving a tester wondering whether something failed.
    return board.is_preview ? (
      <View style={styles.previewEmptyNote}>
        <Text style={styles.previewEmptyNoteText}>
          No board before the window opens — this is exactly what a real user sees
          pre-event. Pick a state above to walk the rest of the flow.
        </Text>
      </View>
    ) : null;
  }

  const viewer = board.viewer ?? { eligible: false, joined: false, disqualified: false };

  // Live, but this viewer hasn't met the referral entry gate — the server sent
  // nothing score-shaped (is_gated). The invite card above carries the share
  // tools; this card says what the blur is and how far they've got.
  const gate = viewer.gate;
  if (board.is_gated && gate) {
    const have = Math.min(gate.count, gate.required);
    const pct = gate.required > 0 ? Math.max(0, Math.min(1, have / gate.required)) : 0;
    // With the ticket on screen the count, the progress line and the share
    // code are all already there — a second "0 of 5" with its own bar under
    // it read as two competing surfaces (field 2026-08-18). Here the board
    // says only what it is waiting for, in one quiet line.
    if (ticketAbove) {
      return (
        <View style={styles.eventGatedQuiet}>
          <Ionicons name="lock-closed-outline" size={13} color={GOLD} style={{ opacity: 0.8 }} />
          <Text style={styles.eventGatedQuietText}>
            {`Leaderboard unlocks at ${gate.required} friends`}
          </Text>
        </View>
      );
    }
    return (
      // No card: this state is a held breath, and a bordered box makes it look
      // like an error. The content floats on the screen's own background and
      // the hairline is the only structure.
      <View style={styles.eventGated}>
        <Ionicons name="lock-closed-outline" size={30} color={GOLD} style={styles.eventGatedIcon} />

        <Text style={styles.eventGatedTitle}>
          {`${have} of ${gate.required} friends in`}
        </Text>

        {/* The count again, as distance rather than a number — the one piece of
            structure the layout gets, so progress reads before the copy does. */}
        <View style={styles.eventGatedTrack}>
          <View style={[styles.eventGatedFill, { width: `${pct * 100}%` }]} />
        </View>

        <Text style={styles.eventGatedSub}>
          {gate.counting === 'conversions'
            ? `The leaderboard unlocks when ${gate.required} friends sign up with your code and log their first verified workout — share it above.`
            : `The leaderboard unlocks when ${gate.required} friends sign up with your code — share it above.`}
        </Text>
      </View>
    );
  }

  // Locked and not yet revealed: the sealed board. The server sent nothing
  // score-shaped — these rows are pure theatre, and that's the point: the
  // board exists, it's full, and nobody gets to see it until the reveal.
  if (!board.standings && !board.results) {
    return <SealedBoard preview={!!board.is_preview} />;
  }

  const isWinners = board.results != null;
  const entries = asEntries(board.results ?? board.standings);
  const top3 = entries.slice(0, 3);
  const restRows = entries.slice(entries.length >= 3 ? 3 : 0);
  const prizeWinners = (board.results ?? []).filter(r => r.prize_label).slice(0, 3);

  // Sample rows in a board preview carry sentinel ids — there is no profile
  // behind them to open.
  const pressUser = (e: LeaderboardEntry) => {
    if (board.is_preview && e.user_id.startsWith('00000000-0000-4000-8000')) return;
    onPressUser(e);
  };

  return (
    <View style={{ gap: 8 }}>
      {board.is_preview && (
        <View style={styles.boardPreviewChipRow}>
          <View style={styles.boardPreviewChip}>
            <Text style={styles.boardPreviewChipText}>{'BOARD PREVIEW' + (entries.some(e => e.user_id.startsWith('00000000-0000-4000-8000')) ? ' · SAMPLE DATA' : '')}</Text>
          </View>
        </View>
      )}

      {/* The reveal moment: one quiet line before the winners appear. */}
      {isWinners && (
        <View style={styles.revealHeader}>
          <Text style={styles.revealHeaderText}>The results are in.</Text>
          <View style={styles.revealHairline} />
        </View>
      )}

      {/* Your rank — server-computed; outside the visible board it still shows */}
      {viewer.rank != null && (
        <View style={styles.eventYouBlock}>
          <View>
            <Text style={styles.eventYouLabel}>{isWinners ? 'YOUR FINAL RANK' : 'YOUR RANK'}</Text>
            <View style={styles.heroRankRow}>
              <Text style={styles.heroRankHash}>#</Text>
              <Text style={styles.eventYouRank}>{viewer.rank}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={styles.heroPts}>{(viewer.points ?? 0).toLocaleString()}</Text>
            <Text style={styles.heroPtsLabel}>PTS THIS WEEK</Text>
            {isWinners && viewer.prize_label && (
              <Text style={styles.eventYouPrize}>🏆 {viewer.prize_label}</Text>
            )}
          </View>
        </View>
      )}

      {entries.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No points on the board yet — first verified workout opens the scoring.</Text>
        </View>
      ) : (
        <>
          {top3.length >= 3 && (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionLabel}>{isWinners ? 'WINNERS' : 'TOP 3'}</Text>
                <View style={styles.sectionLine} />
              </View>
              <RealPodium entries={top3} onPress={pressUser} />
            </>
          )}

          {isWinners && prizeWinners.length > 0 && (
            <View style={styles.eventPrizeBlock}>
              {prizeWinners.map(r => (
                <View key={r.rank} style={styles.eventPrizeRow}>
                  <Text style={styles.eventPrizeRank}>
                    {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉'}
                  </Text>
                  <Text style={styles.eventPrizeName} numberOfLines={1}>
                    {r.display_name ?? r.username ?? 'POWR member'}
                  </Text>
                  <Text style={styles.eventPrizeLabel} numberOfLines={1}>{r.prize_label}</Text>
                </View>
              ))}
            </View>
          )}

          {restRows.length > 0 && (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionLabel}>{isWinners ? 'FINAL STANDINGS' : 'STANDINGS'}</Text>
                <View style={styles.sectionLine} />
              </View>
              <View style={styles.eventStandings}>
                {restRows.map((entry, idx, arr) => (
                  <Pressable
                    key={entry.user_id}
                    onPress={() => pressUser(entry)}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <RealLeaderRow entry={entry} isMe={false} showPro={false} />
                    {idx < arr.length - 1 && <View style={styles.rowDivider} />}
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}

// ─── SealedBoard ──────────────────────────────────────────────────────────────
// The locked state a whole venue stares at all event week. Deliberately NOT a
// skeleton loader: rank numerals are real and readable, the name/score bars
// breathe slowly at different widths — a full board under a seal, not a page
// that failed to load. No score-shaped data exists client-side; the bars are
// decoration over the server's silence.

const SEALED_ROWS = [0.62, 0.5, 0.58, 0.44, 0.52, 0.4];

function SealedRow({ rank, widthRatio }: { rank: number; widthRatio: number }) {
  const glow = useSharedValue(0.35);

  useEffect(() => {
    glow.value = withDelay(
      rank * 180,
      withRepeat(
        withSequence(
          withTiming(0.75, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.3, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pulse = useAnimatedStyle(() => ({ opacity: glow.value }));
  const isTop3 = rank <= 3;

  return (
    <View style={styles.sealedRow}>
      <Text style={[styles.sealedRank, isTop3 && styles.sealedRankTop]}>{rank}</Text>
      <Animated.View
        style={[
          styles.sealedBar,
          { flex: widthRatio },
          isTop3 && styles.sealedBarTop,
          pulse,
        ]}
      />
      <View style={{ flex: 1 - widthRatio }} />
      <Animated.View style={[styles.sealedPts, isTop3 && styles.sealedPtsTop, pulse]} />
    </View>
  );
}

function SealedBoard({ preview }: { preview: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      {preview && (
        <View style={styles.boardPreviewChipRow}>
          <View style={styles.boardPreviewChip}>
            <Text style={styles.boardPreviewChipText}>BOARD PREVIEW</Text>
          </View>
        </View>
      )}
      <View style={styles.sealedCard}>
        <View style={styles.sealedLockRing}>
          <Ionicons name="lock-closed" size={16} color={GOLD} />
        </View>
        <Text style={styles.sealedEyebrow}>SCORES SEALED</Text>
        <Text style={styles.sealedTitle}>Winners announced live at the final</Text>

        <View style={styles.sealedRows}>
          {SEALED_ROWS.map((w, i) => (
            <SealedRow key={i} rank={i + 1} widthRatio={w} />
          ))}
          <LinearGradient
            colors={['rgba(16,16,16,0)', 'rgba(16,16,16,0.96)']}
            style={styles.sealedFade}
            pointerEvents="none"
          />
        </View>

        <Text style={styles.sealedFoot}>
          Every point is already counted. Nobody sees the board until the reveal.
        </Text>
      </View>
    </View>
  );
}

// ─── PodiumAvatarRing ─────────────────────────────────────────────────────────


function PodiumAvatarRing({
  avatarSize,
  colour,
  colourSoft,
  isFirst,
  children,
}: {
  avatarSize: number;
  colour: string;
  colourSoft: string;
  isFirst: boolean;
  children: React.ReactNode;
}) {
  const outerRot = useSharedValue(0);
  const innerRot = useSharedValue(0);

  useEffect(() => {
    outerRot.value = withRepeat(
      withTiming(360, { duration: isFirst ? 7000 : 11000, easing: Easing.linear }),
      -1,
      false,
    );
    innerRot.value = withRepeat(
      withTiming(-360, { duration: isFirst ? 12000 : 18000, easing: Easing.linear }),
      -1,
      false,
    );
  }, []);

  const outerSpin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${outerRot.value}deg` }],
  }));
  const innerSpin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${innerRot.value}deg` }],
  }));

  const PAD = 14;
  const SZ = avatarSize + PAD * 2;
  const STROKE = 1.5;
  const R_O = (SZ - STROKE) / 2 - 2;
  const R_I = R_O - 7;
  const C_O = 2 * Math.PI * R_O;
  const C_I = 2 * Math.PI * R_I;
  const gradId = `pag_${colour.replace('#', '')}`;

  return (
    <View style={{
      width: SZ, height: SZ,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: colour,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: isFirst ? 0.85 : 0.5,
      shadowRadius: isFirst ? 22 : 11,
    }}>
      {/* Outer clockwise arc */}
      <Animated.View style={[StyleSheet.absoluteFill, outerSpin]}>
        <Svg width={SZ} height={SZ}>
          <Defs>
            <SvgLinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colourSoft} stopOpacity="1" />
              <Stop offset="1" stopColor={colour} stopOpacity="0.1" />
            </SvgLinearGradient>
          </Defs>
          <Circle cx={SZ / 2} cy={SZ / 2} r={R_O} stroke="rgba(255,255,255,0.05)" strokeWidth={STROKE} fill="none" />
          <Circle
            cx={SZ / 2} cy={SZ / 2} r={R_O}
            stroke={`url(#${gradId})`}
            strokeWidth={STROKE} strokeLinecap="round" fill="none"
            strokeDasharray={`${C_O * 0.72} ${C_O * 0.28}`}
            transform={`rotate(-90 ${SZ / 2} ${SZ / 2})`}
          />
        </Svg>
      </Animated.View>

      {/* Inner counter-clockwise arc */}
      <Animated.View style={[StyleSheet.absoluteFill, innerSpin]}>
        <Svg width={SZ} height={SZ}>
          <Circle cx={SZ / 2} cy={SZ / 2} r={R_I} stroke="rgba(255,255,255,0.04)" strokeWidth={STROKE * 0.6} fill="none" />
          <Circle
            cx={SZ / 2} cy={SZ / 2} r={R_I}
            stroke={colour} strokeOpacity={isFirst ? 0.55 : 0.35}
            strokeWidth={STROKE * 0.6} strokeLinecap="round" fill="none"
            strokeDasharray={`${C_I * 0.45} ${C_I * 0.55}`}
            transform={`rotate(-90 ${SZ / 2} ${SZ / 2})`}
          />
        </Svg>
      </Animated.View>

      {/* Avatar */}
      {children}
    </View>
  );
}

// ─── RealPodium ───────────────────────────────────────────────────────────────

function RealPodium({
  entries,
  onPress,
}: {
  entries: LeaderboardEntry[];
  onPress: (e: LeaderboardEntry) => void;
}) {
  const order = [entries[1], entries[0], entries[2]]; // 2nd | 1st | 3rd
  const rankOrder = [2, 1, 3] as const;
  const COL_W = Math.floor((SCREEN_W - 32) / 3);

  const META = {
    1: { colour: GOLD,   colourSoft: GOLD_SOFT,   platformH: 108, avatarSize: 72, label: '1ST' },
    2: { colour: SILVER, colourSoft: SILVER_SOFT,  platformH: 74,  avatarSize: 56, label: '2ND' },
    3: { colour: BRONZE, colourSoft: BRONZE_SOFT,  platformH: 54,  avatarSize: 46, label: '3RD' },
  } as const;

  return (
    <View style={{ paddingHorizontal: 16, marginBottom: 4 }}>
      {/* The gold disc that used to sit behind the centre column is gone —
          on a floating board it read as a stray circle rather than a glow.
          The winner still reads first: bigger avatar, trophy, spinning rings. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        {order.map((entry, i) => {
          if (!entry) return <View key={i} style={{ width: COL_W }} />;
          const rank = rankOrder[i] as 1 | 2 | 3;
          const meta = META[rank];
          const isFirst = rank === 1;
          const initials = (entry.display_name ?? entry.username ?? '?')
            .split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
          return (
            <Pressable
              key={entry.user_id}
              style={({ pressed }) => [{ width: COL_W, alignItems: 'center' }, pressed && { opacity: 0.7 }]}
              onPress={() => onPress(entry)}
            >
              {/* Trophy / rank label above avatar */}
              {isFirst ? (
                <Ionicons name="trophy" size={20} color={GOLD} style={{ marginBottom: 6 }} />
              ) : (
                <Text style={{ fontSize: 8, fontWeight: '700', letterSpacing: 2, color: meta.colour, opacity: 0.7, marginBottom: 8 }}>
                  {meta.label}
                </Text>
              )}

              {/* Avatar with spinning placement rings */}
              <View style={{ marginBottom: 6 }}>
                <PodiumAvatarRing
                  avatarSize={meta.avatarSize}
                  colour={meta.colour}
                  colourSoft={meta.colourSoft}
                  isFirst={isFirst}
                >
                  <View style={{
                    width: meta.avatarSize, height: meta.avatarSize,
                    borderRadius: meta.avatarSize / 2, overflow: 'hidden',
                    borderWidth: isFirst ? 2 : 1.5,
                    borderColor: meta.colour,
                  }}>
                    {entry.avatar_url ? (
                      <Image source={{ uri: entry.avatar_url }} style={{ flex: 1 }} contentFit="cover" />
                    ) : (
                      <View style={{ flex: 1, backgroundColor: CARD_BG, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: meta.avatarSize * 0.3, fontWeight: '500', color: meta.colour }}>
                          {initials}
                        </Text>
                      </View>
                    )}
                  </View>
                </PodiumAvatarRing>
              </View>

              {/* Name */}
              <Text numberOfLines={1} style={{
                fontSize: isFirst ? 12 : 10,
                fontWeight: isFirst ? '400' : '300',
                color: isFirst ? TEXT : DIM,
                maxWidth: COL_W - 8,
                textAlign: 'center',
                marginBottom: 10,
              }}>
                {entry.display_name ?? entry.username ?? 'Unknown'}
              </Text>

              {/* Platform with gradient */}
              <LinearGradient
                colors={[`${meta.colour}22`, `${meta.colour}06`]}
                style={{
                  width: COL_W,
                  height: meta.platformH,
                  borderTopLeftRadius: 8,
                  borderTopRightRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  borderTopWidth: 2,
                  borderTopColor: meta.colour,
                }}
              >
                <Text style={{
                  fontSize: isFirst ? 17 : 13,
                  fontWeight: '200',
                  color: meta.colour,
                  letterSpacing: -0.5,
                }}>
                  {entry.points.toLocaleString()}
                </Text>
                <Text style={{ fontSize: 7, fontWeight: '800', color: meta.colour, opacity: 0.5, letterSpacing: 2 }}>PTS</Text>
                {isFirst && (
                  <Text style={{ fontSize: 7, fontWeight: '700', color: meta.colour, opacity: 0.7, letterSpacing: 2, marginTop: 4 }}>CHAMPION</Text>
                )}
              </LinearGradient>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── NearYouSection ───────────────────────────────────────────────────────────

function NearYouSection({
  entries,
  myEntry,
  metric,
  onPress,
  showPro,
}: {
  entries: LeaderboardEntry[];
  myEntry: LeaderboardEntry;
  metric: LeaderboardMetric;
  onPress: (e: LeaderboardEntry) => void;
  showPro: boolean;
}) {
  const myIdx = entries.findIndex(e => e.user_id === myEntry.user_id);
  if (myIdx < 0) return null;

  const above = myIdx > 0 ? entries[myIdx - 1] : null;
  const below = myIdx < entries.length - 1 ? entries[myIdx + 1] : null;
  const aboveAbove = myIdx > 1 ? entries[myIdx - 2] : null;
  const belowBelow = myIdx < entries.length - 2 ? entries[myIdx + 2] : null;

  const gapUp = above ? above.points - myEntry.points : null;
  const gapDown = below ? myEntry.points - below.points : null;

  const isChampion = myEntry.rank === 1;
  const isTop3 = myEntry.rank <= 3;

  return (
    <>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>NEAR YOU</Text>
        <View style={styles.sectionLine} />
      </View>

      {/* Hero rank card with gap ticker */}
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View>
            <Text style={styles.heroLabel}>YOUR RANK</Text>
            <View style={styles.heroRankRow}>
              <Text style={styles.heroRankHash}>#</Text>
              <Text style={styles.heroRankNum}>{myEntry.rank}</Text>
              <Text style={styles.heroRankOf}>of {entries.length}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.heroPts}>{myEntry.points.toLocaleString()}</Text>
            <Text style={styles.heroPtsLabel}>
              PTS {metric === 'weekly' ? 'THIS WEEK' : 'ALL TIME'}
            </Text>
          </View>
        </View>

        {/* Gap tickers */}
        {(gapUp !== null || gapDown !== null) && (
          <View style={styles.gapTickerRow}>
            {gapUp !== null && above && gapUp > 0 && (
              <View style={styles.gapTicker}>
                <Ionicons name="arrow-up" size={11} color={GOLD} />
                <Text style={styles.gapTickerText}>
                  <Text style={styles.gapTickerNum}>{gapUp.toLocaleString()}</Text>
                  <Text> pts to catch </Text>
                  <Text style={styles.gapTickerName}>{firstName(above)}</Text>
                </Text>
              </View>
            )}
            {gapDown !== null && below && gapDown > 0 && (
              <View style={styles.gapTickerAhead}>
                <Ionicons name="shield-checkmark" size={10} color={GREEN} />
                <Text style={styles.gapTickerTextAhead}>
                  <Text style={styles.gapTickerNumAhead}>{gapDown.toLocaleString()}</Text>
                  <Text> pts ahead of </Text>
                  <Text style={styles.gapTickerNameAhead}>{firstName(below)}</Text>
                </Text>
              </View>
            )}
            {isChampion && (
              <View style={styles.gapTickerAhead}>
                <Ionicons name="trophy" size={10} color={GOLD} />
                <Text style={[styles.gapTickerTextAhead, { color: GOLD }]}>
                  <Text style={{ fontWeight: '700' }}>CHAMPION</Text>
                  <Text> — nobody to catch</Text>
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Mini ladder: 2 above + you + 2 below */}
      {!isTop3 && (above || below) && (
        <View style={styles.ladderCard}>
          {[aboveAbove, above, myEntry, below, belowBelow]
            .filter((e): e is LeaderboardEntry => !!e)
            .map((entry, idx, arr) => {
              const isMe = entry.user_id === myEntry.user_id;
              return (
                <React.Fragment key={entry.user_id}>
                  <Pressable
                    onPress={() => !isMe && onPress(entry)}
                    style={({ pressed }) => [pressed && !isMe && { opacity: 0.6 }]}
                  >
                    <LadderRow entry={entry} isMe={isMe} showPro={showPro} />
                  </Pressable>
                  {idx < arr.length - 1 && <View style={styles.ladderDivider} />}
                </React.Fragment>
              );
            })}
        </View>
      )}
    </>
  );
}

function firstName(entry: LeaderboardEntry): string {
  const name = entry.display_name ?? entry.username ?? 'them';
  return name.split(' ')[0];
}

// ─── LadderRow (compact mini-row for Near You ladder) ─────────────────────────

function LadderRow({
  entry,
  isMe,
  showPro,
}: {
  entry: LeaderboardEntry;
  isMe: boolean;
  showPro: boolean;
}) {
  const initials = (entry.display_name ?? entry.username ?? '?')
    .split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <View style={[styles.ladderRow, isMe && styles.ladderRowMe]}>
      <Text style={[styles.ladderRank, isMe && styles.ladderRankMe]}>#{entry.rank}</Text>
      <View style={[styles.ladderAvatar, isMe && { borderColor: GOLD, borderWidth: 1.5 }]}>
        {entry.avatar_url ? (
          <Image source={{ uri: entry.avatar_url }} style={{ flex: 1 }} contentFit="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_BG }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: isMe ? GOLD : DIM }}>{initials}</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[styles.ladderName, isMe && styles.ladderNameMe]} numberOfLines={1}>
          {entry.display_name ?? entry.username ?? 'Unknown'}{isMe ? ' (You)' : ''}
        </Text>
        {showPro && entry.is_pro && <ProBadge size="sm" />}
      </View>
      <Text style={[styles.ladderPts, isMe && styles.ladderPtsMe]}>
        {entry.points.toLocaleString()}
      </Text>
    </View>
  );
}

// ─── RealLeaderRow ────────────────────────────────────────────────────────────

function RealLeaderRow({
  entry,
  isMe,
  showPro,
}: {
  entry: LeaderboardEntry;
  isMe: boolean;
  showPro: boolean;
}) {
  const initials = (entry.display_name ?? entry.username ?? '?')
    .split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  const MEDAL: Record<number, string> = { 1: GOLD, 2: SILVER, 3: BRONZE };
  const isTop = entry.rank <= 3;
  const accentColor = isTop ? MEDAL[entry.rank] : (isMe ? GOLD : MUTED);

  return (
    <View style={[
      styles.leaderRow,
      isMe && styles.leaderRowMe,
      isTop && { borderLeftWidth: 2, borderLeftColor: `${accentColor}55`, paddingLeft: 14 },
    ]}>
      {/* Rank badge */}
      <View style={[
        styles.leaderRankBadge,
        (isTop || isMe) && { backgroundColor: `${accentColor}14`, borderWidth: 1, borderColor: `${accentColor}35` },
      ]}>
        <Text style={[styles.leaderRank, { color: accentColor }]}>{entry.rank}</Text>
      </View>

      {/* Avatar */}
      <View style={[
        styles.leaderAvatar,
        isTop && { borderWidth: 1.5, borderColor: `${accentColor}50` },
        isMe && !isTop && { borderWidth: 1, borderColor: `${GOLD}30` },
      ]}>
        {entry.avatar_url ? (
          <Image source={{ uri: entry.avatar_url }} style={{ flex: 1 }} contentFit="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_BG }}>
            <Text style={{ fontSize: 15, fontWeight: '500', color: isTop ? accentColor : DIM }}>{initials}</Text>
          </View>
        )}
      </View>

      {/* Name + pro badge */}
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          style={[styles.leaderName, isMe && styles.leaderNameMe, isTop && { color: TEXT, fontWeight: '400' }]}
          numberOfLines={1}
        >
          {entry.display_name ?? entry.username ?? 'Unknown'}
          {isMe ? ' (You)' : ''}
        </Text>
        {showPro && entry.is_pro && <ProBadge size="sm" />}
      </View>

      {/* Points */}
      <View style={{ alignItems: 'flex-end', gap: 1 }}>
        <Text style={[styles.leaderPts, { color: accentColor }]}>
          {entry.points.toLocaleString()}
        </Text>
        <Text style={{ fontSize: 7, fontWeight: '700', color: MUTED, letterSpacing: 1.5 }}>PTS</Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:  { flex: 1 },
  header: {
    paddingHorizontal: 16, paddingVertical: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  title: { fontSize: 28, fontWeight: '200', letterSpacing: -0.4, color: TEXT },

  // ── Top tab bar
  topTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    position: 'relative',
  },
  topTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  topTabText: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: MUTED,
    textTransform: 'uppercase',
  },
  topTabTextActive: {
    color: TEXT,
    fontWeight: '500',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: TAB_W,
    height: 1.5,
    backgroundColor: GOLD,
    borderRadius: 1,
  },

  // ── Paged content
  pager: { flex: 1 },
  page:  { width: SCREEN_W },
  pageContent: { paddingHorizontal: 10, paddingTop: 2, gap: 8 },

  // ── Section label (matches home/progress)
  sectionLabel: {
    paddingHorizontal: 14,
    paddingTop: 4,
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 2,
    color: TEXT,
    textTransform: 'uppercase',
  },

  // ── Hero rank (open, no card bg — like home streak area)
  heroSection: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  leagueHeroRow:   { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  leagueHeroLeft:  { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  leagueHeroRank:  { fontSize: 56, fontWeight: '100', letterSpacing: -2, lineHeight: 54 },
  leagueHeroMeta:  { paddingBottom: 4, gap: 2 },
  leagueHeroLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 2, color: MUTED, textTransform: 'uppercase' },
  leagueHeroSub:   { fontSize: 12, fontWeight: '300', color: DIM },

  // ── Countdown badge
  countdownBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    backgroundColor: 'rgba(40,40,40,0.5)', borderWidth: 1, borderColor: BORDER,
  },
  countdownBadgeUrgent: { borderColor: 'rgba(251,146,60,0.35)', backgroundColor: 'rgba(251,146,60,0.08)' },
  countdownDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: '#fb923c' },
  countdownText: { fontSize: 11, fontWeight: '400', color: DIM, letterSpacing: 0.2 },

  // ── Promo card
  promoCard: {
    borderRadius: 16, backgroundColor: CARD_BG,
    borderWidth: 1, borderColor: BORDER,
    padding: 14, gap: 6, overflow: 'hidden',
  },
  promoLabelRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  promoLabel:      { fontSize: 8, fontWeight: '600', letterSpacing: 1.5, color: MUTED },
  promoXpFraction: { fontSize: 12, fontWeight: '300', color: GOLD },
  promoXpDim:      { fontSize: 10, fontWeight: '300', color: DIM },
  promoBarTrack:   { height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  promoBarFill:    { height: '100%', borderRadius: 2 },
  promoHint:       { fontSize: 10, fontWeight: '300', color: MUTED },

  // ── Podium
  podiumRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 14 },
  podiumSlot:     { flex: 1, alignItems: 'center', gap: 5 },
  avatarCircle:   { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontWeight: '500', letterSpacing: 0.5 },
  podiumName:     { fontSize: 11, fontWeight: '400', color: TEXT, textAlign: 'center', letterSpacing: -0.2 },
  podiumXp:       { fontSize: 10, fontWeight: '300', color: MUTED, textAlign: 'center' },
  podiumPlatform: { width: '100%', borderRadius: 8, borderWidth: 1, borderTopWidth: 2, alignItems: 'center', justifyContent: 'center' },
  podiumRankNum:  { fontSize: 20, fontWeight: '100', letterSpacing: -1 },

  // ── Standings card
  standingsCard: {
    borderRadius: 16, backgroundColor: CARD_BG,
    borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden', paddingVertical: 4,
  },
  rowDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.04)', marginHorizontal: 16 },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 16,
    gap: 12,
  },
  leaderRowYou:    { backgroundColor: 'rgba(232,210,0,0.05)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.18)' },
  leaderRowDemote: { borderLeftWidth: 2, borderLeftColor: `${RED}60` },
  leaderRankBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  leaderRank:      { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, color: MUTED, textAlign: 'center' },
  leaderName:      { flex: 1, fontSize: 14, fontWeight: '300', color: DIM },
  leaderNameMe:    { color: TEXT, fontWeight: '400' },
  leaderNameYou:   { color: TEXT, fontWeight: '400' },
  leaderRight:     { flexDirection: 'row', alignItems: 'baseline' },
  leaderXp:        { fontSize: 12, fontWeight: '300', color: MUTED },
  leaderXpUnit:    { fontSize: 10, fontWeight: '300', color: MUTED },

  // ── Leaderboard rows (real data)
  leaderRowMe: { backgroundColor: 'rgba(232,210,0,0.05)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.18)' },
  leaderAvatar: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: CARD_BG },
  leaderPts: { fontSize: 14, fontWeight: '400', color: MUTED },

  // ── Section header with rule
  sectionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 4, gap: 12 },
  sectionLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: BORDER },

  // ── Metric toggle
  metricRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  metricBtn: {
    flex: 1, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', backgroundColor: 'transparent',
  },
  metricBtnActive: { borderColor: GOLD, backgroundColor: 'rgba(232,210,0,0.08)' },
  metricBtnText: { fontSize: 9, fontWeight: '600', letterSpacing: 1.5, color: MUTED },
  metricBtnTextActive: { color: GOLD },

  // ── Empty / loading state
  emptyState: { paddingVertical: 60, alignItems: 'center' },
  emptyText: { fontSize: 12, fontWeight: '300', color: MUTED },

  // ── My rank banner
  myRankBanner: {
    marginHorizontal: 14, marginTop: 8, paddingVertical: 16, paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: 'rgba(232,210,0,0.06)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.2)',
    alignItems: 'center', gap: 2,
  },
  myRankNum:   { fontSize: 44, fontWeight: '100', color: GOLD, letterSpacing: -2, lineHeight: 44 },
  myRankLabel: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.5, letterSpacing: 2.5, textTransform: 'uppercase' },
  myRankPts:   { fontSize: 12, fontWeight: '300', color: GOLD, opacity: 0.7, marginTop: 2 },

  // ── Near You hero card
  heroCard: {
    marginHorizontal: 14,
    marginTop: 4,
    borderRadius: 18,
    backgroundColor: 'rgba(232,210,0,0.06)',
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.22)',
    paddingHorizontal: 18, paddingVertical: 16,
    gap: 14,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  heroLabel: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.6, letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 4 },
  heroRankRow: { flexDirection: 'row', alignItems: 'baseline' },
  heroRankHash: { fontSize: 20, fontWeight: '200', color: GOLD, opacity: 0.5, letterSpacing: -0.5 },
  heroRankNum: { fontSize: 52, fontWeight: '100', color: GOLD, letterSpacing: -2.5, lineHeight: 52 },
  heroRankOf: { fontSize: 10, fontWeight: '500', color: GOLD, opacity: 0.4, marginLeft: 8, letterSpacing: 1 },
  heroPts: { fontSize: 22, fontWeight: '200', color: GOLD, letterSpacing: -0.5, lineHeight: 24 },
  heroPtsLabel: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.5, letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 },

  // ── Gap tickers
  gapTickerRow: {
    borderTopWidth: 1, borderTopColor: 'rgba(232,210,0,0.12)',
    paddingTop: 12,
    gap: 8,
  },
  gapTicker: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
  },
  gapTickerText: { fontSize: 11, fontWeight: '300', color: DIM, flex: 1 },
  gapTickerNum: { fontSize: 12, fontWeight: '600', color: GOLD },
  gapTickerName: { fontWeight: '500', color: TEXT },
  gapTickerAhead: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
  },
  gapTickerTextAhead: { fontSize: 11, fontWeight: '300', color: MUTED, flex: 1 },
  gapTickerNumAhead: { fontSize: 12, fontWeight: '500', color: GREEN, opacity: 0.85 },
  gapTickerNameAhead: { fontWeight: '400', color: DIM },

  // ── Ladder (mini rows around you)
  ladderCard: {
    marginHorizontal: 14, marginTop: 10,
    borderRadius: 14,
    backgroundColor: CARD_BG,
    borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden',
  },
  ladderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 9, paddingHorizontal: 14,
    gap: 10,
  },
  ladderRowMe: {
    backgroundColor: 'rgba(232,210,0,0.08)',
  },
  ladderRank: { width: 30, fontSize: 11, fontWeight: '500', color: MUTED, letterSpacing: 0.3 },
  ladderRankMe: { color: GOLD, fontWeight: '700' },
  ladderAvatar: { width: 30, height: 30, borderRadius: 15, overflow: 'hidden', backgroundColor: CARD_BG },
  ladderName: { fontSize: 12, fontWeight: '300', color: DIM },
  ladderNameMe: { color: TEXT, fontWeight: '500' },
  ladderPts: { fontSize: 12, fontWeight: '400', color: MUTED },
  ladderPtsMe: { color: GOLD, fontWeight: '600' },
  ladderDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.04)', marginHorizontal: 12 },

  // ── Event board (ticket 5)
  // Deliberately no backgroundColor/border: the gated state floats.
  eventGated: {
    marginHorizontal: 14,
    marginTop: 8,
    paddingVertical: 48,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  eventGatedIcon: { opacity: 0.9, marginBottom: 18 },
  eventGatedQuiet: {
    marginHorizontal: 14,
    marginTop: 4,
    paddingVertical: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  eventGatedQuietText: { fontSize: 12, fontWeight: '300', color: DIM, letterSpacing: 0.2 },
  eventGatedTitle: {
    fontSize: 23,
    fontWeight: '200',
    color: TEXT,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  eventGatedTrack: {
    width: 168,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginTop: 18,
    marginBottom: 18,
    // The fill is a child with a % width, so the track has to clip it at the
    // ends rather than let a rounded cap overhang.
    overflow: 'hidden',
  },
  eventGatedFill: { height: 1, backgroundColor: GOLD },
  eventGatedSub: {
    fontSize: 12,
    fontWeight: '300',
    color: DIM,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 290,
  },

  // ── Sealed board ──
  sealedCard: {
    marginHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(14,14,14,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.22)',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
    alignItems: 'center',
  },
  // Outline only — the gold fill made it read as a yellow disc, and the gated
  // state now uses a bare outline lock, so the two lock moments match.
  sealedLockRing: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  sealedEyebrow: { fontSize: 10, fontWeight: '800', color: GOLD, letterSpacing: 3.5, opacity: 0.85 },
  sealedTitle: {
    fontSize: 19,
    fontWeight: '200',
    color: TEXT,
    letterSpacing: -0.3,
    marginTop: 6,
    textAlign: 'center',
    maxWidth: 300,
  },
  sealedRows: { alignSelf: 'stretch', marginTop: 20, gap: 14, position: 'relative' },
  sealedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sealedRank: {
    width: 22,
    fontSize: 15,
    fontWeight: '200',
    color: 'rgba(255,255,255,0.28)',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  sealedRankTop: { color: 'rgba(232,210,0,0.55)', fontWeight: '300' },
  sealedBar: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.07)' },
  sealedBarTop: { backgroundColor: 'rgba(255,255,255,0.11)' },
  sealedPts: { width: 44, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.05)' },
  sealedPtsTop: { backgroundColor: 'rgba(232,210,0,0.14)' },
  sealedFade: { position: 'absolute', left: 0, right: 0, bottom: -6, height: 64 },
  sealedFoot: {
    fontSize: 11,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 18,
    maxWidth: 280,
  },

  // ── Board preview chip + reveal header ──
  boardPreviewChipRow: { alignItems: 'flex-end', marginHorizontal: 14 },
  boardPreviewChip: {
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.6)',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },

  previewSwitcher: {
    marginHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.35)',
    backgroundColor: 'rgba(232,210,0,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  previewSwitcherLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: GOLD,
    letterSpacing: 2,
  },
  previewSwitcherRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  previewSwitcherPill: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 100,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  previewSwitcherPillOn: { backgroundColor: GOLD, borderColor: GOLD },
  previewSwitcherText: { fontSize: 9, fontWeight: '700', color: DIM, letterSpacing: 1.2 },
  previewSwitcherTextOn: { color: '#0a0a0a', fontWeight: '800' },

  previewEmptyNote: {
    marginHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_BG,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  previewEmptyNoteText: { fontSize: 12, fontWeight: '300', color: DIM, lineHeight: 18 },
  boardPreviewChipText: { fontSize: 8, fontWeight: '800', color: GOLD, letterSpacing: 1.5 },
  revealHeader: { alignItems: 'center', marginTop: 4, marginBottom: 2, gap: 10 },
  revealHeaderText: { fontSize: 24, fontWeight: '200', color: TEXT, letterSpacing: -0.5 },
  revealHairline: { width: 46, height: 1, backgroundColor: 'rgba(232,210,0,0.55)' },

  // Floating like the gated state: no fill, no border box. A single gold
  // hairline underneath does the separating, which also ties it to the gold
  // rank numeral sitting on it.
  eventYouBlock: {
    marginHorizontal: 14, marginTop: 4,
    paddingHorizontal: 4, paddingTop: 6, paddingBottom: 18,
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(232,210,0,0.20)',
  },
  eventYouLabel: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.6, letterSpacing: 2.5, marginBottom: 4 },
  eventYouRank: { fontSize: 40, fontWeight: '100', color: GOLD, letterSpacing: -2, lineHeight: 42 },
  eventYouPrize: { fontSize: 12, fontWeight: '500', color: GOLD, marginTop: 4 },

  eventPrizeBlock: {
    marginHorizontal: 18,
    paddingVertical: 8,
    gap: 12,
  },
  // Event board only. standingsCard (the boxed version) stays exactly as it is
  // for the main League leaderboard, which shares it and is not part of this
  // redesign — the event board floats, that surface does not.
  eventStandings: {
    marginHorizontal: 14,
    paddingVertical: 4,
  },
  eventPrizeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eventPrizeRank: { fontSize: 16 },
  eventPrizeName: { fontSize: 13, fontWeight: '400', color: TEXT, maxWidth: 120 },
  eventPrizeLabel: { flex: 1, fontSize: 12, fontWeight: '300', color: DIM, textAlign: 'right' },
});

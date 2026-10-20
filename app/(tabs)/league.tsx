import { memberInitials, memberLabel } from '@/lib/memberName';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GeometricBackground } from '@/components/home/GeometricBackground';
import {
  BackHandler,
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
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Trans, useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeaderActions } from '@/components/HeaderActions';
import { EventPrizeGallery } from '@/components/events/EventPrizeGallery';
import { EventRegisterFlow } from '@/components/events/EventRegisterFlow';
import { EventBoardHeader } from '@/components/league/EventBoardHeader';
import { EventGateStrip } from '@/components/league/EventGateStrip';
import { EventHeaderCard } from '@/components/league/EventHeaderCard';
import { EventTicketCard } from '@/components/league/EventTicketCard';
import { EventHub, EventHubBackButton } from '@/components/league/EventHub';
import { EventSharePanel } from '@/components/league/EventSharePanel';
import { LeaguePreview } from '@/components/league/LeaguePreview';
import { PodiumAvatarRing } from '@/components/league/PodiumAvatarRing';
import { SegmentBar } from '@/components/league/SegmentBar';
import { SeriesHome } from '@/components/series/SeriesHome';
import { SERIES_PROTOTYPE } from '@/lib/dev/seriesPrototype';
import { ProBadge } from '@/components/ui/ProBadge';
import { UserProfileSheet } from '@/components/UserProfileSheet';
import { usePoints } from '@/hooks/usePoints';
import { useLiveEvent } from '@/hooks/useLiveEvent';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { useAuth } from '@/context/AuthContext';
import { fetchLeaderboard, type LeaderboardEntry, type LeaderboardMetric } from '@/lib/api/leaderboard';
import type { BoardPreviewState, EventBoardEntry, EventLeaderboard, LiveEvent } from '@/lib/api/liveEvents';
import {
  countdownParts,
  eventNightLine,
  gateProgress,
  onStartLine,
  rankMove,
  revealMoment,
  shortDate,
  splitStartLine,
} from '@/lib/liveEventDisplay';
import { getLevelInfo } from '@/constants/levels';
import i18n from '@/lib/i18n';

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
const AVATAR_RING = 'rgba(255,255,255,0.14)';
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
  const { t }     = useTranslation();

  const [activeTab, setActiveTab] = useState(0); // 0=Standard, 1=Pro
  const [metric, setMetric] = useState<LeaderboardMetric>('weekly');
  const [standardEntries, setStandardEntries] = useState<LeaderboardEntry[]>([]);
  const [proEntries, setProEntries] = useState<LeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserPoints, setSelectedUserPoints] = useState<number | undefined>(undefined);
  const indicatorX = useSharedValue(0);

  const { tab, event: eventSlug, at: eventPinnedAt } = useLocalSearchParams<{ tab?: string; event?: string; at?: string }>();

  const { weeklyEarned, totalEarned } = usePoints();
  const myPoints = metric === 'weekly' ? weeklyEarned : totalEarned;

  // Board state a preview tester has stepped to. null = whatever the event's
  // admin-set preview_board_state says, which is also what every non-previewer
  // gets — the server ignores this argument for anyone else.
  const [boardPreview, setBoardPreview] = useState<BoardPreviewState | null>(null);

  // Several events can be on at once. With two or more the tab opens on the
  // hub — every event, one card each — and a card opens that event's full
  // page with "All events" to come back. With one there is nothing to choose
  // between, so the tab opens straight on it, as it always did. A Home card,
  // the register flow or a reveal push pins `?event=<slug>` (plus `at`, so
  // tapping the same card twice still re-opens it after backing out).
  const { events: liveEvents, loading: eventsLoading } = useLiveEvents();
  const paramSlug = typeof eventSlug === 'string' ? eventSlug : undefined;
  const [openSlug, setOpenSlug] = useState<string | undefined>(paramSlug);
  useEffect(() => { if (paramSlug) setOpenSlug(paramSlug); }, [paramSlug, eventPinnedAt]);
  const hubMode = liveEvents.length > 1;
  // DEV: the Autumn Series board is the tab's home; an event opens as its own
  // page on top of it, with the same back button the hub uses.
  const seriesHome = SERIES_PROTOTYPE && !LEAGUE_LIVE;
  // The Series names itself under the title, the way an open event does.
  const [seriesSub, setSeriesSub] = useState('');
  const showHub = hubMode && !openSlug;
  // Always resolve an event, even behind the hub: the first card's page is
  // then already loaded, and a single-event tab needs no extra request.
  const shownSlug = openSlug ?? liveEvents[0]?.slug;
  // A preview tester's forced board state belongs to the event it was set on.
  useEffect(() => { setBoardPreview(null); }, [openSlug]);

  // Back to the hub: Android's back button, or tapping the League tab again
  // while an event is open (the usual "tap the tab to go to its top").
  useFocusEffect(useCallback(() => {
    if (!(hubMode || seriesHome) || !openSlug) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpenSlug(undefined);
      return true;
    });
    return () => sub.remove();
  }, [hubMode, seriesHome, openSlug]));
  const navigation = useNavigation();
  useEffect(() => navigation.addListener('tabPress' as never, () => {
    if (navigation.isFocused()) setOpenSlug(undefined);
  }), [navigation]);

  const { event: activeEvent, loading: eventLoading, invites, board: eventBoard } = useLiveEvent(shownSlug, boardPreview);
  const [registerOpen, setRegisterOpen] = useState(false);

  // Event mode is two segments: the LEADERBOARD and the EVENT (hero, prizes,
  // ticket). Which one opens first follows the event, not a fixed order —
  // before scoring the job is "understand it, join it, bring friends"; once
  // the window is open the job is "where am I". A segment the user picked
  // themselves is never overridden by a later payload.
  const [segment, setSegment] = useState<EventSegment>('event');
  const segmentTouched = useRef(false);
  const evStatus = activeEvent?.status;
  const evJoined = activeEvent?.viewer.joined;
  const evScope  = activeEvent?.scope;
  // A different event is a different question — the segment a user chose for
  // one event says nothing about where the next should open.
  const evId = activeEvent?.id;
  useEffect(() => { segmentTouched.current = false; }, [evId]);
  useEffect(() => {
    if (!evStatus || segmentTouched.current) return;
    const inEvent = !!evJoined || evScope === 'global';
    const preWindow = evStatus === 'scheduled' || evStatus === 'announced';
    setSegment(!preWindow && inEvent ? 'board' : 'event');
  }, [evId, evStatus, evJoined, evScope]);
  const pickSegment = (next: EventSegment) => {
    segmentTouched.current = true;
    setSegment(next);
  };

  // The Leaderboard tab only exists while there's a board: from scoring start
  // on (live, sealed, winners). Before that — scheduled or Coming soon — the
  // event page is the whole story, with no tab bar and no empty board behind
  // it. A preview tester forcing a board state counts as a board: the
  // switcher sits on the event page while there's no tab, and a forced state
  // brings the tab with it.
  const boardForced =
    !!eventBoard?.is_preview &&
    (eventBoard.is_locked || !!eventBoard.is_gated || !!eventBoard.standings || !!eventBoard.results);
  const boardRunning =
    !!activeEvent &&
    ((activeEvent.status !== 'scheduled' && activeEvent.status !== 'announced') || boardForced);
  const shownSegment: EventSegment = boardRunning ? segment : 'event';

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

  // The gate, as one line on the board segment: only for someone in the
  // event while invites can still count, and only once the server has told
  // us where they stand (viewer.gate).
  const gateStrip =
    activeEvent && activeEvent.viewer.joined && invitesOpen(activeEvent) && eventBoard?.viewer?.gate
      ? eventBoard.viewer.gate
      : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      {/* ── Screen header ─────────────────────────── */}
      <View style={styles.header}>
        {/* Inside one event from the hub: a round back button where people
            look for one, and the event's name under the title so it's clear
            which event this is and that there's a level above it. */}
        {!LEAGUE_LIVE && (hubMode || seriesHome) && openSlug && (
          <EventHubBackButton onPress={() => setOpenSlug(undefined)} />
        )}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{t('events:league.title')}</Text>
          {!LEAGUE_LIVE && (hubMode || seriesHome) && openSlug && activeEvent && (
            <Text style={styles.titleSub} numberOfLines={1}>{activeEvent.name}</Text>
          )}
          {seriesHome && !openSlug && !!seriesSub && (
            <Text style={styles.titleSub} numberOfLines={1}>{seriesSub}</Text>
          )}
        </View>
        <HeaderActions />
      </View>

      {!LEAGUE_LIVE ? (
        /* Event mode: when an event is configured the tab carries the event.
           Two or more → the hub first (every event, one card each). An open
           event has three blocks, one job each — what the event IS (header),
           how you get onto the board (ticket), and the board itself. No event →
           the between-events preview. Nothing while the list is still
           arriving, so a multi-event tab never flashes one event's page
           before the hub. */
        seriesHome && !openSlug ? (
          <SeriesHome
            events={liveEvents}
            eventRank={activeEvent && activeEvent.slug === liveEvents[0]?.slug ? eventBoard?.viewer?.rank ?? null : null}
            onOpenEvent={slug => setOpenSlug(slug)}
            onHeader={setSeriesSub}
            bottomInset={insets.bottom}
          />
        )
        : eventsLoading && !openSlug ? null
        : showHub ? (
          <EventHub
            events={liveEvents}
            onOpen={e => { setOpenSlug(e.slug); }}
            bottomInset={insets.bottom}
          />
        ) : activeEvent ? (
          <>
            {boardRunning && <EventSegmentBar value={segment} onChange={pickSegment} />}
            {shownSegment === 'board' ? (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 8 }}
                showsVerticalScrollIndicator={false}
              >
                <EventBoardHeader event={activeEvent} />
                {/* The requirement stays in view on the board; the tools to
                    meet it are one tap away on the ticket. */}
                {gateStrip && (
                  <EventGateStrip gate={gateStrip} onPress={() => pickSegment('event')} />
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
                  ticketAbove={!!gateStrip}
                />
              </ScrollView>
            ) : (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 8 }}
                showsVerticalScrollIndicator={false}
              >
                {/* Testers only, before scoring: there's no Leaderboard tab
                    yet, so the walkthrough lives here. Picking a state brings
                    the tab and goes to it. */}
                {activeEvent.is_preview && activeEvent.status === 'scheduled' && !boardRunning && (
                  <BoardPreviewSwitcher
                    value={boardPreview}
                    onChange={next => {
                      setBoardPreview(next);
                      if (next) pickSegment('board');
                    }}
                  />
                )}
                <EventHeaderCard
                  event={activeEvent}
                  onRegister={() => setRegisterOpen(true)}
                />
                {/* What's on the line — its own block, not a footnote inside
                    the hero: artwork gets a gallery, tap opens the spotlight. */}
                <EventPrizeGallery event={activeEvent} />
                {/* The ticket only means anything once you're in the event, and
                    only while there's still time to convert an invite. */}
                {/* Registered (while invites still count): the ticket carries
                    the code, progress and share tools. Everyone else — and
                    every Coming soon event — gets sharing in plain sight. */}
                {activeEvent.viewer.joined && invitesOpen(activeEvent) ? (
                  <EventTicketCard event={activeEvent} invites={invites} />
                ) : (
                  <EventSharePanel event={activeEvent} />
                )}
              </ScrollView>
            )}
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
        ) : eventLoading ? null : (
          /* Between events: the global board sealed with the viewer's own
             starting line, and how a live event works — same two-segment
             shape as event mode, so the tab already looks like what it is
             about to become. */
          <LeaguePreview />
        )
      ) : (
        <>
          {/* Standard / Pro tab bar */}
          <View style={styles.topTabBar}>
            <Pressable style={styles.topTab} onPress={() => goToTab(0)}>
              <Text style={[styles.topTabText, activeTab === 0 && styles.topTabTextActive]}>{t('events:league.standard')}</Text>
            </Pressable>
            <Pressable style={styles.topTab} onPress={() => goToTab(1)}>
              <Text style={[styles.topTabText, activeTab === 1 && styles.topTabTextActive]}>{t('events:league.pro')}</Text>
            </Pressable>
            <Animated.View style={[styles.tabIndicator, indicatorStyle]} />
          </View>

          {/* Weekly / All-time metric toggle */}
          <View style={styles.metricRow}>
            <Pressable
              style={[styles.metricBtn, metric === 'weekly' && styles.metricBtnActive]}
              onPress={() => setMetric('weekly')}
            >
              <Text style={[styles.metricBtnText, metric === 'weekly' && styles.metricBtnTextActive]}>{t('events:league.weekly')}</Text>
            </Pressable>
            <Pressable
              style={[styles.metricBtn, metric === 'alltime' && styles.metricBtnActive]}
              onPress={() => setMetric('alltime')}
            >
              <Text style={[styles.metricBtnText, metric === 'alltime' && styles.metricBtnTextActive]}>{t('events:league.allTime')}</Text>
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
                      <Text style={styles.emptyText}>{t('events:league.loading')}</Text>
                    </View>
                  ) : entries.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyText}>{t('events:league.noEntries')}</Text>
                    </View>
                  ) : (
                    <>
                      {entries.length >= 3 && (
                        <>
                          <View style={styles.sectionRow}>
                            <Text style={styles.sectionLabel}>{t('events:board.top3')}</Text>
                            <View style={styles.sectionLine} />
                          </View>
                          <RealPodium entries={entries.slice(0, 3)} onPress={openUserSheet} />
                        </>
                      )}
                      <View style={styles.sectionRow}>
                        <Text style={styles.sectionLabel}>{t('events:board.standings')}</Text>
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
type EventSegment = 'board' | 'event';

/**
 * LEADERBOARD | EVENT. Same bar as the Standard/Pro one below it in league
 * mode — one indicator, two labels — so the tab doesn't grow a second
 * vocabulary of switches.
 */
function EventSegmentBar({ value, onChange }: { value: EventSegment; onChange: (s: EventSegment) => void }) {
  const { t } = useTranslation();
  return (
    <SegmentBar
      items={EVENT_SEGMENTS.map(item => ({ ...item, label: t(item.label) }))}
      value={value}
      onChange={onChange}
    />
  );
}

/** Labels are keys, resolved at render. */
const EVENT_SEGMENTS: { key: EventSegment; label: string }[] = [
  { key: 'board', label: 'events:league.segments.board' },
  { key: 'event', label: 'events:league.segments.event' },
];

function invitesOpen(event: LiveEvent): boolean {
  // 'locked' stays in: the invite deadline can sit AFTER the lock (FNL:
  // doors close Friday, board locks Thursday night), and in deadline gate
  // mode those hours are exactly when a place is saved or lost.
  if (event.status !== 'scheduled' && event.status !== 'live' && event.status !== 'locked') return false;
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
  const { t } = useTranslation();
  // 'auto' is modelled as null so the app sends nothing and the event's own
  // setting decides — distinct from explicitly forcing 'auto'.
  const options: { label: string; state: BoardPreviewState | null }[] = [
    { label: t('events:previewSwitcher.auto'), state: null },
    { label: t('events:previewSwitcher.gated'), state: 'gated' },
    { label: t('events:previewSwitcher.live'), state: 'live' },
    { label: t('events:previewSwitcher.sealed'), state: 'locked' },
    { label: t('events:previewSwitcher.winners'), state: 'revealed' },
  ];

  return (
    <View style={styles.previewSwitcher}>
      <Text style={styles.previewSwitcherLabel}>{t('events:previewSwitcher.label')}</Text>
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
              accessibilityLabel={t('events:previewSwitcher.a11y', { state: o.label.toLowerCase() })}
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
// the board is live and visible, nothing score-shaped about ANYONE ELSE arrives
// while gated or locked (that absence IS the blur — never fill it client-side),
// and after Reveal the frozen live_event_results snapshot renders as the
// winners card. The one number that does cross the blur is the viewer's own
// `viewer.points` — their total under the event's rules, never a rank — so a
// registrant behind the gate or staring at the seal still sees the week
// counting for them.

const asEntries = (
  rows: EventBoardEntry[] | undefined,
  gateRequired: number | null = null,
): LeaderboardEntry[] =>
  (rows ?? []).map(r => ({
    user_id: r.user_id,
    display_name: r.display_name,
    username: r.username,
    avatar_url: r.avatar_url,
    level: 0,
    is_pro: r.is_pro,
    points: r.points,
    rank: r.rank,
    total_earned: r.total_earned ?? null,
    today_points: r.today_points ?? 0,
    rank_delta: r.rank_delta ?? null,
    gate_count: r.gate_count ?? null,
    gate_required: gateRequired,
  }));

/**
 * The viewer's own total, on its own — the blurred states' answer to "is any
 * of this counting for me?". Same block the live board uses for rank+points,
 * minus the rank: a rank is exactly what the gate and the seal withhold.
 */
function ViewerPointsBlock({ points, note }: { points: number; note: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.eventYouBlock}>
      <View>
        <Text style={styles.eventYouLabel}>{t('events:board.ptsThisWeek')}</Text>
        <Text style={styles.eventYouRank}>{points.toLocaleString()}</Text>
      </View>
      <Text style={styles.eventYouNote}>{note}</Text>
    </View>
  );
}

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
  const { t } = useTranslation();
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
          {t('events:board.previewEmpty')}
        </Text>
      </View>
    ) : null;
  }

  const viewer = board.viewer ?? { eligible: false, joined: false, disqualified: false };

  // Live, but this viewer hasn't met the referral entry gate — the server sent
  // nothing score-shaped (is_gated). The invite card above carries the share
  // tools; this card says what the blur is and how far they've got.
  // Present only for a viewer who is in the event once the window has opened
  // (server decides) — so its absence is the whole "not yours to see" check.
  const ownPoints = typeof viewer.points === 'number' ? viewer.points : null;

  const gate = viewer.gate;
  if (board.is_gated && gate) {
    const have = Math.min(gate.count, gate.required);
    const pct = gate.required > 0 ? Math.max(0, Math.min(1, have / gate.required)) : 0;
    const unlockNote = t('events:board.gate.unlockNote', { required: gate.required });
    // With the ticket on screen the count, the progress line and the share
    // code are all already there — a second "0 of 5" with its own bar under
    // it read as two competing surfaces (field 2026-08-18). Here the board
    // says only what it is waiting for, in one quiet line.
    if (ticketAbove) {
      return (
        <View style={{ gap: 8 }}>
          {ownPoints != null && <ViewerPointsBlock points={ownPoints} note={unlockNote} />}
          <View style={styles.eventGatedQuiet}>
            <Ionicons name="lock-closed-outline" size={13} color={GOLD} style={{ opacity: 0.8 }} />
            <Text style={styles.eventGatedQuietText}>
              {t('events:board.gate.quiet', { required: gate.required })}
            </Text>
          </View>
        </View>
      );
    }
    return (
      // No card: this state is a held breath, and a bordered box makes it look
      // like an error. The content floats on the screen's own background and
      // the hairline is the only structure.
      <View style={{ gap: 8 }}>
      {ownPoints != null && <ViewerPointsBlock points={ownPoints} note={unlockNote} />}
      <View style={styles.eventGated}>
        <Ionicons name="lock-closed-outline" size={30} color={GOLD} style={styles.eventGatedIcon} />

        <Text style={styles.eventGatedTitle}>
          {t('events:board.gate.title', { have, required: gate.required })}
        </Text>

        {/* The count again, as distance rather than a number — the one piece of
            structure the layout gets, so progress reads before the copy does. */}
        <View style={styles.eventGatedTrack}>
          <View style={[styles.eventGatedFill, { width: `${pct * 100}%` }]} />
        </View>

        <Text style={styles.eventGatedSub}>
          {gate.counting === 'conversions'
            ? t('events:board.gate.subConversions', { required: gate.required })
            : t('events:board.gate.sub', { required: gate.required })}
        </Text>
      </View>
      </View>
    );
  }

  // Locked and not yet revealed: the sealed board. The server sent nothing
  // score-shaped — these rows are pure theatre, and that's the point: the
  // board exists, it's full, and nobody gets to see it until the reveal.
  if (!board.standings && !board.results) {
    // Your total is yours to keep watching; the rank is what the seal is for.
    return (
      <View style={{ gap: 8 }}>
        {ownPoints != null && (
          <ViewerPointsBlock points={ownPoints} note={t('events:board.sealedNote')} />
        )}
        <SealedBoard event={event} preview={!!board.is_preview} />
      </View>
    );
  }

  const isWinners = board.results != null;
  // The required side of every row's referral chip — the count rides each row,
  // the requirement is one fact about the event and rides viewer.gate.
  const entries = asEntries(board.results ?? board.standings, gate?.required ?? null);
  // Live: only the race is ranked. Everyone still on zero waits on the start
  // line under it, and the podium keeps open seats rather than putting a 0 on
  // a medal. Frozen results are final and render exactly as settled.
  const { racing, startLine } = isWinners
    ? { racing: entries, startLine: [] as LeaderboardEntry[] }
    : splitStartLine(entries);
  const top3 = racing.slice(0, 3);
  const showPodium = isWinners ? top3.length >= 3 : true;
  const restRows = isWinners ? entries.slice(entries.length >= 3 ? 3 : 0) : racing.slice(3);
  const viewerWaiting = !isWinners && onStartLine(viewer.points);
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
            <Text style={styles.boardPreviewChipText}>
              {entries.some(e => e.user_id.startsWith('00000000-0000-4000-8000'))
                ? t('events:board.previewChipSample')
                : t('events:board.previewChip')}
            </Text>
          </View>
        </View>
      )}

      {/* The reveal moment: one quiet line before the winners appear. */}
      {isWinners && (
        <View style={styles.revealHeader}>
          <Text style={styles.revealHeaderText}>{t('events:board.resultsIn')}</Text>
          <View style={styles.revealHairline} />
        </View>
      )}

      {/* Your rank — server-computed; outside the visible board it still shows */}
      {viewer.rank != null && (
        <View style={{ gap: 6 }}>
        {viewerWaiting ? <StartLineYou /> : (
        <View style={styles.eventYouBlock}>
          <View>
            <Text style={styles.eventYouLabel}>{isWinners ? t('events:board.yourFinalRank') : t('events:board.yourRank')}</Text>
            <View style={styles.heroRankRow}>
              <Text style={styles.heroRankHash}>#</Text>
              <Text style={styles.eventYouRank}>{viewer.rank}</Text>
              {!isWinners && <RankMove delta={viewer.rank_delta} size="lg" />}
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={styles.heroPts}>{(viewer.points ?? 0).toLocaleString()}</Text>
            <Text style={styles.heroPtsLabel}>{t('events:board.ptsThisWeek')}</Text>
            {isWinners && viewer.prize_label && (
              <Text style={styles.eventYouPrize}>🏆 {viewer.prize_label}</Text>
            )}
          </View>
        </View>
        )}
        {/* Deadline-mode gate: on the board now, but the place is only kept
            if the count lands in time. Said once, under the rank it protects. */}
        {!isWinners && gate && !gate.met && gate.mode === 'deadline' && (
          <Text style={styles.eventYouWarn}>
            {/* count picks the plural, n is what's shown (never below one). */}
            {gate.deadline_at
              ? t('events:board.keepPlaceBy', {
                  count: gate.required - gate.count,
                  n: Math.max(1, gate.required - gate.count),
                  date: shortDate(gate.deadline_at),
                })
              : t('events:board.keepPlace', {
                  count: gate.required - gate.count,
                  n: Math.max(1, gate.required - gate.count),
                })}
          </Text>
        )}
        </View>
      )}

      {/* Settled without you: the requirement is why, so say so — a blank
          where your rank was reads as a bug. */}
      {isWinners && viewer.rank == null && viewer.joined && gate && !gate.met && (
        <Text style={styles.eventYouWarn}>
          {gate.counting === 'conversions'
            ? gate.deadline_at
              ? t('events:board.notInFinal.conversionsBy', { required: gate.required, made: gate.count, date: shortDate(gate.deadline_at) })
              : t('events:board.notInFinal.conversions', { required: gate.required, made: gate.count })
            : gate.deadline_at
              ? t('events:board.notInFinal.signupsBy', { required: gate.required, made: gate.count, date: shortDate(gate.deadline_at) })
              : t('events:board.notInFinal.signups', { required: gate.required, made: gate.count })}
        </Text>
      )}

      {entries.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{t('events:board.empty')}</Text>
        </View>
      ) : (
        <>
          {showPodium && (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionLabel}>{isWinners ? t('events:board.winners') : t('events:board.top3')}</Text>
                <View style={styles.sectionLine} />
              </View>
              <RealPodium entries={top3} onPress={pressUser} openSeats={!isWinners} />
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
                    {memberLabel(r.display_name, r.username)}
                  </Text>
                  <Text style={styles.eventPrizeLabel} numberOfLines={1}>{r.prize_label}</Text>
                </View>
              ))}
            </View>
          )}

          {restRows.length > 0 && (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionLabel}>{isWinners ? t('events:board.finalStandings') : t('events:board.standings')}</Text>
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

          {startLine.length > 0 && <StartLineSection rows={startLine} onPress={pressUser} />}
        </>
      )}
    </View>
  );
}

// ─── Start line ───────────────────────────────────────────────────────────────
// Everyone in the event who hasn't scored yet: unranked, and no "0". A column
// of zeros made a fresh board look dead and put people at #19 for not having
// started. Each row breathes a gold dot instead — one slow beat across the
// group, so it reads "live, waiting for the gun". Deliberately not a spinner:
// a spinner says the app is loading, and for someone who never trains it
// would never finish.

function useBreath() {
  const level = useSharedValue(0.25);
  useEffect(() => {
    level.value = withRepeat(
      withTiming(0.9, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [level]);
  return useAnimatedStyle(() => ({ opacity: level.value }));
}

function StartLineSection({
  rows,
  onPress,
}: {
  rows: LeaderboardEntry[];
  onPress: (e: LeaderboardEntry) => void;
}) {
  const breath = useBreath();
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>{t('events:board.startLine.label', { n: rows.length })}</Text>
        <View style={styles.sectionLine} />
      </View>
      <View style={styles.eventStandings}>
        {rows.map((entry, idx, arr) => (
          <Pressable
            key={entry.user_id}
            onPress={() => onPress(entry)}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <StartLineRow entry={entry} breath={breath} />
            {idx < arr.length - 1 && <View style={styles.rowDivider} />}
          </Pressable>
        ))}
      </View>
    </>
  );
}

function StartLineRow({
  entry,
  breath,
}: {
  entry: LeaderboardEntry;
  breath: ReturnType<typeof useBreath>;
}) {
  const { t } = useTranslation();
  const initials = memberInitials(entry.display_name, entry.username);
  return (
    <View
      style={styles.leaderRow}
      accessibilityLabel={t('events:board.startLine.rowA11y', { name: memberLabel(entry.display_name, entry.username) })}
    >
      {/* No rank — the column stays so avatars line up with the race above. */}
      <View style={styles.leaderRankCol}>
        <View style={styles.leaderRankBadge} />
      </View>
      <View style={[styles.leaderAvatarRing, styles.startLineAvatar]}>
        <View style={styles.leaderAvatar}>
          {entry.avatar_url ? (
            <Image source={{ uri: entry.avatar_url }} style={{ flex: 1 }} contentFit="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_BG }}>
              <Text style={{ fontSize: 15, fontWeight: '500', color: DIM }}>{initials}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.leaderName} numberOfLines={1}>
          {memberLabel(entry.display_name, entry.username)}
        </Text>
        <RowMeta entry={entry} showPro={false} />
      </View>
      <GateChip count={entry.gate_count} required={entry.gate_required} />
      <View style={styles.startLineDotCol}>
        <Animated.View style={[styles.breathDot, breath]} />
      </View>
    </View>
  );
}

/** Your block when you're in but haven't scored: no "#9 · 0", just what gets
 *  you onto the board. */
function StartLineYou() {
  const breath = useBreath();
  const { t } = useTranslation();
  return (
    <View style={styles.eventYouBlock}>
      <View style={{ flex: 1 }}>
        <Text style={styles.eventYouLabel}>{t('events:board.startLine.you')}</Text>
        <Text style={styles.startLineYouText}>{t('events:board.startLine.youLine')}</Text>
      </View>
      <Animated.View style={[styles.breathDot, styles.breathDotLg, breath]} />
    </View>
  );
}

// ─── SealedBoard ──────────────────────────────────────────────────────────────
// The locked state a whole venue stares at all event week. Deliberately NOT a
// skeleton loader: the seal is the hero, the reveal has a clock on it, and the
// rows beneath are the prize places under glass — one row per prize, real
// rank numerals, ghost avatars, a light sweeping across bars that carry no
// data, and the prize on the line beside each. No score-shaped data exists
// client-side; every bar is decoration over the server's silence.

// Bar widths per row, top down. An event with no prizes configured still
// gets a board — six anonymous rows fading out — so the seal never sits over
// nothing.
const SEALED_ROWS = [0.62, 0.5, 0.58, 0.44, 0.52, 0.4];
const PRIZE_PILL_W = 132;
const SEAL_SIZE = 76;
const SWEEP_W = 72;

/** Podium tints for the sealed rows — the same three metals the real podium
 *  uses, dimmed: the places exist, the people in them are not yet known. */
const SEALED_TONE: Record<number, { text: string; ring: string }> = {
  1: { text: 'rgba(232,210,0,0.75)', ring: 'rgba(232,210,0,0.5)' },
  2: { text: 'rgba(192,192,192,0.7)', ring: 'rgba(192,192,192,0.45)' },
  3: { text: 'rgba(205,127,50,0.8)', ring: 'rgba(205,127,50,0.5)' },
};

/** Ticks once a second while mounted — the countdown is the only consumer,
 *  so only that leaf re-renders. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * The seal itself: a lock inside two gold arcs turning against each other —
 * the podium rings' motion language, so the board's two hero moments (sealed,
 * then won) visibly belong to one object.
 */
function SealSigil() {
  const outerRot = useSharedValue(0);
  const innerRot = useSharedValue(0);

  useEffect(() => {
    outerRot.value = withRepeat(withTiming(360, { duration: 14000, easing: Easing.linear }), -1, false);
    innerRot.value = withRepeat(withTiming(-360, { duration: 22000, easing: Easing.linear }), -1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outerSpin = useAnimatedStyle(() => ({ transform: [{ rotate: `${outerRot.value}deg` }] }));
  const innerSpin = useAnimatedStyle(() => ({ transform: [{ rotate: `${innerRot.value}deg` }] }));

  const SZ = SEAL_SIZE;
  const R_O = SZ / 2 - 2;
  const R_I = R_O - 8;
  const C_O = 2 * Math.PI * R_O;
  const C_I = 2 * Math.PI * R_I;

  return (
    <View style={styles.sealSigil}>
      <Animated.View style={[StyleSheet.absoluteFill, outerSpin]}>
        <Svg width={SZ} height={SZ}>
          <Defs>
            <SvgLinearGradient id="seal_outer" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={GOLD_SOFT} stopOpacity="1" />
              <Stop offset="1" stopColor={GOLD} stopOpacity="0.05" />
            </SvgLinearGradient>
          </Defs>
          <Circle cx={SZ / 2} cy={SZ / 2} r={R_O} stroke="rgba(232,210,0,0.14)" strokeWidth={1} fill="none" />
          <Circle
            cx={SZ / 2} cy={SZ / 2} r={R_O}
            stroke="url(#seal_outer)"
            strokeWidth={1.5} strokeLinecap="round" fill="none"
            strokeDasharray={`${C_O * 0.62} ${C_O * 0.38}`}
            transform={`rotate(-90 ${SZ / 2} ${SZ / 2})`}
          />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, innerSpin]}>
        <Svg width={SZ} height={SZ}>
          <Circle
            cx={SZ / 2} cy={SZ / 2} r={R_I}
            stroke={GOLD} strokeOpacity={0.35}
            strokeWidth={1} strokeLinecap="round" fill="none"
            strokeDasharray={`${C_I * 0.18} ${C_I * 0.07}`}
          />
        </Svg>
      </Animated.View>
      <View style={styles.sealCore}>
        <Ionicons name="lock-closed" size={20} color={GOLD} />
      </View>
    </View>
  );
}

/**
 * The clock on the reveal. Counts to the doors time — the night — never the
 * scoring window, which is the boundary already behind us once the board is
 * sealed. Above 24h the days take a cell of their own so every cell stays two
 * digits; a date-only doors time counts days alone; no doors time at all and
 * the block says where, not when.
 */
function RevealCountdown({ event }: { event: LiveEvent }) {
  const { t } = useTranslation();
  const now = useNow(1000);
  const moment = revealMoment(event);
  const night = eventNightLine(event);
  const venue = event.venue?.name ?? null;
  const where = [night, venue].filter(Boolean).join(' · ');

  if (!moment) {
    return (
      <View style={styles.sealedWhen}>
        <Text style={styles.sealedWhenLabel}>{t('events:sealed.reveal')}</Text>
        <Text style={styles.sealedWhenBig}>{venue ? t('events:sealed.liveAt', { venue }) : t('events:sealed.liveAtFinal')}</Text>
      </View>
    );
  }

  const remaining = new Date(moment.at).getTime() - now;

  if (!moment.exact) {
    const days = Math.ceil(remaining / 86_400_000);
    const when = days <= 0
      ? t('events:sealed.today')
      : days === 1 ? t('events:sealed.tomorrow') : t('events:sealed.inDays', { days });
    return (
      <View style={styles.sealedWhen}>
        <Text style={styles.sealedWhenLabel}>{t('events:sealed.reveal')}</Text>
        <Text style={styles.sealedWhenBig}>{when}</Text>
        {!!where && <Text style={styles.sealedWhenLine}>{where}</Text>}
      </View>
    );
  }

  const parts = countdownParts(remaining);
  // Doors are open but the seal is still on: the reveal is a manual press on
  // the admin side, so promise it's close, never that it's happening.
  if (parts.total === 0) {
    return (
      <View style={styles.sealedWhen}>
        <Text style={styles.sealedWhenLabel}>{t('events:sealed.reveal')}</Text>
        <Text style={styles.sealedWhenBig}>{t('events:sealed.anyMoment')}</Text>
        {!!where && <Text style={styles.sealedWhenLine}>{where}</Text>}
      </View>
    );
  }

  const cells: [number, string][] = parts.days > 0
    ? [[parts.days, t('events:sealed.units.days')], [parts.hours, t('events:sealed.units.hours')], [parts.minutes, t('events:sealed.units.minutes')]]
    : [[parts.hours, t('events:sealed.units.hours')], [parts.minutes, t('events:sealed.units.minutes')], [parts.seconds, t('events:sealed.units.seconds')]];
  const a11y = parts.days > 0
    ? t('events:sealed.a11yDays', { days: parts.days, hours: parts.hours, minutes: parts.minutes })
    : t('events:sealed.a11yHours', { hours: parts.hours, minutes: parts.minutes, seconds: parts.seconds });

  return (
    <View style={styles.sealedWhen}>
      <Text style={styles.sealedWhenLabel}>{t('events:sealed.revealIn')}</Text>
      <View style={styles.countRow} accessibilityRole="timer" accessibilityLabel={a11y}>
        {cells.map(([n, unit], i) => (
          <React.Fragment key={unit}>
            {i > 0 && <Text style={styles.countColon}>:</Text>}
            <View style={styles.countCell}>
              <Text style={styles.countNum}>{String(n).padStart(2, '0')}</Text>
              <Text style={styles.countUnit}>{unit}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
      {!!where && <Text style={styles.sealedWhenLine}>{where}</Text>}
    </View>
  );
}

function SealedRow({ rank, widthRatio, prize }: { rank: number; widthRatio: number; prize: string | null }) {
  const glow = useSharedValue(0.35);
  // -1 = parked off the left edge, 1 = fully off the right; the bar's real
  // width comes from onLayout because the bars are flex-sized.
  const sweep = useSharedValue(-1);
  const [barW, setBarW] = useState(0);

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
    sweep.value = withDelay(
      600 + rank * 380,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.cubic) }),
          withDelay(2600, withTiming(-1, { duration: 0 })),
        ),
        -1,
        false,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pulse = useAnimatedStyle(() => ({ opacity: glow.value }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -SWEEP_W + ((sweep.value + 1) / 2) * (barW + SWEEP_W) }],
  }));

  const tone = SEALED_TONE[rank];
  const isTop3 = !!tone;

  return (
    <View style={styles.sealedRow}>
      <Text style={[styles.sealedRank, tone && { color: tone.text, fontWeight: '300' }]}>{rank}</Text>
      <View style={[styles.sealedAvatar, tone && { borderColor: tone.ring }]} />
      <View style={styles.sealedBarWrap}>
        <Animated.View
          style={[styles.sealedBar, { flex: widthRatio }, isTop3 && styles.sealedBarTop, pulse]}
          onLayout={e => setBarW(e.nativeEvent.layout.width)}
        >
          <Animated.View style={[styles.sealedSweep, sweepStyle]}>
            <LinearGradient
              colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </Animated.View>
        <View style={{ flex: 1 - widthRatio }} />
      </View>
      {prize ? (
        <View style={styles.sealedPrizeChip}>
          <Text style={styles.sealedPrizeText}>{prize}</Text>
        </View>
      ) : (
        <Animated.View style={[styles.sealedPts, isTop3 && styles.sealedPtsTop, pulse]} />
      )}
    </View>
  );
}

function SealedBoard({ event, preview }: { event: LiveEvent; preview: boolean }) {
  const { t } = useTranslation();
  const prizeFor = (rank: number) => event.prizes.find(p => p.rank === rank)?.label ?? null;
  // The rows ARE the prize positions: rank 1..N for N prizes, every one with
  // its prize on it. Only a prizeless event falls back to the anonymous
  // fading board.
  const prizeRanks = Math.max(0, ...event.prizes.map(p => p.rank));
  const rowCount = prizeRanks > 0 ? Math.min(prizeRanks, SEALED_ROWS.length) : SEALED_ROWS.length;
  const showFade = prizeRanks === 0;

  return (
    <View style={{ gap: 8 }}>
      {preview && (
        <View style={styles.boardPreviewChipRow}>
          <View style={styles.boardPreviewChip}>
            <Text style={styles.boardPreviewChipText}>{t('events:board.previewChip')}</Text>
          </View>
        </View>
      )}
      <View style={styles.sealedCard}>
        {/* Ambient gold behind the seal — a glow painted into the card, not a
            shadow: the design system draws depth with light and borders. */}
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <RadialGradient id="seal_glow" cx="50%" cy="6%" r="42%">
              <Stop offset="0" stopColor={GOLD} stopOpacity="0.16" />
              <Stop offset="0.55" stopColor={GOLD} stopOpacity="0.05" />
              <Stop offset="1" stopColor={GOLD} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#seal_glow)" />
        </Svg>
        <LinearGradient
          colors={['rgba(232,210,0,0)', 'rgba(232,210,0,0.75)', 'rgba(232,210,0,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.sealedHairline}
          pointerEvents="none"
        />

        <SealSigil />
        <Text style={styles.sealedEyebrow}>{t('events:sealed.eyebrow')}</Text>
        <Text style={styles.sealedTitle}>{t('events:sealed.title')}</Text>

        <RevealCountdown event={event} />

        <View style={styles.sealedDivider}>
          <View style={styles.sealedDividerLine} />
          <Text style={styles.sealedDividerText}>{t('events:sealed.divider')}</Text>
          <View style={styles.sealedDividerLine} />
        </View>

        <View style={styles.sealedRows}>
          {SEALED_ROWS.slice(0, rowCount).map((w, i) => (
            <SealedRow key={i} rank={i + 1} widthRatio={w} prize={prizeFor(i + 1)} />
          ))}
          {showFade && (
            <LinearGradient
              colors={['rgba(14,14,14,0)', 'rgba(14,14,14,0.97)']}
              style={styles.sealedFade}
              pointerEvents="none"
            />
          )}
        </View>

        <Text style={styles.sealedFoot}>
          {t('events:sealed.foot')}
        </Text>
      </View>
    </View>
  );
}

// ─── RealPodium ───────────────────────────────────────────────────────────────

function RealPodium({
  entries,
  onPress,
  openSeats = false,
}: {
  entries: LeaderboardEntry[];
  onPress: (e: LeaderboardEntry) => void;
  /** Live board: a place nobody has scored into yet is drawn as an open seat
   *  rather than left blank. Off for frozen results. */
  openSeats?: boolean;
}) {
  const { t } = useTranslation();
  const order = [entries[1], entries[0], entries[2]]; // 2nd | 1st | 3rd
  const rankOrder = [2, 1, 3] as const;
  const COL_W = Math.floor((SCREEN_W - 32) / 3);

  const META = {
    1: { colour: GOLD,   colourSoft: GOLD_SOFT,   platformH: 108, avatarSize: 72, label: t('events:podium.first') },
    2: { colour: SILVER, colourSoft: SILVER_SOFT,  platformH: 74,  avatarSize: 56, label: t('events:podium.second') },
    3: { colour: BRONZE, colourSoft: BRONZE_SOFT,  platformH: 54,  avatarSize: 46, label: t('events:podium.third') },
  } as const;

  return (
    <View style={{ paddingHorizontal: 16, marginBottom: 4 }}>
      {/* The gold disc that used to sit behind the centre column is gone —
          on a floating board it read as a stray circle rather than a glow.
          The winner still reads first: bigger avatar, trophy, spinning rings. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        {order.map((entry, i) => {
          const rank = rankOrder[i] as 1 | 2 | 3;
          const meta = META[rank];
          const isFirst = rank === 1;
          if (!entry) {
            if (!openSeats) return <View key={i} style={{ width: COL_W }} />;
            // An open place: the between-events preview's empty seat — rings
            // still turning, no face — with "Up for grabs" where the name goes
            // and OPEN where the points would be. Never a 0 on a medal.
            return (
              <View
                key={i}
                style={{ width: COL_W, alignItems: 'center' }}
                accessibilityLabel={t('events:podium.openSeatA11y', { place: meta.label })}
              >
                <View style={{ marginBottom: isFirst ? 6 : 8 }}>
                  {isFirst ? (
                    <Ionicons name="trophy" size={20} color={GOLD} style={{ opacity: 0.5 }} />
                  ) : (
                    <Text style={{ fontSize: 8, fontWeight: '700', letterSpacing: 2, color: meta.colour, opacity: 0.7 }}>
                      {meta.label}
                    </Text>
                  )}
                </View>
                <View style={{ marginBottom: 6 }}>
                  <PodiumAvatarRing
                    avatarSize={meta.avatarSize}
                    colour={meta.colour}
                    colourSoft={meta.colourSoft}
                    isFirst={isFirst}
                  >
                    <View style={{
                      width: meta.avatarSize, height: meta.avatarSize,
                      borderRadius: meta.avatarSize / 2,
                      borderWidth: isFirst ? 2 : 1.5,
                      borderColor: `${meta.colour}55`,
                      backgroundColor: CARD_BG,
                    }} />
                  </PodiumAvatarRing>
                </View>
                <Text style={{
                  fontSize: isFirst ? 12 : 10,
                  fontWeight: '300',
                  color: MUTED,
                  marginBottom: 10,
                }}>
                  {t('events:podium.upForGrabs')}
                </Text>
                <LinearGradient
                  colors={[`${meta.colour}14`, `${meta.colour}04`]}
                  style={{
                    width: COL_W,
                    height: meta.platformH,
                    borderTopLeftRadius: 8,
                    borderTopRightRadius: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderTopWidth: 2,
                    borderTopColor: `${meta.colour}66`,
                  }}
                >
                  <Text style={{ fontSize: 8, fontWeight: '800', color: meta.colour, opacity: 0.5, letterSpacing: 2.5 }}>{t('events:podium.open')}</Text>
                </LinearGradient>
              </View>
            );
          }
          const initials = memberInitials(entry.display_name, entry.username);
          return (
            <Pressable
              key={entry.user_id}
              style={({ pressed }) => [{ width: COL_W, alignItems: 'center' }, pressed && { opacity: 0.7 }]}
              onPress={() => onPress(entry)}
            >
              {/* Trophy / rank label above avatar — movement arrow alongside */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: isFirst ? 6 : 8 }}>
                {isFirst ? (
                  <Ionicons name="trophy" size={20} color={GOLD} />
                ) : (
                  <Text style={{ fontSize: 8, fontWeight: '700', letterSpacing: 2, color: meta.colour, opacity: 0.7 }}>
                    {meta.label}
                  </Text>
                )}
                <RankMove delta={entry.rank_delta} />
                <GateChip count={entry.gate_count} required={entry.gate_required} />
              </View>

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
                {memberLabel(entry.display_name, entry.username)}
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
                <Text style={{ fontSize: 7, fontWeight: '800', color: meta.colour, opacity: 0.5, letterSpacing: 2 }}>{t('events:board.pts')}</Text>
                {isFirst && (
                  <Text style={{ fontSize: 7, fontWeight: '700', color: meta.colour, opacity: 0.7, letterSpacing: 2, marginTop: 4 }}>{t('events:podium.champion')}</Text>
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
  const { t } = useTranslation();
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
        <Text style={styles.sectionLabel}>{t('events:league.nearYou')}</Text>
        <View style={styles.sectionLine} />
      </View>

      {/* Hero rank card with gap ticker */}
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View>
            <Text style={styles.heroLabel}>{t('events:board.yourRank')}</Text>
            <View style={styles.heroRankRow}>
              <Text style={styles.heroRankHash}>#</Text>
              <Text style={styles.heroRankNum}>{myEntry.rank}</Text>
              <Text style={styles.heroRankOf}>{t('events:league.rankOf', { total: entries.length })}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.heroPts}>{myEntry.points.toLocaleString()}</Text>
            <Text style={styles.heroPtsLabel}>
              {metric === 'weekly' ? t('events:board.ptsThisWeek') : t('events:league.ptsAllTime')}
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
                  <Trans
                    i18nKey="events:league.gapUp"
                    values={{ gap: gapUp.toLocaleString(), name: firstName(above) }}
                    components={{ num: <Text style={styles.gapTickerNum} />, plain: <Text />, name: <Text style={styles.gapTickerName} /> }}
                  />
                </Text>
              </View>
            )}
            {gapDown !== null && below && gapDown > 0 && (
              <View style={styles.gapTickerAhead}>
                <Ionicons name="shield-checkmark" size={10} color={GREEN} />
                <Text style={styles.gapTickerTextAhead}>
                  <Trans
                    i18nKey="events:league.gapDown"
                    values={{ gap: gapDown.toLocaleString(), name: firstName(below) }}
                    components={{ num: <Text style={styles.gapTickerNumAhead} />, plain: <Text />, name: <Text style={styles.gapTickerNameAhead} /> }}
                  />
                </Text>
              </View>
            )}
            {isChampion && (
              <View style={styles.gapTickerAhead}>
                <Ionicons name="trophy" size={10} color={GOLD} />
                <Text style={[styles.gapTickerTextAhead, { color: GOLD }]}>
                  <Trans
                    i18nKey="events:league.champion"
                    components={{ bold: <Text style={{ fontWeight: '700' }} />, plain: <Text /> }}
                  />
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
  const name = entry.display_name ?? entry.username ?? i18n.t('events:league.them');
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
  const { t } = useTranslation();
  const initials = memberInitials(entry.display_name, entry.username);

  return (
    <View style={[styles.ladderRow, isMe && styles.ladderRowMe]}>
      <View style={styles.ladderRankCol}>
        <Text style={[styles.ladderRank, isMe && styles.ladderRankMe]}>#{entry.rank}</Text>
        <RankMove delta={entry.rank_delta} />
      </View>
      <View style={[styles.ladderAvatar, isMe && { borderColor: GOLD, borderWidth: 1.5 }]}>
        {entry.avatar_url ? (
          <Image source={{ uri: entry.avatar_url }} style={{ flex: 1 }} contentFit="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_BG }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: isMe ? GOLD : DIM }}>{initials}</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.ladderName, isMe && styles.ladderNameMe]} numberOfLines={1}>
          {memberLabel(entry.display_name, entry.username)}{isMe ? t('events:board.youSuffix') : ''}
        </Text>
        <RowMeta entry={entry} showPro={showPro} />
      </View>
      <GateChip count={entry.gate_count} required={entry.gate_required} />
      <Text style={[styles.ladderPts, isMe && styles.ladderPtsMe]}>
        {entry.points.toLocaleString()}
      </Text>
    </View>
  );
}

// ─── Row meta: level pill · pro · today chip ──────────────────────────────────
// Level derives from total_earned (profiles.level is dead — always 1). The
// today chip only renders when > 0, so it reads as "active today" rather than
// a column of zeros. Nothing to show → renders nothing (no phantom gap).

function LevelPill({ totalEarned }: { totalEarned: number }) {
  const { t } = useTranslation();
  const { current } = getLevelInfo(totalEarned);
  return (
    <View style={[styles.levelPill, { backgroundColor: current.pill.bg, borderColor: current.pill.border }]}>
      <Text style={[styles.levelPillText, { color: current.pill.text }]}>{t('events:board.level', { level: current.level })}</Text>
    </View>
  );
}

function TodayChip({ points }: { points: number }) {
  const { t } = useTranslation();
  return (
    <View style={styles.todayChip}>
      <Ionicons name="flash" size={8} color={GREEN} />
      <Text style={styles.todayChipText}>{t('events:board.today', { points: points.toLocaleString() })}</Text>
    </View>
  );
}

/** Referral-gate progress on a board row — "2/3" muted while short, green
 *  with a check once met (6/3 stays green: over-completion is the flex).
 *  Renders nothing when either side is missing, so league rows and gateless
 *  events never grow the chip. */
function GateChip({ count, required }: { count: number | null | undefined; required: number | null | undefined }) {
  const progress = gateProgress(count, required);
  if (!progress) return null;
  return (
    <View style={[styles.gateChip, progress.met && styles.gateChipMet]}>
      <Ionicons
        name={progress.met ? 'checkmark-circle' : 'person-add-outline'}
        size={8}
        color={progress.met ? GREEN : DIM}
      />
      <Text style={[styles.gateChipText, progress.met && styles.gateChipTextMet]}>{progress.label}</Text>
    </View>
  );
}

function RowMeta({ entry, showPro }: { entry: LeaderboardEntry; showPro: boolean }) {
  const hasLevel = entry.total_earned != null;
  const hasPro = showPro && entry.is_pro;
  const hasToday = entry.today_points > 0;
  if (!hasLevel && !hasPro && !hasToday) return null;
  return (
    <View style={styles.rowMeta}>
      {hasLevel && <LevelPill totalEarned={entry.total_earned!} />}
      {hasPro && <ProBadge size="sm" />}
      {hasToday && <TodayChip points={entry.today_points} />}
    </View>
  );
}

// ─── Rank movement: ▲ n / ▼ n ─────────────────────────────────────────────────
// Places moved since the scoring day began — server-computed against the
// reference snapshot (same "today" as the TODAY chip). Held / no reference →
// renders nothing, so only movers draw the eye. Live event boards only: the
// league views never send rank_delta.

function RankMove({ delta, size = 'sm' }: { delta: number | null | undefined; size?: 'sm' | 'lg' }) {
  const move = rankMove(delta);
  if (!move) return null;
  const up = move.dir === 'up';
  const colour = up ? GREEN : RED;
  const lg = size === 'lg';
  return (
    <View style={[styles.rankMove, lg && styles.rankMoveLg, { backgroundColor: `${colour}1A` }]}>
      <Ionicons name={up ? 'caret-up' : 'caret-down'} size={lg ? 12 : 8} color={colour} />
      <Text style={[styles.rankMoveText, lg && styles.rankMoveTextLg, { color: colour }]}>{move.places}</Text>
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
  const { t } = useTranslation();
  const initials = memberInitials(entry.display_name, entry.username);
  const MEDAL: Record<number, string> = { 1: GOLD, 2: SILVER, 3: BRONZE };
  const isTop = entry.rank <= 3;
  const accentColor = isTop ? MEDAL[entry.rank] : (isMe ? GOLD : MUTED);

  return (
    <View style={[
      styles.leaderRow,
      isMe && styles.leaderRowMe,
      isTop && { borderLeftWidth: 2, borderLeftColor: `${accentColor}55`, paddingLeft: 14 },
    ]}>
      {/* Rank badge — movement arrow beneath it (live event boards only) */}
      <View style={styles.leaderRankCol}>
        <View style={[
          styles.leaderRankBadge,
          (isTop || isMe) && { backgroundColor: `${accentColor}14`, borderWidth: 1, borderColor: `${accentColor}35` },
        ]}>
          <Text style={[styles.leaderRank, { color: accentColor }]}>{entry.rank}</Text>
        </View>
        <RankMove delta={entry.rank_delta} />
      </View>

      {/* Avatar — hairline ring on every row; medal / gold ring for top 3 / you */}
      <View style={[
        styles.leaderAvatarRing,
        isTop && { borderColor: `${accentColor}70` },
        isMe && !isTop && { borderColor: `${GOLD}55` },
      ]}>
        <View style={styles.leaderAvatar}>
          {entry.avatar_url ? (
            <Image source={{ uri: entry.avatar_url }} style={{ flex: 1 }} contentFit="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_BG }}>
              <Text style={{ fontSize: 15, fontWeight: '500', color: isTop ? accentColor : DIM }}>{initials}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Name + meta row (level · pro · today) */}
      <View style={{ flex: 1, gap: 4 }}>
        <Text
          style={[styles.leaderName, isMe && styles.leaderNameMe, isTop && { color: TEXT, fontWeight: '400' }]}
          numberOfLines={1}
        >
          {memberLabel(entry.display_name, entry.username)}
          {isMe ? t('events:board.youSuffix') : ''}
        </Text>
        <RowMeta entry={entry} showPro={showPro} />
      </View>

      {/* Referral gate progress, sitting against the points (Jamie 08-31) */}
      <GateChip count={entry.gate_count} required={entry.gate_required} />

      {/* Points */}
      <View style={{ alignItems: 'flex-end', gap: 1 }}>
        <Text style={[styles.leaderPts, { color: accentColor }]}>
          {entry.points.toLocaleString()}
        </Text>
        <Text style={{ fontSize: 7, fontWeight: '700', color: MUTED, letterSpacing: 1.5 }}>{t('events:board.pts')}</Text>
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
  titleBlock: { flex: 1, marginRight: 12 },
  title: { fontSize: 28, fontWeight: '200', letterSpacing: -0.4, color: TEXT },
  titleSub: { fontSize: 12, fontWeight: '400', color: 'rgba(255,255,255,0.6)', marginTop: 1 },

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
  leaderRankCol:   { alignItems: 'center', gap: 3 },
  leaderRankBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  rankMove:        { flexDirection: 'row', alignItems: 'center', gap: 1, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6 },
  rankMoveLg:      { gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginLeft: 8, alignSelf: 'center' },
  rankMoveText:    { fontSize: 8, fontWeight: '700', letterSpacing: 0.3, lineHeight: 10 },
  rankMoveTextLg:  { fontSize: 12, lineHeight: 14 },
  leaderRank:      { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, color: MUTED, textAlign: 'center' },
  leaderName:      { flex: 1, fontSize: 14, fontWeight: '300', color: DIM },
  leaderNameMe:    { color: TEXT, fontWeight: '400' },
  leaderNameYou:   { color: TEXT, fontWeight: '400' },
  leaderRight:     { flexDirection: 'row', alignItems: 'baseline' },
  leaderXp:        { fontSize: 12, fontWeight: '300', color: MUTED },
  leaderXpUnit:    { fontSize: 10, fontWeight: '300', color: MUTED },

  // ── Leaderboard rows (real data)
  leaderRowMe: { backgroundColor: 'rgba(232,210,0,0.05)', borderWidth: 1, borderColor: 'rgba(232,210,0,0.18)' },
  leaderAvatarRing: { width: 48, height: 48, borderRadius: 24, padding: 2, borderWidth: 1, borderColor: AVATAR_RING },
  leaderAvatar: { flex: 1, borderRadius: 21, overflow: 'hidden', backgroundColor: CARD_BG },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  levelPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100, borderWidth: 1 },
  levelPillText: { fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  todayChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100,
    backgroundColor: 'rgba(74,222,128,0.10)', borderWidth: 1, borderColor: 'rgba(74,222,128,0.28)',
  },
  todayChipText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.8, color: GREEN },
  gateChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  gateChipMet: { backgroundColor: 'rgba(74,222,128,0.10)', borderColor: 'rgba(74,222,128,0.28)' },
  gateChipText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.8, color: DIM },
  gateChipTextMet: { color: GREEN },
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
  ladderRankCol: { width: 30, alignItems: 'flex-start', gap: 2 },
  ladderRank: { fontSize: 11, fontWeight: '500', color: MUTED, letterSpacing: 0.3 },
  ladderRankMe: { color: GOLD, fontWeight: '700' },
  ladderAvatar: { width: 30, height: 30, borderRadius: 15, overflow: 'hidden', backgroundColor: CARD_BG, borderWidth: 1, borderColor: AVATAR_RING },
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
    paddingTop: 28,
    paddingBottom: 20,
    alignItems: 'center',
    // Clips the glow and the top hairline to the rounded corners.
    overflow: 'hidden',
  },
  sealedHairline: { position: 'absolute', top: 0, left: 28, right: 28, height: 1 },
  sealSigil: {
    width: SEAL_SIZE,
    height: SEAL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  sealCore: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(232,210,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
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
  // The clock: label, cells, then where. Gold like the viewer's own numbers,
  // so it reads as the event's number rather than a system timer.
  sealedWhen: { alignItems: 'center', marginTop: 20, gap: 6 },
  sealedWhenLabel: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.6, letterSpacing: 2.5 },
  sealedWhenBig: { fontSize: 32, fontWeight: '100', color: GOLD, letterSpacing: -1, lineHeight: 38, textAlign: 'center' },
  sealedWhenLine: { fontSize: 11, fontWeight: '300', color: DIM, letterSpacing: 0.2, textAlign: 'center' },
  countRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
  countCell: { alignItems: 'center', minWidth: 58 },
  countNum: {
    fontSize: 42,
    fontWeight: '100',
    color: GOLD,
    letterSpacing: -1.5,
    lineHeight: 46,
    fontVariant: ['tabular-nums'],
  },
  countUnit: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.5, letterSpacing: 2, marginTop: 2 },
  // Sits on the numeral baseline, not the unit's — hence the bottom pad.
  countColon: { fontSize: 30, fontWeight: '100', color: GOLD, opacity: 0.45, lineHeight: 46, paddingBottom: 14 },
  sealedDivider: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22 },
  sealedDividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(232,210,0,0.28)' },
  sealedDividerText: { fontSize: 8, fontWeight: '800', color: GOLD, opacity: 0.5, letterSpacing: 2.5 },
  sealedRows: { alignSelf: 'stretch', marginTop: 16, gap: 12, position: 'relative' },
  sealedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sealedRank: {
    width: 20,
    fontSize: 15,
    fontWeight: '200',
    color: 'rgba(255,255,255,0.28)',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  // A ghost where the avatar will be — ringed in the place's metal on the
  // podium rows so the seats are visibly the podium, just not yet filled.
  sealedAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  sealedBarWrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  sealedBar: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' },
  sealedBarTop: { backgroundColor: 'rgba(255,255,255,0.11)' },
  sealedSweep: { position: 'absolute', top: 0, bottom: 0, width: SWEEP_W },
  sealedPts: { width: 44, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.05)' },
  sealedPtsTop: { backgroundColor: 'rgba(232,210,0,0.14)' },
  // One width for every pill so the column lines up; the label wraps rather
  // than truncates — a prize nobody can read is not on the line.
  sealedPrizeChip: {
    width: PRIZE_PILL_W,
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.35)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(232,210,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sealedPrizeText: { fontSize: 9, fontWeight: '700', color: GOLD, letterSpacing: 0.4, textAlign: 'center', lineHeight: 12 },
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
  startLineYouText: { fontSize: 19, fontWeight: '200', color: TEXT, letterSpacing: -0.3, lineHeight: 25, paddingRight: 16 },
  startLineAvatar: { opacity: 0.8 },
  startLineDotCol: { width: 24, alignItems: 'flex-end', justifyContent: 'center' },
  breathDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
  breathDotLg: { width: 8, height: 8, borderRadius: 4, alignSelf: 'center' },
  // Right-hand note in ViewerPointsBlock — why there's no rank next to the
  // number. Quiet on purpose: the number is the content, this is the caption.
  // Deadline-mode caution under the rank block: the place exists, the
  // condition to keep it doesn't yet. Gold so it reads as the event
  // talking, not an error.
  eventYouWarn: {
    marginHorizontal: 18,
    fontSize: 11,
    fontWeight: '400',
    color: GOLD,
    opacity: 0.85,
    lineHeight: 15,
  },
  eventYouNote: {
    flex: 1,
    marginLeft: 16,
    textAlign: 'right',
    fontSize: 11,
    fontWeight: '300',
    color: DIM,
    lineHeight: 15,
  },

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

import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import GeometricBackground from '@/components/GeometricBackground';
import { VaultPotDoor } from '@/components/vault/VaultPotDoor';
import { VaultTimer } from '@/components/vault/VaultTimer';
import { UNLOCK_DIAL_SIZE, VaultUnlockButton } from '@/components/vault/VaultUnlockButton';
import {
  ACCENT,
  ACCENT_DIM,
  ACCENT_SOFT,
  DIM,
  MUTED,
  POT_BG,
  POT_BORDER,
  POT_SURFACE,
  TEXT,
} from '@/components/vault/potTokens';
import { LEVELS, TIER_META, VAULT_LEVEL_BONUS, getLevelInfo, type LevelTier } from '@/constants/levels';
import { useAuth } from '@/context/AuthContext';
import { usePoints } from '@/hooks/usePoints';
import { useRollingNumber } from '@/hooks/useRollingNumber';
import { useVaultAccess, useVaultLaunch } from '@/hooks/useVaultAccess';
import {
  claimVaultDeposits,
  fetchVaultContents,
  fetchVaultOutlook,
  isVaultGated,
  type VaultDeposit,
  type VaultOutlook,
} from '@/lib/api/vault';
import { supabase } from '@/lib/supabase';

// Same dev account that gets the level-up celebration replay (useLevelUp) and
// the claim-points cap bypass — mirrored server-side in dev_rearm_vault().
const DEV_TEST_EMAILS = new Set(['jamiemasonwright@gmail.com']);

const DEFAULT_VEST_DAYS = 60;

const HOLD_MS = 1400;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Floor, not ceil: the timer counts down in whole days plus a live clock, so
// 17d 23:56 has to read as 17 everywhere. Rounding up here put "18 days" on the
// rail directly beneath a door showing 17.
function daysUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 86400000));
}

function unlockCopy(iso: string): string {
  if (new Date(iso).getTime() <= Date.now()) return 'Ready to unlock';
  const days = daysUntil(iso);
  // Flooring means 0 covers "some hours left", which is not the same as ready.
  if (days === 0) return 'Unlocks today';
  if (days === 1) return 'Unlocks tomorrow';
  return `Unlocks in ${days} days`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "Friday 24 Jul" — a scheduled unlock reads as an occasion, not a timestamp. */
function occasionDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'short',
  });
}

function depositLabel(d: VaultDeposit): string {
  if (d.source === 'level_up' && d.level) {
    const def = LEVELS.find((l) => l.level === d.level);
    return def ? `Level ${d.level} — ${def.name}` : `Level ${d.level} bonus`;
  }
  return d.description ?? (d.source === 'admin_grant' ? 'POWR drop' : 'Bonus points');
}

function depositSub(d: VaultDeposit): string {
  if (d.source === 'level_up') return 'Level-up bonus';
  if (d.source === 'admin_grant') return 'Bonus drop from POWR';
  return 'Earned over the daily cap';
}

// ─── Aggregate pot hero ──────────────────────────────────────────────────────

/**
 * The Vault as one pot. The door stands for the whole vault rather than any
 * single deposit — so the porthole figure is everything still held, and the
 * timer beneath it tracks only the SOONEST deposit, which is the one claim the
 * screen can make truthfully when deposits mature on different days.
 *
 * Three states:
 *  - VESTING: bolts thrown, live timer, rail across the soonest pot's window.
 *  - READY: something has matured — hold the dial on the door to draw the bolts.
 *  - UNLOCKED: the payout, with the balance rolling up underneath.
 *
 * The door scrolls WITH this content. It was briefly pinned and collapsing at
 * the top of the screen; that was dropped because a shrinking door tracking the
 * scroll read worse than one that simply scrolls away. If sticky is ever
 * revisited, the hard part is the backdrop — see git history for the three
 * attempts (no backdrop shows rows through the door's transparent corners; a
 * flat fill seams against the diagonal page gradient; a clipped copy of
 * GeometricBackground is the one that worked).
 */
function VaultPotHero({
  pending,
  totalPending,
  balance,
  balanceReady,
  level,
  totalEarned,
  loading,
  outlook,
  onClaim,
}: {
  pending: VaultDeposit[];
  totalPending: number;
  balance: number;
  balanceReady: boolean;
  /** Drives the level artwork sitting behind the payout in the chamber. */
  level: number;
  /** Lifetime earned — the level basis, used for "POWR to go" to an unlock level. */
  totalEarned: number;
  /** Deposits still in flight — say nothing rather than something wrong. */
  loading: boolean;
  /** Grace window + any scheduled Vault Day. Null while loading or on failure. */
  outlook: VaultOutlook | null;
  onClaim: () => Promise<number>;
}) {
  const { width } = useWindowDimensions();
  // The 3D door renders into a square GL viewport.
  const doorSize = Math.min(width - 32, 420);
  const [unlockedPoints, setUnlockedPoints] = useState<number | null>(null);
  const [claiming, setClaiming] = useState(false);
  // A hold that doesn't pay out has to SAY so. This used to unwind in silence:
  // offline, or sealed by a level floor the screen didn't know about, the dial
  // filled, the door did nothing, and there was no explanation anywhere.
  const [claimError, setClaimError] = useState<string | null>(null);

  const dueTotal = pending
    .filter((d) => new Date(d.vests_at).getTime() <= Date.now())
    .reduce((s, d) => s + d.amount, 0);
  // Not-yet-due only: correct both before the claim refetch (due rows excluded
  // here) and after it (due rows are gone from `pending` entirely).
  const remainingVesting = pending
    .filter((d) => new Date(d.vests_at).getTime() > Date.now())
    .reduce((s, d) => s + d.amount, 0);
  const soonest = pending.find((d) => new Date(d.vests_at).getTime() > Date.now()) ?? null;

  // Sealed by the level floor. The server owns the decision (it enforces the
  // same threshold on both the claim RPC and the auto-release sweep); the
  // client only works out how far off the level is, so the two can't disagree
  // about WHETHER you're gated — only about the encouragement.
  const gated = isVaultGated(outlook);
  const gateGap = (() => {
    if (!gated || !outlook) return null;
    const xpMin = LEVELS.find((l) => l.level === outlook.minLevel)?.xpMin;
    return {
      level: outlook.minLevel,
      toGo: xpMin == null ? 0 : Math.max(0, xpMin - totalEarned),
    };
  })();

  // A gated vault never offers the control — matured POWR is real, but it
  // cannot leave yet, and a dial that throws VAULT_LOCKED_LEVEL on hold is a
  // worse answer than a door that plainly says what opens it.
  const ready = dueTotal > 0 && unlockedPoints === null && !gated;
  const opened = unlockedPoints !== null;

  const displayBalance = useRollingNumber(balance, balanceReady);

  // ── Hold-to-unlock ──
  // The hold drives the door mechanism, glow and the progress bar as straight
  // Animated interpolations — no listener, no per-tick re-renders. The old SVG
  // door re-rendered ~40 filtered nodes per tick and was unusably slow.
  const holdAnim = useRef(new Animated.Value(0)).current;

  const completeUnlock = useCallback(async () => {
    setClaiming(true);
    setClaimError(null);

    const unwind = () =>
      Animated.timing(holdAnim, { toValue: 0, duration: 250, useNativeDriver: false }).start();

    try {
      const points = await onClaim();

      // Nothing was due after all. The grace sweep runs every 15 minutes and
      // can credit a matured deposit between this screen loading and the hold
      // completing — claim_my_vault_deposits then returns {points: 0}. Playing
      // the full ceremony over a "+0" chamber would be a lie about what just
      // happened, so unwind instead and let the refetch onClaim already fired
      // redraw whatever is now true.
      if (points <= 0) {
        unwind();
        setClaimError('That POWR had already moved into your balance.');
      } else {
        // Celebrate only once there is something to celebrate — the success
        // haptic used to fire BEFORE the claim, so a failed unlock still
        // buzzed like a win.
        try {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          // Haptics unavailable (web) — the door opening carries the moment.
        }
        setUnlockedPoints(points);
      }
    } catch (err) {
      unwind();
      // VAULT_LOCKED_LEVEL_n is reachable even though a gated vault hides the
      // dial: `gated` is derived from the outlook query, which returns null on
      // failure, so a flaky fetch puts the control back on screen while the
      // server still refuses. Name the real reason rather than blaming the
      // network for a level floor.
      const message = String((err as { message?: string })?.message ?? '');
      const lockedAtLevel = message.match(/VAULT_LOCKED_LEVEL_(\d+)/)?.[1];
      setClaimError(
        lockedAtLevel
          ? `Your Vault opens at Level ${lockedAtLevel}.`
          : 'Could not unlock just now — check your connection and try again.',
      );
    }
    setClaiming(false);
  }, [holdAnim, onClaim]);

  const startHold = useCallback(() => {
    if (!ready || claiming) return;
    // Clear on the new attempt, not on its result — otherwise the last
    // failure sits under the door for the whole 1.4s of the retry.
    setClaimError(null);
    Haptics.selectionAsync().catch(() => {});
    Animated.timing(holdAnim, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) void completeUnlock();
    });
  }, [ready, claiming, holdAnim, completeUnlock]);

  const cancelHold = useCallback(() => {
    if (claiming || opened) return;
    Animated.timing(holdAnim, { toValue: 0, duration: 220, useNativeDriver: false }).start();
  }, [claiming, opened, holdAnim]);

  // A scheduled Vault Day pulls every still-vesting deposit to READY at its
  // moment, so once one is announced the deposit's own vests_at is no longer
  // when the user gets paid — it is a date that will never arrive. The whole
  // hero (card, rail, timer) has to track the EARLIER of the two or it spends
  // the run-up to the event counting down to the wrong day.
  const vaultDayAt =
    outlook?.nextUnlockAt && soonest && new Date(outlook.nextUnlockAt) < new Date(soonest.vests_at)
      ? outlook.nextUnlockAt
      : null;
  const effectiveUnlockAt = vaultDayAt ?? soonest?.vests_at ?? null;

  // ── The vesting→READY flip has to happen LIVE ──
  // Every gate above is computed from Date.now() at render time, so without a
  // scheduled re-render the countdown reaches 00:00:00 and the screen simply
  // freezes in the vesting state — the dial only appearing after a refocus or
  // remount, which is a dead end at the feature's climactic moment. One timer
  // to the earliest boundary re-renders AND refetches: maturity is also a
  // server-side fact (stamps, grace dates) worth re-reading at the moment it
  // becomes true. Only armed within a day of the boundary — a JS timeout can't
  // be trusted across days anyway, and the focus-driven refetch covers any
  // horizon longer than a single sitting.
  const [, setMaturityTick] = useState(0);
  const heroQueryClient = useQueryClient();
  const nextBoundaryAt = pending
    .map((d) => new Date(d.vests_at).getTime())
    .concat(outlook?.nextUnlockAt ? [new Date(outlook.nextUnlockAt).getTime()] : [])
    .filter((t) => t > Date.now())
    .sort((a, b) => a - b)[0];
  useEffect(() => {
    if (!nextBoundaryAt) return;
    const delay = nextBoundaryAt - Date.now();
    if (delay > 26 * 3600 * 1000) return;
    const id = setTimeout(() => {
      setMaturityTick((t) => t + 1);
      heroQueryClient.invalidateQueries({ queryKey: ['vault'] });
    }, delay + 500);
    return () => clearTimeout(id);
  }, [nextBoundaryAt, heroQueryClient]);

  // Elapsed fraction of the soonest deposit's vest window — the rail's fill.
  let progress = 0;
  if (soonest && effectiveUnlockAt) {
    const start = new Date(soonest.created_at).getTime();
    const end = new Date(effectiveUnlockAt).getTime();
    progress = end > start ? Math.min(1, Math.max(0, (Date.now() - start) / (end - start))) : 1;
  }

  const potCount = pending.length;
  const empty = potCount === 0 && !opened;

  // What sits behind the glass. Once something has matured the porthole tracks
  // the MATURED portion rather than the whole vault, so the figure and the dial
  // that takes it can never disagree; otherwise it is everything held.
  const portholeAmount = ready ? dueTotal : totalPending;

  // ── The timer belongs to no single state ──
  // If anything is still vesting there is a countdown to run, whatever else the
  // screen is doing. It was first built inside the vesting branch, which meant
  // it vanished the moment a deposit matured: READY showed the next unlock as a
  // dead date, and a SEALED vault — which can sit there for weeks — showed
  // nothing at all. The label carries the framing instead, so one timer serves
  // every state.
  const timerLabel = vaultDayAt
    ? 'OPENS IN'
    : ready
      ? `${remainingVesting.toLocaleString()} POWR UNLOCKS IN`
      : opened || gated
        ? 'NEXT UNLOCK IN'
        : 'UNLOCKS IN';

  // The rail is the soonest pot's whole window, which only reads as the story
  // of the screen while that pot IS the story. Once something has matured, or
  // the vault is sealed, the state block above is the answer and a second
  // progress graphic underneath it is just weight.
  const showRail =
    !loading && !empty && !ready && !opened && !gateGap && soonest != null && effectiveUnlockAt != null;

  // Plain vesting puts the timer straight under the door; every other state has
  // a card or a line above it that needs clearing first. READY only counts when
  // it actually renders its one line — with no grace window it renders nothing,
  // and the timer would otherwise clear a block that isn't there.
  const hasStateBlock =
    (ready && outlook?.autoReleaseAt != null) || gateGap != null || opened || vaultDayAt != null;

  return (
    <View style={styles.hero}>
      {/* ⚠ The status pill that used to sit here is gone, but `listContent`
          still needs its paddingTop: that reserves room for the door's recess
          halo, which is clipped by the scroll viewport. The pill was never what
          was holding the halo clear — see VaultRecess. */}

      {/* The door itself is a display, never a control — holding the artwork
          was an invisible affordance, since nothing about a rendered door says
          "press me". The unlock dial below is the control; the door reacts. */}
      <View style={{ width: doorSize, height: doorSize }}>
        <View pointerEvents="none">
          <VaultPotDoor
            size={doorSize}
            amount={portholeAmount}
            ready={ready}
            loading={loading}
            vestProgress={progress}
            open={opened}
            releasedAmount={unlockedPoints}
            level={level}
            glowAnim={holdAnim}
          />
        </View>

        {/* Parked clear of the door's lower-right rim.
            ⚠ Placed by the dial's EDGE, not its centre. The art reaches
            r≈0.353·size; anchoring the CENTRE just outside that still put the
            near edge back on the rim (0px clearance at 388), which is how it
            ended up sitting over the vault. Anchor 0.82/0.86 keeps the near
            edge ~14px off the art, and the vertical figure runs lower than the
            horizontal one because the "HOLD" label hangs below the dial and
            would otherwise ride up over the bolts. */}
        {ready && (
          <View
            style={[
              styles.unlockSlot,
              {
                left: doorSize * 0.82 - UNLOCK_DIAL_SIZE / 2,
                top: doorSize * 0.86 - UNLOCK_DIAL_SIZE / 2,
              },
            ]}
          >
            <VaultUnlockButton
              progress={holdAnim}
              claiming={claiming}
              onPressIn={startHold}
              onPressOut={cancelHold}
            />
          </View>
        )}
      </View>

      {/* Under the door: one thing per state, and never the figure — that is
          behind the glass now. The big POWR headline that used to sit here was
          the same number as the porthole, so what takes its place is the fact
          the porthole CAN'T carry: how long it has left.

          Nothing renders until the deposits land. "Nothing vesting yet"
          against an in-flight query is a claim the screen cannot make, and it
          flips a beat later — worse than a blank. */}
      <View style={styles.below}>
        {loading ? (
          <View style={styles.heroLoading}>
            <ActivityIndicator color={ACCENT} />
          </View>
        ) : empty ? (
          <>
            <Text style={styles.emptyTitle}>Nothing vesting yet</Text>
            <Text style={styles.emptyHint}>
              Level up or push past a daily cap{'\n'}and the bonus banks here.
            </Text>
          </>
        ) : ready ? (
          /* The backstop, stated — and in this state it is the ONLY thing said
             under the door. A "hold the dial to unlock" prompt lived here and
             was cut: the porthole reads MATURED, the dial is lit and labelled
             HOLD, and a line of text explaining a control the eye has already
             found is the kind of caption that makes a screen feel busy.

             vault_auto_release_grace_days is an admin knob that silently
             decides what happens to POWR the user never claims. Leaving it
             unsaid meant a READY door looked like it could be ignored forever,
             and the eventual auto-credit arrived with no explanation. Kept to
             one line; the full "you can't miss it" framing is in the sheet. */
          outlook?.autoReleaseAt ? (
            <Text style={styles.metaLine}>
              Unlocks on its own {shortDate(outlook.autoReleaseAt)}
            </Text>
          ) : null
        ) : gateGap ? (
          /* SEALED. This branch must come before the vesting one: a gated user
             whose POWR has all matured has no `soonest`, so without it the hero
             would render nothing at all under the door — real value on the
             screen with no explanation and a dial that does nothing. The gate
             is also the one state where the dial is deliberately absent, so the
             card has to carry the whole answer: what opens it, and how far. */
          <View style={styles.card}>
            <Text style={styles.cardLabel}>SEALED</Text>
            <Text style={styles.cardHeadline}>LEVEL {gateGap.level}</Text>
            <Text style={styles.cardBody}>
              {dueTotal > 0
                ? `${dueTotal.toLocaleString()} POWR has matured and is waiting. Reach Level ${gateGap.level} to open the Vault.`
                : `Your Vault opens at Level ${gateGap.level}. Everything banked keeps vesting until then.`}
            </Text>
            {/* The reason this is not a punishment, said plainly — vaulted POWR
                counts toward the level that frees it, so the vault is helping
                the user out of the gate rather than holding them behind it.
                Inside the card, not floating under it: the gate is one answer. */}
            <Text style={styles.cardBody}>
              {gateGap.toGo > 0
                ? `${gateGap.toGo.toLocaleString()} POWR to go — everything in here counts toward it.`
                : 'Everything in here counts toward your level.'}
            </Text>
          </View>
        ) : opened ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>BALANCE</Text>
            <Text style={styles.cardHeadline}>{displayBalance.toLocaleString()}</Text>
            {remainingVesting > 0 && (
              <Text style={styles.cardBody}>
                {remainingVesting.toLocaleString()} POWR is still vesting in your Vault.
              </Text>
            )}
          </View>
        ) : vaultDayAt ? (
          /* A scheduled Vault Day is the only thing here worth a card: it is an
             ANNOUNCEMENT, not a status readout. The ordinary next-unlock card
             that used to sit here said nothing the rest of the screen wasn't
             already saying — its date is the rail's right-hand end, its amount
             is the row in the list, and its countdown is the timer directly
             below — so plain vesting gets no card at all. */
          <View style={[styles.card, styles.cardEvent]}>
            <Text style={styles.cardLabel}>
              {(outlook?.nextUnlockNote || 'VAULT DAY').toUpperCase()}
            </Text>
            <Text style={styles.cardHeadline}>{occasionDate(vaultDayAt)}</Text>
            <Text style={styles.cardBody}>
              All {totalPending.toLocaleString()} POWR unlocks early.
            </Text>
          </View>
        ) : null}

        {/* Outside the chain: a failed hold has to be explained whatever state
            the door is in, and the chain above is already spoken for. */}
        {claimError && <Text style={styles.claimError}>{claimError}</Text>}

        {/* Outside the chain above, deliberately: every state that still has
            something vesting gets the countdown, not just the plain one. */}
        {!loading && !empty && effectiveUnlockAt && (
          <VaultTimer
            vestsAt={effectiveUnlockAt}
            startAt={soonest?.created_at ?? null}
            label={timerLabel}
            style={hasStateBlock && styles.timerSpaced}
          />
        )}

        {/* Dates only. This block used to lead with a filled progress rail,
            which — once the timer grew its fuse — was the same fraction drawn
            twice, one above the other. The fuse won (it is tied to the digits
            and reads as time running out rather than a task completing), so
            all that survives here is what it can't say: the two dates. */}
        {showRail && soonest && effectiveUnlockAt && (
          <View style={styles.railBlock}>
            <View style={styles.railLabels}>
              <View style={styles.railEnd}>
                <Text style={styles.railCap}>EARNED</Text>
                <Text style={styles.railDate}>{shortDate(soonest.created_at)}</Text>
              </View>
              <View style={[styles.railEnd, { alignItems: 'flex-end' }]}>
                <Text style={styles.railCap}>{vaultDayAt ? 'OPENS' : 'UNLOCKS'}</Text>
                <Text style={styles.railDate}>{shortDate(effectiveUnlockAt)}</Text>
              </View>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

/** Only ever renders a deposit that is still in the vault — see `sections`. */
function DepositRow({
  deposit,
  vaultDayAt,
  sealedMinLevel,
}: {
  deposit: VaultDeposit;
  /** An announced unlock event pulls EVERY pending deposit forward, so each
      row's date is the earlier of its own vests_at and the event — otherwise
      the list contradicts the Vault Day card directly above it. */
  vaultDayAt: string | null;
  /** Level floor in force: matured POWR cannot leave, so a row must not
      claim "Ready to unlock" while the door above says SEALED. */
  sealedMinLevel: number | null;
}) {
  const isLevel = deposit.source === 'level_up';
  const isGrant = deposit.source === 'admin_grant';

  const effectiveAt =
    vaultDayAt && new Date(vaultDayAt) < new Date(deposit.vests_at)
      ? vaultDayAt
      : deposit.vests_at;
  const matured = new Date(effectiveAt).getTime() <= Date.now();
  const status =
    matured && sealedMinLevel != null
      ? `Sealed until Level ${sealedMinLevel}`
      : unlockCopy(effectiveAt);

  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons
          name={isGrant ? 'gift' : isLevel ? 'trophy' : 'flash'}
          size={16}
          color={ACCENT}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{depositLabel(deposit)}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {status} · {depositSub(deposit)}
        </Text>
      </View>
      <Text style={styles.rowAmount}>+{deposit.amount.toLocaleString()}</Text>
    </View>
  );
}

// ─── Coming soon ─────────────────────────────────────────────────────────────

/**
 * The pre-launch state: same sealed door, counting down to `vault_launch_at`
 * instead of a vest. Shown to users the rollout hasn't reached while a launch
 * is scheduled — the alternative was today's hard-hide, which reads as the
 * feature not existing and then a balance appearing from nowhere on launch day.
 *
 * The DOOR carries the whole announcement: COMING SOON and the countdown run
 * in the porthole (VaultPortholeCountdown via `countdownTo`). An announcement
 * card + timer block used to sit under the door and were cut — Jamie: the
 * vault itself should display it, not an extra text box. What survives below
 * is only what the porthole can't say: the calendar date, the level floor,
 * and the banked total — each one quiet line. No dial — there is nothing to
 * hold for yet.
 *
 * The level floor is stated HERE, pre-launch, for readers it applies to —
 * without it the countdown promises an opening that, for a user below the
 * floor, reveals another lock on the day. Same rule as the info sheet: a
 * user at or past the floor never hears about a restriction they aren't
 * subject to. Level and floor both come off the outlook, the same basis the
 * server enforces, so this line and the launch-day SEALED card can't
 * disagree about who is gated.
 */
function VaultComingSoon({
  launchAt,
  banked,
  loading,
  level,
  outlook,
  bottomInset,
  onInfo,
}: {
  launchAt: string;
  /** Pending vault total from the points summary — the quiet line's figure. */
  banked: number;
  loading: boolean;
  level: number;
  /** Carries the level floor; null while loading or on failure (lines hide). */
  outlook: VaultOutlook | null;
  bottomInset: number;
  onInfo: () => void;
}) {
  const { width } = useWindowDimensions();
  const doorSize = Math.min(width - 32, 420);
  const queryClient = useQueryClient();

  // The moment the countdown lands, ask the server again — vault_has_access
  // flips true as the timestamp passes, so this swaps the screen to the real
  // vault live, without a reopen. Slightly late on purpose: refetching a beat
  // early would cache a still-false answer.
  useEffect(() => {
    const ms = new Date(launchAt).getTime() - Date.now();
    // Beyond a day out there is nothing to arm (setTimeout's int32 ceiling is
    // ~24.8d); any mount closer in re-arms.
    if (ms <= 0 || ms > 24 * 3600 * 1000) return;
    const id = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['vault', 'access'] });
      queryClient.invalidateQueries({ queryKey: ['vault', 'launch'] });
    }, ms + 1500);
    return () => clearTimeout(id);
  }, [launchAt, queryClient]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <VaultPotDoor size={doorSize} countdownTo={launchAt} level={level} />

        <View style={styles.below}>
          <Text style={styles.metaLine}>Opens {occasionDate(launchAt)}</Text>
          {/* Only while the floor applies to this reader — see the docstring. */}
          {isVaultGated(outlook) && (
            <Text style={[styles.metaLine, styles.soonBanked]}>
              Unlocks at{' '}
              <Text style={styles.soonBankedFigure}>Level {outlook!.minLevel}</Text>
              {' '}— you&apos;re Level {outlook!.currentLevel}
            </Text>
          )}
          {/* Banked, not "empty": the economy has been running for this user
              all along, and this line is the tease that makes the countdown
              worth watching. Waits for the load — a zero it can't yet stand
              behind is worse than a beat of silence. The tail is gate-aware:
              "unlocks with the doors" is a false promise below the floor,
              where the honest consolation is the SEALED card's — banked POWR
              is itself the ladder to the level that frees it. */}
          {!loading && banked > 0 && (
            <Text style={[styles.metaLine, styles.soonBanked]}>
              <Text style={styles.soonBankedFigure}>{banked.toLocaleString()} POWR</Text>
              {' '}already banked
              {isVaultGated(outlook)
                ? ' — it all counts toward your level'
                : ' — it unlocks with the doors'}
            </Text>
          )}
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [styles.termsRow, pressed && { opacity: 0.6 }]}
        onPress={onInfo}
      >
        <Text style={styles.termsText}>How the Vault works</Text>
        <Ionicons name="chevron-forward" size={14} color={MUTED} />
      </Pressable>
    </ScrollView>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function VaultScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { vaultPending, balance, totalEarned, loading: pointsLoading } = usePoints();
  const { user } = useAuth();
  const [infoOpen, setInfoOpen] = useState(false);
  const queryClient = useQueryClient();

  // Dev-only unlock replay: dev_rearm_vault() reverses the released deposits
  // (and their payout rows) back to READY; the key bump remounts the hero so
  // its unlocked state resets and the hold can run again.
  const isDevTestUser = DEV_TEST_EMAILS.has(user?.email ?? '');
  const [devKey, setDevKey] = useState(0);
  const [devRearming, setDevRearming] = useState(false);

  const handleDevRearm = useCallback(async () => {
    setDevRearming(true);
    try {
      const { error } = await supabase.rpc('dev_rearm_vault');
      if (!error) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['vault'] }),
          queryClient.invalidateQueries({ queryKey: ['points'] }),
        ]);
        setDevKey((k) => k + 1);
      }
    } finally {
      setDevRearming(false);
    }
  }, [queryClient]);

  // The press-and-hold completion: claim every due deposit, then refresh the
  // vault ledger and every points surface (balance just changed).
  const handleClaim = useCallback(async () => {
    const { points } = await claimVaultDeposits();
    queryClient.invalidateQueries({ queryKey: ['vault'] });
    queryClient.invalidateQueries({ queryKey: ['points'] });
    return points;
  }, [queryClient]);

  // Route guard. The Rewards widget is not the only way in — vault pushes
  // deep-link straight here, and a link outlives the rollout state that created
  // it — so the screen has to check for itself rather than trusting that
  // whoever arrived was shown a door.
  //
  // A scheduled launch turns the bounce into the COMING SOON state instead:
  // outside the rollout but counting down is a screen now, not a dead end.
  // The guard waits for the launch query — access can resolve (false) first,
  // and redirecting in that gap would bounce a user we were about to show the
  // countdown to.
  const vaultEnabled = useVaultAccess();
  const { launchAt, isPending: launchPending } = useVaultLaunch();
  const launchUpcoming = !!launchAt && new Date(launchAt).getTime() > Date.now();
  const comingSoon = !vaultEnabled && launchUpcoming;
  useEffect(() => {
    if (!vaultEnabled && !launchPending && !launchUpcoming) router.replace('/(tabs)/rewards');
  }, [vaultEnabled, launchPending, launchUpcoming, router]);

  const { data, isPending, isError } = useQuery({
    queryKey: ['vault', 'contents'],
    queryFn: fetchVaultContents,
  });

  // Grace window + any scheduled Vault Day. Short staleTime because an admin
  // scheduling an unlock is exactly the kind of change that should reach a
  // user who reopens the screen, not one that waits out an hour-long cache.
  const { data: outlook } = useQuery({
    queryKey: ['vault', 'outlook'],
    queryFn: fetchVaultOutlook,
    staleTime: 60 * 1000,
  });

  // Live vault settings (system_config → vault_*) so the explainer copy and
  // tier pills stay honest when the admin knobs are tuned. Falls back to the
  // shipped schedule on any read failure.
  const { data: vaultConfig } = useQuery({
    queryKey: ['vault', 'config'],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from('system_config')
        .select('key, value')
        .like('key', 'vault\\_%');
      const raw = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
      const num = (key: string, fallback: number) => {
        const parsed = parseInt(raw[key] ?? '', 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
      };
      return {
        vestDays: Math.max(1, num('vault_vest_days', DEFAULT_VEST_DAYS)),
        bonuses: {
          recruit: num('vault_bonus_recruit', VAULT_LEVEL_BONUS.recruit),
          athlete: num('vault_bonus_athlete', VAULT_LEVEL_BONUS.athlete),
          elite: num('vault_bonus_elite', VAULT_LEVEL_BONUS.elite),
          legend: num('vault_bonus_legend', VAULT_LEVEL_BONUS.legend),
        } as Record<LevelTier, number>,
        levelUpEnabled: String(raw['vault_level_up_enabled'] ?? '').trim().toLowerCase() !== 'false',
        capOverflowEnabled: String(raw['vault_cap_overflow_enabled'] ?? '').trim().toLowerCase() !== 'false',
      };
    },
    staleTime: 60 * 60 * 1000,
  });
  const bonuses = vaultConfig?.bonuses ?? VAULT_LEVEL_BONUS;

  const pending = data?.pending ?? [];

  // The list is a tally of what is IN the vault — released deposits have left
  // and are in the spendable balance, so listing them here double-counted the
  // vault's contents by eye. The unlock history lives in the points ledger.
  const sections = pending.length > 0 ? [{ title: 'In the vault', data: pending }] : [];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      <View style={styles.header}>
        <Pressable style={styles.headerBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={TEXT} />
        </Pressable>
        <Text style={styles.headerTitle}>Vault</Text>
        <Pressable style={styles.headerBtn} onPress={() => setInfoOpen(true)} hitSlop={8}>
          <Ionicons name="information-circle-outline" size={20} color={DIM} />
        </Pressable>
      </View>

      {/* ⚠ NOT gated on `isPending`. The door used to sit behind the loading
          spinner, so its GL context, geometry and PMREM pass — ~430ms of work —
          only STARTED once the deposits query came back, and the text appeared
          before the vault did. Mounting it unconditionally runs all of that in
          parallel with the fetch, which is the whole speed-up. The door has
          nothing to say about the data anyway: it is a sealed vault until told
          otherwise. Keep this outside any data gate. */}
      {/* Coming soon outranks the error state: that error belongs to the
          deposits query, which this state doesn't read — a fetch failure must
          not blank a screen that only needs the launch date. */}
      {comingSoon ? (
        <VaultComingSoon
          launchAt={launchAt!}
          banked={vaultPending}
          loading={pointsLoading}
          level={getLevelInfo(totalEarned).current.level}
          outlook={outlook ?? null}
          bottomInset={insets.bottom}
          onInfo={() => setInfoOpen(true)}
        />
      ) : isError ? (
        <View style={styles.centered}><Text style={styles.statusText}>Could not load your Vault.</Text></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => (
            <DepositRow
              deposit={item}
              vaultDayAt={outlook?.nextUnlockAt ?? null}
              sealedMinLevel={isVaultGated(outlook ?? null) ? (outlook?.minLevel ?? null) : null}
            />
          )}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          style={styles.scroll}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <VaultPotHero
              key={devKey}
              pending={pending}
              totalPending={vaultPending}
              level={getLevelInfo(totalEarned).current.level}
              totalEarned={totalEarned}
              balance={balance}
              balanceReady={!pointsLoading}
              loading={isPending}
              outlook={outlook ?? null}
              onClaim={handleClaim}
            />
          }
          ListFooterComponent={
            <>
              {/* Lives at the very bottom, not wedged between the hero and the
                  deposits: the explainer is a destination, and putting it here
                  lets the door run straight into the list. Same sheet as the
                  (i) in the header — this is the discoverable way in. */}
              <Pressable
                style={({ pressed }) => [styles.termsRow, pressed && { opacity: 0.6 }]}
                onPress={() => setInfoOpen(true)}
              >
                <Text style={styles.termsText}>How the Vault works</Text>
                <Ionicons name="chevron-forward" size={14} color={MUTED} />
              </Pressable>

              {isDevTestUser ? (
                <Pressable
                  style={({ pressed }) => [styles.devRearmBtn, pressed && { opacity: 0.7 }]}
                  onPress={handleDevRearm}
                  disabled={devRearming}
                >
                  {devRearming ? (
                    <ActivityIndicator size="small" color={ACCENT} />
                  ) : (
                    <Text style={styles.devRearmText}>DEV · RE-ARM UNLOCK</Text>
                  )}
                </Pressable>
              ) : null}
            </>
          }
        />
      )}

      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <Pressable style={styles.infoBackdrop} onPress={() => setInfoOpen(false)}>
          <Pressable style={styles.infoCard} onPress={() => {}}>
            <Text style={styles.infoTitle}>What banks in the Vault</Text>

            {(vaultConfig?.levelUpEnabled ?? true) && (
              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons name="trophy" size={15} color={ACCENT} />
                </View>
                <View style={styles.infoRowBody}>
                  <Text style={styles.infoRowTitle}>Level-up bonuses</Text>
                  <Text style={styles.infoRowText}>
                    Every level you reach banks a bonus — and the higher the tier, the bigger the drop.
                  </Text>
                  <View style={styles.tierPillRow}>
                    {(Object.keys(bonuses) as LevelTier[]).map((tier) => (
                      <View key={tier} style={styles.tierPill}>
                        <Text style={[styles.tierPillTier, { color: TIER_META[tier].color }]}>
                          {TIER_META[tier].label}
                        </Text>
                        <Text style={styles.tierPillAmount}>+{bonuses[tier]}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {(vaultConfig?.capOverflowEnabled ?? true) && (
              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons name="flash" size={15} color={ACCENT} />
                </View>
                <View style={styles.infoRowBody}>
                  <Text style={styles.infoRowTitle}>Points over the daily cap</Text>
                  <Text style={styles.infoRowText}>
                    Streak multipliers past an activity&apos;s daily cap bank here instead of being lost.
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="time" size={15} color={ACCENT} />
              </View>
              <View style={styles.infoRowBody}>
                <Text style={styles.infoRowTitle}>Vests like savings</Text>
                <Text style={styles.infoRowText}>
                  Deposits vest for {vaultConfig?.vestDays ?? DEFAULT_VEST_DAYS} days, then unlock
                  into your spendable balance. They count towards your level straight away.
                </Text>
              </View>
            </View>

            {/* Only shown while the floor actually applies to this reader.
                Once past it the rule is irrelevant to them, and a modal that
                explains restrictions you are no longer subject to reads as a
                warning rather than an answer. */}
            {isVaultGated(outlook) && (
              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons name="lock-closed" size={15} color={ACCENT} />
                </View>
                <View style={styles.infoRowBody}>
                  <Text style={styles.infoRowTitle}>Opens at Level {outlook!.minLevel}</Text>
                  <Text style={styles.infoRowText}>
                    POWR banks and vests as normal below Level {outlook!.minLevel}, and counts
                    toward your level the whole time — it just can&apos;t be taken out until
                    you get there. Nothing expires.
                  </Text>
                </View>
              </View>
            )}

            {/* The grace window was the one economy knob with no user-facing
                translation at all. Framed as "you can't lose it" rather than
                "claim by X" — the backstop exists to protect the user, and a
                deadline reading would invent an anxiety the mechanic doesn't
                have. Hidden at 0, where there is no window to describe. */}
            {(outlook?.graceDays ?? 0) > 0 && (
              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons name="shield-checkmark" size={15} color={ACCENT} />
                </View>
                <View style={styles.infoRowBody}>
                  <Text style={styles.infoRowTitle}>You can&apos;t miss it</Text>
                  <Text style={styles.infoRowText}>
                    Unlock it yourself for the moment — or leave it. Anything still sitting
                    there {outlook!.graceDays} {outlook!.graceDays === 1 ? 'day' : 'days'} after
                    it matures moves into your balance automatically.
                  </Text>
                </View>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.infoBtn, pressed && { opacity: 0.85 }]}
              onPress={() => setInfoOpen(false)}
            >
              <Text style={styles.infoBtnText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: POT_BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '500', color: TEXT },

  scroll: { flex: 1 },
  // ⚠ paddingTop is NOT cosmetic. The door's recess halo overhangs its box by
  // `RECESS_OVERHANG`, and anything above the top of the list gets hard-clipped
  // by the scroll viewport — which showed up on device as a line under the
  // header. This reserves the room the halo needs. Keep it >= doorSize *
  // RECESS_OVERHANG (max doorSize is 420, so 420 * 0.1 = 42).
  listContent: { paddingHorizontal: 16, paddingTop: 44, flexGrow: 1 },

  hero: { alignItems: 'center', paddingBottom: 4 },
  heroLoading: { height: 96, alignItems: 'center', justifyContent: 'center' },

  // Everything under the door. One wrapper so each state's block sits the same
  // distance from the artwork without every branch carrying its own margin.
  below: { alignSelf: 'stretch', alignItems: 'center', marginTop: 14 },

  emptyTitle: { fontSize: 16, fontWeight: '400', color: TEXT, marginTop: 8 },
  emptyHint: {
    fontSize: 13, fontWeight: '300', color: MUTED, textAlign: 'center',
    lineHeight: 19, marginTop: 4, marginBottom: 22,
  },

  // A scheduled Vault Day is the one card that is an ANNOUNCEMENT rather than
  // a status readout, so it carries the gold treatment the ready card uses.
  cardEvent: { backgroundColor: ACCENT_DIM, borderColor: 'rgba(232,210,0,0.35)' },
  card: {
    alignSelf: 'stretch', alignItems: 'center',
    backgroundColor: POT_SURFACE, borderWidth: 1, borderColor: POT_BORDER,
    borderRadius: 16, paddingVertical: 20, paddingHorizontal: 20, gap: 6,
  },
  cardLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.6, color: ACCENT },
  cardHeadline: {
    fontSize: 26, fontWeight: '400', letterSpacing: 0.5, color: TEXT,
    fontVariant: ['tabular-nums'],
  },
  cardBody: { fontSize: 13, fontWeight: '300', color: DIM, textAlign: 'center', lineHeight: 19 },

  // Offsets come from the call site, which derives them from doorSize.
  unlockSlot: { position: 'absolute' },
  metaLine: { fontSize: 12.5, fontWeight: '300', color: MUTED, textAlign: 'center' },
  // Coming-soon's one line under the door. The figure carries the gold so the
  // eye lands on the POWR, not the sentence around it.
  soonBanked: { marginTop: 8, paddingHorizontal: 24, lineHeight: 18 },
  soonBankedFigure: { color: ACCENT_SOFT, fontWeight: '400' },
  // Softened rather than alarm-red: nothing here has gone wrong with the
  // user's POWR, and this sits directly beneath a gold-lit door.
  claimError: {
    fontSize: 12.5, fontWeight: '300', color: 'rgba(240,160,160,0.92)',
    textAlign: 'center', marginTop: 14, paddingHorizontal: 24, lineHeight: 18,
  },
  timerSpaced: { marginTop: 22 },

  railBlock: { alignSelf: 'stretch', marginTop: 24 },
  railLabels: { flexDirection: 'row', alignItems: 'flex-start' },
  railEnd: { flex: 1, gap: 2 },
  railCap: { fontSize: 9, fontWeight: '700', letterSpacing: 1.3, color: MUTED },
  railDate: { fontSize: 11, fontWeight: '300', color: DIM },

  // A quiet footer link, not a gold call to action — nothing on this page
  // should compete with the dial on the door.
  termsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 22,
  },
  termsText: { fontSize: 13, fontWeight: '300', color: MUTED },

  sectionHeader: {
    fontSize: 10, fontWeight: '600', letterSpacing: 2, color: MUTED,
    textTransform: 'uppercase', marginTop: 22, marginBottom: 10,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: POT_BORDER, borderRadius: 14,
    backgroundColor: POT_SURFACE,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: ACCENT_DIM,
    alignItems: 'center', justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 13, fontWeight: '400', color: TEXT },
  rowSub: { fontSize: 11, fontWeight: '300', color: MUTED },
  rowAmount: { fontSize: 15, fontWeight: '300', letterSpacing: 0.5, color: TEXT },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 80 },
  statusText: { fontSize: 14, color: MUTED },

  infoBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  infoCard: {
    alignSelf: 'stretch', maxWidth: 420,
    backgroundColor: '#12171A',
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.25)', borderRadius: 20,
    padding: 22, gap: 14,
  },
  infoTitle: { fontSize: 16, fontWeight: '500', color: TEXT, textAlign: 'center', marginBottom: 4 },
  infoRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  infoIcon: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: ACCENT_DIM,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  infoRowBody: { flex: 1, gap: 2 },
  infoRowTitle: { fontSize: 13, fontWeight: '500', color: TEXT },
  infoRowText: { fontSize: 12, fontWeight: '300', color: DIM, lineHeight: 17 },
  tierPillRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  tierPill: {
    flex: 1, alignItems: 'center', gap: 1,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', borderRadius: 10,
    paddingVertical: 7,
  },
  tierPillTier: { fontSize: 7, fontWeight: '700', letterSpacing: 1 },
  tierPillAmount: { fontSize: 12, fontWeight: '500', color: TEXT },
  infoBtn: {
    marginTop: 6, backgroundColor: ACCENT, borderRadius: 20,
    paddingVertical: 12, alignItems: 'center',
  },
  infoBtnText: {
    fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: '#07090A',
    textTransform: 'uppercase',
  },

  devRearmBtn: {
    alignSelf: 'center', marginTop: 18,
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.4)', borderRadius: 16,
    paddingVertical: 8, paddingHorizontal: 16, minWidth: 160, alignItems: 'center',
  },
  devRearmText: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: ACCENT },
});

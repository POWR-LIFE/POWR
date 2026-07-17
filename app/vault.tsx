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
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';

import AsyncStorage from '@react-native-async-storage/async-storage';

import GeometricBackground from '@/components/GeometricBackground';
import { VaultDoor } from '@/components/vault/VaultDoor';
import {
  VAULT_HERO_DESIGNS,
  type VaultHeroDesign,
  type VaultHeroDesignId,
} from '@/components/vault/heroDesigns';
import { LEVELS, TIER_META, VAULT_LEVEL_BONUS, type LevelTier } from '@/constants/levels';
import { useAuth } from '@/context/AuthContext';
import { claimVaultDeposits, fetchVaultContents, type VaultDeposit } from '@/lib/api/vault';
import { useCountdown } from '@/hooks/useCountdown';
import { usePoints } from '@/hooks/usePoints';
import { useRollingNumber } from '@/hooks/useRollingNumber';

// Same dev account that gets the level-up celebration replay (useLevelUp) and
// the claim-points cap bypass — mirrored server-side in dev_rearm_vault().
const DEV_TEST_EMAILS = new Set(['jamiemasonwright@gmail.com']);

// Dev-only door design preference (set from the picker under the re-arm
// button). Everyone else always gets the shipped 'classic' door.
const DOOR_DESIGN_STORAGE_KEY = '@powr/dev_vault_door';

// ─── Design tokens (match wallet / points-ledger) ─────────────────────────────

const BG     = '#0d0d0d';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';
const GOLD   = '#E8D200';
const GREEN  = '#4ade80';
const ORANGE = '#FF9944';
const BORDER = 'rgba(255,255,255,0.08)';

// The hold charge is quantised to this many steps for the designs' dials.
const TICK_COUNT = 60;

const DEFAULT_VEST_DAYS = 60;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function unlockCopy(iso: string): string {
  const days = daysUntil(iso);
  if (days <= 0) return 'Unlocking…';
  if (days === 1) return 'Unlocks tomorrow';
  return `Unlocks in ${days} days`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function depositLabel(d: VaultDeposit): string {
  if (d.source === 'level_up' && d.level) {
    const def = LEVELS.find((l) => l.level === d.level);
    return def ? `Level ${d.level} — ${def.name}` : `Level ${d.level} bonus`;
  }
  return d.description ?? 'Bonus points';
}

function depositSub(d: VaultDeposit): string {
  return d.source === 'level_up' ? 'Level-up bonus' : 'Earned over the daily cap';
}

// ─── Countdown ring hero ──────────────────────────────────────────────────────

/**
 * The centrepiece: the vault door wrapped in the tick dial.
 *
 * Three states:
 *  - VESTING: ticks fill with the soonest deposit's elapsed fraction, one
 *    bright sweep tick advances each second with the live countdown.
 *  - READY (a deposit has matured): press-and-hold the door to unlock — the
 *    hold charges the dial tick by tick and spins the door; releasing early
 *    unwinds it. Completing the hold claims every due deposit server-side.
 *  - UNLOCKED: the payout moment — full gold dial, banked total, and the
 *    ledger refreshes underneath.
 */
function VaultHero({
  pending,
  totalPending,
  balance,
  balanceReady,
  heroHeight,
  onClaim,
  design,
}: {
  pending: VaultDeposit[];
  totalPending: number;
  balance: number;
  balanceReady: boolean;
  heroHeight: number;
  onClaim: () => Promise<number>;
  design: VaultHeroDesign;
}) {
  // The epilogue: once the unlock lands and the points query refetches, this
  // rolls the spendable balance up to its new value right under the payout.
  const displayBalance = useRollingNumber(balance, balanceReady);
  const dueTotal = pending
    .filter((d) => new Date(d.vests_at).getTime() <= Date.now())
    .reduce((s, d) => s + d.amount, 0);
  // Sum of not-yet-due deposits: correct both before the claim refetch (due
  // rows excluded here) and after it (due rows are gone from `pending`).
  const remainingVesting = pending
    .filter((d) => new Date(d.vests_at).getTime() > Date.now())
    .reduce((s, d) => s + d.amount, 0);
  const [unlockedPoints, setUnlockedPoints] = useState<number | null>(null);
  const [claiming, setClaiming] = useState(false);
  const ready = dueTotal > 0 && unlockedPoints === null;

  // While vesting, the countdown tracks the soonest not-yet-due deposit and
  // its once-per-second tick re-renders the sweep. Ready/unlocked states are
  // driven by the hold animation instead.
  const nextVesting = pending.find((d) => new Date(d.vests_at).getTime() > Date.now()) ?? null;
  const showCountdownFor = ready || unlockedPoints !== null ? null : (pending[0] ?? null);
  const countdown = useCountdown(showCountdownFor ? showCountdownFor.vests_at : null);

  // ── Hold-to-unlock ──
  const holdAnim = useRef(new Animated.Value(0)).current;
  const [holdTicks, setHoldTicks] = useState(0);

  useEffect(() => {
    const id = holdAnim.addListener(({ value }) => {
      const t = Math.round(value * TICK_COUNT);
      setHoldTicks((prev) => (prev === t ? prev : t));
    });
    return () => holdAnim.removeListener(id);
  }, [holdAnim]);

  const completeUnlock = useCallback(async () => {
    setClaiming(true);
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Haptics unavailable (web) — the visual moment carries it.
    }
    try {
      const points = await onClaim();
      setUnlockedPoints(points);
    } catch {
      // Claim failed (offline?) — unwind so the user can try again.
      Animated.timing(holdAnim, { toValue: 0, duration: 250, useNativeDriver: false }).start();
    }
    setClaiming(false);
  }, [holdAnim, onClaim]);

  const startHold = useCallback(() => {
    if (!ready || claiming) return;
    Haptics.selectionAsync().catch(() => {});
    Animated.timing(holdAnim, {
      toValue: 1,
      duration: 1400,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) void completeUnlock();
    });
  }, [ready, claiming, holdAnim, completeUnlock]);

  const cancelHold = useCallback(() => {
    if (claiming || unlockedPoints !== null) return;
    Animated.timing(holdAnim, { toValue: 0, duration: 220, useNativeDriver: false }).start();
  }, [claiming, unlockedPoints, holdAnim]);

  // Elapsed vest fraction of the soonest pending deposit.
  let progress = 0;
  if (pending[0]) {
    const start = new Date(pending[0].created_at).getTime();
    const end = new Date(pending[0].vests_at).getTime();
    progress = end > start ? Math.min(1, Math.max(0, (Date.now() - start) / (end - start))) : 1;
  }

  return (
    <View style={[styles.hero, { minHeight: heroHeight }]}>
      <Pressable
        testID="vault-door-hold"
        onPressIn={startHold}
        onPressOut={cancelHold}
        disabled={!ready || claiming}
      >
        <design.Centerpiece
          hasPending={pending.length > 0}
          progress={progress}
          ready={ready}
          unlocked={unlockedPoints !== null}
          holdTicks={holdTicks}
          holdAnim={holdAnim}
          countdown={countdown}
          nextVestAt={pending[0]?.vests_at ?? null}
          dueTotal={dueTotal}
          totalPending={totalPending}
        />
      </Pressable>

      {unlockedPoints !== null ? (
        <>
          <Text style={styles.heroUnlocked}>+{unlockedPoints.toLocaleString()} POWR</Text>
          <Text style={styles.heroReadyHint}>UNLOCKED — ADDED TO YOUR BALANCE</Text>
          <View style={styles.heroBalanceRow}>
            <Text style={styles.heroBalanceLabel}>BALANCE</Text>
            <Text style={styles.heroBalanceValue}>{displayBalance.toLocaleString()}</Text>
          </View>
          {remainingVesting > 0 && (
            <View style={styles.heroNextRow}>
              <View style={styles.heroDot} />
              <Text style={styles.heroNextText}>
                {remainingVesting.toLocaleString()} still vesting
              </Text>
            </View>
          )}
        </>
      ) : ready ? (
        <>
          {!design.ownCountdown && (
            <Text style={styles.heroCountdown}>{dueTotal.toLocaleString()} POWR</Text>
          )}
          <Text style={styles.heroReadyHint}>
            {claiming ? 'UNLOCKING…' : 'READY — PRESS & HOLD TO UNLOCK'}
          </Text>
          {nextVesting && (
            <View style={styles.heroNextRow}>
              <View style={styles.heroDot} />
              <Text style={styles.heroNextText}>
                {remainingVesting.toLocaleString()} more unlocks {formatDate(nextVesting.vests_at)}
              </Text>
            </View>
          )}
        </>
      ) : pending.length > 0 ? (
        <>
          {!design.ownCountdown && countdown && (
            <Text style={styles.heroCountdown}>{countdown}</Text>
          )}
          <Text style={styles.heroAmount}>
            {totalPending.toLocaleString()} <Text style={styles.heroAmountUnit}>POWR VESTING</Text>
          </Text>
          <View style={styles.heroNextRow}>
            <View style={styles.heroDot} />
            <Text style={styles.heroNextText}>Next unlock {formatDate(pending[0].vests_at)}</Text>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.heroEmptyTitle}>Nothing vesting yet</Text>
          <Text style={styles.heroEmptyHint}>
            Level up or push past a daily cap{'\n'}and the bonus banks here.
          </Text>
        </>
      )}
    </View>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

function DepositRow({ deposit }: { deposit: VaultDeposit }) {
  const released = deposit.released_at !== null;
  const isLevel = deposit.source === 'level_up';
  const accent = released ? DIM : isLevel ? GOLD : ORANGE;

  return (
    <View style={[styles.row, released && { opacity: 0.55 }]}>
      <View style={[styles.rowIcon, { backgroundColor: accent + '18' }]}>
        <Ionicons
          name={released ? 'lock-open' : isLevel ? 'trophy' : 'flash'}
          size={16}
          color={accent}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{depositLabel(deposit)}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {released
            ? `Unlocked ${formatDate(deposit.released_at!)} · ${depositSub(deposit)}`
            : `${unlockCopy(deposit.vests_at)} · ${depositSub(deposit)}`}
        </Text>
      </View>
      <Text style={[styles.rowAmount, { color: released ? GREEN : TEXT }]}>
        +{deposit.amount.toLocaleString()}
      </Text>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function VaultScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
  const { vaultPending, balance, loading: pointsLoading } = usePoints();
  const { user } = useAuth();
  const [infoOpen, setInfoOpen] = useState(false);
  const queryClient = useQueryClient();

  // Dev-only unlock replay: dev_rearm_vault() reverses the released deposits
  // (and their payout rows) back to READY; the key bump remounts the hero so
  // its unlocked state resets and the hold can run again.
  const isDevTestUser = DEV_TEST_EMAILS.has(user?.email ?? '');
  const [devKey, setDevKey] = useState(0);

  // Dev-only design shoot-out: the picker under the re-arm button swaps the
  // whole hero centrepiece (persisted so it survives reloads mid-comparison).
  const [designId, setDesignId] = useState<VaultHeroDesignId>('classic');
  useEffect(() => {
    AsyncStorage.getItem(DOOR_DESIGN_STORAGE_KEY).then((stored) => {
      if (VAULT_HERO_DESIGNS.some((d) => d.id === stored)) {
        setDesignId(stored as VaultHeroDesignId);
      }
    });
  }, []);
  const selectDesign = useCallback((id: VaultHeroDesignId) => {
    setDesignId(id);
    void AsyncStorage.setItem(DOOR_DESIGN_STORAGE_KEY, id);
  }, []);
  const design = VAULT_HERO_DESIGNS.find((d) => d.id === designId) ?? VAULT_HERO_DESIGNS[0];
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

  const { data, isPending, isError } = useQuery({
    queryKey: ['vault', 'contents'],
    queryFn: fetchVaultContents,
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
  const released = data?.released ?? [];

  const sections = [
    ...(pending.length > 0 ? [{ title: 'Vesting', data: pending }] : []),
    ...(released.length > 0 ? [{ title: 'Unlocked', data: released }] : []),
  ];

  // The door owns the centre of the first viewport; the ledger scrolls up from
  // beneath it.
  const heroHeight = Math.max(380, windowHeight * 0.62);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />

      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>Vault</Text>
        <Pressable style={styles.backBtn} onPress={() => setInfoOpen(true)} hitSlop={8}>
          <Ionicons name="information-circle-outline" size={20} color={DIM} />
        </Pressable>
      </View>

      {isPending ? (
        <View style={styles.centered}><ActivityIndicator color={GOLD} /></View>
      ) : isError ? (
        <View style={styles.centered}><Text style={styles.statusText}>Could not load your Vault.</Text></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => <DepositRow deposit={item} />}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          style={styles.scroll}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <VaultHero
              key={`${devKey}-${designId}`}
              pending={pending}
              totalPending={vaultPending}
              balance={balance}
              balanceReady={!pointsLoading}
              heroHeight={heroHeight}
              onClaim={handleClaim}
              design={design}
            />
          }
          ListFooterComponent={
            <>
              <Text style={styles.footerNote}>
                Vault points are bonus POWR — level-up rewards and points earned over
                a daily cap. They count towards your level straight away and unlock
                into your spendable balance automatically.
              </Text>
              {isDevTestUser && (
                <>
                  <Pressable
                    style={({ pressed }) => [styles.devRearmBtn, pressed && { opacity: 0.7 }]}
                    onPress={handleDevRearm}
                    disabled={devRearming}
                  >
                    {devRearming ? (
                      <ActivityIndicator size="small" color={GOLD} />
                    ) : (
                      <Text style={styles.devRearmText}>DEV · RE-ARM UNLOCK</Text>
                    )}
                  </Pressable>
                  <Text style={styles.devDesignLabel}>DEV · VAULT DESIGN</Text>
                  <View style={styles.devDesignRow}>
                    {VAULT_HERO_DESIGNS.map((d) => (
                      <Pressable
                        key={d.id}
                        style={({ pressed }) => [
                          styles.devDesignCard,
                          designId === d.id && styles.devDesignCardActive,
                          pressed && { opacity: 0.7 },
                        ]}
                        onPress={() => selectDesign(d.id)}
                      >
                        <d.Preview />
                        <Text style={[styles.devDesignName, designId === d.id && { color: GOLD }]}>
                          {d.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </>
          }
        />
      )}

      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <Pressable style={styles.infoBackdrop} onPress={() => setInfoOpen(false)}>
          <Pressable style={styles.infoCard} onPress={() => {}}>
            <View style={styles.infoDoorWrap}>
              <VaultDoor size={56} />
            </View>
            <Text style={styles.infoTitle}>What banks in the Vault</Text>

            {(vaultConfig?.levelUpEnabled ?? true) && (
              <View style={styles.infoRow}>
                <View style={[styles.infoIcon, { backgroundColor: GOLD + '18' }]}>
                  <Ionicons name="trophy" size={15} color={GOLD} />
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
                <View style={[styles.infoIcon, { backgroundColor: ORANGE + '18' }]}>
                  <Ionicons name="flash" size={15} color={ORANGE} />
                </View>
                <View style={styles.infoRowBody}>
                  <Text style={styles.infoRowTitle}>Points over the daily cap</Text>
                  <Text style={styles.infoRowText}>
                    Streak multipliers past an activity's daily cap bank here instead of being lost.
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                <Ionicons name="time" size={15} color={DIM} />
              </View>
              <View style={styles.infoRowBody}>
                <Text style={styles.infoRowTitle}>Vests like savings</Text>
                <Text style={styles.infoRowText}>
                  Deposits vest for {vaultConfig?.vestDays ?? DEFAULT_VEST_DAYS} days, then unlock
                  into your spendable balance automatically. They count towards your level straight away.
                </Text>
              </View>
            </View>

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
  screen: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '400', letterSpacing: 0.5, color: TEXT },
  headerSpacer: { width: 36 },

  scroll: { flex: 1 },
  listContent: { paddingHorizontal: 16, flexGrow: 1 },

  hero: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 18 },
  heroCountdown: {
    fontSize: 26, fontWeight: '200', letterSpacing: 3, color: GOLD,
    fontVariant: ['tabular-nums'],
  },
  heroAmount: { fontSize: 15, fontWeight: '400', letterSpacing: 0.5, color: TEXT, marginTop: 2 },
  heroAmountUnit: { fontSize: 10, fontWeight: '500', letterSpacing: 2, color: MUTED },
  heroNextRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  heroDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD },
  heroNextText: { fontSize: 12, fontWeight: '300', color: DIM },
  heroEmptyTitle: { fontSize: 15, fontWeight: '400', color: TEXT },
  heroEmptyHint: { fontSize: 12, fontWeight: '300', color: MUTED, textAlign: 'center', lineHeight: 18 },
  heroUnlocked: { fontSize: 30, fontWeight: '200', letterSpacing: 2, color: GOLD },
  heroReadyHint: {
    fontSize: 10, fontWeight: '600', letterSpacing: 2, color: DIM,
    textTransform: 'uppercase', marginTop: 2,
  },
  heroBalanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 12 },
  heroBalanceLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 2, color: MUTED },
  heroBalanceValue: {
    fontSize: 20, fontWeight: '300', letterSpacing: 1, color: TEXT,
    fontVariant: ['tabular-nums'],
  },

  sectionHeader: {
    fontSize: 10, fontWeight: '600', letterSpacing: 2, color: MUTED,
    textTransform: 'uppercase', marginTop: 8, marginBottom: 10,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: BORDER, borderRadius: 14,
    backgroundColor: 'rgba(40,40,40,0.45)',
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  rowIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 13, fontWeight: '400', color: TEXT },
  rowSub: { fontSize: 11, fontWeight: '300', color: MUTED },
  rowAmount: { fontSize: 15, fontWeight: '300', letterSpacing: 0.5 },

  footerNote: {
    fontSize: 11, fontWeight: '300', color: MUTED, lineHeight: 17,
    textAlign: 'center', paddingHorizontal: 24, paddingTop: 18,
  },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 80 },
  statusText: { fontSize: 14, color: MUTED },

  infoBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  infoCard: {
    alignSelf: 'stretch', maxWidth: 420,
    backgroundColor: '#161616',
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.2)', borderRadius: 20,
    padding: 22, gap: 14,
  },
  infoDoorWrap: { alignItems: 'center', marginBottom: 2 },
  infoTitle: { fontSize: 15, fontWeight: '500', color: TEXT, textAlign: 'center', marginBottom: 4 },
  infoRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  infoIcon: {
    width: 30, height: 30, borderRadius: 15,
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
    marginTop: 6, backgroundColor: GOLD, borderRadius: 20,
    paddingVertical: 12, alignItems: 'center',
  },
  infoBtnText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: '#0a0a0a', textTransform: 'uppercase' },

  devRearmBtn: {
    alignSelf: 'center', marginTop: 18,
    borderWidth: 1, borderColor: 'rgba(232,210,0,0.4)', borderRadius: 16,
    paddingVertical: 8, paddingHorizontal: 16, minWidth: 160, alignItems: 'center',
  },
  devRearmText: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: GOLD },
  devDesignLabel: {
    fontSize: 8, fontWeight: '700', letterSpacing: 2, color: MUTED,
    textAlign: 'center', marginTop: 20, marginBottom: 10,
  },
  devDesignRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  devDesignCard: {
    alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 6,
    borderWidth: 1, borderColor: BORDER, borderRadius: 14, width: 76,
  },
  devDesignCardActive: { borderColor: 'rgba(232,210,0,0.5)', backgroundColor: 'rgba(232,210,0,0.05)' },
  devDesignName: { fontSize: 8, fontWeight: '700', letterSpacing: 1.2, color: MUTED },
});

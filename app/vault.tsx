import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';

import { supabase } from '@/lib/supabase';

import GeometricBackground from '@/components/GeometricBackground';
import { VaultDoor } from '@/components/vault/VaultDoor';
import { LEVELS, TIER_META, VAULT_LEVEL_BONUS, type LevelTier } from '@/constants/levels';
import { fetchVaultContents, type VaultDeposit } from '@/lib/api/vault';
import { useCountdown } from '@/hooks/useCountdown';
import { usePoints } from '@/hooks/usePoints';

// ─── Design tokens (match wallet / points-ledger) ─────────────────────────────

const BG     = '#0d0d0d';
const TEXT   = '#F2F2F2';
const MUTED  = 'rgba(255,255,255,0.25)';
const DIM    = 'rgba(255,255,255,0.5)';
const GOLD   = '#E8D200';
const GREEN  = '#4ade80';
const ORANGE = '#FF9944';
const BORDER = 'rgba(255,255,255,0.08)';

// Tick dial geometry: 60 tick marks wrap the door like a safe dial. Elapsed
// ticks hold gold as the deposit vests; one bright sweep tick advances every
// second in step with the countdown.
const RING_SIZE = 240;
const RING_RADIUS = 112;
const TICK_COUNT = 60;
const TICK_LEN = 8;
const DOOR_SIZE = 164;

const TICKS = Array.from({ length: TICK_COUNT }, (_, i) => {
  const a = ((i / TICK_COUNT) * 360 - 90) * (Math.PI / 180);
  const inner = RING_RADIUS - TICK_LEN / 2;
  const outer = RING_RADIUS + TICK_LEN / 2;
  return {
    x1: RING_SIZE / 2 + inner * Math.cos(a),
    y1: RING_SIZE / 2 + inner * Math.sin(a),
    x2: RING_SIZE / 2 + outer * Math.cos(a),
    y2: RING_SIZE / 2 + outer * Math.sin(a),
  };
});

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
 * The centrepiece: the vault door wrapped in a gold ring that fills as the
 * soonest deposit approaches its unlock, with the live countdown beneath.
 * The once-per-second countdown tick re-renders the ring, so it visibly
 * creeps — vesting as spectacle, not a spreadsheet.
 */
function VaultHero({
  pending,
  nextDeposit,
  totalPending,
  heroHeight,
}: {
  pending: number;
  nextDeposit: VaultDeposit | null;
  totalPending: number;
  heroHeight: number;
}) {
  const countdown = useCountdown(nextDeposit ? nextDeposit.vests_at : null);

  // Elapsed fraction of the next deposit's vesting window (ticks fill toward
  // unlock), plus a clock-style sweep tick that advances with each second of
  // the countdown.
  let progress = 0;
  if (nextDeposit) {
    const start = new Date(nextDeposit.created_at).getTime();
    const end = new Date(nextDeposit.vests_at).getTime();
    progress = end > start ? Math.min(1, Math.max(0, (Date.now() - start) / (end - start))) : 1;
  }
  const sweep = Math.floor(Date.now() / 1000) % TICK_COUNT;

  return (
    <View style={[styles.hero, { minHeight: heroHeight }]}>
      <View style={styles.ringWrap}>
        <Svg width={RING_SIZE} height={RING_SIZE} style={StyleSheet.absoluteFill}>
          {TICKS.map((t, i) => {
            const filled = nextDeposit != null && i / TICK_COUNT <= progress;
            const isSweep = nextDeposit != null && i === sweep;
            return (
              <Line
                key={i}
                x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                stroke={isSweep ? GOLD : filled ? 'rgba(232,210,0,0.5)' : 'rgba(255,255,255,0.10)'}
                strokeWidth={isSweep ? 3 : 2}
                strokeLinecap="round"
              />
            );
          })}
        </Svg>
        <VaultDoor size={DOOR_SIZE} />
      </View>

      {pending > 0 ? (
        <>
          {countdown && <Text style={styles.heroCountdown}>{countdown}</Text>}
          <Text style={styles.heroAmount}>
            {totalPending.toLocaleString()} <Text style={styles.heroAmountUnit}>POWR VESTING</Text>
          </Text>
          {nextDeposit && (
            <View style={styles.heroNextRow}>
              <View style={styles.heroDot} />
              <Text style={styles.heroNextText}>Next unlock {formatDate(nextDeposit.vests_at)}</Text>
            </View>
          )}
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
  const { vaultPending } = usePoints();
  const [infoOpen, setInfoOpen] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: ['vault', 'contents'],
    queryFn: fetchVaultContents,
  });

  // Live vest window so the explainer copy stays honest when the admin knob
  // (system_config → vault_vest_days) is tuned.
  const { data: vestDays } = useQuery({
    queryKey: ['vault', 'vest-days'],
    queryFn: async () => {
      const { data: row } = await supabase
        .from('system_config')
        .select('value')
        .eq('key', 'vault_vest_days')
        .maybeSingle();
      const parsed = parseInt(row?.value ?? '', 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_VEST_DAYS;
    },
    staleTime: 60 * 60 * 1000,
  });

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
              pending={pending.length}
              nextDeposit={pending[0] ?? null}
              totalPending={vaultPending}
              heroHeight={heroHeight}
            />
          }
          ListFooterComponent={
            <Text style={styles.footerNote}>
              Vault points are bonus POWR — level-up rewards and points earned over
              a daily cap. They count towards your level straight away and unlock
              into your spendable balance automatically.
            </Text>
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
                  {(Object.keys(VAULT_LEVEL_BONUS) as LevelTier[]).map((tier) => (
                    <View key={tier} style={styles.tierPill}>
                      <Text style={[styles.tierPillTier, { color: TIER_META[tier].color }]}>
                        {TIER_META[tier].label}
                      </Text>
                      <Text style={styles.tierPillAmount}>+{VAULT_LEVEL_BONUS[tier]}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

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

            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                <Ionicons name="time" size={15} color={DIM} />
              </View>
              <View style={styles.infoRowBody}>
                <Text style={styles.infoRowTitle}>Vests like savings</Text>
                <Text style={styles.infoRowText}>
                  Deposits vest for {vestDays ?? DEFAULT_VEST_DAYS} days, then unlock into your
                  spendable balance automatically. They count towards your level straight away.
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
  ringWrap: {
    width: RING_SIZE, height: RING_SIZE,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
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
});

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import GeometricBackground from '@/components/GeometricBackground';
import {
  Clipboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePoints } from '@/hooks/usePoints';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

// ─── Mock reward lookup — replace with real API fetch ─────────────────────────

const REWARD_DATA: Record<string, { title: string; partner: string; pts: number; value: string; logoText: string; logoLight: boolean }> = {
  '1': { title: 'Free gym class',         partner: 'Third Space',     pts: 800,  value: '£20 value', logoText: 'TS',    logoLight: false },
  '2': { title: '25% off your bill',      partner: 'Notto Pasta',     pts: 500,  value: '25% off',   logoText: 'NOTTO', logoLight: true  },
  '3': { title: '30% off protein powder', partner: 'bulk®',           pts: 400,  value: '30% off',   logoText: 'bulk',  logoLight: false },
  '4': { title: '3 months free',          partner: 'Calm',            pts: 600,  value: '£30 value', logoText: 'calm',  logoLight: false },
  '5': { title: '£50 off mattress',       partner: 'Eight Sleep',     pts: 1200, value: '£50 off',   logoText: 'eight', logoLight: false },
  '6': { title: '20% off supplements',    partner: 'Whole Health',    pts: 350,  value: '20% off',   logoText: 'WH',    logoLight: true  },
  '7': { title: 'Single class pass',      partner: "Barry's",         pts: 650,  value: '£24 value', logoText: 'barry', logoLight: true  },
  '8': { title: '1 month free',           partner: 'Headspace',       pts: 300,  value: '£13 value', logoText: 'head',  logoLight: false },
  'featured': { title: 'Free Class',      partner: 'Third Space',     pts: 800,  value: '£20 value', logoText: 'TS',    logoLight: false },
};

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `POWR-${seg(4)}-${seg(4)}`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RedeemModal() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { balance, refresh } = usePoints();

  const reward = REWARD_DATA[id ?? ''] ?? null;
  const [stage, setStage] = useState<'confirm' | 'success'>('confirm');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  if (!reward) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>Reward not found.</Text>
      </View>
    );
  }

  const canAfford = balance >= reward.pts;
  const remaining = balance - reward.pts;

  function handleConfirm() {
    // TODO: call Supabase redemption edge function
    setCode(generateCode());
    setStage('success');
    refresh(); // re-fetch balance
  }

  function handleCopy() {
    Clipboard.setString(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + 16 }]}>
      <GeometricBackground />
      {/* Drag handle */}
      <View style={styles.handle} />

      {stage === 'confirm' ? (
        <ConfirmView
          reward={reward}
          balance={balance}
          canAfford={canAfford}
          remaining={remaining}
          onConfirm={handleConfirm}
          onCancel={() => router.back()}
        />
      ) : (
        <SuccessView
          reward={reward}
          code={code}
          copied={copied}
          onCopy={handleCopy}
          onDone={() => router.back()}
        />
      )}
    </View>
  );
}

// ─── Confirm view ─────────────────────────────────────────────────────────────

interface ConfirmProps {
  reward: (typeof REWARD_DATA)[string];
  balance: number;
  canAfford: boolean;
  remaining: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmView({ reward, balance, canAfford, remaining, onConfirm, onCancel }: ConfirmProps) {
  return (
    <View style={styles.sheet}>
      {/* Reward identity */}
      <View style={styles.rewardIdentity}>
        <View style={[styles.logoBox, reward.logoLight && styles.logoBoxLight]}>
          <Text style={[styles.logoText, reward.logoLight && styles.logoTextDark]}>
            {reward.logoText}
          </Text>
        </View>
        <View style={styles.rewardMeta}>
          <Text style={styles.rewardTitle}>{reward.title}</Text>
          <Text style={styles.rewardPartner}>{reward.partner}</Text>
        </View>
        <Text style={styles.rewardValue}>{reward.value}</Text>
      </View>

      <View style={styles.divider} />

      {/* Balance breakdown */}
      <View style={styles.balanceBlock}>
        <BalanceLine label="Your balance" value={`${balance.toLocaleString()} pts`} />
        <BalanceLine label="Cost" value={`− ${reward.pts.toLocaleString()} pts`} highlight />
        <View style={styles.balanceDividerThin} />
        <BalanceLine
          label="After redemption"
          value={`${remaining.toLocaleString()} pts`}
          bold
          dimmed={!canAfford}
        />
      </View>

      {!canAfford && (
        <View style={styles.insufficientBanner}>
          <Ionicons name="alert-circle-outline" size={14} color='#f87171' />
          <Text style={styles.insufficientText}>
            You need {(reward.pts - balance).toLocaleString()} more pts to redeem this
          </Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.confirmBtn,
            !canAfford && styles.confirmBtnDisabled,
            pressed && canAfford && { opacity: 0.85 },
          ]}
          onPress={canAfford ? onConfirm : undefined}
        >
          <Text style={[styles.confirmBtnText, !canAfford && styles.confirmBtnTextDisabled]}>
            Confirm Redemption
          </Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]} onPress={onCancel}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
      </View>

      <Text style={styles.legalNote}>
        Codes are single-use and valid for 30 days. POWR points are non-refundable once redeemed.
      </Text>
    </View>
  );
}

function BalanceLine({ label, value, highlight, bold, dimmed }: {
  label: string; value: string; highlight?: boolean; bold?: boolean; dimmed?: boolean;
}) {
  return (
    <View style={styles.balanceLine}>
      <Text style={[styles.balanceLineLabel, dimmed && { color: MUTED }]}>{label}</Text>
      <Text style={[
        styles.balanceLineValue,
        highlight && { color: '#f87171' },
        bold && { color: TEXT, fontWeight: '400' },
        dimmed && { color: MUTED },
      ]}>
        {value}
      </Text>
    </View>
  );
}

// ─── Success view ─────────────────────────────────────────────────────────────

interface SuccessProps {
  reward: (typeof REWARD_DATA)[string];
  code: string;
  copied: boolean;
  onCopy: () => void;
  onDone: () => void;
}

function SuccessView({ reward, code, copied, onCopy, onDone }: SuccessProps) {
  return (
    <View style={styles.sheet}>
      {/* Success indicator */}
      <View style={styles.successHeader}>
        <View style={styles.successDotWrap}>
          <View style={styles.successDotOuter}>
            <View style={styles.successDotInner} />
          </View>
        </View>
        <Text style={styles.successTitle}>Redeemed</Text>
        <Text style={styles.successSub}>{reward.title} · {reward.partner}</Text>
      </View>

      {/* Code block */}
      <Pressable
        style={({ pressed }) => [styles.codeBlock, pressed && { opacity: 0.8 }]}
        onPress={onCopy}
      >
        <Text style={styles.codeText}>{code}</Text>
        <View style={styles.copyRow}>
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
            size={13}
            color={copied ? '#4ade80' : MUTED}
          />
          <Text style={[styles.copyLabel, copied && { color: '#4ade80' }]}>
            {copied ? 'Copied' : 'Tap to copy'}
          </Text>
        </View>
      </Pressable>

      <Text style={styles.codeExpiry}>Valid for 30 days · Show to staff or enter at checkout</Text>

      <Pressable
        style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.85 }]}
        onPress={onDone}
      >
        <Text style={styles.doneBtnText}>Done</Text>
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    justifyContent: 'flex-end',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  sheet: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 16,
  },
  errorText: {
    color: DIM,
    textAlign: 'center',
    marginTop: 40,
    fontSize: 14,
  },

  // Reward identity
  rewardIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  logoBoxLight: {
    backgroundColor: '#F2F2F2',
  },
  logoText: {
    fontSize: 11,
    fontWeight: '600',
    color: DIM,
    textAlign: 'center',
  },
  logoTextDark: {
    color: '#1a1a1a',
  },
  rewardMeta: { flex: 1, gap: 3 },
  rewardTitle: {
    fontSize: 16,
    fontWeight: '300',
    color: TEXT,
  },
  rewardPartner: {
    fontSize: 12,
    fontWeight: '300',
    color: DIM,
  },
  rewardValue: {
    fontSize: 14,
    fontWeight: '300',
    color: GOLD,
    flexShrink: 0,
  },

  divider: {
    height: 1,
    backgroundColor: BORDER,
  },

  // Balance block
  balanceBlock: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  balanceLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceLineLabel: {
    fontSize: 13,
    fontWeight: '300',
    color: DIM,
  },
  balanceLineValue: {
    fontSize: 13,
    fontWeight: '300',
    color: DIM,
  },
  balanceDividerThin: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },

  // Insufficient banner
  insufficientBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.2)',
    borderRadius: 10,
    padding: 12,
  },
  insufficientText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '300',
    color: '#f87171',
  },

  // Actions
  actions: { gap: 10 },
  confirmBtn: {
    backgroundColor: GOLD,
    borderRadius: 20,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  confirmBtnText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#0a0a0a',
    textTransform: 'uppercase',
  },
  confirmBtnTextDisabled: {
    color: MUTED,
  },
  cancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '300',
    color: MUTED,
  },

  legalNote: {
    fontSize: 10,
    fontWeight: '300',
    color: MUTED,
    textAlign: 'center',
    lineHeight: 16,
  },

  // Success
  successHeader: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  successDotWrap: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successDotOuter: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successDotInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4ade80',
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '200',
    letterSpacing: -0.5,
    color: TEXT,
  },
  successSub: {
    fontSize: 13,
    fontWeight: '300',
    color: DIM,
  },

  // Code block
  codeBlock: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.2)',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  codeText: {
    fontSize: 20,
    fontWeight: '200',
    letterSpacing: 3,
    color: GOLD,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  copyLabel: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
    letterSpacing: 0.3,
  },
  codeExpiry: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
    textAlign: 'center',
  },

  doneBtn: {
    backgroundColor: GOLD,
    borderRadius: 20,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#0a0a0a',
    textTransform: 'uppercase',
  },
});

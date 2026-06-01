import GeometricBackground from '@/components/GeometricBackground';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePoints } from '@/hooks/usePoints';
import { redeemReward, RedemptionError, type IntegrationType, type Reward } from '@/lib/api/rewards';
import { supabase } from '@/lib/supabase';

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const BG      = '#0d0d0d';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.25)';
const DIM     = 'rgba(255,255,255,0.5)';

// ─── Screen ───────────────────────────────────────────────────────────────────

interface UIReward {
  id: string;
  title: string;
  partner: string;
  pts: number;
  value: string;
  logoText: string;
  logoUrl: string | null;
  heroUrl: string | null;
  url: string | null;
  integrationType: IntegrationType;
}

function formatValue(r: Reward): string {
  if (r.discount_type && r.discount_value != null) {
    const v = Number(r.discount_value);
    const amt = Number.isInteger(v) ? `${v}` : v.toFixed(2).replace(/\.?0+$/, '');
    return r.discount_type === 'percentage' ? `${amt}% off` : `£${amt} off`;
  }
  return r.value_label ?? r.description ?? '';
}

function toUIReward(r: Reward): UIReward {
  return {
    id: r.id,
    title: r.title,
    partner: r.partner?.name ?? r.brand_name ?? '',
    pts: r.powr_cost,
    value: formatValue(r),
    logoText: (r.partner?.name ?? r.brand_name ?? '??').slice(0, 4).toUpperCase(),
    logoUrl: r.image_url ?? r.partner?.logo_url ?? null,
    heroUrl: r.hero_image_url ?? null,
    url: r.url || null,
    integrationType: r.integration_type,
  };
}

export default function RedeemModal() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { balance, loading: balanceLoading, refresh } = usePoints();

  const [reward, setReward] = useState<UIReward | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stage, setStage] = useState<'confirm' | 'success'>('confirm');
  const [alreadyRedeemed, setAlreadyRedeemed] = useState(false);
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      // Load reward and check for an existing active redemption in parallel
      const [rewardRes, redemptionRes] = await Promise.all([
        supabase
          .from('rewards')
          .select('id, partner_id, title, description, powr_cost, category, integration_type, code_expiry_days, active, offer, hero_image_url, image_url, url, value_label, discount_type, discount_value, brand_name, partners(id, name, partner_code, logo_url, category, checkout_url_template)')
          .eq('id', id)
          .single(),
        supabase
          .from('redemptions')
          .select('code, expires_at, status')
          .eq('reward_id', id)
          .eq('status', 'active')
          .order('redeemed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (rewardRes.error || !rewardRes.data) { setLoadError('Reward not found.'); return; }
      const full: Reward = { ...(rewardRes.data as any), partner: Array.isArray((rewardRes.data as any).partners) ? (rewardRes.data as any).partners[0] : (rewardRes.data as any).partners };
      setReward(toUIReward(full));

      // If the user already has an active unreconciled code, show it immediately
      if (redemptionRes.data?.code) {
        setCode(redemptionRes.data.code);
        setExpiresAt(redemptionRes.data.expires_at ?? null);
        setCheckoutUrl(full.url || null);
        setAlreadyRedeemed(true);
        setStage('success');
      }
    })();
  }, [id]);

  if (loadError) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{loadError}</Text>
      </View>
    );
  }
  if (!reward || balanceLoading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color='#E8D200' />
      </View>
    );
  }

  const canAfford = balance >= reward.pts;
  const remaining = balance - reward.pts;

  async function handleConfirm() {
    if (!reward || submitting) return;
    setSubmitting(true);
    setRedeemError(null);
    try {
      const result = await redeemReward(reward.id);
      setCode(result.code);
      setExpiresAt(result.expires_at);
      // Use checkout_url from function, fall back to reward's own url
      setCheckoutUrl(result.checkout_url || reward.url || null);
      setStage('success');
      refresh();
    } catch (e) {
      if (e instanceof RedemptionError) {
        setRedeemError(
          e.code === 'INSUFFICIENT_POINTS' ? "You don't have enough POWR."
          : e.code === 'OUT_OF_STOCK' ? 'This reward is temporarily unavailable. Check back soon.'
          : e.code === 'REWARD_INACTIVE' ? 'This reward is no longer available.'
          : e.code === 'REDEMPTION_LIMIT_REACHED' ? "You've already claimed the maximum number of this reward."
          : e.code === 'REWARD_NOT_FOUND' ? 'Reward not found. Please go back and try again.'
          : e.code === 'PARTNER_MISCONFIGURED' ? 'This reward is not yet available. Please try again later.'
          : `Something went wrong (${e.code}). Please try again.`
        );
      } else {
        setRedeemError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleCopy() {
    Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleOpenCheckout() {
    if (checkoutUrl) Linking.openURL(checkoutUrl);
  }

  return (
    <View style={[styles.screen, stage === 'success' && styles.screenFull, { paddingBottom: insets.bottom + 16 }]}>
      <GeometricBackground />
      {/* Drag handle — confirm only */}
      {stage === 'confirm' && <View style={styles.handle} />}

      {stage === 'confirm' ? (
        <ConfirmView
          reward={reward}
          balance={balance}
          canAfford={canAfford}
          remaining={remaining}
          submitting={submitting}
          error={redeemError}
          onConfirm={handleConfirm}
          onCancel={() => router.back()}
        />
      ) : (
        <SuccessView
          reward={reward}
          code={code}
          expiresAt={expiresAt}
          copied={copied}
          checkoutUrl={checkoutUrl}
          alreadyRedeemed={alreadyRedeemed}
          onCopy={handleCopy}
          onOpenCheckout={handleOpenCheckout}
          onDone={() => router.back()}
        />
      )}
    </View>
  );
}

// ─── Confirm view ─────────────────────────────────────────────────────────────

interface ConfirmProps {
  reward: UIReward;
  balance: number;
  canAfford: boolean;
  remaining: number;
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmView({ reward, balance, canAfford, remaining, submitting, error, onConfirm, onCancel }: ConfirmProps) {
  return (
    <View style={styles.sheet}>
      {/* Hero image */}
      {reward.heroUrl && (
        <View style={styles.heroWrap}>
          <ExpoImage source={{ uri: reward.heroUrl }} style={styles.heroImg} contentFit="cover" contentPosition="top" />
          <LinearGradient
            colors={['rgba(13,13,13,0)', 'rgba(13,13,13,0.6)', '#0d0d0d']}
            locations={[0.3, 0.7, 1]}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
        </View>
      )}

      {/* Reward identity */}
      <View style={styles.rewardIdentity}>
        <View style={styles.logoBox}>
          {reward.logoUrl ? (
            <ExpoImage source={{ uri: reward.logoUrl }} style={styles.logoImage} contentFit="contain" />
          ) : (
            <Text style={styles.logoText}>{reward.logoText}</Text>
          )}
        </View>
        <View style={styles.rewardMeta}>
          <Text style={styles.rewardTitle}>{reward.title}</Text>
          <Text style={styles.rewardPartner}>{reward.partner}</Text>
        </View>
        {reward.value ? <Text style={styles.rewardValue}>{reward.value}</Text> : null}
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

      {error && (
        <View style={styles.insufficientBanner}>
          <Ionicons name="alert-circle-outline" size={14} color='#f87171' />
          <Text style={styles.insufficientText}>{error}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.confirmBtn,
            (!canAfford || submitting) && styles.confirmBtnDisabled,
            pressed && canAfford && !submitting && { opacity: 0.85 },
          ]}
          onPress={canAfford && !submitting ? onConfirm : undefined}
        >
          {submitting ? (
            <ActivityIndicator color='#0a0a0a' />
          ) : (
            <Text style={[styles.confirmBtnText, !canAfford && styles.confirmBtnTextDisabled]}>
              Confirm Redemption
            </Text>
          )}
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
  reward: UIReward;
  code: string;
  expiresAt: string | null;
  copied: boolean;
  checkoutUrl: string | null;
  alreadyRedeemed: boolean;
  onCopy: () => void;
  onOpenCheckout: () => void;
  onDone: () => void;
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return 'Show to staff or enter at checkout';
  const d = new Date(expiresAt);
  return `Valid until ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · Show to staff or enter at checkout`;
}

function SuccessView({ reward, code, expiresAt, copied, checkoutUrl, alreadyRedeemed, onCopy, onOpenCheckout, onDone }: SuccessProps) {
  const partnerLabel = reward.partner && reward.partner.toUpperCase() !== reward.title.toUpperCase() ? reward.partner : null;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.successSheet}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      {/* TOP: logo */}
      <View style={styles.successHeroWrap}>
        {reward.logoUrl ? (
          <ExpoImage source={{ uri: reward.logoUrl }} style={styles.successLogoLarge} contentFit="contain" />
        ) : (
          <View style={styles.successLogoFallback}>
            <Text style={styles.successLogoFallbackText}>{(reward.partner || reward.title).slice(0, 2).toUpperCase()}</Text>
          </View>
        )}
      </View>

      {/* MIDDLE: cover image */}
      {reward.heroUrl && (
        <View style={styles.successCoverWrap}>
            <ExpoImage source={{ uri: reward.heroUrl }} style={styles.successCoverImg} contentFit="contain" />
          <LinearGradient
            colors={['rgba(13,13,13,0)', 'rgba(13,13,13,0.6)', '#0d0d0d']}
            locations={[0.4, 0.8, 1]}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
        </View>
      )}

      {/* BOTTOM: code + buttons */}
      <View style={styles.successBottom}>
        {alreadyRedeemed && (
          <View style={styles.alreadyRedeemedBanner}>
            <Ionicons name="information-circle-outline" size={14} color={GOLD} />
            <Text style={styles.alreadyRedeemedText}>
              {reward.integrationType === 'AFFILIATE'
                ? 'Your discount is included in the link below.'
                : "You've already redeemed this reward. Your code is below."}
            </Text>
          </View>
        )}

        {reward.integrationType === 'AFFILIATE' ? (
          <>
            <Text style={styles.affiliateHint}>Your discount is applied automatically at checkout.</Text>
            {checkoutUrl && (
              <Pressable
                style={({ pressed }) => [styles.confirmBtn, pressed && { opacity: 0.85 }]}
                onPress={onOpenCheckout}
              >
                <Ionicons name="open-outline" size={16} color="#0a0a0a" />
                <Text style={styles.confirmBtnText}>Shop at {partnerLabel || reward.title}</Text>
              </Pressable>
            )}
          </>
        ) : (
          <>
            <Pressable
              style={({ pressed }) => [styles.codeBlock, pressed && { opacity: 0.8 }]}
              onPress={onCopy}
            >
              <Text style={styles.codeLabel}>YOUR CODE</Text>
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

            <Text style={styles.codeExpiry}>{formatExpiry(expiresAt)}</Text>

            {checkoutUrl && (
              <Pressable
                style={({ pressed }) => [styles.visitBtn, pressed && { opacity: 0.85 }]}
                onPress={onOpenCheckout}
              >
                <Ionicons name="open-outline" size={14} color="#0a0a0a" />
                <Text style={styles.visitBtnText}>Use code at {partnerLabel || reward.title}</Text>
              </Pressable>
            )}
          </>
        )}
        <Pressable
          style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.85 }]}
          onPress={onDone}
        >
          <Text style={styles.doneBtnText}>Done</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    justifyContent: 'flex-end',
  },
  screenFull: {
    justifyContent: 'flex-start',
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

  // Hero image
  heroWrap: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    marginHorizontal: -20,
    marginTop: -8,
  },
  heroImg: {
    width: '100%',
    height: '100%',
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
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  logoText: {
    fontSize: 11,
    fontWeight: '600',
    color: DIM,
    textAlign: 'center',
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

  // Success screen
  successSheet: {
    flexGrow: 1,
  },
  successScrollContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },
  successHeroWrap: {
    width: '100%',
    paddingTop: 160,
    paddingBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCoverWrap: {
    width: '100%',
    height: 260,
    overflow: 'hidden',
  },
  successCoverImg: {
    width: '100%',
    height: '100%',
  },
  statusPill: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusPillGreen: {
    backgroundColor: 'rgba(74,222,128,0.1)',
    borderColor: 'rgba(74,222,128,0.3)',
  },
  statusPillAmber: {
    backgroundColor: 'rgba(232,210,0,0.08)',
    borderColor: 'rgba(232,210,0,0.25)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotGreen: { backgroundColor: '#4ade80' },
  statusDotAmber: { backgroundColor: GOLD },
  statusPillText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  statusPillTextGreen: { color: '#4ade80' },
  statusPillTextAmber: { color: GOLD },
  successLogoLarge: {
    width: 160,
    height: 80,
  },
  successLogoFallback: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successLogoFallbackText: {
    fontSize: 28,
    fontWeight: '200',
    color: DIM,
    letterSpacing: 2,
  },
  successBodyTop: {
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  successBodyBottom: {
    gap: 10,
    marginTop: 'auto',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  successBottom: {
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: 8,
    marginTop: 'auto',
  },
  alreadyRedeemedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(232,210,0,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.2)',
    borderRadius: 10,
    padding: 12,
  },
  alreadyRedeemedText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '300',
    color: 'rgba(232,210,0,0.8)',
    lineHeight: 18,
  },

  // Code block
  codeBlock: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.2)',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  codeLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    color: MUTED,
  },
  codeText: {
    fontSize: 20,
    fontWeight: '200',
    letterSpacing: 3,
    color: TEXT,
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

  affiliateHint: {
    fontSize: 13,
    fontWeight: '300',
    color: DIM,
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  visitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 20,
    paddingVertical: 14,
  },
  visitBtnText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#0a0a0a',
    textTransform: 'uppercase',
  },
  doneBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: {
    fontSize: 13,
    fontWeight: '400',
    letterSpacing: 1.2,
    color: DIM,
    textTransform: 'uppercase',
  },
});

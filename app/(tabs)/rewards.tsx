import { GeometricBackground } from '@/components/home/GeometricBackground';
import MagicRings from '@/components/MagicRings';
import { HeaderActions } from '@/components/HeaderActions';
import { RewardHeroMedia } from '@/components/rewards/RewardHeroMedia';
import { VaultWidget } from '@/components/rewards/VaultWidget';
import { useQueryClient } from '@tanstack/react-query';

import { usePoints } from '@/hooks/usePoints';
import { useRollingNumber } from '@/hooks/useRollingNumber';
import { useVaultAccess } from '@/hooks/useVaultAccess';
import { fetchMyRedemptionSummary, fetchRewards, fetchSmartFeaturedReward, type Reward as ApiReward } from '@/lib/api/rewards';
import { resolveContextualPlacements, pickHeroPlacement, comparePlacements, type ResolvedPlacement } from '@/lib/api/placements';
import { fetchVaultContents } from '@/lib/api/vault';
import { tracked } from '@/lib/analytics';
import { rewardHeroUri, rewardLogoUri } from '@/lib/storageImage';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD    = '#E8D200';
const GOLD_RGBA = (a: number) => `rgba(232,210,0,${a})`;
const BG      = '#1E1E1E';
const CARD_BG = 'rgba(40,40,40,0.85)';
const BORDER  = 'rgba(255,255,255,0.08)';
const TEXT    = '#F2F2F2';
const MUTED   = 'rgba(255,255,255,0.35)';
const DIM     = 'rgba(255,255,255,0.55)';

// ─── Data ─────────────────────────────────────────────────────────────────────

type Category = 'ALL' | 'EAT' | 'MOVE' | 'MIND' | 'SLEEP';
const CATEGORIES: Category[] = ['ALL', 'EAT', 'MOVE', 'MIND', 'SLEEP'];

interface Reward {
  id: string;
  category: Exclude<Category, 'ALL'>;
  logoText: string;
  brandName: string;
  logoLight: boolean;
  logoImage?: any;
  heroImage?: any;
  heroImageUrl?: string;
  heroVideoUrl?: string;
  brandColor?: string;
  title: string;
  subtitle: string;
  pts: number;
  value?: string;
  offer?: string;
  partnerBlurb?: string;
  url?: string;
  maxPerUser?: number | null;
}

// ─── Affordability helpers ─────────────────────────────────────────────────────

type Afford = 'can' | 'close' | 'locked';

function affordability(balance: number, pts: number): Afford {
  if (balance >= pts) return 'can';
  if (balance >= pts * 0.6) return 'close';
  return 'locked';
}

function formatDiscountValue(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function getRewardDisplayValue(reward: Pick<ApiReward, 'discount_type' | 'discount_value' | 'value_label'>): string | undefined {
  if (reward.discount_type && reward.discount_value != null) {
    const amount = formatDiscountValue(Number(reward.discount_value));
    return reward.discount_type === 'percentage' ? `${amount}% off` : `£${amount} off`;
  }
  return reward.value_label ?? undefined;
}

function splitDiscount(label?: string): { amount: string; suffix: string } {
  if (!label) return { amount: '', suffix: '' };
  const m = label.match(/^(.+?)\s*(OFF|off)$/);
  return m ? { amount: m[1].trim(), suffix: 'OFF' } : { amount: label, suffix: '' };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const DB_TO_UI_CATEGORY: Record<string, Exclude<Category, 'ALL'>> = {
  gym: 'MOVE',
  move: 'MOVE',
  health: 'MIND',
  mind: 'MIND',
  nutrition: 'EAT',
  food: 'EAT',
  eat: 'EAT',
  sleep: 'SLEEP',
  fashion: 'SLEEP',
  gear: 'SLEEP',
};

function apiRewardToUI(r: ApiReward): Reward {
  const displayName = r.partner?.name ?? r.brand_name ?? null;
  const logoText = (displayName ?? '??').slice(0, 5).toLowerCase();
  return {
    id: r.id,
    category: DB_TO_UI_CATEGORY[r.category] ?? 'SLEEP',
    logoText,
    brandName: displayName ?? r.title,
    logoLight: false,
    logoImage: r.image_url ? { uri: rewardLogoUri(r.image_url) } : r.partner?.logo_url ? { uri: rewardLogoUri(r.partner.logo_url) } : undefined,
    heroImage: r.hero_image_url ? { uri: rewardHeroUri(r.hero_image_url) } : undefined,
    heroImageUrl: r.hero_image_url ?? undefined,
    heroVideoUrl: r.hero_video_url ?? undefined,
    brandColor: undefined,
    title: r.title,
    subtitle: r.description ?? displayName ?? '',
    pts: r.powr_cost,
    value: getRewardDisplayValue(r),
    offer: r.offer ?? undefined,
    partnerBlurb: r.partner_blurb ?? undefined,
    url: r.url ?? undefined,
    maxPerUser: r.max_redemptions_per_user,
  };
}

export default function SpendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<Category>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { balance, todayEarned, loading, refresh: refreshPoints } = usePoints();
  const scrollViewRef = useRef<ScrollView>(null);
  const rewardPositions = useRef<Record<string, number>>({});
  const pendingRevealId = useRef<string | null>(null);

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext({
      duration: 260,
      create:  { type: 'easeInEaseOut', property: 'opacity' },
      update:  { type: 'easeInEaseOut' },
      delete:  { type: 'easeInEaseOut', property: 'opacity' },
    });
    Haptics.selectionAsync();
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const [featuredReward, setFeaturedReward] = useState<ApiReward | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [catalogueLoaded, setCatalogueLoaded] = useState(false);
  const [catalogueError, setCatalogueError] = useState(false);
  // Raw API rewards kept alongside the UI list so a placed reward can be
  // rehydrated into the hero card (which renders from ApiReward fields).
  const [rawRewards, setRawRewards] = useState<ApiReward[]>([]);
  const [redemptionInfo, setRedemptionInfo] = useState<Record<string, { active: number; nonRefunded: number }>>({});
  // Location-targeted placements, keyed by reward_id. Empty = normal vault.
  const [placementMap, setPlacementMap] = useState<Map<string, ResolvedPlacement>>(new Map());
  // Resolve at a specific coarse fix and update the placement map. The API
  // records bounded in-app impressions server-side; a fresh read additionally
  // records a bounded presence signal after resolver validation.
  const applyResolvedAt = useCallback(async (lat: number, lng: number, fresh: boolean) => {
    const placements = await resolveContextualPlacements(lat, lng, {
      recordSurface: true,
      confirmPresence: fresh,
    });
    const map = new Map<string, ResolvedPlacement>();
    for (const p of placements) if (!map.has(p.reward_id)) map.set(p.reward_id, p);
    setPlacementMap(map);
  }, []);

  const loadPlacements = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') { setPlacementMap(new Map()); return; }
      // Prefer a recent cached fix (instant, good enough for a boost), but
      // reject a stale/inaccurate one so a paid "you're here" surface isn't
      // driven by yesterday's location. Fall back to a fresh read.
      let pos = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 250 });
      let fresh = false;
      if (!pos) {
        pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        fresh = true;
      }
      if (!pos) { setPlacementMap(new Map()); return; }
      await applyResolvedAt(pos.coords.latitude, pos.coords.longitude, fresh);
    } catch {
      // fail-safe: keep the normal vault
    }
  }, [applyResolvedAt]);

  const loadRewards = useCallback(async () => {
    try {
      const [data, featured, summary] = await Promise.all([
        fetchRewards(),
        fetchSmartFeaturedReward(balance),
        fetchMyRedemptionSummary().catch(() => ({})),
      ]);
      setRewards(data.map(apiRewardToUI));
      setRawRewards(data);
      setFeaturedReward(featured);
      setRedemptionInfo(summary);
      setCatalogueLoaded(true);
      setCatalogueError(false);
    } catch {
      // Keep whatever loaded previously; only surface the error state when
      // there's nothing to show at all.
      setCatalogueError(true);
    }
  }, [balance]);
  useEffect(() => { loadRewards(); }, [loadRewards]);
  useEffect(() => { loadPlacements(); }, [loadPlacements]);

  useFocusEffect(
    useCallback(() => {
      refreshPoints();
      loadRewards();
      loadPlacements();
    }, [refreshPoints, loadRewards, loadPlacements])
  );

  // Live step-in / step-out: while the Rewards tab is focused, watch position
  // and re-resolve so the hero swaps the moment the user crosses a boundary,
  // then reverts when they leave. Stops on blur to spare the battery. Uses the
  // existing foreground permission only — never prompts.
  useFocusEffect(
    useCallback(() => {
      let sub: Location.LocationSubscription | null = null;
      let cancelled = false;
      // remove() throws on web (expo-location's emitter lacks removeSubscription),
      // which crashed the whole app on tab blur — never let cleanup throw.
      const removeSub = () => { try { sub?.remove(); } catch {} finally { sub = null; } };
      (async () => {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status !== 'granted' || cancelled) return;
          sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, distanceInterval: 40, timeInterval: 20000 },
            (pos) => { applyResolvedAt(pos.coords.latitude, pos.coords.longitude, true).catch(() => {}); },
          );
          if (cancelled) { removeSub(); }
        } catch {
          // fail-safe: the one-shot loadPlacements still covers the common case
        }
      })();
      return () => { cancelled = true; removeSub(); };
    }, [applyResolvedAt])
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshPoints(), loadRewards(), loadPlacements()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshPoints, loadRewards, loadPlacements]);

  const filtered = activeCategory === 'ALL'
    ? rewards
    : rewards.filter((r) => r.category === activeCategory);

  // Boost placed rewards to the front (paid → priority → nearest); hide nothing.
  const sorted = placementMap.size === 0
    ? filtered
    : [
        ...filtered.filter((r) => placementMap.has(r.id)).sort(
          (a, b) => comparePlacements(placementMap.get(a.id)!, placementMap.get(b.id)!),
        ),
        ...filtered.filter((r) => !placementMap.has(r.id)),
      ];

  // Hero takeover: the best placement whose reward is visible seizes the hero
  // card while the user is in-zone; when they step out (placements clear on the
  // next resolve) it falls straight back to the scheduled/smart featured reward.
  const heroPlacement = useMemo(
    () => (placementMap.size
      ? pickHeroPlacement(new Set(rewards.map((r) => r.id)), [...placementMap.values()])
      : null),
    [placementMap, rewards],
  );
  const placedHero = heroPlacement
    ? rawRewards.find((r) => r.id === heroPlacement.reward_id) ?? null
    : null;
  const heroReward = placedHero ?? featuredReward;

  const featuredAfford = heroReward ? affordability(balance, heroReward.powr_cost) : 'locked';
  const walletCount = Object.values(redemptionInfo).reduce((sum, e) => sum + e.active, 0);
  const revealFeaturedInList = useCallback((id: string) => {
    Haptics.selectionAsync();
    setActiveCategory('ALL');
    setExpandedId(id);
    pendingRevealId.current = id;
    setTimeout(() => {
      const y = rewardPositions.current[id];
      if (typeof y === 'number') {
        scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
        pendingRevealId.current = null;
      }
    }, 80);
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <GeometricBackground />
      <View style={styles.header}>
        <Text style={styles.title}>Rewards</Text>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.walletBtn}
            onPress={() => { Haptics.selectionAsync(); router.push('/wallet'); }}
            hitSlop={8}
          >
            <Ionicons name="wallet-outline" size={20} color={TEXT} />
            {walletCount > 0 && (
              <View style={styles.walletBadge}>
                <Text style={styles.walletBadgeText}>{walletCount > 9 ? '9+' : walletCount}</Text>
              </View>
            )}
          </Pressable>
          <HeaderActions />
        </View>
      </View>

      <View style={styles.topContent}>
        <BalanceCard
          balance={balance}
          todayEarned={todayEarned}
          loading={loading}
        />

        {heroReward && (
          <FeaturedCard
            featured={heroReward}
            afford={featuredAfford}
            balance={balance}
            placement={placedHero ? heroPlacement : null}
            onRedeem={() => revealFeaturedInList(heroReward.id)}
          />
        )}

        <View style={styles.catTabBar}>
          {CATEGORIES.map((cat) => {
            const active = cat === activeCategory;
            return (
              <Pressable
                key={cat}
                style={styles.catTab}
                onPress={() => {
                  Haptics.selectionAsync();
                  setActiveCategory(cat);
                }}
              >
                <Text style={[styles.catTabLabel, active && styles.catTabLabelActive]}>
                  {cat}
                </Text>
                {active && <View style={styles.catTabIndicator} />}
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#E8D200"
            colors={['#E8D200']}
          />
        }
      >
        {!catalogueLoaded && !catalogueError ? (
          <View style={styles.keepMovingCenterWrap}>
            <ActivityIndicator color={GOLD} />
          </View>
        ) : !catalogueLoaded && catalogueError ? (
          <View style={styles.keepMovingCenterWrap}>
            <Ionicons name="cloud-offline-outline" size={26} color={MUTED} />
            <Text style={styles.catalogueStatusText}>Couldn&apos;t load rewards.</Text>
            <Pressable style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]} onPress={loadRewards}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </Pressable>
          </View>
        ) : sorted.length === 0 ? (
          // Empty category — MIND/SLEEP style teaser until rewards land there.
          <View style={styles.keepMovingCenterWrap}>
            {activeCategory === 'ALL' ? (
              <Text style={styles.catalogueStatusText}>New rewards coming soon.</Text>
            ) : (
              <KeepMovingUnlockCard />
            )}
          </View>
        ) : (
          <View style={styles.rewardsList}>
            {sorted.map((reward) => (
              <View
                key={reward.id}
                onLayout={(e) => {
                  const y = e.nativeEvent.layout.y;
                  rewardPositions.current[reward.id] = y;
                  if (pendingRevealId.current === reward.id) {
                    scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
                    pendingRevealId.current = null;
                  }
                }}
              >
                <RewardCard
                  reward={reward}
                  placement={placementMap.get(reward.id)}
                  afford={affordability(balance, reward.pts)}
                  balance={balance}
                  expanded={expandedId === reward.id}
                  activeCount={redemptionInfo[reward.id]?.active ?? 0}
                  capReached={reward.maxPerUser != null && (redemptionInfo[reward.id]?.nonRefunded ?? 0) >= reward.maxPerUser}
                  onToggle={() => toggleExpand(reward.id)}
                  onRedeem={() => {
                    // 'redeemed' attribution is recorded server-side by the
                    // redemptions trigger on a confirmed spend — not on tap.
                    router.push({ pathname: '/redeem-modal', params: { id: reward.id } });
                  }}
                  onViewWallet={() => router.push('/wallet')}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Balance Card ─────────────────────────────────────────────────────────────

interface BalanceCardProps {
  balance: number;
  todayEarned: number;
  loading: boolean;
}

function BalanceCard({ balance, todayEarned, loading }: BalanceCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const vaultEnabled = useVaultAccess();
  // Warms the Vault's deposits query on tap so /vault does not start its
  // fetch from cold — see the comment on VaultWidget below.
  const prefetchVault = useCallback(
    () => queryClient.prefetchQuery({ queryKey: ['vault', 'contents'], queryFn: fetchVaultContents }),
    [queryClient],
  );
  // Rolls up when the balance increases (vault unlocks, session claims);
  // loads and spends snap silently.
  const displayBalance = useRollingNumber(balance, !loading);
  return (
    <View style={styles.balanceCard}>
      <View style={styles.balanceRow}>
        <View style={styles.balanceLeft}>
          <Text style={styles.metaLabel}>Available balance</Text>
          <View style={styles.balanceNumberRow}>
            <Text style={[styles.balanceNumber, loading && { opacity: 0.4 }]}>
              {displayBalance.toLocaleString()}
            </Text>
            <Text style={styles.balanceUnit}>Points</Text>
          </View>
          {todayEarned > 0 && (
            <View style={styles.todayBadgeUnder}>
              <View style={styles.todayDot} />
              <Text style={styles.todayBadgeText}>+{todayEarned} today</Text>
            </View>
          )}
        </View>
        {/* Visible to everyone IN THE ROLLOUT — even with an empty vault, so
            it is discoverable before the first deposit banks. Users outside the
            rollout keep banking POWR they cannot see yet; this widget is the
            only entry point, so hiding it hides the feature.
            Prefetching on press means the deposits query is usually already in
            flight (often resolved) by the time /vault mounts, so its hero fills
            in as the door appears rather than a second later. */}
        {vaultEnabled && (
          <VaultWidget
            onPress={() => {
              void prefetchVault();
              router.push('/vault');
            }}
          />
        )}
      </View>
    </View>
  );
}

// ─── Featured Card ────────────────────────────────────────────────────────────

interface FeaturedProps {
  featured: ApiReward;
  afford: Afford;
  balance: number;
  /** Set when a location placement has taken over the hero (in-zone). */
  placement?: ResolvedPlacement | null;
  onRedeem: () => void;
}

function FeaturedCard({ featured, afford, balance, placement, onRedeem }: FeaturedProps) {
  const pts = featured.powr_cost;
  const ptsNeeded = pts - balance;
  const progress = Math.min(balance / pts, 1);
  const subtitle = featured.description ?? '';
  const value = getRewardDisplayValue(featured);
  const { amount, suffix } = splitDiscount(value);
  const logoSrc = featured.image_url
    ? { uri: rewardLogoUri(featured.image_url)! }
    : featured.partner?.logo_url
    ? { uri: rewardLogoUri(featured.partner.logo_url)! }
    : null;
  return (
    <View style={styles.featuredCard}>
      <View style={styles.featuredHero}>
        <RewardHeroMedia
          videoUrl={featured.hero_video_url}
          imageUrl={featured.hero_image_url}
          style={styles.featuredHeroImg}
          contentFit="cover"
          contentPosition="top"
        />
        <LinearGradient
          colors={['rgba(10,10,10,0)', 'rgba(10,10,10,0.45)', 'rgba(10,10,10,0.85)']}
          locations={[0.3, 0.65, 1]}
          style={StyleSheet.absoluteFillObject}
        />

        <View style={styles.featuredPointsBlock}>
          <Text style={styles.featuredPtsNum}>{pts} <Text style={styles.featuredPtsUnit}>points</Text></Text>
        </View>

        {placement && (
          placement.paid ? (
            // Paid = a brand bought this slot → clear "AD" disclosure.
            <View style={styles.featuredAdTag}>
              <Text style={styles.featuredAdTagText}>AD</Text>
            </View>
          ) : (
            // First-party curation → just the useful "nearby" signal.
            <View style={styles.featuredZoneBadge}>
              <Ionicons name="location" size={10} color="#0a0a0a" />
              <Text style={styles.featuredZoneBadgeText}>NEARBY NOW</Text>
            </View>
          )
        )}

        <View style={styles.featuredOverlayBody}>
          {logoSrc && (
            <View style={styles.featuredLogoSubtitleRow}>
              <ExpoImage source={logoSrc} style={styles.featuredLogoInline} contentFit="contain" />
            </View>
          )}

          {afford !== 'can' && (
            <View style={styles.featuredProgressWrap}>
              <View style={[styles.featuredProgressBar, { width: `${progress * 100}%` as any }]} />
            </View>
          )}

          <View style={styles.featuredFooter}>
            {value ? (
              <View style={styles.featuredDiscountBadge}>
                <Text style={styles.featuredDiscountAmount}>{amount}</Text>
                {suffix ? <Text style={styles.featuredDiscountSuffix}> {suffix}</Text> : null}
              </View>
            ) : <View />}
            {afford === 'can' ? (
              <Pressable style={({ pressed }) => [styles.redeemPrimary, pressed && { opacity: 0.85 }]} onPress={tracked('reward_redeem_start', onRedeem)}>
                <Text style={styles.redeemPrimaryText}>Redeem</Text>
                <Ionicons name="arrow-forward" size={13} color="#0a0a0a" />
              </Pressable>
            ) : afford === 'close' ? (
              <Text style={styles.closeText}>{ptsNeeded} pts away</Text>
            ) : (
              <View style={styles.lockedBlock}>
                <Ionicons name="lock-closed" size={11} color={MUTED} />
                <Text style={styles.lockedText}>{ptsNeeded.toLocaleString()} pts</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Reward Card ──────────────────────────────────────────────────────────────

interface RewardCardProps {
  reward: Reward;
  placement?: ResolvedPlacement;
  afford: Afford;
  balance: number;
  expanded: boolean;
  activeCount: number;
  capReached: boolean;
  onToggle: () => void;
  onRedeem: () => void;
  onViewWallet: () => void;
}

function RewardCard({ reward, placement, afford, balance, expanded, activeCount, capReached, onToggle, onRedeem, onViewWallet }: RewardCardProps) {
  const ptsNeeded = reward.pts - balance;
  const progress = Math.min(balance / reward.pts, 1);
  const isLocked = afford === 'locked';

  const brand = reward.brandColor ?? '#FFFFFF';

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.rewardCard,
        isLocked && styles.rewardCardLocked,
        expanded && { borderColor: brand + '55' },
        pressed && !isLocked && { opacity: 0.92 },
      ]}
    >
      {expanded && (reward.heroVideoUrl || reward.heroImageUrl) && (
        <View style={styles.heroBanner} collapsable={false}>
          <RewardHeroMedia
            videoUrl={reward.heroVideoUrl}
            imageUrl={reward.heroImageUrl}
            style={styles.heroImage}
            contentFit="cover"
          />
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(30,30,30,0.95)']}
            start={{ x: 0, y: 0.6 }}
            end={{ x: 0, y: 1 }}
            style={styles.heroFade}
            pointerEvents="none"
          />
        </View>
      )}
      {expanded && (
        <LinearGradient
          colors={[brand + '22', 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}

      <View style={styles.rewardRowTop}>
        <View
          style={[
            styles.logoBox,
            reward.logoLight && styles.logoBoxLight,
            isLocked && styles.logoBoxLocked,
            reward.logoImage && styles.logoBoxBare,
            expanded && { width: 64, height: 64 },
          ]}
        >
          {reward.logoImage ? (
            <Image source={reward.logoImage} style={styles.logoImage} resizeMode="contain" />
          ) : (
            <Text
              style={[styles.logoText, reward.logoLight && styles.logoTextDark, isLocked && styles.logoTextLocked]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {reward.logoText}
            </Text>
          )}
        </View>

        <View style={styles.rewardInfo}>
          <Text style={[styles.rewardTitle, isLocked && styles.rewardTitleLocked]} numberOfLines={expanded ? 2 : 1}>
            {reward.title}
          </Text>
          <Text style={styles.rewardSubtitle} numberOfLines={1}>{reward.subtitle}</Text>
          {placement && (
            placement.paid ? (
              <View style={styles.placementAdTag}>
                <Text style={styles.placementAdText}>AD</Text>
              </View>
            ) : (
              <View style={styles.placementPill}>
                <Ionicons name="location" size={9} color={GOLD} />
                <Text style={styles.placementPillText}>NEARBY</Text>
              </View>
            )
          )}
        </View>

        {!expanded && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {activeCount > 0 && (
              <Ionicons name="wallet" size={14} color="#4ade80" />
            )}
            {reward.value ? (
              <View style={[
                styles.rewardValueBadge,
                { borderColor: brand + '55', backgroundColor: brand + '12' },
                afford === 'close' && { opacity: progress },
                afford === 'locked' && { opacity: 1 },
              ]}>
                <Text style={[styles.rewardValueBadgeText, { color: brand }]}>{reward.value}</Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.rewardRight}>
          {!capReached && (
            <>
              <Text style={[styles.rewardPts, isLocked && styles.rewardPtsLocked]}>
                {reward.pts}
              </Text>
              <Text style={[styles.rewardPtsUnit, isLocked && styles.rewardPtsLocked]}>pts</Text>
            </>
          )}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={isLocked ? MUTED : DIM}
            style={{ marginTop: 2 }}
          />
        </View>
      </View>

      {expanded && (
        <View style={styles.expandedPanel}>
          {(reward.value || reward.partnerBlurb) && (
            <View style={styles.expandedTopRow}>
              {reward.value && (
                <View style={[
                  styles.expandedValueBadge,
                  { borderColor: brand + '66', backgroundColor: brand + '14' },
                  afford === 'close' && { opacity: progress },
                ]}>
                  <Text style={[styles.expandedValueBadgeText, { color: brand }]}>{reward.value}</Text>
                </View>
              )}

              {reward.partnerBlurb && (
                <View style={styles.aboutBlock}>
                  <Text style={styles.expandedLabel}>About {reward.brandName.toUpperCase()}</Text>
                  <Text style={styles.expandedBlurb}>{reward.partnerBlurb}</Text>
                </View>
              )}
            </View>
          )}

          {reward.offer && <Text style={styles.expandedOffer}>{reward.offer}</Text>}

          {capReached ? (
            <Pressable
              onPress={() => { Haptics.selectionAsync(); onViewWallet(); }}
              style={({ pressed }) => [styles.redeemInlineBtn, { backgroundColor: 'rgba(74,222,128,0.12)', borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)' }, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="wallet-outline" size={14} color="#4ade80" />
              <Text style={[styles.redeemInlineBtnText, { color: '#4ade80' }]}>In your wallet · View</Text>
            </Pressable>
          ) : afford === 'can' ? (
            <>
              <Pressable
                onPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  onRedeem();
                }}
                style={({ pressed }) => [
                  styles.redeemInlineBtn,
                  { backgroundColor: brand },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Ionicons name="gift-outline" size={14} color="#000" />
                <Text style={styles.redeemInlineBtnText}>{activeCount > 0 ? 'Redeem again' : 'Redeem'} for {reward.pts} pts</Text>
              </Pressable>
              {activeCount > 0 && (
                <Pressable
                  onPress={() => { Haptics.selectionAsync(); onViewWallet(); }}
                  style={({ pressed }) => [styles.walletLink, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="wallet-outline" size={12} color="#4ade80" />
                  <Text style={styles.walletLinkText}>{activeCount} in your wallet</Text>
                  <Ionicons name="chevron-forward" size={11} color="#4ade80" />
                </Pressable>
              )}
            </>
          ) : null}

          {!capReached && afford !== 'can' && (
            <View style={styles.lockedBlock}>
              <Ionicons name="lock-closed" size={10} color={MUTED} />
              <Text style={styles.lockedText}>
                {ptsNeeded.toLocaleString()} pts {afford === 'close' ? 'away' : 'needed'}
              </Text>
            </View>
          )}

          <View style={styles.expandedFooter}>
            {reward.url && (
              <Pressable
                onPress={() => reward.url && Linking.openURL(reward.url)}
                style={({ pressed }) => [styles.partnerLink, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.partnerLinkText, { color: brand }]}>Visit partner</Text>
                <Ionicons name="open-outline" size={13} color={brand} />
              </Pressable>
            )}
          </View>
        </View>
      )}
    </Pressable>
  );
}

function KeepMovingUnlockCard() {
  return (
    <View style={styles.keepMovingCard}>
      <View style={styles.keepMovingRingWrap}>
        <MagicRings
          color="#E8D200"
          colorTwo="#f59e0b"
          ringCount={5}
          speed={0.75}
          attenuation={8}
          lineThickness={2}
          baseRadius={0.18}
          radiusStep={0.07}
          scaleRate={0.08}
          opacity={0.95}
          noiseAmount={0.03}
        />
        <View style={styles.keepMovingRingCenter}>
          <Ionicons name="lock-closed" size={14} color={GOLD} />
        </View>
      </View>

      <View style={styles.keepMovingTextWrap}>
        <Text style={styles.keepMovingTitle}>Keep moving to unlock</Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '200',
    letterSpacing: -0.4,
    color: TEXT,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  walletBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#0a0a0a',
  },
  scroll: { flex: 1 },
  topContent: {
    paddingHorizontal: 12,
    gap: 10,
    paddingTop: 4,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 0,
    gap: 10,
  },

  // ── Balance card (floating, no background)
  balanceCard: {
    alignItems: 'flex-start',
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 10,
    gap: 4,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 12,
  },
  balanceLeft: {
    flex: 1,
    gap: 4,
  },
  balanceRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 2,
    color: MUTED,
    textTransform: 'uppercase',
  },
  balanceNumberRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    width: '100%',
  },
  balanceNumber: {
    fontSize: 64,
    fontWeight: '100',
    letterSpacing: -3,
    lineHeight: 66,
    color: GOLD,
    // Stable digit widths so the roll-up doesn't make the row jitter.
    fontVariant: ['tabular-nums'],
  },
  balanceUnit: {
    fontSize: 11,
    fontWeight: '500',
    color: DIM,
    letterSpacing: 2,
    marginBottom: 14,
  },
  levelPill: {
    alignItems: 'flex-end',
  },
  levelPillNum: {
    fontSize: 28,
    fontWeight: '200',
    color: TEXT,
    lineHeight: 30,
    letterSpacing: -0.5,
  },
  levelPillName: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: DIM,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  historyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  historyText: {
    fontSize: 11,
    color: DIM,
    fontWeight: '400',
  },
  todayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginLeft: 'auto',
    alignSelf: 'center',
  },
  todayDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: GOLD,
  },
  todayBadgeText: {
    fontSize: 10,
    fontWeight: '500',
    color: GOLD,
    letterSpacing: 0.3,
  },
  todayBadgeUnder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },

  // ── Featured card (floating, subtle accent line)
  featuredCard: {
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    overflow: 'hidden',
  },
  featuredAccent: {
    height: 2,
    backgroundColor: GOLD,
    opacity: 0.6,
  },
  featuredInner: {
    padding: 16,
  },
  featuredHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  featuredTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  featuredPointsBlock: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  featuredZoneBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: GOLD,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 20,
  },
  featuredZoneBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#0a0a0a',
  },
  featuredAdTag: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  featuredAdTagText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  featuredPtsBlock: {
    alignItems: 'flex-end',
  },
  featuredPtsNum: {
    fontSize: 30,
    fontWeight: '200',
    color: GOLD,
    letterSpacing: -1,
    lineHeight: 32,
  },
  featuredPtsUnit: {
    fontSize: 9,
    fontWeight: '600',
    color: GOLD,
    opacity: 0.7,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  featuredDiscountBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    alignSelf: 'flex-start',
  },
  featuredDiscountAmount: {
    fontSize: 16,
    fontWeight: '200',
    color: GOLD,
    letterSpacing: -0.3,
  },
  featuredDiscountSuffix: {
    fontSize: 8,
    fontWeight: '600',
    color: GOLD,
    letterSpacing: 1,
    opacity: 0.7,
  },
  featuredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(232,210,0,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.3)',
  },
  featuredBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: GOLD,
    letterSpacing: 0.3,
  },
  rotatesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: BORDER,
  },
  rotateDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: GOLD,
  },
  rotateBadgeText: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 1.2,
    color: DIM,
    textTransform: 'uppercase',
  },
  featuredTitle: {
    fontSize: 24,
    fontWeight: '300',
    letterSpacing: -0.4,
    color: TEXT,
    marginBottom: 3,
  },
  featuredSubtitle: {
    fontSize: 12,
    fontWeight: '300',
    color: DIM,
  },
  featuredHero: {
    height: 200,
    position: 'relative',
    backgroundColor: 'transparent',
  },
  featuredOverlayBody: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
  },
  featuredHeroImg: {
    width: '100%',
    height: '100%',
  },
  featuredHeroFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
  },
  featuredHeroBadges: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featuredLogoFloat: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredLogoImg: {
    width: '100%',
    height: '100%',
  },
  featuredLogoSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  featuredLogoInline: {
    width: 72,
    height: 72,
  },
  featuredProgressWrap: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 16,
  },
  featuredProgressBar: {
    height: '100%',
    backgroundColor: GOLD,
    borderRadius: 2,
  },
  featuredFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  featuredValueLarge: {
    fontSize: 20,
    fontWeight: '300',
    color: TEXT,
  },
  featuredPts: {
    fontSize: 12,
    fontWeight: '400',
    color: GOLD,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  redeemPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GOLD,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 22,
  },
  redeemPrimaryText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#0a0a0a',
    textTransform: 'uppercase',
  },
  closeBlock: {
    alignItems: 'flex-end',
  },
  closeText: {
    fontSize: 13,
    fontWeight: '400',
    color: GOLD,
  },
  closeHint: {
    fontSize: 10,
    fontWeight: '300',
    color: MUTED,
    marginTop: 2,
  },
  lockedBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  lockedText: {
    fontSize: 12,
    fontWeight: '300',
    color: MUTED,
  },

  // ── Category tabs
  catTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
    marginTop: 4,
    marginBottom: 8,
  },
  catTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    position: 'relative',
  },
  catTabLabel: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.5)',
  },
  catTabLabelActive: {
    color: '#FFFFFF',
  },
  catTabIndicator: {
    position: 'absolute',
    bottom: -1,
    left: '20%',
    right: '20%',
    height: 1.5,
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
  },

  // ── Reward list
  rewardsList: {
    gap: 8,
    marginTop: 2,
  },

  // ── Reward cards
  rewardCard: {
    backgroundColor: 'transparent',
    paddingVertical: 14,
    paddingHorizontal: 4,
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rewardCardLocked: {
    opacity: 0.5,
  },
  rewardRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  logoBoxLight: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(0,0,0,0.06)',
  },
  logoBoxLocked: {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  logoBoxBare: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  logoImage: {
    width: '78%',
    height: '78%',
  },
  logoText: {
    fontSize: 12,
    fontWeight: '700',
    color: DIM,
    textAlign: 'center',
  },
  logoTextDark: {
    color: '#1a1a1a',
  },
  logoTextLocked: {
    color: MUTED,
  },
  rewardInfo: {
    flex: 1,
    gap: 3,
  },
  rewardTitle: {
    fontSize: 15,
    fontWeight: '400',
    color: TEXT,
    letterSpacing: -0.1,
  },
  rewardTitleLocked: {
    color: DIM,
  },
  rewardSubtitle: {
    fontSize: 11,
    fontWeight: '300',
    color: DIM,
  },
  placementPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: 'rgba(232,210,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.28)',
  },
  placementPillText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1,
    color: GOLD,
  },
  placementAdTag: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  placementAdText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  rewardValueBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 86,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 4,
    flexShrink: 0,
  },
  rewardValueBadgeText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  progressWrap: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: GOLD,
    borderRadius: 2,
  },
  progressBarLocked: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  progressAway: {
    fontSize: 10,
    fontWeight: '500',
    color: GOLD,
    letterSpacing: 0.2,
    flexShrink: 0,
  },
  rewardRight: {
    alignItems: 'center',
    flexShrink: 0,
    minWidth: 44,
  },
  rewardPts: {
    fontSize: 20,
    fontWeight: '200',
    color: GOLD,
    letterSpacing: -0.5,
    lineHeight: 22,
  },
  rewardPtsUnit: {
    fontSize: 9,
    fontWeight: '500',
    color: GOLD,
    opacity: 0.7,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  rewardPtsLocked: {
    color: MUTED,
  },
  redeemedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  redeemedBadgeText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#4ade80',
    letterSpacing: 0.3,
  },

  // ── Hero banner (expanded)
  heroBanner: {
    height: 170,
    marginHorizontal: -14,
    marginTop: -14,
    marginBottom: 4,
    backgroundColor: 'rgba(0,0,0,0.35)',
    overflow: 'hidden',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 40,
  },

  // ── Expanded panel
  expandedPanel: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    gap: 14,
  },
  expandedTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  expandedValueBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  expandedValueBadgeText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  expandedOffer: {
    fontSize: 14,
    fontWeight: '300',
    color: TEXT,
    lineHeight: 21,
  },
  aboutBlock: {
    flex: 1,
    minWidth: 170,
    gap: 6,
  },
  expandedLabel: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 2,
    color: MUTED,
    textTransform: 'uppercase',
  },
  expandedBlurb: {
    fontSize: 12,
    fontWeight: '300',
    color: DIM,
    lineHeight: 18,
  },
  redeemInlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 14,
    borderRadius: 100,
    marginBottom: 4,
  },
  redeemInlineBtnText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: '#000',
  },
  walletLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 6,
  },
  walletLinkText: {
    fontSize: 12,
    fontWeight: '400',
    color: '#4ade80',
    letterSpacing: 0.2,
  },
  expandedFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  partnerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  partnerLinkText: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  // ── Expanded progress block
  expandedProgressBlock: {
    gap: 8,
  },
  expandedProgressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  expandedProgressAway: {
    fontSize: 12,
    fontWeight: '500',
    color: GOLD,
    letterSpacing: 0.2,
  },
  expandedProgressPct: {
    fontSize: 11,
    fontWeight: '400',
    color: MUTED,
    letterSpacing: 0.5,
  },
  expandedProgressWrap: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  expandedProgressFill: {
    height: '100%',
    backgroundColor: GOLD,
    borderRadius: 2,
  },
  expandedProgressFillLocked: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },

  keepMovingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  keepMovingCenterWrap: {
    minHeight: 420,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  catalogueStatusText: {
    fontSize: 14,
    fontWeight: '300',
    color: MUTED,
  },
  retryBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    paddingVertical: 11,
    paddingHorizontal: 22,
  },
  retryBtnText: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: TEXT,
    textTransform: 'uppercase',
  },
  keepMovingRingWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.25)',
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepMovingRingCenter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(232,210,0,0.2)',
  },
  keepMovingTextWrap: {
    alignItems: 'center',
    gap: 4,
  },
  keepMovingEyebrow: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: GOLD,
    opacity: 0.9,
  },
  keepMovingTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: TEXT,
    letterSpacing: -0.1,
  },
  keepMovingBody: {
    fontSize: 12,
    fontWeight: '300',
    color: DIM,
    lineHeight: 17,
  },
});

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { useSeason } from '@/components/series/season';
import { SeriesShareCard } from '@/components/share/SeriesShareCard';
import { SeriesStandingCard, STANDING_CARD_RATIO } from '@/components/share/SeriesStandingCard';
import { tracked } from '@/lib/analytics';
import { fetchSeriesBoard, fetchSeriesRoundTotals, type SeriesBoard, seriesDate } from '@/lib/api/series';
import { publishShareImage } from '@/lib/api/share';
import { fetchProfile } from '@/lib/api/user';
import { SERIES_PROTOTYPE } from '@/lib/dev/seriesPrototype';
import { SAVE_CARD_ENABLED, cardFilename, saveCardImage, saveCardNotice } from '@/lib/saveCard';
import {
  buildSeriesShareMessage,
  buildSeriesShareSubtitle,
  buildSeriesShareTitle,
  seriesInvitePath,
} from '@/lib/seriesInvite';
import { type CardClimb, type CardStat, cardClimb, cardRank, cardStats, type RoundTotals } from '@/lib/seriesShareCard';
import type { Honour } from '@/constants/honours';

const GOLD  = '#E8D200';
const BG    = '#0d0d0d';
const TEXT  = '#F2F2F2';
const DIM   = 'rgba(255,255,255,0.5)';
const MUTED = 'rgba(255,255,255,0.25)';

/** Must stay in step with share-event and the og:image size share-card-og declares. */
const OG_IMAGE_WIDTH  = 720;
const OG_IMAGE_HEIGHT = 1280;
/** The standing card is 4:5 (feed-post shape), so its captures are too. */
const FULL_WIDTH = 1080;

/** A circular icon button with a label beneath — the share-stats action row. */
function ActionButton({ icon, label, onPress, loading, disabled, primary }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.action, pressed && !disabled && { opacity: 0.7 }]}
    >
      <View style={[styles.actionCircle, primary ? styles.actionCirclePrimary : styles.actionCircleGhost]}>
        {loading ? (
          <ActivityIndicator color={primary ? '#0a0a0a' : TEXT} />
        ) : (
          <Ionicons name={icon} size={24} color={primary ? '#0a0a0a' : TEXT} />
        )}
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * Share the Series as a social card — the invite card on the League hands
 * off here (`/share-series?round=<name>&starts=<ms>&days=<n>`).
 *
 * Racing (you're on the board of a round that's on or just ended): your
 * standing card, 4:5 — place in your city, today's climb, the round in three
 * numbers, your trophy cabinet, a QR into your squad. Before a round, or not
 * joined: the Series invite card, 9:16, as before.
 *
 * Same doors as every other card: **Share** publishes the card and sends a
 * link whose preview IS the card (WhatsApp, iMessage…), landing a friend on
 * add-friend with the sharer's code — the same invite the card's SHARE
 * sends, with a picture; **Post** hands the full-res image to the Stories
 * apps, where the card itself carries the code; **Save** keeps the image.
 */
export default function ShareSeriesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const { def } = useSeason();
  const params = useLocalSearchParams<{ round?: string; starts?: string; days?: string }>();
  const roundName = typeof params.round === 'string' && params.round ? params.round : 'Round 01';
  const startsAt = Number(params.starts);
  const days = Number(params.days);
  const valid = Number.isFinite(startsAt) && startsAt > 0 && Number.isFinite(days) && days > 0;

  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [board, setBoard] = useState<SeriesBoard | null>(null);
  const [totals, setTotals] = useState<RoundTotals | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    // The board decides which card: a failed read just means the invite card.
    const boardRead = fetchSeriesBoard()
      .catch(() => null)
      .then(async (b) => {
        const t = b?.me && b.state !== 'upcoming' ? await fetchSeriesRoundTotals(b.round.starts_at) : null;
        if (active) { setBoard(b); setTotals(t); }
      });
    const profileRead = fetchProfile()
      .then((p) => {
        if (!active) return;
        setReferralCode(p?.referral_code ?? null);
        setProfileName(p?.display_name?.trim() || p?.username || null);
      })
      .catch(() => undefined);
    Promise.all([boardRead, profileRead]).finally(() => { if (active) setProfileLoaded(true); });
    return () => { active = false; };
  }, []);

  // On the board of a round that's on (or just ended): the standing card.
  const mine = board?.me && board.state !== 'upcoming' ? board : null;
  const rank = mine ? cardRank(mine) : null;
  const myRow = mine?.rows.find((r) => r.you) ?? null;
  const live = mine && rank ? {
    roundName: mine.round.name,
    day: mine.state === 'running' ? Math.max(1, mine.round.day) : null,
    days: mine.round.days,
    name: myRow?.name ?? profileName ?? 'POWR member',
    country: myRow?.country ?? null,
    city: rank.city,
    rank: rank.rank,
    climb: cardClimb(mine.me!, mine.total),
    // Days left counts today (day 3 of 16 = 14 left); none once it's over.
    stats: cardStats(totals, { points: mine.me!.points, daysLeft: mine.state === 'running' ? Math.max(0, mine.round.days - Math.max(1, mine.round.day) + 1) : 0 }),
    honours: myRow?.honours ?? [],
  } : null;
  // DEV ONLY (SERIES_PROTOTYPE, release builds never see it): not on the
  // board (not joined, or before a round), so Expo Go shows the standing card
  // with the design's sample numbers instead of the invite card. Share stays
  // off for it: that would publish made-up numbers to the real share_cards.
  const sample = !live && SERIES_PROTOTYPE ? {
    roundName: board?.round.name ?? roundName,
    day: board?.state === 'running' ? Math.max(1, board.round.day) : 2,
    days: board?.round.days ?? 16,
    name: profileName ?? 'Sam Carter',
    country: 'GB',
    city: 'London',
    rank: 123,
    climb: { key: 'climb', value: 425 } as CardClimb,
    stats: [{ key: 'steps', value: 18942 }, { key: 'run', value: 14.6 }, { key: 'gym', value: 3 }] as CardStat[],
    honours: [
      { kind: 'wings', tier: 'gold', count: 31 },
      { kind: 'strength', tier: 'gold', count: 61 },
      { kind: 'on_fire', tier: 'silver', count: 4 },
      { kind: 'power', tier: 'bronze', count: 2, detail: { w5: 0, w6: 0 } },
      { kind: 'hive', tier: 'bronze', count: 3, detail: { active: 0 } },
    ] as Honour[],
  } : null;
  const card = live ?? sample;
  const standing = !!card;

  const cardRef = useRef<View>(null);
  const readyRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'share' | 'post' | 'save' | null>(null);

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Reserve space for header (~52) + footer (~94) + gaps.
  const NON_CARD_HEIGHT = 190;
  const maxCardHeight = windowHeight - insets.top - insets.bottom - NON_CARD_HEIGHT;
  const ratio = standing ? STANDING_CARD_RATIO : 16 / 9;
  const previewWidth = Math.min(windowWidth - 48, 360, maxCardHeight / ratio);

  // Nothing remote on the card, but the first frame still has to paint
  // before a capture; capped so a stalled mount can't hang the button.
  async function awaitReady() {
    if (!readyRef.current) {
      await new Promise<void>((resolve) => {
        const started = Date.now();
        const tick = () => {
          if (readyRef.current || Date.now() - started > 2500) resolve();
          else setTimeout(tick, 50);
        };
        tick();
      });
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  async function handleShare() {
    if (!cardRef.current || !(valid || live) || busy) return;
    setBusy('share');
    try {
      await awaitReady();
      const uri = await captureRef(cardRef, {
        format: 'jpg',
        quality: 0.8,
        width: OG_IMAGE_WIDTH,
        height: standing ? Math.round(OG_IMAGE_WIDTH * STANDING_CARD_RATIO) : OG_IMAGE_HEIGHT,
        result: 'tmpfile',
      });
      const round = live?.roundName ?? roundName;
      const from = mine ? Date.parse(mine.round.starts_at) : startsAt;
      const shareUrl = await publishShareImage(uri, {
        title: buildSeriesShareTitle(def.name),
        subtitle: buildSeriesShareSubtitle({ roundName: round, startsAt: from, date: seriesDate(new Date(from).toISOString()) }),
        referralCode,
        appPath: seriesInvitePath(referralCode),
      });
      await Share.share({ message: buildSeriesShareMessage({ seasonName: def.name, shareUrl, startsAt: from }) });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('events:shareScreen.publishError'));
    } finally {
      setBusy(null);
    }
  }

  /** The full-res PNG both Post and Save hand out. */
  async function captureFullRes() {
    await awaitReady();
    return captureRef(cardRef, {
      format: 'png',
      quality: 1,
      width: FULL_WIDTH,
      height: Math.round(FULL_WIDTH * ratio),
      result: 'tmpfile',
    });
  }

  async function handlePost() {
    if (!cardRef.current || busy) return;
    setBusy('post');
    setNotice(null);
    try {
      const uri = await captureFullRes();
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: t('series:shareScreen.postDialog') });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('events:shareScreen.shareError'));
    } finally {
      setBusy(null);
    }
  }

  /** Keep the image itself — gallery write, share-sheet fallback (lib/saveCard.ts). */
  async function handleSave() {
    if (!cardRef.current || busy) return;
    setBusy('save');
    setNotice(null);
    try {
      const uri = await captureFullRes();
      const result = await saveCardImage(uri, cardFilename(`series-${def.key}`));
      setNotice(saveCardNotice(result));
    } catch (e) {
      setNotice(null);
      setLoadError(e instanceof Error ? e.message : t('events:shareScreen.saveError'));
    } finally {
      setBusy(null);
    }
  }

  const loading = !profileLoaded;

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn} accessibilityLabel={t('events:shareScreen.closeA11y')}>
          <Ionicons name="close" size={24} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('series:shareScreen.title')}</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Card preview */}
      <View style={styles.body}>
        {loading && <ActivityIndicator color={GOLD} />}
        {!loading && !valid && !standing && <Text style={styles.errorText}>{t('series:shareScreen.missing')}</Text>}
        {!loading && loadError && <Text style={styles.errorText}>{loadError}</Text>}
        {!loading && sample && (
          <Text style={styles.sampleNote}>DEV · sample numbers: this account isn&apos;t on the board</Text>
        )}
        {!loading && card && (
          <SeriesStandingCard
            ref={cardRef}
            testID="series-standing-card"
            def={def}
            {...card}
            referralCode={referralCode}
            width={previewWidth}
            onReady={() => { readyRef.current = true; }}
          />
        )}
        {!loading && !standing && valid && (
          <SeriesShareCard
            ref={cardRef}
            def={def}
            roundName={roundName}
            startsAt={startsAt}
            days={days}
            referralCode={referralCode}
            width={previewWidth}
            onReady={() => { readyRef.current = true; }}
          />
        )}
      </View>

      {/* Actions — Share sends a link preview (WhatsApp, iMessage, etc.);
          Post opens the image share sheet (TikTok, Instagram, X, Threads, etc.) */}
      {!loading && (valid || standing) && (
        <View style={styles.footer}>
          <View style={styles.actionRow}>
            <ActionButton
              icon="paper-plane"
              label={t('events:shareScreen.share')}
              onPress={tracked('share_series_send', handleShare)}
              loading={busy === 'share'}
              disabled={busy !== null || !!sample}
              primary
            />
            <ActionButton
              icon="share-social-outline"
              label={t('events:shareScreen.post')}
              onPress={tracked('share_series_post', handlePost)}
              loading={busy === 'post'}
              disabled={busy !== null}
            />
            {SAVE_CARD_ENABLED && (
              <ActionButton
                icon="download-outline"
                label={t('events:shareScreen.save')}
                onPress={tracked('share_series_save', handleSave)}
                loading={busy === 'save'}
                disabled={busy !== null}
              />
            )}
          </View>
          <Text style={styles.helperText}>
            {notice ?? (SAVE_CARD_ENABLED
              ? t('events:shareScreen.helperSave')
              : t('events:shareScreen.helper'))}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: TEXT, fontSize: 15, fontWeight: '300' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  errorText: { color: '#f87171', fontSize: 13, textAlign: 'center' },
  sampleNote: { color: GOLD, fontSize: 11, letterSpacing: 0.4, textAlign: 'center' },
  footer: { paddingHorizontal: 24, paddingTop: 8, gap: 14 },
  actionRow: { flexDirection: 'row', justifyContent: 'center', gap: 32 },
  action: { alignItems: 'center', gap: 8 },
  actionCircle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  actionCirclePrimary: { backgroundColor: GOLD },
  actionCircleGhost: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  actionLabel: { fontSize: 12, fontWeight: '400', letterSpacing: 0.3, color: DIM },
  helperText: { fontSize: 11, fontWeight: '300', color: MUTED, textAlign: 'center', lineHeight: 16 },
});

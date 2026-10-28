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
import { tracked } from '@/lib/analytics';
import { seriesDate } from '@/lib/api/series';
import { publishShareImage } from '@/lib/api/share';
import { fetchProfile } from '@/lib/api/user';
import { SAVE_CARD_ENABLED, cardFilename, saveCardImage, saveCardNotice } from '@/lib/saveCard';
import {
  buildSeriesShareMessage,
  buildSeriesShareSubtitle,
  buildSeriesShareTitle,
  seriesInvitePath,
} from '@/lib/seriesInvite';

const GOLD  = '#E8D200';
const BG    = '#0d0d0d';
const TEXT  = '#F2F2F2';
const DIM   = 'rgba(255,255,255,0.5)';
const MUTED = 'rgba(255,255,255,0.25)';

/** Must stay in step with share-event and the og:image size share-card-og declares. */
const OG_IMAGE_WIDTH  = 720;
const OG_IMAGE_HEIGHT = 1280;

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
  const [profileLoaded, setProfileLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    fetchProfile()
      .then((p) => { if (active) setReferralCode(p?.referral_code ?? null); })
      .finally(() => { if (active) setProfileLoaded(true); });
    return () => { active = false; };
  }, []);

  const cardRef = useRef<View>(null);
  const readyRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'share' | 'post' | 'save' | null>(null);

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Reserve space for header (~52) + footer (~94) + gaps.
  const NON_CARD_HEIGHT = 190;
  const maxCardHeight = windowHeight - insets.top - insets.bottom - NON_CARD_HEIGHT;
  const previewWidth = Math.min(windowWidth - 48, 360, maxCardHeight * (9 / 16));

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
    if (!cardRef.current || !valid || busy) return;
    setBusy('share');
    try {
      await awaitReady();
      const uri = await captureRef(cardRef, {
        format: 'jpg',
        quality: 0.8,
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        result: 'tmpfile',
      });
      const shareUrl = await publishShareImage(uri, {
        title: buildSeriesShareTitle(def.name),
        subtitle: buildSeriesShareSubtitle({ roundName, startsAt, date: seriesDate(new Date(startsAt).toISOString()) }),
        referralCode,
        appPath: seriesInvitePath(referralCode),
      });
      await Share.share({ message: buildSeriesShareMessage({ seasonName: def.name, shareUrl, code: referralCode }) });
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
      width: 1080,
      height: 1920,
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
        {!valid && <Text style={styles.errorText}>{t('series:shareScreen.missing')}</Text>}
        {!loading && loadError && <Text style={styles.errorText}>{loadError}</Text>}
        {!loading && valid && (
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
      {!loading && valid && (
        <View style={styles.footer}>
          <View style={styles.actionRow}>
            <ActionButton
              icon="paper-plane"
              label={t('events:shareScreen.share')}
              onPress={tracked('share_series_send', handleShare)}
              loading={busy === 'share'}
              disabled={busy !== null}
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

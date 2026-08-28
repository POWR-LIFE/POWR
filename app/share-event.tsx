import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { EventShareCard } from '@/components/share/EventShareCard';
import { tracked } from '@/lib/analytics';
import { fetchActiveLiveEvent, fetchLiveEventBySlug, type LiveEvent } from '@/lib/api/liveEvents';
import { publishShareImage } from '@/lib/api/share';
import { fetchProfile } from '@/lib/api/user';
import { SAVE_CARD_ENABLED, cardFilename, saveCardImage, saveCardNotice } from '@/lib/saveCard';
import {
  buildEventShareMessage,
  buildEventSharePath,
  buildEventShareSubtitle,
  buildEventShareTitle,
} from '@/lib/eventShare';

const GOLD  = '#E8D200';
const BG    = '#0d0d0d';
const TEXT  = '#F2F2F2';
const DIM   = 'rgba(255,255,255,0.5)';
const MUTED = 'rgba(255,255,255,0.25)';

/** Must stay in step with share-stats and the og:image size share-card-og declares. */
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
 * Share a live event as a social card — the League header, the ticket card
 * and the event QR screen all hand off here (`/share-event?slug=<event>`).
 *
 * Same doors as every other card: **Share** publishes the card and sends a
 * link whose preview IS the card (WhatsApp, iMessage…), landing a friend on
 * this event with the sharer's code attached — the same invite the ticket
 * card's SHARE sends, with a picture; **Post** hands the full-res image to
 * the Stories apps, where the card itself carries the code; **Save** keeps
 * the image.
 */
export default function ShareEventScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === 'string' ? params.slug : null;

  // The League tab has usually just fetched this event under its own key; seed
  // from it so the card is there on arrival rather than a spinner later.
  const eventQuery = useQuery<LiveEvent | null>({
    queryKey: ['liveEvent', slug ?? 'active'],
queryFn: async () => {
  if (slug) return fetchLiveEventBySlug(slug);
  return fetchActiveLiveEvent();
},
    initialData: () => {
      const cached = queryClient.getQueryData<LiveEvent | null>(['liveEvent', 'active']);
      return cached && (!slug || cached.slug === slug) ? cached : undefined;
    },
    staleTime: 60_000,
  });
  const event = eventQuery.data ?? null;

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

  // The lockup's marks (and any promo still) are remote images; a capture
  // before they paint is a markless frame. Wait for the card's ready signal,
  // capped so a stalled load can't hang the button.
  async function awaitReady() {
    if (readyRef.current) return;
    await new Promise<void>((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (readyRef.current || Date.now() - started > 2500) resolve();
        else setTimeout(tick, 50);
      };
      tick();
    });
    await new Promise((r) => setTimeout(r, 60)); // let the loaded image paint
  }

  async function handleShare() {
    if (!cardRef.current || !event || busy) return;
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
        title: buildEventShareTitle(event),
        subtitle: buildEventShareSubtitle(event),
        referralCode,
        appPath: buildEventSharePath(event, referralCode),
      });
      await Share.share({ message: buildEventShareMessage({ event, shareUrl, referralCode }) });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not publish your card.');
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
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Post the event' });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not share your card.');
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
      const result = await saveCardImage(uri, cardFilename(`event-${event?.slug ?? 'card'}`));
      setNotice(saveCardNotice(result));
    } catch (e) {
      setNotice(null);
      setLoadError(e instanceof Error ? e.message : 'Could not save your card.');
    } finally {
      setBusy(null);
    }
  }

  const loading = eventQuery.isLoading || !profileLoaded;
  const missing = !loading && !event;

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn} accessibilityLabel="Close">
          <Ionicons name="close" size={24} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>Share event</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Card preview */}
      <View style={styles.body}>
        {loading && <ActivityIndicator color={GOLD} />}
        {missing && <Text style={styles.errorText}>This event isn’t available to share.</Text>}
        {!loading && loadError && <Text style={styles.errorText}>{loadError}</Text>}
        {!loading && event && (
          <EventShareCard
            ref={cardRef}
            event={event}
            referralCode={referralCode}
            width={previewWidth}
            onReady={() => { readyRef.current = true; }}
          />
        )}
      </View>

      {/* Actions — Share sends a link preview (WhatsApp, iMessage, etc.);
          Post opens the image share sheet (TikTok, Instagram, X, Threads, etc.) */}
      {!loading && event && (
        <View style={styles.footer}>
          <View style={styles.actionRow}>
            <ActionButton
              icon="paper-plane"
              label="Share"
              onPress={tracked('share_event_send', handleShare)}
              loading={busy === 'share'}
              disabled={busy !== null}
              primary
            />
            <ActionButton
              icon="share-social-outline"
              label="Post"
              onPress={tracked('share_event_post', handlePost)}
              loading={busy === 'post'}
              disabled={busy !== null}
            />
            {SAVE_CARD_ENABLED && (
              <ActionButton
                icon="download-outline"
                label="Save"
                onPress={tracked('share_event_save', handleSave)}
                loading={busy === 'save'}
                disabled={busy !== null}
              />
            )}
          </View>
          <Text style={styles.helperText}>
            {notice ?? (SAVE_CARD_ENABLED
              ? 'Share sends a tappable link preview. Post shares the image to TikTok, Instagram and more. Save keeps the image on your phone.'
              : 'Share sends a tappable link preview. Post shares the image to TikTok, Instagram, X, Threads and more.')}
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

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
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

import { ShareCard } from '@/components/share/ShareCard';
import { LEVEL_IMAGE, getLevelInfo } from '@/constants/levels';
import { buildShareMessage, fetchAutoSummary, fetchChallengeSummary, fetchCheckInSummary, publishShareCard, type ShareSummary } from '@/lib/api/share';

const GOLD  = '#E8D200';
const BG    = '#0d0d0d';
const TEXT  = '#F2F2F2';
const DIM   = 'rgba(255,255,255,0.5)';
const MUTED = 'rgba(255,255,255,0.25)';

/**
 * The og:image is captured smaller than the shareable PNG on purpose: link
 * crawlers cap the image they will fetch to build a thumbnail (WhatsApp's is
 * well under a megabyte), and a preview with no picture is worse than no
 * preview. Must stay in step with the og:image:width/height the share-card-og
 * function declares.
 */
const OG_IMAGE_WIDTH  = 720;
const OG_IMAGE_HEIGHT = 1280;

type Mode   = 'check-in' | 'streak' | 'challenge';
type BgMode = 'cover' | 'level' | 'gallery';

const BG_OPTIONS: { key: BgMode; icon: React.ComponentProps<typeof Ionicons>['name']; label: string }[] = [
  { key: 'cover',   icon: 'person-circle-outline', label: 'My Photo'  },
  { key: 'level',   icon: 'ribbon-outline',        label: 'My Level'  },
  { key: 'gallery', icon: 'images-outline',        label: 'Gallery'   },
];

/** A circular icon button with a label beneath, à la the TikTok "send to" row. */
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

export default function ShareStatsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; sessionId?: string; challenge?: string }>();
  const mode: Mode =
    params.mode === 'check-in' ? 'check-in' : params.mode === 'challenge' ? 'challenge' : 'streak';

  const cardRef = useRef<View>(null);
  const [summary, setSummary]     = useState<ShareSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice]       = useState<string | null>(null);
  const [busy, setBusy]           = useState<'share' | 'save' | null>(null);
  const [bgMode, setBgMode]       = useState<BgMode>('cover');
  const [galleryUri, setGalleryUri] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'check-in') {
      if (!params.sessionId) { setLoadError('No session specified.'); return; }
      fetchCheckInSummary(params.sessionId)
        .then(setSummary)
        .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not load this check-in.'));
    } else if (mode === 'challenge') {
      if (!params.challenge) { setLoadError('No challenge specified.'); return; }
      let challenge;
      try {
        challenge = JSON.parse(params.challenge);
      } catch {
        setLoadError('Could not load this challenge.');
        return;
      }
      fetchChallengeSummary(challenge)
        .then(setSummary)
        .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not load this challenge.'));
    } else {
      fetchAutoSummary()
        .then(setSummary)
        .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not load your stats.'));
    }
  }, [mode, params.sessionId, params.challenge]);

  // Warm the level artwork before the user can pick it — captureRef would
  // otherwise snapshot an empty tile if they tap Share while it's still loading.
  useEffect(() => {
    if (!summary) return;
    const uri = LEVEL_IMAGE[getLevelInfo(summary.totalEarned).current.level];
    if (uri) Image.prefetch(uri);
  }, [summary]);

  async function pickFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setLoadError('Photo library access is required to use your own photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [9, 16],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      setGalleryUri(result.assets[0].uri);
      setBgMode('gallery');
    }
  }

  function handleBgOption(key: BgMode) {
    if (key === 'gallery') {
      pickFromGallery();
    } else {
      setBgMode(key);
    }
  }

  function effectiveBgSource(): string | number | null | undefined {
    if (bgMode === 'gallery') return galleryUri ?? undefined;
    if (bgMode === 'level')   return null;   // solid dark
    return null;                             // cover → solid dark + circular avatar overlay
  }

  function effectiveAvatarUri(): string | null {
    if (bgMode === 'cover') return summary?.profile.avatarUrl ?? null;
    return null;
  }

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Reserve space for header (~52) + picker row (~56) + footer (~94) + gaps (~38)
  const NON_CARD_HEIGHT = 240;
  const maxCardHeight = windowHeight - insets.top - insets.bottom - NON_CARD_HEIGHT;
  const maxWidthFromHeight = maxCardHeight * (9 / 16);
  const previewWidth = Math.min(windowWidth - 48, 360, maxWidthFromHeight);

  /**
   * Publishes the card and opens the OS share sheet on a link to it — the sheet
   * itself is the "send to" menu of WhatsApp / Messenger / Instagram / SMS.
   *
   * The link, not the image, is what goes out: chat apps only draw a tappable
   * preview for a URL they can scrape. An attached image is the whole message,
   * and any text alongside it is dropped.
   *
   * The upload is a JPEG, not the 1080×1920 PNG the Save button writes — link
   * crawlers cap the image they will fetch for a thumbnail, and a multi-megabyte
   * PNG buys a preview with no picture in it.
   */
  async function handleShare() {
    if (!cardRef.current || !summary || busy) return;
    setBusy('share');
    setNotice(null);
    try {
      const uri = await captureRef(cardRef, {
        format: 'jpg',
        quality: 0.8,
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        result: 'tmpfile',
      });
      const shareUrl = await publishShareCard(summary, uri);
      await Share.share({ message: buildShareMessage(summary, shareUrl) });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not publish your card.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Saves the full-resolution card to the camera roll. Instagram and TikTok
   * Stories are posted from a saved photo, not a link — so this is the Stories
   * path, deliberately separate from Share.
   */
  async function handleSave() {
    if (!cardRef.current || busy) return;
    setBusy('save');
    setNotice(null);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        setLoadError('Photo access is needed to save your card.');
        return;
      }
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        width: 1080,
        height: 1920,
        result: 'tmpfile',
      });
      await MediaLibrary.saveToLibraryAsync(uri);
      setNotice('Saved to your photos — post it to your story.');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not save your card.');
    } finally {
      setBusy(null);
    }
  }

  const headerTitle =
    mode === 'check-in' ? 'Share check-in'
    : mode === 'challenge' ? 'Share challenge'
    : 'Share your streak';

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="close" size={24} color={DIM} />
        </Pressable>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Card preview */}
      <View style={styles.body}>
        {!summary && !loadError && <ActivityIndicator color={GOLD} />}
        {loadError && <Text style={styles.errorText}>{loadError}</Text>}
        {summary && (
          <ShareCard
            ref={cardRef}
            summary={summary}
            width={previewWidth}
            backgroundSource={effectiveBgSource()}
            avatarUri={effectiveAvatarUri()}
            showLevel={bgMode === 'level'}
          />
        )}
      </View>

      {/* Background picker */}
      {summary && (
        <View style={styles.pickerRow}>
          {BG_OPTIONS.map(opt => {
              const isGalleryWithImage = opt.key === 'gallery' && galleryUri !== null;
            const isActive = opt.key === bgMode;
            return (
              <Pressable
                key={opt.key}
                onPress={() => handleBgOption(opt.key)}
                style={({ pressed }) => [
                  styles.pickerOption,
                  isActive && styles.pickerOptionActive,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons
                  name={isGalleryWithImage ? 'checkmark-circle' : opt.icon}
                  size={16}
                  color={isActive ? GOLD : DIM}
                />
                <Text style={[styles.pickerLabel, isActive && styles.pickerLabelActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Actions — Share opens the OS "send to" sheet on a link; Save writes the
          card to the camera roll for Stories. */}
      {summary && (
        <View style={styles.footer}>
          <View style={styles.actionRow}>
            <ActionButton
              icon="paper-plane"
              label="Share"
              onPress={handleShare}
              loading={busy === 'share'}
              disabled={busy !== null}
              primary
            />
            <ActionButton
              icon="download-outline"
              label="Save"
              onPress={handleSave}
              loading={busy === 'save'}
              disabled={busy !== null}
            />
          </View>
          <Text style={styles.helperText}>
            {notice ?? 'Share posts a tappable card that opens POWR. Save it to post to your Instagram or TikTok story.'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: '300',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    textAlign: 'center',
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  pickerOptionActive: {
    borderColor: GOLD,
    backgroundColor: 'rgba(232,210,0,0.08)',
  },
  pickerLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: DIM,
  },
  pickerLabelActive: {
    color: GOLD,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 14,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
  },
  action: {
    alignItems: 'center',
    gap: 8,
  },
  actionCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCirclePrimary: {
    backgroundColor: GOLD,
  },
  actionCircleGhost: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '400',
    letterSpacing: 0.3,
    color: DIM,
  },
  helperText: {
    fontSize: 11,
    fontWeight: '300',
    color: MUTED,
    textAlign: 'center',
    lineHeight: 16,
  },
});
